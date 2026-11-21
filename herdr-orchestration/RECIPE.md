# Recipe: install the Herdr orchestration skill

Brief for an agent installing this folder. Copy files; do not rewrite them.

1. **Skill.** Copy `skill/` to `~/.claude/skills/herdr-orchestration/`, so that `SKILL.md`, `references/` and `scripts/` sit directly inside it. If that folder exists, show the person the diff and ask before overwriting.
2. **Templates.** Copy `templates/worker.md` and `templates/reviewer.md` into the herdr-core templates folder:
   - Windows: `%APPDATA%\herdr-core\templates\`
   - macOS / Linux: `~/.config/herdr-core/templates/`

   Create the folder if it is missing. Do not overwrite existing templates with the same names without asking.
3. **Check.**
   - `hc templates` must list `worker` and `reviewer`. If it prints `[]` on Windows, the files are in the wrong folder.
   - `bash -n ~/.claude/skills/herdr-orchestration/scripts/spawn.sh` and the same for `send.sh` must pass.
4. **Smoke test** (optional; ask first, because it starts two agents):
   ```sh
   S=~/.claude/skills/herdr-orchestration/scripts
   bash $S/spawn.sh worker   smokew "<a Codex-trusted repo>" 'Smoke test only: change nothing. Send your parent exactly "smoke ok worker" with hc send, then stop.'
   bash $S/spawn.sh reviewer smoker "<a Codex-trusted repo>" 'Smoke test only: change nothing. Send your parent exactly "smoke ok reviewer" with hc send, then stop.'
   hc wait --children all
   ```
   Both reports should arrive. Then `hc kill smokew; hc rm smokew; hc kill smoker; hc rm smoker`.
5. **Tell the person** that Codex reviewers must be started with `--cwd` inside a project Codex trusts, and that the templates can be edited to match their team's rules.

Nothing in this folder runs at install time. It touches no Herdr mod folder and needs no app restart; Claude Code picks up the skill in its next session.
