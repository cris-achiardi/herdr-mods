// A side panel (or a pane) listing the Claude Code skills and slash commands
// that apply where the focused terminal is: the project's first, then the
// person's global ones. Large families (seo-*, a command namespace, the skills
// synced from claude.ai) fold into one row. A row opens the skill's text; its
// copy button puts "/name" on the clipboard. Read-only: the list comes from
// scan.cjs, run with node. props { cwd } pins a copy to a folder;
// { open: "name" } starts on that skill, { filter: "text" } starts filtered,
// { unfolded: ["seo"] } starts with those families open.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextView, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, theme, layout, settings, props, appHome, readTextFile } from "herdr";

const MOD = "skills";
const ICON = (name) => `mods/${MOD}/${name}.svg`;
const STALE = 60000; // a shown panel rescans after this long
const FAMILY = 4; // names sharing a first word fold into one row from this many
const BODY = 60000; // characters of a skill drawn

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

// One sentence of a description, for a row.
function brief(text) {
  const first = /^(.{20,}?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return first.length > 130 ? `${first.slice(0, 127).trimEnd()}…` : first;
}

// Items as rows: loose ones, and families of names that share a namespace
// ("figui:audit"), a first word ("seo-audit", from FAMILY of them), or scan's own family.
function grouped(items) {
  const word = (it) => it.family ?? (it.name.includes(":") ? it.name.split(":")[0] : it.name.split("-")[0]);
  const count = new Map();
  for (const it of items) count.set(word(it), (count.get(word(it)) ?? 0) + 1);
  const rows = [], at = new Map();
  for (const it of items) {
    const w = word(it), n = count.get(w), family = it.family || n >= (it.name.includes(":") ? 2 : FAMILY);
    if (!family) { rows.push({ item: it }); continue; }
    if (!at.has(w)) { at.set(w, { family: w, items: [] }); rows.push(at.get(w)); }
    at.get(w).items.push(it);
  }
  return rows;
}

export default class Skills extends View {
  init(_props, cx) {
    const start = props() ?? {};
    this.data = null; this.error = null; this.context = null; this.at = 0;
    this.open = null; this.body = null; this.copied = null;
    this.start = start.open ?? null;
    try { this.unfolded = new Set(start.unfolded ?? JSON.parse(localStorage.getItem("unfolded") ?? "[]")); } catch { this.unfolded = new Set(); }
    this.filter = start.filter ?? "";
    this.input = InputState.new({ placeholder: "Filter skills…" });
    if (this.filter) this.input.set_value?.(this.filter);
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
        // Another machine's files aren't read: its project part is left out.
        const r = await exec("node", [`${appHome()}/mods/${MOD}/scan.cjs`, ...(where.cwd && !where.on ? [where.cwd] : [])], { timeout: 20000 });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0]);
        this.data = { ...JSON.parse(r.stdout), remote: where.on };
        this.error = null;
        this.at = Date.now();
        if (this.start) {
          const it = [...(this.data.project?.items ?? []), ...this.data.global.items].find((i) => i.name === this.start || i.run === this.start);
          this.start = null;
          if (it) this.pick(it, cx);
        }
      } catch (e) {
        const text = String(e?.message ?? e);
        this.error = /not found|no such file|cannot find|os error 2/i.test(text) ? { title: "Node.js not found", body: "This panel lists skills with node. Install Node.js, then refresh." } : { title: "Couldn't list skills", body: text.slice(0, 300) };
      } finally { this.loading = false; cx.notify(); }
    });
    cx.notify();
  }

  pick(item, cx) {
    this.open = item; this.body = null;
    cx.spawn(async (cx) => {
      const text = await readTextFile(item.path).catch(() => null);
      if (this.open !== item) return;
      this.body = text === null ? "" : text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
      cx.notify();
    });
    cx.notify();
  }

  copy(item, cx) {
    cx.write_to_clipboard(`/${item.run}`);
    this.copied = item.path;
    cx.notify();
    cx.timer.after(1500, (cx) => { if (this.copied === item.path) this.copied = null; cx.notify(); });
  }

  toggle(id, cx) {
    if (!this.unfolded.delete(id)) this.unfolded.add(id);
    localStorage.setItem("unfolded", JSON.stringify([...this.unfolded]));
    cx.notify();
  }

  button(id, name, tip, action, t, spin) {
    return div().id(id).size(24).flex().flex_none().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.muted).tooltip(tip).accessibility_label(tip)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((e, cx) => { cx.stop_propagation(); action(e, cx); })
      .child(spin ? svg(ICON(name)).size(13).spin(900) : svg(ICON(name)).size(13));
  }

  row(it, scope, inner, t) {
    const id = `${scope}-${it.kind}-${it.name}`;
    return h_flex().id(`sk-${id}`).flex_none().pl(inner ? 26 : 8).pr(4).py(6).gap(9).items_start().rounded(7).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(it, cx))
      .child(svg(ICON(it.kind === "command" ? "command" : "skill")).size(14).mt(2).flex_none().text_color(t.muted))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().child(it.kind === "command" ? `/${it.name}` : it.name))
        .child(div().whitespace_normal().text_size(11).text_color(t.dim).child(brief(it.description))))
      .child(this.button(`cp-${id}`, this.copied === it.path ? "check" : "copy", `Copy /${it.run}`, (_e, cx) => this.copy(it, cx), t));
  }

  family(g, scope, t) {
    const id = `${scope}:${g.family}`, open = this.unfolded.has(id);
    return [
      h_flex().id(`fam-${id}`).h(30).flex_none().px(8).gap(9).items_center().rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.toggle(id, cx))
        .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(14).flex_none().text_color(t.dim))
        .child(div().min_w(0).truncate().child(g.family))
        .child(div().flex_none().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(String(g.items.length)))
        .child(div().flex_1()),
      ...(open ? g.items.map((it) => this.row(it, scope, true, t)) : []),
    ];
  }

  section(title, note, items, scope, empty, t) {
    const f = this.filter.trim().toLowerCase();
    const hits = f ? items.filter((it) => `${it.name} ${it.description}`.toLowerCase().includes(f)) : items;
    const rows = f ? hits.map((it) => this.row(it, scope, false, t)) : grouped(hits).flatMap((g) => (g.item ? [this.row(g.item, scope, false, t)] : this.family(g, scope, t)));
    return [
      h_flex().h(30).flex_none().px(8).pt(6).gap(6).items_center().text_size(11.5).text_color(t.dim)
        .child(div().flex_none().font_medium().child(title))
        .child(div().flex_1().min_w(0).truncate().child(note))
        .child(div().flex_none().text_size(10.5).child(f ? `${hits.length} of ${items.length}` : String(items.length))),
      ...(rows.length ? rows : [div().px(8).py(6).text_size(12).text_color(t.dim).child(f ? "No match" : empty)]),
    ];
  }

  listView(t) {
    const d = this.data, mine = d.project;
    return v_flex().id("sk-list").flex_1().min_h(0).overflow_y_scrollbar().p(6)
      .children(this.section("This project", mine?.name ?? "", mine?.items ?? [], "project", d.remote ? "Projects on other machines aren't read." : "No skills or commands in this folder's .claude.", t))
      .child(div().h(8).flex_none())
      .children(this.section("Global", "~/.claude", d.global.items, "global", "No skills or commands in ~/.claude.", t));
  }

  detailView(t) {
    const it = this.open, mono = settings().font_family ?? "JetBrains Mono";
    const where = this.data?.home && it.path.startsWith(this.data.home) ? `~${it.path.slice(this.data.home.length)}` : it.path;
    const body = this.body ?? "";
    return v_flex().id(`sk-detail-${it.path}`).flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(10)
      .child(div().text_size(12.5).text_color(t.muted).child(it.description))
      .when(Boolean(it.hint), (e) => e.child(div().font_family(mono).text_size(11.5).text_color(t.muted).child(`/${it.run} ${it.hint}`)))
      .child(div().id("sk-path").truncate().font_family(mono).text_size(11).text_color(t.dim).tooltip(it.path).child(where.replace(/\\/g, "/")))
      .child(div().h(1).flex_none().bg(t.border))
      .child(this.body === null ? div().text_color(t.dim).child("Loading…")
        : body ? TextView.markdown(`sk-body-${it.path}`, body.length > BODY ? `${body.slice(0, BODY)}\n\n…` : body).selectable(true)
        : div().text_color(t.dim).child("Nothing but its description."));
  }

  render(cx) {
    if (JSON.stringify(location()) !== this.context && shown()) this.refresh(cx);
    const t = theme(), open = this.open;
    return v_flex().id("skills").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().pl(open ? 9 : 14).pr(9).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(open), (e) => e.child(this.button("sk-back", "back", "Back", (_e, cx) => { this.open = null; this.body = null; cx.notify(); }, t)))
        .child(div().flex_none().max_w(220).truncate().font_semibold().child(open ? `/${open.run}` : "Skills"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(open ? (open.kind === "command" ? "command" : "skill") : this.data?.project?.name ?? ""))
        .when(Boolean(open), (e) => e.child(this.button("sk-copy", this.copied === open.path ? "check" : "copy", `Copy /${open.run}`, (_e, cx) => this.copy(open, cx), t)))
        .child(this.button("sk-refresh", "refresh", "Refresh", (_e, cx) => this.refresh(cx), t, this.loading)))
      .when(Boolean(this.error), (e) => e.child(v_flex().p(14).gap(4).child(div().font_semibold().child(this.error.title)).child(div().text_size(12).text_color(t.muted).child(this.error.body))))
      .when(!this.error && !open, (e) => e
        .child(div().flex_none().px(8).pt(8).pb(2).child(Input.new(this.input).h(30).px(9).rounded(7).border_1().border_color(t.border).bg(t.background).text_size(12.5).text_color(t.foreground)))
        .child(this.data ? this.listView(t) : div().p(14).text_color(t.dim).child("Loading…")))
      .when(!this.error && Boolean(open), (e) => e.child(this.detailView(t)));
  }
}
