import * as vscode from "vscode";

export function activate(_context: vscode.ExtensionContext): void {
  void vscode.window.showInformationMessage("VIA Runner activated.");
}

export function deactivate(): void {}
