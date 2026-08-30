# Feature Specification: Structured Form-Field Reader

**Feature Branch**: `005-read-form-fields`

**Created**: 2026-08-30

**Status**: Draft

**Input**: User description: "add this 005 … look our dialog above" — a tool that reads a
page and returns its form fields in a shape convenient for building a batch `fill`
(feature `004-batch-fill`).

## Overview

To fill a form today an agent has to reconstruct the field map itself outside HyppoVisor:
`read_page` returns either verbatim prose (labels, but no selectors) or the entire document
HTML (163 KB on the Legion application form — over the tool-result token limit, so it spills
to a file the agent then parses with a local script). There is no middle option that says
"here are the fillable controls: selector, kind, label, current value."

This feature adds a **structured form-field reader**: one read-only call that returns a
bounded, ordered list of the page's form controls, one record per control, in a shape that
drops straight into a batch `fill` (`004`) — and, later, into dropdown handling (`006`).

It performs no interaction. It is a *derived* view: `read_page` stays the verbatim
page-text/DOM accessor; this tool reformats and filters, so it is a separate tool with its
own contract, not a replacement.

Boundaries kept from the constitution:

- **No external act (Principle I).** Read-only. It does not fill, click, open a menu, or
  submit anything.
- **No interpretation (Principle II).** It returns structure only — selectors, kinds,
  labels, options, current values, and the mechanical safety verdict `interact` would apply.
  It MUST NOT infer what value a field wants, rank fields by importance, or decide which are
  "worth" filling.
- **Comprehensible, enumerable (Principle III).** The result is a bounded list of controls,
  not the whole DOM. Caps and truncation are explicit.
- **User-held credentials (Principle IV).** A credential field's current value is never
  returned.
- **Verbatim / self-sufficient reads (Principle V).** `read_page` remains the verbatim
  payload. This tool's labels and option text are returned verbatim (never summarised or
  paraphrased); only selection and ordering are derived. Truncation, when a cap applies, is
  indicated. Nothing is stored — the payload is the only copy.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Get the field map for a form in one call (Priority: P1)

An agent has opened a job-application page. It calls the form-field reader on that tab and
receives an ordered list of controls: for each one, a selector `interact` can use, the
control kind, its accessible label, whether it sits inside a `<form>`, and its current
value. It maps values onto those selectors and issues one batch `fill`. No DOM dump, no
local parsing step.

**Why this priority**: This is the reason the feature exists — replace "dump 163 KB of HTML
and regex it locally" with one structured call.

**Independent Test**: On a multi-field form, call the reader once; confirm the result lists
every visible control with a working selector and a label, fits in a single tool result
(no spill-to-file), and that the selectors feed a batch `fill` without a whole-batch
rejection.

**Acceptance Scenarios**:

1. **Given** a page with a form of plain text, email, tel, select, and file controls,
   **When** the reader is called, **Then** the result contains one record per control, each
   with a `selector`, a `kind`, and a `label`, in document order.
2. **Given** that result, **When** the agent passes each `selector` to `interact`, **Then**
   each resolves to exactly one element.
3. **Given** a control that already holds a value, **When** the reader is called, **Then**
   that control's record reports its `currentValue`, so the agent can skip it.
4. **Given** the call, **When** it completes, **Then** nothing is written to the shared data
   directory and no interaction-log entry for an interaction is produced (it is a read).

---

### User Story 2 - Know which fields a fill would refuse, before sending the batch (Priority: P1)

The reader annotates each control with the verdict `interact` would return for a `fill` on
it — `permitted`, or `refused` with the rule id (`submit-control`, `consent-toggle`,
`credential-field`, `external-act-label`, `unsafe-fill-type`). The agent uses this to build
a batch that contains only fillable targets, so the batch's all-or-nothing pre-write check
(`004` FR-005) passes on the first try.

