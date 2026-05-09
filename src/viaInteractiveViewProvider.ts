import * as vscode from "vscode";
import { t } from "./i18n";
import { ViaRunner } from "./viaRunner";

export class ViaInteractiveViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "via.interactiveView";

  private view: vscode.WebviewView | undefined;
  private currentSource = "";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly runner: ViaRunner,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.title = t("interactive.title");
    webviewView.description = t("interactive.subtitle");
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "updateSource") {
        this.currentSource = String(message.value || "");
        return;
      }

      if (message?.type === "run") {
        await this.runner.runInteractiveSkill(this.currentSource);
        return;
      }

      if (message?.type === "clear") {
        this.currentSource = "";
        webviewView.webview.postMessage({ type: "setSource", value: "" });
      }
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const title = escapeHtml(t("interactive.title"));
    const placeholder = escapeHtml(t("interactive.placeholder"));
    const run = escapeHtml(t("interactive.run"));
    const clear = escapeHtml(t("interactive.clear"));

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        padding: 0;
        margin: 0;
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        background: var(--vscode-editor-background);
      }
      .shell {
        height: 100vh;
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 8px;
        padding: 10px;
        box-sizing: border-box;
      }
      .title {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      textarea {
        width: 100%;
        height: 100%;
        resize: none;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        padding: 10px;
        box-sizing: border-box;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
        font-size: 13px;
        line-height: 1.5;
      }
      .actions {
        display: flex;
        gap: 8px;
      }
      button {
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 4px;
        padding: 6px 12px;
        cursor: pointer;
      }
      .primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="title">${title}</div>
      <textarea id="source" spellcheck="false" placeholder="${placeholder}"></textarea>
      <div class="actions">
        <button class="primary" id="run">${run}</button>
        <button class="secondary" id="clear">${clear}</button>
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const source = document.getElementById('source');
      const run = document.getElementById('run');
      const clear = document.getElementById('clear');

      source.addEventListener('input', () => {
        vscode.postMessage({ type: 'updateSource', value: source.value });
      });

      source.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          vscode.postMessage({ type: 'run' });
        }
      });

      run.addEventListener('click', () => {
        vscode.postMessage({ type: 'run' });
      });

      clear.addEventListener('click', () => {
        vscode.postMessage({ type: 'clear' });
      });

      window.addEventListener('message', (event) => {
        if (event.data?.type === 'setSource') {
          source.value = event.data.value || '';
        }
      });
    </script>
  </body>
</html>`;
  }
}

function getNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
