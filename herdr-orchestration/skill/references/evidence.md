# Evidence standards

What counts as "tested" and "measured" before a PR can merge.

## Fail-on-base (mandatory for regression tests)

1. Create an untouched worktree at the PR's base commit.
2. Copy in ONLY the new tests and their minimal wiring (fixture pages, hook lines). No implementation code.
3. Run them. Record the failure count and one representative assertion message per kind of failure.
4. Run them on the branch and record the pass count.
5. For each review fix, repeat the exercise against the previous PR head.

Report it like this: "60/60 fail on 105be49 (5 tests × 4 backends × 3 engines); 72/72 pass on the branch. Representative: name expected "Account", received ""."

Some tests pass on base by design: drift guards, native-behaviour guards, and positive controls (which prove a negative assertion isn't passing for no reason). List these separately; they are not evidence. When a base failure doesn't explain itself, log the measured state as data, e.g. a JSON of counts.

## Assert what the platform computes

Assert the browser's computed result, not attributes the code wrote:
- accessible name and description;
- `document.activeElement`;
- `FormData` after a real submit, and whether the submit was blocked;
- ownership on the flat tree.

Chromium's real accessibility tree is reachable through CDP `Accessibility.getFullAXTree`. Firefox and WebKit trees are NOT observable through Playwright; say so in the PR.

## Measurement

- **Capability claims:** run probe pages under the exact engine versions. Record a matrix of whether the feature is present, whether the setter keeps the value, and the effect.
- **Performance:** median and p95 over at least 25 runs, plus a floor measured in the same run, with the harness stated. Two harnesses may disagree on absolute numbers and agree on the ratios; record both.
- **Rewrite or rename rules:** diff the rewrite plan with and without the rule, report exact counts, and confirm every extra rewrite is intended. Then run the tool for real in a disposable worktree.

## Not covered (mandatory PR section)

List the honest limits: engines that couldn't be observed, no assistive-technology run, unsupported cases recorded as gaps. An overclaim counts as a review finding.

## Known blind spot: visual regression

This loop verifies behaviour, semantics and emitted bytes. Nothing in it looks at pixels. If a change can affect layout (swapping an element's type, changing `display`, adding DOM inside a control), do one of these:
- run a screenshot comparison (Playwright `toHaveScreenshot` against a reviewed baseline); or
- list the visual risk explicitly under Not covered, and tell the person.