**Why this priority**: Without it, the agent learns a target is forbidden only when the
whole batch is rejected. With it, the map is self-describing and the batch is right the
first time.

**Independent Test**: On a form containing a submit button, a consent checkbox, a password
field, and a hidden file input, call the reader; confirm each of those carries a `refused`
fill verdict with the correct rule id, and every plain field carries `permitted`.

**Acceptance Scenarios**:

1. **Given** a form with a `button[type="submit"]`, **When** the reader is called, **Then**
   that control's fill verdict is `refused` with `ruleId: "submit-control"`.
2. **Given** a password field, **When** the reader is called, **Then** its fill verdict is
   `refused` with `ruleId: "credential-field"` **and** its `currentValue` is omitted.
3. **Given** an `<input type="file">`, **When** the reader is called, **Then** its fill
   verdict is `refused` with `ruleId: "unsafe-fill-type"`.
4. **Given** every plain text/email/tel/url/number/textarea control, **When** the reader is
   called, **Then** each fill verdict is `permitted`.
5. **Given** any control, **When** the reader reports its verdict, **Then** that verdict
   matches exactly what `interact` returns for the same target.

---

### User Story 3 - See the choices a dropdown offers (Priority: P2)

For a `<select>`, and for a combobox whose option list is present in the page, the reader
returns the available options as `(label, value)` pairs. The agent can then decide which
option to choose (handled by feature `006`).

**Why this priority**: The dropdown fields (Country, Location, Education, eligibility
questions on the Legion form) are exactly what can't be completed today; the first step to
handling them is knowing the allowed choices. Lower priority than US1/US2 because value
entry for plain fields is the immediate win.

**Independent Test**: On a form with a `<select>` of countries and a react-select combobox,
call the reader; confirm the `<select>`'s record lists all its option label/value pairs, and
the combobox's record lists options when its menu is open or reports none-available when it
is closed.

**Acceptance Scenarios**:

1. **Given** a `<select>` with N `<option>`s, **When** the reader is called, **Then** its
   record's `options` array has N `(label, value)` entries in document order.
2. **Given** a combobox whose option elements are not currently in the DOM, **When** the
   reader is called, **Then** its record has an empty `options` array and an
   `optionsAvailable: false` flag.
3. **Given** a combobox whose menu is open, **When** the reader is called, **Then** its
   record lists the visible options as `(label, value)` pairs.

---

### User Story 4 - Scope to one form and handle an oversized page (Priority: P3)

A page has several forms, or more controls / options than the caps. The agent can pass an
optional container selector to scope the read to one form. When a cap is hit, the result is
truncated and says so.

**Why this priority**: A guard rail (Principle III/V) and a convenience; rare on a focused
application page.

**Independent Test**: On a page with two forms, call the reader with a container selector
for one; confirm only that form's controls are returned. On a synthetic page with more
controls than the cap, confirm the result is truncated with the flag set.

**Acceptance Scenarios**:

1. **Given** a page with two `<form>`s and a call scoped by a container selector, **When**
   the reader runs, **Then** only controls inside that container are returned.
2. **Given** a page with more form controls than the control cap, **When** the reader runs,
   **Then** the result contains the first cap-many controls in document order and a
   `truncated` flag is set.
3. **Given** a `<select>` with more options than the options cap, **When** the reader runs,
   **Then** that record's `options` is truncated to the cap with a per-record truncation
   indicator.

---

### Edge Cases

- **No form controls on the page**: the result is an empty control list, not an error.
- **Control with no `id` and no `name`**: a structural selector is synthesised and verified
  unique in the page at call time. It carries the same "may go stale if the page re-renders"
  caveat as any selector.
- **Duplicate `id`s on the page** (invalid HTML): affected controls get a disambiguated
  structural selector and a flag noting the duplicate.
- **Hidden control** (`display:none` / `hidden` / zero-size — e.g. Greenhouse's real file
  input): included, with `visible: false`, so the agent knows it exists.
