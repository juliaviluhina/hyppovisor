# Feature Specification: Form-Fill Fidelity

**Feature Branch**: `011-form-fill-fidelity`

**Created**: 2026-08-31

**Status**: Draft

**Input**: User description: "issue 005 → feature 011. Second live Workable session, four
weeks after the one that produced feature 008. Same ATS, different markup, three problems
008 did not name: (P1) masked MM/YYYY date inputs silently no-op — `fill` returns
written:1 but the field stays empty; (P2) `external-act-label` refuses a plain required
textarea (`#CA_42882`, label 'Do you have startup experience?') on every fill after the
first; (P3) the fill/click verdict is evaluated against a stale / hydrating DOM, so a
field that filled once is refused on the next call with no page change. Also (P4) `in-form`
refuses non-submit `<button type=button>` 'Add Experience' / 'Add Education', so no
Experience row could be added by tooling at all, and (P5) the default `read_form_fields`
payload is still over the MCP token budget on a ~60-control form. Full detail in
specs/issues/005-form-fill-second-workable-session.md."

## Context

An agent connected over MCP can already open tabs, read a page (`read_page`), list a
page's form controls with a per-control fill / click / choose verdict
(`read_form_fields`), draft field values (`interact` `fill`, single and batch), pick a
dropdown option (`interact` `choose_option`), take a screenshot, and wait for elements. A
human performs every step that acts on the outside world.

A second live session filling a real third-party job-application form (Workable, ~60
controls) four weeks after the session behind feature 008 exposed a different class of
problem: not missing capability, but **the tool's report not matching what happened on the
page**. A `fill` reported success while the field stayed empty. A refusal fired on a field
whose own label is innocuous, and only on the second call. The same selector on the same
unchanged page returned "permitted" then "refused" then "permitted" again. Three required
fields were left for the human to type by hand, one of them because the tool refused a
legitimate draft.

This feature makes `fill` and the form-field verdict **faithful**: a success means the
value landed, a refusal names a rule that genuinely applies to *that* control, and the
verdict a caller sees is a function of the page as it is at call time. It adds nothing
that acts on the outside world. Two adjacent items ride along: letting the agent click a
non-submit in-form button to reveal a repeatable sub-form it then fills — a narrow
carve-out to `in-form` that needs a MINOR constitution amendment (see Clarifications) —
and trimming the default form-read payload so a large form's map fits in one response.

## Clarifications

### Session 2026-08-31

- Q: When `fill` targets a masked / formatted input that does not accept a programmatic
  value, should the tool (a) drive it with synthetic key events so the value lands, (b)
  only detect and report the no-op, or (c) attempt real key events and then verify by
  reading the value back, reporting a distinct non-success outcome if it still did not
  land? → A: **(c)** — attempt the write with real key events, then read the value back
  inside the same call; if it still did not land, return a distinct non-success outcome
  with `written: 0`. A caller must always be able to tell a lost write from a landed one.
