# File Import

A file-import button in the tab bar: opens the system file picker; pastes the selected paths into the focused terminal, quoted and space-separated.

![File Import](preview.png)

## What you see

**The button**: in the tab bar, after the Workspace link (if installed) and immediately before the `+` (new tab) button. A 16px document-with-plus icon (`mods/file-import/import.svg`) in `dim`; on hover `hover` background and `foreground` icon.

**No dialog**: the overlay is invisible (a 0×0 div) while the OS picker is open. Nothing appears in the Herdr window.

**After confirming**: the quoted path appears in the focused terminal at the current prompt, exactly as if the file had been dragged onto it. No Enter, no submission. The overlay closes.

## How it behaves

- Clicking the button opens an invisible overlay, which immediately calls `pickFiles { multiple: true }` in `init`.
- When the person confirms:
  1. `exec powershell` sets the Windows clipboard to a `StringCollection` file drop list via `System.Windows.Forms.Clipboard.SetFileDropList` (the same format Explorer's Copy uses).
  2. `pane.focus { terminal }` refocuses the terminal that was focused before the picker opened.
  3. `terminal.paste` pastes the clipboard files "as if dropped" — Herdr inserts the quoted path, with no Enter pressed.
  4. The overlay closes.
- When the person cancels the picker: the overlay closes, the clipboard is untouched, and nothing is inserted.

## Built from

- `mods/file-import/`: `main.js` and `mod.json` `{ "place": "none", "title": "Import files" }`. Nothing docks by itself.
- `herdr` functions: `pickFiles`, `panes`, `exec`, `run`, `props`, `closeOverlay`, `checking`. `gpui-kit`: `View`, `div`.
- Commands: `pane.focus`, `terminal.paste`.
- Opened by the tab bar button, not by this mod.

**Wiring the button.** Shipped mods and layouts are read-only and restored on every start. If the person's layout or tab bar mod is shipped, clone it (`mod.clone`, `layout.clone`) and edit the clone. If they already have their own tab bar mod, add the button there.

In a tab bar mod based on Herdr's `tabs` (0.1.15), insert after the Workspace link (or directly before `tab-new` if Workspace is not installed):

```js
// File import: opens the system picker; paths land in the focused terminal.
.child(button("tab-import", svg("mods/file-import/import.svg").size(14),
  () => openOverlay({ mod: "file-import", kind: "dialog", width: 340, height: 148 })))
```

(`button` is the tab bar's existing helper: `(id, label, action) => div().id(id).size(26)…on_click(action).child(label)`.)

## Watch out

- Copying the folder alone shows nothing. The install is not done until clicking the button opens the picker.
- The overlay size (340×148) is set by the tab bar button's `openOverlay` call, not by this mod. With a 0×0 render the size is irrelevant but the call still needs those numbers so the overlay has a valid frame while `pickFiles` is running.
- Quoting is done by `terminal.paste` itself (it treats the clipboard file drop list "as if dropped"), so the mod never builds the path string. File names with `"` paste correctly; the previous `hc send` quoting limit is gone.
- `terminal.paste` takes no args — pasting the clipboard requires the target terminal to be the focused pane. The mod calls `pane.focus { terminal }` first against the terminal captured from `panes()`.
- The clipboard write uses `powershell` + `System.Windows.Forms.Clipboard.SetFileDropList`. `-STA` is required: WinForms clipboard calls need a single-threaded apartment. On macOS/Linux this won't work; a different clipboard strategy is needed.
- `herdr-app check` loads the mod with no props; it passes without a tab bar wired. Use `checking()` guard in `init` to skip side effects during checks.
- Built and used on Windows with Herdr 0.1.15. Untested on macOS and Linux.

## Done when

- `herdr-app check` passes for `mods/file-import` and for each tab bar mod that was edited; `herdr-app status` shows no errors.
- Clicking the button opens the OS file picker immediately — no Herdr dialog appears.
- Confirming one or more files inserts the quoted path into the focused terminal at the current prompt, with no Enter pressed and no agent response triggered.
- Pressing Cancel or closing the picker without choosing leaves the terminal untouched.
