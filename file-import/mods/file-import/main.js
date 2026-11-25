// File import: opens the system file picker, then pastes the selected paths into
// the focused terminal at its prompt, quoted and space-separated, ready to use.
// Opened as a small dialog by a tab bar button (see RECIPE.md for the snippet).
// Accepts any file type — video, PDF, text, images, everything the OS picker shows.
// Role "pick" (props { role: "pick" }) is used while the system picker is open:
// a dialog's tasks end when it closes, so the dialog stays up until the picker
// resolves, then closes itself. With no focused terminal, it closes silently.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { pickFiles, hc, panes, props, closeOverlay, theme } from "herdr";

export default class FileImport extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async () => {
      try {
        const files = await pickFiles({ prompt: "Import files", multiple: true });
        if (files?.length) {
          const terminal = panes().find(p => p.focused && p.terminal)?.terminal;
          if (terminal) {
            await hc(["send", terminal, files.map(f => `"${f}"`).join(" ")]);
          }
        }
      } catch {}
      closeOverlay(props()?.overlay);
    });
  }

  render() {
    const t = theme();
    return v_flex()
      .id("file-import")
      .track_focus(this.handle)
      .size_full()
      .p(18)
      .gap(8)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        closeOverlay(props()?.overlay);
        cx.stop_propagation();
      })
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .child(svg("mods/file-import/import.svg").size(15).flex_none().text_color(t.muted))
          .child(div().flex_1().text_size(15).font_semibold().child("Import files"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .child(div().text_color(t.muted).child("Choose one or more files in the window that just opened. Their paths will be pasted into your focused terminal."))
      .child(div().flex_1())
      .child(
        h_flex().justify_end().child(
          div()
            .id("fi-cancel")
            .h(30)
            .px(14)
            .flex()
            .items_center()
            .rounded(8)
            .border_1()
            .border_color(t.input)
            .bg(t.raised)
            .text_size(12.5)
            .font_medium()
            .cursor_pointer()
            .hover(s => s.opacity(0.88))
            .on_click(() => closeOverlay(props()?.overlay))
            .child("Cancel"),
        ),
      );
  }
}
