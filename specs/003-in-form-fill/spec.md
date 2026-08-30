# Feature Specification: Fill Form Fields and the Space Key

**Feature Branch**: `003-in-form-fill`

**Created**: 2026-08-29

**Status**: Draft

**Input**: User description: "for the B + Space change (probably folded together with the constitution amendment)" — from issue `specs/issues/001-in-form-rule-blocks-all-field-fills.md`, decision section.

## Overview

Today HyppoVisor can read a web form and its structure but cannot write a single value into
it. The `in-form` safety rule refuses `fill` on **any** element inside a `<form>`, on the
grounds that typing into a field could lead to a submission. On a real application form
(every input inside one `<form>`) this blocks 100% of fields — an agent can produce a
value map, but a human must type every value by hand.

This feature separates **entering a value** from **performing an external act**:

1. **In-form fill (decision "B").** `fill` is permitted on a form field when the field is a
   plain value input of a safe type and no other safety rule matches it. Buttons, submit
   controls, consent toggles, credential fields, and `<select>` / combobox activation stay
   refused. Nothing submits — a submit is still a separate, still-refused `click`.
2. **The Space key.** A new `interact` operation that acts as "activate the currently focused
   element," evaluated against the same rules a `click` on that element would face. It closes
   the gap where filling a value isn't enough — e.g. accepting a highlighted option or
   ticking a plain checkbox — without exposing any submit path.
3. **Constitution amendment.** Principle I is amended with one clause: entering a value into
   a non-credential, non-consent form field is permitted *preparation*, distinct from an
   external act. The human still performs every submit.

Boundaries kept from the project constitution:

- **The human performs every external act (Principle I).** No submit, no send, no apply. The
  amendment narrows what counts as an "act," it does not grant the app one. Submit controls,
  consent/agreement toggles, and anything matching outward-action wording remain refused for
  both `click` and the new Space operation.
- **No interpretation (Principle II).** The app types the value it is given; it does not
  read, validate, or judge the field or the page.
- **Comprehensible, enumerable (Principle III).** The change is to existing rules plus one
  new operation. The safe-input-type allowlist is a single named list, inspectable like the
  blocklist rules.
- **User-held credentials (Principle IV).** The `credential-field` rule is unchanged and
  still evaluated first: password and one-time-code fields are never filled.
- **Assistive pace (Principle V).** Unchanged — one interaction in flight at a time,
  every interaction (permitted or refused) appended to the audit log.

## Clarifications

### Session 2026-08-29

- Q: Does the `in-form` rule also gate the new `space` operation? → A: No. `in-form` applies to `click` only. `space` is gated solely by `submit-control`, `consent-toggle`, and `external-act-label`, so it may activate a non-submit control inside a form; submit buttons and consent toggles inside the form are still refused by their own rules.
- Q: May `fill` type filter text into a combobox's inner text input (react-select etc.)? → A: Yes, for filtering only. `fill` is permitted on the combobox's typed-text input (the `role="combobox"`/`role="textbox"` element that accepts text). `fill` stays refused on the `<select>` element itself, on the combobox container, and on file inputs. The option choice is still a `click`/`space` on the `role="option"`.
- Q: Does `fill` replace an existing field value or append to it? → A: Replace. `fill` clears the field, then sets the given value, so repeated calls are idempotent and combobox filtering starts clean each call.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fill a plain text field inside a form (Priority: P1)

An agent has read a form and its field map. It calls `interact` with `fill` on a required
text field — first name, email, a "LinkedIn profile URL" question. The value is entered into
the field. Nothing is submitted. The agent moves to the next field.

**Why this priority**: This is the core of the feature and the reason the issue was filed.
Without it every field of every form is typed by a human; with it the agent prepares a
complete draft the human reviews and submits.

**Independent Test**: On a Greenhouse application form, call `fill` on `#first_name`,
`#email`, and the LinkedIn-profile text question; confirm each returns a permitted result and
`read_page` (or a DOM read) shows the entered values, and that the page has not navigated or
submitted.

**Acceptance Scenarios**:

1. **Given** a text `<input>` inside a `<form>` that matches no rule other than the old
   `in-form` rule, **When** the agent calls `fill` on it, **Then** the operation is permitted
   and the field holds the value.
2. **Given** the same field, **When** the fill completes, **Then** no navigation or form
   submission occurs and the tab's URL is unchanged.
3. **Given** `fill` on an `<input type="email">`, `type="tel">`, `type="url">`,
   `type="search">`, `type="number">`, or a `<textarea>` inside a form, **When** called,
   **Then** the operation is permitted.
4. **Given** any permitted in-form fill, **When** it completes, **Then** the audit log has an
   entry recording the operation, selector, and permitted outcome.

