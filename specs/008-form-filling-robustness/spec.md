# Feature Specification: Form-Filling Robustness

**Feature Branch**: `plan-008-form-filling-robustness`

**Created**: 2026-08-30

**Status**: Draft

**Input**: User description: "Form-filling robustness for the MCP tools. Captured from a live
session driving a real Workable job-application form (60 controls: text fields, a
geo-autocomplete address widget, a resume file input, radio groups, and 7 react-select-style
custom comboboxes). Five improvements: P1 read_form_fields projection + byte budget; P2
enumerate a lazy custom combobox's options; P3 combobox selector hygiene; P4 INVALID_SELECTOR
error code; P5 screenshot tool. Non-goals: file uploads, place-autocomplete choreography.
Full detail in specs/issues/004-form-filling-robustness.md."

## Context

An agent connected over MCP can already open tabs, read a page's text, list a page's form
controls (`read_form_fields`), draft field values (`interact` `fill`, single and batch),
pick a dropdown option (`interact` `choose_option`), and wait for elements. A human performs
every step that acts on the outside world.

A live session filling a real third-party job-application form (Workable, 60 controls)
exposed five friction points that make the difference between "the agent drafts the whole
form for a quick human review + submit" and "the agent hands over a value map the human
re-types by hand". This feature closes those five gaps. It adds no capability that acts on
the outside world: the two new read paths (option enumeration, screenshot) are retrieval
only, matching `read_page`.

## Clarifications

### Session 2026-08-30

- Q: Default size budgets for a form-field read response and a screenshot? → A: Form-field
  read trims to **64 KB**; screenshot defaults to **256 KB**. Both are per-request
  overridable lower bounds, not hard maxima the caller cannot change.
- Q: When a scoped read explicitly names a hidden value-mirror or plain-button selector in
  its `fields` list, is that record returned? → A: Yes — an explicit selector in `fields`
  overrides the default non-interactive exclusion; a scoped read that does not name it still
  omits non-interactive elements.
- Q: Which selector inputs raise the distinct invalid-selector error? → A: Every selector
  input across the tool surface — interactions, option enumeration, and a form read's
  container selector and `fields` entries.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Discover a custom dropdown's choices (Priority: P1)

An agent filling a form reaches a custom dropdown (a scripted combobox whose choices are not
present until the menu is opened). Today `read_form_fields` reports that control with "no
options available", and the option-selection step needs an exact choice label, so the agent
cannot proceed without guessing. The agent needs a way to ask "what are this control's
choices?" and get the list back — without selecting anything and without the form treating
it as a change.

**Why this priority**: Without it, any form using scripted dropdowns (the dominant pattern
on Greenhouse, Workable, Lever, and similar) cannot be completed by the agent at all — it is
a hard blocker, not an efficiency loss. In the captured session, 7 of the form's required
controls were in this state and the agent had to guess every one.

**Independent Test**: Point the agent at a page with a scripted dropdown whose options
render only on open. Ask for the control's choices. Verify the full list of visible choice
labels (and their disabled state) comes back, the control's displayed value is unchanged
afterward, the menu is left closed, and no interaction-audit entry was written.

**Acceptance Scenarios**:

1. **Given** a tab with a scripted dropdown that has no choices in the page until opened,
   **When** the agent requests that control's option list, **Then** the response contains
   every choice's visible label and whether it is selectable, the control still shows its
   original value, and the audit log has no new entry.
2. **Given** a plain native dropdown, **When** the agent requests its option list, **Then**
   the same shape is returned directly from the choices already present.
3. **Given** a control that is not a dropdown, **When** the agent requests its option list,
   **Then** the request is refused with a clear "not a dropdown" reason and nothing on the
   page changes.
4. **Given** a dropdown whose menu never populates within the wait window, **When** the
   agent requests its option list, **Then** an empty list is returned with a flag saying the
   options did not appear, and the menu is left closed.
