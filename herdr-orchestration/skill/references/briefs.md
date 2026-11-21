# Briefs and relays

Workers and the reviewer know only what you send them. The template carries the standing rules; each task message carries the specifics. A good task names:

- the issue or PR, the branch name, the worktree path, and the base (`origin/main` at <sha>, or "stacked on #N");
- the scope boundary: which files or packages it may touch, and what is explicitly out of scope;
- the mode: **design only** (write a note, then stop) or **build**;
- the port range for any server it starts;
- what "done" means: PR opened with `Fixes #N` (one keyword per issue), gate green, report sent.

## Design-only task (shape)

> Issue #44. Worktree C:/Users/u/wt/tabs44, branch fix/44-tablist-owns-tabs from origin/main.
> DESIGN ONLY: determine what the current schema can and cannot express, list options with their
> costs, measure anything you claim about browser support, recommend one, and write the note to
> C:/Users/u/wt/tabs44-decision.md. Report the path and stop.

## "Go" message (shape)

> Approved: P1 + N1, with conditions: (a) record it as Draft ADR 0007; (b) report the WC
> aria-labelledby gap as non-conforming, do not claim it works; (c) do not touch Field/Tooltip,
> because #35 is in flight there. Ports 4401–4404.

## Relaying review findings (shape)

Forward the finding verbatim (severity, file:line, repro). Then add a suggested fix *shape*, not code, and say what the fix must prove:

> PR #55 review round 2, P2 (measured): one document-wide observer per control … Suggested shape:
> one refcounted observer per document, with a relevance filter. Prove it with the reviewer's
> harness numbers and a cleanup test (the observer disconnects after the last unmount). The new
> tests must fail on the current head.

## Re-review request (shape)

> PR #53's head is now <sha>. First re-run your three repros against it. Then look closely at the
> new ownership-tracking mechanism the fix introduced. Skip the merge-compatibility check this round.

## After a merge (to dependants)

> #50 merged as d6c20c2 (verified with gh). Rebase fix/36 onto origin/main, keep both behaviours in
> the five conflicting files, re-run the full browser matrix, push, and report.
