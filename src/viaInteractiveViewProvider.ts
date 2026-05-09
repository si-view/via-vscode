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
        await this.clear();
      }
    });
  }

  async runCurrentSource(): Promise<void> {
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

  async clear(): Promise<void> {
    this.currentSource = "";
    this.outputLines.length = 0;
    await this.render();
  }

  async focus(): Promise<void> {
    if (!this.view) {
      return;
    }

    this.view.show?.(true);
    await this.view.webview.postMessage({ type: "focusInput" });
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
    const placeholder = escapeHtml(t("interactive.placeholder"));

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light dark; }
      html, body {
        margin: 0;
        height: 100vh;
      }
      body {
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
        font-size: var(--vscode-editor-font-size, 13px);
      }
      .shell {
        height: 100vh;
        display: grid;
        grid-template-rows: 1fr auto;
      }
      .output {
        overflow: auto;
        padding: 8px 12px;
      }
      .input {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: start;
        gap: 12px;
        padding: 8px 12px;
        border-top: 1px solid var(--vscode-panel-border);
        background: var(--vscode-editor-background);
      }
      .line {
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 12px;
        line-height: 1.45;
        padding: 1px 0;
      }
      .info { color: var(--vscode-editor-foreground); }
      .success { color: var(--vscode-terminal-ansiGreen); }
      .error { color: var(--vscode-terminal-ansiRed); }
      .prompt {
        color: var(--vscode-descriptionForeground);
        line-height: 1.5;
        user-select: none;
      }
      textarea {
        width: 100%;
        min-height: 24px;
        max-height: 160px;
        resize: none;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--vscode-editor-foreground);
        padding: 0;
        box-sizing: border-box;
        font-size: 13px;
        line-height: 1.5;
        overflow: auto;
      }
      .empty {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="output" id="output-body"></div>
      <div class="input">
        <div class="prompt">&gt;</div>
        <textarea id="source" spellcheck="false" placeholder="${placeholder}"></textarea>
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const source = document.getElementById('source');
      const outputBody = document.getElementById('output-body');

      function syncHeight() {
        source.style.height = 'auto';
        source.style.height = Math.min(source.scrollHeight, 160) + 'px';
      }

      source.addEventListener('input', () => {
        syncHeight();
        vscode.postMessage({ type: 'updateSource', value: source.value });
      });

      source.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          vscode.postMessage({ type: 'run' });
        }
      });

      window.addEventListener('message', (event) => {
        if (event.data?.type === 'focusInput') {
          source.focus();
          return;
        }

        if (event.data?.type !== 'render') {
          return;
        }

        source.value = event.data.source || '';
        syncHeight();
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