---

### User Story 2 - Dangerous form targets are still refused (Priority: P1)

The agent (or a buggy caller) targets something inside a form that would perform or enable an
external act: a submit button, a "Sign in" link, an "I agree to the terms" checkbox, a
password field, a `<select>` or react-select combobox. Every one is refused with a named
rule, exactly as before.

**Why this priority**: The feature is only acceptable if narrowing `in-form` does not widen
the hole. Submit protection, consent protection, and credential protection must be provably
unchanged.

**Independent Test**: On the same form, call `fill` on `#resume` (file), the citizenship
`<select>`/combobox, and a password field on a login page; call `click` on the submit button
and on a consent checkbox. Confirm each is refused with the expected `ruleId`.

**Acceptance Scenarios**:

1. **Given** a `click` on a `button[type="submit"]` inside a form, **When** called, **Then**
   it is refused with rule `submit-control`.
2. **Given** a `fill` on an `<input type="password">` or `autocomplete="one-time-code"`
   field, **When** called, **Then** it is refused with rule `credential-field`.
3. **Given** a `fill` on an `<input type="file">`, a `<select>` element, or a combobox
   *container*, **When** called, **Then** it is refused (not a safe value target).
3a. **Given** a `fill` on the typed-text input of a react-select-style combobox (the
   `role="combobox"`/`role="textbox"` element that accepts text), **When** called with a
   filter string, **Then** it is permitted, the option list narrows, and nothing is
   submitted; choosing an option is a separate `click`/`space` on the `role="option"`.
4. **Given** a `click` or `fill` on a checkbox / switch whose label reads as consent
   ("I agree", "accept the terms", "subscribe"), **When** called, **Then** it is refused with
   rule `consent-toggle`.
5. **Given** a `click` or `fill` on a button or link whose accessible name matches
   outward-action wording ("apply", "submit", "send", "sign in"), **When** called, **Then**
   it is refused with rule `external-act-label`.

---

### User Story 3 - Space activates the focused element, under the click rules (Priority: P2)

The agent has typed a filter string into a combobox, or tabbed focus onto a plain checkbox,
and needs to commit that — a value fill alone doesn't. It calls `interact` with the new
`space` operation. The app treats it as activating `document.activeElement` and evaluates it
against `submit-control`, `consent-toggle`, and `external-act-label`: permitted for a benign
option/checkbox/non-submit control, refused for a submit button or consent toggle. The
`in-form` rule does **not** gate `space` (see Clarifications), so `space` may activate a
non-submit control that happens to sit inside a `<form>`.

**Why this priority**: Fills the remaining gap for widgets where typing a value isn't the
whole interaction, without adding an Enter key (which can trigger implicit form submission).
Lower priority than P1 because comboboxes can also be driven by clicking their option
elements; Space is the smaller, safer keyboard complement.

**Independent Test**: Focus a plain (non-consent) checkbox and call `space` — confirm it
toggles and is permitted. Focus a `button[type="submit"]` and call `space` — confirm it is
refused with `submit-control`. Call `space` with focus in a text field — confirm it inserts a
space character and is permitted.

**Acceptance Scenarios**:

1. **Given** focus on a plain checkbox with a non-consent label, **When** the agent calls
   `space`, **Then** the operation is permitted and the checkbox toggles.
2. **Given** focus on a `role="option"` element in an open listbox, **When** `space` is
   called, **Then** it is permitted and the option is chosen.
3. **Given** focus on a submit button or a consent toggle, **When** `space` is called,
   **Then** it is refused with the `submit-control` / `consent-toggle` / `external-act-label`
   `ruleId` a `click` on that element would produce.
3b. **Given** focus on a plain non-submit `<button>` inside a `<form>` whose label matches
   no rule, **When** `space` is called, **Then** it is permitted (the `in-form` rule does not
   apply to `space`), even though a `click` on the same button would be refused by `in-form`.
4. **Given** focus in a text input or textarea, **When** `space` is called, **Then** it is
   permitted and a single space character is inserted (no submission).
5. **Given** no element has focus (`document.activeElement` is the body), **When** `space` is
   called, **Then** the operation is refused with a clear "no focused target" reason.
6. **Given** any `space` call, **When** it resolves, **Then** the audit log records the
   operation, the resolved target's descriptor, and the permitted/refused outcome.

---

### Edge Cases

- **Field is inside a form *and* matches another rule** (e.g. a text input whose
  `placeholder` says "Search and apply"): the other rule wins — refused via
  `external-act-label`. Rule precedence is unchanged; `in-form` is simply no longer one of
  the rules that can fire on `fill`.
- **`contenteditable` element inside a form** (rich-text cover-letter box): treated as a safe
  value target for `fill` (it is a value input, not a control), unless another rule matches.
