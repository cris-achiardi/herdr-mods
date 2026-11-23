// sidebar-plus (cris-achiardi, 2026): an agent row's right-click menu, opened as a
// pointer popup of this mod with props { view: "agent-menu", terminal, tab }.
// Stop ends the agent's terminal; Rename opens Herdr's rename for the agent's tab,
// the name its row shows. ↑/↓ move, Enter runs, Esc closes.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme } from "herdr";
import { TEXT, SIZE, Icon } from "./ui.js";

export function agentMenuItems({ terminal, tab, pane }) {
  return [
    { label: "Stop", icon: "stop", act: () => run("terminal.kill", { terminal }) },
    {
      label: "Rename",
      icon: "square-pen",
      // Herdr's inline rename edits the shown tab: show the agent first.
      act: () => {
        if (pane) run("pane.focus", { pane });
        run("tab.rename", { id: tab });
      },
      hidden: !tab,
    },
  ].filter((it) => !it.hidden);
}

export class AgentMenu {
  init(_given, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i) {
    const it = agentMenuItems(props() ?? {})[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    it.act();
  }

  render() {
    const t = theme();
    const list = agentMenuItems(props() ?? {});
    return v_flex()
      .id("agent-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(TEXT.menu)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          h_flex()
            .id(`am-${i}`)
            .h(SIZE.menu)
            .flex_none()
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .cursor_pointer()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click(() => this.choose(i))
            .child(Icon(it.icon, 14).text_color(t.muted))
            .child(div().flex_1().child(it.label)),
        ),
      );
  }
}

