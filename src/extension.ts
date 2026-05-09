import * as vscode from "vscode";
import { ViaCodeLensProvider } from "./viaCodeLensProvider";
import { ViaRunner } from "./viaRunner";

export function activate(context: vscode.ExtensionContext): void {
  let runner = new ViaRunner(context);
  let codeLensProvider = new ViaCodeLensProvider();
  let codeLensDisposable = vscode.languages.registerCodeLensProvider(
    [{ language: "skill", scheme: "file" }],
    codeLensProvider,
  );

  context.subscriptions.push(
    runner,
    codeLensDisposable,
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
