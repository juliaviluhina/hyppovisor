# Feature Specification: Choose an Option in a Dropdown

**Feature Branch**: `006-select-dropdown-option`

**Created**: 2026-08-30

**Status**: Draft

**Input**: User description: "006 - about dropdowns management — look our dialog above".
The gap surfaced live: on the Legion application form, `#country`, `#candidate-location`,
the three Education selects, and the two eligibility questions could not be completed.
`click` on the option is refused by `in-form`; a `role="option"` cannot be focused for
`space`; `fill` on the combobox input only filters the list, it never commits a choice.

## Overview

`003-in-form-fill` lets an agent type values into plain fields and tick a plain checkbox.
It deliberately left option selection out: typing into a `<select>` or a combobox container
is meaningless, so those were excluded from the safe-fill allowlist. The result is that
every dropdown on a real application form is a dead end for the agent.

This feature adds one bounded operation — **choose an option in a dropdown** — that, given a
chooser control and a target option (by visible label, or by value), makes that control hold
that option as its selected value. The app performs the mechanics (open the widget if it is
a custom one, narrow the list if it has a filter box, activate the one matching option,
close the widget). The agent makes one call, not a fragile sequence of clicks.

It is still preparation, not an external act: choosing an option cannot submit a form. The
1.2.0 amendment to Principle I already blesses "pressing Space to … pick a highlighted
option"; this feature generalises that to "pick an option by name," with the app locating
the option relative to the identified control so it never becomes a general "click anything
in a form."

Boundaries kept from the constitution:

- **The human performs every external act (Principle I).** Choosing an option never submits,
  sends, or applies. The option the app activates is confined to the identified chooser's
  own option list. Submit controls, consent toggles, credential fields, and outward-action
  wording remain refused.
- **No interpretation (Principle II).** The caller names the option (label or value); the
  app matches it exactly and activates it. The app does not decide which option is "right,"
  does not fuzzy-match, and does not create options.
- **Comprehensible, enumerable (Principle III).** One new operation with a small, named set
  of valid target kinds. One interaction in flight, one audit entry per call.
- **User-held credentials (Principle IV).** Unchanged; a credential field is not a chooser
  and is refused.
- **Assistive pace (Principle V).** One call selects one option in one control the human's
  page already shows. Not a crawl, not bulk.

## Clarifications

### Session 2026-08-30

- Q: What should the new `interact` operation be named (tool schema, `InteractOperation` type, audit `operation` field)? → A: `choose_option`.
- Q: How is a target with no `<select>` tag and no `role="combobox"`/`role="listbox"` recognised as a valid chooser? → A: It is not — a valid chooser is a `<select>`, an element with `role="combobox"`/`role="listbox"`, or an element that owns a `role="listbox"` via `aria-controls`/`aria-owns`. No class-name or structural guessing; anything else is refused "not a dropdown".
- Q: What error code do the non-rule refusals carry? → A: A new `ErrorCode` `CHOOSE_OPTION_FAILED` with `details.reason` ∈ {`not-a-dropdown`, `no-option-match`, `ambiguous-option`, `option-disabled`, `option-not-appeared`, `multi-select`}. Rule-match refusals keep `REFUSED_EXTERNAL_ACT`.
- Q: Does `choose_option` verify the selection stuck, or return optimistically? → A: Verify — re-read the control after activation; on mismatch refuse with `CHOOSE_OPTION_FAILED` / `option-not-appeared` and report no change. A permitted result is returned only when the read-back matches.
- Q: When both `label` and `value` are supplied, how are they combined? → A: `value` is the primary key; the option is chosen by exact `value`, and its visible label must also match the given `label` (case-insensitive, trimmed) or the call is refused `no-option-match`.

Decisions still carried by informed default (see Assumptions): single-select only (v1),
exact label match (no fuzzy), no option creation in creatable comboboxes, and a one-line
Principle I clarifying amendment (1.2.0 → 1.3.0).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choose an option in a native `<select>` inside a form (Priority: P1)

