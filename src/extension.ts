import * as vscode from "vscode";
import { ViaCodeLensProvider } from "./viaCodeLensProvider";
import { ViaInteractiveViewProvider } from "./viaInteractiveViewProvider";
import { ViaRunner } from "./viaRunner";

export function activate(context: vscode.ExtensionContext): void {
  let runner = new ViaRunner(context);
  let codeLensProvider = new ViaCodeLensProvider();
  const interactiveViewProvider = new ViaInteractiveViewProvider(context.extensionUri, runner);
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
    vscode.commands.registerCommand("via.configureWorkspace", () => runner.configureWorkspace()),
    vscode.commands.registerCommand("via.configureSession", () => runner.configureWorkspace()),
    vscode.commands.registerCommand("via.selectWorkspace", () => runner.selectWorkspace()),
    vscode.commands.registerCommand("via.createWorkspace", () => runner.createWorkspace()),
    vscode.commands.registerCommand("via.showStatusMenu", () => runner.showStatusMenu()),
    vscode.commands.registerCommand("via.showStatusDetails", () => runner.showStatusDetails()),
    vscode.commands.registerCommand("via.refreshConnectionStatus", () => runner.refreshConnectionStatus()),
    vscode.commands.registerCommand("via.startWorkspace", () => runner.startWorkspace()),
    vscode.commands.registerCommand("via.startKernel", () => runner.startWorkspace()),
    vscode.commands.registerCommand("via.runFile", (uri?: vscode.Uri) => runner.runFile(uri)),
    vscode.commands.registerCommand("via.runSelection", (range?: vscode.Range) =>
      runner.runSelection(range),
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