- **Password / one-time-code field**: listed, fill verdict `refused` / `credential-field`,
  and `currentValue` omitted entirely (never redacted-in-place with a placeholder that could
  leak length).
- **Radio group / fieldset**: each radio is its own record, tagged with a shared `group`
  name so the agent knows they are mutually exclusive.
- **`contenteditable` region**: included as `kind: "richtext"` with its current text as
  `currentValue`.
- **Shadow DOM or cross-origin `<iframe>` controls**: out of scope — not traversed; noted in
  the result only if detectable that some controls were skipped.
- **Page changes between the read and the follow-up `interact`**: same staleness risk as any
  selector; not this feature's problem to solve, but the caveat is documented.

## Requirements *(mandatory)*

### Functional Requirements

#### The reader call

- **FR-001**: The system MUST provide a read-only operation that, given a tab, returns an
  ordered list of that page's form controls. It MUST NOT perform any interaction (no fill,
  click, menu open, navigation, or submission).
- **FR-002**: The operation MUST accept an optional container selector; when given, only
  controls inside that container are returned. When omitted, all form controls on the page
  are returned, in document order.
- **FR-003**: "Form control" MUST cover `<input>` (all types), `<select>`, `<textarea>`,
  `<button>`, `contenteditable` regions, and elements carrying a form-ish ARIA role
  (`combobox`, `listbox`, `textbox`, `checkbox`, `radio`, `switch`, `button`).

#### Per-control record

- **FR-004**: Each record MUST contain: a `selector` usable directly by `interact`; a
  `kind` (one of a small named set — e.g. `text`, `textarea`, `select`, `combobox`,
  `checkbox`, `radio`, `file`, `button`, `richtext`, `other`); the raw input `type` when
  applicable; an accessible `label` assembled the same way the safety layer assembles a
  target's name (associated `<label>`, `aria-label`, `aria-labelledby`, wrapping label,
  placeholder); `required` (from `required` / `aria-required` / a "*" in the label);
  `inFormAncestor`; and `visible`.
- **FR-005**: Each record MUST report `currentValue` — the control's current text value, or
  checked state for a toggle, or selected option value for a select — **except** for a
  credential field (`type="password"` or a credential `autocomplete`), whose `currentValue`
  MUST be omitted.
- **FR-006**: Each record MUST report the verdict `interact` would return for a `fill` on
  that `selector`: `permitted`, or `refused` with `ruleId` and `ruleDescription`. The
  verdict MUST match what `interact` actually returns for the same target (same rule set,
  same safe-fill-type allowlist).
- **FR-007**: Each record MUST also report the verdict `interact` would return for a `click`
  on that `selector`, in the same shape (useful for dropdown handling in `006`).
- **FR-008**: For a `<select>`, and for a combobox whose option elements are present in the
  page, each record MUST include an `options` array of `(label, value)` pairs in document
  order. For a combobox with no option elements present, `options` MUST be empty and
  `optionsAvailable` MUST be `false`.
- **FR-009**: A radio control's record MUST include a `group` identifier shared by the other
  radios of the same group.

#### Bounds and truncation

- **FR-010**: The result MUST cap the number of controls returned (control cap) and the
  number of options per control (options cap). When a cap is hit, the result MUST be
  truncated to the cap in document order and MUST set a truncation indicator — a
  result-level flag for the control cap, a per-record indicator for the options cap.
- **FR-011**: Every returned `label` and option `label`/`value` MUST be verbatim page text —
  never summarised, paraphrased, or reordered within its own list.

#### Output and storage

- **FR-012**: The result MUST be a single payload (no spill-to-file) for any form up to the
  control cap. It MUST identify the tab and the observation time.
- **FR-013**: The operation MUST NOT write anything to the shared data directory and MUST
  NOT persist the payload. Like `read_page`, the returned payload is the only copy.