- Q: `in-form` currently refuses every `click` inside a `<form>`, including a non-submit
  `<button type="button">` that only reveals a sub-form ("Add Experience" / "Add
  Education"). Permit a narrow carve-out, or keep the refusal and treat "Add row" as a
  human step? → A: **Permit the narrow carve-out (Option B / B1).** `click` on an in-form
  `<button>` is permitted when it is `type="button"`, declares no `formaction`, is not the
  form's implicit submit control, and its own accessible name matches none of the
  external-act-label patterns — **regardless of whether the form also contains a separate
  submit / save control**. Every submit control, `formaction` button, implicit submit, and
  outward-labelled button stays refused. Each permitted in-form click is written to the
  interaction-audit log. This touches Principle I and MUST land as a MINOR constitution
  amendment (a "revealing a repeatable sub-form via a non-submit in-form button is
  preparation" clause) before implementation.
- Q: For the oversized default form-read payload (P5), lower what each record carries by
  default, or make "required controls not yet filled" the implicit default projection
  when the caller gives none? → A: **Lower the default record** — move the rarely-read
  diagnostic flags behind the existing verbose / non-interactive opt-in; keep an unscoped
  read returning every control so existing callers are not surprised by a changed default
  scope.
- Q: In a batch `fill`, when one entry is written but a read-back shows it did not land (a
  masked-input no-op), what happens to the batch's other entries? → A: **Partial success,
  per-entry report.** Every other entry is still written and confirmed; the no-op entry
  reports the FR-003 non-success outcome. The batch response is a list of per-entry
  results, not one pass/fail. Atomicity stays on the pre-check stage (one blocklist
  refusal still refuses the whole batch with nothing written); it does not extend to
  mid-write page behaviour.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A `fill` success means the value landed (Priority: P1)

An agent drafts a value into a date field that shows a `MM/YYYY` mask. The tool reports
the draft succeeded. The field is still empty. The agent, trusting the report, moves on;
the human later finds the gap and types the date by hand. The agent needs `fill` to
either make the value land or tell it plainly that the write did not take — never report
success for a field that stayed empty.

**Why this priority**: A false success is worse than a refusal — the agent cannot
compensate for a failure it is not told about. In the captured session this silently
dropped two required date fields across the Education and Experience sub-forms, and the
same pattern hits any masked field (phone, currency, date, formatted IDs) on any form.

**Independent Test**: Point the agent at a page with a masked date or phone input. Draft a
well-formed value. Confirm that either the field now holds that value and the response
says so, or the response is a distinct non-success outcome with a zero-written count and a
reason — and in no case does the response report success while the field is empty.

**Acceptance Scenarios**:

1. **Given** a text-like control with an input mask or formatter, **When** the agent
   drafts a well-formed value, **Then** the value is entered by simulated typing and a
   read-back within the same call confirms it, and the response reports success with the
   final stored value.
2. **Given** a masked control that rejects the value even after simulated typing (the
   read-back shows it empty or unchanged), **When** the draft is attempted, **Then** the
   response is a distinct "the page did not accept this value" outcome with a zero-written
   count, not a success.
3. **Given** a plain unmasked text field, **When** the agent drafts a value, **Then**
   behavior is unchanged from today — the value is set and confirmed.
4. **Given** a batch draft where one target is a masked field that does not accept its
   value, **When** the batch runs, **Then** the masked field reports the non-success
   outcome for that entry while the other entries are reported independently, consistent
   with how the batch already reports per-entry results.
5. **Given** any `fill`, **When** it returns success, **Then** the response includes the
   field's value as read back after the write, so the caller can verify without a separate
   read.

---

### User Story 2 - A refusal names a rule that applies to *this* control (Priority: P1)

An agent drafts an answer into a required free-text question whose visible label is "Do
you have startup experience?". The first draft is accepted. Every later draft on the same
field is refused as an "outward action" — because the refusal rule is matching something
other than the field's own name (a nearby "Submit application" button, or the field's
internal `id`). The agent cannot revise the answer; the human pastes the correction in by
hand. The agent needs the external-act refusal to fire only when the *target control's own
accessible name or label* reads as an outward action.

**Why this priority**: A false refusal on a plain field blocks a legitimate draft
outright — the same severity as US1, from the other direction. It also erodes trust in
every refusal the agent sees. In the captured session it cost a required field its
corrected answer.

**Independent Test**: Build a form with a plain required text field labelled with
innocuous text, placed next to a "Submit application" button and given an `id` like
`CA_42882` or `submit_note`. Draft a value twice. Confirm both drafts are permitted, and
that a field whose *own* label is "Submit application" is still refused.

**Acceptance Scenarios**:

1. **Given** a plain text field whose own accessible name / associated label contains none
   of the outward-action words, sitting next to a submit button, **When** the agent drafts
   a value, **Then** the draft is permitted — on the first call and on every subsequent
   call.
2. **Given** the same field with an `id` or `name` attribute like `CA_42882` /
   `submit_note` / `apply_reason`, **When** the agent drafts a value, **Then** the draft
   is permitted — the attribute string is not treated as a label.
3. **Given** a control whose *own* visible label or accessible name reads as an outward
   act ("Submit application", "Send message", "I agree"), **When** the agent targets it
   for any operation, **Then** it is refused by the external-act rule, unchanged from
   today.
4. **Given** a field nested inside a container whose heading or a sibling button reads as
   an outward act, **When** the agent drafts a value into the field, **Then** the field's
   own label governs — the ancestor / sibling text does not cause a refusal.
5. **Given** the existing per-rule refusal test suite, **When** this change ships, **Then**
   a new case covering "innocuous field next to a submit button, with a `submit_`-style
   id" is added and passes, and no previously-refused outward control becomes permitted.

---

### User Story 3 - The verdict is stable across reads of an unchanged page (Priority: P2)

An agent reads a form's fields, drafts values, then re-reads the same fields to confirm.
The re-read reports one field's draft verdict as "refused" though the earlier read said
"permitted" and nothing on the page changed. A read a moment later says "permitted" again.
The agent cannot tell a real policy decision from a timing artifact. The agent needs the
fill / click / choose verdict for a control to be a function of the page's state at the
moment of the call — deterministic, and unchanged when the page is unchanged.

**Why this priority**: It undermines the whole point of `read_form_fields` as a planning
aid — an agent that cannot trust a verdict to hold plans defensively or re-reads in a
loop. It is a reliability defect rather than a hard blocker (a retry often clears it),
which places it below the two P1 stories.

**Independent Test**: On a settled form, read a field's verdict, draft a value into it,
read the verdict again with no navigation or DOM mutation between the calls, and confirm
the verdict is identical. Repeat immediately after page load, while late scripts are still
hydrating, and confirm the verdict does not flip between calls.

**Acceptance Scenarios**:

1. **Given** a form field with a "permitted" fill verdict, **When** the agent drafts a
   value into it and re-reads its verdict with no page change between the calls, **Then**
   the verdict is still "permitted".
2. **Given** a form still running late initialization scripts, **When** the agent reads a
   field's verdict twice in quick succession, **Then** both reads return the same verdict
   or the read waits for the page to settle before answering — it does not return a
   verdict computed against a half-built DOM.
3. **Given** a field whose verdict legitimately depends on page state (a control that
   genuinely becomes a submit trigger after a script runs), **When** the state actually
   changes, **Then** the verdict may change and the change corresponds to a real DOM
   difference the agent could also observe.
4. **Given** a `fill` that just succeeded on a field, **When** the agent immediately calls
   `fill` again on the same selector with the same page state, **Then** the second call is
   not refused by a rule that did not apply to the first.

---

### User Story 4 - Reveal a sub-form the agent needs to fill (Priority: P2)

A form has an "Add Experience" / "Add Education" button that opens an empty sub-form; the
sub-form's fields do not exist in the page until the button is clicked. The button is a
plain `<button type="button">` that submits nothing. Today every click inside a `<form>`
is refused, so the agent cannot create a single Experience row — it can only fill sections
a human already expanded. The agent needs a bounded way to reveal such a sub-form: a
`click` on an in-form button that is `type="button"`, declares no `formaction`, is not the
form's implicit submit control, and whose own label reads as no outward act — permitted
whether or not the form also holds a separate submit / save control.

**Why this priority**: In the captured session this meant zero Experience rows could be
added by tooling — a real capability gap. Permitting any in-form click touches Principle I,
so it ranks behind the fidelity fixes and depends on a MINOR constitution amendment
landing first (Clarifications, 2026-08-31). Everything the amendment blesses is still
preparation: no submit, no send, no Enter, and every genuinely terminal control stays
refused.

**Independent Test**: On a form with an "Add row" button that is `type="button"`, has no
submit or `formaction` behaviour, and whose label matches none of the outward-action
words, ask the agent to reveal the sub-form. Confirm the sub-form's fields appear, no
form submission occurred (URL unchanged, no navigation, no network submit), and an audit
entry recorded the click. Then confirm a `type="submit"` button, and a `type="button"`
labelled "Save and continue", are both still refused.

**Acceptance Scenarios**:

1. **Given** an in-form `<button type="button">` with no submit semantics and an
   innocuous label, **When** the agent clicks it to reveal a sub-form, **Then** the click
   is permitted, the sub-form's fields become readable, no submission occurred (URL
   unchanged, no navigation, no network submit), and an interaction-audit entry recorded
   the click.