5. **Given** a dropdown that is a submit / consent / credential-adjacent control by the
   existing safety rules, **When** the agent requests its option list, **Then** it is
   refused by the same rule that would refuse selecting an option there.

---

### User Story 2 - Read only the form fields that matter, within a size budget (Priority: P1)

An agent working a large form needs to (a) get an initial map of the controls and (b)
re-check a handful of fields after drafting values into them. Today every call returns every
control with full metadata and no size ceiling, so a real form's response is large enough
that the surrounding tooling spills it to a temporary file and the agent falls back to
ad-hoc text parsing. The agent needs to scope a read to specific controls, to skip
non-interactive noise by default, and to receive a response that is bounded in size with an
explicit "was trimmed" signal.

**Why this priority**: In the captured session this happened on 5 separate reads and turned
every form inspection into a shell-parsing detour. It compounds every other story — each
re-check after a fill pays the full cost again.

**Independent Test**: On a form with many controls, request a normal read and confirm the
response stays under the size budget and carries a trimmed-or-not flag. Then request a read
scoped to three named controls and confirm only those three come back. Then confirm a read
excludes non-interactive elements (plain buttons, hidden value-mirror inputs) unless they
are explicitly asked for.

**Acceptance Scenarios**:

1. **Given** a form with more controls than fit the size budget, **When** the agent does a
   normal read, **Then** the response is within the budget and a flag indicates content was
   trimmed.
2. **Given** the agent has just drafted values into three fields, **When** it reads with
   those three controls named, **Then** the response contains records for exactly those
   three and nothing else.
3. **Given** a form containing plain buttons and hidden value-mirror inputs, **When** the
   agent does a normal read, **Then** those elements are absent from the response; **When**
   it repeats the read asking for non-interactive elements too, **Then** they are included.
4. **Given** a text field with a client-side input constraint (a length limit or an accepted
   character pattern), **When** the agent reads that field, **Then** the constraint is
   reported so the agent can format its value to fit.
5. **Given** the agent asks for "required fields not yet filled", **When** it reads, **Then**
   the response contains only required controls whose current value is empty.

---

### User Story 3 - One unambiguous selector and operation per control (Priority: P2)

When a form uses scripted dropdowns, a single logical field often appears as two elements: a
hidden element that carries the value for submission and the visible widget the user
actually operates. Today a read lists both, and the "cleanest" selector it suggests points
at the hidden element — which the option-selection step then rejects as "not a dropdown".
The agent needs each control to come back with the selector that actually works for the
operation that control supports, plus a per-control hint of which operation applies.

**Why this priority**: It cost the captured session one failed call plus a retry to
discover the working selector for each scripted dropdown. It is friction and wasted calls,
not a hard blocker (the agent can eventually find the right selector), so it ranks below the
two P1 stories.

**Independent Test**: On a form with a scripted dropdown backed by a hidden value element,
do a read and confirm exactly one record represents that field, its suggested selector is
the one the option-selection step accepts, and the record states that "choose an option" is
the applicable operation. Confirm the hidden backing element is available only when
non-interactive elements are explicitly requested.

**Acceptance Scenarios**:

1. **Given** a scripted dropdown backed by a hidden same-named value element, **When** the
   agent reads the form, **Then** one record represents that field and its selector is
   accepted by the option-selection step on the first try.
2. **Given** the same form, **When** the agent reads it normally, **Then** the hidden
   backing element is not a separate record; **When** it reads asking for non-interactive
   elements, **or** names the backing element's selector explicitly in a scoped read,
   **Then** the backing element appears, marked as non-interactive.
3. **Given** any control in a read, **When** the agent inspects its record, **Then** the
   record indicates whether drafting a value, activating it, or choosing an option is the
   operation that control supports.

---

### User Story 4 - See the current state of the page (Priority: P2)

