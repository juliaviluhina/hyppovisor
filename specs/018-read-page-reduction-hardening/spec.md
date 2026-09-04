# Feature Specification: Read Page Reduction Hardening

**Feature Branch**: `018-read-page-reduction-hardening`

**Created**: 2026-09-04

**Status**: Draft

**Input**: User description: "specs/issues/010-read-page-reduction-root-not-stripped.md,
specs/issues/011-read-page-reduction-test-coverage-gaps.md,
specs/issues/012-read-page-reducedom-default-rollout.md,
specs/issues/013-read-page-reduction-cost-when-dom-unrequested.md — four Codex-review follow-ups
against the already-shipped `017-read-page-dom-noise-reduction` feature, bundled into one spec
because all four touch the same `src/main/page/read.ts` reduction pass and its test suite."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A selector matching a removable node itself is actually reduced (Priority: P1)

An MCP caller scopes a `read_page` call directly to a node that reduction is supposed to strip —
for example `selector: "script"`, or a selector that happens to resolve to a `<style>` tag or a
decorative icon `<svg aria-hidden="true">`. With reduction on (the default), the caller expects
that node's markup to be gone from `dom`, the same way it would be if the node were a descendant
of the selected subtree rather than the subtree's root.

**Why this priority**: This is a correctness bug in already-shipped, default-on behavior — the
reduction contract (spec.md FR-004/FR-005/FR-006 of `017-read-page-dom-noise-reduction`) promises
these node types are removed, with no stated exception for "unless it's the selector match
itself." Until fixed, any caller whose selector happens to land on a removable node silently gets
the one thing reduction exists to prevent.

**Independent Test**: Can be fully tested by calling `read_page({ selector: "script", includeDom:
true })` (and the equivalent for a root `<style>` and a root decorative `<svg aria-hidden="true">`)
against a fixture containing such elements, and confirming the returned `dom` no longer contains
the removed markup.

**Acceptance Scenarios**:

1. **Given** a page with a `<script>` element, **When** `read_page({ selector: "script",
   includeDom: true })` is called (reduction on by default), **Then** the returned `dom` does not
   contain the script's markup.
2. **Given** a page with a `<style>` element, **When** a selector resolving to that element is
   read with reduction on, **Then** the returned `dom` does not contain the style's markup.
3. **Given** a page with a decorative `<svg aria-hidden="true">` icon, **When** a selector
   resolving directly to that icon is read with reduction on, **Then** the returned `dom` does not
   contain the icon's markup.
4. **Given** the same three cases, **When** the same calls are made with `reduceDom: false`,
   **Then** the returned `dom` contains the element's markup unchanged (verbatim escape hatch
   still works).

---

### User Story 2 - Reduction test coverage actually proves reduction works (Priority: P1)

A developer or reviewer changing the reduction pass needs the test suite to fail if reduction
stops working — not just when the fixture happens to contain matching content outside the scope
actually being asserted on.

**Why this priority**: The current primary reduction test reads `#job-list`'s DOM and asserts no
`<script`/`<style`, but the fixture's `<script>` and `<style>` both sit outside `#job-list` — the
assertion is true regardless of whether removal logic exists at all. This exact gap is what let
User Story 1's bug ship undetected. Fixing the test gap is as load-bearing as fixing the bug it
missed.

**Independent Test**: Can be fully tested by deleting script/style removal from the
implementation and confirming the test suite goes red (it currently would not).

**Acceptance Scenarios**:

1. **Given** a fixture with `<script>`/`<style>`/comment nodes placed *inside* the subtree a
   scoped reduction test reads, **When** that subtree is read with reduction on, **Then** the test
   asserts those nodes are absent from the result.
2. **Given** a reduced, *unscoped* `read_page({ includeDom: true })` call (no `selector`), **When**
   the suite runs, **Then** a dedicated test case covers this path (today only scoped cases and
   manual post-merge validation cover it).
3. **Given** a reduced read of a node with several non-class/style attributes, **When** the test
   compares the full attribute set before and after reduction, **Then** all of them are confirmed
   unchanged (not just the one attribute currently spot-checked).
