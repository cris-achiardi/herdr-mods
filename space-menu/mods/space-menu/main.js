// The Spaces list's right-click menu, opened as a popup with props { space? }.
// Always: New space (on the focused space's machine, as Herdr's +), Open folder…
// and Open folders… (this computer's folders, so spaces on this computer).
// On a space's row (props.space = its id) also Herdr's own space items:
// Rename, the worktree dialogs, Close.
// Then a section per other machine (`hc machine add`): New space, Open folder…,
// Open folders… there; greyed out while the machine is offline.
// Role "pick" (props { role: "pick" }) is a small dialog that stays up while the
// system folder picker is open: a popup's tasks end when it closes, so the
// popup can't wait for the picker itself.
// Role "multi" (props { role: "multi" }) is the Open folders… dialog: collect
// several folders (the system picker gives one at a time), then one space with a
// tab per folder, each tab named after its folder. Optionally the first tab runs
// Claude Code with the other folders passed as `--add-dir`. A space is not a
// sandbox: this scopes what the agent is given, it does not fence the terminals.
// Role "remote" (props { role: "remote", machine }) is Open folder… on another
// machine, and role "multi" with a machine is its Open folders…: the system picker
// only shows this computer, so these browse the machine's folders with `exec` there.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, spaces, panes, exec, pickFolder, notify, knownAgents, home, machines } from "herdr";

const ICON = (name) => `mods/workspace-chrome/${name}.svg`;

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

// An item is { label, icon, act, key?, divide?, off? } (off: greyed out), or a
// machine's heading { machine, note }; act runs after the popup closes.
function items(space, git) {
  const worktree = (action) => () =>
    openOverlay({ mod: "worktree", kind: "dialog", ...(action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: { space, action } });
  const remote = (role, machine) => () =>
    openOverlay({ mod: "space-menu", kind: "dialog", width: 520, height: role === "multi" ? 560 : 520, props: { role, machine } });
  return [
    { label: "New space", icon: "plus", key: "space.new", act: () => run("space.new", {}) },
    { label: "Open folder…", icon: "folder-plus", act: () => openOverlay({ mod: "space-menu", kind: "dialog", width: 340, height: 132, props: { role: "pick" } }) },
    { label: "Open folders…", icon: "layers", act: () => openOverlay({ mod: "space-menu", kind: "dialog", width: 460, height: 440, props: { role: "multi" } }) },
    ...(space
      ? [
          { label: "Rename", icon: "square-pen", key: "space.rename", divide: true, act: () => run("space.rename", { id: space }) },
          ...(git ? [{ label: "New worktree", icon: "git-branch", act: worktree("new") }, { label: "Open worktree", icon: "git-branch", act: worktree("open") }] : []),
          ...(git === "linked" ? [{ label: "Remove worktree", icon: "git-branch", act: worktree("remove") }] : []),
          { label: "Close", icon: "x", divide: true, act: () => run("space.close", { id: space }) },
        ]
      : []),
    ...machines()
      .filter((m) => m.name)
      .flatMap(({ name, layout }) => {
        const off = layout !== "ready";
        return [
          { machine: name, note: layout === "loading" ? "connecting…" : off ? "offline" : "" },
          { label: "New space", icon: "plus", off, act: () => run("space.new", { machine: name }) },
          { label: "Open folder…", icon: "folder-plus", off, act: remote("remote", name) },
          { label: "Open folders…", icon: "layers", off, act: remote("multi", name) },
        ];
      }),
  ];
}

const usable = (it) => it && !it.machine && !it.off;

const shortcut = (name) => (name && keys().find((b) => b.section === "global" && b.action === name)?.keys) || "";

class Menu {
  init(cx) {
    this.at = 0; // the first item, New space, is always usable
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const space = spaces().find((s) => s.id === props()?.space);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i) {
    const it = items(props()?.space, this.git)[i];
    if (!usable(it)) return;
    closeOverlay(props()?.overlay);
    it.act();
  }

  render() {
    const t = theme();
    const list = items(props()?.space, this.git);
    return v_flex()
      .id("space-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        const step = (by) => {
          for (let i = 1; i <= list.length; i++) {
            const at = (this.at + by * i + list.length * i) % list.length;
            if (usable(list[at])) return (this.at = at);
          }
        };
        if (e.key === "down") step(1);
        else if (e.key === "up") step(-1);
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          it.machine
            ? v_flex()
                .child(div().mx(7).my(4).h(1).bg(t.border))
                .child(
                  h_flex()
                    .h(24)
                    .px(8)
                    .gap(7)
                    .items_center()
                    .text_size(11)
                    .text_color(t.dim)
                    .child(svg(ICON("server")).size(12).flex_none())
                    .child(div().flex_1().min_w(0).truncate().font_medium().child(it.machine))
                    .child(div().flex_none().child(it.note)),
                )
            : v_flex()
                .when(Boolean(it.divide), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
                .child(
                  h_flex()
                    .id(`sm-${i}`)
                    .h(31)
                    .px(8)
                    .gap(9)
                    .rounded(7)
                    .items_center()
                    .text_color(t.foreground)
                    .when(Boolean(it.off), (el) => el.opacity(0.45))
                    .when(!it.off, (el) =>
                      el
                        .cursor_pointer()
                        .when(i === this.at, (e) => e.bg(t.selected))
                        .hover((s) => s.bg(t.hover))
                        .on_click(() => this.choose(i)),
                    )
                    .child(svg(ICON(it.icon)).size(14).flex_none().text_color(t.muted))
                    .child(div().flex_1().child(it.label))
                    .child(div().text_size(11).text_color(t.dim).child(shortcut(it.key))),
                ),
        ),
      );
  }
}