2. **Given** an in-form button that is `type="submit"`, has `formaction`, or is the form's
   implicit submit control, **When** the agent targets it, **Then** it is refused,
   unchanged from today.
3. **Given** an in-form `type="button"` whose own label reads as an outward act ("Save",
   "Apply", "Send", "Continue"), **When** the agent targets it, **Then** it is refused by
   the external-act-label rule.
4. **Given** a form that contains *no* separate submit / save control, **When** the agent
   clicks a qualifying `type="button"` in it, **Then** the click is still permitted — the
   carve-out does not require a sibling submit control to exist (decision B1).
5. **Given** the carve-out ships without the constitution amendment merged, **When** a
   plan or PR proposes the code change, **Then** the review gate blocks it until the
   amendment lands.

---

### User Story 5 - A large form's default map fits in one response (Priority: P3)

An agent's first move on a new form is an unscoped `read_form_fields` to get the map. On a
~60-control form the response is large enough that the calling tool spills it to a file
and the agent falls back to ad-hoc parsing — the same friction feature 008's byte budget
was meant to remove, still happening on the default (unscoped, unfiltered) call. The agent
needs the default response for a large form to carry the information it actually plans
from, within the budget, without having to know to pass a projection.

**Why this priority**: 008 already shipped the projections and the byte budget that make
this fully recoverable (`only: "required-unfilled"`, `fields`, the 64 KB trim). This story
just lowers the *default* payload so the recovery is not needed on the common first call.
Lowest priority — pure ergonomics on top of a working mechanism.