An agent cannot always tell from text alone whether a scripted widget is in the state it
expects: is the address suggestion list open, which dropdown is expanded, did a validation
message appear under a field, did the résumé attachment register. Today the only way to
probe is a full document dump, which is large and still does not show rendered state. The
agent needs to request a picture of the tab (optionally just one element's area), bounded in
size.

**Why this priority**: It removes a whole class of blind guessing and the large document
dumps used to work around it, and it is broadly useful beyond form filling. It is an
efficiency and reliability gain rather than an unblock, so it sits with the other P2 story.

**Independent Test**: Open a tab, request a picture of it, and confirm an image comes back
with its dimensions and whether it was scaled down to meet the size limit. Request a picture
scoped to one element and confirm the image is limited to that element's area. Confirm no
file is written to disk and no interaction-audit entry is added.

**Acceptance Scenarios**:

1. **Given** a loaded tab, **When** the agent requests a picture, **Then** an image is
   returned along with its pixel dimensions and a scale factor, and the response respects a
   size limit.
2. **Given** the agent names a single element, **When** it requests a picture, **Then** the
   image covers that element's on-screen area only.
3. **Given** the agent sets a smaller size limit, **When** it requests a picture, **Then**
   the image is scaled and/or compressed to fit and the response reports the scale applied.
4. **Given** a picture request, **When** it completes, **Then** nothing is written to the
   app's data directories and the interaction-audit log is unchanged.
5. **Given** a tab where the person is signed in, **When** a picture is taken, **Then**
   masked credential fields remain masked in the image (the picture shows only what is
   already rendered).

---

### User Story 5 - Actionable feedback for an unusable selector (Priority: P3)

Agents sometimes supply a selector in a non-CSS dialect (for example a text-matching
pseudo-selector from another automation tool). Today the tool reports this the same way it
reports "element not found", so the agent concludes the element is missing and goes off
chasing guessed navigations. The agent needs a distinct signal that the *selector syntax*
was the problem, with a pointer to how to get a valid one.

**Why this priority**: One-off per session and fully recoverable, but it sent the captured
session down a multi-call detour (two guessed page navigations, both dead ends). Cheap to
fix; lowest priority because impact per occurrence is small.

**Independent Test**: Issue an interaction and an option-list request with a text-matching
pseudo-selector. Confirm both return a dedicated "invalid selector" error, distinct from
"target not found", whose message names the unsupported forms and tells the agent to obtain
a concrete selector from a form read or page read.

**Acceptance Scenarios**:

1. **Given** an interaction request whose selector is not valid CSS, **When** it is
   evaluated, **Then** the error is a dedicated "invalid selector" code, not "target not
   found", and the message explains that only CSS selectors are supported and how to get
   one.
2. **Given** an option-list request with the same kind of selector, **When** it is
   evaluated, **Then** it returns the same dedicated error.
3. **Given** a form-field read whose container selector or a scoped `fields` entry is not
   valid CSS, **When** it is evaluated, **Then** it returns the same dedicated error.
4. **Given** a syntactically valid CSS selector that matches nothing, **When** it is
   evaluated, **Then** the error is still "target not found" (unchanged behavior).

---

### Edge Cases

- **Scoped read names a selector that matches nothing** — that entry is absent from the
  response; the call still succeeds with whatever else matched. A scoped read that matches
  nothing at all returns an empty record list, not an error. (A scoped selector that is not
  valid CSS is the invalid-selector error, not an empty result — see FR-018.)
- **Scoped read names a non-interactive element** (a plain button, a hidden value-mirror) —
  that record IS returned, because naming it explicitly overrides the default exclusion
  (FR-010). A non-scoped read, or a scoped read that does not name it, still omits it unless
  non-interactive elements are requested.
- **Scoped read names a selector that matches more than one element** — each match is
  returned (the caller asked for that selector); the records carry the same disambiguation
  flags a normal read would.
- **Option enumeration on a dropdown with hundreds of choices** — the list is capped by the
  same option cap the form read already uses, with the same per-response "trimmed" flag.
- **Option enumeration is invoked while the same widget is already open from a prior step**
  — it must still return the list and must not leave the widget in a worse state than it
  found it.
- **Screenshot of a named element that is scrolled out of view or has zero size** — reported
  as a clear error; no partial or blank image is returned as if it succeeded.
- **Screenshot of a tab that is still loading** — captures whatever is currently rendered;
  the response does not block indefinitely waiting for load.
- **Screenshot size limit set so low that even a maximally compressed image cannot meet it**
  — the response returns the smallest image it can produce and flags that the limit could
  not be met, rather than failing outright.
- **A form read within the size budget after excluding non-interactive noise, but still over
  budget from interactive controls alone** — trimmed to fit with the flag set, same as the
  existing control-count cap.
- **`inputmode` / length / pattern reported for a field that has none** — the field's record
  simply omits those hints; their absence is not an error.

## Requirements *(mandatory)*

### Functional Requirements

#### Option enumeration (US1)

- **FR-001**: The system MUST provide a read-only way to retrieve a dropdown control's list
  of selectable choices, identified by a selector, returning each choice's visible label,
  its underlying value, and whether it is disabled.
- **FR-002**: Option enumeration MUST work for a native dropdown by reading choices already
  present, and for a scripted dropdown by opening its menu, reading the choices that appear,
  and closing the menu again.
- **FR-003**: Option enumeration MUST NOT change the control's selected value and MUST leave
  the dropdown menu closed when it returns.
- **FR-004**: Option enumeration MUST NOT write an interaction-audit entry and MUST NOT
  write page content to any app data directory — it is a retrieval operation, consistent
  with reading a page.
- **FR-005**: Option enumeration MUST be refused, by the same safety rules and with the same
  reasons as selecting an option on that target, when the target is a submit control, a
  consent toggle, a credential-adjacent control, or otherwise carries an external-act label.
- **FR-006**: Option enumeration MUST return a distinct "target is not a dropdown" outcome
  when the selector resolves to a non-dropdown element, leaving the page unchanged.
- **FR-007**: When a scripted dropdown's menu does not populate within the system's wait
  window, option enumeration MUST return an empty list with an explicit "options did not
  appear" indicator, and MUST still leave the menu closed.
- **FR-008**: The returned choice list MUST be bounded by the same option cap the form-field
  read uses, with an explicit indicator when the list was trimmed.

#### Scoped, bounded form reads (US2)

- **FR-009**: The form-field read MUST accept an optional list of selectors and, when given,
  MUST return records only for controls matching those selectors, in document order.
- **FR-010**: The form-field read MUST, by default, exclude non-interactive elements — plain
  buttons and hidden elements that only mirror another control's value. It MUST include them
  when the caller asks for non-interactive elements, and MUST also include any non-interactive
  element whose selector the caller names explicitly in the scoped `fields` list (an explicit
  selector overrides the default exclusion).
- **FR-011**: The form-field read response MUST be bounded by a size budget defaulting to
  **64 KB** (caller-lowerable per request) and MUST carry a single flag indicating whether
  any content (records or option lists) was trimmed to fit.
- **FR-012**: The form-field read MUST report, for a text-like control, any client-side
  input constraints it declares — at minimum a maximum length and an accepted-character
  pattern or input mode — when present.
- **FR-013**: The form-field read MUST accept an optional filter for "required controls whose
  current value is empty" and, when set, MUST return only those.
- **FR-014**: All existing form-field read behavior not covered above — document order,
  verbatim labels, per-control fill and click verdicts, credential-value omission, the
  container-selector scoping behavior, no audit entry — MUST be preserved unchanged. (The
  sole change to the container selector is that a malformed one now returns the
  invalid-selector error per FR-018 instead of a generic failure.)

#### Selector and operation hygiene (US3)

- **FR-015**: When a scripted dropdown carries its submission value in a separate hidden
  element, the form-field read MUST represent that field as a single interactive record
  whose selector is the one accepted by the option-selection step.
- **FR-016**: The hidden value-mirror element MUST NOT appear as its own record in a default
  read, and MUST appear — marked non-interactive — only when non-interactive elements are
  requested.
- **FR-017**: Every control record in a form-field read MUST indicate which operation
  applies to it: drafting a value, activating it, or choosing an option.

#### Invalid-selector feedback (US5)

- **FR-018**: When any selector supplied to a tool is not valid CSS, the system MUST return
  a dedicated "invalid selector" error that is distinct from "target not found". This applies
  across the whole tool surface: interaction targets, option enumeration, and a form read's
  container selector and its scoped `fields` entries.
- **FR-019**: The invalid-selector error message MUST state that only CSS selectors are
  supported, name the common unsupported forms (text-matching pseudo-selectors and
  tool-specific combinators), and direct the agent to obtain a concrete selector from a form
  read or a page read.
- **FR-020**: A syntactically valid selector that matches no element MUST continue to
  return "target not found", unchanged.

#### Page screenshot (US4)

- **FR-021**: The system MUST provide a tool that returns a picture of a named tab as an
  image, together with the image's pixel dimensions and the scale factor applied.
- **FR-022**: The screenshot tool MUST accept an optional element selector and, when given,
  MUST limit the image to that element's on-screen area.
- **FR-023**: The screenshot tool MUST accept an optional maximum response size, defaulting
  to **256 KB** (caller-lowerable per request), and MUST scale down and/or increase
  compression until the image fits, reporting the scale applied; when the limit cannot be
  met even at maximum compression, it MUST return the smallest image it can and flag that
  the limit was not met.
- **FR-024**: The screenshot tool MUST default to capturing the visible area of the tab (not
  the full scrollable page) and MUST offer a full-page option.
- **FR-025**: The screenshot tool MUST NOT write any file to the app's data directories and
  MUST NOT add an interaction-audit entry.
- **FR-026**: A screenshot request for an element that is not renderable (zero size, fully
  off-screen) MUST return a clear error rather than a blank or partial image presented as
  success.
- **FR-027**: The tool set exposed to agents MUST be updated consistently everywhere it is
  enumerated or described for the human — the canonical tool-name list, the copyable
  connection-panel description, the tool contract document, and the README tool table — so
  the screenshot tool appears in all of them or none.
- **FR-028**: The tool contract MUST carry a privacy note: a screenshot shows whatever is
  currently rendered, including a signed-in identity or a partly-drafted value, and this is
  not a new disclosure class because page text is already retrievable; credential fields
  render masked and remain masked in the image.

#### Non-goals (documented, not built)

- **FR-029**: The system MUST continue to refuse drafting a value into a file-upload control.
  The README's "what the app will not do" section MUST state that attaching files is not
  supported and is a human step, and the file-upload control MUST remain visibly refused in
  a form read so the agent hands it off.
- **FR-030**: The value-drafting operation MUST NOT gain any suggestion-picking behavior for
  address / place autocompletes; it types the literal text and stops. The operation's
  documentation MUST state that choosing among autocomplete suggestions is a human step.

### Key Entities *(include if feature involves data)*

- **Option list**: the choices of one dropdown control at one moment — an ordered set of
  `{ visible label, underlying value, disabled }` plus a "trimmed" flag and, for scripted
  dropdowns, an "options did not appear" flag. Not persisted; returned once per request.
- **Form-field record (extended)**: the existing per-control record from a form read, plus:
  which operation applies (draft value / activate / choose option); declared input
  constraints for text-like controls (max length, character pattern or input mode); and an
  "interactive" marker used to filter hidden value-mirror elements and plain buttons.
- **Screenshot result**: an image of a tab or one element at one moment, plus its pixel
  dimensions, the scale factor applied, and a "size limit not met" flag. Not persisted;
  returned once per request.
- **Invalid-selector error**: a distinct error outcome carrying a fixed explanatory message,
  raised before any page lookup when a selector is not valid CSS.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An agent can complete every non-file, non-autocomplete field of a
  representative 60-control third-party application form — including all scripted dropdowns —
  using only these tools, with no blind guessing of dropdown choices and no manual
  selector discovery.
- **SC-002**: For that same form, the number of tool calls the agent needs to inspect and
  fill it drops by at least half compared with the captured baseline session (which needed
  roughly 20 calls, including 5 oversized reads and several wasted retries).
- **SC-003**: No form-field read or option-enumeration response in that walkthrough exceeds
  the size budget or has to be spilled to a file by the calling tool; every response that
  was trimmed says so.
- **SC-004**: A single scoped re-read of the fields just drafted returns only those fields
  and confirms their values in one call.
- **SC-005**: Every scripted dropdown in the form is selectable on the first attempt using
  the selector the form read suggests — zero "not a dropdown" refusals caused by a
  wrong-element selector.
- **SC-006**: An agent given a non-CSS selector receives the invalid-selector error and
  recovers on its next call, with no intervening guessed navigations.
- **SC-007**: A screenshot of a typical form view returns in a single response under the
  default size limit and is sufficient to answer "is this widget open / did this field
  error" without any document dump.
- **SC-008**: The option-enumeration and screenshot operations add zero entries to the
  interaction-audit log and write zero bytes to the app's data directories, verified over
  the full walkthrough.
- **SC-009**: The safety blocklist refuses option enumeration on exactly the targets it
  refuses option selection on — no more, no less — verified control-by-control on a form
  containing submit, consent, and credential-adjacent controls.
- **SC-010**: The screenshot tool is present in all four agent-facing enumerations (canonical
  list, panel description, contract, README) or the consistency check fails.

## Assumptions

- **Reuses existing machinery**: option enumeration reuses the open / observe / gather / close
  mechanism the option-selection step already performs; it does not introduce a new way of
  driving scripted widgets. The screenshot uses the runtime's built-in page-capture.
- **Wait window**: the time option enumeration waits for a scripted menu to populate is the
  same configurable wait the option-selection step already uses; no new tunable is assumed
  necessary, though the plan may add one.
- **Size budgets**: the form-read size budget defaults to **64 KB** and the screenshot
  default size limit to **256 KB** (both configurable, both caller-lowerable per request —
  see Clarifications). Screenshots default to a compressed raster format for size.
- **"Unfilled" definition**: for the "required and empty" filter, a control counts as filled
  when its current value is a non-empty string, a checked state, or a chosen option; an
  untouched scripted dropdown showing placeholder text counts as empty.
- **Non-interactive exclusion**: "non-interactive" for default exclusion means plain buttons
  and elements that only mirror another control's submission value; genuine inputs, dropdowns,
  checkboxes, radios, and editable regions are always included.
- **Selector-syntax detection**: "not valid CSS" is detected from the page runtime rejecting
  the selector, before any element lookup; the feature does not attempt to parse or translate
  foreign selector dialects.
- **Screenshots are per-viewer, not stored**: like a page read, the returned image is the
  only copy; the app keeps nothing.
- **Constitution**: none of Principles I–V is weakened. Option enumeration and screenshot are
  retrieval only — no external act, no persistence, no audit entry — and screenshot is a new
  retrieval surface alongside the existing page read. The plan's Constitution Check states
  this explicitly and lists the screenshot output as retrieved-not-stored content.
- **No change to what acts on the outside world**: file uploads stay refused; value drafting
  gains no autocomplete-selection behavior; nothing here presses Enter, submits, or sends.

## Dependencies

- Builds on the shipped `read_form_fields`, `interact` (`fill` / `choose_option`), and the
  connection panel's copyable tool description (feature 007).
- Reuses the safety blocklist rules and the shared target-descriptor logic that
  `choose_option` and `read_form_fields` already share.
- Full background and the per-point rationale: `specs/issues/004-form-filling-robustness.md`.
