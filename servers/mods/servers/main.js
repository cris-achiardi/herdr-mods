// A sidebar section listing the local servers that are running: every process
// listening on a TCP port that was started from a Herdr terminal or is a dev
// runtime (node, bun, python, ...), grouped under the space it belongs to.
// Each one has a button that restarts it, one that stops it and one that opens
// it in the browser.
// A space's row folds its servers away, as a file's row does in figma-bridge.
// The list comes from scan.js, run every few seconds while the section is shown.
// props { demo: true } draws sample rows without running anything; with
// { folded: ["b"] } the second sample space starts folded.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, exec, hc, theme, layout, props, home, window, run, notify } from "herdr";
import { scan, listeners, argv } from "./scan.js";

const MOD = "servers";
const ICON = (name) => `mods/${MOD}/${name}.svg`;
const EVERY = 5000;
const HEAD = 41, GROUP = 28, ROW = 28, NOTE = 48, FOOT = 8, MAX = 300;
const OTHER = "other"; // the group of servers no space claims

const DEMO = [
  { space: "a", label: "website", servers: [{ port: 4321, pid: 1, name: "website", tool: "astro" }, { port: 6006, pid: 2, name: "storybook", tool: "storybook" }] },
  { space: "b", label: "api", servers: [{ port: 8000, pid: 3, name: "api", tool: "uvicorn" }] },
];

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