4. **Given** a reduced read of a page with a live, page-side marker/counter, **When** the read
   completes, **Then** a test confirms the marker is unaffected — proving the live DOM was never
   mutated, only a detached clone.
5. **Given** DOM output large enough to exceed `config.maxDomBytes`, **When** it is read with
   reduction on, **Then** a test confirms truncation still applies correctly to the *reduced*
   output.

---

### User Story 3 - A text-only read doesn't pay for DOM reduction it never returns (Priority: P2)

An MCP caller doing a plain-text `read_page({ tabId })` call (no `includeDom`) expects that call's
cost not to scale with the page's DOM size or with `reduceDom`'s (irrelevant, unrequested) value.

**Why this priority**: Independent of the correctness fix — this is pure efficiency. Every
text-only call today still pays for a full-document clone, a `TreeWalker` comment pass, and a
full-tree attribute-stripping loop, whose result (`dom`) is computed and then discarded before it
reaches the caller, because `includeDom` was never plumbed into the in-page script's decision to
do that work at all.

**Independent Test**: Can be fully tested by confirming a text-only read's response is unchanged
while its execution no longer performs DOM cloning/reduction work — e.g. via a large-DOM timing
comparison that shows no meaningful cost difference between `reduceDom: true` and `reduceDom:
false` when `includeDom` is `false`.

**Acceptance Scenarios**:

1. **Given** any page, **When** `read_page({ tabId })` is called (no `includeDom`), **Then** the
   returned `text` and all other fields are identical regardless of `reduceDom`'s value, exactly as
   today.
2. **Given** a page with a large DOM, **When** a text-only read is performed, **Then** it does not
   perform the clone/`TreeWalker`/attribute-stripping work reduction requires — verified by a
   regression test rather than only informally.

---

### User Story 4 - Existing integrators learn about the default-on behavior change (Priority: P3)

An existing MCP client that was already calling `read_page({ includeDom: true })` before this
feature shipped is now silently receiving reduced (lossy) DOM plus a new `domReduced` field it has
never seen, with no pointer telling it that changed or that `reduceDom: false` restores the old
behavior.

**Why this priority**: Lowest priority of the four because the underlying default-on decision was
already deliberated and recorded during the shipped feature's own clarification pass (see
Assumptions) — this story is purely about closing the communication gap for integrators who
weren't part of that decision, not about revisiting it.

**Independent Test**: Can be fully tested by confirming a release note / changelog entry exists
that names the `reduceDom` default-on change and points to `reduceDom: false` as the opt-out,
published alongside (or before) this feature's changes ship.

**Acceptance Scenarios**:

1. **Given** this feature's changes are released, **When** an integrator checks release notes or
   the MCP contract changelog, **Then** they find an entry describing the `reduceDom` default-on
   behavior and the `reduceDom: false` opt-out.

---

### Edge Cases

- What happens when the selected root itself matches *more than one* removal category at once
  (e.g. a `<style>` element that also happens to carry a `class` attribute)? All applicable
  reductions (removal, not just attribute-stripping) must still apply consistently to the root,
  the same way they already do for descendants.
- What happens when a selector resolves to a node that is *not* removable, but is empty of visible
  content after descendant reduction strips everything inside it? The root element itself is
  still returned (only removable node types are dropped, not merely-empty ones).
