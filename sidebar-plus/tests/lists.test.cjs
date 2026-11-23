// Modified by cris-achiardi, 2026: from Better Sidebar 3.10.0 (Tawsif Aqib, Apache-2.0); renamed to sidebar-plus; loader accepts CRLF; server row and space fold tests. See NOTICE.
// The lists view: spaces and agents in one block, under tabs or one above the other.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const runtime = path.join(__dirname, "../mods/sidebar-plus");

function element() {
  const node = { nodes: [], handlers: {} };
  const proxy = new Proxy(node, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "child") return (c) => (target.nodes.push(c), proxy);
      if (key === "children") return (c) => (target.nodes.push(...c), proxy);
      if (key === "when") return (c, build) => (c && build(proxy), proxy);
      return (...args) => {
        if (key === "id") target.id = args[0];
        if (key === "on_click") target.handlers.click = args[0];
        return proxy;
      };
    },
  });
  return proxy;
}

async function harness({ settings = {}, tab = null, panes = [], sharedValues = {} } = {}) {
  const pending = [];
  const stored = { "lists.tab": tab };
  const live = { order: [] };
  const tabOf = (id) => ({ id, name: id });
  const spaces = [
    { id: "shop", name: "shop", folder: "/shop", tabs: [tabOf("a"), tabOf("b"), tabOf("d")] },
    { id: "docs", name: "docs", folder: "/docs", tabs: [tabOf("c")] },
  ];
  const agent = (address, space, tab, status) => ({
    address,
    space,
    space_name: space,
    tab,
    tab_name: { a: "1", b: "2", c: "1" }[tab],
    program: { name: "Claude Code" },
    status,
    pane: `p-${address}`,
    seq: 1,
  });
  const agents = [agent("t1", "shop", "a", "idle"), agent("t2", "docs", "c", "done"), agent("t3", "shop", "b", "blocked")];
  live.agents = agents;
  const cx = { notify() {}, stop_propagation() {}, timer: { every() {} }, focus_handle: () => ({}), spawn: (fn) => pending.push(fn(cx)) };
  const context = {
    Date, JSON, Map, Set, Math, console,
    View: class {},
    div: element, svg: (p) => element().child(`svg:${p}`), image: (p) => element().child(`image:${p}`), v_flex: element, h_flex: element,
    Popover: { new: (id) => element().id(id) },
    ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
    spaces: () => spaces,
    agents: () => agents,
    terminals: () => [],
    panes: () => panes,
    focused: () => null,
    machines: () => [],
    theme: () => new Proxy({}, { get: (_t, k) => String(k) }),
    layout: () => ({ id: "sidebar", size: { px: 268 } }),
    window: () => ({ active: true, platform: "macos" }),
    props: () => ({ view: "lists" }),
    shared: (k) => sharedValues[k],
    setShared: (k, v) => (sharedValues[k] = v), // sidebar-plus: kept, so server requests can be read back
    setAgentOrder: (list) => (live.order = [...list]),
    run() {},
    openOverlay() {},
    hc: async () => ({ code: 0, stdout: '{"machines":[]}' }),
    checking: () => false,
    watchFolder: async () => { throw Error("No watcher in tests"); },
    exec: async () => ({ code: 1, stdout: "" }),
    appHome: () => "/app",
    readTextFile: async () => JSON.stringify({ settings }),
    localStorage: { getItem: (k) => stored[k] ?? null, setItem: (k, v) => (stored[k] = v) },
  };
  vm.createContext(context);
  // Each file in its own scope, as a module is; its exports become globals for the next.
  for (const file of ["settings.js", "defaults.js", "git/pr-status.js", "git/checkouts.js", "views/find-node.js", "views/ui.js", "views/spaces.js", "views/agents.js", "views/servers.js", "views/lists.js"]) {
    // sidebar-plus: a Windows checkout (core.autocrlf) has CRLF.
    const source = fs.readFileSync(path.join(runtime, file), "utf8").replace(/\r\n/g, "\n").replace(/^import\s+[\s\S]*?;\n/gm, "");
    const names = [...source.matchAll(/^export (?:async )?(?:class|function|const) (\w+)/gm)].map((m) => m[1]);
    vm.runInContext(`Object.assign(globalThis, (() => { ${source.replaceAll("export ", "")}\nreturn { ${names.join(", ")} }; })());`, context);
  }
  const mod = new context.Lists();
  mod.init({}, cx);
  while (pending.length) await Promise.all(pending.splice(0));
  return { mod, live, stored, cx, sharedValues };
}

const find = (node, id) => (node?.id === id ? node : node?.nodes?.map((n) => find(n, id)).find(Boolean));
const ids = (node, out = []) => (node?.id && out.push(node.id), (node?.nodes ?? []).forEach((n) => ids(n, out)), out);
const text = (node) => (typeof node === "string" ? node : (node?.nodes ?? []).map(text).join(" "));

