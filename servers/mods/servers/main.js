// A sidebar section listing the local servers that are running: every process
// listening on a TCP port that was started from a Herdr terminal or is a dev
// runtime (node, bun, python, ...), grouped under the space it belongs to.
// Each one has buttons that restart it, stop it, share it through a public
// link (a Cloudflare quick tunnel) and open it in the browser.
// A space's row folds its servers away, as a file's row does in figma-bridge.
// Its top edge is a grip: dragged, it sets the section's height.
// The list comes from scan.js, run every few seconds while the section is shown,
// or while another mod listens (shared "servers.listen", a time within LISTEN).
// Each scan is also published as shared "servers.spaces" ({ at, spaces: { <space
// id>: [server] }, other: [server] }, see publish()), and the buttons can be
// pressed from elsewhere through shared "servers.request" ({ id, action, pid,
// port, at }; see requests()), for a sidebar that lists servers under their
// spaces (sidebar-plus).
// props { demo: true } draws sample rows without running anything; with
// { folded: ["b"] } the second sample space starts folded.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Slider, SliderTrack, SliderIndicator, SliderThumb, SliderState } from "gpui-base";
import { spaces, panes, terminals, agents, exec, hc, theme, layout, props, home, window, run, notify, shared, setShared } from "herdr";
import { scan, listeners, argv } from "./scan.js";

const MOD = "servers";
const ICON = (name) => `mods/${MOD}/${name}.svg`;
const EVERY = 5000;
const HEAD = 41, GROUP = 28, ROW = 28, SHARE = 26, NOTE = 48, FOOT = 8, MAX = 300, GRIP = 6, REACH = 4000;
const OTHER = "other"; // the group of servers no space claims
const LISTEN = 60000;    // a listener's mark keeps scans going this long while the section is hidden
const REPUBLISH = 20000; // an unchanged "servers.spaces" is still rewritten this often, so its `at` stays fresh
// Agent programs listen on local ports of their own (Codex does): they are agents,
// listed as such elsewhere, not servers. Matched by process name, besides the
// terminals Herdr knows run an agent.
const AGENT_PROGRAMS = /^(codex|claude)$/i;
const ASK = 250;         // how often "servers.request" is looked at
const STALE_ASK = 10000; // a request older than this is ignored (one left from before a restart)

const DEMO = [
  { space: "a", label: "website", servers: [{ port: 4321, pid: 1, name: "website", tool: "astro", link: "https://quiet-river-sample.trycloudflare.com" }, { port: 6006, pid: 2, name: "storybook", tool: "storybook" }] },
  { space: "b", label: "api", servers: [{ port: 8000, pid: 3, name: "api", tool: "uvicorn" }] },
];