- **FR-014**: The operation MUST NOT add an interaction-audit-log entry (it is a read, not
  an interaction). Whether it is logged elsewhere as a read is an implementation choice, not
  a requirement here.

#### Scope of the change

- **FR-015**: `read_page` MUST be unchanged and remains the verbatim page-text / DOM
  accessor. This feature adds a separate, explicitly-derived reader.
- **FR-016**: No constitution amendment is required. The operation is read-only and adds no
  external act.

### Key Entities

- **Form field map**: the ordered list of form-control records for one tab at one moment,
  plus the tab id, observation time, and the control-cap truncation flag. Not stored.
- **Form-control record**: `selector`, `kind`, `type`, `label`, `required`, `group`,
  `inFormAncestor`, `visible`, `currentValue` (omitted for credentials), `options`,
  `optionsAvailable`, `optionsTruncated`, `fillVerdict`, `clickVerdict`, and any
  disambiguation flags (duplicate id, synthesised selector).
- **Option**: a `(label, value)` pair for a `<select>` or combobox choice.
- **Verdict**: `permitted`, or `refused` with `ruleId` + `ruleDescription` — identical in
  shape and content to what `interact` returns.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a real multi-field application form, one reader call returns a working
  `selector`, a `kind`, and a non-empty `label` for 100% of the visible form controls, with
  no DOM dump and no external parsing step.
- **SC-002**: 100% of returned selectors resolve to exactly one element when passed to
  `interact` at the time of the call.
- **SC-003**: For a form of up to the control cap, the reader returns its result in a single
  tool payload that does not exceed the size limit `read_page` with full DOM does — i.e. it
  never spills to a file.
- **SC-004**: For every control, the reported `fillVerdict` and `clickVerdict` match what
  `interact` returns for that same target — 100% agreement, verified across all rule
  categories.
- **SC-005**: No credential field's current value is ever present in the payload.
- **SC-006**: `<select>` controls list 100% of their `(label, value)` option pairs up to
  the options cap; a combobox with no options in the DOM reports zero options and
  `optionsAvailable: false`.
- **SC-007**: Nothing from the call is written to the shared data directory or persisted;
  the payload is the only copy.
- **SC-008**: Building a batch `fill` (`004`) solely from this reader's `permitted` controls
  produces a batch that passes `004`'s pre-write check with zero forbidden-target refusals.

## Assumptions

- **Read-only; no amendment.** The operation is in the same category as `read_page` — it
  reads and returns; it never acts.
- **`read_page` stays the verbatim accessor.** This reader is a derived, filtered, reordered
  view and does not replace it (Principle V).
- **Control cap = 200, options cap per control = 200.** Comfortably above any real
  application form; truncation is flagged when exceeded.
- **Selector preference order:** `#id` when the id is unique on the page → `[name="…"]` when
  unique → a synthesised structural selector verified unique at call time.
- **Scope default = whole page**, with an optional container selector to narrow it.
- **Reuses `003` unchanged**: the accessible-name assembly and the blocklist + safe-fill-type
  verdicts are the same logic `interact` uses; the reader only reports them.
- **Combobox options are returned only when their elements are in the DOM.** The reader does
  not open menus — opening/selecting is feature `006`.
- **Shadow DOM and cross-origin iframe controls are out of scope** and are not traversed.
- **Staleness is the caller's concern**, same as for any selector obtained from a page read.
- **The interaction audit log is not touched** — this is a read.

## Out of Scope

- **Any interaction** — opening or closing dropdown menus, selecting options, filling,
  clicking. That is `interact`, `004` (batch fill), and `006` (dropdowns).
- **Inferring or suggesting values** for any field.
- **Non-form page content** (headings, prose, job description) — that is `read_page`.
- **Shadow DOM and cross-origin iframe traversal.**
- **Change watching / streaming** — the reader is a point-in-time snapshot.
- **Persisting or caching the field map** — it is returned and forgotten, like `read_page`.