// Waits for the system folder picker, then starts a space in the chosen folder.
// An unnamed space is called after its folder (or repo), as Herdr names them.
class Pick {
  init(cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async () => {
      try {
        const folder = await pickFolder({ prompt: "Open folder as a space" });
        if (folder) run("space.new", { machine: "", folder });
      } catch (e) {
        notify({ title: "Couldn't open the folder", body: String(e?.message ?? e), level: "error" });
      }
      closeOverlay(props()?.overlay);
    });
  }

  render() {
    const t = theme();
    return v_flex()
      .id("space-menu-pick")
      .track_focus(this.handle)
      .size_full()
      .p(18)
      .gap(8)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        closeOverlay(props().overlay);
        cx.stop_propagation();
      })
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .child(svg(ICON("folder-plus")).size(15).flex_none().text_color(t.muted))
          .child(div().flex_1().text_size(15).font_semibold().child("Open folder"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .child(div().text_color(t.muted).child("Choose a folder in the window that just opened. A new space starts there."))
      .child(div().flex_1())
      .child(
        h_flex().justify_end().child(
          div()
            .id("sp-cancel")
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
            .hover((s) => s.opacity(0.88))
            .on_click(() => closeOverlay(props().overlay))
            .child("Cancel"),
        ),
      );
  }
}

const baseName = (path) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
const samePath = (a, b) => a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
const tilde = (path, base = home()) => (base && path.toLowerCase().startsWith(base.toLowerCase()) ? "~" + path.slice(base.length) : path);
const message = (e) => String(e?.message ?? e);
const lines = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const byName = (a, b) => baseName(a).localeCompare(baseName(b), undefined, { sensitivity: "base" });

// Another machine, through `exec` there: what it runs on and its home folder.
// Windows has no `uname`; Git Bash's says MINGW/MSYS, still Windows paths.
const FACTS = new Map();
async function machineFacts(on) {
  if (FACTS.has(on)) return FACTS.get(on);
  const u = await exec("uname", [], { on, timeout: 10000 }).catch((e) => {
    if (/unreachable/i.test(message(e))) throw e;
    return null;
  });
  let facts;
  if (u && u.code === 0 && !/^(MINGW|MSYS|CYGWIN)/i.test(u.stdout)) {
    facts = { win: false, home: (await exec("pwd", [], { on })).stdout.trim() };
  } else {
    facts = { win: true, home: (await powershell(on, "$HOME")).stdout.trim() };
  }
  if (!facts.home) throw new Error(`Couldn't find the home folder on ${on}.`);
  FACTS.set(on, facts);
  return facts;
}