An agent has the field map (from `005`). It calls the choose-option operation with
`#country` and the option label "United States". The `<select>` now has that option
selected and fires its change event. Nothing is submitted.

**Why this priority**: Native `<select>` is the simplest dropdown and appears on most
forms (all three Education fields on the Legion form are selects).

**Independent Test**: On a form with a country `<select>`, call choose-option with a valid
option label; confirm the control's current value is that option afterward, the tab has not
navigated, and one audit entry was written.

**Acceptance Scenarios**:

1. **Given** a `<select>` inside a `<form>` with an option "United States", **When** the
   agent calls choose-option with that label, **Then** the operation is permitted and the
   `<select>`'s selected value is that option.
2. **Given** the same call, **When** it completes, **Then** the tab URL is unchanged and no
   form submission occurred.
3. **Given** a caller that supplies the option `value` instead of the label, **When**
   choose-option is called, **Then** the matching option is selected.
4. **Given** any permitted choose-option, **When** it completes, **Then** the audit log has
   one entry recording the operation, the control selector, and the permitted outcome.

---

### User Story 2 - Choose an option in a react-select / ARIA combobox inside a form (Priority: P1)

The agent calls choose-option with `#candidate-location` and "Berlin, Germany". The app
opens the combobox, types the label into its filter box if it has one, waits for the
option to appear, activates the single matching `role="option"`, and confirms the menu
closed with that value selected.

**Why this priority**: The custom comboboxes (Country, Location, eligibility questions) are
exactly what has no path today.

**Independent Test**: On a form with a react-select-style combobox, call choose-option with
a valid option label; confirm the control shows that value afterward, the option menu is
closed, and nothing was submitted.

**Acceptance Scenarios**:

1. **Given** a combobox whose options are only present when its menu is open, **When**
   choose-option is called with a valid label, **Then** the app opens the menu, selects the
   matching option, the menu closes, and the control's displayed value is that option.
2. **Given** a combobox with a filter box, **When** choose-option is called, **Then** the
   app may type the label to narrow the list, but MUST activate only the exactly-matching
   option.
3. **Given** a combobox whose option list is populated asynchronously, **When**
   choose-option is called, **Then** the app waits a bounded time for the option to appear;
   if it does not, the operation is refused with an "option did not appear" reason and the
   control is unchanged.

---

### User Story 3 - Wrong or dangerous targets are refused (Priority: P1)

The operation only accepts a chooser control. A non-chooser, a chooser that matches a
consent/credential/outward-action rule, a label that matches no option, a label that matches
several options, and a disabled option are each refused with a specific reason. `in-form`
does **not** refuse a real chooser.

**Why this priority**: The feature is only acceptable if it cannot become a general
"activate any element inside a form" and if a bad request never leaves the control in a
surprising state.

**Independent Test**: Call choose-option against a plain text input, a submit button, a
`<select>` with an "I agree" label, a valid `<select>` with a nonexistent option label, and
a `<select>` with a duplicated option label; confirm each is refused with its own reason and
none changes a control.

**Acceptance Scenarios**:

1. **Given** a target that is not a `<select>`, not `role="combobox"` / `role="listbox"`,
   and does not own a `role="listbox"` via `aria-controls` / `aria-owns`, **When**
   choose-option is called, **Then** it is refused with `CHOOSE_OPTION_FAILED` /
   `reason: "not-a-dropdown"`.
2. **Given** a chooser whose accessible name matches an outward-action or consent rule,
   **When** choose-option is called, **Then** it is refused with that `ruleId`
   (`external-act-label` / `consent-toggle`).
3. **Given** a chooser inside a `<form>` matching no other rule, **When** choose-option is
   called, **Then** `in-form` does NOT refuse it — the operation proceeds.
4. **Given** an option label that matches no option in the control, **When** choose-option
   is called, **Then** it is refused with a "no option matches" reason and the control is
   unchanged.
5. **Given** an option label that matches more than one option and no disambiguating
   `value`, **When** choose-option is called, **Then** it is refused as ambiguous, the
   matching option labels are listed, and the control is unchanged.
