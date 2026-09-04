# Feature Specification: Read Page DOM Noise Reduction

**Feature Branch**: `017-read-page-dom-noise-reduction`

**Created**: 2026-09-04

**Status**: Draft

**Input**: User description: "specs/issues/008-read-page-dom-noise-reduction.md"

## Clarifications

### Session 2026-09-04

- Q: Should noise reduction default to on (opt-out) or off (opt-in) when a caller requests DOM
  content? → A: Default **on** (opt-out) — `read_page({ includeDom: true })` returns reduced
  DOM unless the caller passes `reduceNoise: false`. `includeDom` is itself already an explicit
  opt-in, and reduction never drops visible text or meaningful attributes (FR-005/FR-006), so a
  reduced-by-default DOM stays self-sufficient for the common case; a caller needing verbatim
  DOM re-requests with reduction off, the same escalation pattern already used for `includeDom`
  itself.
- Q: Which attributes should the first version of noise reduction strip as "presentation-only"?
  → A: Only `class` and `style` — matches exactly what real-world evidence measured (~42% of
  scoped DOM bytes), with near-zero risk of discarding attributes an orchestrator needs to find
  or re-target elements (identifiers, ARIA labels, and data attributes like `data-testid` all
  survive).
- Q: Should noise reduction also remove decorative icon graphics, which real-world evidence
  showed as the second-largest source of noise (~22% of scoped DOM bytes)? → A: Yes, but scoped
  narrowly and safely: remove an `<svg>` element only when it carries `aria-hidden="true"` — the
  web platform's own, pre-existing signal that the element has no accessible content. This is a
  fixed, content-blind rule (Principle II) with no risk to visible text or meaningful attributes:
  an `<svg>` an author marked accessible (e.g. `role="img"` with `aria-label`) is left untouched.
  Validated against a live production capture: pushed byte reduction on the source issue's
  reference page from ~56% to ~76% smaller than verbatim.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Get a page's structure without paying for its decoration (Priority: P1)

An orchestrator that reads a page's DOM content — to understand its structure, find a fresh
selector, or inspect a form's shape — wants that structure without every wrapper `<div>`,
styling attribute, icon graphic, and script/style node the page happens to carry, none of
which describes structure the orchestrator can act on.

**Why this priority**: This is the entire feature. Real-world measurement (see the source
issue) showed a selector-scoped DOM read is still ~64% presentation noise (inline SVG icons
and utility class strings) with under 5% of its bytes being actual visible text. Without this
story there is no feature — noise reduction either exists or it doesn't.

**Independent Test**: Open the `dom-noise-repro.html` fixture, read `#job-list`'s DOM content
with noise reduction requested, and confirm the result excludes `<script>`, `<style>`, HTML
comments, and presentation-only attributes, while every card's visible text (title and
company) is still present and intact in the returned markup.

**Acceptance Scenarios**:

1. **Given** a page whose DOM subtree contains `<script>` and `<style>` elements, **When** the
   caller reads that subtree's DOM content with noise reduction requested, **Then** the
   returned markup contains neither element.
2. **Given** a page whose DOM subtree contains an HTML comment, **When** the caller reads that
   subtree's DOM content with noise reduction requested, **Then** the returned markup does not
   contain the comment.
3. **Given** a page whose DOM subtree contains elements with presentation-only attributes
   (e.g. styling classes, inline styles), **When** the caller reads that subtree's DOM content
   with noise reduction requested, **Then** those attributes are absent from the returned
   markup, while the elements themselves and their text content remain.
4. **Given** a page whose DOM subtree contains meaningful, non-presentational attributes (e.g.
   an element's identifying attribute, a form field's name or value, an accessibility label),
   **When** the caller reads that subtree's DOM content with noise reduction requested, **Then**
   those attributes are preserved unchanged.
5. **Given** any DOM subtree, **When** the caller reads it with noise reduction requested,
   **Then** every element that carried visible text before reduction still carries that same
   text after reduction — reduction never removes or alters content a person or orchestrator
   would read as the page's information.