// PowerShell scripts use only single quotes: exec passes them as one argument.
const quote = (text) => `'${text.replace(/'/g, "''")}'`;
const powershell = (on, script, timeout = 30000) =>
  exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`], { on, timeout });

// The folders in a folder, hidden ones (.name, Windows' hidden) left out.
async function listFolders(on, facts, dir) {
  const r = facts.win
    ? await powershell(on, `if (-not (Test-Path -LiteralPath ${quote(dir)} -PathType Container)) { [Console]::Error.WriteLine('No such folder'); exit 1 }; Get-ChildItem -LiteralPath ${quote(dir)} -Directory -ErrorAction SilentlyContinue | Where-Object Name -notlike '.*' | ForEach-Object FullName`)
    : await exec("find", ["-L", dir, "-mindepth", "1", "-maxdepth", "1", "-type", "d", "!", "-name", ".*"], { on, timeout: 30000 });
  // find also exits 1 for one unreadable folder inside, with the rest listed.
  if (r.code !== 0 && !r.stdout.trim()) throw new Error(lines(r.stderr)[0] || `Can't read ${dir}`);
  return lines(r.stdout).sort(byName);
}

// Git repositories up to four folders below home (~\OneDrive\Documents\x\repo),
// not inside hidden folders, links, node_modules, ~/Library or AppData. OneDrive's
// folders are reparse points too, so links are told apart by LinkType.
async function findRepos(on, facts) {
  const r = facts.win
    ? await powershell(on, "$r = New-Object Collections.Generic.List[string]; function W($d, $n) { if (Test-Path -LiteralPath (Join-Path $d '.git')) { $r.Add($d); return }; if ($n -le 0) { return }; foreach ($c in Get-ChildItem -LiteralPath $d -Directory -Force -ErrorAction SilentlyContinue) { if ($c.Name -like '.*' -or $c.Name -in 'node_modules','AppData' -or ($c.Attributes -band [IO.FileAttributes]::Hidden) -or $c.LinkType) { continue }; W $c.FullName ($n - 1) } }; W $HOME 4; $r")
    : await exec("find", [facts.home, "-maxdepth", "5", "-name", ".git", "-print", "-prune", "-o", "(", "-name", ".*", "-o", "-name", "node_modules", "-o", "-name", "Library", ")", "-prune"], { on, timeout: 30000 });
  return lines(r.stdout).map((p) => (facts.win ? p : p.replace(/\/\.git$/, "")));
}

// Typed text that is a path (C:\x, \\server, /x, ~, ~/x), not a name to filter by.
const isPath = (text) => /^([A-Za-z]:|[\\/]|~([\\/]|$))/.test(text);

const parentOf = (dir, win) => {
  const d = dir.replace(win ? /[\\/]+$/ : /\/+$/, "");
  if (win ? /^[A-Za-z]:$/.test(d) : d === "") return null; // a drive's root, or /
  const at = d.lastIndexOf(win ? "\\" : "/");
  if (at < 0) return null;
  const up = d.slice(0, at);
  return win ? (/^[A-Za-z]:$/.test(up) ? up + "\\" : up) : up || "/";
};

