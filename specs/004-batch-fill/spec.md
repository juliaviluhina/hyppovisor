# Feature Specification: Batch Fill Operation for `interact`

**Feature Branch**: `004-batch-fill`

**Created**: 2026-08-29

**Status**: Draft

**Input**: User description: "batch fill operation for interact"

## Overview

Today every field of a form is a separate `interact` call. Each call is a full
orchestrator round-trip: the agent issues one tool call, waits for the result, decides the
next, issues another. Drafting an eight-field application form is eight of those round-trips
in strict sequence — the wall-clock cost the human notices is almost entirely this loop, not
the app (each `fill` returns in well under a second, and the app-wide queue was never
backed up).

This feature adds a **batch fill**: one `interact` call that carries an ordered list of
`(target, value)` pairs and applies them in a single queued operation. One call, one
orchestrator turn, one queue slot — N fields instead of N calls.

It changes no permission. A batch of value entries is the same permitted *preparation* that
feature `003-in-form-fill` established (constitution Principle I, amended 1.2.0): entering a
value is not an external act. Every target in the batch is checked against the exact same
safety rules a single `fill` faces; a batch can never submit, and a batch that includes a
forbidden target is refused whole, with nothing typed.

Boundaries kept from the constitution:

- **The human performs every external act (Principle I).** No submit, send, apply. A batch
  completing never triggers navigation or submission. Submit controls, consent/agreement
  toggles, credential fields, and file inputs are refused per target, and their presence
  refuses the whole batch.
- **No interpretation (Principle II).** The app types each value it is given, in order. It
  does not read, validate, reorder, or judge the fields, the values, or the page.
- **Comprehensible, enumerable (Principle III).** A batch is still *one* interaction in
  flight (one queue slot); the per-field writes inside it are sequential. The batch size is
  capped and the cap is a single named number.
- **User-held credentials (Principle IV).** The `credential-field` rule is unchanged and
  still evaluated for every target in the batch.
- **Assistive pace, not bulk collection (Principle V).** One batch fills one form the human
  opened. It is not a crawl and not bulk third-party extraction. The cap keeps a batch to
  the scale of a real form.

## Clarifications

### Session 2026-08-30

- Q: How should a batch fill handle a field that can't be written, and does the whole batch stop or keep going? → A: Hybrid. All-or-nothing pre-write check (resolve + rule-check every target; any forbidden or unresolved target refuses the whole batch, nothing written), then best-effort write (a field that fails mid-write is marked `error` and the batch continues). This is FR-004/FR-005 (pre-write) + FR-007/FR-008 (write phase) as already written.
- Q: What is the maximum number of `(field, value)` pairs one batch fill call may carry? → A: 50. A batch of 51+ pairs is refused with nothing written (FR-003).
- Q: When a batch finishes with some fields written and at least one errored mid-write, what does the batch-level outcome say? → A: A distinct value. Batch outcome is one of `permitted` (all fields written), `partial` (≥1 written and ≥1 errored), or `refused` (whole-batch pre-write failure — cap, empty, forbidden target, or unresolved selector). Per-field entries and counts are always present (FR-010, FR-013).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Draft a whole form in one call (Priority: P1)

An agent has read a form and built a field map: `#first_name` → "Iuliia", `#last_name` →
"Iliukhina", `#email` → "…", `#phone` → "…", `#question_12559436007` → a LinkedIn URL. It
issues **one** `interact` fill call carrying all five pairs. The app writes each value in
order and returns a single result listing every field and its outcome. Nothing is submitted.

**Why this priority**: This is the entire point of the feature — collapse N orchestrator
round-trips into one so drafting a form is closer to human speed.

**Independent Test**: On a multi-field form, issue one batch fill with five plain-field
pairs; confirm the single result reports all five permitted, a follow-up read shows the
entered values, the tab has not navigated or submitted, and only one tool call was made.

**Acceptance Scenarios**:

1. **Given** a form with five plain value fields and a batch fill listing all five
   `(selector, value)` pairs, **When** the agent issues the one call, **Then** all five
   fields hold their values and the result reports five `permitted` outcomes.
2. **Given** that same call, **When** it completes, **Then** the tab's URL is unchanged and
   no form submission or navigation occurred.
3. **Given** the batch result, **When** the agent inspects it, **Then** it contains a
   per-field entry (selector + outcome) for every pair and a summary count of fields
   requested and fields written.
