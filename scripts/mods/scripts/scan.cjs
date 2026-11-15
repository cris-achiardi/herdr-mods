// Prints one JSON line listing the package scripts that can be run where a
// folder is: `node scan.cjs <folder>`. Read-only.
//
// The project is the nearest folder with a package.json, or the workspace root
// above it (pnpm-workspace.yaml, or "workspaces" in a package.json), looked for
// up to the repository's root. Output:
//   { root, name, manager, here, packages: [{ dir, rel, name, scripts: [{ name, cmd }] }] }
// `manager` is npm, pnpm, yarn or bun, from the lockfile at the root, else the
// root's "packageManager", else npm. `here` is the `rel` of the package the
// folder is in. The root package comes first, then workspace packages by path.
// Only package.json scripts are read: no Makefile, justfile or other runners.

const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir().toLowerCase();
const DEPTH = 4; // folders a `**` pattern is followed into
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", ".cache"]);

const BS = String.fromCharCode(92); // a backslash
const slash = (s) => s.split(BS).join("/");
const has = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const json = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
const dirs = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !SKIP.has(d.name) && !d.name.startsWith(".")).map((d) => d.name).sort(); } catch { return []; } };

// The `packages:` list of a pnpm-workspace.yaml.
function pnpmPatterns(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  const out = [];
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) { inside = true; continue; }
    if (inside && /^\S/.test(line)) break;
    const m = inside && /^\s*-\s*(.+?)\s*$/.exec(line);
    if (m) out.push(m[1].replace(/^(['"])(.*)\1$/, "$2"));
  }
  return out;
}

function patternsAt(dir) {
  const pnpm = pnpmPatterns(path.join(dir, "pnpm-workspace.yaml"));
  if (pnpm) return pnpm;
  const w = json(path.join(dir, "package.json"))?.workspaces;
  return Array.isArray(w) ? w : Array.isArray(w?.packages) ? w.packages : null;
}

// Folders matching a workspace pattern: "apps/*", "packages/**", "tools/cli", "*".
function expand(root, pattern) {
  const parts = slash(pattern).replace(/^\.\//, "").replace(/\/$/, "").split("/");
  let at = [root];
  for (const part of parts) {
    if (part === "**") {
      const all = [];
      const walk = (d, depth) => { all.push(d); if (depth < DEPTH) for (const n of dirs(d)) walk(path.join(d, n), depth + 1); };
      for (const d of at) walk(d, 0);
      at = all;
    } else if (part.includes("*")) {
      const re = new RegExp(`^${part.split("*").map((x) => x.replace(/[.+?^${}()|[\]]/g, (c) => BS + c)).join(".*")}$`);
      at = at.flatMap((d) => dirs(d).filter((n) => re.test(n)).map((n) => path.join(d, n)));
    } else at = at.map((d) => path.join(d, part)).filter(has);
  }
  return at;
}

function pack(dir, root) {
  const pkg = json(path.join(dir, "package.json"));
  if (!pkg) return null;
  const scripts = Object.entries(pkg.scripts ?? {}).filter(([, cmd]) => typeof cmd === "string").map(([name, cmd]) => ({ name, cmd }));
  return { dir, rel: slash(path.relative(root, dir)), name: typeof pkg.name === "string" ? pkg.name : path.basename(dir), scripts };
}

function manager(root) {
  for (const [file, name] of [["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lock", "bun"], ["bun.lockb", "bun"], ["package-lock.json", "npm"]]) if (has(path.join(root, file))) return name;
  const declared = /^(npm|pnpm|yarn|bun)@/.exec(json(path.join(root, "package.json"))?.packageManager ?? "")?.[1];
  return declared ?? (has(path.join(root, "pnpm-workspace.yaml")) ? "pnpm" : "npm");
}

function scan(start) {
  // Up from the folder: the nearest package, and the highest workspace root in the repository.
  let nearest = null, root = null;
  for (let dir = path.resolve(start), last = null; dir !== last && dir.toLowerCase() !== HOME; last = dir, dir = path.dirname(dir)) {
    if (!nearest && has(path.join(dir, "package.json"))) nearest = dir;
    if (patternsAt(dir)) root = dir;
    if (has(path.join(dir, ".git"))) break;
  }
  if (!nearest) return null;
  root ??= nearest;
  const seen = new Set([root.toLowerCase()]), packages = [pack(root, root)].filter(Boolean);
  const patterns = patternsAt(root) ?? [], not = patterns.filter((p) => p.startsWith("!")).flatMap((p) => expand(root, p.slice(1))).map((d) => d.toLowerCase());
  const found = patterns.filter((p) => !p.startsWith("!")).flatMap((p) => expand(root, p))
    .filter((d) => !not.includes(d.toLowerCase()) && !seen.has(d.toLowerCase()) && seen.add(d.toLowerCase()));
  packages.push(...found.map((d) => pack(d, root)).filter((p) => p && p.scripts.length).sort((a, b) => a.rel.localeCompare(b.rel)));
  // A nested package that no pattern lists is still where the person is.
  if (!seen.has(nearest.toLowerCase())) { const p = pack(nearest, root); if (p) packages.push(p); }
  return { root, name: packages[0]?.rel === "" ? packages[0].name : path.basename(root), manager: manager(root), here: slash(path.relative(root, nearest)), packages };
}

const start = process.argv[2];
process.stdout.write(JSON.stringify(start && has(start) ? scan(start) : null));