**Independent Test**: On a 60-control form, issue an unscoped `read_form_fields` with no
projection and confirm the response is within the byte budget without trimming records,
that every control is still represented, and that the diagnostic flags removed from the
default record are still returned when the verbose / non-interactive option is set.

**Acceptance Scenarios**:

1. **Given** a form with ~60 controls, **When** the agent does an unscoped read with no
   projection, **Then** the response lists every interactive control and stays within the
   byte budget without trimming any record.
2. **Given** the same read, **When** the agent inspects a record, **Then** it still
   carries the label, the current value (credential values omitted), the required flag,
   the applicable operation, and the fill / click / choose verdict.
3. **Given** the agent needs the removed diagnostic flags (synthesised-selector,
   duplicate-id, options-truncated, and similar), **When** it repeats the read with the
   verbose / non-interactive option set, **Then** those flags are present.
4. **Given** an existing caller that already passes `fields` or `only`, **When** this
   change ships, **Then** that call's response is unchanged.

---

### Edge Cases

- **Masked field that accepts the value only after a delay** (the formatter runs
  asynchronously) — the read-back waits the same settle interval the rest of the read
  path uses before concluding the write was lost; a value that lands within that interval
  is reported as success.
- **Masked field where simulated typing lands a *partial* value** (the mask truncated it)
  — reported as the non-success outcome with the partial value shown, not as success.
- **`fill` read-back on a field whose value is a credential** — the read-back verifies
  non-emptiness / expected length only; the value itself is still omitted from the
  response, unchanged from today.
- **External-act-label check on a control with no accessible name at all** — falls back to
  the same signals it uses today (placeholder, nearby label element) but still scoped to
  the control's own labelling, never an ancestor heading or a sibling button.
- **A field legitimately labelled as an outward act that the agent nonetheless targets for
  a read** — `read_form_fields` still reports it with a "refused" verdict and a reason;
  only `fill` / `click` / `choose` are blocked, reads are not.
- **Verdict requested during a navigation** — the read waits for the target document to be
  ready, as it does today; "stable verdict" does not mean returning a verdict for a page
  that is mid-navigation.
- **In-form button carve-out (if permitted) on a button that reveals a sub-form *and* has
  a subtle submit side-effect via script** — the rule keys on declared semantics
  (`type`, `formaction`, implicit submit) and the label; a script-only side-effect it
  cannot see is an accepted residual risk, documented, and the audit entry is what makes
  it detectable (same posture as the permit-by-default blocklist today).
- **`read_form_fields` default-record change interacting with the 64 KB trim** — if a
  form is still over budget with the leaner records, the existing trim-and-flag behaviour
  applies unchanged.