4. **Given** the batch, **When** it completes, **Then** the audit log has one entry per
   field written plus one batch-summary entry.
5. **Given** a batch that repeats a selector already filled earlier, **When** it runs,
   **Then** the field holds the last value given (replace, not append — inherited from
   `003` FR-017).

---

### User Story 2 - A batch with a forbidden target is refused whole (Priority: P1)

An agent's field map accidentally includes a submit button, a consent checkbox, a password
field, or a résumé file input among the pairs. The batch is refused before any field is
written. The refusal names every offending target and its rule. No value from the batch is
typed.

**Why this priority**: The feature is only acceptable if it cannot become a way to slip a
forbidden interaction past the per-target rules, and if a policy violation never leaves the
form half-filled in a surprising state.

**Independent Test**: Issue a batch of four plain-field pairs plus one `#password` pair;
confirm the whole call is refused, the refusal lists `#password` with rule
`credential-field`, and a follow-up read shows none of the four plain fields changed.

**Acceptance Scenarios**:

1. **Given** a batch where one pair targets an `<input type="password">`, **When** the call
   is made, **Then** the entire batch is refused, zero fields are written, and the refusal
   payload names `#password` with `ruleId: "credential-field"`.
2. **Given** a batch that includes a `button[type="submit"]`, a consent checkbox, or an
   `<input type="file">`, **When** the call is made, **Then** it is refused whole with each
   offending target and its rule id listed (`submit-control` / `consent-toggle` /
   `unsafe-fill-type`).
3. **Given** a batch with two forbidden targets, **When** it is refused, **Then** the
   refusal lists both, not just the first.
4. **Given** a refused batch, **When** the audit log is read, **Then** it records each
   refused target and one batch-summary entry marked refused, and no `permitted` field
   entries for that batch.

---

### User Story 3 - A field that fails mid-write is reported, not fatal (Priority: P2)

Every selector resolves and passes the rules at the pre-write check, so the batch proceeds.
Then the page re-renders and removes one element before its turn to be written. That one
field's result is `error` with a reason; every other field is still filled and reported
`permitted`. (A selector that fails to resolve *at the pre-write check* is the different
case in US2 / FR-005: the whole batch is refused and nothing is written.)

**Why this priority**: Forms re-render; a single element vanishing mid-batch should cost one
field, not the whole draft. Lower priority than US1/US2 because it is a resilience case, not
the core flow.

**Independent Test**: Run a batch of five pairs that all pass the pre-write check, but arrange
for one target to be removed from the page just before its write; confirm four fields are
filled and reported `permitted`, the fifth is reported `error`, the batch-level outcome is
`partial`, and the summary shows four written / one errored.

**Acceptance Scenarios**:

1. **Given** a batch where every selector resolves and passes the rules at the pre-write
   check, but one element is removed by the page before its write, **When** the batch runs,
   **Then** that field's per-field outcome is `error` with a reason, every other field is
   filled and reported `permitted`, and the batch-level outcome is `partial`.
2. **Given** such a partially-errored batch, **When** the result is returned, **Then** the
   summary counts distinguish fields written from fields errored.
3. **Given** a batch where one selector resolves to nothing *at the pre-write check*, **When**
   the call is made, **Then** the whole batch is refused with that selector named as
   unresolved and nothing is written (this is the US2 / FR-005 path, not this story's
   mid-write path).

---

### User Story 4 - An oversized batch is refused (Priority: P3)

A batch carries more pairs than the cap. It is refused with a clear message; nothing is
written.

**Why this priority**: A guard rail that keeps a "batch" at the scale of a real form
(Principle V). Rare in practice.

**Independent Test**: Issue a batch with one pair more than the cap; confirm it is refused
naming the cap and the count given, and a read shows no field changed.

**Acceptance Scenarios**:

1. **Given** a batch with more than the maximum allowed pairs, **When** the call is made,
   **Then** it is refused, the message states the cap and the number supplied, and zero
   fields are written.
2. **Given** a batch with zero pairs, **When** the call is made, **Then** it is refused with
   a "no fields" reason.

---

### Edge Cases

- **Duplicate selector in the list**: both pairs are applied in order; the field ends with
  the last value. Both produce audit entries.