const norm = (p) => (p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const inside = (child, parent) => child === parent || child.startsWith(`${parent}/`);

// Servers under the space each belongs to, in the spaces' order, the unclaimed
// ones last. A server belongs to the space whose terminal started it; else the
// space with a terminal in the server's folder; else the space named like one
// of that folder's parts.
function groups(servers) {
  const all = spaces().filter((s) => !s.machine), mine = home() ? norm(home()) : "";
  const spaceOfTab = new Map(all.flatMap((s) => s.tabs.map((t) => [t.id, s])));
  const list = panes().filter((p) => p.terminal && spaceOfTab.has(p.tab));
  const terms = terminals();

  const owner = (s) => {
    const term = terms.find((t) => (s.ancestors ?? []).some((pid) => pid === t.pid || pid === t.foreground?.pid));
    const pane = term && list.find((p) => p.terminal === term.address);
    if (pane) return { space: spaceOfTab.get(pane.tab), pane: pane.pane };
    const dir = norm(s.dir);
    if (!dir) return null;
    let best = null, depth = 0;
    for (const p of list) {
      const cwd = norm(p.cwd);
      if (!cwd || cwd === mine || !(inside(dir, cwd) || inside(cwd, dir)) || cwd.length <= depth) continue;
      best = { space: spaceOfTab.get(p.tab), pane: null }; depth = cwd.length;
    }
    if (best) return best;
    const parts = dir.split("/"), named = all.find((sp) => parts.includes(sp.name.toLowerCase()));
    return named ? { space: named, pane: null } : null;
  };

  const by = new Map();
  for (const s of servers) {
    const o = owner(s), key = o?.space.id ?? OTHER;
    if (!by.has(key)) by.set(key, { space: key, label: o?.space.name ?? "Other", servers: [] });
    by.get(key).servers.push({ ...s, pane: o?.pane ?? null });
  }
  return [...all.map((s) => by.get(s.id)), by.get(OTHER)].filter(Boolean);
}

export default class Servers extends View {
  init(_props, cx) {
    this.demo = props()?.demo === true;
    this.servers = this.demo ? [] : null;
    this.error = null;
    this.cache = new Map();
    this.stopping = new Set();
    try { this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]")); } catch { this.folded = new Set(); }
    if (this.demo) { this.folded = new Set(props().folded ?? []); return; }
    cx.timer.every(EVERY, (cx) => { if (!this.loading && (block()?.shown ?? true)) this.poll(cx); });
    this.poll(cx);
  }

  poll(cx) {
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        this.servers = await scan(exec, window().platform, this.cache);
        const pids = new Set(this.servers.map((s) => s.pid));
        for (const pid of this.stopping) if (!pids.has(pid)) this.stopping.delete(pid);
        this.error = null;
      } catch (e) {
        this.error = { title: "Couldn't list the servers", body: String(e?.message ?? e).slice(0, 160) };
      } finally { this.loading = false; cx.notify(); }
    });
  }

  // Ends the server's process and the ones it started.
  async kill(s) {
    const r = window().platform === "windows" ? await exec("taskkill", ["/PID", String(s.pid), "/T", "/F"]) : await exec("kill", [String(s.pid)]);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0]);
  }

  stop(s, cx) {
    if (this.stopping.has(s.pid)) return;
    this.stopping.add(s.pid);
    cx.notify();
    cx.spawn(async (cx) => {
      try { await this.kill(s); } catch (e) {
        this.stopping.delete(s.pid);
        notify({ title: `Couldn't stop ${s.name} :${s.port}`, body: String(e?.message ?? e).slice(0, 160), level: "error" });
      }
      this.poll(cx);
    });
  }

  // Stops the server, waits for its port to be free (or a dev server would
  // take the next one), then runs its command again in its folder, as a
  // herdr-core terminal without a pane: it outlives the app, as the first did.
  restart(s, cx) {
    if (this.stopping.has(s.pid)) return;
    this.stopping.add(s.pid);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.kill(s);
        for (let i = 0; i < 20 && (await listeners(exec, window().platform)).some((l) => l.port === s.port); i++);
        const r = await hc(["run", "--json", "--bg", "--rm", "--no-parent", "--cwd", s.dir, "--", ...argv(s.cmd)]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0]);
      } catch (e) {
        notify({ title: `Couldn't restart ${s.name} :${s.port}`, body: String(e?.message ?? e).slice(0, 160), level: "error" });
      }
      this.poll(cx);
    });
  }

  // The block takes the height of what it lists, unfolded (a personal layout only).
  fit(height) {
    const me = block(), px = Math.min(MAX, height);
    if (!me?.id || me.px === px || this.sized === px) return;
    this.sized = px;
    run("layout.resize", { id: me.id, px });
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

  button(id, icon, tip, hover, t, action) {
    return div().id(id).size(22).flex().flex_none().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.dim)
      .tooltip(tip).accessibility_label(tip)
      .hover((s) => s.bg(t.selected).text_color(hover))
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(svg(ICON(icon)).size(13));
  }

  groupRow(g, t) {
    const folded = this.folded.has(g.space);
    return h_flex().id(`g-${g.space}`).h(GROUP).flex_none().px(8).gap(6).items_center().rounded(8).cursor_pointer()
      .text_color(g.space === OTHER ? t.muted : t.foreground)
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.toggle(g.space, cx))
      .child(svg(ICON(folded ? "chevron-right" : "chevron-down")).size(12).flex_none().text_color(t.dim))
      .child(div().min_w(0).truncate().child(g.label))
      .when(folded, (el) => el.child(div().flex_none().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(String(g.servers.length))));
  }

  serverRow(g, s, t) {
    const stopping = this.stopping.has(s.pid), go = g.space !== OTHER && !this.demo;
    const tip = [s.tool && s.tool !== s.name ? s.tool : null, s.dir, s.pid ? `pid ${s.pid}` : null].filter(Boolean).join(" · ");
    return h_flex().id(`s-${s.pid}-${s.port}`).h(ROW).flex_none().pl(26).pr(8).gap(7).items_center().rounded(8).text_size(12)
      .text_color(stopping ? t.dim : t.foreground)
      .hover((el) => el.bg(t.hover))
      .when(go, (el) => el.cursor_pointer().on_click(() => (s.pane ? run("pane.focus", { pane: s.pane }) : run("space.select", { id: g.space }))))
      .child(stopping ? svg(ICON("spinner")).size(12).flex_none().text_color(t.dim).spin(900) : div().size(7).mx(2.5).rounded(4).flex_none().bg(t.ansi2))
      .child(div().id(`n-${s.pid}-${s.port}`).min_w(0).truncate().tooltip(tip || s.name).child(s.name))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(`:${s.port}`))
      .child(div().flex_1())
      .when(!stopping, (el) => el
        .when(this.demo || Boolean(s.dir && s.cmd), (el) => el.child(this.button(`r-${s.pid}-${s.port}`, "restart", "Restart", t.foreground, t, (cx) => { if (!this.demo) this.restart(s, cx); })))
        .child(this.button(`x-${s.pid}-${s.port}`, "stop", "Stop", t.ansi1, t, (cx) => { if (!this.demo) this.stop(s, cx); }))
        .child(this.button(`o-${s.pid}-${s.port}`, "external", "Open in browser", t.foreground, t, (cx) => cx.open_url(`http://localhost:${s.port}`))));
  }

  render() {
    const t = theme();
    const list = this.demo ? DEMO : this.servers ? groups(this.servers) : [];
    const count = list.reduce((n, g) => n + g.servers.length, 0);
    const rows = [];
    let height = HEAD + FOOT;
    // Folded server rows still count toward the height, so folding a space
    // doesn't resize the block and move the heading.
    const add = (el, h) => { if (el) rows.push(el); height += h; };
    if (this.error) add(this.note(this.error.title, this.error.body, t), NOTE);
    else if (this.servers && !count) add(this.note("No servers running", "A dev server shows here once it listens on a port.", t), NOTE);
    else for (const g of list) {
      add(this.groupRow(g, t), GROUP);
      for (const s of g.servers) add(this.folded.has(g.space) ? null : this.serverRow(g, s, t), ROW);
    }
    if (!this.demo) this.fit(height);

    return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13).text_color(t.foreground)
      .when(this.demo, (el) => el.w(268).h(height)) // the sidebar's width, for a picture
      .child(
        h_flex().h(HEAD).pt(14).pb(5).px(16).flex_none().items_center().justify_between()
          .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Servers"))
          .when(count > 0, (el) => el.child(div().text_size(11).text_color(this.error ? t.ansi1 : t.dim).child(String(count)))),
      )
      .child(v_flex().id("list").flex_1().min_h(0).px(8).overflow_y_scrollbar().children(rows));
  }
}
