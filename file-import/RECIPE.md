# File Import

A file-import button in the tab bar: opens the system file picker; pastes the selected paths into the focused terminal, quoted and space-separated.

![File Import](preview.png)

## What you see

**The button**: in the tab bar, after the Workspace link (if installed) and immediately before the `+` (new tab) button. A 16px document-with-plus icon (`mods/file-import/import.svg`) in `dim`; on hover `hover` background and `foreground` icon.

**No dialog**: the overlay is invisible (a 0×0 div) while the OS picker is open. Nothing appears in the Herdr window.

**After confirming**: a toast — "File path copied / Ctrl+V to paste into your terminal." The overlay closes immediately.

## How it behaves

- Clicking the button opens an invisible overlay, which immediately calls `pickFiles { multiple: true }` in `init`.
- When the person confirms: paths are copied to the clipboard (quoted, space-separated) via `powershell Set-Clipboard`, a toast fires, and the overlay closes. Nothing is sent to any terminal — the person pastes with Ctrl+V when they're ready.
- When the person cancels the picker: the overlay closes and the clipboard is untouched.

## Built from

- `mods/file-import/`: `main.js` and `mod.json` `{ "place": "none", "title": "Import files" }`. Nothing docks by itself.
- `herdr` functions: `pickFiles`, `exec`, `notify`, `props`, `closeOverlay`, `checking`. `gpui-kit`: `View`, `div`.
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
- Paths with `"` in their name will break the quoting. This is a known limit.
- The clipboard write uses `powershell Set-Clipboard`. On macOS use `pbcopy`; on Linux use `xclip` or `wl-copy`. The current code is Windows-only.
- `herdr-app check` loads the mod with no props; it passes without a tab bar wired. Use `checking()` guard in `init` to skip side effects during checks.
- Built and used on Windows with Herdr 0.1.15. Untested on macOS and Linux.

## Done when

- `herdr-app check` passes for `mods/file-import` and for each tab bar mod that was edited; `herdr-app status` shows no errors.
- Clicking the button opens the OS file picker immediately — no Herdr dialog appears.
- Confirming one or more files shows a toast and copies the quoted paths to the clipboard; nothing is sent to any terminal.
- Pressing Cancel or closing the picker without choosing leaves the clipboard untouched.