6. **Given** a matching option that is disabled, **When** choose-option is called, **Then**
   it is refused with an "option is disabled" reason.

---

### User Story 4 - Selection is audited and verifiable (Priority: P2)

Every choose-option call, permitted or refused, appends exactly one interaction-log entry.
After a permitted call, a follow-up form read (`005`) or DOM read shows the control's
current value equal to the chosen option.

**Why this priority**: Consistency with the rest of `interact`'s observability contract;
lets the agent confirm the selection stuck without a screenshot.

**Independent Test**: Make one permitted and one refused choose-option call; confirm the log
grew by exactly two entries with the right outcomes, and that a form read reports the chosen
value for the permitted one.

**Acceptance Scenarios**:

1. **Given** any choose-option call, **When** it resolves, **Then** the interaction log has
   one new entry with the operation, the control selector, the outcome, and the `ruleId` or
   reason when refused.
2. **Given** a permitted choose-option, **When** the control is read afterward, **Then** its
   reported current value is the chosen option's value (or label).

---

### Edge Cases

- **Option list is server-backed and never renders**: bounded wait, then refuse; control
  unchanged.
- **Combobox already has a selection**: choose-option replaces it; repeated calls with the
  same target are idempotent.
- **`<select multiple>` or a multi-value combobox**: refused with a "multi-select not
  supported" reason (out of scope for this feature).
- **Creatable combobox, label not among existing options**: refused — the app does not
  create a new option.
- **Duplicate option labels**: refused as ambiguous unless a `value` disambiguates.
- **A `<select onchange>` that submits the form on selection** (jump menu): residual risk —
  the app performs the selection and the page's own handler may submit. Documented, not
  preventable from a selector; the same class of residual risk as `003`'s "submits on
  change" note. Not expected on multi-field application forms.
- **Control removed mid-operation**: the operation errors with a reason; nothing else is
  affected.
- **`click` / `fill` / `space` on the same control**: unchanged. `click` on a
  `role="option"` inside a form is still refused by `in-form`; choose-option is the
  sanctioned path.

## Requirements *(mandatory)*

### Functional Requirements

#### The choose-option operation

- **FR-001**: `interact` MUST accept a new operation, `choose_option`, that selects an option
  in a dropdown, given a control selector and a target option identified by `label` and/or
  `value`. It takes a `tabId`, the control `selector`, and the option identifier. The name
  `choose_option` is used in the tool schema, the `InteractOperation` type, and the audit
  log's `operation` field.
- **FR-002**: The target control MUST be a *chooser*, defined exactly as: a `<select>`, an
  element with `role="combobox"` or `role="listbox"`, or an element that owns a
  `role="listbox"` via `aria-controls` or `aria-owns`. No class-name, framework-name, or
  structural guessing is used. Any other target MUST be refused with
  `CHOOSE_OPTION_FAILED` / `reason: "not-a-dropdown"`.
- **FR-003**: The control MUST be evaluated against the existing blocklist rules
  (`submit-control`, `consent-toggle`, `external-act-label`, `credential-field`). On a
  match, the operation MUST be refused with that rule's id and description. The `in-form`
  rule MUST NOT be applied to this operation (choosing an option is preparation, like
  `fill`).

#### Matching

- **FR-004**: The app MUST match the target option **exactly**, with no fuzzy, prefix, or
  substring matching:
  - `label` only → the option whose visible label equals `label` (case-insensitive,
    whitespace-trimmed).
  - `value` only → the option whose value equals `value` exactly.
  - both `label` and `value` → `value` is the primary key; the option is chosen by exact
    `value`, and that option's visible label MUST also match `label` (case-insensitive,
    whitespace-trimmed) or the call is refused `CHOOSE_OPTION_FAILED` /
    `reason: "no-option-match"`.
- **FR-005**: If no option matches, the operation MUST be refused with
  `CHOOSE_OPTION_FAILED` / `reason: "no-option-match"` and the control MUST be left
  unchanged.
- **FR-006**: If more than one option matches the `label` and no `value` disambiguates, the
  operation MUST be refused with `CHOOSE_OPTION_FAILED` / `reason: "ambiguous-option"`,
  listing the matching option labels, and the control MUST be left unchanged.
