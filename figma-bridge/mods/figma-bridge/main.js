// A sidebar section listing the Figma files connected to the figma-console-mcp
// bridge (its Desktop Bridge plugin), and under each file the agent that last
// worked on it: spinning while it is calling Figma, click to go to its terminal.
// A file's row folds its agents away, as a group heading in the agents list does.
// The dot in the heading is the bridge light: green with a file connected,
// yellow with a bridge running but no file, grey with no bridge.
// Everything comes from probe.cjs, run with node every few seconds while shown.
// props { demo: true } draws sample rows without running anything; with
// { folded: ["b"] } the second sample file starts folded.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, panes, terminals, exec, theme, layout, props, appHome, run } from "herdr";

const MOD = "figma-bridge";
const ICON = (name) => `mods/${MOD}/${name}.svg`;
const EVERY = 3000;
const ACTIVE = 45000; // an agent counts as working on Figma this long after a call
const HEAD = 41, FILE = 30, AGENT = 26, NOTE = 48, FOOT = 8, MAX = 300;

const DEMO = {
  connected: 2, unnamed: 0, bridges: [{ up: true }],
  files: [
    { key: "a", name: "Design System", page: "Button", url: "https://www.figma.com", agents: [{ session: "1", name: "ds-monorepo", tool: "figma_execute", at: Date.now(), calling: true, demo: "ds-monorepo" }] },
    { key: "b", name: "Marketing site", page: "Home", url: "https://www.figma.com", agents: [{ session: "2", name: "website", tool: "figma_get_status", at: Date.now(), calling: true, demo: "website" }] },
  ],
};

// This mod's layout block, and whether it is on screen (see the github mod).
function block(node = layout(), path = []) {
  if (!node || typeof node !== "object") return null;
  const here = [...path, node];
  if (node.content?.mod === MOD) return { id: node.id, px: node.size?.px ?? null, shown: !here.some((n, i) => n.hidden || (n.type === "stack" && here[i + 1] && n.active !== here[i + 1].id)) };
  for (const child of node.children ?? []) {
    const found = block(child, here);
    if (found) return found;
  }
  return null;
}