6. **Given** a page whose DOM subtree contains a decorative icon graphic explicitly marked as
   having no accessible content, **When** the caller reads that subtree's DOM content with noise
   reduction requested, **Then** that icon graphic is absent from the returned markup.
7. **Given** a page whose DOM subtree contains an icon graphic explicitly marked as carrying
   meaningful, accessible content, **When** the caller reads that subtree's DOM content with
   noise reduction requested, **Then** that icon graphic is preserved unchanged in the returned
   markup.

---

### User Story 2 - A caller can still get the full, verbatim DOM on request (Priority: P1)

An orchestrator that explicitly asks for unreduced DOM content — because it needs to inspect
something reduction might strip, or verify the verbatim markup — can always get it, byte-for-
byte, by opting out of reduction.

**Why this priority**: Reduction is lossy by design (that is its purpose) and defaults to on
(see Clarifications), so the escape hatch back to verbatim DOM is what keeps this feature from
silently weakening the read guarantee for a caller who needs the full markup — it must always
be one explicit request away, not require reconstructing content another way.

**Independent Test**: Read the same fixture's DOM content once with reduction explicitly turned
off and confirm it is byte-for-byte identical to this feature's pre-existing (unreduced)
`includeDom` output.

**Acceptance Scenarios**:

1. **Given** any page, **When** the caller reads its DOM content and explicitly opts out of
   noise reduction, **Then** the result is the full, unreduced DOM markup exactly as returned
   before this feature existed.
2. **Given** a page whose DOM content would shrink noticeably under noise reduction, **When**
   the caller opts out of reduction, **Then** no reduction is applied and the result size is
   unaffected by this feature's existence.

---

### User Story 3 - Caller can tell a reduced DOM read apart from a verbatim one (Priority: P2)

A caller (or anything reviewing a log of past reads) looking at a DOM read result needs to
know, without guessing from content alone, whether that markup is the verbatim page or has had
noise stripped from it.

**Why this priority**: Supports the self-sufficiency guarantee for reduced reads — a reduced
payload must be legible as exactly what it is, not mistaken for a verbatim capture. Mirrors the
same reasoning as the sibling selector-scoping feature's `scopedTo` indicator.

**Independent Test**: Perform a DOM read with noise reduction requested and inspect the result
for an indicator that reduction was applied; perform a DOM read without it and confirm no such
indicator is present.

**Acceptance Scenarios**:

1. **Given** a DOM read performed with noise reduction requested, **When** the result is
   inspected, **Then** it indicates that reduction was applied.
2. **Given** a DOM read performed without requesting noise reduction, **When** the result is
   inspected, **Then** it carries no reduction indicator, distinguishing it from a reduced read.

### Edge Cases

- What happens when a DOM subtree, after stripping script/style/comment nodes and
  presentation-only attributes, has no other content left (e.g. an element that existed only to
  hold a styling hook)? The read should still succeed, returning the emptied structure rather
  than failing or silently dropping the element.
- What happens when noise reduction is requested together with selector scoping (from the
  sibling feature)? Reduction applies to whichever subtree scoping already selected — the two
  options are independent and composable, matching the source issue's stated intent.
- What happens when a page has no script/style/comment nodes or presentation-only attributes at
  all? The read succeeds and the result is identical in content to the verbatim read (modulo the
  reduction indicator), since there was nothing to strip.
- What happens when the reduced DOM content, after stripping, still exceeds the existing size
  limit for DOM output (if one applies)? The same truncation behavior and indication that
  applies to unreduced DOM output today applies to reduced output.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a caller requests a page's DOM content, the page-read capability MUST, by
  default, remove non-meaningful markup from that DOM content before returning it.
- **FR-002**: The page-read capability MUST accept an optional input that, when set to opt out,
  causes DOM content to be returned exactly as it was before this feature existed — full and
  unreduced, with no change to existing content, size, or truncation behavior.
- **FR-003**: When noise reduction is applied, script elements, style elements, and HTML
  comments MUST be removed from the returned DOM content.
- **FR-004**: When noise reduction is applied, `class` and `style` attributes MUST be removed
  from the returned DOM content's elements. No other attributes are removed by this feature.