- **FR-007**: If the matching option is disabled, the operation MUST be refused with
  `CHOOSE_OPTION_FAILED` / `reason: "option-disabled"`.
- **FR-008**: The app MUST NOT create a new option (creatable comboboxes): a label that is
  not among the existing options is an FR-005 `no-option-match` refusal.

#### Mechanics

- **FR-009**: For a custom combobox, the app MAY open the menu and MAY type the target label
  into the control's filter input to narrow the list, but MUST activate only the single
  exactly-matching option, and MUST leave the widget closed afterward.
- **FR-010**: When the option list populates asynchronously, the app MUST wait a bounded
  time (the existing wait-for-selector budget) for the matching option to appear; if it does
  not, the operation MUST be refused with `CHOOSE_OPTION_FAILED` /
  `reason: "option-not-appeared"` and the control left unchanged.
- **FR-011**: A completed selection MUST NOT trigger navigation or form submission by the
  app; the app performs only the selection and the change events a real option choice
  produces.
- **FR-012**: Selecting on a control that already has a value MUST replace it; repeated
  `choose_option` calls with the same target and option MUST be idempotent.
- **FR-013**: After activating the matching option, the app MUST re-read the control's
  current value (native `<select>.value`, or the combobox's displayed value / selected
  `role="option"`). If it does not equal the chosen option, the operation MUST be refused
  with `CHOOSE_OPTION_FAILED` / `reason: "option-not-appeared"` and reported as leaving the
  control unchanged. A permitted result is returned only when the read-back matches.

#### Result and audit

- **FR-014**: A permitted `choose_option` MUST return the chosen option as `{ label, value }`
  alongside the standard permitted result shape.
- **FR-015**: Every `choose_option` call — permitted or refused — MUST append exactly one
  entry to the interaction audit log, recording the operation (`choose_option`), the control
  selector, the outcome, and the `ruleId` (rule match) or `reason` (non-rule refusal).
- **FR-016**: A refusal payload MUST keep the existing shape — an error code, a
  human-readable message, and either `ruleId` + `ruleDescription` (a `submit-control` /
  `consent-toggle` / `external-act-label` / `credential-field` match, code
  `REFUSED_EXTERNAL_ACT`) or `reason` (code `CHOOSE_OPTION_FAILED`, `reason` ∈
  `not-a-dropdown` / `no-option-match` / `ambiguous-option` / `option-disabled` /
  `option-not-appeared` / `multi-select`). `CHOOSE_OPTION_FAILED` is a new `ErrorCode`.

#### Scope of the change

- **FR-017**: `.specify/memory/constitution.md` Principle I MUST be extended with one clause
  making explicit that *choosing an option in a non-credential, non-consent `<select>` or
  combobox* is permitted preparation, on the same footing as entering a value. The amendment
  MUST be recorded in the constitution's amendment history with a version bump (1.2.0 →
  1.3.0, MINOR).
- **FR-018**: The `interact` tool description MUST be updated to document the `choose_option`
  operation: valid targets (single-select `<select>` / `role="combobox"` / `role="listbox"` /
  an element owning a `role="listbox"` via `aria-controls`/`aria-owns`), exact-match
  semantics, read-back verification, whole-operation refusal for non-choosers and rule
  matches, and that it never submits.
