# VIA Runner

VIA Runner is a VS Code extension for running Virtuoso SKILL `.il` files and paragraphs through the [`via`](https://github.com/si-view/via.git) CLI.

## Features

- Run the current `.il` file with `via send --load`.
- Run the current selection, or the paragraph around the cursor, with `via send --eval`.
- Start the backing Virtuoso kernel with `via start`.
- Configure and persist a `via` instance name plus Virtuoso workspace path per VS Code workspace.
- Stay inside native VS Code UI using the command palette, editor title actions, CodeLens, notifications, and status bar.

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
   - `VIA: Start Kernel`
   - `VIA: Run Current File`
   - `VIA: Run Selection or Paragraph`

When `via.autoStartKernel` is enabled, file or paragraph execution starts the kernel automatically if needed.

## Settings

- `via.commandPath`: path to the `via` executable
- `via.defaultWorkspace`: default Virtuoso workspace path
- `via.defaultInstanceName`: default `via` instance name
- `via.autoStartKernel`: auto-start the kernel before running code

## Development

```bash
npm install
npm run build
```
