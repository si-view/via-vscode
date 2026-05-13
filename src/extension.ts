import * as vscode from "vscode";
import { ViaCodeLensProvider } from "./viaCodeLensProvider";
import { ViaInteractiveViewProvider } from "./viaInteractiveViewProvider";
import { ViaRunner } from "./viaRunner";
import { ViaSessionTreeItem, ViaSessionViewProvider } from "./viaSessionViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  let runner = new ViaRunner(context);
  let codeLensProvider = new ViaCodeLensProvider();
  const interactiveViewProvider = new ViaInteractiveViewProvider(context.extensionUri, runner);
  const sessionViewProvider = new ViaSessionViewProvider(runner);
  let codeLensDisposable = vscode.languages.registerCodeLensProvider(
    [{ language: "skill", scheme: "file" }],
    codeLensProvider,
  );

  context.subscriptions.push(
    runner,
    codeLensDisposable,
    vscode.window.registerWebviewViewProvider(
      ViaInteractiveViewProvider.viewType,
      interactiveViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerTreeDataProvider("via.sessionsView", sessionViewProvider),
    vscode.commands.registerCommand("via.configureWorkspace", () => runner.configureWorkspace()),
    vscode.commands.registerCommand("via.configureSession", () => runner.configureWorkspace()),
    vscode.commands.registerCommand("via.selectWorkspace", () => runner.selectWorkspace()),
    vscode.commands.registerCommand("via.createWorkspace", () => runner.createWorkspace()),
    vscode.commands.registerCommand("via.showStatusMenu", () => runner.showStatusMenu()),
    vscode.commands.registerCommand("via.showStatusDetails", () => runner.showStatusDetails()),
    vscode.commands.registerCommand("via.refreshConnectionStatus", () => runner.refreshConnectionStatus()),
    vscode.commands.registerCommand("via.refreshSessions", async () => {
      await runner.refreshConnectionStatusSilently();
      sessionViewProvider.refresh();
    }),
    vscode.commands.registerCommand("via.selectSession", async (itemOrSession?: ViaSessionTreeItem | unknown) => {
      const session = itemOrSession instanceof ViaSessionTreeItem ? itemOrSession.session : itemOrSession;
      if (session && typeof session === "object" && "instanceName" in session) {
        await runner.selectSession(session as { instanceName: string; workspacePath: string });
        sessionViewProvider.refresh();
      }
    }),
    vscode.commands.registerCommand("via.killSession", async (item?: ViaSessionTreeItem) => {
      if (item?.session) {
        await runner.killSession(item.session);
        sessionViewProvider.refresh();
      }
    }),
    vscode.commands.registerCommand("via.startWorkspaceFromSessions", async () => {
      await runner.startWorkspace(false);
      await runner.refreshConnectionStatusSilently();
      sessionViewProvider.refresh();
    }),
    vscode.commands.registerCommand("via.startWorkspace", () => runner.startWorkspace()),
    vscode.commands.registerCommand("via.startKernel", () => runner.startWorkspace()),
    vscode.commands.registerCommand("via.runFile", (uri?: vscode.Uri) => runner.runFile(uri)),
    vscode.commands.registerCommand("via.runSelection", (argument?: unknown) =>
      runner.runSelection(argument instanceof vscode.Range ? argument : undefined),
    ),
    vscode.commands.registerCommand("via.focusInteractiveView", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.viaPanel");
      await vscode.commands.executeCommand("via.interactiveView.focus");
      await interactiveViewProvider.focus();
    }),
    vscode.commands.registerCommand("via.runInteractiveSkill", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.viaPanel");
      await interactiveViewProvider.runCurrentSource();
      await interactiveViewProvider.focus();
    }),
    vscode.commands.registerCommand("via.clearInteractiveSkill", async () => {
      await interactiveViewProvider.clear();
      await interactiveViewProvider.focus();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("via.language")) {
        return;
      }

      codeLensDisposable.dispose();
      codeLensProvider = new ViaCodeLensProvider();
      codeLensDisposable = vscode.languages.registerCodeLensProvider(
        [{ language: "skill", scheme: "file" }],
        codeLensProvider,
      );
      context.subscriptions.push(codeLensDisposable);
      void vscode.commands.executeCommand("editor.action.codeLensRefresh");
    }),
  );
}

export function deactivate(): void {}
