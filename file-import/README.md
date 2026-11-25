# File Import

A file-import button in the tab bar: click it, choose one or more files in the system picker, and their paths land in your focused terminal at the prompt — quoted and space-separated, ready to pass to any command.

![File Import](preview.png)

## What it does

- **The button** sits in the tab bar immediately after the **Workspace** link (if installed) and before the **+** new-tab button. It shows a 14px document-with-plus icon in `dim`, hovering to `foreground` with a `hover` background.
- Clicking it opens the OS file picker immediately — no dialog appears while you choose.
- Select one or more files — any type: video, PDF, text, image, anything the OS picker shows — and confirm. The quoted path lands in your focused terminal exactly as if you had dragged the file there: no Enter is pressed, no message is sent, no agent is triggered.
- You can now type your message around the path and submit on your own terms.
- If you close the picker without choosing, nothing happens.

## Install

Ask your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/juancodez/herdr-mods/tree/main/file-import

It follows [RECIPE.md](RECIPE.md). Installation has two parts:

1. Copy `mods/file-import/` into `~/.config/herdr-app/mods/`.
2. Add the import button to the tab bar of each layout that should have it.

## What it runs

- `pickFiles` with `{ multiple: true }` for the system file picker.
- `exec powershell` to put the selected files in the Windows clipboard as a file drop list (same format Explorer uses for Copy), via `System.Windows.Forms.Clipboard.SetFileDropList`.
- `pane.focus` on the terminal that was focused when you clicked import, so the paste lands there.
- `terminal.paste` to insert the clipboard files into the terminal "as if dropped" — quoted path, no Enter.
- No network, no writes to disk, no hc send, no automatic submission.

## Limits

- Requires PowerShell (`powershell`) on PATH for the file-drop-list clipboard write. On macOS/Linux this exact approach won't work — you'd need `pbcopy`/`xclip` plus a different paste command.
- Needs a focused terminal pane when the picker closes. If no terminal is focused, nothing happens.
- Built and used on Windows with Herdr 0.1.15. Untested on macOS and Linux.
