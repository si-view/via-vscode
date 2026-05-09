import * as vscode from "vscode";
import { t } from "./i18n";
import { InteractiveRunResult, ViaRunner } from "./viaRunner";

type HistoryEntry = {
  source: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  ok?: boolean;
  reason?: string;
  data?: unknown;
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
        reason: error instanceof Error ? error.message : String(error),
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
      ok: "ok" in result ? result.ok : undefined,
      reason: "reason" in result ? result.reason : undefined,
      data: "data" in result ? result.data : undefined,
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
        output: t("interactive.output"),
        input: t("interactive.input"),
        emptyOutput: t("interactive.emptyOutput"),
        success: t("interactive.success"),
        failure: t("interactive.failure"),
        ok: t("interactive.ok"),
        reason: t("interactive.reason"),
        data: t("interactive.data"),
        stdout: t("interactive.stdout"),
        stderr: t("interactive.stderr"),
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
        margin: 0;
        padding: 0;
        height: 100vh;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        font-family: var(--vscode-font-family);
      }
      .shell {
        height: 100vh;
        display: grid;
        grid-template-rows: 1fr auto;
      }
      .output {
        overflow: auto;
        padding: 12px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      .input {
        padding: 10px;
        display: grid;
        gap: 8px;
        background: var(--vscode-sideBar-background);
      }
      .title {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 10px;
      }
      .entry {
        padding: 10px;
        margin-bottom: 10px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        background: var(--vscode-editor-background);
      }
      .entry.ok {
        border-color: var(--vscode-terminal-ansiGreen);
      }
      .entry.err {
        border-color: var(--vscode-terminal-ansiRed);
      }
      .entry-meta {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 8px;
      }
      .block {
        margin-top: 8px;
      }
      .block-label {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
        font-size: 12px;
        line-height: 1.45;
      }
      textarea {
        width: 100%;
        min-height: 110px;
        resize: vertical;
        border-radius: 6px;
        border: 1px solid var(--vscode-panel-border);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        padding: 10px;
        box-sizing: border-box;
        font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
        font-size: 13px;
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
      .empty {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .highlight {
        color: var(--vscode-terminal-ansiGreen);
      }
      .error {
        color: var(--vscode-terminal-ansiRed);
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="output">
        <div class="title">
          <span>${subtitle}</span>
          <span id="output-label"></span>
        </div>
        <div id="output-body"></div>
      </div>
      <div class="input">
        <textarea id="source" spellcheck="false" placeholder="${placeholder}"></textarea>
        <div class="actions">
          <button class="primary" id="run">${run}</button>
          <button class="secondary" id="clear">${clear}</button>
        </div>
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const source = document.getElementById('source');
      const run = document.getElementById('run');
      const clear = document.getElementById('clear');
      const outputLabel = document.getElementById('output-label');
      const outputBody = document.getElementById('output-body');

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
        outputLabel.textContent = event.data.labels.output;
        renderHistory(event.data);
      });

      function renderHistory(state) {
        if (!state.history || state.history.length === 0) {
          outputBody.innerHTML = '<div class="empty">' + escapeHtml(state.labels.emptyOutput) + '</div>';
          return;
        }

        outputBody.innerHTML = state.history.map((entry) => {
          const ok = entry.ok === true;
          const failed = entry.ok === false || entry.exitCode !== 0 || entry.error;
          const classes = ['entry'];
          if (ok) classes.push('ok');
          if (failed) classes.push('err');

          const blocks = [];
          blocks.push(block(state.labels.input, entry.source));
          if (entry.ok !== undefined) {
            blocks.push(block(state.labels.ok, String(entry.ok), true));
          }
          if (entry.reason) {
            blocks.push(block(state.labels.reason, entry.reason, true));
          }
          if (entry.data !== undefined) {
            blocks.push(block(state.labels.data, JSON.stringify(entry.data, null, 2)));
          }
          if (entry.stdout) {
            blocks.push(block(state.labels.stdout, entry.stdout));
          }
          if (entry.stderr) {
            blocks.push(block(state.labels.stderr, entry.stderr, true));
          }
          if (entry.error) {
            blocks.push(block(state.labels.reason, entry.error, true));
          }

          return '<div class="' + classes.join(' ') + '">'
            + '<div class="entry-meta"><span>' + (ok ? state.labels.success : state.labels.failure) + '</span><span>exit ' + entry.exitCode + '</span><span>' + escapeHtml(entry.timestamp) + '</span></div>'
            + blocks.join('')
            + '</div>';
        }).join('');
      }

      function block(label, content, error) {
        return '<div class="block">'
          + '<div class="block-label' + (error ? ' error' : '') + '">' + escapeHtml(label) + '</div>'
          + '<pre' + (error ? ' class="error"' : '') + '>' + escapeHtml(String(content)) + '</pre>'
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
