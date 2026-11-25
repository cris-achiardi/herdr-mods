# File Import

A file-import button in the tab bar: click it, choose one or more files in the system picker, and their paths land in your focused terminal at the prompt — quoted and space-separated, ready to pass to any command.

![File Import](preview.png)

## What it does

- **The button** sits in the tab bar immediately after the **Workspace** link (if installed) and before the **+** new-tab button. It shows a 14px document-with-plus icon in `dim`, hovering to `foreground` with a `hover` background.
- Clicking it opens the OS file picker immediately — no dialog appears while you choose.
- Select one or more files — any type: video, PDF, text, image, anything the OS picker shows — and confirm. Their absolute paths are copied to the clipboard, quoted and space-separated, and a toast confirms "File path copied".
- Press **Ctrl+V** in your terminal to paste the paths whenever you're ready. Nothing is sent automatically, so you can write your message first and submit on your own terms.
- If you close the picker without choosing, the clipboard is untouched and nothing happens.

## Install

Ask your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/juancodez/herdr-mods/tree/main/file-import

It follows [RECIPE.md](RECIPE.md). Installation has two parts:

1. Copy `mods/file-import/` into `~/.config/herdr-app/mods/`.
2. Add the import button to the tab bar of each layout that should have it.

## What it runs

- `pickFiles` with `{ multiple: true }` for the system file picker.
- `exec powershell Set-Clipboard` to copy the paths to the clipboard.
- `notify` to show the confirmation toast.
- No network, no writes to disk, nothing sent to any terminal.

## Limits

- Requires PowerShell (`powershell`) on PATH for the clipboard write. On macOS/Linux the clipboard step will silently fail (use the macOS/Linux clipboard variant instead).
- Paths are quoted with double quotes. File names containing `"` will break the quoting — rename them first.
- Built and used on Windows with Herdr 0.1.15. Untested on macOS and Linux.
