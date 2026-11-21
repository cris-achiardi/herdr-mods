---
name: herdr-orchestration
description: Run a multi-agent workflow in the Herdr desktop app with `hc`. You are the orchestrator; Claude workers each get their own git worktree; one Codex reviewer persists across PRs; everyone runs in split panes of your tab. Use when asked to "spawn a worker / reviewer", "work through the open issues/PRs with agents", "manage workers and reviewers", "you manage the merge plan", or to delegate parallel tracks inside Herdr. Covers launching, briefing, the design gate, the review loop, evidence rules, merging, and known Herdr/Codex/Windows frictions with tested workarounds. Complements `hc --skill` (the CLI manual).
---

# Herdr orchestration

You are the orchestrator. Workers implement, one reviewer reviews, and you plan, decide (or escalate), relay, verify and merge. One session proved this out:
- 9 PRs merged, 9 issues closed;
- 29 review findings plus 1 CI failure acted on;
- nothing merged with an open finding.

The references below distil that session's method and frictions.

## Ground rules

- `hc --skill` is the CLI manual. This skill is the working method on top of it.
- Agents go in split panes of YOUR tab, so the person can watch and take over. That needs both the `herdr.space` and `herdr.tab` labels; `scripts/spawn.sh` adds them.
- Never sleep-poll; use `hc wait --children any`.
  - `reason: message`: the report arrives as your next input.
  - `reason: status` with no message: read the pane.
- **GitHub and git are the source of truth; panes are hints.** Before merging, rebasing, or telling an agent something landed, check with `gh`/`git`. A worker's input box once showed ghost text saying "#50 merged" while #50 was still open.
- Clean up only what you started: terminals (`hc kill <t>; hc rm <t>`), worktrees, local branches.

## Launch

```sh
S=~/.claude/skills/herdr-orchestration/scripts
bash $S/spawn.sh worker   tabs   "<repo>" "<narrow task>"
bash $S/spawn.sh reviewer review "<repo>" "<what to review, ports to use>"
bash $S/send.sh review "PR #53 is ready for review: ..."   # send + make sure the turn started
```

- **Role rules live in herdr-core templates.** On Windows that is `%APPDATA%\herdr-core\templates\{worker,reviewer}.md`; elsewhere `~/.config/herdr-core/templates`. Edit the rules there; `hc templates` and `spawn.sh` both read them. `hc run <template>` itself fails on Windows (frictions #3), which is why `spawn.sh` exists.
- **Start Codex with `--cwd` inside a Codex-trusted project.** Trusted projects are listed in `~/.codex/config.toml` as `trust_level = "trusted"`. From an untrusted folder, its sandbox denies `hc send` and it cannot report (frictions #5).
- **Check a new Claude worker's pane once.** A first-start MCP or folder-trust dialog blocks it silently; `spawn.sh` warns when the state is not `working`.

## The workflow

1. **Plan by file overlap, not issue number.**
   - Group issues that edit the same files.
   - Order merges so dependants rebase onto what they build on.
   - Give each agent its own short worktree path, branch name and port range, all up front.
2. **Design gate.** For anything the existing spec or contract does not already answer:
   - The worker writes a decision note: options, measurements, a recommendation, and the exact question. Then it stops.
   - You decide, or escalate to the person, and reply "go" with conditions.
   - Record the decision where the repo keeps decisions (ADR, PR body).
3. **Build** in the worker's worktree. It needs:
   - tests that fail on base;
   - the full local gate green;
   - a PR with Testing and Not covered sections.
   Workers never merge.
4. **Review loop** (see `references/review-loop.md`).
   - Relay findings with a suggested fix shape.
   - Re-reviews are targeted: re-run the old repros first, then examine any new mechanism.
5. **Merge** only when all three hold: the reviewer said "no findings" on the current head SHA, CI is green, and the branch is rebased on current main. Then:
   - tell dependants exactly which commit landed;
   - retire the worker, keep the reviewer.

## References (load when needed)

| When | Read |
| --- | --- |
| Something odd happens with hc, Codex, Claude panes, Windows or GitHub | `references/frictions.md` |
| Writing a brief or relaying findings | `references/briefs.md` |
| Running the review loop, deciding when to merge | `references/review-loop.md` |
| Judging whether a worker's testing or measurement is good enough | `references/evidence.md` |