- **FR-011**: When noise reduction is applied, an icon graphic element explicitly marked as
  having no accessible content (i.e. carrying the web platform's own "no accessible content"
  signal) MUST be removed from the returned DOM content. An icon graphic explicitly marked as
  carrying meaningful, accessible content (e.g. via an accessible name) MUST be preserved.
- **FR-005**: Noise reduction MUST NOT remove or alter any element's visible text content, nor
  remove any element whose presence or attributes are needed to preserve that text's structure
  (e.g. its containing element).
- **FR-006**: Noise reduction MUST NOT require interpreting or understanding the meaning of
  page content — it operates only on a fixed, predetermined set of element types and attribute
  names, the same way selector matching in the sibling feature requires no content
  understanding.
- **FR-007**: A DOM read result produced with noise reduction applied MUST include an indicator
  that reduction was applied, so the result is self-describing.
- **FR-008**: A DOM read result produced with reduction opted out MUST NOT include a reduction
  indicator.
- **FR-009**: Noise reduction MUST be independent of and composable with selector-based
  scoping (the sibling feature): when both apply, reduction applies to the subtree selector
  scoping already narrowed the read to.
- **FR-010**: When a caller requests DOM content and does not explicitly opt out of noise
  reduction, the page-read capability MUST apply reduction by default.

### Key Entities

- **Page Read Result**: The output of reading a page — page title, URL, observed timestamp,
  visible text, and optional DOM content (itself optionally scoped to a selector, per the
  sibling feature). This feature adds an optional indicator of whether noise reduction was
  applied to the DOM content, present only when reduction was requested.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a DOM subtree matching the shape measured in the source issue's real-world
  evidence (dominated by inline icon markup and utility-class attributes), a caller requesting
  noise reduction receives DOM content at least 50% smaller by byte size than the unreduced
  equivalent, with all visible text intact. (Validated against a live capture of the reference
  page: ~76% smaller once decorative-icon removal, FR-011, is included.)
- **SC-002**: DOM reads with reduction explicitly opted out produce identical output to this
  feature's pre-existing behavior in 100% of cases — no observable change in content, size, or
  fields for any caller that opts out.
- **SC-003**: A caller reviewing any past DOM read result can determine, without external
  context, whether that read had noise reduction applied, 100% of the time.
- **SC-004**: Across reduced reads of pages containing meaningful, non-presentational attributes
  (identifiers, form field names/values, accessibility labels), 100% of that meaningful
  attribute content and all visible text survives reduction unchanged.

## Assumptions

- Noise reduction applies only to the optional DOM content of a page read; the existing plain
  visible-text output is already effectively noise-free (it already excludes script/style
  content via the browser's own text-extraction behavior) and is unaffected by this feature.
- The set of element types and attribute names treated as "noise" is fixed and predetermined at
  build time, not configurable per call — keeping the transform structural and deterministic
  rather than a judgment call, consistent with the project's zero-business-logic principle.
- This feature composes with, but does not depend on, the sibling selector-scoping feature
  (016/`specs/issues/007-read-page-selector-scoping.md`): noise reduction is equally applicable
  to a full-page DOM read as to a selector-scoped one.
- `tests/fixtures/dom-noise-repro.html` (already added alongside the source issue's real-world
  evidence) serves as this feature's offline acceptance fixture, the same role
  `chat-shell-repro.html` played for the selector-scoping feature.
- This feature does not change how the plain visible-text output is computed or truncated; only
  the optional DOM content output is affected.
- Reduction defaulting to on is a deliberate, scoped decision for this feature only: `includeDom`
  is itself already an explicit opt-in, and reduction is defined (FR-005/FR-006) to never drop
  visible text or non-presentational attributes, so a reduced-by-default DOM is judged to remain
  self-sufficient for the common case. A caller needing fully verbatim DOM opts out explicitly.
- A related but separate escalation idea — letting a caller request DOM starting from a
  specified ancestor ("N levels up") of a selector-scoped element, for cases where a reduced or
  narrowly-scoped read isn't enough context — was raised during clarification and deliberately
  kept out of this spec's scope. It is recorded as a new follow-on issue for future work, the
  same way this feature itself was split out of the selector-scoping issue.
