// Mod switches: a dialog with an on/off switch for every mod block in the shown
// layout, grouped Sidebar / Panels / Window. A switch runs layout.toggle {id},
// so it hides the block without uninstalling anything, and the choice stays with
// that layout (each workspace keeps its own). Opened by a key bound to
// mod.open:mod-switches; the same key or Esc closes it.
// Floating mods can't be hidden by id (layout.toggle doesn't reach them), so they
// are named at the bottom instead of given a switch.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, layout, shared, readTextFile, appHome } from "herdr";

const GROUPS = ["Sidebar", "Panels", "Window"];

// Names for the usual block ids of Herdr's layouts and this repo's; anything
// else is its mod's title, or its id made readable.
const NAMES = { brand: "Header", tabs: "Tab bar", status: "Status bar", graph: "Git", github: "GitHub", skills: "Skills", scripts: "Scripts" };

// "sidebar-footer" -> "Sidebar footer"
const pretty = (id) => (id.charAt(0).toUpperCase() + id.slice(1)).replace(/[-_]+/g, " ");

// Every block showing a mod, with the group it belongs to; floating mods apart.
function collect(root) {
  const rows = [], floats = [];
  const walk = (node, group) => {
    if (!node || typeof node !== "object") return;
    const g = node.id === "sidebar" ? "Sidebar" : node.id === "panel-body" ? "Panels" : group;
    for (const f of node.floating ?? []) if (f.content?.mod) floats.push(f.content.mod);
    if (node.type === "block" && node.content?.mod && node.id) rows.push({ id: node.id, mod: node.content.mod, group: g, on: !node.hidden });
    for (const child of node.children ?? []) walk(child, g);
  };
  walk(root, "Window");
  return { rows, floats };
}

export default class ModSwitches extends View {
  init(_props, cx) {
    this.at = 0;
    this.titles = {};
    this.handle = cx.focus_handle();
    this.handle.focus();
    const mods = [...new Set(collect(layout()).rows.map((r) => r.mod))];
    cx.spawn(async (cx) => {
      for (const mod of mods) {
        try {
          const raw = await readTextFile(`${appHome()}/mods/${mod}/mod.json`);
          if (raw) this.titles[mod] = JSON.parse(raw).title;
        } catch {}
      }
      cx.notify();
    });
  }

  // A mod placed once is named by its title; one placed several times (a sidebar
  // mod drawing spaces, agents and a footer) by each block's id.
  label(row, rows) {
    const shared = rows.filter((r) => r.mod === row.mod).length > 1;
    return NAMES[row.id] ?? ((!shared && this.titles[row.mod]) || pretty(row.id));
  }

  flip(row, cx) {
    run("layout.toggle", { id: row.id });
    cx.notify();
  }

  render(cx) {
    const t = theme();
    const { rows, floats } = collect(layout());
    const ordered = GROUPS.flatMap((g) => rows.filter((r) => r.group === g));
    if (this.at >= ordered.length) this.at = Math.max(0, ordered.length - 1);
    const name = shared("layout") === "clean" ? "Herdr clean" : shared("layout") ?? "this layout";

    const toggle = (on) =>
      div().w(28).h(16).flex_none().rounded(8).p(2).flex().items_center()
        .when(on, (el) => el.bg(t.accent).justify_end())
        .when(!on, (el) => el.bg(t.input).justify_start())
        .child(div().size(12).rounded(6).bg(on ? t.accent_foreground : t.muted));

    const row = (r) => {
      const i = ordered.indexOf(r);
      return h_flex().id(`ms-${r.id}`).h(30).flex_none().px(10).gap(10).rounded(7).items_center().cursor_pointer()
        .when(i === this.at, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.at = i; this.flip(r, cx); })
        .child(div().flex_1().min_w(0).truncate().text_color(r.on ? t.foreground : t.muted).child(this.label(r, rows)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(r.mod))
        .child(toggle(r.on));
    };

    return v_flex().id("mod-switches").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground).text_size(12.8)
      .on_key_down((e, cx) => {
        const n = ordered.length;
        if (e.key === "escape") closeOverlay(props()?.overlay);
        else if (!n) return;
        else if (e.key === "down") this.at = (this.at + 1) % n;
        else if (e.key === "up") this.at = (this.at + n - 1) % n;
        else if (e.key === "enter" || e.key === "space") this.flip(ordered[this.at], cx);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().gap(9).items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Mods"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(6).text_color(t.muted).child(`Switches for ${name}. Hidden mods stay installed; each workspace keeps its own.`))
      .child(v_flex().id("ms-list").flex_1().min_h(0).pt(6).overflow_y_scrollbar()
        .when(!ordered.length, (el) => el.child(div().pt(12).text_color(t.dim).child("This layout places no mods.")))
        .children(GROUPS.filter((g) => rows.some((r) => r.group === g)).map((g) =>
          v_flex()
            .child(div().pt(10).pb(2).px(10).text_size(11.5).text_color(t.dim).child(g))
            .children(rows.filter((r) => r.group === g).map(row)))))
      .when(floats.length > 0, (el) => el.child(div().pt(10).text_size(11.5).text_color(t.dim)
        .child(`Floating, can't be switched here: ${floats.join(", ")}`)));
  }
}
