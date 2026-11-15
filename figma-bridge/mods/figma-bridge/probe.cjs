// Prints one JSON line describing the figma-console-mcp bridges on this computer:
// which are up, how many Figma files are connected, which files those are, and
// which Claude Code session last worked on each. Run by main.js with node (the
// bridge itself needs node, so it is there whenever there is something to show).
//
// Sources, all local and read-only:
//   <tmp>/figma-console-mcp-<port>.json   a running bridge: port, pid
//   http://localhost:<port>/health        connectedClients: files connected to it
//   the process table                     the bridge's ancestors (agent, shell)
//   ~/.claude/sessions/<pid>.json         the Claude Code session of an ancestor
//   ~/.claude/projects/*/<session>.jsonl  its figma-console tool calls and answers
// A bridge doesn't say which files are connected, only how many. Names and keys
// come from what the bridge answered an agent (figma_get_status and others).
//
// State between runs (ancestors, how far each transcript was read) is kept in
// <tmp>/herdr-figma-bridge.json, so a run reads only what was appended.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const TMP = os.tmpdir();
const STATE = path.join(TMP, "herdr-figma-bridge.json");
const CLAUDE = path.join(os.homedir(), ".claude");
const TOOL = /^mcp__figma-console[^_]*__(.+)$/;
const PENDING_MAX = 5 * 60 * 1000; // a call with no answer for this long was abandoned
const FILE_URL = /figma\.com\/(?:design|file|board|slides|proto)\/([A-Za-z0-9]{10,})/;
const PAIR = /"fileName":"((?:[^"\\]|\\.)*)","fileKey":"([A-Za-z0-9]+)"(?:,"currentPage":"((?:[^"\\]|\\.)*)")?/g;

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const unquote = (s) => { try { return JSON.parse(`"${s}"`); } catch { return s; } };

// pid -> parent pid, for every process.
function parents() {
  const map = new Map();
  try {
    const out = process.platform === "win32"
      ? execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }"], { encoding: "utf8", timeout: 15000, windowsHide: true })
      : execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8", timeout: 15000 });
    for (const line of out.split("\n")) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      if (pid) map.set(pid, ppid || 0);
    }
  } catch {}
  return map;
}

function ancestorsOf(pid, table) {
  const chain = [];
  for (let at = table.get(pid); at && !chain.includes(at) && chain.length < 12; at = table.get(at)) chain.push(at);
  return chain;
}

async function health(port) {
  try {
    const r = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

function transcriptOf(session) {
  const name = `${session.sessionId}.jsonl`;
  const guess = path.join(CLAUDE, "projects", String(session.cwd ?? "").replace(/[^a-zA-Z0-9]/g, "-"), name);
  if (fs.existsSync(guess)) return guess;
  try {
    for (const dir of fs.readdirSync(path.join(CLAUDE, "projects"))) {
      const file = path.join(CLAUDE, "projects", dir, name);
      if (fs.existsSync(file)) return file;
    }
  } catch {}
  return null;
}

// Reads what was appended to a transcript since `seen.offset` and folds its
// figma-console calls into `seen`.
function scan(file, seen) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return; }
  if (seen.file !== file || size < seen.offset) Object.assign(seen, { file, offset: 0, pending: {}, files: {}, last: null, active: null, listed: null });
  if (size === seen.offset) return;
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - seen.offset);
    fs.readSync(fd, buf, 0, buf.length, seen.offset);
    const end = buf.lastIndexOf(10);
    if (end < 0) return;
    seen.offset += end + 1;
    for (const line of buf.subarray(0, end).toString("utf8").split("\n")) {
      const waiting = Object.keys(seen.pending);
      if (!line.includes("mcp__figma-console") && !waiting.some((id) => line.includes(id))) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const blocks = entry?.message?.content;
      if (!Array.isArray(blocks)) continue;
      const at = Date.parse(entry.timestamp) || Date.now();
      for (const b of blocks) {
        if (b?.type === "tool_use" && TOOL.test(b.name ?? "")) {
          const input = b.input ?? {};
          const key = typeof input.fileKey === "string" ? input.fileKey : (FILE_URL.exec(String(input.url ?? input.fileUrl ?? "")) ?? [])[1] ?? null;
          seen.pending[b.id] = { at, key };
          seen.last = { at, tool: TOOL.exec(b.name)[1], key: key ?? seen.active };
          if (key) seen.files[key] = { ...(seen.files[key] ?? { name: null, page: null }), seen: at };
        } else if (b?.type === "tool_result" && seen.pending[b.tool_use_id]) {
          const call = seen.pending[b.tool_use_id];
          delete seen.pending[b.tool_use_id];
          const text = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((c) => c?.text ?? "").join("\n") : "";
          if (!text.includes('"fileKey"')) { if (seen.last) seen.last.at = Math.max(seen.last.at, at); continue; }
          const listed = [];
          for (const m of text.matchAll(PAIR)) {
            seen.files[m[2]] = { name: unquote(m[1]), page: m[3] ? unquote(m[3]) : seen.files[m[2]]?.page ?? null, seen: at };
            listed.push(m[2]);
          }
          const active = /"connectedFile":\{"fileName":"(?:[^"\\]|\\.)*","fileKey":"([A-Za-z0-9]+)"/.exec(text)?.[1] ?? null;
          if (active) seen.active = active;
          // figma_get_status and figma_list_open_files name every connected file.
          if (text.includes('"connectedFiles":[') || text.includes('"files":[')) seen.listed = { at, keys: [...new Set(listed)] };
          if (seen.last) { seen.last.at = Math.max(seen.last.at, at); seen.last.key = call.key ?? active ?? seen.last.key; }
        }
      }
    }
  } finally { fs.closeSync(fd); }
}