- What happens when the entire document/subtree root is itself the only node and it's a removable
  type (e.g. `selector: "style"` matching the page's only `<style>`)? `dom` becomes the
  contractually-defined empty result (User Story 1) rather than throwing or returning `notFound`.
- What happens to `text` when the selected root is removed from `dom` under reduction (e.g. a
  `<script>` has no visible `innerText` anyway)? `text` continues to be computed independently from
  the original, unreduced element, unaffected by whether `dom` ends up empty.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Reduction MUST remove the selected root element itself from `dom` when the root
  matches one of the existing removal targets (`<script>`, `<style>`, or a decorative
  `svg[aria-hidden="true"]`), not only when the match is a descendant of the selected root.
- **FR-002**: When the entire selected subtree is itself a removable node, `dom` MUST be the
  empty string — behavior stays otherwise unchanged (`text`, `url`, `title`, `domReduced`, etc.
  are computed exactly as today).
- **FR-003**: The reduction test fixture MUST place `<script>`/`<style>`/comment descendants
  *inside* the subtree the primary scoped-reduction test reads, so that test genuinely exercises
  scoped removal (today it does not).
- **FR-004**: The test suite MUST include a dedicated case for a reduced, *unscoped*
  `read_page({ includeDom: true })` call (no `selector`).
- **FR-005**: The test suite MUST include dedicated cases proving FR-001/FR-002 for a selector
  resolving directly to a root `<script>`, a root `<style>`, and a root decorative
  `<svg aria-hidden="true">`.
- **FR-006**: The test suite MUST verify that all non-`class`/`style` attributes of a
  representative node are unchanged between a verbatim and a reduced read of the same node (a full
  attribute-set comparison, extending today's single-attribute spot-check).
- **FR-007**: The test suite MUST verify a reduced read never mutates the live page DOM (e.g. a
  page-side marker/counter is confirmed unaffected after the read).
- **FR-008**: The test suite MUST verify DOM truncation (`config.maxDomBytes`) still applies
  correctly to *reduced* DOM output, not only to verbatim output.
- **FR-009**: `read_page` MUST NOT perform DOM cloning, reduction, or serialization work when
  `includeDom` is `false` — only `text` is computed in that case.
- **FR-010**: A text-only read's returned fields MUST remain identical regardless of `reduceDom`'s
  value, both before and after the FR-009 optimization (no behavior change, only cost change).
- **FR-011**: A release note or changelog entry MUST document that `reduceDom` defaults to `true`
  (an intentional, already-decided compatibility-affecting default for `includeDom: true` callers)
  and that `reduceDom: false` restores the pre-feature-017 verbatim behavior.

### Key Entities

- **`PageReadResult`** (`shared/types.ts`): the existing `read_page` response shape — `dom`,
  `domReduced`, `truncated.dom`, and the other fields this feature's fixes preserve the meaning of
  but do not add to.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of `read_page` calls whose selector resolves directly to a removable node
  (`<script>`, `<style>`, decorative `<svg aria-hidden="true">`) return that node's markup
  stripped from `dom` under default reduction — zero exceptions for "selector matched the root."
- **SC-002**: Deleting script/style/comment removal from the reduction implementation causes at
  least one test to fail — confirming the test suite (not just manual inspection) would catch a
  regression of the bug this feature fixes.
- **SC-003**: A text-only `read_page` call's execution no longer scales with DOM size or with
  `reduceDom`'s value — demonstrated by a regression check showing no meaningful cost difference
  between `reduceDom: true` and `reduceDom: false` when `includeDom` is `false`.
- **SC-004**: 100% of the existing `read_page` unit and integration test suite continues to pass
  after all four fixes land, with no observable change to verbatim (`reduceDom: false`) or
  text-only output.
- **SC-005**: A release note documenting the `reduceDom` default-on behavior and its opt-out is
  published no later than when this feature's changes ship.

## Assumptions

- The `reduceDom` default-on decision itself (feature 017, `specs/017-read-page-dom-noise-
  reduction/spec.md` lines 15-19 and 223-226) is settled and out of scope here — this feature only
  closes the communication gap around it (User Story 4 / FR-011), it does not revisit whether the
  default should change.
- "Contractually-defined empty result" for a fully-removed root (FR-002) is assumed to be an empty
  string for `dom`, matching what removing that same node from within a larger subtree already
  produces today — no new sentinel value or error is introduced.
- These four fixes are scoped to the existing `read_page`/`reduceDom`/`domReduced` surface only;
  they do not add new parameters, change the default value of `reduceDom`, or touch selector
  scoping (issue 007/016) or ancestor escalation (issue 009, separate, not-yet-designed feature).
- Performance work (FR-009/FR-010) is scoped to skipping unnecessary work, not to changing
  `read_page`'s external timing/latency contract, which this project does not otherwise specify
  numerically.
