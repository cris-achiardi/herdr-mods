// File import: opens the system file picker, puts the picked files in the Windows
// clipboard as a file drop list (the same format Explorer's Copy uses), then lets
// Herdr's terminal.paste insert them into the focused terminal "as if dropped" —
// the quoted path appears in the input, no Enter is pressed, nothing is submitted.
// No dialog is shown while the picker is open; the overlay is a 0×0 invisible div.

import { View, div } from "gpui-kit";
import { pickFiles, panes, props, closeOverlay, run, exec, checking } from "herdr";

export default class FileImport extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (checking()) return;
    cx.spawn(async () => {
      try {
        const files = await pickFiles({ prompt: "Import files", multiple: true });
        if (files?.length) {
          const terminal = panes().find(p => p.focused && p.terminal)?.terminal;
          if (terminal) {
            const adds = files.map(f => `[void]$col.Add(${JSON.stringify(f)})`).join("; ");
            const psScript = `Add-Type -AssemblyName System.Windows.Forms; $col = New-Object System.Collections.Specialized.StringCollection; ${adds}; [System.Windows.Forms.Clipboard]::SetFileDropList($col)`;
            await exec("powershell", ["-NoProfile", "-NonInteractive", "-STA", "-Command", psScript]);
            await run("pane.focus", { terminal });
            await run("terminal.paste");
          }
        }
      } catch {}
      closeOverlay(props()?.overlay);
    });
  }

  render() {
    return div().id("file-import").size(0);
  }
}
