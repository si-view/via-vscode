# VIA Runner

VIA Runner is a VS Code extension for running Virtuoso SKILL `.il` files and paragraphs through the [`via`](https://github.com/si-view/via.git) CLI.

## Features

- Run the current `.il` file with `via send --load`.
- Run the current selection first, or the paragraph around the cursor when nothing is selected, with `via send --eval`.
- Start the backing Virtuoso kernel with `via start`.
- Select or create kernels from a Jupyter-style status bar dropdown.
- Configure and persist a `via` instance name plus Virtuoso workspace path per VS Code workspace.
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
3. Run `VIA: Configure Session` and choose:
   - the `via` instance name
   - the Virtuoso workspace path used by `via start --workspace`
4. Use one of the built-in commands:
   - click the status bar kernel selector to choose an existing kernel or create a new one
   - `VIA: Start Kernel`
   - `VIA: Run Current File`
   - `VIA: Run Selection or Paragraph`

When `via.autoStartKernel` is enabled, file or paragraph execution starts the kernel automatically if needed.
Each execution also reveals the `VIA Runner` output channel so the returned command output is visible immediately.

## Settings

- `via.commandPath`: path to the `via` executable
- `via.defaultWorkspace`: default Virtuoso workspace path
- `via.defaultInstanceName`: default `via` instance name
- `via.knownKernels`: optional preset kernel list for the selector
- `via.autoStartKernel`: auto-start the kernel before running code

## Development

```bash
npm install
npm run build
```