- **A pair targets a combobox filter input** (`role="combobox"`/`"textbox"` on an
  `<input>`): allowed, filters the option list only — inherited from `003` FR-004. Choosing
  an option is still not part of a fill.
- **A pair targets a field matching a dangerous-wording rule** (`external-act-label`): that
  target is one of the offenders that refuses the whole batch (US2).
- **The list contains only forbidden targets**: refused whole, every target listed.
- **A single-field form that submits on `change`**: same residual risk as a single `fill`
  (inherited from `003`); not introduced by batching.
- **Batch fill vs. single fill on the same call**: the caller supplies either a single
  target+value or a list, never both; supplying both is refused as a malformed call.
- **Ordering matters for a dependent field** (rare — e.g. a field that only enables after
  another is set): the app applies pairs strictly in the order given, so the caller controls
  sequencing.
- **`click`, `scroll`, `space`**: unchanged, single-target only. No batch form of these.

## Requirements *(mandatory)*

### Functional Requirements

#### The batch fill call

- **FR-001**: `interact` MUST accept, for the `fill` operation, an ordered list of
  `(target, value)` pairs as an alternative to a single target + value. A call MUST supply
  exactly one of the two forms; supplying both, or neither, MUST be refused as a malformed
  call with a clear message.
- **FR-002**: A batch fill MUST execute as a single queued operation (one interaction in
  flight, per Principle III/V). The per-field writes within it MUST be applied in the order
  the pairs were given.
- **FR-003**: A batch MUST carry at most **50** pairs (the batch cap). A batch of 51 or more
  pairs MUST be refused with a message naming the cap and the count supplied, and MUST write
  nothing. A batch with zero pairs MUST be refused with a "no fields" reason.

#### Pre-write check (all-or-nothing for policy and resolution)

- **FR-004**: Before writing any field, the app MUST resolve every target and evaluate each
  against the same safety rules a single `fill` faces: the blocklist rules
  (`submit-control`, `consent-toggle`, `external-act-label`, `credential-field`) and the
  safe-fill-type allowlist. `in-form` MUST NOT gate a batch fill (as it does not gate a
  single `fill`).
- **FR-005**: If **any** target in the batch is refused by a rule, or does not resolve to an
  element, the **entire batch** MUST be refused and **zero fields** MUST be written. The
  refusal MUST list every offending target with, for rule matches, its `ruleId` and
  description, and for unresolved targets, a "no element matches" reason.
- **FR-006**: The whole-batch refusal payload MUST keep the shape used elsewhere — an error
  code, a human-readable message, and a per-target breakdown (each with selector and either
  `ruleId` + `ruleDescription` or an unresolved reason).

#### Write phase (best-effort after a passing pre-write check)

- **FR-007**: After the pre-write check passes, the app MUST write every field, clearing
  then setting each value (replace semantics, inherited from `003` FR-017).
- **FR-008**: If an individual field write fails at execution time (e.g. the element was
  removed by the page after the check), that field's per-field outcome MUST be `error` with
  a reason, and the app MUST continue with the remaining fields. A write-time error MUST NOT
  abort the batch.
- **FR-009**: A completed batch MUST NOT trigger navigation or form submission by the app;
  the app performs only the value entry and the per-field input/change events a single edit
  produces.

#### Result

- **FR-010**: A batch fill MUST return a single aggregate result containing: a batch-level
  `outcome` of `permitted` (all fields written), `partial` (at least one field written and
  at least one errored), or `refused` (whole-batch pre-write failure per FR-003 / FR-005);
  a per-field array (selector + per-field outcome `permitted` | `error` + message when
  errored); and summary counts (pairs requested, fields written, fields errored).
- **FR-011**: The per-field array MUST have one entry per pair supplied, in the same order.

#### Audit and observability

- **FR-012**: Every field actually written or errored MUST append one entry to the
  interaction audit log (operation, selector, outcome, and error text when errored) — the
  same obligation a single `fill` carries.
- **FR-013**: Each batch MUST additionally append one batch-summary entry to the audit log
  recording the operation kind (batch fill), the number of pairs, the batch-level outcome
  (`permitted` | `partial` | `refused`), and the written/errored/refused counts.
- **FR-014**: A whole-batch refusal (FR-005 / FR-003) MUST append one audit entry per
  offending target plus one batch-summary entry marked refused, and MUST NOT append any
  `permitted` field entry for that batch.

