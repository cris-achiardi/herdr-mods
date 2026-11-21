# Review loop and merge gate

## One persistent reviewer, from a different model family

Keep ONE Codex reviewer alive across all PRs:
- it builds up context across PRs;
- it recognises defect types that recur (a rename tool missing new prefix forms showed up twice);
- it can check whether in-flight PRs will merge cleanly with each other.

A reviewer from a different model family than the workers does not share their blind spots.

## Severity

- **P1:** breaks the product or a core workflow, e.g. a CLI unusable on one OS. Blocks merge.
- **P2:** a real defect with a repro. Blocks merge.
- **P3:** minor or design-level. Fix it, or record a decision; never merge with it silently open.

## Rounds

1. A full review on the first push.
2. Re-reviews are **targeted**: re-run the previous repros on the new head, then examine any NEW mechanism the fix introduced. In practice most later-round findings were in the fixes, not in the original change: a validity interceptor, a per-control observer, a key-cancellation scheme.
3. The orchestrator may verify small mechanical changes straight from the diff: a revert, a rebase resolution, one new check script. That keeps the reviewer off the critical path. Say so when merging.

Expect 1–4 rounds per PR. A fourth round is a signal: next time, ask the worker for a five-line fix design and have the reviewer check it before anything is built.

## Diff size

Large diffs are a known cost: in the source session, eight issues produced +12.9k lines, mostly tests, fixtures and regenerated output. Unsolved, but these help the reader:
- **Separate commits by kind:** implementation, tests, generated/regenerated output. Reviewers can then read the implementation commit alone.
- **A "where to look" map in the PR body:** the 3–5 files that carry the change; everything else is support.
- **Suggest** to the project that it mark generated paths `linguist-generated=true` in `.gitattributes`, so GitHub collapses them. It's a repo decision, so suggest it, don't apply it.
- Split when a PR has two separable changes; stack them (`stacked on #N`) when they depend on each other.

## Merge gate (every item)

- The reviewer said "no findings", naming the **current head SHA**.
- CI is green on that head, including every matrix job. Variant jobs (e.g. a branded build) catch what local runs miss.
- The branch is rebased on current main, and the rebase itself has been re-verified.
- The PR body has Testing (with fail-on-base counts) and Not covered sections.
- For visual or front-end changes: before/after screenshots are posted on the PR, and the reviewer evaluated them (`references/evidence.md`).
- In pair mode: the review rounds are on the PR as comments, and the overseer answered `MERGE CHECK #N <sha>: clear` for this head. Without an overseer, the orchestrator does that cross-track check itself (`references/pairs.md`).
- The closing keywords cover every issue (`Fixes #a, fixes #b`).

After merging:
1. Confirm with `gh pr view` that the PR merged and the issues closed.
2. Tell dependants the merge SHA.
3. Retire the worker, and remove its worktree and local branch.

## When to escalate to the person

Escalate instead of deciding yourself when a choice:
- changes a public API;
- contradicts an accepted decision record; or
- gives up a stated requirement (e.g. "verify in all engines" cannot be met).

Bring the measured options and a recommendation, in plain language.
