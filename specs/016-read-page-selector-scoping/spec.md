# Feature Specification: Read Page Selector Scoping

**Feature Branch**: `016-read-page-selector-scoping`

**Created**: 2026-09-04

**Status**: Draft

**Input**: User description: "look at tests/fixtures/chat-shell-repro.html and specs/issues/007-read-page-selector-scoping.md - let's work on specification"

## Clarifications

### Session 2026-09-04

- Q: When a caller asks for a scoped text read (with a selector) and also requests the page's DOM content, should the DOM content be narrowed to that same element's subtree, or should it still return the full page's DOM? → A: DOM output is scoped to the same element's subtree when a selector is supplied — narrowing is consistent across all optional read outputs.
- Q: Should deterministic DOM noise-reduction (stripping non-meaningful markup/attributes before returning DOM content) be part of this feature, or captured as a follow-on idea and kept out of this spec's scope? → A: Keep this spec to selector scoping only; record noise-reduction as an out-of-scope follow-on idea for a future issue/spec.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scope a read to one part of the page (Priority: P1)

An orchestrator driving HyppoVisor against a single-page app that keeps a persistent,
ever-growing panel (a chat log, an activity feed) alongside a "current" content pane wants to
read only the content pane, instead of paying context budget for the same unchanged panel on
every call.

**Why this priority**: This is the entire feature — the measurable waste described in the
issue (re-sending an unbounded, already-seen transcript on every read) exists only because no
narrower read is possible today. Without this story there is no feature.

**Independent Test**: Open the `chat-shell-repro.html` fixture, click "Advance turn" several
times to grow the chat log, then read with a selector targeting the detail pane. The result
contains only the detail pane's text ("Turn N") regardless of how long the chat log has grown.

**Acceptance Scenarios**:

1. **Given** a page with a `#chat-log` element (grown to several lines) and a `#detail-pane`
   element containing "Turn 5", **When** the caller reads the page with a selector targeting
   `#detail-pane`, **Then** the returned text is exactly the detail pane's visible text and
   does not include any chat log content.
2. **Given** a page with multiple elements matching a selector, **When** the caller reads the
   page with that selector, **Then** the result is scoped to the first matching element only
   (same first-match convention already used by the sibling form-fields tool).
3. **Given** a selector that matches no element on the page, **When** the caller reads the page
   with that selector, **Then** the read fails with a clear, distinct error rather than
   returning empty or unscoped content.
4. **Given** a syntactically invalid CSS selector, **When** the caller reads the page with that
   selector, **Then** the read fails with an invalid-selector error, consistent with how the
   sibling form-fields tool already reports the same failure.
5. **Given** a selector targeting `#detail-pane` and a request for the page's optional DOM
   content, **When** the caller reads the page, **Then** the returned DOM content is limited to
   `#detail-pane`'s own subtree, not the full page's DOM.

---

### User Story 2 - Full-page reads remain unchanged by default (Priority: P1)

An orchestrator that does not pass a selector continues to get exactly what it gets today: the
full page's visible text, verbatim, with existing truncation behavior untouched.

**Why this priority**: This is a hard compatibility guarantee, not an enhancement — the issue's
constitution note requires the unscoped call to keep its current behavior exactly. Any
regression here breaks every existing caller and violates the project's verbatim/self-sufficient
read guarantee for unscoped reads.

**Independent Test**: Read the same fixture page without passing a selector, before and after
this feature ships, and confirm byte-for-byte identical output (same full-body text, same
truncation behavior, same fields present).

**Acceptance Scenarios**:

1. **Given** any page, **When** the caller reads the page without specifying a selector,
   **Then** the result contains the full page's visible text exactly as today, with no new
   required fields and no change to existing truncation behavior.
2. **Given** a page whose full text exceeds the existing size limit, **When** the caller reads
   the page without a selector, **Then** truncation is applied exactly as it is today (same
   limit, same indication that truncation occurred).

---

### User Story 3 - Caller can tell a scoped read apart from a full-page read (Priority: P2)

A caller (or anything reviewing a log of past reads) looking at a read result needs to know,
without guessing from length or content alone, whether that result covers the whole page or
only a narrowed part of it.

**Why this priority**: Supports the self-sufficiency guarantee for scoped reads — a scoped
payload must be legible as exactly what it is, not mistaken for a full-page capture. This is a
smaller addition than the scoping capability itself, but it's what keeps the feature from
silently weakening the existing read guarantee.

**Independent Test**: Perform a scoped read and inspect the result for a marker that identifies
what part of the page it covers; perform an unscoped read and confirm no such marker is present.

**Acceptance Scenarios**:

1. **Given** a read performed with a selector, **When** the result is inspected, **Then** it
   indicates which selector scoped the read.
2. **Given** a read performed without a selector, **When** the result is inspected, **Then** it
   carries no scoping indicator, distinguishing it from a scoped read.

### Edge Cases

- What happens when the selector matches an element that has no visible text (e.g. an empty
  container, or one hidden via CSS)? The read should still succeed, returning whatever text the
  element's rendering yields (which may be empty), rather than falling back to the full page.
- What happens when the targeted element's content still exceeds the existing size limit on its
  own? The same truncation behavior and indication that applies to full-page reads today applies
  to the narrowed text.
- What happens when the page navigates or the targeted element is removed between the caller
  choosing a selector and the read executing? This is the same "content changed during read"
  situation full-page reads already tolerate; no new failure mode is introduced.
- What happens when a caller supplies both a selector and requests the page's DOM content?
  Scoping is consistent across the whole read: the DOM content returned is narrowed to the
  same element's subtree as the text, not the full page's DOM (see Clarifications).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The page-read capability MUST accept an optional selector input that, when
  provided, narrows the returned text to the visible text of the first element matching that
  selector, instead of the full page's visible text.
- **FR-002**: When the selector input is omitted, the page-read capability MUST behave exactly
  as it does today — returning the full page's visible text with no change to existing fields,
  limits, or truncation behavior.
- **FR-003**: When a supplied selector is syntactically invalid, the read MUST fail with a
  distinct, clearly identifiable error rather than silently falling back to a full-page read or
  returning malformed output.
- **FR-004**: When a supplied selector is syntactically valid but matches no element on the
  page, the read MUST fail with a distinct, clearly identifiable error rather than returning
  empty or unscoped content.
- **FR-005**: When a supplied selector matches more than one element, the read MUST use the
  first match only, consistent with the existing convention used elsewhere in this system for
  selector-based scoping.
- **FR-006**: A read result produced with a selector MUST include an indicator of which
  selector was used to scope it, so the result is self-describing.
- **FR-007**: A read result produced without a selector MUST NOT include a scoping indicator.
- **FR-008**: The existing size-limit and truncation behavior applied to page-read text MUST
  continue to apply to the narrowed text of a scoped read, with truncation indicated the same
  way it is for an unscoped read.
- **FR-009**: All other fields currently returned by a page read (page title, URL, timestamp)
  MUST remain present and unaffected by whether the read is scoped.
- **FR-010**: When a selector is supplied together with a request for the page's optional DOM
  content, the returned DOM content MUST be narrowed to the selected element's subtree, the
  same way the text is narrowed — scoping applies consistently across every optional output of
  the read, not to text alone.

### Key Entities

- **Page Read Result**: The output of reading a page — currently page title, URL, observed
  timestamp, visible text, and optional DOM content. This feature adds an optional indicator of
  which selector scoped the read, present only when a selector was supplied.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a page with a persistent, ever-growing panel and a separately-scoped content
  pane, a caller can retrieve just the content pane's text, and that result's size stays
  constant across repeated reads regardless of how large the persistent panel has grown.
- **SC-002**: Unscoped reads produce identical output to today's behavior in 100% of cases —
  no observable change in content, size, or fields for any caller that does not opt into
  scoping.
- **SC-003**: A caller reviewing any past read result can determine, without external context,
  whether that read was scoped and to what, 100% of the time a selector was used.
- **SC-004**: An invalid or non-matching selector produces a clear failure distinguishable from
  both a successful scoped read and a successful unscoped read, so a caller never mistakes a
  failed narrowing for either.

## Assumptions

- This feature only narrows *which* text is returned; it does not add a mechanism for
  detecting "nothing new since the last read" (that is explicitly out of scope per the source
  issue, and left as a possible future feature).
- The first-match convention for a selector matching multiple elements mirrors the existing
  convention already established by the sibling form-fields read capability, chosen for
  consistency rather than specified fresh.
- Selector scoping is available on-demand per read call; there is no persistent "default
  selector" configuration for a tab or session.
- This capability is opt-in only — a caller must explicitly supply a selector to narrow a
  read — consistent with the constitution's requirement that unscoped reads keep their full,
  verbatim, self-sufficient guarantee unchanged.
- Deterministic DOM noise-reduction (stripping non-meaningful markup before returning DOM
  content, independent of selector scoping) is explicitly out of scope for this feature. It is
  a materially bigger design question — what counts as "noise," a default-on/off toggle,
  attribute/whitespace/script handling — and is recorded as a follow-on idea in
  `specs/issues/008-read-page-dom-noise-reduction.md` rather than folded in here.
