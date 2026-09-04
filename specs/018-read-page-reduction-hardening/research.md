# Phase 0 Research: Read Page Reduction Hardening

No `NEEDS CLARIFICATION` markers remained in the Technical Context after `/speckit-specify` —
this feature is a hardening pass on an already-shipped, already-understood code path
(`src/main/page/read.ts`), not new surface. The items below record the design decisions the
plan depends on, since they weren't pre-existing "unknowns" so much as "how exactly do the
four bundled fixes get implemented without touching each other's blast radius."

## R1: How does the root element get classified for removal (FR-001/FR-002)?

- **Decision**: Before cloning, run the same three removal predicates
  (`script`/`style` tag name, `svg[aria-hidden="true"]`) against the root node itself, in
  addition to the existing `clone.querySelectorAll(...)` descendant sweep. If the root
  matches, `__reduceDom` returns `""` immediately rather than proceeding to clone/attribute-
  strip a node that's about to be discarded anyway.
- **Rationale**: `querySelectorAll` is defined to never match its own calling element (it
  matches descendants only) — that's the exact mechanism `__reduceDom` currently relies on for
  removal, so it structurally cannot cover the root. The cheapest fix that preserves the
  existing descendant logic unchanged is a root pre-check gate rather than restructuring the
  removal sweep to run against a synthetic wrapper.
- **Alternatives considered**:
  - *Wrap the root in a synthetic parent, run the existing sweep, unwrap.* Rejected — adds a
    detach/reattach step and risks the wrapper's own tag/attributes leaking into
    `outerHTML` if unwrapping is done wrong; a direct predicate check is simpler and cheaper.
  - *Have the caller (`readPage`) pre-check the root before invoking `__reduceDom` at all.*
    Rejected — duplicates the removal-target list (tag names, `aria-hidden` check) across the
    Node-side caller and the in-page script string, which are already two different execution
    contexts; keeping the predicate inside `__reduceDom` keeps a single source of truth.

## R2: How does `readPage`/`readPageScript` skip work when `includeDom` is false (FR-009/FR-010)?

- **Decision**: `readPageScript` gains a fourth branch (crossed with the existing
  `selector`/no-`selector` split): when `includeDom` is `false`, emit a script that computes
  only `text` (and `url`/`title`) and never references `__reduceDom` or `el.outerHTML` /
  `document.documentElement.outerHTML` at all. `readPage()` passes `includeDom` down into
  `readPageScript` (a new parameter) instead of only using it to decide whether to attach
  `found.dom` to the response after the fact.
- **Rationale**: The waste is inside the in-page script itself (clone + `TreeWalker` +
  attribute loop), which already runs inside `wc.executeJavaScript` before any Node-side code
  sees the result — so the fix has to change what script gets injected, not add a Node-side
  short-circuit after the fact (that would still pay the in-page cost).
- **Alternatives considered**:
  - *Keep one script shape, branch inside the injected function on an `includeDom` value
    passed in.* Rejected — `executeJavaScript` scripts here are plain expressions built by
    string concatenation with no argument-passing mechanism already in use; threading a value
    in would mean a bigger refactor (e.g. wrapping in an IIFE taking params) for no benefit
    over generating the right branch ahead of time, which the function already does for
    `selector`/no-`selector` and `reduceDom`/no-`reduceDom`.

## R3: Where does the FR-011 release note live?

- **Decision**: No new file. `body_path: .github/RELEASE_NOTES_HEADER.md` plus
  `generate_release_notes: true` in `.github/workflows/release.yml` means GitHub auto-compiles
  release notes from merged PR titles at tag time. FR-011 is satisfied by giving the PR that
  ships these fixes a title/description line that explicitly names the `reduceDom` default-on
  behavior and the `reduceDom: false` opt-out (per the `pr-description` skill's Notable
  decisions section) — no CHANGELOG.md or similar file exists in this repo to maintain
  separately.
- **Rationale**: Matches the repo's existing, working release-notes mechanism instead of
  introducing a second, redundant one (Principle III: prefer the smallest mechanism that
  works).
- **Alternatives considered**: *Add a `CHANGELOG.md`.* Rejected — no such file exists for any
  of the three prior releases (`v0.2.0`-`v0.4.0`); introducing one for a single line item is
  disproportionate and would need to be positioned as its own decision, not a side effect of
  this feature.

## R4: Fixture and test extension strategy (FR-003 through FR-008)

- **Decision**: Extend the existing `tests/fixtures/dom-noise-repro.html` fixture in place
  (add `<script>`/`<style>`/comment descendants *inside* `#job-list`, and a small
  root-removable-node fixture region for FR-005's direct-selector cases) rather than creating
  parallel fixture files; extend the existing `tests/integration/read-page.spec.ts` (which
  already owns US1/US2 read-page coverage) with new `test(...)` cases rather than a new spec
  file.
- **Rationale**: Feature 017's own test suite already established this fixture and spec file
  as the home for reduction-pass coverage; splitting coverage across new files would fragment
  a single logical test surface for no isolation benefit (all cases exercise the same
  `read_page` MCP call against the same running Electron app / fixture server).
- **Alternatives considered**: *New fixture + new spec file dedicated to this feature.*
  Rejected — `read-page.spec.ts` already pays the fixed cost of `launchApp()` /
  `startFixtureServer()` once per file (`beforeAll`); a second file would duplicate that
  startup cost for tests that are conceptually extensions of the same existing coverage, not a
  new feature surface.

**Output**: All four Technical Context items above are resolved; no `NEEDS CLARIFICATION`
markers remain.
