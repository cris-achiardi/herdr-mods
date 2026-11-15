# Servers

A sidebar section that lists the local servers running on this computer under the space each belongs to. Every server has a button that stops it and a button that opens it in the browser. It sits in the left sidebar under the agents list.

![Servers](preview.png)

## What you see

A section that fills its block: `chrome` background, 1px `border` above, text 13px in `foreground`.

**Heading**, 41px (14px top, 5px bottom, 16px side padding): "Servers" in 11.5px medium `dim`, and at the right the number of servers in 11px `dim` (nothing when there are none).

**Space row**, 28px, 8px side padding, 6px gaps, radius 8, `hover` on hover: a 12px chevron in `dim`, down when open and right when folded; the space's name, truncated, in `foreground`; when folded, the number of its servers in a 10px `muted` badge with a 1px `border`. Servers no space claims are under a last row named "Other", in `muted`.

**Server row**, under its open space, 28px, 26px left and 8px right padding, 7px gaps, radius 8, 12px text, `hover` on hover:

- a 7px dot in `ansi2`;
- the server's name, truncated: its folder's last part, else what it runs. Tooltip: what it runs (when not the name), the folder and `pid <n>`, joined by " · ";
- `:<port>` in 11px `dim`;
- at the right two 22px buttons with 13px icons in `dim`, `selected` background on hover: Stop (a rounded square, `ansi1` on hover, tooltip "Stop") and Open (an external-link arrow, `foreground` on hover, tooltip "Open in browser").

While a server is being stopped its row is `dim`, the dot is a 12px spinner turning once per 900 ms, and the buttons are gone.

**Messages** replace the rows, a `muted` 12px title and an 11px `dim` sentence: "No servers running" / "A dev server shows here once it listens on a port."; "Couldn't list the servers" with the error's first 160 characters.

## How it behaves

- A server is a process listening on a TCP port that has `herdr-core` among its ancestors, or whose program is one of node, nodejs, bun, deno, python, pythonw, py, ruby, php, java, dotnet, hugo, uvicorn, gunicorn, puma, caddy. Processes with `mcp` in their command line, and Herdr's own, are left out. A process listening on two ports gets a row for each.
- A server belongs to, in this order: the space of the terminal whose process is one of its ancestors; the space with a terminal whose folder contains the server's folder or is inside it (the deepest such terminal folder; terminals at the home folder don't count); the space whose name is one of the parts of the server's folder. Otherwise "Other". Spaces keep their order; spaces on other machines are skipped.
- Clicking a space row folds or unfolds its servers. Folded spaces are kept in `localStorage` by space id.
- Clicking a server row focuses the pane that started it when known, else selects its space. Rows under "Other" do nothing.
- Stop ends the process and its children at once, with no confirmation, then reloads the list; the row goes when the port closes. If the program refuses, an error toast says so and the row comes back.
- Open opens `http://localhost:<port>` in the system browser.
- It reloads every 5 s while its layout block is shown; a hidden block runs nothing.
- The block resizes itself with `layout.resize` to the height of its content with every space unfolded, up to 300px, then scrolls. Folding a space leaves the block's size unchanged.
- Agent statuses (working, blocked, done, idle) are not shown.

## Built from

