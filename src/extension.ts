import * as vscode from "vscode";
import { ViaCodeLensProvider } from "./viaCodeLensProvider";
import { ViaRunner } from "./viaRunner";

export function activate(context: vscode.ExtensionContext): void {
  const runner = new ViaRunner(context);

  context.subscriptions.push(
    runner,
    vscode.languages.registerCodeLensProvider(
      [{ language: "skill", scheme: "file" }],
      new ViaCodeLensProvider(),
    ),
    vscode.commands.registerCommand("via.configureSession", () => runner.configureSession()),
    vscode.commands.registerCommand("via.selectKernel", () => runner.selectKernel()),
    vscode.commands.registerCommand("via.createKernel", () => runner.createKernel()),
    vscode.commands.registerCommand("via.startKernel", () => runner.startKernel()),
    vscode.commands.registerCommand("via.runFile", (uri?: vscode.Uri) => runner.runFile(uri)),
    vscode.commands.registerCommand("via.runSelection", (range?: vscode.Range) =>
      runner.runSelection(range),
    ),
  );
}

export function deactivate(): void {}