// Browses another machine's folders: its projects (git repositories, and where
// its spaces are) at home, a typed path, Up, and the folders in each folder.
// `done(folder | null, cx)` when one is chosen or it is cancelled.
class Browser {
  constructor(machine, done, cx) {
    this.machine = machine;
    this.done = done;
    this.facts = null;
    this.dir = null;
    this.folders = [];
    this.projects = null; // null while looking
    this.loading = true;
    this.error = null;
    this.seq = 0;
    this.filter = ""; // a name typed in the path box narrows the lists
    this.path = InputState.new({ placeholder: "A folder on " + machine });
    this.path.on("change", (_e, cx) => {
      const v = this.path.value().trim();
      this.filter = v && !isPath(v) ? v.toLowerCase() : "";
      cx.notify();
    });
    this.path.on("submit", (_e, cx) => {
      const v = this.path.value().trim();
      if (isPath(v)) return this.go(this.expand(v), cx);
      const [first] = this.shown(); // a name: the first match
      if (first) this.go(first, cx);
    });
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      try {
        this.facts = await machineFacts(machine);
      } catch (e) {
        this.error = message(e);
        this.loading = false;
        return cx.notify();
      }
      this.go(this.facts.home, cx);
      const used = spaces().filter((s) => s.machine === machine).map(place).filter(Boolean);
      const repos = await findRepos(machine, this.facts).catch(() => []);
      this.projects = [...used, ...repos.sort(byName)].filter((p, i, all) => all.findIndex((q) => samePath(p, q)) === i);
      cx.notify();
    });
  }

  // "~" and "~/x" (or "~\x") start at the machine's home.
  expand(text) {
    const t = text.trim();
    if (!t || !this.facts) return null;
    return /^~([\\/]|$)/.test(t) ? this.facts.home + (t.length > 1 ? (this.facts.win ? "\\" : "/") + t.slice(2) : "") : t;
  }

  // Projects (at home) and folders, narrowed by the typed name.
  shown(projects = this.atHome() ? this.projects ?? [] : [], folders = this.folders) {
    const keep = (p) => !this.filter || baseName(p).toLowerCase().includes(this.filter);
    return [...projects.filter(keep), ...folders.filter(keep)];
  }

  atHome() {
    return Boolean(this.dir && this.facts && samePath(this.dir, this.facts.home));
  }

  go(dir, cx) {
    if (!dir || !this.facts) return;
    this.filter = "";
    const seq = ++this.seq, before = this.dir;
    this.loading = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const folders = await listFolders(this.machine, this.facts, dir);
        if (seq !== this.seq) return;
        this.dir = dir;
        this.folders = folders;
      } catch (e) {
        if (seq !== this.seq) return;
        this.error = message(e);
        this.dir = before;
      }
      this.loading = false;
      this.path.set_value(this.dir ?? "");
      cx.notify();
    });
  }

  render({ title, icon, verb }) {
    const t = theme(), home = this.facts?.home, atHome = this.atHome();
    const keep = (p) => !this.filter || baseName(p).toLowerCase().includes(this.filter);
    const projects = (this.projects ?? []).filter(keep), folders = this.folders.filter(keep);
    const up = this.dir && this.facts ? parentOf(this.dir, this.facts.win) : null;
    const label = (text) => div().pt(10).pb(4).px(4).text_size(11.5).text_color(t.dim).child(text);
    const row = (id, path, glyph) => h_flex().id(id).h(30).flex_none().px(8).gap(9).items_center().rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.go(path, cx))
      .child(svg(ICON(glyph)).size(14).flex_none().text_color(t.muted))
      .child(div().flex_none().max_w(200).truncate().child(baseName(path)))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(glyph === "folder" ? "" : tilde(path, home)));
    const button = (id, text, primary, enabled, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
      .when(!enabled, (el) => el.opacity(0.45))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action))
      .child(text);
    return v_flex().id("sm-browse").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        this.done(null, cx);
        cx.stop_propagation();
      })
      .child(h_flex().gap(9).items_center()
        .child(svg(ICON(icon)).size(15).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().child(title))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(h_flex().pt(12).gap(6).items_center()
        .child(h_flex().id("sm-up").size(34).flex_none().items_center().justify_center().rounded(8).border_1().border_color(t.input)
          .when(!up, (el) => el.opacity(0.45))
          .when(Boolean(up), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.go(up, cx)))
          .child(svg(ICON("chevron-left")).size(14).text_color(t.muted)))
        .child(div().flex_1().min_w(0).child(Input.new(this.path).h(34).px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground))))
      .when(Boolean(this.error), (el) => el.child(div().pt(8).text_size(12).text_color(t.ansi1).child(this.error)))
      .child(v_flex().id("sm-list").mt(10).flex_1().min_h(0).overflow_y_scrollbar().rounded(8).border_1().border_color(t.border).bg(t.background).p(4)
        .when(atHome, (el) => el
          .child(label(this.projects === null ? "Projects (looking…)" : "Projects"))
          .when(this.projects?.length === 0, (e) => e.child(div().px(8).pb(4).text_color(t.dim).child("No git repositories found near home.")))
          .when(Boolean(this.projects?.length) && !projects.length, (e) => e.child(div().px(8).pb(4).text_color(t.dim).child("None match.")))
          .children(projects.map((p, i) => row(`sm-p-${i}`, p, "git-branch")))
          .child(label("Folders")))
        .when(this.loading && !this.folders.length, (el) => el.child(div().p(8).text_color(t.dim).child("Loading…")))
        .when(!this.loading && !folders.length && Boolean(this.dir), (el) => el.child(div().p(8).text_color(t.dim).child(this.filter && this.folders.length ? "None match." : "No folders here.")))
        .children(folders.map((f, i) => row(`sm-d-${i}`, f, "folder"))))
      .child(h_flex().pt(14).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child("Type a name to filter, or a path and Enter."))
        .child(button("sm-b-cancel", "Cancel", false, true, (_e, cx) => this.done(null, cx)))
        .child(button("sm-b-ok", this.dir ? `${verb} ${baseName(this.dir)}` : verb, true, Boolean(this.dir) && !this.loading, (_e, cx) => this.done(this.dir, cx))));
  }
}

