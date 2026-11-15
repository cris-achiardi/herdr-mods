// A side panel (or a pane) listing the package scripts of the project the
// focused terminal is in. Clicking one opens a shell in a pane beside the
// focused one and types the command there (npm, pnpm, yarn or bun, as the
// project uses), so its output stays and the shell is left to use. Install,
// dev, start, build and test come first. In a workspace the root's scripts
// come first and each package folds into one row. The list comes from
// scan.cjs, run with node. props { cwd } pins a copy to a folder;
// { filter: "text" } starts filtered, { unfolded: ["apps/docs"] } starts with
// those packages open.
// Right-clicking a script opens the row menu (this mod as a popup, props
// { role: "menu", ... }): run it in a new terminal, or in a shell that is
// already open in this space and has nothing running. Agents' terminals are
// never offered. The menu only hands the choice back through shared(
// "scripts.request"): a popup's tasks end when it closes.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, hc, theme, layout, settings, props, appHome, run, shared, setShared, openOverlay, closeOverlay } from "herdr";

const MOD = "scripts";
const ICON = (name) => `mods/${MOD}/${name}.svg`;
const STALE = 60000; // a shown panel rescans after this long
const FIRST = ["install", "dev", "start", "build", "test"];
const REQUEST = "scripts.request";
const OFFERED = 6; // open shells listed in the row menu

const same = (a, b) => Boolean(a && b) && a.replace(/[/\\]+$/, "").replace(/\\/g, "/").toLowerCase() === b.replace(/[/\\]+$/, "").replace(/\\/g, "/").toLowerCase();
const base = (p) => (p ?? "").replace(/[/\\]+$/, "").split(/[/\\]/).pop() || p || "";

// The shells of the shown space that sit at a prompt: their program is the
// shell itself, so nothing runs in them, and no agent does.
function idleShells() {
  const tabs = spaces().find((s) => s.active)?.tabs ?? [];
  return panes().filter((p) => p.terminal && p.program?.shell && !p.program?.agent && !p.status && !p.terminal.includes("/") && tabs.some((t) => t.id === p.tab))
    .slice(0, OFFERED)
    .map((p) => ({ pane: p.pane, terminal: p.terminal, cwd: p.cwd, shell: p.program.key, label: `${tabs.find((t) => t.id === p.tab)?.name ?? "tab"} · ${base(p.cwd)}` }));
}

// Where the focused terminal is, as the shipped Changes panel reads it.
function location() {
  if (props()?.cwd) return { cwd: props().cwd, on: null };
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || null, on };
}

// False while this mod's layout block is hidden or behind another child of its stack.
function shown(node = layout(), path = []) {
  if (!node || typeof node !== "object") return null;
  const here = [...path, node];
  if (node.content?.mod === MOD) return !here.some((n, i) => n.hidden || (n.type === "stack" && here[i + 1] && n.active !== here[i + 1].id));
  for (const child of node.children ?? []) {
    const found = shown(child, here);
    if (found !== null) return found;
  }
  return path.length ? null : true;
}

// A package's rows: install (the root only), the common scripts, the rest by name.
function rowsOf(pkg, manager) {
  const rank = (s) => (FIRST.includes(s.name) ? FIRST.indexOf(s.name) : FIRST.length);
  const scripts = pkg.scripts.map((s) => ({ ...s, line: `${manager} run ${s.name}` })).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const install = pkg.rel === "" && !pkg.scripts.some((s) => s.name === "install") ? [{ name: "install", cmd: "Install the project's dependencies", line: `${manager} install`, own: true }] : [];
  return [...install, ...scripts].map((s) => ({ ...s, dir: pkg.dir, rel: pkg.rel, id: `${pkg.rel}:${s.name}` }));
}

