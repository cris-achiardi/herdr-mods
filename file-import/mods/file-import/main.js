// File import: opens the system file picker, copies the selected paths to the
// clipboard (quoted and space-separated), and shows a toast.
// No dialog is shown while the picker is open — the overlay is invisible.
// Paste with Ctrl+V into your terminal when ready; nothing is sent automatically.

import { View, div } from "gpui-kit";
import { pickFiles, props, closeOverlay, notify, exec, checking } from "herdr";

export default class FileImport extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (checking()) return;
    cx.spawn(async () => {
      try {
        const files = await pickFiles({ prompt: "Import files", multiple: true });
        if (files?.length) {
          const text = files.map(f => `"${f}"`).join(" ");
          await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Set-Clipboard -Value ${JSON.stringify(text)}`]);
          notify({ title: "File path copied", body: "Ctrl+V to paste into your terminal.", timeout: 3000 });
        }
      } catch {}
      closeOverlay(props()?.overlay);
    });
  }

  render() {
    return div().id("file-import").size(0);
  }
}