- **Combobox filter fill** (Country, Location, citizenship, CLEAR-ID — all react-select):
  `fill` on the combobox's typed-text input is permitted and only filters the option list;
  it never selects or submits. A stale filter string is overwritten, not appended (fill
  replaces — see below), so each filter call starts clean.
- **`fill` on a field that already has a value**: the field is cleared first, then set to the
  given value. Repeated `fill` calls on the same field are idempotent.
- **Single-input form that submits on `change`**: residual risk. `fill` sets the value and
  dispatches the events a real keystroke would; a page that submits on `input`/`change` could
  submit. Documented, not preventable from a selector. Not expected on multi-field
  application forms.
- **`space` when the focused element is inside a form but is a plain input**: permitted —
  inserts a space character; does not submit (Space has no implicit-submit behavior, unlike
  Enter).
- **`space` on a `<button>` with no `type`** (defaults to `submit` inside a form): refused
  via `submit-control`, same as `click`.
- **Focus moved by the page between the call and execution**: the app resolves
  `document.activeElement` at execution time and logs what it actually acted on.
- **Enter key**: explicitly **not** added by this feature. In a plain text input inside a
  form, Enter triggers the form's implicit submit even when focus is on a harmless field, so
  it cannot be gated by an activeElement check the way Space can. Combobox commit is handled
  by clicking option elements or by `space`. A scoped Enter may be revisited separately if
  e2e testing shows option interaction is unreliable.

## Requirements *(mandatory)*

### Functional Requirements

#### In-form fill (decision B)

- **FR-001**: The `in-form` safety rule MUST apply to `click` only. It MUST NOT refuse a
  `fill` operation.
- **FR-002**: The app MUST define a named, enumerable allowlist of safe fill input types:
  `text`, `email`, `tel`, `url`, `search`, `number`, `password`-excluded, plus `<textarea>`
  and `contenteditable` value elements. The allowlist MUST be inspectable the same way the
  blocklist rules are.
- **FR-003**: A `fill` MUST be permitted only when the target's effective input type is in
  the allowlist **and** no other blocklist rule (`submit-control`, `consent-toggle`,
  `credential-field`, `external-act-label`) matches it. If the type is not in the allowlist,
  the fill MUST be refused with a clear reason naming the disallowed type.
- **FR-004**: `fill` MUST remain refused for `<input type="file">`, the `<select>` element
  itself, `role="listbox"` elements, and a combobox *container* element. `fill` MUST be
  permitted on the typed-text input of a combobox (the `role="combobox"` / `role="textbox"`
  element that accepts text) for the purpose of filtering the option list; the app MUST NOT
  select an option as part of that fill. Choosing an option remains a `click`/`space` on the
  `role="option"`.
- **FR-005**: All existing blocklist rules MUST be evaluated before the type-allowlist check,
  so a form field that also matches a dangerous-wording or consent or credential rule is
  still refused with that rule's id.
- **FR-006**: A permitted in-form fill MUST NOT trigger navigation or form submission by the
  app itself; the app performs only the value entry and the input/change events a single
  field edit produces.
- **FR-017**: `fill` MUST replace the target's current value: the field is cleared, then the
  given value is set. Repeated `fill` calls on the same field MUST be idempotent (no
  accumulation), and a combobox filter fill MUST overwrite any previous filter string.

#### Space operation

- **FR-007**: `interact` MUST accept a new operation `space` alongside `click`, `fill`, and
  `scroll`. It takes a `tabId` and no selector.
- **FR-008**: `space` MUST resolve its target as `document.activeElement` in the target tab
  at execution time. If there is no focused element (activeElement is the document body or
  null), the operation MUST be refused with a "no focused target" reason.
- **FR-009**: The resolved target MUST be evaluated against `submit-control`,
  `consent-toggle`, `external-act-label`, and `credential-field`. On a match, `space` MUST be
  refused with that rule's id and description. The `in-form` rule MUST NOT be applied to
  `space` — `space` may activate a non-submit control inside a `<form>` (see Clarifications).
- **FR-010**: When the resolved target is a text input, textarea, or contenteditable, `space`
  MUST be permitted and MUST insert a single space character; it MUST NOT submit.
- **FR-011**: When permitted and the target is a control (option, checkbox, non-submit
  button), `space` MUST activate it exactly as a `click` would.
- **FR-012**: `space` MUST NOT be usable to bypass a `submit-control`, `consent-toggle`,
  `external-act-label`, or `credential-field` refusal — for those four rules, `space` and
  `click` MUST yield the same verdict and `ruleId` for the same target. `in-form` is the one
  intentional difference: it gates `click` but not `space`.

#### Audit and observability

