# SKILL Runner

[English](./README.md) | [简体中文](./README.zh-CN.md)

Run Cadence SKILL from VS Code through [`via`](https://github.com/si-view/via).

SKILL Runner lets you load `.il` files, execute selected SKILL code, work in an interactive SKILL panel, and manage Virtuoso workspaces without leaving VS Code.

## Features

- Run the active `.il` file from the editor title, CodeLens, context menu, or command palette.
- Execute the current selection, or the paragraph around the cursor when there is no selection.
- Open an interactive SKILL panel for repeated snippet execution.
- Select, create, start, refresh, and inspect VIA workspaces from the status bar.
- View running Virtuoso sessions in the VIA activity bar.
- Auto-start the selected workspace before running code.
- Configure DISPLAY handling for local X11, forwarded X11, or headless execution.
- Use the bundled Linux `via` binary, or point the extension to a custom executable.

## Requirements

- VS Code `1.85.0` or later.
- A Linux VS Code extension host.
- A working Cadence Virtuoso environment on that Linux host.

Windows and macOS are supported as local desktops when VS Code is connected to a Linux remote host, such as Remote SSH, Dev Containers, or another remote extension host.

## Getting Started

1. Open a folder or workspace on a Linux host.
2. Open a SKILL file with the `.il` extension.
3. Run `VIA: Configure Workspace`.
4. Select the Virtuoso workspace directory.
5. Choose how DISPLAY should be passed to `via`.
6. Run `VIA: Start Workspace`, `VIA: Run Current File`, or `VIA: Run Selection or Paragraph`.

The VIA status bar item shows the current connection state. Click it to refresh status, switch workspace, start the workspace, or open status details.

## Demos

### Workspace Setup

![Select and start a VIA workspace](./media/VIAWorkSpace.gif)

### Run Paragraph

![Run the current SKILL paragraph](./media/RunningParagraph.gif)

## Commands

| Command | Description |
| --- | --- |
| `VIA: Configure Workspace` | Select the Virtuoso workspace path and configure DISPLAY handling. |
| `VIA: Select Workspace` | Switch to a current, known, or running workspace. |
| `VIA: New Workspace` | Create and select a new workspace preset. |
| `VIA: Start Workspace` | Start the selected workspace. |
| `VIA: Refresh Connection Status` | Check whether the selected workspace is running. |
| `VIA: Show Status Details` | Show workspace, instance, DISPLAY, auto-start, and recent command details. |
| `VIA: Run Current File` | Run the active `.il` file in the selected workspace. |
| `VIA: Run Selection or Paragraph` | Execute the current selection or inferred paragraph. |
| `VIA: Open Interactive SKILL` | Focus the interactive SKILL panel. |
| `VIA: Run Interactive SKILL` | Run the current interactive panel source. |
| `VIA: Clear Interactive SKILL` | Clear the interactive panel source. |
| `VIA: Refresh Sessions` | Refresh the VIA sessions view. |
| `VIA: Select Session` | Select a session from the sessions view. |
| `VIA: Kill Session` | Kill a selected VIA session. |

Legacy command names such as `VIA: Start Kernel` and `VIA: Configure Session` remain available for compatibility.

## Extension Settings

This extension contributes the following settings:

| Setting | Default | Description |
| --- | --- | --- |
| `via.commandPath` | `""` | Path to a custom `via` executable. Leave empty to use the bundled binary. |
| `via.language` | `auto` | Runtime UI language. `auto` follows the VS Code display language. |
| `via.defaultWorkspace` | `""` | Default Virtuoso workspace path shown during configuration. |
| `via.defaultInstanceName` | `vscode` | Default internal VIA instance name. |
| `via.displayMode` | `inherit` | How DISPLAY is passed to `via`: `inherit`, `custom`, or `unset`. |
| `via.displayValue` | `""` | DISPLAY value used when `via.displayMode` is `custom`. |
| `via.environmentScript` | `""` | Shell script sourced before running `via`, useful for Virtuoso, license, and other environment variables. |
| `via.environmentScriptShell` | `auto` | Shell used to source `via.environmentScript`: `auto`, `bash`, `sh`, `zsh`, `csh`, or `tcsh`. `auto` uses the user's default shell. |
| `via.knownWorkspaces` | `[]` | Optional workspace presets shown in the workspace selector. |
| `via.autoStartWorkspace` | `true` | Start VIA automatically before running code when the selected workspace is not running. |
| `via.loadOnSave` | `false` | Automatically run saved `.il` files. |

Deprecated settings are still read for compatibility:

- `via.knownKernels`
- `via.autoStartKernel`
- `via.useDisplay`

## DISPLAY Modes

SKILL Runner supports three DISPLAY modes:

- `inherit`: keep the extension host `DISPLAY` environment variable.
- `custom`: set DISPLAY to `via.displayValue`, for example `:0` or `localhost:10.0`.
- `unset`: remove DISPLAY from the `via` command environment.

Use `VIA: Configure Workspace` to choose the mode from VS Code.

If `via.displayMode` is `inherit` but neither the extension host environment nor `via.displayValue` provides DISPLAY, SKILL Runner runs `via` without DISPLAY by default. Starting a workspace without DISPLAY automatically adds `--nograph` to `via start`.

## Environment Script

Set `via.environmentScript` to a shell script that exports environment variables required by Virtuoso before `via` starts.

Bash-style example:

```json
{
  "via.environmentScript": "/path/to/virtuoso-env.sh",
  "via.environmentScriptShell": "bash"
}
```

```bash
export CDS_LIC_FILE=5280@license-server
export PATH=/path/to/cadence/bin:$PATH
```

C shell-style example:

```json
{
  "via.environmentScript": "/path/to/virtuoso-env.csh",
  "via.environmentScriptShell": "csh"
}
```

```csh
setenv CDS_LIC_FILE 5280@license-server
setenv PATH /path/to/cadence/bin:${PATH}
```

When `via.environmentScriptShell` is `auto`, SKILL Runner uses the user's default `SHELL`. It loads `~/.bashrc` for bash, `~/.zshrc` for zsh, and `~/.cshrc` for csh/tcsh before sourcing `via.environmentScript`.

## Known Issues

- The extension host must run on Linux. A local Windows or macOS window needs a Linux remote host.
- If the bundled `via` binary is not available in a development build, run `npm run build` or set `via.commandPath`.
- If Virtuoso cannot connect to a display, check `via.displayMode`, `via.displayValue`, and the remote host `DISPLAY` environment.

## Release Notes

### 0.0.1

Initial release of SKILL Runner for running SKILL files, selections, and interactive snippets from VS Code.

## Development

Install dependencies:

```bash
npm install
```

Build the extension:

```bash
npm run build
```

Generate a `.vsix` package:

```bash
npm run package
```

Packaging downloads and bundles Linux `x64` and `arm64` `via` binaries under `bin/linux-x64/` and `bin/linux-arm64/`.

Run TypeScript checks:

```bash
npm run lint
```

`npm run build` downloads the latest Linux `via` release and installs it under `bin/<platform>-<arch>/via` before TypeScript compilation.

For offline TypeScript-only builds:

```bash
VIA_SKIP_DOWNLOAD=1 npm run build
```

## WeChat

Follow the WeChat official account "芯上视图" for updates:

![芯上视图 WeChat QR code](./media/qrcode.jpg)

## Repository

- VIA CLI: <https://github.com/si-view/via>
- Extension source: <https://github.com/si-view/via-vscode>
- Issues: <https://github.com/si-view/via-vscode/issues>

## License

MIT