- **FR-019**: `click`, `fill`, `scroll`, and `space` MUST be unchanged. `<select>` remains
  refused for `fill` (`003`'s `unsafe-fill-type`); `choose_option` is the path for a
  `<select>`.
- **FR-020**: `<select multiple>` and multi-value comboboxes MUST be refused with
  `CHOOSE_OPTION_FAILED` / `reason: "multi-select"`.

### Key Entities

- **Choose-option request**: a control `selector` plus a target option identified by
  `label` and/or `value`.
- **Chooser control**: the only valid targets — a single-select `<select>`, an element with
  `role="combobox"` or `role="listbox"`, or an element that owns a `role="listbox"` via
  `aria-controls` / `aria-owns`. Nothing else qualifies.
- **Option**: a `(label, value)` pair, plus a disabled flag.
- **Selection result**: the chosen `{ label, value }` and the outcome; or a refusal —
  `REFUSED_EXTERNAL_ACT` with `ruleId` + `ruleDescription` for a blocklist-rule match, or
  `CHOOSE_OPTION_FAILED` with `reason` for a non-rule failure.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the Legion application form, the agent can set Country, Location (City), all
  three Education selects, and both eligibility questions — 100% of the single-select
  dropdowns — each in one choose-option call, with nothing submitted.
- **SC-002**: After a permitted choose-option, the control's reported current value equals
  the requested option (by label or value) 100% of the time.
- **SC-003**: 100% of choose-option calls targeting a non-chooser, a consent / credential /
  outward-action chooser, a no-match label, an ambiguous label, a disabled option, or a
  multi-select control are refused with a specific reason, and none of them changes a
  control.
- **SC-004**: `in-form` never refuses a choose-option on a real chooser, while a `click` on
  the same option element inside the form remains refused by `in-form`.
- **SC-005**: Every choose-option call — permitted or refused — produces exactly one
  interaction-log entry with the operation, target, outcome, and rule id or reason.
- **SC-006**: No choose-option call navigates or submits the form (the tab's URL is
  unchanged), barring a page's own on-change handler.
- **SC-007**: Chaining `005` (read the options) → this feature (choose them) → `004` (batch
  fill the plain fields) produces a complete application draft with no manual field entry
  and no submission.

## Assumptions

- **Single-select only (v1).** `<select multiple>` and multi-value comboboxes are refused
  (FR-020). Adding/removing multiple values is a later feature.
- **Exact match, no fuzzy.** Case-insensitive, whitespace-trimmed label match, or an exact
  `value` match. Ambiguity and no-match both refuse rather than guess (FR-004–FR-006).
- **No option creation.** Creatable comboboxes are treated as fixed lists; an unknown label
  refuses.
- **Bounded async wait.** The app waits a fixed short interval (reuse the existing
  wait-for-selector budget) for an option to render before refusing (FR-010).
- **Read-back verification.** A permitted result is only returned after re-reading the
  control and confirming it holds the chosen option; a mismatch is refused
  `CHOOSE_OPTION_FAILED` / `option-not-appeared` with the control reported unchanged (FR-013).
- **Operation name.** The operation is `choose_option` everywhere — tool schema,
  `InteractOperation` type, audit `operation` field.
- **Non-rule failures share one code.** `CHOOSE_OPTION_FAILED` (a new `ErrorCode`) with a
  `reason` discriminator; blocklist-rule matches still use `REFUSED_EXTERNAL_ACT`.
- **One operation for native and custom dropdowns.** A `<select>` and a react-select
  combobox are the same operation to the caller; the app handles the mechanics.
  `003`'s refusal of `fill` on a `<select>` is unchanged.
- **Principle I gets a one-line clarifying extension**, MINOR version bump (1.2.0 → 1.3.0),
  consistent with how `003` handled its boundary. Choosing an option is not a new external
  act; the amendment makes the existing "preparation" boundary explicit for dropdowns.
- **Reuses `003` and `005`.** The blocklist verdicts are `003`'s unchanged; option discovery
  and the chooser classification align with `005`'s form-field records.
- **Nothing stored.** The operation acts and reports; no new persistent state, one audit
  entry, snapshot behaviour.

## Out of Scope

- **Deselecting or clearing a selection.**
- **Multi-select / multi-value controls.**
- **Creating new options** in creatable comboboxes.
- **Date, color, and file pickers** — not choosers in this sense; file upload remains its
  own unsolved gap.
- **Cascading dependent dropdowns** beyond the caller issuing separate choose-option calls
  in order.
- **Options that require a network fetch that never resolves** — bounded wait, then refuse.
- **Any change to `click` / `fill` / `scroll` / `space`**, to submit/consent/credential
  handling, or to the `in-form` rule's effect on `click`.
