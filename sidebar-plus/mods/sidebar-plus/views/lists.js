// Modified by cris-achiardi, 2026: from Better Sidebar 3.10.0 (Tawsif Aqib, Apache-2.0); renamed to sidebar-plus; servers under their spaces; spaces fold. See NOTICE.
// Spaces and agents in one block. Combined (the default): tabs for Spaces, with
// each space's tabs and agents under it, and Agents. With `combined: false` in the settings: the
// two lists one above the other, as two blocks of this mod would draw them.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { focused, theme, setAgentOrder } from "herdr";
import { Spaces } from "./spaces.js";
import { Agents } from "./agents.js";
import { TEXT, Badge, Rail, Icon } from "./ui.js";
import { ServerRows, serversOf, otherServers, listenForServers, SERVERS_LISTEN_EVERY } from "./servers.js";

const TABS = ["spaces", "agents"];

export class Lists {
  init(props, cx) {
    this.spaces = new Spaces();
    this.spaces.init(props, cx);
    this.agents = new Agents();
    this.agents.init(props, cx);
    const saved = localStorage.getItem("lists.tab");
    this.tab = TABS.includes(saved) ? saved : "spaces";
    // sidebar-plus: spaces folded in the Spaces tab, by id, kept across restarts.
    try {
      this.foldedSpaces = new Set(JSON.parse(localStorage.getItem("lists.folded-spaces") ?? "[]"));
    } catch {
      this.foldedSpaces = new Set();
    }
    // sidebar-plus: servers from the servers mod, under their spaces in the Spaces tab.
    this.servers = new ServerRows();
    listenForServers();
    cx.timer.every(SERVERS_LISTEN_EVERY, (cx) => {
      listenForServers();
      cx.notify();
    });
  }

  pick(tab, cx) {
    this.tab = tab;
    localStorage.setItem("lists.tab", tab);
    cx.notify();
  }

