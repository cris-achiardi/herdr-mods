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

## The pair contract (put it in both briefs)

1. **The worker hands off with a SHA.** "Ready for review at <sha>, PR #N." Never "ready" without a head commit.
2. **The reviewer answers the worker directly** with severity-ranked findings (repro + file:line).
3. **The reviewer also posts each round on the PR** (`gh pr comment`) as the audit trail. The orchestrator no longer sees every message, so GitHub must.
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
- **Cross-track review.** Per-track reviewers lose the single reviewer's cross-PR memory: recurring defect types and merge compatibility between in-flight PRs. Compensate at the merge gate. Before merging, the orchestrator (or one designated "lead" reviewer) checks the PR against what merged since it branched, and scans for defect types already seen in other tracks.
- The merge gate itself (`references/review-loop.md`).
- Watching for silent pairs: `hc wait --children any` still returns on every child status change. If a pair goes quiet with no report, read both panes.

## Costs

- One reviewer per track instead of one total: more concurrent Codex sessions and more tokens.
- The orchestrator reads less. It must trust the PR comment trail and spot-check it.
- Pairs can converge on a shared blind spot over many rounds. The round cap and the lead-reviewer check at the merge gate are the counterweights.
