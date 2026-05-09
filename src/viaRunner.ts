import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

type ViaCommandResult = {
  stdout: string;
  stderr: string;
};

type ViaResponse = {
  ok?: boolean;
  reason?: string;
  data?: unknown;
};

type ViaSession = {
  instanceName: string;
  workspacePath: string;
};

type ListedKernel = ViaSession & {
  status?: string;
};

const SESSION_NAME_KEY = "via.instanceName";
const WORKSPACE_PATH_KEY = "via.workspacePath";
const KNOWN_KERNELS_KEY = "via.knownKernels";

export class ViaRunner implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel("VIA Runner");
  private readonly statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  constructor(private readonly context: vscode.ExtensionContext) {
    this.statusBar.command = "via.selectWorkspace";
    this.context.subscriptions.push(this.output, this.statusBar);
    this.updateStatusBar();
  }

  dispose(): void {
    this.statusBar.dispose();
    this.output.dispose();
  }

  async configureSession(): Promise<void> {
    this.assertLinuxHost();
    await this.promptForWorkspaceSession(this.readSession(), true);
  }

  async selectWorkspace(): Promise<void> {
    this.assertLinuxHost();

    const current = this.readSession();
    const running = await this.listKernels();
    const known = this.readKnownKernels();
    const merged = dedupeListedKernels(current, running, known);

    const picks: vscode.QuickPickItem[] = merged.map((item) => ({
      label: item.workspacePath || item.instanceName,
      description: item.status ? `status: ${item.status}` : undefined,
      detail: item.instanceName === current.instanceName
        ? `Current workspace • instance: ${item.instanceName}`
        : `instance: ${item.instanceName}`,
    }));

    picks.push(
      {
        label: "$(add) New Workspace...",
        detail: "Create a new via workspace preset and select it",
      },
      {
        label: "$(gear) Configure Current Workspace...",
        detail: current.workspacePath || current.instanceName
          ? `Edit ${current.workspacePath || "current workspace"}`
          : "Set the current via workspace",
      },
    );

    const picked = await vscode.window.showQuickPick(picks, {
      title: "Select VIA Workspace",
      placeHolder: "Choose a known workspace or create a new one",
      ignoreFocusOut: true,
    });

    if (!picked) {
      return;
    }

    if (picked.label.startsWith("$(add)")) {
      await this.createWorkspace();
      return;
    }

    if (picked.label.startsWith("$(gear)")) {
      await this.configureSession();
      return;
    }

    const selected = merged.find((item) => item.workspacePath === stripCodiconPrefix(picked.label));
    if (!selected) {
      return;
    }

    await this.setCurrentSession(selected);
    void vscode.window.showInformationMessage(`VIA workspace set to ${selected.workspacePath}.`);
  }

  async createWorkspace(): Promise<void> {
    this.assertLinuxHost();
    const created = await this.promptForWorkspaceSession(this.readSession(), false);
    if (!created) {
      return;
    }

    const action = await vscode.window.showQuickPick(
      [
        {
          label: "Start Now",
          detail: `Run via start for ${created.workspacePath}`,
        },
        {
          label: "Only Select",
          detail: "Keep the workspace selected but do not start it now",
        },
      ],
      {
        title: "Workspace Created",
        ignoreFocusOut: true,
      },
    );

    if (action?.label === "Start Now") {
      await this.startKernel();
    }
  }

  async startKernel(): Promise<void> {
    this.assertLinuxHost();
    const session = await this.ensureSessionConfigured();
    if (!session) {
      return;
    }

    const alreadyRunning = await this.isKernelRunning(session.instanceName);
    if (alreadyRunning) {
      this.output.appendLine(`[skip] via instance "${session.instanceName}" is already running.`);
      this.output.show(true);
      void vscode.window.showInformationMessage(`VIA workspace is already running.`);
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Starting VIA workspace ${basename(session.workspacePath)}`,
        cancellable: false,
      },
      async () => {
        const result = await this.runVia(
          ["start", "--name", session.instanceName, "--workspace", session.workspacePath],
          session.workspacePath,
        );
        this.revealResult("Workspace start", result);
      },
    );

    void vscode.window.showInformationMessage(`VIA workspace started.`);
  }

  async runFile(uri?: vscode.Uri): Promise<void> {
    this.assertLinuxHost();
    const editor = this.requireEditor(uri);
    if (!editor) {
      return;
    }

    if (!this.isSkillDocument(editor.document)) {
      void vscode.window.showErrorMessage("VIA Runner only supports .il files.");
      return;
    }

    if (editor.document.isUntitled) {
      void vscode.window.showErrorMessage("Save the .il file before running it with via.");
      return;
    }

    if (editor.document.isDirty) {
      const saved = await editor.document.save();
      if (!saved) {
        void vscode.window.showErrorMessage("The file must be saved before running it with via.");
        return;
      }
    }

    const session = await this.ensureKernelReady();
    if (!session) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Running ${editor.document.fileName.split("/").pop()} via ${session.instanceName}`,
        cancellable: false,
      },
      async () => {
        const result = await this.runVia(
          ["send", "--name", session.instanceName, "--load", editor.document.fileName],
          session.workspacePath,
        );
        this.revealResult("File execution", result);
      },
    );

    void vscode.window.setStatusBarMessage(`VIA loaded ${editor.document.fileName}`, 3000);
  }

  async runSelection(range?: vscode.Range): Promise<void> {
    this.assertLinuxHost();
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.isSkillDocument(editor.document)) {
      void vscode.window.showErrorMessage("Open a .il editor to run selected code.");
      return;
    }

    const session = await this.ensureKernelReady();
    if (!session) {
      return;
    }

    const executionRange = resolveExecutionRange(editor.document, range, editor.selection);
    const source = normalizeEvalSource(editor.document.getText(executionRange));
    if (source.length === 0) {
      void vscode.window.showWarningMessage("No SKILL code found in the current selection or paragraph.");
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Running SKILL code via ${session.instanceName}`,
        cancellable: false,
      },
      async () => {
        this.output.appendLine("[eval] source:");
        this.output.appendLine(source);
        const result = await this.runVia(
          ["send", "--name", session.instanceName, "--eval", source],
          session.workspacePath,
        );
        this.revealResult("Selection execution", result);
        const response = parseJson(result.stdout);
        if (response?.ok === false) {
          throw new Error(response.reason || "via send returned an error.");
        }
      },
    );

    void vscode.window.setStatusBarMessage("VIA selection executed.", 3000);
  }

  private assertLinuxHost(): void {
    if (process.platform !== "linux") {
      throw new Error("VIA Runner requires the extension host to run on Linux.");
    }
  }

  private requireEditor(uri?: vscode.Uri): vscode.TextEditor | undefined {
    if (!uri) {
      return vscode.window.activeTextEditor;
    }

    const visible = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === uri.toString());
    return visible ?? vscode.window.activeTextEditor;
  }

  private isSkillDocument(document: vscode.TextDocument): boolean {
    return document.languageId === "skill" || document.fileName.endsWith(".il");
  }

  private async ensureKernelReady(): Promise<ViaSession | undefined> {
    const session = await this.ensureSessionConfigured();
    if (!session) {
      return undefined;
    }

    if (await this.isKernelRunning(session.instanceName)) {
      return session;
    }

    if (this.getConfig<boolean>("autoStartKernel")) {
      await this.startKernel();
      return session;
    }

    const choice = await vscode.window.showWarningMessage(
      `The selected VIA workspace is not running.`,
      "Start Workspace",
    );

    if (choice !== "Start Workspace") {
      return undefined;
    }

    await this.startKernel();
    return session;
  }

  private async ensureSessionConfigured(): Promise<ViaSession | undefined> {
    let session = this.readSession();
    if (session.instanceName && session.workspacePath) {
      return session;
    }

    await this.selectWorkspace();
    session = this.readSession();
    if (session.instanceName && session.workspacePath) {
      return session;
    }

    return undefined;
  }

  private readSession(): ViaSession {
    return {
      instanceName: this.context.workspaceState.get<string>(SESSION_NAME_KEY, "").trim(),
      workspacePath: this.context.workspaceState.get<string>(WORKSPACE_PATH_KEY, "").trim(),
    };
  }

  private readKnownKernels(): ViaSession[] {
    const stored = this.context.workspaceState.get<ViaSession[]>(KNOWN_KERNELS_KEY, []);
    const fromConfig = this.getConfig<ViaSession[]>("knownKernels") || [];
    return dedupeSessions([...stored, ...fromConfig]);
  }

  private async setCurrentSession(session: ViaSession): Promise<void> {
    const normalized = {
      instanceName: session.instanceName.trim(),
      workspacePath: session.workspacePath.trim(),
    };

    await this.context.workspaceState.update(SESSION_NAME_KEY, normalized.instanceName);
    await this.context.workspaceState.update(WORKSPACE_PATH_KEY, normalized.workspacePath);
    await this.context.workspaceState.update(
      KNOWN_KERNELS_KEY,
      dedupeSessions([normalized, ...this.readKnownKernels()]),
    );
    this.updateStatusBar();
  }

  private async promptForWorkspaceSession(
    current: ViaSession,
    forceInstancePrompt: boolean,
  ): Promise<ViaSession | undefined> {
    const defaultWorkspace = current.workspacePath || this.getConfig<string>("defaultWorkspace") || getCurrentWorkspacePath();
    const defaultUri = defaultWorkspace ? vscode.Uri.file(defaultWorkspace) : undefined;
    const picked = await vscode.window.showOpenDialog({
      title: "Select VIA Workspace",
      defaultUri,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Use Workspace",
    });

    if (!picked || picked.length === 0) {
      return undefined;
    }

    const selectedWorkspacePath = picked[0].fsPath;
    const defaultName = current.instanceName
      || this.getConfig<string>("defaultInstanceName")
      || inferInstanceNameFromWorkspace(selectedWorkspacePath);
    const instanceName = forceInstancePrompt
      ? await vscode.window.showInputBox({
        title: "VIA Instance Name",
        prompt: "Optional via instance name used internally",
        value: defaultName,
        ignoreFocusOut: true,
        validateInput: (value) => (value.trim().length === 0 ? "Instance name is required." : undefined),
      })
      : defaultName;

    if (!instanceName) {
      return undefined;
    }

    const session = {
      instanceName: instanceName.trim(),
      workspacePath: selectedWorkspacePath,
    };
    await this.setCurrentSession(session);
    void vscode.window.showInformationMessage(`VIA workspace set to ${session.workspacePath}.`);
    return session;
  }

  private updateStatusBar(): void {
    const session = this.readSession();
    if (!session.instanceName || !session.workspacePath) {
      this.statusBar.text = "$(folder-library) Select Workspace";
      this.statusBar.tooltip = "Choose or create a via workspace.";
      this.statusBar.show();
      return;
    }

    this.statusBar.text = `$(folder-library) ${basename(session.workspacePath)} $(chevron-down)`;
    this.statusBar.tooltip = `Workspace: ${session.workspacePath}\nInstance: ${session.instanceName}`;
    this.statusBar.show();
  }

  private async listKernels(): Promise<ListedKernel[]> {
    try {
      const result = await this.runVia(["list"]);
      return parseListedKernels(result.stdout);
    } catch (error) {
      this.output.appendLine(`[warn] failed to inspect via list: ${toErrorMessage(error)}`);
      return [];
    }
  }

  private async isKernelRunning(instanceName: string): Promise<boolean> {
    try {
      const kernels = await this.listKernels();
      return kernels.some((kernel) => kernel.instanceName === instanceName && /running/i.test(kernel.status || ""));
    } catch (error) {
      this.output.appendLine(`[warn] failed to inspect via list: ${toErrorMessage(error)}`);
      return false;
    }
  }

  private async runVia(args: string[], cwd?: string): Promise<ViaCommandResult> {
    const commandPath = this.getConfig<string>("commandPath") || "via";
    this.output.appendLine(`$ ${commandPath} ${args.join(" ")}`);

    try {
      const result = await execFileAsync(commandPath, args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 8,
      });

      this.writeCommandOutput(result.stdout, result.stderr);
      return result;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & Partial<ViaCommandResult>;
      this.writeCommandOutput(failure.stdout || "", failure.stderr || "");
      this.output.show(true);
      throw new Error(`via command failed: ${toErrorMessage(error)}`);
    }
  }

  private writeCommandOutput(stdout: string, stderr: string): void {
    if (stdout.trim().length > 0) {
      this.output.appendLine(stdout.trimEnd());
    }

    if (stderr.trim().length > 0) {
      this.output.appendLine(stderr.trimEnd());
    }
  }

  private revealResult(title: string, result: ViaCommandResult): void {
    this.output.appendLine(`[done] ${title}`);
    if (!result.stdout.trim() && !result.stderr.trim()) {
      this.output.appendLine("[done] no output returned");
    }
    this.output.show(true);
  }

  private getConfig<T>(key: string): T {
    return vscode.workspace.getConfiguration("via").get<T>(key) as T;
  }
}

function resolveExecutionRange(
  document: vscode.TextDocument,
  requestedRange: vscode.Range | undefined,
  selection: vscode.Selection,
): vscode.Range {
  if (requestedRange) {
    return requestedRange;
  }

  if (!selection.isEmpty) {
    return new vscode.Range(selection.start, selection.end);
  }

  return inferParagraphRange(document, selection.active.line);
}

function inferParagraphRange(document: vscode.TextDocument, activeLine: number): vscode.Range {
  let startLine = activeLine;
  let endLine = activeLine;

  while (startLine > 0 && shouldExtendParagraph(document, startLine - 1)) {
    startLine -= 1;
  }

  while (endLine < document.lineCount - 1 && shouldExtendParagraph(document, endLine + 1)) {
    endLine += 1;
  }

  return new vscode.Range(
    new vscode.Position(startLine, 0),
    document.lineAt(endLine).range.end,
  );
}

function shouldExtendParagraph(document: vscode.TextDocument, line: number): boolean {
  const text = document.lineAt(line).text;
  return text.trim().length > 0 || /^\s*[)\]]/.test(text);
}

function normalizeEvalSource(source: string): string {
  return source.replace(/\r\n/g, "\n").trim();
}

function parseJson(stdout: string): ViaResponse | undefined {
  const text = stdout.trim();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as ViaResponse;
  } catch {
    return undefined;
  }
}

function dedupeSessions(sessions: ViaSession[]): ViaSession[] {
  const byName = new Map<string, ViaSession>();

  for (const session of sessions) {
    const instanceName = session.instanceName.trim();
    if (!instanceName) {
      continue;
    }

    const previous = byName.get(instanceName);
    byName.set(instanceName, {
      instanceName,
      workspacePath: session.workspacePath.trim() || previous?.workspacePath || "",
    });
  }

  return [...byName.values()];
}

function dedupeListedKernels(
  current: ViaSession,
  running: ListedKernel[],
  known: ViaSession[],
): ListedKernel[] {
  const merged = new Map<string, ListedKernel>();

  const all = [
    ...(current.instanceName ? [{ ...current, status: current.workspacePath ? "selected" : undefined }] : []),
    ...running,
    ...known.map((item) => ({ ...item, status: undefined })),
  ];

  for (const item of all) {
    const instanceName = item.instanceName.trim();
    if (!instanceName) {
      continue;
    }

    const previous = merged.get(instanceName);
    merged.set(instanceName, {
      instanceName,
      workspacePath: item.workspacePath.trim() || previous?.workspacePath || "",
      status: item.status || previous?.status,
    });
  }

  return [...merged.values()];
}

function parseListedKernels(stdout: string): ListedKernel[] {
  const kernels = new Map<string, ListedKernel>();
  let currentName = "";

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("NAME ")) {
      continue;
    }

    const summaryMatch = line.match(/^(\S+)\s+\d+\s+(\S+)\s+(\S+)$/);
    if (summaryMatch) {
      currentName = summaryMatch[1];
      kernels.set(currentName, {
        instanceName: currentName,
        workspacePath: kernels.get(currentName)?.workspacePath || "",
        status: summaryMatch[2],
      });
      continue;
    }

    const bracketWorkspaceMatch = line.match(/^\[(.+?)\]\s+workspace\s*:\s*(.+)$/);
    if (bracketWorkspaceMatch) {
      const name = bracketWorkspaceMatch[1];
      const existing = kernels.get(name) || {
        instanceName: name,
        workspacePath: "",
      };
      kernels.set(name, {
        ...existing,
        workspacePath: bracketWorkspaceMatch[2].trim(),
      });
      currentName = name;
      continue;
    }

    if (currentName && line.startsWith("workspace :")) {
      const existing = kernels.get(currentName);
      if (existing) {
        existing.workspacePath = line.replace(/^workspace\s*:\s*/, "").trim();
      }
    }
  }

  return [...kernels.values()];
}

function stripCodiconPrefix(label: string): string {
  return label.replace(/^\$\([^)]+\)\s*/, "");
}

function getCurrentWorkspacePath(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
}

function inferInstanceNameFromWorkspace(workspacePath: string): string {
  const name = basename(workspacePath).trim();
  return name || "vscode";
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