  render() {
    const t = theme();
    const collapsed = this.spaces.collapsed();
    const root = v_flex()
      .id("sidebar-plus-lists")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(TEXT.body)
      .on_size_change((size, cx) => this.spaces.resized(size, cx));
    this.spaces.under = null;
    this.spaces.below = null;
    this.spaces.fold = null;
    this.spaces.quiet = null;
    this.spaces.above = null;
    // The rail has no room for tabs: both lists, as numbers.
    if (!this.spaces.settings.combined || collapsed)
      return root
        .child(
          v_flex()
            .flex_1()
            .min_h(0)
            .child(this.spaces.header(t, collapsed))
            .child(this.spaces.body(t, collapsed)),
        )
        .child(v_flex().flex_1().min_h(0).child(this.agents.render()));

    const view = this.agents.readView();
    root.child(this.tabBar(t, view));
    if (this.tab !== "spaces") return root.child(this.agents.render({ view, heading: false }));

    // Spaces, each with its tabs and agents beneath in tab order, so rows don't move as
    // their state changes; next-agent keys follow that order.
    const nested = { ...view, sort: { id: "grouped" }, byPriority: false, nested: true };
    const order = [];
    // The agents as they are listed: a kept sub-agent is under its parent, so
    // it is not drawn again under its space.
    const all = view.model;
    // Pinned agents go above every space, in the Agents tab's Pinned group.
    const pinned = view.groups.find((g) => g.id === "pinned");
    const pins = pinned?.members.map((a) => a.address) ?? [];
    order.push(...pins);
    this.spaces.above = () => (pinned ? this.agents.groupRows(pinned, 0, view, t) : []);
    const nest = (lines, row) => h_flex().children(lines.map((l) => Rail(l))).child(row.flex_1().min_w(0));
    // A space's agents hang from its line; a main space's worktrees come after them,
    // so its line carries on, and a worktree's own agents sit one step further in.
    // Every tab shows: a tab with agents as its agents, any other as itself.
    const shownTab = focused()?.tab;
    const plain = (tab) => !all.some((a) => a.tab === tab.id);
    const now = Date.now();
    const itemsOf = (w) => [
        ...w.tabs.flatMap((tab) =>
          plain(tab)
            ? tab.settled ? [] : [{ tab }]
            : all.filter((a) => a.tab === tab.id && !pins.includes(a.address)).map((a) => ({ a })),
        ),
        // sidebar-plus: the space's servers, after its tabs and agents.
        ...serversOf(w.id, now).map((srv) => ({ srv })),
      ];
    // sidebar-plus: a space with rows under it ends with a fold button; folded, it
    // counts them, colored by its most urgent agent. Next-agent keys still reach
    // a folded space's agents.
    const URGENT = ["blocked", "done", "working"];
    this.spaces.fold = (w, th) => {
      const items = itemsOf(w);
      if (!items.length) return null;
      const folded = this.foldedSpaces.has(w.id);
      const top = URGENT.find((st) => items.some((x) => x.a?.status === st));
      return h_flex()
        .id(`space-fold-${w.id}`)
        .flex_none()
        .h(18)
        .px(3)
        .gap(3)
        .items_center()
        .rounded(4)
        .text_size(TEXT.caption)
        .text_color(folded && top ? (th[top] ?? th.dim) : th.dim)
        .cursor_pointer()
        .tooltip(folded ? "Show its tabs, agents and servers" : "Fold its tabs, agents and servers")
        .hover((st) => st.bg(th.hover).text_color(th.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          cx.stop_propagation();
          if (!this.foldedSpaces.delete(w.id)) this.foldedSpaces.add(w.id);
          localStorage.setItem("lists.folded-spaces", JSON.stringify([...this.foldedSpaces]));
          cx.notify();
        })
        .child(Icon(`chevron-${folded ? "right" : "down"}`, 11))
        .when(folded, (el) => el.child(String(items.length)));
    };
    this.spaces.under = ({ w, tree, kids }) => {
      const items = itemsOf(w);
      order.push(...items.filter((x) => x.a).map((x) => x.a.address));
      if (this.foldedSpaces.has(w.id)) return [];
      const before = tree ? [tree.startsWith("└") ? "" : "│"] : [];
      return items.flatMap((x, i) => {
        const last = i === items.length - 1 && !kids;
        const [row, ...subs] = x.a
          ? this.agents.agentWithSubs(x.a, i, nested, t)
          : x.srv
            ? [this.servers.row(x.srv, t)]
            : [this.agents.tabRow(w, x.tab, x.tab.id === shownTab, t)];
        return [nest([...before, last ? "└" : "├"], row), ...subs.map((s) => nest([...before, last ? "" : "│"], s))];
      });
    };
    // sidebar-plus: servers no space claims, last, under their own heading.
    const others = otherServers(now);
    this.spaces.below = () =>
      others.length
        ? [
            div().px(8).pt(12).pb(4).text_size(TEXT.caption).text_color(t.dim).child("Other servers"),
            ...others.map((srv) => this.servers.row(srv, t)),
          ]
        : [];
    // One row lit: a space whose focused agent or tab shows beneath it leaves it to that row.
    this.spaces.quiet = (w) =>
      all.some((a) => a.space === w.id && a.focused) || w.tabs.some((tab) => tab.id === shownTab && plain(tab));
    const body = this.spaces.body(t, false);
    setAgentOrder(order);
    return root.child(body);
  }

  // Tabs side by side from the left, the picked one filled.
  tabBar(t, view) {
    const tab = (id, label, count) =>
      h_flex()
        .id(`lists-tab-${id}`)
        .px(10)
        .h(24)
        .gap(5)
        .justify_center()
        .items_center()
        .rounded(6)
        .cursor_pointer()
        .text_size(TEXT.label)
        .font_medium()
        .text_color(this.tab === id ? t.foreground : t.dim)
        .when(this.tab === id, (el) => el.bg(t.selected))
        .when(this.tab !== id, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .on_click((_e, cx) => this.pick(id, cx))
        .child(label)
        // The count badge the group headers use.
        .when(count !== null, (el) => el.child(Badge(count)));
    return h_flex()
      .px(8)
      .pt(6)
      .pb(6)
      .mb(4)
      .border_b(1)
      .border_color(t.border)
      .flex_none()
      .gap(6)
      .items_center()
      .child(
        h_flex()
          .flex_1()
          .gap(2)
          .child(tab("spaces", "Spaces", null))
          .child(tab("agents", "Agents", view.count)),
      )
      .child(this.tab === "spaces" ? this.spaces.headerButtons() : this.agents.sortMenu());
  }
}