test("Spaces shows each space's tabs beneath it, as their agents where they have any, and next-agent keys follow that order", async () => {
  const { mod, live } = await harness();
  const drawn = ids(mod.render()).filter((id) => /^(space-(shop|docs)|ag-t\d|tab-\w)$/.test(id));
  assert.deepEqual(drawn, ["space-shop", "ag-t1", "ag-t3", "tab-d", "space-docs", "ag-t2"]);
  // Its tab's title, then its program, quietly.
  assert.match(text(find(mod.render(), "ag-t1")), /^\s*1\s+Claude Code/);
  assert.deepEqual(live.order, ["t1", "t3", "t2"]);
});

test("the Agents tab counts agents, and picking a tab keeps it", async () => {
  const { mod, stored, cx } = await harness();
  const root = mod.render();
  assert.match(text(find(root, "lists-tab-agents")), /Agents 3/);
  assert.equal(find(root, "lists-tab-unread"), undefined);
  find(root, "lists-tab-agents").handlers.click({}, cx);
  assert.equal(stored["lists.tab"], "agents");
});

test("the tab picked last comes back, and an old Unread one falls back to Spaces", async () => {
  assert.ok(find((await harness({ tab: "unread" })).mod.render(), "space-shop"));
  const { mod } = await harness({ tab: "agents" });
  const root = mod.render();
  assert.ok(find(root, "ag-list"));
  assert.equal(find(root, "space-shop"), undefined);
});

test("combined off puts spaces above agents, without tabs", async () => {
  const { mod } = await harness({ settings: { combined: false } });
  const root = mod.render();
  assert.equal(find(root, "lists-tab-spaces"), undefined);
  assert.ok(find(root, "space-shop"));
  assert.ok(find(root, "ag-list"));
  assert.equal(find(root, "space-agents-shop"), undefined);
});

test("in Spaces a pinned agent sits above every space", async () => {
  const { mod, live } = await harness();
  live.agents.find((a) => a.address === "t3").pinned = true;
  const drawn = ids(mod.render()).filter((id) => /^ag-t\d$/.test(id));
  assert.deepEqual(drawn, ["ag-t3", "ag-t1", "ag-t2"]);
  const order = ids(mod.render()).filter((id) => /^(space-(shop|docs)|ag-t\d)$/.test(id));
  assert.deepEqual(order, ["ag-t3", "space-shop", "ag-t1", "space-docs", "ag-t2"]);

});

test("a mod's tab shows its pane's own published icon before the mod's, in colour when it says so", async () => {
  const panes = [{ pane: "pd", tab: "d", mod: "better-files" }];
  const modIcons = { "better-files": "mods/better-files/icons/file.svg" };
  const { mod } = await harness({
    panes,
    sharedValues: { "mod-icons": modIcons, "pane-heads": { pd: { icon: "mods/better-icons/icons/javascript.svg", color: true } } },
  });
  const row = text(find(mod.render(), "tab-d"));
  assert.match(row, /image:mods\/better-icons\/icons\/javascript\.svg/);
  assert.doesNotMatch(row, /svg:mods\/better-files/);
  const { mod: plain } = await harness({
    panes,
    sharedValues: { "mod-icons": modIcons, "pane-heads": { pd: { icon: "mods/better-changes/icons/file.svg" } } },
  });
  assert.match(text(find(plain.render(), "tab-d")), /svg:mods\/better-changes\/icons\/file\.svg/);
  const { mod: other } = await harness({
    panes,
    sharedValues: { "mod-icons": modIcons, "pane-heads": { p9: { icon: "mods/better-icons/icons/javascript.svg", color: true } } },
  });
  assert.match(text(find(other.render(), "tab-d")), /svg:mods\/better-files\/icons\/file\.svg/);
});

test("a split mod tab shows the head any of its panes published", async () => {
  const { mod } = await harness({
    panes: [
      { pane: "pa", tab: "d", mod: "branch-pr" },
      { pane: "pd", tab: "d", mod: "better-files" },
    ],
    sharedValues: {
      "mod-icons": { "branch-pr": "mods/branch-pr/pull-request.svg" },
      "pane-heads": { pd: { icon: "mods/better-icons/icons/javascript.svg", color: true } },
    },
  });
  const row = text(find(mod.render(), "tab-d"));
  assert.match(row, /image:mods\/better-icons\/icons\/javascript\.svg/);
  assert.doesNotMatch(row, /pull-request/);
});

test("an Agents row reads its tab's title, then its space", async () => {
  const { mod } = await harness({ tab: "agents" });
  assert.match(text(find(mod.render(), "ag-t1")), /^\s*1\s+shop/);
});

test("a mod's tab shows the icon the mod publishes, and a tab with neither keeps the gap", async () => {
  const { mod } = await harness({
    panes: [{ pane: "pd", tab: "d", mod: "better-files" }],
    sharedValues: { "mod-icons": { "better-files": "mods/better-files/icons/file.svg" } },
  });
  assert.match(text(find(mod.render(), "tab-d")), /svg:mods\/better-files\/icons\/file\.svg/);
  const { mod: bare } = await harness();
  assert.doesNotMatch(text(find(bare.render(), "tab-d")), /svg:/);
});