const same = (a, b) => Boolean(a && b) && a.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase() === b.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function ago(at, now) {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// The Herdr agent a probe session runs in: the terminal whose program is one of
// the bridge's ancestors, else an agent pane in the session's folder.
function agentOf(a) {
  const list = agents();
  const term = terminals().find((t) => (a.ancestors ?? []).some((p) => p === t.pid || p === t.foreground?.pid));
  if (term) return list.find((g) => g.address === term.address) ?? null;
  const pane = panes().find((p) => p.terminal && p.program?.agent && same(p.cwd, a.cwd));
  return pane ? list.find((g) => g.pane === pane.pane) ?? null : null;
}

export default class FigmaBridge extends View {
  init(_props, cx) {
    this.demo = props()?.demo === true;
    this.data = this.demo ? DEMO : null;
    this.error = null;
    try { this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]")); } catch { this.folded = new Set(); }
    if (this.demo) { this.folded = new Set(props().folded ?? []); return; }
    cx.timer.every(EVERY, (cx) => { if (!this.loading && (block()?.shown ?? true)) this.poll(cx); });
    this.poll(cx);
  }

  poll(cx) {
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("node", [`${appHome()}/mods/${MOD}/probe.cjs`], { timeout: 20000 });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0]);
        this.data = JSON.parse(r.stdout);
        this.error = null;
      } catch (e) {
        const text = String(e?.message ?? e);
        this.error = /not found|no such file|cannot find|os error 2/i.test(text) ? { title: "Node.js not found", body: "The bridge and this list both need node." } : { title: "Couldn't read the bridge", body: text.slice(0, 160) };
      } finally { this.loading = false; cx.notify(); }
    });
  }

  // The block grows to the height of what it lists, unfolded, and never shrinks:
  // it ends the sidebar's lists, so a shorter block starts lower and the
  // section drops down the sidebar (a personal layout only).
  fit(height) {
    const me = block(), px = Math.min(MAX, height);
    if (!me?.id || px <= (me.px ?? 0) || this.sized === px) return;
    this.sized = px;
    run("layout.resize", { id: me.id, px });
  }

  light(t) {
    const d = this.data, up = d?.bridges?.some((b) => b.up);
    const [color, tip] = this.error ? [t.ansi1, this.error.title]
      : d?.connected ? [t.ansi2, `${d.connected} ${d.connected === 1 ? "file" : "files"} connected`]
      : up ? [t.ansi3, "Bridge running, no file connected"]
      : [t.dim, "No bridge running"];
    return div().id("light").size(7).rounded(4).flex_none().bg(color).tooltip(tip);
  }

  note(title, body, t) {
    return v_flex().h(NOTE).flex_none().px(8).gap(2).text_size(12)
      .child(div().text_color(t.muted).child(title))
      .child(div().text_size(11).text_color(t.dim).child(body));
  }

  toggle(key, cx) {
    if (!this.folded.delete(key)) this.folded.add(key);
    localStorage.setItem("folded", JSON.stringify([...this.folded]));
    cx.notify();
  }

  // Clicking the row folds its agents; folded, it says how many and whether one is at work.
  fileRow(f, now, t) {
    const n = f.agents.length, folded = n > 0 && this.folded.has(f.key);
    const busy = folded && f.agents.some((a) => a.calling || now - a.at < ACTIVE);
    return h_flex().id(`f-${f.key}`).h(FILE).flex_none().px(8).gap(6).items_center().rounded(8)
      .hover((s) => s.bg(t.hover))
      .when(n > 0, (el) => el.cursor_pointer().on_click((_e, cx) => this.toggle(f.key, cx)))
      .child(n > 0 ? svg(ICON(folded ? "chevron-right" : "chevron-down")).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
      .child(svg(ICON("figma")).size(14).flex_none().text_color(t.muted))
      .child(div().id(`n-${f.key}`).ml(3).min_w(0).truncate().tooltip(clean(f.page) ? `${f.name ?? f.key} · ${clean(f.page)}` : f.name ?? f.key).child(f.name ?? "Untitled"))
      .when(folded, (el) => el.child(div().flex_none().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(String(n))))
      .child(div().flex_1())
      .when(busy, (el) => el.child(svg(ICON("spinner")).size(12).flex_none().text_color(t.working ?? t.ansi4).spin(900)))
      .child(
        div().id(`o-${f.key}`).size(22).flex().flex_none().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.dim)
          .tooltip("Open in browser").accessibility_label("Open in browser")
          .hover((s) => s.bg(t.selected).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); cx.open_url(f.url); })
          .child(svg(ICON("external")).size(13)),
      );
  }

  agentRow(f, a, now, t) {
    const g = a.demo ? null : agentOf(a);
    const active = a.calling || now - a.at < ACTIVE;
    const name = a.demo ?? g?.space_name ?? a.name ?? "Agent", tab = g?.tab_name || g?.title || "";
    const pic = g?.program?.icon ? (g.program.tint ? svg(g.program.icon).size(13).flex_none().text_color(t.muted) : image(g.program.icon).w(13).h(13).flex_none()) : null;
    return h_flex().id(`a-${f.key}-${a.session}`).h(AGENT).flex_none().pl(26).pr(8).gap(7).items_center().rounded(8).text_size(12)
      .text_color(active ? t.foreground : t.muted)
      .when(Boolean(g?.focused), (el) => el.bg(t.selected))
      .when(Boolean(g), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => run("pane.focus", { pane: g.pane })))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().max_w(110).truncate().child(name))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(tab && tab !== name ? tab : ""))
      .child(
        active
          ? h_flex().flex_none().gap(5).items_center().text_size(11).text_color(t.dim)
              .child(clean(a.tool.replace(/^(figma|figjam)_/, "").replace(/_/g, " ")))
              .child(svg(ICON("spinner")).size(12).flex_none().text_color(t.working ?? t.ansi4).spin(900))
          : div().flex_none().text_size(11).text_color(t.dim).child(ago(a.at, now)),
      );
  }

  render() {
    const t = theme(), d = this.data, now = Date.now();
    const rows = [];
    let height = HEAD + FOOT;
    // Folded agent rows still count toward the height, so folding a file
    // doesn't resize the block and move the heading.
    const add = (el, h) => { if (el) rows.push(el); height += h; };
    if (this.error) add(this.note(this.error.title, this.error.body, t), NOTE);
    else if (d && !d.bridges.some((b) => b.up)) add(this.note("No bridge running", "It starts with an agent that has figma-console.", t), NOTE);
    else if (d && !d.connected) add(this.note("No file connected", "Run the Desktop Bridge plugin in a Figma file.", t), NOTE);
    else if (d) {
      for (const f of d.files) {
        add(this.fileRow(f, now, t), FILE);
        for (const a of f.agents) add(this.folded.has(f.key) ? null : this.agentRow(f, a, now, t), AGENT);
      }
      if (d.unnamed) add(
        h_flex().id("unnamed").h(FILE).flex_none().px(8).gap(9).items_center().text_color(t.dim)
          .tooltip("Its name shows once an agent asks the bridge (figma_get_status).")
          .child(svg(ICON("figma")).size(14).flex_none())
          .child(div().flex_1().min_w(0).truncate().child(`${d.unnamed} ${d.files.length ? "more " : ""}${d.unnamed === 1 ? "file" : "files"} connected`)),
        FILE,
      );
    }
    if (!this.demo) this.fit(height);

    return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13).text_color(t.foreground)
      .when(this.demo, (el) => el.w(268).h(height)) // the sidebar's width, for a picture
      .child(
        h_flex().h(HEAD).pt(14).pb(5).px(16).flex_none().items_center().justify_between()
          .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Figma"))
          .child(this.light(t)),
      )
      .child(v_flex().id("list").flex_1().min_h(0).px(8).overflow_y_scrollbar().children(rows));
  }
}
