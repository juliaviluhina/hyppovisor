# Feature Specification: Actionable Page Read

**Feature Branch**: `027-actionable-page-read`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "Add one more Jev-based MCP tool to HyppoVisor that returns only actionable elements and meaningful content — a compact, ranked page snapshot reusing jev-ultrafast ideas (atomic DOM snapshot, indexed element table, visible-text budget, single-round-trip Jev ranking). Jev proposes, interact disposes; no autonomous execution, no text generation."

## Clarifications

### Session 2026-09-21

- Q: How should the snapshot treat credential, file-upload, consent, and submit controls — list them with a refused marker, or exclude them entirely? → A: List with refused marker.
- Q: Should a failed Jev ranking request be retried before reporting the in-payload request-failure status, or attempted exactly once? → A: Bounded retries (back off on rate-limit/overload, then report failure).
- Q: When ranking succeeds but confidence is low across all candidates, return the ordering anyway or report no confident match? → A: Return the ordering with confidence values; the caller decides what to trust.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Compact actionable snapshot (Priority: P1)

An agent driving HyppoVisor needs to decide its next single `interact` step on a busy page (dozens of controls, long article text, footers). Instead of pulling the full text via `read_page` plus the full control map via `read_form_fields` and stitching them together, it calls the new tool and gets one compact payload: an indexed table of elements it can actually act on (visible, enabled, in-viewport) plus the page's meaningful visible text within an explicit budget.

**Why this priority**: This is the standalone value — smaller payloads, fewer round trips, and no loss of decision-relevant information. Everything else layers on top of it.

**Independent Test**: Can be fully tested by opening a content-heavy page with many controls, calling the tool with no goal, and confirming the payload contains every visible enabled control, no hidden/disabled control, the meaningful visible text, and an explicit statement of anything omitted — and delivers a usable decision basis for one `interact` call.

**Acceptance Scenarios**:

1. **Given** a tab showing a page with visible enabled controls and body text, **When** the agent calls the tool, **Then** it receives an indexed element table (one entry per actionable element with its role, human-readable label, and current value) and the visible text, each within a stated budget.
2. **Given** a page containing hidden, disabled, or offscreen controls, **When** the agent calls the tool, **Then** those controls are absent from the table and the payload says how many entries were omitted and why.
3. **Given** any page, **When** the agent calls the tool twice without the page changing, **Then** both payloads carry the same element identities and ordering.

---

### User Story 2 - Goal-ranked targets (Priority: P2)

The agent already knows the user's task ("fill the destination field", "open the ماهانه report link"). It passes that goal alongside the read and gets the same snapshot with the elements ordered (or annotated) by relevance to the goal, including a per-candidate confidence signal — so it can pick the right target for its next `interact` without re-reading or guessing. The ranking is advisory only: the agent still chooses, and `interact`'s safety verdicts still dispose.

**Why this priority**: Ranking removes the "which of these 40 controls?" reasoning burden, which is where agents waste the most context today. It depends on Story 1's snapshot.

**Independent Test**: Can be fully tested by calling the tool with the same page and two different goals and confirming the top-ranked element differs appropriately and each ranking carries a confidence signal the agent can inspect.

**Acceptance Scenarios**:

1. **Given** a page with several similar fields and a stated goal naming one of them, **When** the agent calls the tool with that goal, **Then** the matching element ranks first with a confidence signal attached.
2. **Given** a goal the visible page cannot satisfy, **When** the agent calls the tool, **Then** the payload reports that no candidate matches rather than forcing a pick.
3. **Given** the ranking service is unavailable (no key, rate limit, outage), **When** the agent calls the tool with a goal, **Then** it still receives the unranked snapshot from Story 1 with an explicit ranking status explaining why ranking is absent — not an error and not a silent omission.

---

### User Story 3 - Draft-safe preparation flow (Priority: P3)

The agent uses the snapshot to prepare a draft (fill a plain field, tick a plain checkbox, choose a plain option) via the existing `interact` tool. Nothing about the new tool changes what is permitted: submit/consent/credential/outward-labelled controls stay refused, nothing submits, and the human performs every external act.

**Why this priority**: Guards the constitutional boundary — the new tool must make preparation faster without widening what preparation may do.

**Independent Test**: Can be fully tested by snapshotting a form containing both plain fields and a submit control, then confirming `interact` still refuses the submit control when addressed via the snapshot's index.

**Acceptance Scenarios**:

1. **Given** a snapshot that includes a submit control (to reveal its label), **When** the agent attempts to act on it through `interact`, **Then** the existing refusal applies unchanged.
2. **Given** a snapshot taken before a navigation, **When** the agent addresses an element from the stale snapshot, **Then** the action is rejected as stale rather than applied to whatever now occupies that position.

---

### Edge Cases