#### Scope of the change

- **FR-015**: The `interact` tool description MUST be updated to document the batch form of
  `fill`: an ordered list of `(target, value)` pairs, applied in one call; whole-batch
  refusal when any target is forbidden or unresolved; best-effort completion for write-time
  errors; the batch cap.
- **FR-016**: `click`, `scroll`, and `space` MUST be unchanged and remain single-target.
  No batch form of those operations is added.
- **FR-017**: No constitution amendment is required. A batch of value entries is the same
  permitted preparation as a single `fill` (Principle I, amended 1.2.0); this feature adds
  no new permission and no external act.

### Key Entities

- **Batch fill request**: an ordered list of `(target selector, value)` pairs, length
  between 1 and the batch cap. The alternative to a single `fill`'s one target + value.
- **Per-field result**: one record per supplied pair — selector, outcome (`permitted` |
  `error`), and a message when errored. Order matches the request.
- **Batch summary**: for one batch — the batch-level outcome (`permitted` | `partial` |
  `refused`), counts (pairs requested, fields written, fields errored), and, on whole-batch
  refusal, the offending-target list.
- **Batch cap**: the fixed maximum number of pairs a batch may carry — **50**.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Drafting an N-field form (N up to the batch cap) takes exactly **one**
  `interact` call and one orchestrator round-trip, regardless of N.
- **SC-002**: For a 10-field plain-value form, the single batch call returns its result in
  under 2 seconds of app-side time (excluding orchestrator think time) — i.e. the cost is
  one field-write budget, not N sequential tool round-trips.
- **SC-003**: 100% of batches that include a submit control, consent toggle, credential
  field, file input, or unresolved selector are refused with **zero** fields written, and
  every offending target is named in the refusal.
- **SC-004**: 100% of batches produce the expected audit trail: one entry per field
  written or errored, plus exactly one batch-summary entry; a refused batch adds one entry
  per offending target and no `permitted` field entries.
- **SC-005**: A write-time failure on one field of a batch never prevents the other fields
  in the same batch from being filled; the result reports batch-level `partial`, and its
  counts and per-field entries distinguish written from errored fields.
- **SC-006**: Batches over the cap, and empty batches, are refused with nothing written and
  a message that states the cap (or "no fields").
- **SC-007**: Field values are applied in the order supplied — verifiable with a
  duplicate-selector batch whose field ends holding the last value.

## Assumptions

- **Batch cap = 50 pairs** (confirmed, Session 2026-08-30; see FR-003). Comfortably covers
  the largest realistic job-application form; adjustable later without a design change.
  Chosen to keep a "batch" at the scale of one form (Principle V), not an automated
  form-farming primitive.
- **Best-effort write after a passing pre-write check.** Already-typed values are not rolled
  back on a later field's error — rollback is impossible for typed input and unnecessary
  since the human reviews the whole draft before submitting. Predictability is provided at
  the front instead: a policy violation or unresolved selector refuses the batch before
  anything is written (FR-005).
- **No artificial delay between field writes.** Principle V pacing governs page loads and
  crawling to pages the human did not open; it does not require throttling keystrokes within
  one form the human already opened. The single-in-flight queue still applies to the batch
  as a whole.
- **Reuses `003` unchanged.** The safe-fill-type allowlist, the blocklist rules, and the
  clear-then-set replace behavior are inherited as-is. Batch fill adds no rule and no
  permission.
- **The interaction audit log (`interaction-log.jsonl` in the app's `userData` directory)
  is the right place for the per-field and batch-summary entries.** No new store.
- **`click` / `scroll` / `space` stay single-target.** Batching is a `fill`-only affordance
  because value entry is the operation the human wants prepared in bulk; activations are not.

## Out of Scope

- **Batch `click`, batch `space`, or mixed-operation batches** — value entry only.
- **Transactional / rollback semantics** — no un-typing of already-written fields.
- **Parallel field writes** — pairs are applied sequentially within the one queued batch.
- **Retrying a stale selector** — a write-time miss is reported, not retried.
- **Selecting `<select>` / react-select options** — still the separate combobox gap; batch
  fill only sets values and filter strings, never picks an option.
- **Any change to submit, consent, credential, or file-input handling** — those remain
  refused, and now also refuse the batch that contains them.
