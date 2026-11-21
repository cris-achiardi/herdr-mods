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

## Visual evidence (mandatory for anything visual)

Code checks verify behaviour, semantics and emitted bytes; none of them looks at pixels. In the source session, three merged changes carried layout risk that no one ever looked at. So for any visual or front-end change (design, CSS, markup structure, element type swaps, `display` changes, DOM added inside a control, tokens, themes):

**Worker**
1. Capture **before** (base commit) and **after** (branch) screenshots of every affected page or state: each backend/framework the change touches, plus at least one engine (more if the change is engine-sensitive). Use the project's harness (e.g. Playwright `page.screenshot`, or element screenshots for one component). Interaction states (hover, focus, invalid, open) count as separate shots.
2. Name the files by what they show: `<component>-<state>-<backend>-<engine>-{before,after}.png`.
3. Look at them yourself, and state in the PR what changed visually and whether it was intended.
4. Post them in a PR comment as a before/after table (see "Getting images into GitHub" below). For an issue, post them on the issue.

**Reviewer**
1. Open the screenshots (both agents can read images) and do a visual evaluation: unintended shifts, spacing, alignment, overflow, focus-ring visibility, contrast, states that look identical but shouldn't.
2. Visual findings are real findings, with the same severity scale and a reference to the exact image.
3. Re-capture at least one after-shot yourself, from your own worktree, so the evidence isn't only the author's.

**Getting images into GitHub.** `gh` and the REST API cannot attach images to comments (drag-and-drop upload is web-only). Two options:
- commit the screenshots to a dedicated branch (e.g. an orphan `pr-assets` branch, path `<pr>/<file>.png`) and reference them by URL in the comment; or
- upload them as a CI artifact and link it.

Never commit screenshots to the feature branch: they inflate the diff the reviewer has to read.

**Screenshot regression testing** (a stored baseline that CI compares against, e.g. Playwright `toHaveScreenshot`, Chromatic, Percy) is a project architecture decision. If the project has it, run it and include the result. If it doesn't, the manual before/after above still applies, and you may *suggest* adopting one in the PR's Not covered section. Don't add it unasked.

## Accessibility tooling is per project

Use whatever the project already has: axe-core, the Storybook a11y addon, Chromatic, Lighthouse, a real-accessibility-tree harness. Run it on the affected pages and quote the result. If the project has none, say so under Not covered and *suggest* one; choosing a tool is the project's decision, not the agents'. An automated tool is not a screen reader: if a change alters names, roles or relations, say whether any assistive technology was actually run.