- What happens when the page navigates or mutates between the snapshot and the `interact` that uses it? (Stale references must be rejected, never reinterpreted.)
- How does the tool handle pages with no actionable elements (pure article text)?
- How does the tool handle very large pages where the element table or text exceeds the budget? (Explicit omission counts and truncation markers, never silent drops.)
- What happens when two snapshots of the "same" page disagree because async content settled between them?
- Credential, file-upload, and consent controls are listed with a refused marker and never actionable (see FR-002); their values are omitted where sensitive.
- Low-confidence rankings are returned as-is with their confidence values; the tool never suppresses an ordering for being uncertain — the caller decides what to trust.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose one new read-only MCP tool that returns, in a single call, an indexed table of a tab's actionable elements (visible, enabled, in-viewport controls) plus the tab's meaningful visible text.
- **FR-002**: System MUST exclude non-actionable nodes from the table: hidden/`aria-hidden` content, disabled controls, offscreen elements, scripts, styles, and decorative nodes. Credential, file-upload, consent, and submit controls MUST be listed with an explicit refused/unactionable marker (never actionable, values omitted for credentials) so the agent can see why a visible control has no usable entry.
- **FR-003**: Each table entry MUST carry at minimum a stable-within-snapshot index, the element's role, its human-readable label (accessible name), and its current value/state where applicable.
- **FR-004**: System MUST bound both the element table and the text extract by explicit budgets, and MUST report omission counts and truncation markers whenever content is cut — never silently.
- **FR-005**: Element references in the payload MUST be snapshot-scoped, not reusable selectors or addresses: using them after the page changes MUST fail safe (stale rejection), and model output MUST never become executable input (no selectors, coordinates, or scripts generated from rankings).
- **FR-006**: When the caller supplies a goal, the tool MUST compute relevance ordering over the table entries inside HyppoVisor via a Jev call, returning the ordering with per-candidate confidence. Ranking relies on a user-provided `TYPESAFE_API_KEY` at environment level (the user holds their own TypeSafe account); the app provides no key of its own. Without a key, or when the Jev request errors, the tool MUST still return the snapshot and report the ranking failure explicitly in the payload (see FR-010) — never throw.
- **FR-007**: Text scope MUST be the full meaningful visible text of the page within the stated budget (read_page-style), so one call replaces the read_page + read_form_fields pair.
- **FR-008**: System MUST treat the tool as a pure derivation: it acts on nothing, submits nothing, writes no audit entry for the read itself, and persists no page content.
- **FR-009**: System MUST keep every existing `interact` refusal and safety verdict unchanged for actions addressed via the new snapshot — the snapshot grants no new capability to act.
- **FR-010**: When ranking is requested but unavailable (missing `TYPESAFE_API_KEY` or Jev request error after bounded retries with backoff on rate-limit/overload responses), the tool MUST return the unranked snapshot PLUS an explicit machine-readable ranking status (e.g. `ranking: unavailable`, with a reason distinguishing missing key from request failure) so the caller can see what happened. The tool MUST NOT throw or return a transport-level error in this case.

### Key Entities *(include if feature involves data)*

- **Actionable Element**: One visible, enabled, in-viewport control the agent could address with `interact`; attributes are index (snapshot-scoped), role, label, current value/state.
- **Visible Text Extract**: The page's meaningful rendered text within an explicit budget, with truncation explicitly marked.
- **Relevance Ranking** (only when a goal is supplied): ordering over the table entries with per-candidate confidence; advisory, never an instruction.
- **Omission Record**: counts and reasons for anything excluded or cut (hidden/disabled/offscreen nodes, over-budget entries).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An agent can select the correct target for its next preparation step from a single tool call on pages with 30+ controls, with the correct element ranked first in at least 9 of 10 sampled cases.
- **SC-002**: Payloads for typical content pages are at most half the combined size of the equivalent `read_page` + `read_form_fields` output while retaining every visible enabled control.
- **SC-003**: 10 of 10 reads on an unchanged page return identical element identities and ordering.
- **SC-004**: Zero new external-act or refusal-bypass incidents attributable to the tool: every attempted action on a snapshot element is still governed by the existing `interact` safety verdicts.

## Assumptions

- Constitution Principles I (human does every external act), III (one window, no new stores/services), IV (no credential handling), and V (verbatim, self-sufficient, explicitly-truncated payloads; no page content persisted) constrain the design; the plan MUST include a Constitution Check.
- Principle II (no judgment in HyppoVisor) is read as barring job/career/connection judgments; DOM-relevance ordering is treated as derived read-only guidance on the same footing as `read_form_fields`' existing per-field verdicts — to be confirmed in the Constitution Check at plan time.
- The ranking behaviour reuses the established Jev-over-HTTP pattern (single bundled request sharing one observed state, probabilities + confidence in the response) and never generates fill text — a separate concern that stays with the agent/user.
- The user holds their own TypeSafe account and provides `TYPESAFE_API_KEY` at environment level; HyppoVisor never embeds, provisions, or validates the key beyond using it for the ranking call.
- If no API key is configured, or the Jev request fails, the tool returns the unranked snapshot with an explicit ranking status (missing-key vs request-failure) rather than throwing; key storage follows the existing env-var configuration precedent.
- Snapshot capture is atomic per read (controls, names, values, and text from one settled state); async-settling behaviour follows the existing `read_page` readiness precedent.
