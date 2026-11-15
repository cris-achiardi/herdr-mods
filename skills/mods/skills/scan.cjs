// Prints one JSON line listing the Claude Code skills and slash commands that
// apply in a folder: `node scan.cjs <folder>`. Read-only.
//
//   project  <dir>/.claude/skills/<name>/SKILL.md and <dir>/.claude/commands/**/*.md
//            for the folder and each parent, up to (not including) the home folder
//   global   ~/.claude/skills/<name>/SKILL.md, ~/.claude/commands/**/*.md, and the
//            skills synced from claude.ai, ~/.claude/skills/synced/<id>/<name>/SKILL.md
//
// An item: { kind: "skill" | "command", name, run, description, hint, path, family }.
// `run` is what is typed after the slash. Plugin skills are not listed.

const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const HEAD = 16384; // bytes of a file read for its frontmatter

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const list = (p) => { try { return fs.readdirSync(p).sort(); } catch { return []; } };

function head(file) {
  try {
    const fd = fs.openSync(file, "r");
    try { const buf = Buffer.alloc(HEAD); return buf.subarray(0, fs.readSync(fd, buf, 0, HEAD, 0)).toString("utf8"); }
    finally { fs.closeSync(fd); }
  } catch { return null; }
}

// The top-level string keys of a file's YAML frontmatter: plain, quoted, and
// folded or literal blocks; a plain value may continue on indented lines.
function frontmatter(text) {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text ?? "");
  const out = {};
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    const more = [];
    while (i + 1 < lines.length && (/^[ \t]+\S/.test(lines[i + 1]) || (lines[i + 1].trim() === "" && /^[>|]/.test(value)))) more.push(lines[++i].trim());
    if (/^[>|][+-]?$/.test(value)) value = more.join(value[0] === "|" ? "\n" : " ");
    else {
      value = [value, ...more].join(" ").trim();
      const q = value[0];
      if ((q === '"' || q === "'") && value.endsWith(q) && value.length > 1) {
        value = value.slice(1, -1);
        value = q === "'" ? value.replace(/''/g, "'") : value.replace(/\\(["\\n])/g, (_s, c) => (c === "n" ? "\n" : c));
      }
    }
    out[kv[1]] = value.replace(/\s+/g, " ").trim();
  }
  return out;
}

// The first line of prose after the frontmatter, for a file that has no description.
function firstLine(text) {
  const body = (text ?? "").replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  return body.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
}

function skillsIn(dir, extra = {}) {
  const items = [];
  for (const name of list(dir)) {
    const file = path.join(dir, name, "SKILL.md");
    const text = head(file);
    if (text === null) continue;
    const fm = frontmatter(text), id = fm.name || name;
    items.push({ kind: "skill", name: id, run: id, description: fm.description || firstLine(text), hint: fm["argument-hint"] || "", path: file, family: null, ...extra });
  }
  return items;
}

function commandsIn(dir, prefix = "") {
  const items = [];
  for (const name of list(dir)) {
    const file = path.join(dir, name);
    if (isDir(file)) items.push(...commandsIn(file, `${prefix}${name}:`));
    else if (name.endsWith(".md")) {
      const text = head(file), fm = frontmatter(text), id = prefix + name.slice(0, -3);
      items.push({ kind: "command", name: id, run: id, description: fm.description || firstLine(text), hint: fm["argument-hint"] || "", path: file, family: null });
    }
  }
  return items;
}

const both = (dir) => [...skillsIn(path.join(dir, "skills")), ...commandsIn(path.join(dir, "commands"))];

// Nearest folder first; a name found nearer hides the same name further up.
function project(start) {
  const seen = new Set(), items = [];
  let root = null;
  for (let dir = path.resolve(start), last = null; dir !== last && dir.toLowerCase() !== HOME.toLowerCase(); last = dir, dir = path.dirname(dir)) {
    const found = both(path.join(dir, ".claude"));
    if (found.length && !root) root = dir;
    for (const it of found) {
      const id = `${it.kind}:${it.name}`;
      if (!seen.has(id)) { seen.add(id); items.push(it); }
    }
  }
  return root ? { root, name: path.basename(root), items } : null;
}

function global() {
  const base = path.join(HOME, ".claude");
  const items = both(base).filter((it) => it.path !== path.join(base, "skills", "synced", "SKILL.md"));
  for (const id of list(path.join(base, "skills", "synced"))) {
    const dir = path.join(base, "skills", "synced", id);
    if (isDir(dir)) items.push(...skillsIn(dir, { family: "claude.ai" }).map((it) => ({ ...it, run: `anthropic-skills:${it.name}` })));
  }
  return { items };
}

const start = process.argv[2];
process.stdout.write(JSON.stringify({ home: HOME, project: start && isDir(start) ? project(start) : null, global: global() }));