// This mod's layout block, whether it is on screen (see the github mod),
// whether it ends a column (its top edge is then the one that moves) and the
// block shown above it there.
function block(node = layout(), path = []) {
  if (!node || typeof node !== "object") return null;
  const here = [...path, node];
  const col = path.at(-1)?.type === "column" ? path.at(-1).children.filter((c) => !c.hidden) : [];
  if (node.content?.mod === MOD) return { id: node.id, px: node.size?.px ?? null, last: col.at(-1) === node, above: col[col.indexOf(node) - 1], shown: !here.some((n, i) => n.hidden || (n.type === "stack" && here[i + 1] && n.active !== here[i + 1].id)) };
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
    this.restarting = new Set(); // ports
    this.pending = new Set();    // ports whose tunnel is starting
    this.fresh = new Set();      // ports whose address is copied when it arrives
    this.urls = new Map();       // tunnel terminal -> public address
    this.missed = new Map();     // port -> reloads its server has been gone
    try { this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]")); } catch { this.folded = new Set(); }
    if (this.demo) { this.folded = new Set(props().folded ?? []); return; }
    try { [this.at, this.kept, this.from] = JSON.parse(localStorage.getItem("fit") ?? "[]"); } catch { /* fits anew */ }
    // The grip is a slider: the only press a mod keeps hearing from once the
    // pointer has left the element. Its value is the pointer's height over the
    // block's bottom edge, in layout px whatever the zoom (0 under that edge).
    this.grip = SliderState.new({ min: 0, max: REACH });
    this.grip.on("change", (v) => this.pull(v));
    this.grip.on("release", (_v, cx) => this.drop(cx));
    cx.timer.every(EVERY, (cx) => { if (!this.loading && ((block()?.shown ?? true) || this.listened())) this.poll(cx); });
    this.asked = shared("servers.request")?.id ?? null; // one already there was meant for an earlier run
    cx.timer.every(ASK, (cx) => this.requests(cx));
    this.poll(cx);
  }

  // Whether a listening process is an agent itself: an agent program by name, or the
  // program (or foreground program) of a terminal Herdr lists as an agent.
  isAgent(s) {
    if (AGENT_PROGRAMS.test(s.proc ?? "")) return true;
    const live = new Set(agents().map((a) => a.address));
    return terminals().some((t) => live.has(t.address) && (t.pid === s.pid || t.foreground?.pid === s.pid));
  }

  listened() {
    const at = shared("servers.listen");
    return typeof at === "number" && Date.now() - at < LISTEN;
  }

  // The list as another mod draws it: servers by space id, the unclaimed under
  // `other`. `share` is null, or { url } with url null while the tunnel starts.
  // Written when it changed, or to keep `at` fresh; a reader treats an old `at`
  // as this mod having stopped.
  publish(force = false) {
    if (this.demo || !this.servers) return;
    const shares = this.shares();
    const entry = (s) => {
      const address = shares.get(s.port);
      const on = Boolean(address) || this.pending.has(s.port);
      return {
        pid: s.pid, port: s.port, name: s.name, tool: s.tool ?? null, dir: s.dir ?? null, pane: s.pane ?? null,
        restartable: Boolean(s.dir && s.cmd), stopping: this.stopping.has(s.pid),
        share: on ? { url: (address && this.urls.get(address)) || null } : null,
      };
    };
    const out = { spaces: {}, other: [] };
    for (const g of groups(this.servers)) {
      if (g.space === OTHER) out.other = g.servers.map(entry);
      else out.spaces[g.space] = g.servers.map(entry);
    }
    const text = JSON.stringify(out), now = Date.now();
    if (!force && text === this.published && now - (this.publishedAt ?? 0) < REPUBLISH) return;
    this.published = text;
    this.publishedAt = now;
    setShared("servers.spaces", { at: now, ...out });
  }

  // A button pressed in another mod: the newest request, once, if it is recent
  // and names a server listed now (by pid and port).
  requests(cx) {
    const r = shared("servers.request");
    if (!r || r.id == null || r.id === this.asked) return;
    this.asked = r.id;
    if (typeof r.at !== "number" || Date.now() - r.at > STALE_ASK) return;
    if (r.action === "unshare") return this.unshare(r.port, cx);
    const s = this.servers?.find((x) => x.pid === r.pid && x.port === r.port);
    if (!s) return;
    if (r.action === "stop") this.stop(s, cx);
    else if (r.action === "restart" && s.dir && s.cmd) this.restart(s, cx);
    else if (r.action === "share") this.share(s, cx);
  }

  poll(cx) {
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        this.servers = (await scan(exec, window().platform, this.cache)).filter((s) => !this.isAgent(s));
        const pids = new Set(this.servers.map((s) => s.pid));
        for (const pid of this.stopping) if (!pids.has(pid)) this.stopping.delete(pid);
        this.error = null;
        await this.links(cx);
        this.publish();
      } catch (e) {
        this.error = { title: "Couldn't list the servers", body: String(e?.message ?? e).slice(0, 160) };
      } finally { this.loading = false; cx.notify(); }
    });
  }

  // The tunnels: live herdr-core terminals named share-<port>, each running
  // cloudflared for that port. Map port -> terminal address.
  shares() {
    const found = new Map();
    for (const t of terminals()) {
      const m = /^share-(\d+)$/.exec(t.name ?? "");
      if (m && (t.state ?? "live") === "live") found.set(Number(m[1]), t.address);
    }
    return found;
  }

  // Reads each new tunnel's public address off its terminal, and ends the
  // tunnels whose server has been gone for three reloads.
  async links(cx) {
    const shared = this.shares(), ports = new Set(this.servers.map((s) => s.port));
    for (const address of this.urls.keys()) if (![...shared.values()].includes(address)) this.urls.delete(address);
    for (const [port, address] of shared) {
      this.pending.delete(port);
      if (!this.urls.has(address)) {
        const url = (await hc(["read", address, "--lines", "200"])).stdout.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
        if (url) {
          this.urls.set(address, url);
          if (this.fresh.delete(port)) { cx.write_to_clipboard(url); notify({ title: "Public link copied", body: url, level: "success" }); }
        }
      }
      const missed = ports.has(port) || this.restarting.has(port) ? 0 : (this.missed.get(port) ?? 0) + 1;
      this.missed.set(port, missed);
      if (missed >= 3) { this.missed.delete(port); await hc(["kill", address]); }
    }
  }

  // The cloudflared program: on PATH, else where its installers put it (a
  // running Herdr doesn't see a PATH changed after it started).
  async cloudflared() {
    const places = window().platform === "windows"
      ? ["cloudflared", "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe", "C:\\Program Files\\cloudflared\\cloudflared.exe"]
      : ["cloudflared", "/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"];
    for (const path of places) {
      try { if ((await exec(path, ["--version"], { timeout: 10000 })).code === 0) return path; } catch { /* not there */ }
    }
    return null;
  }

  // Gives the server a public address: a Cloudflare quick tunnel, run as a
  // herdr-core terminal without a pane. Its address is copied once it is known.
  share(s, cx) {
    if (this.pending.has(s.port) || this.shares().has(s.port)) return;
    this.pending.add(s.port);
    this.publish(true);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        this.tunnel ??= await this.cloudflared();
        if (!this.tunnel) throw new Error("cloudflared isn't installed. Windows: winget install Cloudflare.cloudflared. macOS: brew install cloudflared.");
        // The Host header is rewritten because Vite-based servers refuse hosts they don't know.
        const r = await hc(["run", "--json", "--bg", "--rm", "--no-parent", "--name", `share-${s.port}`, "--", this.tunnel, "tunnel", "--url", `http://localhost:${s.port}`, "--http-host-header", "localhost"]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0]);
        this.fresh.add(s.port);
      } catch (e) {
        this.pending.delete(s.port);
        notify({ title: `Couldn't share ${s.name} :${s.port}`, body: String(e?.message ?? e).slice(0, 200), level: "error" });
      }
      cx.notify();
    });
  }

  unshare(port, cx) {
    const address = this.shares().get(port);
    this.pending.delete(port); this.fresh.delete(port);
    if (!address) return this.publish(true);
    cx.spawn(async (cx) => { await hc(["kill", address]); this.publish(true); cx.notify(); });
  }

  // Ends the server's process and the ones it started.
  async kill(s) {
    const r = window().platform === "windows" ? await exec("taskkill", ["/PID", String(s.pid), "/T", "/F"]) : await exec("kill", [String(s.pid)]);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0]);
  }

  stop(s, cx) {
    if (this.stopping.has(s.pid)) return;
    this.stopping.add(s.pid);
    this.publish(true);
    cx.notify();
    this.unshare(s.port, cx);
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
    this.restarting.add(s.port); // its tunnel, if any, stays for the new one
    this.publish(true);
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
      this.restarting.delete(s.port);
      this.poll(cx);
    });
  }

  // The block takes the height of what it lists, unfolded (a personal layout
  // only), until the person sets one: with the grip, or by dragging Herdr's
  // own divider where one reaches this block (a height this mod didn't ask
  // for). That height is kept whatever is listed, until a double-click on the
  // grip or the heading. `at` is the height last asked for or seen (the first
  // one seen, with nothing stored); `from` the one it replaced, which layout()
  // can still show (always, in a shipped layout) until `at` is seen. Herdr
  // keeps the height itself; every change of the three is stored as it
  // happens, or a restart would misread a drag.
  fit(height) {
    const me = block(), px = Math.min(MAX, height);
    if (!me?.id) return;
    if (this.at == null || me.px === this.at) this.keep(me.px, this.kept === true, me.px);
    else if (me.px != null && me.px !== this.from) this.keep(me.px, true, me.px);
    if (this.kept || me.px === px || this.at === px) return;
    this.keep(px, false, me.px);
    run("layout.resize", { id: me.id, px });
  }

  // The grip, pulled: the height at the press plus how far the pointer has
  // gone since, as Herdr's own dividers do it. Nothing drawn after the press is
  // read (it lags the pointer, and is in zoomed px), so a height asked for
  // twice, or late, is still the right one. A px-sized block above gives or
  // takes the same amount, down to its own heading, so its top edge stays
  // where it is; a weighted one takes what is left by itself.
  pull(v) {
    const me = block(), up = me?.above;
    if (!me?.id || me.px == null) return;
    const d = this.drag ??= { v, px: me.px, to: me.px, up: up?.id ? up.size?.px ?? null : null };
    const room = d.up == null ? Infinity : Math.max(0, d.up - Math.max(HEAD, up.min ?? 0));
    const px = Math.max(HEAD, d.px + Math.min(room, v - d.v));
    if (px === d.to) return;
    d.to = px; d.moved = true;
    this.keep(px, true, me.px);
    if (d.up != null) run("layout.resize", { id: up.id, px: d.up - (px - d.px) });
    run("layout.resize", { id: me.id, px });
  }

  // The grip, let go. Two presses that moved nothing are a double-click.
  drop(cx) {
    const d = this.drag, now = Date.now();
    this.drag = null;
    if (d?.moved) return;
    if (now - this.tap < 400) this.auto(cx);
    this.tap = now;
  }

  // Back to the height of what is listed.
  auto(cx) {
    const px = block()?.px ?? null;
    this.keep(px, false, px);
    cx.notify();
  }

  keep(at, kept, from) {
    if (at === this.at && kept === this.kept && from === this.from) return;
    this.at = at; this.kept = kept; this.from = from;
    localStorage.setItem("fit", JSON.stringify([at, kept, from]));
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

  // Under a shared server: its public address (click to copy) and a button
  // that ends the tunnel. `url` is null while the tunnel is starting.
  shareRow(s, url, t) {
    return h_flex().id(`l-${s.port}`).h(SHARE).flex_none().pl(45).pr(8).gap(6).items_center().rounded(8).text_size(11)
      .when(Boolean(url), (el) => el.cursor_pointer().hover((h) => h.bg(t.hover))
        .tooltip("Public link: anyone who has it can see this server. Click to copy.")
        .on_click((_e, cx) => { if (this.demo) return; cx.write_to_clipboard(url); notify({ title: "Public link copied", body: url, level: "success" }); }))
      .child(url ? svg(ICON("link")).size(12).flex_none().text_color(t.accent) : svg(ICON("spinner")).size(12).flex_none().text_color(t.dim).spin(900))
      .child(div().flex_1().min_w(0).truncate().text_color(url ? t.muted : t.dim).child(url ? url.replace(/^https:\/\//, "") : "Creating link…"))
      .child(this.button(`u-${s.port}`, "x", "Stop sharing", t.foreground, t, (cx) => { if (!this.demo) this.unshare(s.port, cx); }));
  }

  serverRow(g, s, t, shared) {
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
        .when(!shared, (el) => el.child(this.button(`h-${s.pid}-${s.port}`, "share", "Share a public link", t.accent, t, (cx) => { if (!this.demo) this.share(s, cx); })))
        .child(this.button(`o-${s.pid}-${s.port}`, "external", "Open in browser", t.foreground, t, (cx) => cx.open_url(`http://localhost:${s.port}`))));
  }

  render() {
    const t = theme();
    const list = this.demo ? DEMO : this.servers ? groups(this.servers) : [];
    const count = list.reduce((n, g) => n + g.servers.length, 0);
    const shares = this.demo ? new Map() : this.shares();
    const rows = [], me = this.demo ? null : block();
    let height = HEAD + FOOT;
    // Folded server rows still count toward the height, so folding a space
    // doesn't resize the block and move the heading.
    const add = (el, h) => { if (el) rows.push(el); height += h; };
    if (this.error) add(this.note(this.error.title, this.error.body, t), NOTE);
    else if (this.servers && !count) add(this.note("No servers running", "A dev server shows here once it listens on a port.", t), NOTE);
    else for (const g of list) {
      add(this.groupRow(g, t), GROUP);
      for (const s of g.servers) {
        const open = !this.folded.has(g.space), address = shares.get(s.port);
        const shared = Boolean(address) || this.pending.has(s.port) || Boolean(s.link);
        add(open ? this.serverRow(g, s, t, shared) : null, ROW);
        if (shared) add(open ? this.shareRow(s, s.link ?? this.urls.get(address) ?? null, t) : null, SHARE);
      }
    }
    if (!this.demo && (this.servers || this.error)) this.fit(height); // not before the first list: it would shrink and regrow

    return v_flex().relative().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13).text_color(t.foreground)
      .when(this.demo, (el) => el.w(268).h(height)) // the sidebar's width, for a picture
      .child(
        h_flex().id("head").h(HEAD).pt(14).pb(5).px(16).flex_none().items_center().justify_between()
          .on_mouse_down("left", (e, cx) => { if (e.click_count === 2 && !this.demo) this.auto(cx); })
          .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Servers"))
          .when(count > 0, (el) => el.child(div().text_size(11).text_color(this.error ? t.ansi1 : t.dim).child(String(count)))),
      )
      .child(v_flex().id("list").flex_1().min_h(0).px(8).overflow_y_scrollbar().children(rows))
      // Last, so it is over the heading. The track is the grip; the indicator
      // is the box the pointer is measured in, REACH up from the block's bottom
      // edge: that edge stays put while the top one moves, so the box does too.
      .when(me?.last, (el) => el.child(
        Slider.new(this.grip).axis("vertical").absolute().inset_0()
          .child(SliderTrack.new(this.grip).axis("vertical").absolute().top_0().left_0().right_0().h(GRIP).cursor_row_resize().hover((s) => s.bg(t.selected)))
          .child(SliderIndicator.new(this.grip).axis("vertical").absolute().bottom_0().left_0().w_full().h(REACH)
            .child(SliderThumb.new(this.grip).axis("vertical").size(0))),
      ));
  }
}