- **Batch `fill` where one entry no-ops mid-write** — the entries before and after it are
  still written and confirmed; the batch response lists a per-entry outcome for every
  entry, and the caller can hand off exactly the entries that did not land. A batch that
  fails a *pre-check* (a blocklist refusal on any target) still writes nothing, unchanged.

## Requirements *(mandatory)*

### Functional Requirements

#### Faithful `fill` outcome for masked / formatted inputs (US1)

- **FR-001**: `fill` MUST attempt to enter a value into a text-like control by simulating
  real key events (the same event-dispatch machinery `choose_option` uses), so that
  client-side input masks and formatters that build their value from key events receive
  it.
- **FR-002**: After writing, and within the same call, `fill` MUST read the control's
  resulting value back and compare it to the intended value (allowing for
  formatter-applied punctuation and spacing).
- **FR-003**: When the read-back shows the value did not land (the field is empty or
  unchanged) or landed only partially, `fill` MUST return a distinct non-success outcome
  with a written count of zero and a reason, and MUST NOT report success.
- **FR-004**: When the read-back confirms the value, `fill` MUST report success and MUST
  include the value as read back (the final stored form, post-formatting) in the response.
- **FR-005**: In a batch `fill` where all entries pass the pre-check stage, each entry
  MUST be attempted and MUST report its own outcome (success with final value, or the
  FR-003 non-success outcome) independently — a mid-write no-op on one entry MUST NOT stop
  the others being written and MUST NOT be reported as a batch-wide success or a
  batch-wide failure. The existing pre-check atomicity is unchanged: a single blocklist
  refusal still refuses the whole batch with nothing written.
- **FR-006**: FR-001–FR-005 MUST NOT change behaviour for a plain unmasked field: the
  value is set, read back, and confirmed exactly as before, and the response shape for the
  already-working case stays backward compatible (the read-back value is additive).
- **FR-007**: The read-back MUST respect the existing credential-value omission — for a
  credential-adjacent field it verifies presence / length only and still does not return
  the value.

#### External-act refusal scoped to the control's own label (US2)

- **FR-008**: The external-act-label rule MUST match only against the target control's own
  accessible name — its associated `<label>`, `aria-label`, `aria-labelledby` target, or
  (absent those) its placeholder / title.
- **FR-009**: The external-act-label rule MUST NOT match against the text of an ancestor
  element, a sibling element, a nearby button, or a section heading.
- **FR-010**: The external-act-label rule MUST NOT pattern-match the control's `id`,
  `name`, or other attribute strings (`CA_42882`, `submit_note`, `apply_reason`) — these
  are not user-visible labels.
- **FR-011**: The rule's decision for a given control on a given DOM MUST be identical on
  every evaluation — the first `fill` and every subsequent `fill` on the same unchanged
  control return the same verdict.
- **FR-012**: The per-rule refusal test suite MUST gain a case for "a plain required field
  with an innocuous own-label, an `id` of `CA_…` / `submit_…`, sitting adjacent to a
  submit button" asserting `permitted`, and MUST continue to assert refusal for a control
  whose own label reads as an outward act. No control that is refused today may become
  permitted except the specific mislabel class this story fixes.

#### In-form non-submit button carve-out (US4)

> Decided 2026-08-31: permit the narrow carve-out, interpretation B1 (no sibling submit
> control required). Depends on a MINOR constitution amendment landing first (FR-016).

- **FR-013**: `click` on a `<button>` inside a `<form>` MUST be permitted when *all* hold:
  the button's `type` is explicitly `button` (not `submit`, not the form's implicit submit
  control); it declares no `formaction`; and its own accessible name matches none of the
  external-act-label patterns. This permission MUST NOT depend on whether the form also
  contains a separate submit / save control (interpretation B1).
- **FR-014**: Every other in-form click MUST remain refused exactly as today — any
  `type="submit"` control, any button with `formaction`, the implicit submit control, any
  control whose own label reads as an outward act, and any non-button element inside the
  form. No operation gains the Enter key.
- **FR-015**: A permitted in-form click MUST be recorded in the interaction-audit log with
  the same detail as any other permitted interaction, so a click that turns out to have a
  script-driven side effect is detectable after the fact. The `in-form` rule's
  documentation (safety document, `interact` contract) MUST describe the carve-out's four
  conditions and MUST state that the final Submit and file attachment remain human steps.
