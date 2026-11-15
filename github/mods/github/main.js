// A side panel (or a pane) listing the open GitHub issues and pull requests of
// the repository the focused terminal is in, read with the GitHub CLI (`gh`).
// A row opens its description and conversation; nothing here writes to GitHub.
// props { repo: "owner/name" } pins a copy to that repository whatever the folder;
// { tab: "issues" | "prs" } chooses the list it starts on, and { open: 123 }
// starts on that issue or pull request (of `tab`).
// Role "menu" (props { role: "menu", url }) is a row's right-click menu, opened
// by the panel as a popup at the pointer.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { spaces, panes, focused, exec, theme, layout, settings, props, openOverlay, closeOverlay } from "herdr";

const MOD = "github";
const ICON = (name) => `mods/github/${name}.svg`;
const LIMIT = 50; // rows asked of each list
const STALE = 120000; // a shown panel reloads after this long
const TIMEOUT = 20000;
const BODY = 20000; // characters of a description or comment drawn

const LIST = {
  issues: ["issue", "list", "--limit", String(LIMIT), "--json", "number,title,author,labels,updatedAt,url,state"],
  prs: ["pr", "list", "--limit", String(LIMIT), "--json", "number,title,author,labels,updatedAt,url,state,isDraft,reviewDecision,statusCheckRollup,headRefName"],
};
const VIEW = {
  issues: (n) => ["issue", "view", String(n), "--json", "number,title,body,author,state,createdAt,updatedAt,labels,comments,url"],
  prs: (n) => ["pr", "view", String(n), "--json", "number,title,body,author,state,createdAt,updatedAt,labels,comments,reviews,url,isDraft,reviewDecision,statusCheckRollup,headRefName,baseRefName,additions,deletions,changedFiles"],
};
const NAMES = { issues: "Issues", prs: "Pull requests" };

// Where the focused terminal is, as the shipped Changes panel reads it.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => (props()?.repo ? `repo:${props().repo}` : JSON.stringify(location()));

// False while this mod's layout block is hidden or behind another child of its
// stack: a hidden copy's timers keep running, and it shouldn't call GitHub.
// A copy that isn't in the layout (a pane) counts as shown.
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