test("the Spaces tab offers the space sort beside New space, and Agents its own sort", async () => {
  const { mod } = await harness({ tab: "spaces" });
  const tree = mod.render();
  assert.ok(find(tree, "space-sort-menu"), "space sort on Spaces");
  assert.ok(find(tree, "space-new"));
  const { mod: agentsTab } = await harness({ tab: "agents" });
  const other = agentsTab.render();
  assert.equal(find(other, "space-sort-menu"), undefined);
  assert.ok(find(other, "ag-sort-menu"));
});

// sidebar-plus: servers from the servers mod's shared "servers.spaces".
const server = (pid, port, extra = {}) => ({ pid, port, name: `app${port}`, tool: "node", dir: "/shop", pane: null, restartable: true, stopping: false, share: null, ...extra });

test("sidebar-plus: a space's servers come after its tabs and agents, and unclaimed ones under Other servers", async () => {
  const sharedValues = { "servers.spaces": { at: Date.now(), spaces: { shop: [server(10, 5173)] }, other: [server(11, 8080)] } };
  const { mod } = await harness({ sharedValues });
  const drawn = ids(mod.render()).filter((id) => /^(space-(shop|docs)|ag-t\d|tab-\w|srv-.*)$/.test(id));
  assert.deepEqual(drawn, ["space-shop", "ag-t1", "ag-t3", "tab-d", "srv-10-5173", "space-docs", "ag-t2", "srv-11-8080"]);
  assert.match(text(find(mod.render(), "srv-10-5173")), /app5173\s+:5173/);
  assert.match(text(mod.render()), /Other servers/);
});

test("sidebar-plus: stale or missing server data draws no server rows", async () => {
  const stale = { "servers.spaces": { at: Date.now() - 120000, spaces: { shop: [server(10, 5173)] }, other: [] } };
  assert.ok(!ids((await harness({ sharedValues: stale })).mod.render()).some((id) => String(id).startsWith("srv-")));
  assert.ok(!ids((await harness()).mod.render()).some((id) => String(id).startsWith("srv-")));
});

test("sidebar-plus: a server row opens it, and its buttons ask the servers mod", async () => {
  const sharedValues = { "servers.spaces": { at: Date.now(), spaces: { shop: [server(10, 5173)] }, other: [] } };
  const { mod, cx } = await harness({ sharedValues });
  let opened = null;
  find(mod.render(), "srv-10-5173").handlers.click({}, { open_url: (u) => (opened = u) });
  assert.equal(opened, "http://localhost:5173");
  assert.equal(find(mod.render(), "srv-stop-10-5173"), undefined, "buttons only on hover");
  mod.servers.hovered = "10-5173";
  const root = mod.render();
  assert.ok(find(root, "srv-restart-10-5173") && find(root, "srv-share-10-5173") && find(root, "srv-open-10-5173"));
  find(root, "srv-stop-10-5173").handlers.click({}, cx);
  const r = sharedValues["servers.request"];
  assert.equal(r.action, "stop");
  assert.equal(r.pid, 10);
  assert.equal(r.port, 5173);
  assert.equal(typeof r.at, "number");
  assert.equal(typeof sharedValues["servers.listen"], "number", "it says it listens");
});

test("sidebar-plus: a shared server offers copy and stop sharing instead of share", async () => {
  const sharedValues = { "servers.spaces": { at: Date.now(), spaces: { shop: [server(10, 5173, { share: { url: "https://x.trycloudflare.com" }, restartable: false })] }, other: [] } };
  const { mod } = await harness({ sharedValues });
  mod.servers.hovered = "10-5173";
  const root = mod.render();
  assert.equal(find(root, "srv-share-10-5173"), undefined);
  assert.equal(find(root, "srv-restart-10-5173"), undefined, "no restart without a folder and command");
  assert.ok(find(root, "srv-copy-10-5173") && find(root, "srv-unshare-10-5173"));
});

test("sidebar-plus: a space folds its tabs, agents and servers, counts them, and keeps the choice", async () => {
  const sharedValues = { "servers.spaces": { at: Date.now(), spaces: { shop: [server(10, 5173)] }, other: [] } };
  const { mod, stored, cx, live } = await harness({ sharedValues });
  let root = mod.render();
  assert.ok(find(root, "space-fold-shop"), "a space with rows has a fold button");
  find(root, "space-fold-shop").handlers.click({}, cx);
  assert.deepEqual(JSON.parse(stored["lists.folded-spaces"]), ["shop"]);
  root = mod.render();
  const drawn = ids(root).filter((id) => /^(space-(shop|docs)|ag-t\d|tab-\w|srv-.*)$/.test(String(id)));
  assert.deepEqual(drawn, ["space-shop", "space-docs", "ag-t2"], "shop's rows are gone, docs' stay");
  assert.match(text(find(root, "space-fold-shop")), /4/, "two agents, a tab and a server");
  assert.deepEqual(live.order, ["t1", "t3", "t2"], "next-agent keys still reach a folded space's agents");
  find(root, "space-fold-shop").handlers.click({}, cx);
  assert.ok(ids(mod.render()).includes("ag-t1"), "unfolded again");
});