- **FR-013**: Every `fill` and every `space` — permitted or refused — MUST append one entry
  to the interaction audit log, recording the operation, the target selector or resolved
  descriptor, the verdict, and the matched rule id when refused. (This extends the existing
  `interact` logging obligation to the new operation and the newly-permitted case.)
- **FR-014**: The refusal payload for a blocked `fill` or `space` MUST keep the existing
  shape: an error code, a human-readable message, `ruleId`, and `ruleDescription`.

#### Constitution amendment

- **FR-015**: `.specify/memory/constitution.md` Principle I MUST be amended with a clause
  stating that entering a value into a non-credential, non-consent form field is permitted
  preparation and is not an "external act"; submitting, sending, applying, connecting, and
  authenticating remain human-only. The amendment MUST be recorded in the constitution's
  own amendment/version history per its governance section.
- **FR-016**: The `interact` tool description MUST be updated to state that `fill` is allowed
  on plain value fields (and combobox filter inputs) inside a form, that `space` activates
  the focused element gated by the submit/consent/external-act/credential rules, and that
  submit/consent/credential targets and the Enter key remain unavailable.

### Out of Scope

- **Enter key** — see Edge Cases. Not added here; possibly a later scoped feature.
- **`<select>` and combobox option *selection*** — the choice itself is a `click`/`space` on
  the `role="option"`; the only new fill capability is typing a filter string into a
  combobox's text input (FR-004).
- **File upload** (`<input type="file">`) — no mechanism in `interact`; tracked separately.
- **Batch / multi-field fill** — each field is a separate `fill` call, as today.
- **Any change to submit, consent, or credential handling** — those rules are untouched
  except that they are now the *only* things (besides the type allowlist) gating an in-form
  fill.

### Key Entities

- **Safe fill type allowlist**: the enumerable set of input types / element kinds a `fill`
  may target. Consulted after the blocklist rules.
- **`space` operation**: an `interact` operation with no selector; its target is the tab's
  focused element, resolved at execution time.
- **Blocklist rule set**: unchanged in membership; `in-form` changes from `appliesTo: both`
  to `appliesTo: click`.
- **Audit log entry**: existing interaction record, now also emitted for permitted in-form
  fills and for every `space` call.
- **Constitution Principle I**: amended text plus a new entry in the amendment history.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a real multi-field application form, an agent can fill 100% of the plain
  text / email / tel / url / number / textarea fields with no manual typing and no
  submission occurring.
- **SC-002**: 100% of submit buttons, consent toggles, and credential fields on the same
  form remain refused, each with the same `ruleId` as before this change.
- **SC-003**: For the `submit-control`, `consent-toggle`, `external-act-label`, and
  `credential-field` rules, `click` and `space` return the identical permit/refuse verdict
  and `ruleId` for the same target; `in-form` is the sole rule that gates `click` but not
  `space`.
- **SC-004**: 100% of `fill` and `space` calls — permitted or refused — produce exactly one
  audit log entry with the operation, target, and verdict.
- **SC-005**: No `fill` or `space` call causes the app to navigate or submit a form; the
  tab's URL after a fill/space is the same as before it (barring page-driven navigation the
  app did not initiate).
- **SC-006**: The safe-fill type allowlist and the (unchanged) blocklist rules can both be
  listed programmatically, and every allowlist entry and the `in-form` precedence are covered
  by unit tests.
- **SC-007**: The constitution's Principle I and its amendment history both reflect the
  value-entry clause, and the `interact` tool description matches the new behavior.

## Assumptions

- The safe-type allowlist (`text`, `email`, `tel`, `url`, `search`, `number`, `textarea`,
  `contenteditable`) covers the fields agents realistically need to draft on job-application
  forms; more types can be added later without design change.
- `fill` dispatching the normal single-field input/change events is enough for React-style
  controlled inputs to register the value; forms that submit on `change` of a lone field are
  rare on multi-field application forms and are an accepted residual risk.
- Space has no implicit form-submission behavior in browsers (unlike Enter), so
  "Space = activate activeElement, gated by submit-control / consent-toggle /
  external-act-label / credential-field" is a complete and safe model — the `in-form` rule is
  not needed for `space` because Space cannot submit.
- The existing interaction audit log (`interaction-log.jsonl` in the app's `userData`
  directory) is the right place for the new entries; no new store is needed.
- Amending Principle I with a narrow value-entry clause is consistent with its existing text,
  which already lists `fill` among permitted actions and contemplates "preparing drafts."
- react-select / combobox fields will be operated by typing a filter string into the
  combobox text input (`fill`, FR-004) and then clicking or `space`-ing the `role="option"`;
  if e2e testing shows option interaction is unreliable, a scoped Enter is a separate
  follow-up, not part of this feature.
