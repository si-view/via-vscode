# VIA Runner

VIA Runner is a VS Code extension for running Virtuoso SKILL `.il` files and paragraphs through the [`via`](https://github.com/si-view/via.git) CLI.

## Features

- Run the current `.il` file with `via send --load`.
- Run the current selection first, or the paragraph around the cursor when nothing is selected. Short single-line snippets use `via send --eval`; multi-line or complex code is written to a temporary `.il` file and executed with `via send --load`.
- Start the backing Virtuoso process with `via start`.
- Select or create workspaces from the status bar dropdown.
- Configure and persist a `via` workspace path per VS Code workspace, while keeping the underlying instance name mostly implicit.
- Offer a one-click entry for the currently opened VS Code workspace.
- Show execution commands and returned output in the native `VIA Runner` output channel.
- Stay inside native VS Code UI using the command palette, icon-based editor title actions, CodeLens, notifications, output, and status bar.

## Requirements

- The extension host must run on Linux.
- `via` must already be installed and available in `PATH`, or configured with `via.commandPath`.
- VS Code `1.85.0` or newer.

This works well with Remote SSH or other remote Linux extension hosts when the local machine is Windows.

## Usage

1. Open a workspace on a Linux host.
2. Open any `.il` file.
3. Run `VIA: Configure Workspace` and choose the Virtuoso workspace path used by `via start --workspace`.
4. Use one of the built-in commands:
   - click the status bar workspace selector to choose the current VS Code workspace, an existing workspace, or create a new one
   - `VIA: Start Workspace`
   - `VIA: Run Current File`
   - `VIA: Run Selection or Paragraph`

The default workspace path is the currently opened VS Code workspace root when available.
When configuring a workspace, the internal `via` instance name now stays on a secondary advanced step and can usually be left at its default.
When `via.autoStartWorkspace` is enabled, file or paragraph execution starts `via` automatically if needed.
Each execution also reveals the `VIA Runner` output channel so the returned command output is visible immediately.
Selection execution reports whether it used direct `eval` mode or a temporary file, and when a temporary file is used its path is shown in the output channel.

## Settings

- `via.commandPath`: path to the `via` executable
- `via.defaultWorkspace`: default Virtuoso workspace path
- `via.defaultInstanceName`: default internal `via` instance name
- `via.knownWorkspaces`: optional preset workspace list for the selector
- `via.autoStartWorkspace`: auto-start via before running code

Older `via.knownKernels`, `via.autoStartKernel`, `via.configureSession`, and `via.startKernel` names are still accepted for compatibility.

## Development

```bash
npm install
npm run build
```
