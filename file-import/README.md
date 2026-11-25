# File Import

A file-import button in the tab bar: click it, choose one or more files in the system picker, and their paths land in your focused terminal at the prompt — quoted and space-separated, ready to pass to any command.

![File Import](preview.png)

## What it does

- **The button** sits in the tab bar immediately after the **Workspace** link (if installed) and before the **+** new-tab button. It shows a 14px document-with-plus icon in `dim`, hovering to `foreground` with a `hover` background.
- Clicking it opens a small dialog and immediately shows the OS file picker. The dialog stays on screen while you choose.
- Select one or more files — any type: video, PDF, text, image, anything the OS picker shows — and confirm. The dialog closes and their absolute paths are pasted into the focused terminal at its current prompt, each quoted and separated by a space.
- If you press **Esc** or **Cancel**, or close the picker without choosing, the dialog closes and nothing is sent.
- If no terminal is focused when you confirm, the paths are silently dropped.

## Install

Ask your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/juancodez/herdr-mods/tree/main/file-import

It follows [RECIPE.md](RECIPE.md). Installation has two parts:

1. Copy `mods/file-import/` into `~/.config/herdr-app/mods/`.
2. Add the import button to the tab bar of each layout that should have it.

## What it runs

- `pickFiles` with `{ multiple: true }` for the system file picker.
- `hc ["send", terminal, paths]` to paste the result.
- No network, no shell commands, no writes to disk.

## Limits

- Requires a focused terminal pane when files are confirmed. If the focus moves between clicking and confirming, the paths are silently dropped.
- Paths are quoted with double quotes. File names containing `"` will break the quoting — rename them first.
- Built and used on Windows with Herdr 0.1.15. Untested on macOS and Linux.
