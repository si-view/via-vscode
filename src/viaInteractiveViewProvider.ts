import * as vscode from "vscode";
import { t } from "./i18n";
import { InteractiveRunResult, ViaRunner } from "./viaRunner";

type HistoryEntry = {
  source: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
  timestamp: string;
};

export class ViaInteractiveViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "via.interactiveView";

  private view: vscode.WebviewView | undefined;
  private currentSource = "";
  private readonly history: HistoryEntry[] = [];

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
    webviewView.webview.html = this.getHtml();
    void this.render();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "updateSource") {
        this.currentSource = String(message.value || "");
        return;
      }

      if (message?.type === "run") {
        await this.runCurrentSource();
        return;
      }

      if (message?.type === "clear") {
        this.currentSource = "";
        await this.render();
      }
    });
  }

  private async runCurrentSource(): Promise<void> {
    try {
      const result = await this.runner.runInteractiveSkill(this.currentSource);
      this.pushHistory(result);
    } catch (error) {
      this.pushHistory({
        source: this.currentSource,
        stdout: "",
        stderr: "",
        exitCode: 1,
        error: error instanceof Error ? error.message : String(error),
        timestamp: formatTimestamp(),
      });
    }

    await this.render();
  }

  private pushHistory(result: InteractiveRunResult | HistoryEntry): void {
    this.history.unshift({
      source: result.source,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      error: "error" in result ? result.error : undefined,
      timestamp: "timestamp" in result ? result.timestamp : formatTimestamp(),
    });

    if (this.history.length > 50) {
      this.history.length = 50;
    }
  }

  private async render(): Promise<void> {
    if (!this.view) {
      return;
    }

    await this.view.webview.postMessage({
      type: "render",
      source: this.currentSource,
      labels: {
        history: t("interactive.history"),
        emptyHistory: t("interactive.emptyHistory"),
        stdout: t("interactive.stdout"),
        stderr: t("interactive.stderr"),
        error: t("interactive.error"),
      },
      history: this.history,
    });
  }

  private getHtml(): string {
    const nonce = getNonce();
    const title = escapeHtml(t("interactive.title"));
    const subtitle = escapeHtml(t("interactive.subtitle"));
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
        grid-template-rows: auto 180px auto 1fr;
        gap: 8px;
        padding: 10px;
        box-sizing: border-box;
      }
      .title {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .title strong {
        font-size: 13px;
      }
      .title span {
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
      .history {
        overflow: auto;
        border-top: 1px solid var(--vscode-panel-border);
        padding-top: 8px;
      }
      .history-title {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 8px;
      }
      .entry {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        padding: 10px;
        margin-bottom: 8px;
        background: var(--vscode-sideBar-background);
      }
      .entry-header {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
        font-size: 12px;
        line-height: 1.5;
      }
      .section {
        margin-top: 8px;
      }
      .section-label {
        font-size: 11px;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 4px;
      }
      .empty {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .error {
        color: var(--vscode-errorForeground);
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="title">
        <strong>${title}</strong>
        <span>${subtitle}</span>
      </div>
      <textarea id="source" spellcheck="false" placeholder="${placeholder}"></textarea>
      <div class="actions">
        <button class="primary" id="run">${run}</button>
        <button class="secondary" id="clear">${clear}</button>
      </div>
      <div class="history">
        <div class="history-title" id="history-title"></div>
        <div id="history-body"></div>
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const source = document.getElementById('source');
      const run = document.getElementById('run');
      const clear = document.getElementById('clear');
      const historyTitle = document.getElementById('history-title');
      const historyBody = document.getElementById('history-body');

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
        if (event.data?.type !== 'render') {
          return;
        }

        source.value = event.data.source || '';
        historyTitle.textContent = event.data.labels.history;

        if (!event.data.history || event.data.history.length === 0) {
          historyBody.innerHTML = '<div class="empty">' + escapeHtml(event.data.labels.emptyHistory) + '</div>';
          return;
        }

        historyBody.innerHTML = event.data.history.map((entry) => {
          const sections = [];
          sections.push(section('code', entry.source || ''));
          if (entry.stdout) {
            sections.push(section(event.data.labels.stdout, entry.stdout));
          }
          if (entry.stderr) {
            sections.push(section(event.data.labels.stderr, entry.stderr));
          }
          if (entry.error) {
            sections.push(section(event.data.labels.error, entry.error, true));
          }

          return '<div class="entry">'
            + '<div class="entry-header"><span>exit ' + entry.exitCode + '</span><span>' + escapeHtml(entry.timestamp) + '</span></div>'
            + sections.join('')
            + '</div>';
        }).join('');
      });

      function section(label, content, isError) {
        return '<div class="section">'
          + '<div class="section-label' + (isError ? ' error' : '') + '">' + escapeHtml(label) + '</div>'
          + '<pre' + (isError ? ' class="error"' : '') + '>' + escapeHtml(content) + '</pre>'
          + '</div>';
      }

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }
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

function formatTimestamp(): string {
  return new Date().toLocaleTimeString();
}
