# Herdr orchestration skill

A Claude Code skill for running a team of coding agents inside the [Herdr](https://herdr.dev) desktop app. You talk to one agent, the orchestrator. It starts Claude workers, each in its own git worktree, and one Codex reviewer that stays alive across pull requests. All of them run in split panes of your tab, so you can watch any of them and take over.

This is not a UI mod: it adds no panel. It is the working method and the tooling, written down after a session that closed nine issues and merged nine pull requests this way.

## What it adds

- **A skill** (`skill/SKILL.md`). Claude Code loads it when you ask an agent to "spawn a worker and a reviewer", "work through the open issues", or "manage the merge plan". It covers:
  - planning work by which files overlap;
  - a design gate before code;
  - the review loop and the merge conditions;
  - when to bring a decision back to you.
- **Five reference sheets**, loaded only when needed:
  - `frictions.md`: 14 problems hit in real use (hc, Codex, Claude, Windows, GitHub), each with a tested workaround and, where one exists, the upstream herdr-core issue.
  - `briefs.md`: example messages for "design only", "go ahead", relaying review findings, re-review requests, and "this merged".
  - `review-loop.md`: severity levels, targeted re-reviews, and the merge checklist.
  - `pairs.md`: pair mode, where each track gets a worker + reviewer pair that talks directly and escalates only design-level issues, P1s, disputes or round 3.
  - `evidence.md`: proving tests fail on the old code, measurement standards, mandatory before/after screenshots and visual review for front-end changes, and per-project accessibility tooling.
- **Two role templates** (`templates/worker.md`, `templates/reviewer.md`). These are herdr-core templates: the standing rules for each role, written once instead of retyped into every brief.
- **Two scripts** (`skill/scripts/`):
  - `spawn.sh <role> <name> <cwd> <task>` starts an agent from a template, in a pane of the caller's tab, with the rules and the parent's address attached.
  - `send.sh <terminal> <text>` sends a message and makes sure the turn actually started. Codex often leaves pasted text unsubmitted; the script presses Enter for it.

## Why the scripts exist

On Windows, `hc run <template> "task"` currently fails (`cannot start "sh"`, [herdr-core#245](https://github.com/herdrdev/herdr-core/issues/245)), and the templates folder is not the one the help text names ([herdr-core#308](https://github.com/herdrdev/herdr-core/issues/308)). `spawn.sh` reads the template itself and launches the program directly, so the rules still live in one place. On macOS and Linux `hc run <template>` may work as is; `spawn.sh` works everywhere.

## Requirements

- Herdr desktop app with `hc` on `PATH` (tested with hc 0.1.21).
- Claude Code; Codex CLI for the reviewer (tested with codex-cli 0.169.0).
- `bash` for the scripts (Git Bash on Windows).
- `gh`, authenticated, for anything touching pull requests.
- **Codex must start inside a project it trusts** (`trust_level = "trusted"` in `~/.codex/config.toml`). From an untrusted folder, its Windows sandbox cannot reach hc, and it cannot report back ([herdr-core#224](https://github.com/herdrdev/herdr-core/issues/224)).

## Install

Ask your Herdr agent:

> Install the Claude Code skill at https://github.com/cris-achiardi/herdr-mods/tree/main/herdr-orchestration

It follows [RECIPE.md](RECIPE.md).

## License

MIT, see [LICENSE](../LICENSE).