// Open folder… on another machine: browse there, then a space in that folder.
class Remote {
  init(cx) {
    const machine = props()?.machine;
    this.browser = new Browser(machine, (folder) => {
      if (folder) run("space.new", { machine, folder });
      closeOverlay(props()?.overlay);
    }, cx);
  }

  render() {
    return this.browser.render({ title: `Open folder on ${props()?.machine}`, icon: "folder-plus", verb: "Open" });
  }
}

// Open folders…: several folders, one space.
class Multi {
  init(cx) {
    this.folders = [];
    this.picking = false;
    this.creating = false;
    this.error = null;
    this.agent = false; // start Claude Code with every folder
    this.claude = null; // its launch argv, once known to be installed
    this.machine = props()?.machine ?? null; // another machine's folders, browsed there
    this.browser = null; // while adding a folder on it
    this.name = InputState.new({ value: "" });
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      const found = (await knownAgents(this.machine ? { on: this.machine } : undefined).catch(() => [])).find((a) => a.key === "claude" && a.installed);
      this.claude = found?.run ?? null;
      cx.notify();
    });
    // quiet: open without going straight to the folder picker.
    if (!props()?.quiet) this.add(cx);
  }

  add(cx) {
    if (this.picking || this.creating) return;
    if (this.machine) {
      this.browser = new Browser(this.machine, (folder, cx) => {
        if (folder && !this.folders.some((f) => samePath(f, folder))) this.folders.push(folder);
        this.browser = null;
        this.handle.focus();
        cx.notify();
      }, cx);
      return cx.notify();
    }
    this.picking = true;
    cx.spawn(async (cx) => {
      try {
        const folder = await pickFolder({ prompt: "Add a folder to the space" });
        if (folder && !this.folders.some((f) => samePath(f, folder))) this.folders.push(folder);
        this.error = null;
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.picking = false;
      cx.notify();
    });
    cx.notify();
  }

  // run() returns nothing, so the new space is found by its id appearing; its
  // other tabs are added once it exists. The dialog stays open until then: a
  // closed overlay's timers stop.
  create(cx) {
    if (this.creating || !this.folders.length) return;
    this.creating = true;
    const folders = [...this.folders], [first, ...rest] = folders;
    const before = new Set(spaces().map((s) => s.id));
    const name = this.name.value().trim() || (folders.length > 1 ? folders.map(baseName).join(" + ") : "");
    const withAgent = this.agent && this.claude;
    run("space.new", {
      machine: this.machine ?? "", // without one, this computer's picked folders
      folder: first,
      ...(name ? { name } : {}),
      ...(withAgent ? { argv: [...this.claude, ...rest.flatMap((f) => ["--add-dir", f])] } : {}),
    });
    let tries = 0;
    const finish = () => closeOverlay(props()?.overlay);
    const wait = (cx) => cx.timer.after(100, (cx) => {
      const made = spaces().find((s) => !before.has(s.id));
      if (!made) {
        if (++tries < 50) return wait(cx);
        notify({ title: "The space didn't appear", body: "Its other folders weren't added.", level: "error" });
        return finish();
      }
      const firstTab = made.tabs?.[0]?.id;
      if (firstTab) run("tab.rename", { id: firstTab, name: baseName(first) });
      for (const folder of rest) run("tab.new", { space: made.id, folder, name: baseName(folder) });
      if (firstTab && rest.length) run("tab.select", { id: firstTab });
      finish();
    });
    wait(cx);
    cx.notify();
  }

  render() {
    if (this.browser) return this.browser.render({ title: `Add a folder on ${this.machine}`, icon: "folder-plus", verb: "Add" });
    const t = theme(), n = this.folders.length, there = this.machine ? FACTS.get(this.machine)?.home : home();
    const button = (id, text, primary, enabled, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
      .when(!enabled, (el) => el.opacity(0.45))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action))
      .child(text);
    const label = (text) => div().pt(12).pb(6).text_size(11.5).text_color(t.dim).child(text);
    return v_flex().id("space-menu-multi").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        closeOverlay(props().overlay);
        cx.stop_propagation();
      })
      .child(h_flex().gap(9).items_center()
        .child(svg(ICON("layers")).size(15).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().child(this.machine ? `Open folders on ${this.machine}` : "Open folders"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(8).text_color(t.muted).child("One space with a tab for each folder."))
      .child(label(n ? `Folders (${n})` : "Folders"))
      .child(v_flex().id("sm-folders").flex_1().min_h(0).overflow_y_scrollbar().rounded(8).border_1().border_color(t.border).bg(t.background).p(4)
        .when(!n, (el) => el.child(div().p(8).text_color(t.dim).child(this.picking ? "Choose a folder in the window that just opened." : "No folders yet.")))
        .children(this.folders.map((f, i) => h_flex().id(`sm-f-${i}`).h(30).flex_none().px(8).gap(9).items_center().rounded(6).hover((s) => s.bg(t.hover))
          .child(svg(ICON("folder")).size(14).flex_none().text_color(t.muted))
          .child(div().flex_none().max_w(160).truncate().child(baseName(f)))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(tilde(f, there)))
          .child(div().id(`sm-x-${i}`).p(3).rounded(4).flex_none().text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.raised).text_color(t.foreground))
            .on_click((_e, cx) => { this.folders.splice(i, 1); cx.notify(); })
            .child(svg(ICON("x")).size(12))))))
      .child(h_flex().pt(8)
        .child(h_flex().id("sm-add").h(28).px(10).gap(7).items_center().rounded(7).border_1().border_color(t.input).text_size(12.5)
          .text_color(this.picking ? t.dim : t.foreground)
          .when(!this.picking, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.add(cx)))
          .child(svg(ICON("folder-plus")).size(13).flex_none().text_color(t.muted))
          .child(this.picking ? "Choosing…" : "Add folder…")))
      .child(label("Space name (optional)"))
      .child(Input.new(this.name).h(34).px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .when(Boolean(this.claude), (el) => el.child(h_flex().id("sm-agent").pt(12).gap(9).items_center().cursor_pointer()
        .on_click((_e, cx) => { this.agent = !this.agent; cx.notify(); })
        .child(div().size(15).flex_none().rounded(4).border_1().border_color(this.agent ? t.accent : t.input).when(this.agent, (e) => e.bg(t.accent)).flex().items_center().justify_center()
          .when(this.agent, (e) => e.child(svg(ICON("check")).size(11).text_color(t.accent_foreground))))
        .child(div().child("Start Claude Code with access to all of them"))))
      .when(Boolean(this.error), (el) => el.child(div().pt(10).text_size(12).text_color(t.ansi1).child(this.error)))
      .child(h_flex().pt(14).gap(8).justify_end()
        .child(button("sm-cancel", "Cancel", false, true, () => closeOverlay(props().overlay)))
        .child(button("sm-create", this.creating ? "Creating…" : "Create space", true, n > 0 && !this.creating, (_e, cx) => this.create(cx))));
  }
}

export default class SpaceMenu extends View {
  init(_props, cx) {
    const role = props()?.role;
    this.part = role === "pick" ? new Pick() : role === "multi" ? new Multi() : role === "remote" ? new Remote() : new Menu();
    this.part.init(cx);
  }

  render(cx) {
    return this.part.render(cx);
  }
}
