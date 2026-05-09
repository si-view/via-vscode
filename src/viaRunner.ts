import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { EOL } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { t } from "./i18n";

const execFileAsync = promisify(execFile);

type ViaCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type ViaRunOptions = {
  revealInTerminal?: boolean;
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

type ActionQuickPickItem<T extends string> = vscode.QuickPickItem & {
  action: T;
};

type DisplayQuickPickItem = ActionQuickPickItem<DisplayMode>;
type StartDecisionItem = ActionQuickPickItem<"start-now" | "only-select">;
type InstanceNameModeItem = ActionQuickPickItem<"default" | "custom">;

type DisplayMode = "inherit" | "custom" | "unset";
type ConnectionState = "unconfigured" | "checking" | "running" | "stopped" | "error";

const WORKSPACE_INSTANCE_NAME_KEY = "via.instanceName";
const WORKSPACE_PATH_KEY = "via.workspacePath";
const KNOWN_WORKSPACES_STATE_KEY = "via.knownWorkspaces";
const LEGACY_KNOWN_WORKSPACES_STATE_KEY = "via.knownKernels";
const STATUS_BAR_ID = "via.status";

export class ViaRunner implements vscode.Disposable {
  private readonly statusBar = vscode.window.createStatusBarItem(STATUS_BAR_ID, vscode.StatusBarAlignment.Right, 10_000);
  private activeExecutionTerminal: vscode.Terminal | undefined;
  private connectionState: ConnectionState = "unconfigured";
  private connectionDetail = "";
  private lastCommandSummary = "none";
  private lastSelectionMode = "none";
  private knownRunningState = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.statusBar.name = t("statusBar.name");
    this.statusBar.command = "via.showStatusMenu";
    this.statusBar.accessibilityInformation = {
      label: t("accessibility.statusLabel"),
      role: "button",
    };
    this.context.subscriptions.push(this.statusBar);
    this.context.subscriptions.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        if (terminal === this.activeExecutionTerminal) {
          this.activeExecutionTerminal = undefined;
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.renderStatusBar()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.renderStatusBar()),
      vscode.window.onDidChangeWindowState(() => this.renderStatusBar()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("via")) {
          this.statusBar.name = t("statusBar.name");
          this.statusBar.accessibilityInformation = {
            label: t("accessibility.statusLabel"),
            role: "button",
          };
          void this.refreshConnectionState();
          return;
        }

        this.renderStatusBar();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.renderStatusBar()),
    );
    this.updateStatusBar();
    void this.restoreWorkspaceSession();
  }

  dispose(): void {
    this.activeExecutionTerminal?.dispose();
    this.statusBar.dispose();
  }

  async showStatusMenu(): Promise<void> {
    const picked = await vscode.window.showQuickPick<ActionQuickPickItem<"details" | "refresh" | "select" | "start" | "configure">>(
      [
        {
          label: t("status.menu.details.label"),
          detail: t("status.menu.details.detail"),
          action: "details",
        },
        {
          label: t("status.menu.refresh.label"),
          detail: t("status.menu.refresh.detail"),
          action: "refresh",
        },
        {
          label: t("status.menu.select.label"),
          detail: t("status.menu.select.detail"),
          action: "select",
        },
        {
          label: t("status.menu.start.label"),
          detail: t("status.menu.start.detail"),
          action: "start",
        },
        {
          label: t("status.menu.configure.label"),
          detail: t("status.menu.configure.detail"),
          action: "configure",
        },
      ],
      {
        title: t("status.menu.title"),
        ignoreFocusOut: true,
      },
    );

    if (!picked) {
      return;
    }

    if (picked.action === "details") {
      await this.showStatusDetails();
      return;
    }

    if (picked.action === "refresh") {
      await this.refreshConnectionStatus();
      return;
    }

    if (picked.action === "select") {
      await this.selectWorkspace();
      return;
    }

    if (picked.action === "start") {
      await this.startWorkspace();
      return;
    }

    if (picked.action === "configure") {
      await this.configureWorkspace();
    }
  }

  async showStatusDetails(): Promise<void> {
    const workspace = this.readWorkspaceSelection();
    const displayMode = this.getDisplayMode();
    const displayValue = displayMode === "custom"
      ? (this.getConfig<string>("displayValue") || "<unset>")
      : (process.env.DISPLAY || "<unset>");
    const statusLabel = connectionStateLabel(this.connectionState);
    const items: vscode.QuickPickItem[] = [
      {
        label: t("label.workspace"),
        detail: workspace.workspacePath || t("label.notConfigured"),
      },
      {
        label: t("label.instance"),
        detail: workspace.instanceName || t("label.notConfigured"),
      },
      {
        label: t("label.connection"),
        detail: this.connectionDetail ? `${statusLabel} (${this.connectionDetail})` : statusLabel,
      },
      {
        label: t("label.display"),
        detail: `${displayMode}: ${displayValue}`,
      },
      {
        label: t("label.autoStart"),
        detail: this.getAutoStartWorkspace() ? t("label.enabled") : t("label.disabled"),
      },
      {
        label: t("label.lastCommand"),
        detail: this.lastCommandSummary,
      },
      {
        label: t("label.lastSelectionMode"),
        detail: this.getLocalizedSelectionMode(),
      },
    ];

    await vscode.window.showQuickPick(items, {
      title: t("title.statusDetails"),
      ignoreFocusOut: true,
      canPickMany: false,
      placeHolder: t("prompt.readOnlyDiagnostics"),
    });
  }

  async configureWorkspace(): Promise<void> {
    this.assertLinuxHost();
    await this.promptForWorkspaceSelection(this.readWorkspaceSelection(), true, true);
  }

  async selectWorkspace(): Promise<void> {
    this.assertLinuxHost();

    const current = this.readWorkspaceSelection();
    const known = this.readKnownWorkspaces();
    const merged = dedupeListedWorkspaces(current, [], known);
    const currentEditorWorkspace = getCurrentWorkspaceSelection();

    const picks: WorkspaceQuickPickItem[] = [];
    if (currentEditorWorkspace) {
      picks.push({
        label: `$(folder-active) ${currentEditorWorkspace.workspacePath}`,
        description: t("option.selectCurrentWorkspace"),
        detail: current.workspacePath === currentEditorWorkspace.workspacePath
          ? t("label.alreadySelected")
          : t("option.useCurrentWorkspace"),
        workspace: currentEditorWorkspace,
        action: "current",
      });
    }

    picks.push(...merged.map((item) => ({
      label: item.workspacePath || item.instanceName,
      description: item.status ? `${t("label.statusPrefix")}: ${item.status}` : undefined,
      detail: item.workspacePath === current.workspacePath
        ? t("label.alreadySelected")
        : undefined,
      workspace: item,
    })));

    picks.push(
      {
        label: `$(add) ${t("option.newWorkspace")}`,
        detail: t("option.workspacePresetDetail"),
        action: "new",
      },
      {
        label: `$(gear) ${t("option.configureCurrentWorkspace")}`,
        detail: current.workspacePath
          ? t("label.editPath", { path: current.workspacePath })
          : t("status.menu.configure.detail"),
        action: "configure",
      },
    );

    const picked = await vscode.window.showQuickPick(picks, {
      title: t("title.workspaceSelector"),
      placeHolder: t("prompt.selectWorkspace"),
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
    await this.refreshConnectionState(true);
    void vscode.window.showInformationMessage(t("info.workspaceSet", { path: selected.workspacePath }));
  }

  async createWorkspace(): Promise<void> {
    this.assertLinuxHost();
    const created = await this.promptForWorkspaceSelection(this.readWorkspaceSelection(), false, false);
    if (!created) {
      return;
    }

    const action = await vscode.window.showQuickPick<StartDecisionItem>(
      [
        {
          label: t("option.startNow"),
          detail: `Run via start for ${created.workspacePath}`,
          action: "start-now",
        },
        {
          label: t("option.onlySelect"),
          detail: t("option.onlySelectDetail"),
          action: "only-select",
        },
      ],
      {
        title: t("title.workspaceCreated"),
        ignoreFocusOut: true,
      },
    );

    if (action?.action === "start-now") {
      await this.startWorkspace();
      return;
    }

    this.connectionState = "stopped";
    this.connectionDetail = t("label.disconnected");
    this.knownRunningState = false;
    this.updateStatusBar();
  }

  async startWorkspace(): Promise<void> {
    this.assertLinuxHost();
    const workspace = await this.ensureWorkspaceConfigured();
    if (!workspace) {
      return;
    }

    const alreadyRunning = this.knownRunningState;
    if (alreadyRunning) {
      this.connectionState = "running";
      this.connectionDetail = t("info.workspaceAlreadyRunning");
      this.updateStatusBar();
      void vscode.window.showInformationMessage(t("info.workspaceAlreadyRunning"));
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t("progress.startWorkspace", { name: basename(workspace.workspacePath) }),
        cancellable: false,
      },
      async () => {
        const result = await this.runVia(
          ["start", "--name", workspace.instanceName, "--workspace", workspace.workspacePath],
          workspace.workspacePath,
          { revealInTerminal: true },
        );
      },
    );

    this.knownRunningState = true;
    this.connectionState = "running";
    this.connectionDetail = t("label.connected");
    this.updateStatusBar();
    void vscode.window.showInformationMessage(t("info.workspaceStarted"));
  }

  async runFile(uri?: vscode.Uri): Promise<void> {
    this.assertLinuxHost();
    const editor = this.requireEditor(uri);
    if (!editor) {
      return;
    }

    if (!this.isSkillDocument(editor.document)) {
      void vscode.window.showErrorMessage(t("error.onlyIlFiles"));
      return;
    }

    if (editor.document.isUntitled) {
      void vscode.window.showErrorMessage(t("error.saveBeforeRun"));
      return;
    }

    if (editor.document.isDirty) {
      const saved = await editor.document.save();
      if (!saved) {
        void vscode.window.showErrorMessage(t("error.mustSaveFile"));
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
        title: t("progress.runFile", {
          name: editor.document.fileName.split("/").pop() || editor.document.fileName,
          instance: workspace.instanceName,
        }),
        cancellable: false,
      },
      async () => {
        const result = await this.runVia(
          ["send", "--name", workspace.instanceName, "--load", editor.document.fileName],
          workspace.workspacePath,
          { revealInTerminal: true },
        );
      },
    );

    this.connectionState = this.knownRunningState ? "running" : this.connectionState;
    this.connectionDetail = this.knownRunningState ? t("label.connected") : this.connectionDetail;
    this.updateStatusBar();
    void vscode.window.showInformationMessage(t("info.workspaceLoaded", { path: editor.document.fileName }));
  }

  async runSelection(range?: vscode.Range): Promise<void> {
    this.assertLinuxHost();
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.isSkillDocument(editor.document)) {
      void vscode.window.showErrorMessage(t("error.openIlEditor"));
      return;
    }

    const workspace = await this.ensureWorkspaceReady();
    if (!workspace) {
      return;
    }

    const executionRange = resolveExecutionRange(editor.document, range, editor.selection);
    const source = normalizeEvalSource(editor.document.getText(executionRange));
    if (source.length === 0) {
      void vscode.window.showWarningMessage(t("message.noSkillCode"));
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t("progress.runSelection", { instance: workspace.instanceName }),
        cancellable: false,
      },
      async () => {
        const result = shouldUseEvalMode(source)
          ? await this.runSelectionAsEval(workspace, source)
          : await this.runSelectionAsTempFile(workspace, source);
        const response = parseJson(result.stdout);
        if (response?.ok === false) {
          throw new Error(response.reason || "via send returned an error.");
        }
      },
    );

    this.connectionState = this.knownRunningState ? "running" : this.connectionState;
    this.connectionDetail = this.knownRunningState ? t("label.connected") : this.connectionDetail;
    this.updateStatusBar();
    void vscode.window.showInformationMessage(t("info.selectionExecuted"));
  }

  private assertLinuxHost(): void {
    if (process.platform !== "linux") {
      throw new Error(t("error.linuxOnly"));
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

    if (this.knownRunningState) {
      return workspace;
    }

    if (this.getAutoStartWorkspace()) {
      await this.startWorkspace();
      return workspace;
    }

    const choice = await vscode.window.showWarningMessage(
      t("message.workspaceNotRunning"),
      t("option.startWorkspace"),
    );

    if (choice !== t("option.startWorkspace")) {
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
    this.knownRunningState = false;
    this.connectionState = "stopped";
    this.connectionDetail = "";
    this.updateStatusBar();
  }

  private async promptForWorkspaceSelection(
    current: ViaWorkspace,
    forceInstancePrompt: boolean,
    configureDisplay: boolean,
  ): Promise<ViaWorkspace | undefined> {
    const defaultWorkspace = current.workspacePath || this.getConfig<string>("defaultWorkspace") || getCurrentWorkspacePath();
    const defaultUri = defaultWorkspace ? vscode.Uri.file(defaultWorkspace) : undefined;
    const picked = await vscode.window.showOpenDialog({
      title: t("title.workspacePicker"),
      defaultUri,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: t("label.workspace"),
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
    if (configureDisplay) {
      await this.configureDisplaySettings();
    }
    void vscode.window.showInformationMessage(t("info.workspaceSet", { path: workspace.workspacePath }));
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

    const mode = await vscode.window.showQuickPick<InstanceNameModeItem>(
      [
        {
          label: t("option.useDefaultInternalName"),
          detail: defaultName,
          action: "default",
        },
        {
          label: t("option.customizeInternalName"),
          detail: t("option.workspaceInstanceOverrideDetail"),
          action: "custom",
        },
      ],
      {
        title: t("title.workspaceAdvancedSettings"),
        ignoreFocusOut: true,
      },
    );

    if (!mode) {
      return undefined;
    }

    if (mode.action === "default") {
      return defaultName;
    }

    return vscode.window.showInputBox({
      title: t("title.instanceName"),
      prompt: t("prompt.instanceName"),
      value: defaultName,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim().length === 0 ? t("error.instanceNameRequired") : undefined),
    });
  }

  private updateStatusBar(): void {
    const workspace = this.readWorkspaceSelection();
    if (!workspace.instanceName || !workspace.workspacePath) {
      this.statusBar.text = `$(circle-large-outline) VIA ${t("label.unconfigured")}`;
      this.statusBar.tooltip = t("status.tooltip.unconfigured");
      this.renderStatusBar();
      return;
    }

    const icon = connectionStateIcon(this.connectionState);
    const label = connectionStateLabel(this.connectionState);
    this.statusBar.text = `${icon} VIA ${label}`;
    this.statusBar.tooltip = [
      `${t("label.workspace")}: ${workspace.workspacePath}`,
      `${t("label.instance")}: ${workspace.instanceName}`,
      `${t("label.status")}: ${label}`,
      this.connectionDetail ? `${t("label.detail")}: ${this.connectionDetail}` : "",
      t("label.clickToSwitchWorkspace"),
    ].filter(Boolean).join("\n");
    this.renderStatusBar();
  }

  private renderStatusBar(): void {
    this.statusBar.show();
  }

  private async runVia(
    args: string[],
    cwd?: string,
    options: ViaRunOptions = { revealInTerminal: false },
  ): Promise<ViaCommandResult> {
    return this.runViaWithOptions(args, cwd, options);
  }

  private async runViaWithOptions(
    args: string[],
    cwd: string | undefined,
    options: ViaRunOptions,
  ): Promise<ViaCommandResult> {
    const commandPath = this.getConfig<string>("commandPath") || "via";
    this.lastCommandSummary = `${commandPath} ${args.join(" ")}`;
    const env = this.buildViaEnv();
    const terminal = options.revealInTerminal ? this.createExecutionTerminal(cwd, env) : undefined;
    const shellQuotedCommand = terminal ? formatShellCommand(commandPath, args) : "";

    try {
      terminal?.writeLine(`$ ${shellQuotedCommand}`);
      const result = await execFileAsync(commandPath, args, {
        cwd,
        env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 8,
      });

      if (terminal) {
        this.writeTerminalOutput(terminal, result.stdout, result.stderr);
        terminal.writeLine("");
        terminal.writeLine("[exit 0]");
        terminal.markComplete();
      }
      this.knownRunningState = true;
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: 0,
      };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & Partial<ViaCommandResult>;
      const stdout = failure.stdout || "";
      const stderr = failure.stderr || "";
      const exitCode = typeof failure.code === "number" ? failure.code : 1;
      const alreadyRunning = args[0] === "start" && isAlreadyRunningMessage(stderr, stdout);
      if (terminal) {
        this.writeTerminalOutput(terminal, stdout, stderr);
        terminal.writeLine("");
        terminal.writeLine(`[exit ${alreadyRunning ? 0 : exitCode}]`);
        terminal.markComplete();
      }
      if (alreadyRunning) {
        this.knownRunningState = true;
        return {
          stdout,
          stderr,
          exitCode: 0,
        };
      }
      if (args[0] === "send" || args[0] === "start") {
        this.knownRunningState = false;
        this.connectionState = "error";
        this.connectionDetail = toErrorMessage(error);
        this.updateStatusBar();
      }
      throw new Error(`via command failed: ${toErrorMessage(error)}`);
    }
  }

  private async runSelectionAsEval(
    workspace: ViaWorkspace,
    source: string,
  ): Promise<ViaCommandResult> {
    this.lastSelectionMode = "eval";
    return this.runViaWithOptions(
      ["send", "--name", workspace.instanceName, "--eval", source],
      workspace.workspacePath,
      { revealInTerminal: true },
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
      this.lastSelectionMode = "load-temp-file";
      return await this.runViaWithOptions(
        ["send", "--name", workspace.instanceName, "--load", tempFile],
        workspace.workspacePath,
        { revealInTerminal: true },
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private createExecutionTerminal(cwd: string | undefined, env: NodeJS.ProcessEnv): TerminalSession {
    this.activeExecutionTerminal?.dispose();

    const session = new TerminalSession("VIA Runner", cwd, env);
    const terminal = vscode.window.createTerminal({
      name: "VIA Runner",
      location: vscode.TerminalLocation.Panel,
      pty: session,
    });
    this.activeExecutionTerminal = terminal;
    terminal.show(false);
    return session;
  }

  private writeTerminalOutput(terminal: TerminalSession, stdout: string, stderr: string): void {
    if (stdout.trim().length > 0) {
      terminal.write(stdout);
    }

    if (stderr.trim().length > 0) {
      terminal.write(stderr);
    }
  }

  private getAutoStartWorkspace(): boolean {
    const preferred = vscode.workspace.getConfiguration("via").get<boolean>("autoStartWorkspace");
    if (typeof preferred === "boolean") {
      return preferred;
    }

    // Fall back to the old setting name for compatibility.
    return this.getConfig<boolean>("autoStartKernel");
  }

  private async restoreWorkspaceSession(): Promise<void> {
    const currentEditorWorkspace = getCurrentWorkspaceSelection();
    const rememberedWorkspace = this.readWorkspaceSelection();
    const runningWorkspaces = await this.listWorkspacesSilently();

    const currentMatch = currentEditorWorkspace
      ? findMatchingRunningWorkspace(currentEditorWorkspace, runningWorkspaces)
      : undefined;
    if (currentMatch) {
      await this.setCurrentWorkspace(currentMatch);
      this.applyConnectionState(true, currentMatch.status || t("label.connected"));
      return;
    }

    const rememberedMatch = rememberedWorkspace.instanceName || rememberedWorkspace.workspacePath
      ? findMatchingRunningWorkspace(rememberedWorkspace, runningWorkspaces)
      : undefined;
    if (rememberedMatch) {
      await this.setCurrentWorkspace(rememberedMatch);
      this.applyConnectionState(true, rememberedMatch.status || t("label.connected"));
      return;
    }

    if (rememberedWorkspace.instanceName || rememberedWorkspace.workspacePath) {
      this.applyConnectionState(false, t("label.disconnected"));
      return;
    }

    if (currentEditorWorkspace) {
      await this.setCurrentWorkspace(currentEditorWorkspace);
      this.applyConnectionState(false, t("label.disconnected"));
      return;
    }

    this.connectionState = "unconfigured";
    this.connectionDetail = "";
    this.knownRunningState = false;
    this.updateStatusBar();
  }

  private async refreshConnectionState(probe = false): Promise<void> {
    const workspace = this.readWorkspaceSelection();
    if (!workspace.instanceName || !workspace.workspacePath) {
      this.connectionState = "unconfigured";
      this.connectionDetail = "";
      this.knownRunningState = false;
      this.updateStatusBar();
      return;
    }

    if (!probe) {
      this.applyConnectionState(this.knownRunningState, this.knownRunningState ? t("label.connected") : t("label.disconnected"));
      return;
    }

    const runningWorkspaces = await this.listWorkspacesSilently();
    const matched = findMatchingRunningWorkspace(workspace, runningWorkspaces);
    this.applyConnectionState(Boolean(matched), matched?.status || (matched ? t("label.connected") : t("label.disconnected")));
  }

  async refreshConnectionStatus(): Promise<void> {
    await this.refreshConnectionState(true);
    void vscode.window.showInformationMessage(t("info.connectionStatusRefreshed"));
  }

  private async configureDisplaySettings(): Promise<void> {
    const currentMode = this.getDisplayMode();
    const currentValue = (this.getConfig<string>("displayValue") || "").trim();
    const picked = await vscode.window.showQuickPick<DisplayQuickPickItem>(
      [
        {
          label: t("display.inherit"),
          description: currentMode === "inherit" ? t("display.current") : undefined,
          detail: t("display.inheritDetail", { value: process.env.DISPLAY || "<unset>" }),
          action: "inherit",
        },
        {
          label: t("display.custom"),
          description: currentMode === "custom" ? t("display.current") : undefined,
          detail: currentValue ? t("display.customValue", { value: currentValue }) : "Set a DISPLAY such as :0 or localhost:10.0",
          action: "custom",
        },
        {
          label: t("display.unset"),
          description: currentMode === "unset" ? t("display.current") : undefined,
          detail: t("display.unsetDetail"),
          action: "unset",
        },
      ],
      {
        title: t("title.workspaceDisplayMode"),
        ignoreFocusOut: true,
      },
    );

    if (!picked) {
      return;
    }

    await this.updateWorkspaceSetting("displayMode", picked.action);

    if (picked.action === "custom") {
      const value = await vscode.window.showInputBox({
        title: t("display.customTitle"),
        prompt: t("display.customPrompt"),
        value: currentValue,
        ignoreFocusOut: true,
        validateInput: (input) => (input.trim().length === 0 ? t("display.customRequired") : undefined),
      });

      if (!value) {
        return;
      }

      await this.updateWorkspaceSetting("displayValue", value.trim());
      return;
    }

    if (picked.action === "inherit" || picked.action === "unset") {
      await this.updateWorkspaceSetting("displayValue", "");
    }
  }

  private buildViaEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const displayMode = this.getDisplayMode();

    if (displayMode === "unset") {
      delete env.DISPLAY;
      return env;
    }

    if (displayMode === "custom") {
      const displayValue = (this.getConfig<string>("displayValue") || "").trim();
      if (!displayValue) {
        throw new Error(t("error.customDisplayRequired"));
      }

      env.DISPLAY = displayValue;
      return env;
    }

    return env;
  }

  private getDisplayMode(): DisplayMode {
    const configured = this.getConfig<string>("displayMode");
    if (configured === "inherit" || configured === "custom" || configured === "unset") {
      return configured;
    }

    const legacyUseDisplay = vscode.workspace.getConfiguration("via").get<boolean>("useDisplay");
    if (legacyUseDisplay === false) {
      return "unset";
    }

    return "inherit";
  }

  private async updateWorkspaceSetting<T>(key: string, value: T): Promise<void> {
    await vscode.workspace.getConfiguration("via").update(key, value, vscode.ConfigurationTarget.Workspace);
  }

  private getConfig<T>(key: string): T {
    return vscode.workspace.getConfiguration("via").get<T>(key) as T;
  }

  private getLocalizedSelectionMode(): string {
    switch (this.lastSelectionMode) {
      case "eval":
        return t("label.selectionModeEval");
      case "load-temp-file":
        return t("label.selectionModeLoadTempFile");
      default:
        return t("label.selectionModeNone");
    }
  }

  private async listWorkspacesSilently(): Promise<ListedWorkspace[]> {
    try {
      const commandPath = this.getConfig<string>("commandPath") || "via";
      const env = this.buildViaEnv();
      const result = await execFileAsync(commandPath, ["list"], {
        env,
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 8,
      });
      return parseListedWorkspaces(result.stdout);
    } catch {
      return [];
    }
  }

  private applyConnectionState(isRunning: boolean, detail: string): void {
    this.knownRunningState = isRunning;
    this.connectionState = isRunning ? "running" : "stopped";
    this.connectionDetail = detail;
    this.updateStatusBar();
  }
}

class TerminalSession implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();

  readonly onDidWrite: vscode.Event<string> = this.writeEmitter.event;

  constructor(
    private readonly name: string,
    private readonly cwd: string | undefined,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  open(): void {
    const lines = [
      `VIA Runner`,
      this.cwd ? `cwd: ${this.cwd}` : undefined,
      `DISPLAY: ${this.env.DISPLAY || "<unset>"}`,
      "",
    ].filter(Boolean);
    this.write(lines.join(EOL));
    this.write(EOL);
  }

  close(): void {}

  handleInput(): void {}

  write(content: string): void {
    if (!content) {
      return;
    }

    this.writeEmitter.fire(normalizeTerminalText(content));
  }

  writeLine(content: string): void {
    this.write(`${content}${EOL}`);
  }

  markComplete(): void {
    // Keep the terminal visible after the command finishes so the user can inspect output.
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

function findMatchingRunningWorkspace(
  target: ViaWorkspace,
  runningWorkspaces: ListedWorkspace[],
): ListedWorkspace | undefined {
  const normalizedTargetPath = normalizeWorkspacePath(target.workspacePath);
  const normalizedTargetName = target.instanceName.trim();

  const byWorkspacePath = normalizedTargetPath
    ? runningWorkspaces.find((workspace) => normalizeWorkspacePath(workspace.workspacePath) === normalizedTargetPath)
    : undefined;
  if (byWorkspacePath) {
    return byWorkspacePath;
  }

  if (!normalizedTargetName) {
    return undefined;
  }

  return runningWorkspaces.find((workspace) => workspace.instanceName.trim() === normalizedTargetName);
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

function normalizeWorkspacePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function connectionStateIcon(state: ConnectionState): string {
  switch (state) {
    case "running":
      return "$(plug)";
    case "checking":
      return "$(sync~spin)";
    case "stopped":
      return "$(debug-disconnect)";
    case "error":
      return "$(error)";
    case "unconfigured":
    default:
      return "$(circle-large-outline)";
  }
}

function connectionStateLabel(state: ConnectionState): string {
  switch (state) {
    case "running":
      return t("label.connected");
    case "checking":
      return t("label.checking");
    case "stopped":
      return t("label.disconnected");
    case "error":
      return t("label.error");
    case "unconfigured":
    default:
      return t("label.unconfigured");
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isAlreadyRunningMessage(...chunks: string[]): boolean {
  return chunks.some((chunk) => /already running/i.test(chunk));
}

function formatShellCommand(commandPath: string, args: string[]): string {
  return [commandPath, ...args].map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function normalizeTerminalText(content: string): string {
  return content.replace(/\r?\n/g, "\r\n");
}