- **FR-016**: The carve-out MUST NOT be implemented until a constitution amendment adding
  a "revealing a repeatable sub-form via a non-submit in-form button is preparation"
  clause to Principle I is merged. The amendment is MINOR (a binding clarification that
  expands existing guidance, by the precedent of amendments 1.2.0 and 1.3.0). The feature
  plan MUST carry a Constitution Check citing Principle I, and the Amendment History entry
  MUST reference this feature and
  `specs/issues/005-form-fill-second-workable-session.md`.

#### Verdict evaluated at call time against a settled DOM (US3)

- **FR-017**: The fill / click / choose verdict `read_form_fields` reports for a control
  MUST be a pure function of that control and the surrounding DOM at the moment the call
  is served.
- **FR-018**: Before computing verdicts, a form read MUST wait for the target document to
  reach the same readiness state the rest of the read path already requires (no verdict
  computed against a document that is still parsing or mid-navigation).
- **FR-019**: Two form reads of the same selector with no navigation and no DOM mutation
  between them MUST return the same verdict for that control; a differing verdict is only
  permissible when a corresponding DOM change occurred.
- **FR-020**: A `fill` MUST NOT be refused by a rule whose inputs are unchanged since an
  immediately preceding `fill` on the same selector that was permitted.

#### Leaner default form-read payload (US5)

- **FR-021**: An unscoped `read_form_fields` with no projection MUST return every
  interactive control on a ~60-control form within the existing byte budget without
  trimming any record.
- **FR-022**: The default per-control record MUST retain: verbatim label, current value
  (credential values omitted), required flag, applicable operation, and the fill / click /
  choose verdict with its reason.
- **FR-023**: Diagnostic flags not needed for planning a fill (synthesised-selector,
  duplicate-id, options-truncated, and similar) MUST be moved out of the default record
  and returned only when the existing verbose / include-non-interactive option is set.
- **FR-024**: A read that already passes `fields` or `only` MUST be unaffected — same
  records, same fields, same shape as before this change.
- **FR-025**: When even the leaner records exceed the byte budget, the existing
  trim-and-flag behaviour applies unchanged.

#### Cross-cutting

- **FR-026**: Nothing in this feature adds an operation that acts on the outside world:
  `fill` still cannot submit, no Enter key is introduced, `read_form_fields` still writes
  no audit entry. The only new audit entries are the permitted in-form clicks from FR-013,
  which the constitution amendment (FR-016) classifies as preparation.
- **FR-027**: Any change to the tool contract wording (the `fill` non-success outcome, the
  read-back value in the response, the `in-form` decision) MUST be reflected consistently
  everywhere the behaviour is documented for the agent or the human — the tool contract
  document, the safety rules document, and the README's tool / "will not do" sections — or
  the existing consistency check fails.

### Key Entities *(include if feature involves data)*

- **`fill` result (extended)**: the existing per-call (and per-batch-entry) result, plus
  the value as read back after the write, and a distinct non-success variant carrying a
  zero written-count and a reason for "the page did not accept this value".
- **External-act-label decision**: for one control on one DOM, a deterministic
  permit/refuse derived solely from that control's own accessible name; carries the
  matched phrase when it refuses.
- **Form-field record (default vs. verbose)**: the same record 008 defines, split into a
  lean default projection (label, value, required, operation, verdict) and a verbose
  superset (adds the diagnostic flags), selected by the existing verbose /
  non-interactive option.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Re-running the captured Workable session, every masked date / phone field
  that `fill` reports as successful actually holds the value on a subsequent independent
  read — zero false successes.
- **SC-002**: For every masked field `fill` cannot populate, the agent receives the
  distinct non-success outcome on the same call and can hand that specific field to the
  human without a separate verification read.
- **SC-003**: The required free-text question that was refused on every call after the
  first (`#CA_42882`, innocuous own-label, adjacent submit button) is permitted on every
  call in the re-run.
