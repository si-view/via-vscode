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

const SESSION_NAME_KEY = "via.instanceName";
const WORKSPACE_PATH_KEY = "via.workspacePath";

export class ViaRunner implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel("VIA Runner");
  private readonly statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  constructor(private readonly context: vscode.ExtensionContext) {
    this.statusBar.command = "via.configureSession";
    this.context.subscriptions.push(this.output, this.statusBar);
    this.updateStatusBar();
  }

  dispose(): void {
    this.statusBar.dispose();
    this.output.dispose();
  }

  async configureSession(): Promise<void> {
    this.assertLinuxHost();

    const current = this.readSession();
    const defaultName = current.instanceName || this.getConfig<string>("defaultInstanceName") || "vscode";
    const instanceName = await vscode.window.showInputBox({
      title: "VIA Instance Name",
      prompt: "Name of the via-managed Virtuoso instance",
      value: defaultName,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim().length === 0 ? "Instance name is required." : undefined),
    });

    if (!instanceName) {
      return;
    }

    const defaultWorkspace = current.workspacePath || this.getConfig<string>("defaultWorkspace");
    const defaultUri = defaultWorkspace ? vscode.Uri.file(defaultWorkspace) : undefined;
    const picked = await vscode.window.showOpenDialog({
      title: "Select Virtuoso Workspace",
      defaultUri,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Use Workspace",
    });

    if (!picked || picked.length === 0) {
      return;
    }

    await this.context.workspaceState.update(SESSION_NAME_KEY, instanceName.trim());
    await this.context.workspaceState.update(WORKSPACE_PATH_KEY, picked[0].fsPath);

    this.updateStatusBar();
    void vscode.window.showInformationMessage(`VIA session set to ${instanceName.trim()}.`);
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
      void vscode.window.showInformationMessage(`VIA kernel "${session.instanceName}" is already running.`);
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Starting VIA kernel "${session.instanceName}"`,
        cancellable: false,
      },
      async () => {
        await this.runVia(
          ["start", "--name", session.instanceName, "--workspace", session.workspacePath],
          session.workspacePath,
        );
      },
    );

    void vscode.window.showInformationMessage(`VIA kernel "${session.instanceName}" started.`);
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
        await this.runVia(
          ["send", "--name", session.instanceName, "--load", editor.document.fileName],
          session.workspacePath,
        );
      },
    );

    void vscode.window.setStatusBarMessage(`VIA loaded ${editor.document.fileName}`, 3000);
  }

  async runSelection(range?: vscode.Range): Promise<void> {
    this.assertLinuxHost();
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.isSkillDocument(editor.document)) {
      void vscode.window.showErrorMessage("Open a .il editor to run a paragraph.");
      return;
    }

    const session = await this.ensureKernelReady();
    if (!session) {
      return;
    }

    const paragraphRange = range ?? inferParagraphRange(editor.document, editor.selection);
    const source = editor.document.getText(paragraphRange).trim();
    if (source.length === 0) {
      void vscode.window.showWarningMessage("No SKILL code found in the current selection or paragraph.");
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Running SKILL paragraph via ${session.instanceName}`,
        cancellable: false,
      },
      async () => {
        const result = await this.runVia(
          ["send", "--name", session.instanceName, "--eval", source],
          session.workspacePath,
        );
        const response = parseJson(result.stdout);
        if (response?.ok === false) {
          throw new Error(response.reason || "via send returned an error.");
        }
      },
    );

    void vscode.window.setStatusBarMessage("VIA paragraph executed.", 3000);
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
      `VIA kernel "${session.instanceName}" is not running.`,
      "Start Kernel",
    );

    if (choice !== "Start Kernel") {
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

    await this.configureSession();
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

  private updateStatusBar(): void {
    const session = this.readSession();
    if (!session.instanceName || !session.workspacePath) {
      this.statusBar.text = "$(debug-disconnect) VIA: Configure";
      this.statusBar.tooltip = "Configure the via instance name and Virtuoso workspace.";
      this.statusBar.show();
      return;
    }

    this.statusBar.text = `$(radio-tower) VIA: ${session.instanceName}`;
    this.statusBar.tooltip = `Workspace: ${session.workspacePath}`;
    this.statusBar.show();
  }

  private async isKernelRunning(instanceName: string): Promise<boolean> {
    try {
      const result = await this.runVia(["list"]);
      const line = result.stdout
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith(instanceName));

      return Boolean(line && /\brunning\b/i.test(line));
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

  private getConfig<T>(key: string): T {
    return vscode.workspace.getConfiguration("via").get<T>(key) as T;
  }
}

function inferParagraphRange(document: vscode.TextDocument, selection: vscode.Selection): vscode.Range {
  if (!selection.isEmpty) {
    return new vscode.Range(selection.start, selection.end);
  }

  const activeLine = selection.active.line;
  let startLine = activeLine;
  let endLine = activeLine;

  while (startLine > 0 && document.lineAt(startLine - 1).text.trim().length > 0) {
    startLine -= 1;
  }

  while (endLine < document.lineCount - 1 && document.lineAt(endLine + 1).text.trim().length > 0) {
    endLine += 1;
  }

  return new vscode.Range(
    new vscode.Position(startLine, 0),
    document.lineAt(endLine).range.end,
  );
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
