import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

type ViaWorkspace = {
  instanceName: string;
  workspacePath: string;
};

type ListedWorkspace = ViaWorkspace & {
  status?: string;
};

type WorkspaceQuickPickItem = vscode.QuickPickItem & {
  workspace?: ViaWorkspace;
  action?: "current" | "new" | "configure";
};

const WORKSPACE_INSTANCE_NAME_KEY = "via.instanceName";
const WORKSPACE_PATH_KEY = "via.workspacePath";
const KNOWN_WORKSPACES_STATE_KEY = "via.knownWorkspaces";
const LEGACY_KNOWN_WORKSPACES_STATE_KEY = "via.knownKernels";

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

  async configureWorkspace(): Promise<void> {
    this.assertLinuxHost();
    await this.promptForWorkspaceSelection(this.readWorkspaceSelection(), true);
  }

  async selectWorkspace(): Promise<void> {
    this.assertLinuxHost();

    const current = this.readWorkspaceSelection();
    const running = await this.listWorkspaces();
    const known = this.readKnownWorkspaces();
    const merged = dedupeListedWorkspaces(current, running, known);
    const currentEditorWorkspace = getCurrentWorkspaceSelection();

    const picks: WorkspaceQuickPickItem[] = [];
    if (currentEditorWorkspace) {
      picks.push({
        label: `$(folder-active) ${currentEditorWorkspace.workspacePath}`,
        description: "Current VS Code workspace",
        detail: current.workspacePath === currentEditorWorkspace.workspacePath
          ? "Already selected"
          : "Use the currently opened VS Code workspace",
        workspace: currentEditorWorkspace,
        action: "current",
      });
    }

    picks.push(...merged.map((item) => ({
      label: item.workspacePath || item.instanceName,
      description: item.status ? `status: ${item.status}` : undefined,
      detail: item.workspacePath === current.workspacePath
        ? "Currently selected"
        : undefined,
      workspace: item,
    })));

    picks.push(
      {
        label: "$(add) New Workspace...",
        detail: "Create a new via workspace preset and select it",
        action: "new",
      },
      {
        label: "$(gear) Configure Current Workspace...",
        detail: current.workspacePath
          ? `Edit ${current.workspacePath}`
          : "Set the current via workspace",
        action: "configure",
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

    if (picked.action === "new") {
      await this.createWorkspace();
      return;
    }

    if (picked.action === "configure") {
      await this.configureWorkspace();
      return;
    }

    const selected = picked.workspace;
    if (!selected) {
      return;
    }

    await this.setCurrentWorkspace(selected);
    void vscode.window.showInformationMessage(`VIA workspace set to ${selected.workspacePath}.`);
  }

  async createWorkspace(): Promise<void> {
    this.assertLinuxHost();
    const created = await this.promptForWorkspaceSelection(this.readWorkspaceSelection(), false);
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
      await this.startWorkspace();
    }
  }

  async startWorkspace(): Promise<void> {
    this.assertLinuxHost();
    const workspace = await this.ensureWorkspaceConfigured();
    if (!workspace) {
      return;
    }

    const alreadyRunning = await this.isWorkspaceRunning(workspace.instanceName);
    if (alreadyRunning) {
      this.output.appendLine(`[skip] via instance "${workspace.instanceName}" is already running.`);
      this.output.show(true);
      void vscode.window.showInformationMessage(`VIA workspace is already running.`);
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Starting VIA workspace ${basename(workspace.workspacePath)}`,
        cancellable: false,
      },
      async () => {
        const result = await this.runVia(
          ["start", "--name", workspace.instanceName, "--workspace", workspace.workspacePath],
          workspace.workspacePath,
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

    const workspace = await this.ensureWorkspaceReady();
    if (!workspace) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Running ${editor.document.fileName.split("/").pop()} via ${workspace.instanceName}`,
        cancellable: false,
      },
      async () => {
        const result = await this.runVia(
          ["send", "--name", workspace.instanceName, "--load", editor.document.fileName],
          workspace.workspacePath,
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

    const workspace = await this.ensureWorkspaceReady();
    if (!workspace) {
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
        title: `Running SKILL code via ${workspace.instanceName}`,
        cancellable: false,
      },
      async () => {
        this.output.appendLine("[eval] source:");
        this.output.appendLine(source);
        const result = shouldUseEvalMode(source)
          ? await this.runSelectionAsEval(workspace, source)
          : await this.runSelectionAsTempFile(workspace, source);
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

  private async ensureWorkspaceReady(): Promise<ViaWorkspace | undefined> {
    const workspace = await this.ensureWorkspaceConfigured();
    if (!workspace) {
      return undefined;
    }

    if (await this.isWorkspaceRunning(workspace.instanceName)) {
      return workspace;
    }

    if (this.getAutoStartWorkspace()) {
      await this.startWorkspace();
      return workspace;
    }

    const choice = await vscode.window.showWarningMessage(
      `The selected VIA workspace is not running.`,
      "Start Workspace",
    );

    if (choice !== "Start Workspace") {
      return undefined;
    }

    await this.startWorkspace();
    return workspace;
  }

  private async ensureWorkspaceConfigured(): Promise<ViaWorkspace | undefined> {
    let workspace = this.readWorkspaceSelection();
    if (workspace.instanceName && workspace.workspacePath) {
      return workspace;
    }

    await this.selectWorkspace();
    workspace = this.readWorkspaceSelection();
    if (workspace.instanceName && workspace.workspacePath) {
      return workspace;
    }

    return undefined;
  }

  private readWorkspaceSelection(): ViaWorkspace {
    return {
      instanceName: this.context.workspaceState.get<string>(WORKSPACE_INSTANCE_NAME_KEY, "").trim(),
      workspacePath: this.context.workspaceState.get<string>(WORKSPACE_PATH_KEY, "").trim(),
    };
  }

  private readKnownWorkspaces(): ViaWorkspace[] {
    const stored = this.context.workspaceState.get<ViaWorkspace[]>(KNOWN_WORKSPACES_STATE_KEY, []);
    const legacyStored = this.context.workspaceState.get<ViaWorkspace[]>(LEGACY_KNOWN_WORKSPACES_STATE_KEY, []);
    const fromConfig = this.getConfig<ViaWorkspace[]>("knownWorkspaces") || [];
    const legacyConfig = this.getConfig<ViaWorkspace[]>("knownKernels") || [];
    // Keep reading legacy keys so existing user settings continue to work.
    return dedupeWorkspaces([...stored, ...legacyStored, ...fromConfig, ...legacyConfig]);
  }

  private async setCurrentWorkspace(workspace: ViaWorkspace): Promise<void> {
    const normalized = {
      instanceName: workspace.instanceName.trim(),
      workspacePath: workspace.workspacePath.trim(),
    };

    await this.context.workspaceState.update(WORKSPACE_INSTANCE_NAME_KEY, normalized.instanceName);
    await this.context.workspaceState.update(WORKSPACE_PATH_KEY, normalized.workspacePath);
    await this.context.workspaceState.update(
      KNOWN_WORKSPACES_STATE_KEY,
      dedupeWorkspaces([normalized, ...this.readKnownWorkspaces()]),
    );
    this.updateStatusBar();
  }

  private async promptForWorkspaceSelection(
    current: ViaWorkspace,
    forceInstancePrompt: boolean,
  ): Promise<ViaWorkspace | undefined> {
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
    const instanceName = await this.resolveInstanceName(current, selectedWorkspacePath, forceInstancePrompt);

    if (!instanceName) {
      return undefined;
    }

    const workspace = {
      instanceName: instanceName.trim(),
      workspacePath: selectedWorkspacePath,
    };
    await this.setCurrentWorkspace(workspace);
    void vscode.window.showInformationMessage(`VIA workspace set to ${workspace.workspacePath}.`);
    return workspace;
  }

  private async resolveInstanceName(
    current: ViaWorkspace,
    workspacePath: string,
    forcePrompt: boolean,
  ): Promise<string | undefined> {
    const defaultName = current.instanceName
      || this.getConfig<string>("defaultInstanceName")
      || inferInstanceNameFromWorkspace(workspacePath);

    if (!forcePrompt) {
      return defaultName;
    }

    const mode = await vscode.window.showQuickPick(
      [
        {
          label: "Use Default Internal Name",
          detail: defaultName,
        },
        {
          label: "Customize Internal Name",
          detail: "Only needed when you want to override via's internal instance naming",
        },
      ],
      {
        title: "Workspace Advanced Settings",
        ignoreFocusOut: true,
      },
    );

    if (!mode) {
      return undefined;
    }

    if (mode.label === "Use Default Internal Name") {
      return defaultName;
    }

    return vscode.window.showInputBox({
      title: "VIA Instance Name",
      prompt: "Internal via instance name",
      value: defaultName,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim().length === 0 ? "Instance name is required." : undefined),
    });
  }

  private updateStatusBar(): void {
    const workspace = this.readWorkspaceSelection();
    if (!workspace.instanceName || !workspace.workspacePath) {
      this.statusBar.text = "$(folder-library) Select Workspace";
      this.statusBar.tooltip = "Choose or create a via workspace.";
      this.statusBar.show();
      return;
    }

    this.statusBar.text = `$(folder-library) ${basename(workspace.workspacePath)} $(chevron-down)`;
    this.statusBar.tooltip = `Workspace: ${workspace.workspacePath}\nInstance: ${workspace.instanceName}`;
    this.statusBar.show();
  }

  private async listWorkspaces(): Promise<ListedWorkspace[]> {
    try {
      const result = await this.runVia(["list"]);
      return parseListedWorkspaces(result.stdout);
    } catch (error) {
      this.output.appendLine(`[warn] failed to inspect via list: ${toErrorMessage(error)}`);
      return [];
    }
  }

  private async isWorkspaceRunning(instanceName: string): Promise<boolean> {
    try {
      const workspaces = await this.listWorkspaces();
      return workspaces.some((workspace) => workspace.instanceName === instanceName && /running/i.test(workspace.status || ""));
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

  private async runSelectionAsEval(
    workspace: ViaWorkspace,
    source: string,
  ): Promise<ViaCommandResult> {
    this.output.appendLine("[selection-mode] eval");
    return this.runVia(
      ["send", "--name", workspace.instanceName, "--eval", source],
      workspace.workspacePath,
    );
  }

  private async runSelectionAsTempFile(
    workspace: ViaWorkspace,
    source: string,
  ): Promise<ViaCommandResult> {
    const tempDir = await mkdtemp(join(tmpdir(), "via-runner-"));
    const tempFile = join(tempDir, "selection.il");

    try {
      await writeFile(tempFile, `${source}\n`, "utf8");
      this.output.appendLine("[selection-mode] load-temp-file");
      this.output.appendLine(`[selection-file] ${tempFile}`);
      return await this.runVia(
        ["send", "--name", workspace.instanceName, "--load", tempFile],
        workspace.workspacePath,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
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

  private getAutoStartWorkspace(): boolean {
    const preferred = vscode.workspace.getConfiguration("via").get<boolean>("autoStartWorkspace");
    if (typeof preferred === "boolean") {
      return preferred;
    }

    // Fall back to the old setting name for compatibility.
    return this.getConfig<boolean>("autoStartKernel");
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

function shouldUseEvalMode(source: string): boolean {
  if (source.includes("\n")) {
    return false;
  }

  return source.length > 0 && source.length <= 400;
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

function dedupeWorkspaces(workspaces: ViaWorkspace[]): ViaWorkspace[] {
  const byName = new Map<string, ViaWorkspace>();

  for (const workspace of workspaces) {
    const instanceName = workspace.instanceName.trim();
    if (!instanceName) {
      continue;
    }

    const previous = byName.get(instanceName);
    byName.set(instanceName, {
      instanceName,
      workspacePath: workspace.workspacePath.trim() || previous?.workspacePath || "",
    });
  }

  return [...byName.values()];
}

function dedupeListedWorkspaces(
  current: ViaWorkspace,
  running: ListedWorkspace[],
  known: ViaWorkspace[],
): ListedWorkspace[] {
  const merged = new Map<string, ListedWorkspace>();

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

function parseListedWorkspaces(stdout: string): ListedWorkspace[] {
  const workspaces = new Map<string, ListedWorkspace>();
  let currentName = "";

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("NAME ")) {
      continue;
    }

    const summaryMatch = line.match(/^(\S+)\s+\d+\s+(\S+)\s+(\S+)$/);
    if (summaryMatch) {
      currentName = summaryMatch[1];
      workspaces.set(currentName, {
        instanceName: currentName,
        workspacePath: workspaces.get(currentName)?.workspacePath || "",
        status: summaryMatch[2],
      });
      continue;
    }

    const bracketWorkspaceMatch = line.match(/^\[(.+?)\]\s+workspace\s*:\s*(.+)$/);
    if (bracketWorkspaceMatch) {
      const name = bracketWorkspaceMatch[1];
      const existing = workspaces.get(name) || {
        instanceName: name,
        workspacePath: "",
      };
      workspaces.set(name, {
        ...existing,
        workspacePath: bracketWorkspaceMatch[2].trim(),
      });
      currentName = name;
      continue;
    }

    if (currentName && line.startsWith("workspace :")) {
      const existing = workspaces.get(currentName);
      if (existing) {
        existing.workspacePath = line.replace(/^workspace\s*:\s*/, "").trim();
      }
    }
  }

  return [...workspaces.values()];
}

function stripCodiconPrefix(label: string): string {
  return label.replace(/^\$\([^)]+\)\s*/, "");
}

function getCurrentWorkspacePath(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
}

function getCurrentWorkspaceSelection(): ViaWorkspace | undefined {
  const workspacePath = getCurrentWorkspacePath();
  if (!workspacePath) {
    return undefined;
  }

  return {
    workspacePath,
    instanceName: inferInstanceNameFromWorkspace(workspacePath),
  };
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