function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400 / 30)}mo`;
  return `${Math.floor(s / 86400 / 365)}y`;
}

// A pull request's checks as one word: "fail" if any failed, else "pending" if
// any still runs, else "pass"; null without checks.
function checksOf(list) {
  if (!list?.length) return null;
  let pending = false;
  for (const c of list) {
    if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(c.conclusion || c.state || "")) return "fail";
    if (c.__typename === "StatusContext" ? ["PENDING", "EXPECTED"].includes(c.state) : c.status !== "COMPLETED") pending = true;
  }
  return pending ? "pending" : "pass";
}
const CHECKS = { pass: ["Checks pass", "ansi2"], fail: ["Checks fail", "ansi1"], pending: ["Checks running", "ansi3"] };
const REVIEW = { APPROVED: ["Approved", "ansi2"], CHANGES_REQUESTED: ["Changes requested", "ansi1"], REVIEW_REQUIRED: ["Review required", "dim"] };

// What went wrong, for a person: { title, body }.
function explain(e, missing) {
  const text = String(e?.message ?? e).trim(), line = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (missing) return { title: "GitHub CLI not found", body: "This panel reads GitHub with gh. Install it from cli.github.com, then run gh auth login." };
  if (/gh auth login|not logged in|authentication/i.test(text)) return { title: "Not signed in to GitHub", body: "Run gh auth login in a terminal, then refresh." };
  if (/no git remotes|none of the git remotes|not a github|could not resolve to a repository/i.test(text)) return { title: "Not a GitHub repository", body: "This folder's repository has no GitHub remote." };
  if (/timed? ?out/i.test(text)) return { title: "GitHub didn't answer", body: "The request timed out. Refresh to try again." };
  return { title: "Couldn't load from GitHub", body: line.slice(0, 300) };
}

export default class GitHub extends View {
  init(_props, cx) {
    const start = props() ?? {};
    this.menu = start.role === "menu";
    if (this.menu) { this.at = 0; this.handle = cx.focus_handle(); this.handle.focus(); return; }
    this.tab = (start.tab ?? localStorage.getItem("tab")) === "prs" ? "prs" : "issues";
    this.reset();
    // Shown once the first load knows the repository.
    this.start = Number.isInteger(start.open) ? { kind: this.tab, number: start.open, item: { number: start.open, title: "" } } : null;
    cx.timer.every(3000, (cx) => {
      if (shown() && !this.loading && (key() !== this.context || Date.now() - this.at > STALE)) this.refresh(cx);
    });
    this.refresh(cx);
  }

  reset() {
    this.root = null; this.on = null; this.repo = null; this.at = 0;
    this.items = { issues: [], prs: [] }; this.listError = {}; this.error = null;
    this.open = null; this.detail = null; this.detailError = null;
  }

  // gh in the repository's folder, or against the pinned repository.
  gh(args) {
    const pinned = props()?.repo;
    return exec("gh", args, { ...(pinned ? {} : { cwd: this.root }), on: this.on, timeout: TIMEOUT }).catch((e) => {
      throw Object.assign(new Error(String(e?.message ?? e)), { missing: !/timed? ?out/i.test(String(e?.message ?? e)) });
    });
  }

  async json(args) {
    const r = await this.gh(props()?.repo ? [...args, "-R", props().repo] : args);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
    return JSON.parse(r.stdout);
  }

  refresh(cx, force) {
    if (this.loading) return;
    const context = key(), pinned = props()?.repo, { cwd, on } = pinned ? { cwd: null, on: null } : location();
    this.context = context;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        let root = null;
        if (!pinned) {
          const top = cwd ? await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null) : null;
          if (!top || top.code !== 0) { this.reset(); this.error = { title: cwd ? "Not a git repository" : "No folder", body: "Focus a terminal inside a repository that's on GitHub." }; return; }
          root = top.stdout.trim();
        }
        // Another folder of the same repository: what's shown is still right.
        if (root === this.root && on === this.on && this.at) { if (!force && Date.now() - this.at < STALE) return; }
        else { this.reset(); this.root = root; this.on = on; cx.notify(); }
        this.at = Date.now();
        if (!this.repo) this.repo = pinned ? { nameWithOwner: pinned, url: `https://github.com/${pinned}` } : await this.json(["repo", "view", "--json", "nameWithOwner,url"]);
        await Promise.all(Object.keys(LIST).map(async (kind) => {
          try { this.items[kind] = await this.json(LIST[kind]); delete this.listError[kind]; }
          catch (e) { if (e.missing) throw e; this.items[kind] = []; this.listError[kind] = explain(e).body || explain(e).title; }
        }));
        this.error = null;
        if (this.start) { this.open = this.start; this.start = null; }
        if (this.open) await this.load(this.open);
      } catch (e) { this.error = explain(e, e?.missing); }
      finally { this.loading = false; cx.notify(); }
    });
    cx.notify();
  }

  async load(open) {
    try {
      const detail = await this.json(VIEW[open.kind](open.number));
      if (this.open === open) { this.detail = detail; this.detailError = null; }
    } catch (e) { if (this.open === open && !this.detail) this.detailError = explain(e, e?.missing).body; }
  }

  pick(kind, item, cx) {
    const open = { kind, number: item.number, item };
    this.open = open; this.detail = null; this.detailError = null; this.copied = false;
    cx.spawn(async (cx) => { await this.load(open); cx.notify(); });
    cx.notify();
  }

  stateOf(kind, d, t) {
    if (kind === "prs") {
      if (d.state === "MERGED") return ["Merged", t.ansi5, "merged"];
      if (d.state === "CLOSED") return ["Closed", t.ansi1, "pr"];
      return d.isDraft ? ["Draft", t.dim, "pr-draft"] : ["Open", t.ansi2, "pr"];
    }
    return d.state === "CLOSED" ? ["Closed", t.ansi5, "issue-closed"] : ["Open", t.ansi2, "issue"];
  }

  label(l, t) {
    return h_flex().flex_none().h(16).px(5).gap(4).items_center().rounded(8).border_1().border_color(t.border).text_size(10.5).text_color(t.muted)
      .child(div().size(6).flex_none().rounded(3).bg(`#${l.color || "888888"}`))
      .child(div().max_w(96).truncate().child(l.name));
  }

  row(kind, it, t) {
    const [, color, icon] = this.stateOf(kind, it, t), checks = kind === "prs" ? CHECKS[checksOf(it.statusCheckRollup)] : null;
    const review = it.reviewDecision === "APPROVED" || it.reviewDecision === "CHANGES_REQUESTED" ? REVIEW[it.reviewDecision] : null;
    const labels = it.labels ?? [];
    return h_flex().id(`gh-${kind}-${it.number}`).flex_none().px(8).py(7).gap(9).items_start().rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.pick(kind, it, cx))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: MOD, kind: "popup", at: "pointer", width: 200, height: 72, props: { role: "menu", url: it.url } });
      })
      .child(div().pt(2).flex_none().child(svg(ICON(icon)).size(14).text_color(color)))
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(div().truncate().child(it.title))
        .child(h_flex().min_w(0).gap(6).items_center().overflow_hidden().text_size(11).text_color(t.dim)
          .child(div().flex_none().child(`#${it.number} · ${it.author?.login ?? "ghost"} · ${ago(it.updatedAt)}`))
          .when(Boolean(checks), (e) => e.child(div().size(7).flex_none().rounded(4).bg(t[checks[1]])))
          .when(Boolean(review), (e) => e.child(div().flex_none().text_color(t[review[1]]).child(review[0])))
          .children(labels.slice(0, 2).map((l) => this.label(l, t)))
          .when(labels.length > 2, (e) => e.child(div().flex_none().child(`+${labels.length - 2}`)))));
  }

  list(t) {
    const rows = this.items[this.tab], empty = this.listError[this.tab] || (this.loading ? "Loading…" : `No open ${NAMES[this.tab].toLowerCase()}`);
    return v_flex().id(`gh-list-${this.tab}`).flex_1().min_h(0).overflow_y_scrollbar().p(6)
      .children(rows.map((it) => this.row(this.tab, it, t)))
      .when(!rows.length, (e) => e.child(div().p(8).text_size(12).text_color(t.dim).child(empty)))
      .when(rows.length >= LIMIT, (e) => e.child(div().p(8).text_size(11).text_color(t.dim).child(`Showing the ${LIMIT} most recently created`)));
  }

  message(m, t) {
    return v_flex().flex_1().min_h(0).p(16).gap(6)
      .child(div().font_semibold().child(m.title))
      .child(div().text_size(12).text_color(t.muted).child(m.body ?? ""));
  }

  detailView(t) {
    const { kind, number, item } = this.open, d = this.detail ?? item, pr = kind === "prs";
    const [word, color, icon] = this.stateOf(kind, d, t), mono = settings().font_family ?? "JetBrains Mono";
    const checks = pr ? CHECKS[checksOf(d.statusCheckRollup)] : null, review = pr ? REVIEW[d.reviewDecision] : null;
    const thread = [...(d.comments ?? []), ...(d.reviews ?? []).filter((r) => r.body?.trim()).map((r) => ({ ...r, createdAt: r.submittedAt, review: REVIEW[r.state]?.[0] }))]
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const text = (id, body) => TextView.markdown(id, body.length > BODY ? body.slice(0, BODY) + "\n\n…" : body).selectable(true);
    return v_flex().id(`gh-detail-${kind}-${number}`).flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(10)
      .child(div().text_size(14).font_semibold().child(d.title))
      .child(h_flex().flex_wrap().gap(8).items_center().text_size(11.5).text_color(t.muted)
        .child(h_flex().flex_none().h(20).px(7).gap(5).items_center().rounded(10).border_1().border_color(color).text_color(color)
          .child(svg(ICON(icon)).size(11)).child(word))
        .child(div().child(`${d.author?.login ?? "ghost"} · ${d.createdAt ? `opened ${ago(d.createdAt)} ago` : `updated ${ago(d.updatedAt)} ago`}`))
        .when(Boolean(checks), (e) => e.child(h_flex().flex_none().gap(5).items_center().child(div().size(7).rounded(4).bg(t[checks[1]])).child(checks[0])))
        .when(Boolean(review), (e) => e.child(div().flex_none().text_color(t[review[1]]).child(review[0]))))
      .when(pr && Boolean(d.headRefName), (e) => e.child(h_flex().flex_wrap().gap(8).items_center().text_size(11).text_color(t.dim)
        .child(div().min_w(0).truncate().font_family(mono).text_color(t.muted).child(d.baseRefName ? `${d.headRefName} → ${d.baseRefName}` : d.headRefName))
        .when(d.changedFiles !== undefined, (e) => e.child(div().flex_none().child(`${d.changedFiles} file${d.changedFiles === 1 ? "" : "s"}`))
          .child(div().flex_none().text_color(t.ansi2).child(`+${d.additions}`)).child(div().flex_none().text_color(t.ansi1).child(`−${d.deletions}`)))))
      .when((d.labels ?? []).length > 0, (e) => e.child(h_flex().flex_wrap().gap(5).children((d.labels ?? []).map((l) => this.label(l, t)))))
      .child(div().h(1).flex_none().bg(t.border))
      .when(!this.detail, (e) => e.child(div().text_size(12).text_color(this.detailError ? t.ansi1 : t.dim).child(this.detailError || "Loading…")))
      .when(Boolean(this.detail), (e) => e
        .child(d.body?.trim() ? text(`gh-body-${kind}-${number}`, d.body) : div().text_size(12).text_color(t.dim).child("No description."))
        .children(thread.map((c, i) => v_flex().gap(6).pt(10).border_t(1).border_color(t.border)
          .child(h_flex().gap(6).items_center().text_size(11.5)
            .child(div().font_semibold().child(c.author?.login ?? "ghost"))
            .child(div().text_color(t.dim).child(`${ago(c.createdAt)} ago`))
            .when(Boolean(c.review), (e) => e.child(div().text_color(t.dim).child(`· ${c.review}`))))
          .child(text(`gh-c-${kind}-${number}-${i}`, c.body ?? "")))));
  }

  // The row menu. An item acts before the popup closes, since a popup's tasks
  // end when it does.
  menuView() {
    const t = theme(), { url, overlay } = props();
    const items = [
      { label: "Open in browser", icon: "external", act: (cx) => cx.open_url(url) },
      { label: "Copy URL", icon: "link", act: (cx) => cx.write_to_clipboard(url) },
    ];
    const choose = (i, cx) => { if (url) items[i].act(cx); closeOverlay(overlay); };
    return v_flex().id("github-menu").track_focus(this.handle).w_full().p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % items.length;
        else if (e.key === "up") this.at = (this.at + items.length - 1) % items.length;
        else if (e.key === "enter") choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(overlay);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .children(items.map((it, i) => h_flex().id(`gh-menu-${i}`).h(31).px(8).gap(9).items_center().rounded(7).cursor_pointer().text_color(t.foreground)
        .when(i === this.at, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => choose(i, cx))
        .child(svg(ICON(it.icon)).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(it.label))));
  }

  render(cx) {
    if (this.menu) return this.menuView();
    if (key() !== this.context && shown()) this.refresh(cx);
    const t = theme(), open = this.open;
    const url = open && ((this.detail ?? open.item).url ?? `${this.repo?.url}/${open.kind === "prs" ? "pull" : "issues"}/${open.number}`);
    const iconButton = (id, name, action, spin) => div().id(id).size(24).flex().flex_none().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(action)
      .child(spin ? svg(ICON(name)).size(13).spin(900) : svg(ICON(name)).size(13));
    const tab = (id) => {
      const on = this.tab === id, n = this.items[id].length;
      return h_flex().id(`gh-tab-${id}`).h(26).px(9).gap(6).flex_none().items_center().rounded(6).cursor_pointer().text_size(12)
        .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.tab = id; localStorage.setItem("tab", id); cx.notify(); })
        .child(NAMES[id])
        .child(div().text_size(10.5).text_color(t.dim).child(n >= LIMIT ? `${LIMIT}+` : String(n)));
    };
    return v_flex().id("github").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().pl(14).pr(9).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(open), (e) => e.child(iconButton("gh-back", "back", (_e, cx) => { this.open = null; this.detail = null; cx.notify(); })))
        .child(div().flex_none().font_semibold().child(open ? `#${open.number}` : "GitHub"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(this.repo?.nameWithOwner ?? ""))
        .when(Boolean(open), (e) => e
          .child(iconButton("gh-copy", this.copied ? "check" : "link", (_e, cx) => {
            cx.write_to_clipboard(url); this.copied = true; cx.notify();
            cx.timer.after(1500, (cx) => { this.copied = false; cx.notify(); });
          }))
          .child(iconButton("gh-web", "external", (_e, cx) => cx.open_url(url))))
        .when(!open && Boolean(this.repo), (e) => e.child(iconButton("gh-repo", "external", (_e, cx) => cx.open_url(`${this.repo.url}/${this.tab === "prs" ? "pulls" : "issues"}`))))
        .child(iconButton("gh-refresh", "refresh", (_e, cx) => this.refresh(cx, true), Boolean(this.loading))))
      .when(Boolean(this.error), (e) => e.child(this.message(this.error, t)))
      .when(!this.error && !open, (e) => e
        .child(h_flex().h(38).flex_none().px(8).gap(3).items_center().border_b(1).border_color(t.border).child(tab("issues")).child(tab("prs")))
        .child(this.list(t)))
      .when(!this.error && Boolean(open), (e) => e.child(this.detailView(t)));
  }
}
