// The Spaces list's right-click menu, opened as a popup with props { space? }.
// Always: New space, Open folder… (pick a folder, start a space in it).
// On a space's row (props.space = its id) also Herdr's own space items:
// Rename, the worktree dialogs, Close.
// Role "pick" (props { role: "pick" }) is a small dialog that stays up while the
// system folder picker is open: a popup's tasks end when it closes, so the
// popup can't wait for the picker itself.
// Role "multi" (props { role: "multi" }) is the Open folders… dialog: collect
// several folders (the system picker gives one at a time), then one space with a
// tab per folder, each tab named after its folder. Optionally the first tab runs
// Claude Code with the other folders passed as `--add-dir`. A space is not a
// sandbox: this scopes what the agent is given, it does not fence the terminals.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, spaces, panes, exec, pickFolder, notify, knownAgents, home } from "herdr";

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

// An item is { label, icon, act, key?, divide? }; act runs after the popup closes.
function items(space, git) {
  const worktree = (action) => () =>
    openOverlay({ mod: "worktree", kind: "dialog", ...(action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: { space, action } });
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
  ];
}

const shortcut = (name) => (name && keys().find((b) => b.section === "global" && b.action === name)?.keys) || "";

class Menu {
  init(cx) {
    this.at = 0;
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
    if (!it) return;
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
          v_flex()
            .when(Boolean(it.divide), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(
              h_flex()
                .id(`sm-${i}`)
                .h(31)
                .px(8)
                .gap(9)
                .rounded(7)
                .items_center()
                .cursor_pointer()
                .text_color(t.foreground)
                .when(i === this.at, (el) => el.bg(t.selected))
                .hover((s) => s.bg(t.hover))
                .on_click(() => this.choose(i))
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
        if (folder) run("space.new", { folder });
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
const tilde = (path) => (path.toLowerCase().startsWith(home().toLowerCase()) ? "~" + path.slice(home().length) : path);

// Open folders…: several folders, one space.
class Multi {
  init(cx) {
    this.folders = [];
    this.picking = false;
    this.creating = false;
    this.error = null;
    this.agent = false; // start Claude Code with every folder
    this.claude = null; // its launch argv, once known to be installed
    this.name = InputState.new({ value: "" });
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      const found = (await knownAgents().catch(() => [])).find((a) => a.key === "claude" && a.installed);
      this.claude = found?.run ?? null;
      cx.notify();
    });
    // quiet: open without going straight to the folder picker.
    if (!props()?.quiet) this.add(cx);
  }

  add(cx) {
    if (this.picking || this.creating) return;
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
    const t = theme(), n = this.folders.length;
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
        .child(div().flex_1().text_size(15).font_semibold().child("Open folders"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(8).text_color(t.muted).child("One space with a tab for each folder."))
      .child(label(n ? `Folders (${n})` : "Folders"))
      .child(v_flex().id("sm-folders").flex_1().min_h(0).overflow_y_scrollbar().rounded(8).border_1().border_color(t.border).bg(t.background).p(4)
        .when(!n, (el) => el.child(div().p(8).text_color(t.dim).child(this.picking ? "Choose a folder in the window that just opened." : "No folders yet.")))
        .children(this.folders.map((f, i) => h_flex().id(`sm-f-${i}`).h(30).flex_none().px(8).gap(9).items_center().rounded(6).hover((s) => s.bg(t.hover))
          .child(svg(ICON("folder")).size(14).flex_none().text_color(t.muted))
          .child(div().flex_none().max_w(160).truncate().child(baseName(f)))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(tilde(f)))
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
    this.part = role === "pick" ? new Pick() : role === "multi" ? new Multi() : new Menu();
    this.part.init(cx);
  }

  render(cx) {
    return this.part.render(cx);
  }
}