- `mods/servers/`: `main.js`, `scan.js`, `mod.json` `{ "place": "none", "title": "Servers" }`, icons `stop`, `external`, `spinner`, `chevron-down`, `chevron-right` (drawn after Lucide) and `LICENSE-lucide.txt`.
- `main.js`: one `View`. `herdr` functions: `spaces`, `panes`, `terminals`, `exec`, `theme`, `layout`, `props`, `home`, `window`, `run`, `notify`. Commands: `pane.focus {pane}`, `space.select {id}`, `layout.resize {id, px}`. `cx.open_url`, `cx.timer.every`. `props { demo: true }` draws two sample spaces at 268px wide and runs nothing; `folded: ["b"]` starts the second one folded.
- `scan.js` exports `scan(exec, platform, cache)`, which resolves with `[{ port, pid, proc, cmd, dir, tool, name, herdr, ancestors }]` sorted by port. `platform` is `window().platform`; `cache` is a `Map` the view keeps.
  1. Listeners. Windows: `netstat -ano`, rows matching `TCP <local>:<port> (0.0.0.0|[::]):0 <state> <pid>`. Elsewhere: `lsof -nP -iTCP -sTCP:LISTEN -Fpn` (`p` lines give the pid, `n` lines end in the port), or `ss -ltnpH` when `lsof` can't run. Deduplicated by pid and port.
  2. Cache entries of pids no longer listening are dropped. If a listening pid is not cached, the process table is read once: Windows `powershell -NoProfile -NonInteractive -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"` (30 s); elsewhere `ps -A -o pid=,ppid=,args=`.
  3. Each new pid: its ancestors' pids and names; `herdr` if one is `herdr-core` or `hc`; shown or not by the rule above, and cached either way.
  4. `dir`: Linux `readlink /proc/<pid>/cwd`; macOS `lsof -a -d cwd -p <pid> -Fn`; Windows the first argument that is an absolute path, cut before `node_modules`, else without its last part.
  5. `tool`: the name after `node_modules/.bin/` (through a `..` if there is one), else the package after `node_modules/`, else the first argument that is not an option without its extension, else the program. `name`: the last part of `dir`, else `tool`.
- Stop: `taskkill /PID <pid> /T /F` on Windows, `kill <pid>` elsewhere, through `exec`.

**Wiring it into the window.** Shipped layouts are read-only and restored on every start: if the person's layout is shipped, clone it (`layout.clone`) and edit the clone. In the sidebar's lists column (`sidebar-lists` in the `main` layout, 0.1.15), after the agents block:

```json
{ "id": "servers", "type": "block", "content": { "mod": "servers" }, "size": { "px": 97 } }
```

Without a layout change: `herdr-app do pane.split '{"direction":"right","mod":"servers"}'` opens it as a pane.

## Watch out

- Copying the folder alone shows nothing; the install is done when the section is in the sidebar.
- Don't match `netstat`'s state word: Windows translates it. A listening row is the one whose remote address is `0.0.0.0:0` or `[::]:0`.
- Servers an agent starts in the background are usually orphans: their parent shell has exited, so the chain of ancestors stops before any terminal. That is why the folder and the space's name are tried after the ancestors, and why dev runtimes are listed without a Herdr ancestor.
- Starting PowerShell takes about half a second; reading the process table on every reload would keep a core busy. Read it only for an unseen listening pid, and cache the pids that are not shown too.
- Windows gives no working folder for another process; the command line is the only source. `node_modules\.bin\\..\astro\astro.js` has a doubled separator: match runs of separators.
- A terminal at the home folder contains every project: skip it when matching by folder.
- `scan.js` takes `exec` as an argument so it can be run outside Herdr with a `child_process` stand-in; keep it free of `herdr` imports.
- The block is found by `content.mod === "servers"`; a renamed copy must update that constant.
- `layout.resize` only works on a personal layout. In a shipped one the block keeps the size the layout gives it.
- Built and used on Windows (Spanish locale) with Herdr 0.1.15. The macOS and Linux branches are untested.

## Done when

- `herdr-app check` passes for `mods/servers`; `herdr-app status` shows no errors.
- With no dev server running the section says "No servers running".
- After `node -e "require('http').createServer((q,r)=>r.end('ok')).listen(4999)"` in a Herdr terminal, a row with `:4999` shows within 5 s under that terminal's space, and the heading's number goes up by one.
- Its Open button opens `http://localhost:4999` in the browser.
- Its Stop button ends that process; the row is gone within 5 s and the port is free.
- A server started in the background by an agent shows under the space working in its folder.
- Clicking a space row hides its server rows and shows their count; clicking again shows them; the choice survives a restart.