(async () => {
  const now = Date.now();
  const state = readJson(STATE) ?? {};
  const procs = state.procs ?? {}, scans = state.scans ?? {};

  const ads = fs.readdirSync(TMP).filter((f) => /^figma-console-mcp-\d+\.json$/.test(f))
    .map((f) => readJson(path.join(TMP, f))).filter((a) => a?.port && a?.pid && alive(a.pid));

  let table = null;
  const bridges = await Promise.all(ads.map(async (ad) => {
    const id = `${ad.pid}:${ad.startedAt}`;
    if (!procs[id]) { table ??= parents(); procs[id] = ancestorsOf(ad.pid, table); }
    const h = await health(ad.port);
    return { port: ad.port, pid: ad.pid, up: Boolean(h), version: h?.version ?? null, connected: h?.connectedClients ?? 0, ancestors: procs[id] };
  }));
  for (const id of Object.keys(procs)) if (!ads.some((ad) => `${ad.pid}:${ad.startedAt}` === id)) delete procs[id];

  // One entry per Claude Code session that owns a bridge.
  const sessions = new Map();
  for (const b of bridges) {
    const pid = b.ancestors.find((p) => fs.existsSync(path.join(CLAUDE, "sessions", `${p}.json`)));
    const info = pid ? readJson(path.join(CLAUDE, "sessions", `${pid}.json`)) : null;
    b.session = info?.sessionId ?? null;
    if (!info?.sessionId || sessions.has(info.sessionId)) continue;
    const seen = (scans[info.sessionId] ??= { file: null, offset: 0, pending: {}, files: {}, last: null, active: null, listed: null });
    const file = transcriptOf(info);
    if (file) scan(file, seen);
    for (const [id, call] of Object.entries(seen.pending)) if (now - call.at > PENDING_MAX) delete seen.pending[id];
    sessions.set(info.sessionId, { id: info.sessionId, pid, name: info.name ?? null, cwd: info.cwd ?? null, ancestors: b.ancestors, seen });
  }
  for (const id of Object.keys(scans)) if (!sessions.has(id)) delete scans[id];

  // The files connected now: as many as the bridges count, the most recently
  // named ones first. The newest full listing wins over single sightings.
  const connected = bridges.reduce((n, b) => Math.max(n, b.connected), 0);
  const known = new Map();
  let listing = null;
  for (const s of sessions.values()) {
    for (const [key, f] of Object.entries(s.seen.files)) {
      const had = known.get(key);
      known.set(key, { key, name: f.name ?? had?.name ?? null, page: (f.seen >= (had?.seen ?? 0) ? f.page : had?.page) ?? null, seen: Math.max(f.seen, had?.seen ?? 0) });
    }
    if (s.seen.listed && (!listing || s.seen.listed.at > listing.at)) listing = s.seen.listed;
  }
  const rank = (f) => (listing && f.seen > listing.at ? 2 : listing?.keys.includes(f.key) ? 1 : 0);
  const files = [...known.values()].sort((a, b) => rank(b) - rank(a) || b.seen - a.seen).slice(0, connected).map((f) => ({
    key: f.key, name: f.name, page: f.page, url: `https://www.figma.com/file/${f.key}`,
    agents: [...sessions.values()].filter((s) => s.seen.last?.key === f.key).map((s) => ({
      session: s.id, name: s.name, cwd: s.cwd, ancestors: s.ancestors, tool: s.seen.last.tool, at: s.seen.last.at,
      calling: Object.keys(s.seen.pending).length > 0,
    })).sort((a, b) => b.at - a.at),
  }));

  try {
    const tmp = `${STATE}.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ procs, scans }));
    fs.renameSync(tmp, STATE);
  } catch {}

  process.stdout.write(JSON.stringify({
    now, connected, unnamed: Math.max(0, connected - files.length), files,
    bridges: bridges.map((b) => ({ port: b.port, up: b.up, version: b.version, connected: b.connected, session: b.session, ancestors: b.ancestors })),
  }));
})().catch((e) => { process.stderr.write(String(e?.stack ?? e)); process.exit(1); });