- **SC-004**: Across the re-run, no plain non-credential, non-consent field whose own
  label is innocuous is refused by the external-act rule; every control whose own label
  reads as an outward act is still refused.
- **SC-005**: For any field on a settled form, ten consecutive verdict reads with no page
  change return the identical verdict — no flip between permitted and refused.
- **SC-006**: A `fill` immediately followed by a second `fill` on the same selector, same
  page state, is never refused by a rule that did not fire on the first call.
- **SC-007**: Every "Add row" button in the captured form is clickable, its sub-form
  becomes fillable, and no click causes a navigation or a form submission; every submit
  and every "Save" / "Apply" labelled button in the same form is still refused. This holds
  on a form with no separate submit control too (interpretation B1).
- **SC-008**: An unscoped, unprojected `read_form_fields` on the ~60-control captured form
  returns in one response within the byte budget with no record trimmed, and the calling
  tool does not spill it to a file.
- **SC-009**: The per-rule safety test suite covers the mislabel class (SC-003's control
  shape) and the in-form `type="button"` carve-out boundary (submit / formaction /
  implicit-submit / outward-label all still refused; sibling submit control not required),
  and passes.
- **SC-010**: The tool contract, safety document, and README describe the `fill`
  read-back / non-success outcome and the resolved `in-form` behaviour identically — the
  consistency check passes.

## Assumptions

- **Reuses existing machinery**: the simulated key-event path for FR-001 is the
  event-dispatch mechanism `choose_option` already uses; the read-back reuses the
  form-field value reader; the "settled DOM" wait in FR-018 is the readiness gate the read
  path already applies. No new widget-driving mechanism is introduced.
- **"Did not land" definition**: after simulated typing and the standard settle interval,
  a masked field counts as not-landed when its value is empty, unchanged from before the
  write, or a strict prefix of the intended value shorter than it (mask truncation).
  Formatter-inserted separators (`/`, `-`, spaces, parentheses) do not count as a
  mismatch.
- **External-act-label scope**: "the control's own accessible name" follows the standard
  accessible-name computation restricted to the element itself — associated `<label>`,
  `aria-label`, `aria-labelledby`, then `placeholder` / `title`. Ancestor and sibling text
  and all attribute strings are explicitly excluded.
- **Verdict determinism**: the verdicts are already intended to be pure; the fix is
  expected to be removing an evaluation that runs before the DOM settles and/or caching
  keyed on stale state, not redesigning the rule engine.
- **P5 is ergonomics on a working mechanism**: 008's byte budget, `fields`, and `only`
  projections stay exactly as shipped; only the composition of the *default* record
  changes, and only by moving flags behind the existing verbose opt-in.
- **Constitution — Principles I and IV**: FR-001–FR-012 and FR-017–FR-027 weaken neither.
  `fill` gains a more truthful outcome and a more precise refusal; nothing new acts
  outward; no credential value is exposed by the read-back. **FR-013–FR-016 (the in-form
  `type="button"` carve-out) DO touch Principle I.** Decided 2026-08-31 to adopt it
  (interpretation B1): the plan MUST carry a Constitution Check citing Principle I and the
  change MUST land as a constitution amendment (a new "revealing a repeatable sub-form via
  a non-submit in-form button is preparation" clause, versioned MINOR by the precedent of
  amendments 1.2.0 / 1.3.0), merged before the code change — not a normal PR.
- **Non-goals unchanged from issues 004 / 005**: file uploads stay refused; value drafting
  gains no address / place autocomplete suggestion-picking; reCAPTCHA and the final Submit
  remain human steps; the Enter key is introduced nowhere.

## Dependencies

- Builds on `interact` (`fill` single + batch, `choose_option`) and `read_form_fields`
  with its per-control verdict and byte budget / projections, all shipped in features
  003–008.
- Reuses the safety blocklist (`in-form`, `external-act-label`) and the shared
  target-descriptor / accessible-name logic that `choose_option` and `read_form_fields`
  share.
- The in-form-button user story (US4 / FR-013–FR-016) depends on a constitution amendment
  (Principle I) landing before its code change — see FR-016.
- Full background and per-finding rationale:
  `specs/issues/005-form-fill-second-workable-session.md` (and `004` for the carried-over
  non-goals).
