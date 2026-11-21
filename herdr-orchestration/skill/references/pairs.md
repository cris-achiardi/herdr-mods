# Pair mode: worker and reviewer talk directly

In hub mode, every finding, fix and re-review request passes through the orchestrator. That keeps decisions coherent, but the orchestrator becomes the bottleneck: agents sit idle while it relays. In pair mode, each track gets its own worker + reviewer pair, and they loop directly with `hc send`. The orchestrator plans, sets boundaries, takes escalations, and runs the merge gate.

Use pair mode when there are several independent tracks and most review rounds are mechanical. Use hub mode when tracks overlap heavily, or when nearly every finding needs a design decision.

## Setup

```sh
S=~/.claude/skills/herdr-orchestration/scripts
bash $S/spawn.sh worker   tabs-w "<repo>" "PAIR MODE. Your reviewer is <reviewer address>. <task>"
bash $S/spawn.sh reviewer tabs-r "<repo>" "PAIR MODE. Your worker is <worker address>. <scope>"
```

Spawn the reviewer first, then the worker with the reviewer's address. Then send the reviewer the worker's address. Both reports still go to the orchestrator; pair traffic goes to each other.

With two or more pairs, also start an overseer (next section) before the first pair, and give every pair reviewer its address:

```sh
bash $S/spawn.sh overseer overseer "<repo>" "Ledger: <short path>/overseer-ledger.md. Pairs: tabs (#51), relations (#52)."
# then, in each reviewer's brief: "Overseer: <overseer address>. Send it every round's findings."
```

## The pair contract (put it in both briefs)

1. **The worker hands off with a SHA.** "Ready for review at <sha>, PR #N." Never "ready" without a head commit.
2. **The reviewer answers the worker directly** with severity-ranked findings (repro + file:line).
3. **The reviewer also posts each round on the PR** (`gh pr comment`) as the audit trail. The orchestrator no longer sees every message, so GitHub must. If an overseer runs, the reviewer sends it the same findings, including "no findings at <sha>".
4. **The worker fixes, then re-hands off** with the new SHA and one line per finding: fixed (how), or disputed (why).
5. **Disputes** are settled with a repro or a measurement, not argument. After one exchange without agreement, escalate.
6. **Escalate to the orchestrator; do not decide inside the pair** when:
   - the fix changes a public API, a schema, or an accepted decision record;
   - a P1 is found;
   - the pair disagrees after one exchange;
   - the round count reaches 3 without "no findings";
   - the fix needs to touch files outside the track's scope (another pair may own them).
7. **Done** = the reviewer sends the orchestrator: "PR #N: no findings at <sha>". The worker stops at that point; it never merges.

## What the orchestrator still owns

- The plan, the scopes and the merge order. Pairs must not edit outside their scope.
- Design gates: a design-only note still comes to the orchestrator, not to the reviewer.
- **What reaches the pairs.** The overseer's advice comes to the orchestrator, which decides what, if anything, to pass to which worker or reviewer.
- The merge gate itself (`references/review-loop.md`). With an overseer, its merge check is one of the gate items.
- Watching for silent pairs: `hc wait --children any` still returns on every child status change. If a pair goes quiet with no report, read both panes.

## The overseer: cross-track memory without filling the orchestrator's context

Per-track reviewers lose what a single reviewer had: memory across PRs. That memory caught recurring defect types and merge conflicts between in-flight PRs. The overseer restores it. It is a **read-only** agent (template `overseer`) that receives every pair reviewer's notes and advises **only the orchestrator**.

| Aspect | Rule |
| --- | --- |
| Input | Every round's findings from every pair reviewer, pushed to it with `hc send` (no polling). The PR comments stay the permanent record |
| Job | Spot patterns: the same defect type in several tracks, two pairs solving one problem incompatibly, a fix in one track breaking another's assumption, reviewers drifting (vague findings, missing repros, circling rounds, visual changes without screenshots) |
| Output | Batched advice to the orchestrator only when a pattern is new or has changed. No acknowledgements, no per-note summaries |
| Authority | None over the pairs. It never messages workers or reviewers; the orchestrator decides what its advice becomes |
| Memory | A ledger file, updated after every note. If its context fills up, restart it; it re-reads the ledger |
| Merge time | Before each merge the orchestrator asks "merge check PR #N at <sha>". The overseer checks the PR against everything merged since it branched and every open ledger pattern, and answers `clear` or `hold - <reason>` |
| Model | Claude. It receives far more messages than any other agent, and Codex often leaves incoming messages unsubmitted (frictions #1) |

## Costs

- One reviewer per track instead of one total: more concurrent Codex sessions and more tokens.
- An overseer: one more agent, idle most of the time. Reviewers send each round twice (to the worker and to the overseer).
- The orchestrator reads less. It must trust the PR comment trail, the overseer's advice, and its own spot-checks.
- The overseer is only as good as the notes it gets. Vague findings hide patterns, which is why the reviewer template requires a repro and file:line for every finding.
- Pairs can converge on a shared blind spot over many rounds. The round cap and the overseer's merge check are the counterweights.
