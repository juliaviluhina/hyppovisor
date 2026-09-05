# Feature Specification: Read Page Ancestor Escalation and Exclusion

**Feature Branch**: `009-read-page-ancestor-escalation`
**Created**: 2026-09-04
**Status**: Ready for planning
**Input**: User description: "Implement specs/issues/009-read-page-ancestor-escalation.md"

## User Scenarios & Testing

### User Story 1 - Read context around a matched element (Priority: P1)

As an orchestrator, I can read an ancestor of a selector match so that a scoped read
contains the surrounding context needed to understand the page without guessing a new selector.

**Why this priority**: Ancestor escalation is the primary capability in this issue.

**Independent Test**: Read a fixture with a selector and increasing ancestor levels; the returned
text and optional DOM contain the selected ancestor subtree and identify the effective scope.

**Acceptance Scenarios**:

1. **Given** a selector matching an element, **When** `ancestorLevels` is omitted or `0`, **Then**
   the read starts at that first matching element exactly as an existing selector-scoped read.
2. **Given** a selector matching an element with ancestors, **When** `ancestorLevels` is `N > 0`,
   **Then** the read starts at the Nth ancestor and includes its visible text and subtree DOM.
3. **Given** a selector matching multiple elements, **When** the read is requested, **Then** the
   first match is used before ancestor escalation.
4. **Given** an ancestor level deeper than the document, **When** the read is requested, **Then**
   the effective root is clamped to the highest available document element and the result reports
   the effective level.

### User Story 2 - Trim unwanted descendants (Priority: P1)

As an orchestrator, I can exclude matching descendant subtrees from a read so that an escalated
context does not bring along irrelevant or sensitive sibling content.

**Why this priority**: Exclusion is the natural companion to widening a read and is useful in the
same request.

**Independent Test**: Read a fixture with `exclude` selectors and verify excluded text and DOM are
absent while retained content and scope metadata remain present.

**Acceptance Scenarios**:

1. **Given** a selected root containing elements matching `exclude`, **When** the read is made,
   **Then** matching subtrees are omitted from both returned text and DOM.
2. **Given** an exclusion selector matching nothing within the selected root, **When** the read is
   made, **Then** it succeeds without changing the result.
3. **Given** a selector that would exclude the selected root itself, **When** the read is made,
   **Then** it fails with a clear target error rather than returning an empty read.
4. **Given** `selector`, `ancestorLevels`, and `exclude` together, **When** the read is made,
   **Then** escalation occurs first, exclusions are applied only inside that root, and reduction
   behavior is applied afterward.

## Edge Cases

- `ancestorLevels` must be an integer greater than or equal to zero; invalid values are rejected.
- `ancestorLevels` without `selector` is rejected because there is no match from which to climb.
- Invalid CSS in either `selector` or `exclude` is rejected as `INVALID_SELECTOR`.
- Exclusions cannot affect content outside the selected root.
- Exclusion matching is evaluated against the selected root's descendants in document order; nested
  matches are removed as one subtree.
- Existing truncation, text-vs-DOM options, no-match errors, and DOM reduction remain in effect.

## Requirements

### Functional Requirements

- **FR-001**: `read_page` MUST accept optional `ancestorLevels` and `exclude` inputs in addition
  to the existing `selector` and `reduceDom` inputs.
- **FR-002**: `ancestorLevels` MUST default to `0`, require `selector`, and accept only a
  non-negative integer.
- **FR-003**: The read MUST resolve the first selector match, walk up at most the requested number
  of element ancestors, and clamp at the highest available document element.
- **FR-004**: The result MUST identify the supplied selector, requested ancestor level, effective
  ancestor level, and exclusions when any scope control was supplied.
- **FR-005**: Each valid exclusion selector MUST remove matching descendant subtrees from both
  visible text and optional DOM output; unmatched exclusions MUST be no-ops.
- **FR-006**: An exclusion that matches the effective root MUST fail with `TARGET_NOT_FOUND` (or an
  equally clear existing target error) and MUST NOT return an empty successful result.
- **FR-007**: Invalid CSS selectors MUST fail with `INVALID_SELECTOR`, consistently for scope and
  exclusion selectors.
- **FR-008**: Exclusions MUST be limited to the effective selected root and MUST NOT change the
  live page.
- **FR-009**: Existing selector-scoped behavior, unscoped behavior, truncation, and DOM reduction
  MUST remain backward compatible when the new inputs are omitted.
- **FR-010**: The capability MUST remain a read-only operation and MUST NOT persist page content.

### Key Entities

- **Read scope**: The effective root selected by `selector` and `ancestorLevels`, plus the
  exclusion selectors and effective level used to produce the result.
- **Page read result**: The existing transient read payload extended with scope metadata.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A caller can obtain a requested ancestor context in one `read_page` request without
  selector guess-and-retry.
- **SC-002**: 100% of matching excluded subtrees are absent from both text and DOM in acceptance
  fixtures, while non-excluded content remains unchanged.
- **SC-003**: Existing read tests pass unchanged when new inputs are omitted, including truncation
  and reduction behavior.
- **SC-004**: Every scoped or escalated result lets a caller determine its effective root and
  exclusions from the returned metadata.

## Assumptions

- The established first-match CSS selector convention and existing selector error codes remain the
  public behavior.
- The highest available document element is the clamping boundary.
- Exclusion selectors are an ordered list of CSS strings and are applied within the effective root.
- Scope metadata may be represented as additive optional fields so existing consumers remain valid.