export default class Scripts extends View {
  init(_props, cx) {
    const start = props() ?? {};
    this.menu = start.role === "menu";
    if (this.menu) { this.at = 0; this.handle = cx.focus_handle(); this.handle.focus(); return; }
    this.me = `${Date.now()}-${Math.random()}`; this.handled = shared(REQUEST)?.at ?? 0;
    this.data = undefined; this.error = null; this.context = null; this.at = 0;
    this.copied = null; this.started = null; this.failed = null;
    try { this.unfolded = new Set(start.unfolded ?? JSON.parse(localStorage.getItem("unfolded") ?? "[]")); } catch { this.unfolded = new Set(); }
    this.filter = start.filter ?? "";
    this.input = InputState.new({ placeholder: "Filter scripts…" });
    if (this.filter) this.input.set_value(this.filter);
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); cx.notify(); });
    cx.timer.every(3000, (cx) => {
      if (shown() && !this.loading && (JSON.stringify(location()) !== this.context || Date.now() - this.at > STALE)) this.refresh(cx);
    });
    this.refresh(cx);
  }

  refresh(cx) {
    if (this.loading) return;
    const where = location();
    this.context = JSON.stringify(where);
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        this.remote = Boolean(where.on);
        if (!where.cwd || where.on) this.data = null;
        else {
          const r = await exec("node", [`${appHome()}/mods/${MOD}/scan.cjs`, where.cwd], { timeout: 20000 });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0]);
          this.data = JSON.parse(r.stdout);
        }
        this.error = null;
        this.at = Date.now();
      } catch (e) {
        const text = String(e?.message ?? e);
        this.error = /not found|no such file|cannot find|os error 2/i.test(text) ? { title: "Node.js not found", body: "This panel reads package.json with node. Install Node.js, then refresh." } : { title: "Couldn't read the scripts", body: text.slice(0, 300) };
      } finally { this.loading = false; cx.notify(); }
    });
    cx.notify();
  }

  // A new shell in the script's folder, opened beside the focused pane, with the
  // command typed into it.
  // With `into` (a row of idleShells()), the command is typed into that shell
  // instead, after a cd when it is in another folder, and its pane is focused.
  start(s, cx, into) {
    if (this.starting) return;
    this.starting = s.id; this.failed = null;
    cx.spawn(async (cx) => {
      try {
        if (into) {
          const cd = same(into.cwd, s.dir) ? "" : into.shell === "cmd" ? `cd /d "${s.dir}" && ` : `cd "${s.dir}"; `;
          const sent = await hc(["send", into.terminal, cd + s.line]);
          if (sent.code !== 0) throw new Error((sent.stderr || sent.stdout).trim().split("\n")[0]);
          run("pane.focus", { pane: into.pane });
          this.started = s.id;
          cx.timer.after(1500, (cx) => { if (this.started === s.id) this.started = null; cx.notify(); });
          return;
        }
        // The app opens the pane itself, then the new terminal is found by asking
        // the core until one appears that wasn't there (each ask is the wait).
        const live = async () => { const r = await hc(["ls", "--json"]); return r.code === 0 ? JSON.parse(r.stdout).terminals.filter((x) => x.state === "live").map((x) => x.address) : []; };
        const before = new Set(await live());
        run("terminal.open", { folder: s.dir, place: "right" });
        let terminal = null;
        for (let i = 0; i < 60 && !terminal; i++) terminal = (await live()).find((a) => !before.has(a)) ?? null;
        if (!terminal) throw new Error("the new terminal didn't appear");
        const sent = await hc(["send", terminal, s.line]);
        if (sent.code !== 0) throw new Error((sent.stderr || sent.stdout).trim().split("\n")[0]);
        this.started = s.id;
        cx.timer.after(1500, (cx) => { if (this.started === s.id) this.started = null; cx.notify(); });
      } catch (e) { this.failed = { id: s.id, text: String(e?.message ?? e).slice(0, 200) }; }
      finally { this.starting = null; cx.notify(); }
    });
    cx.notify();
  }

  copy(s, cx) {
    cx.write_to_clipboard(s.line);
    this.copied = s.id;
    cx.notify();
    cx.timer.after(1500, (cx) => { if (this.copied === s.id) this.copied = null; cx.notify(); });
  }

  toggle(rel, cx) {
    if (!this.unfolded.delete(rel)) this.unfolded.add(rel);
    localStorage.setItem("unfolded", JSON.stringify([...this.unfolded]));
    cx.notify();
  }

  button(id, name, tip, action, t, spin) {
    return div().id(id).size(24).flex().flex_none().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.muted).tooltip(tip).accessibility_label(tip)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((e, cx) => { cx.stop_propagation(); action(e, cx); })
      .child(spin ? svg(ICON(name)).size(13).spin(900) : svg(ICON(name)).size(13));
  }

  row(s, inner, tag, t) {
    const mono = settings().font_family ?? "JetBrains Mono";
    const busy = this.starting === s.id, done = this.started === s.id, failed = this.failed?.id === s.id;
    return h_flex().id(`sc-${s.id}`).flex_none().pl(inner ? 26 : 8).pr(4).py(6).gap(9).items_start().rounded(7).cursor_pointer()
      .hover((e) => e.bg(t.hover)).tooltip(`Run ${s.line}`).on_click((_e, cx) => this.start(s, cx))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        const targets = idleShells();
        openOverlay({ mod: MOD, kind: "popup", at: "pointer", width: 260, height: 10 + 31 * (1 + targets.length),
          props: { role: "menu", from: this.me, script: { id: s.id, name: s.name, line: s.line, dir: s.dir }, targets } });
      })
      .child(busy ? svg(ICON("refresh")).size(14).mt(2).flex_none().text_color(t.muted).spin(900)
        : svg(ICON(done ? "check" : "play")).size(14).mt(2).flex_none().text_color(done ? t.ansi2 : t.muted))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(h_flex().gap(7).items_center()
          .child(div().min_w(0).truncate().child(s.name))
          .when(Boolean(tag), (e) => e.child(div().flex_none().max_w(140).truncate().text_size(10.5).text_color(t.dim).child(tag))))
        .child(failed ? div().whitespace_normal().text_size(11).text_color(t.ansi1).child(`Couldn't start: ${this.failed.text}`)
          : s.own ? div().truncate().text_size(11).text_color(t.dim).child(s.cmd)
          : div().id(`cmd-${s.id}`).truncate().font_family(mono).text_size(10.5).text_color(t.dim).child(s.cmd)))
      .child(this.button(`cp-${s.id}`, this.copied === s.id ? "check" : "copy", `Copy ${s.line}`, (_e, cx) => this.copy(s, cx), t));
  }

  heading(title, note, count, t) {
    return h_flex().h(30).flex_none().px(8).pt(6).gap(6).items_center().text_size(11.5).text_color(t.dim)
      .child(div().flex_none().font_medium().child(title))
      .child(div().flex_1().min_w(0).truncate().child(note))
      .child(div().flex_none().text_size(10.5).child(count));
  }

  listView(t) {
    const d = this.data, f = this.filter.trim().toLowerCase();
    const packs = d.packages.map((p) => ({ ...p, rows: rowsOf(p, d.manager) }));
    const total = packs.reduce((n, p) => n + p.rows.length, 0);
    const list = v_flex().id("sc-list").flex_1().min_h(0).overflow_y_scrollbar().p(6);
    if (f) {
      const hits = packs.flatMap((p) => p.rows).filter((s) => `${s.name} ${s.cmd}`.toLowerCase().includes(f));
      return list.child(this.heading("Scripts", d.manager, `${hits.length} of ${total}`, t))
        .children(hits.length ? hits.map((s) => this.row(s, false, s.rel, t)) : [div().px(8).py(6).text_size(12).text_color(t.dim).child("No match")]);
    }
    const [root, ...rest] = packs[0]?.rel === "" ? packs : [null, ...packs];
    return list
      .when(Boolean(root), (e) => e.child(this.heading("Scripts", d.manager, String(root.rows.length), t)).children(root.rows.map((s) => this.row(s, false, null, t))))
      .when(rest.length > 0, (e) => e.child(div().h(8).flex_none()).child(this.heading("Packages", "", String(rest.length), t))
        .children(rest.flatMap((p) => {
          // The package the focused terminal is in starts open.
          const open = this.unfolded.has(p.rel) !== (p.rel === d.here);
          return [
            h_flex().id(`pk-${p.rel}`).h(30).flex_none().px(8).gap(9).items_center().rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => this.toggle(p.rel, cx))
              .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(14).flex_none().text_color(t.dim))
              .child(div().min_w(0).truncate().child(p.rel))
              .child(div().flex_none().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(String(p.rows.length)))
              .child(div().flex_1()),
            ...(open ? p.rows.map((s) => this.row(s, true, null, t)) : []),
          ];
        })));
  }

  // The row menu: "new terminal" first, then each idle shell.
  menuView() {
    const t = theme(), { overlay, from, script, targets = [] } = props();
    const items = [{ label: "Run in new terminal", icon: "play", into: null }, ...targets.map((x) => ({ label: `Run in ${x.label}`, icon: "terminal", into: x }))];
    const choose = (i) => { if (script) setShared(REQUEST, { at: Date.now(), from, script, into: items[i].into }); closeOverlay(overlay); };
    return v_flex().id("scripts-menu").track_focus(this.handle).w_full().p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % items.length;
        else if (e.key === "up") this.at = (this.at + items.length - 1) % items.length;
        else if (e.key === "enter") choose(this.at);
        else if (e.key === "escape") closeOverlay(overlay);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .children(items.map((it, i) => h_flex().id(`sc-menu-${i}`).h(31).px(8).gap(9).items_center().rounded(7).cursor_pointer().text_color(t.foreground)
        .when(i === this.at, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click(() => choose(i))
        .child(svg(ICON(it.icon)).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(it.label))));
  }

  render(cx) {
    if (this.menu) return this.menuView();
    // A choice made in this copy's row menu.
    const req = shared(REQUEST);
    if (req && req.from === this.me && req.at > this.handled) { this.handled = req.at; this.start(req.script, cx, req.into); }
    if (JSON.stringify(location()) !== this.context && shown()) this.refresh(cx);
    const t = theme(), d = this.data;
    const note = (title, body) => v_flex().p(14).gap(4).child(div().font_semibold().child(title)).child(div().text_size(12).text_color(t.muted).child(body));
    return v_flex().id("scripts").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().pl(14).pr(9).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child("Scripts"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(d?.name ?? ""))
        .child(this.button("sc-refresh", "refresh", "Refresh", (_e, cx) => this.refresh(cx), t, this.loading)))
      .when(Boolean(this.error), (e) => e.child(note(this.error.title, this.error.body)))
      .when(!this.error && d === undefined, (e) => e.child(div().p(14).text_color(t.dim).child("Loading…")))
      .when(!this.error && d === null, (e) => e.child(this.remote ? note("Not read on other machines", "Scripts are listed for projects on this computer.") : note("No scripts here", "Focus a terminal inside a project that has a package.json.")))
      .when(!this.error && Boolean(d), (e) => e
        .child(div().flex_none().px(8).pt(8).pb(2).child(Input.new(this.input).h(30).px(9).rounded(7).border_1().border_color(t.border).bg(t.background).text_size(12.5).text_color(t.foreground)))
        .child(this.listView(t)));
  }
}
