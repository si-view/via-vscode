import * as vscode from "vscode";
import { t } from "./i18n";
import { ViaRunner } from "./viaRunner";

type OutputLine = {
  kind: "info" | "success" | "error";
  text: string;
};

export class ViaInteractiveViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "via.interactiveView";

  private view: vscode.WebviewView | undefined;
  private currentSource = "";
  private readonly outputLines: OutputLine[] = [];

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
    webviewView.webview.options = { enableScripts: true };
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
        this.outputLines.length = 0;
        await this.render();
      }
    });
  }

  private async runCurrentSource(): Promise<void> {
    const source = this.currentSource.trim();
    if (!source) {
      this.pushLine("error", t("interactive.empty"));
      await this.render();
      return;
    }

    try {
      const result = await this.runner.runInteractiveSkill(source);
      if (typeof result.ok === "boolean") {
        this.pushLine(result.ok ? "success" : "error", `ok: ${String(result.ok)}`);
      }
      if (result.reason) {
        this.pushLine("error", `${t("interactive.reason")}: ${result.reason}`);
      }
      if (result.data !== undefined) {
        this.pushLine("info", `${t("interactive.data")}: ${formatValue(result.data)}`);
      }
    } catch (error) {
      this.pushLine("error", error instanceof Error ? error.message : String(error));
    }

    await this.render();
  }

  private pushLine(kind: OutputLine["kind"], text: string): void {
    this.outputLines.push({ kind, text });
    if (this.outputLines.length > 200) {
      this.outputLines.splice(0, this.outputLines.length - 200);
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
      },
      outputLines: this.outputLines,
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
      :root { color-scheme: light dark; }
      body {
        margin: 0;
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
      .line {
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
        font-size: 12px;
        line-height: 1.45;
        padding: 2px 0;
      }
      .info { color: var(--vscode-editor-foreground); }
      .success { color: var(--vscode-terminal-ansiGreen); }
      .error { color: var(--vscode-terminal-ansiRed); }
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

      run.addEventListener('click', () => vscode.postMessage({ type: 'run' }));
      clear.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));

      window.addEventListener('message', (event) => {
        if (event.data?.type !== 'render') {
          return;
        }

        source.value = event.data.source || '';
        outputLabel.textContent = event.data.labels.output;
        renderOutput(event.data);
        outputBody.scrollTop = outputBody.scrollHeight;
      });

      function renderOutput(state) {
        if (!state.outputLines || state.outputLines.length === 0) {
          outputBody.innerHTML = '<div class="empty">' + escapeHtml(state.labels.emptyOutput) + '</div>';
          return;
        }

        outputBody.innerHTML = state.outputLines.map((line) => {
          return '<div class="line ' + line.kind + '">' + escapeHtml(line.text) + '</div>';
        }).join('');
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

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return require("node:util").inspect(value, {
      depth: 2,
      colors: false,
      compact: true,
      breakLength: 80,
      maxArrayLength: 10,
    });
  } catch {
    return String(value);
  }
}
