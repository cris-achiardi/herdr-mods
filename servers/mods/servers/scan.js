// Finds the local servers: processes listening on a TCP port that were started
// from a Herdr terminal, or that are a dev runtime (node, bun, python, ...).
// scan(exec, platform, cache) resolves with
//   [{ port, pid, proc, cmd, dir, tool, name, herdr, ancestors }]
// sorted by port. `exec` is herdr's; `cache` is a Map the caller keeps between
// scans, so the process table is only read when a new process starts listening.

const RUNTIMES = /^(node|nodejs|bun|deno|python[\d.]*|pythonw|py|ruby|php|java|dotnet|hugo|uvicorn|gunicorn|puma|caddy)$/;
const HIDDEN = /mcp/i; // MCP servers listen too; they are an agent's tools, not something to open

const base = (p) => p.replace(/[\\/]+$/, "").split(/[\\/]+/).pop() ?? "";
const bare = (name) => base(name ?? "").replace(/\.exe$/i, "").toLowerCase();

async function out(exec, cmd, args, timeout = 15000) {
  const r = await exec(cmd, args, { timeout });
  if (r.code !== 0 && !r.stdout) throw new Error((r.stderr || `${cmd} exited ${r.code}`).trim().split("\n")[0]);
  return r.stdout;
}

// [{ pid, port }] of every listening TCP socket.
export async function listeners(exec, platform) {
  const found = new Map();
  const add = (pid, port) => { if (pid > 0 && port > 0) found.set(`${pid}:${port}`, { pid, port }); };
  if (platform === "windows") {
    // A listening row is the one whose remote end is 0.0.0.0:0 or [::]:0; the
    // state word ("LISTENING") is translated on non-English Windows.
    for (const line of (await out(exec, "netstat", ["-ano"])).split("\n")) {
      const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+(?:0\.0\.0\.0|\[::\]):0\s+\S+\s+(\d+)\s*$/);
      if (m) add(Number(m[2]), Number(m[1]));
    }
    return [...found.values()];
  }
  let text = null;
  try { text = await out(exec, "lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]); } catch { /* no lsof: try ss */ }
  if (text !== null) {
    let pid = 0;
    for (const line of text.split("\n")) {
      if (line[0] === "p") pid = Number(line.slice(1));
      else if (line[0] === "n") add(pid, Number(line.slice(line.lastIndexOf(":") + 1)));
    }
    return [...found.values()];
  }
  for (const line of (await out(exec, "ss", ["-ltnpH"])).split("\n")) {
    const port = line.match(/\S+:(\d+)\s+\S+:\*/), pid = line.match(/pid=(\d+)/);
    if (port && pid) add(Number(pid[1]), Number(port[1]));
  }
  return [...found.values()];
}

// Map pid -> { ppid, name, cmd } of every process.
async function processes(exec, platform) {
  const table = new Map();
  if (platform === "windows") {
    const script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress";
    const rows = JSON.parse(await out(exec, "powershell", ["-NoProfile", "-NonInteractive", "-Command", script], 30000));
    for (const r of Array.isArray(rows) ? rows : [rows]) table.set(r.ProcessId, { ppid: r.ParentProcessId, name: r.Name ?? "", cmd: r.CommandLine ?? "" });
    return table;
  }
  for (const line of (await out(exec, "ps", ["-A", "-o", "pid=,ppid=,args="])).split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), name: m[3].split(/\s+/)[0], cmd: m[3] });
  }
  return table;
}

// A command line as the list of its arguments, to run it again. Windows quotes
// arguments with spaces; ps doesn't, so there they split.
export const argv = (cmd) => [...cmd.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);

// The folder a process works in. Windows doesn't give it, so it is read off
// the command line: the project around node_modules, else the script's folder.
async function folder(exec, platform, pid, cmd) {
  if (platform === "linux") {
    try { return (await out(exec, "readlink", [`/proc/${pid}/cwd`])).trim() || null; } catch { return null; }
  }
  if (platform === "macos") {
    try { return (await out(exec, "lsof", ["-a", "-d", "cwd", "-p", String(pid), "-Fn"])).split("\n").find((l) => l[0] === "n")?.slice(1) || null; } catch { return null; }
  }
  const path = argv(cmd).slice(1).find((t) => /^[A-Za-z]:[\\/]/.test(t));
  if (!path) return null;
  const cut = path.search(/[\\/]+node_modules[\\/]/);
  return (cut >= 0 ? path.slice(0, cut) : path.replace(/[\\/]+[^\\/]*$/, "")) || null;
}

// What is being run: the package behind node_modules/.bin, else the script.
function tool(cmd, proc) {
  const bin = cmd.match(/node_modules[\\/]+\.bin[\\/]+(?:\.\.[\\/]+)?([^\\/\s"]+)/);
  if (bin) return bin[1].replace(/\.(cmd|exe|js|mjs|cjs)$/i, "");
  const pkg = cmd.match(/node_modules[\\/]+((?:@[^\\/]+[\\/]+)?[^\\/\s"]+)[\\/]/);
  if (pkg) return pkg[1].replace(/\\/g, "/");
  const script = argv(cmd).slice(1).find((t) => !t.startsWith("-"));
  return script ? base(script).replace(/\.(js|mjs|cjs|ts|py|rb|php|jar)$/i, "") : proc;
}

export async function scan(exec, platform, cache) {
  const open = await listeners(exec, platform);
  const pids = new Set(open.map((l) => l.pid));
  for (const pid of cache.keys()) if (!pids.has(pid)) cache.delete(pid);

  if ([...pids].some((pid) => !cache.has(pid))) {
    const table = await processes(exec, platform);
    for (const pid of pids) {
      if (cache.has(pid)) continue;
      const p = table.get(pid);
      if (!p) { cache.set(pid, { show: false }); continue; }
      const ancestors = [], names = [];
      for (let up = p.ppid, seen = new Set([pid]); up > 0 && table.has(up) && !seen.has(up); up = table.get(up).ppid) {
        seen.add(up); ancestors.push(up); names.push(bare(table.get(up).name));
      }
      const proc = bare(p.name), herdr = names.some((n) => n === "herdr-core" || n === "hc");
      const show = (herdr || RUNTIMES.test(proc)) && !HIDDEN.test(p.cmd) && !/^(herdr|cloudflared)/.test(proc);
      if (!show) { cache.set(pid, { show: false }); continue; }
      const dir = await folder(exec, platform, pid, p.cmd);
      const what = tool(p.cmd, proc);
      cache.set(pid, { show: true, pid, proc, cmd: p.cmd, dir, tool: what, name: dir ? base(dir) : what, herdr, ancestors });
    }
  }

  return open
    .filter((l) => cache.get(l.pid)?.show)
    .map((l) => ({ ...cache.get(l.pid), port: l.port }))
    .sort((a, b) => a.port - b.port);
}
