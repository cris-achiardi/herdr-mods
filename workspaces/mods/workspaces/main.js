// Workspaces: a popup listing the layouts in layouts/ (Herdr's demo layouts left
// out), the shown one ticked. Choosing one runs layout.switch. Opened by the tab
// bar's "Workspace" link with openOverlay({ mod: "workspaces", kind: "popup", ... }).
// Each layout places its own set of mods, so switching layouts switches mods.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, layouts, shared } from "herdr";

// Herdr's shipped demo layouts. "main" stays: it is Herdr's default screen.
const HIDDEN = new Set(["terminals", "win98"]);
const LABELS = { main: "Herdr default", clean: "Herdr clean" };

// Rows are ROW px and the list has PAD px around it: the opener sizes the popup
// as 2 * PAD + rows * ROW, since a mod can't import another mod's code.
const ROW = 31;
const PAD = 5;
const workspaces = () => layouts().filter((name) => !HIDDEN.has(name));

export default class Workspaces extends View {
  init(_props, cx) {
    const list = workspaces();
    this.at = Math.max(0, list.indexOf(shared("layout")));
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(name) {
    closeOverlay(props()?.overlay);
    if (name && name !== shared("layout")) run("layout.switch", { name });
  }

  render() {
    const t = theme();
    const list = workspaces();
    const current = shared("layout");
    return v_flex()
      .id("workspaces")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(PAD)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(list[this.at]);
        else if (e.key === "escape") closeOverlay(props()?.overlay);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .when(list.length === 0, (el) => el.child(h_flex().h(ROW).px(8).items_center().text_color(t.dim).child("No layouts")))
      .children(
        list.map((name, i) =>
          h_flex()
            .id(`ws-${i}`)
            .h(ROW)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .cursor_pointer()
            .text_color(name === current ? t.foreground : t.muted)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click(() => this.choose(name))
            .child(div().flex_1().truncate().child(LABELS[name] ?? name))
            .when(name === current, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.accent))),
        ),
      );
  }
}
