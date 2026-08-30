---
description: "Task list for feature 003 — Fill Form Fields and the Space Key"
---

# Tasks: Fill Form Fields and the Space Key

**Input**: Design documents from `specs/003-in-form-fill/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/interact-tool.md, quickstart.md

**Tests**: Included. Success Criterion SC-006 requires unit-test coverage of the allowlist
and the `in-form` precedence, and SC-004 requires audit-log assertions — so unit +
integration test tasks are part of every story.

**Organization**: Grouped by user story (US1, US2 = P1; US3 = P2). Each story is
independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different file, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3; Setup, Foundational, and Polish carry no story label

## Path Conventions

Single-project Electron layout (per plan.md):
`src/main/`, `src/shared/`, `tests/unit/`, `tests/integration/`, `tests/fixtures/`.

---

## Phase 1: Setup

**Purpose**: Confirm a clean baseline before touching the safety layer.

- [X] T001 Verify baseline: `npm run build`, `npm run lint`, and `npm run test` all pass on branch `003-in-form-fill`; record the current `tests/unit/blocklist.test.ts` and `tests/integration/interaction.spec.ts` pass counts in the PR description.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared type + rule-engine plumbing that US1, US2, and US3 all build on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Add `"space"` to the `InteractOperation` union and to `InteractResult.operation` in `src/shared/types.ts`; run `tsc -p tsconfig.json` and fix every resulting exhaustiveness error (expected: `src/main/page/interact.ts`, `src/main/mcp/tools.ts`, and any `switch (operation)` in `src/renderer/app.ts`).
- [X] T003 In `src/main/safety/blocklist.ts`, widen `BlocklistRule.appliesTo` to `"click" | "fill" | "space" | "activation" | "fill-or-space" | "both"` and update `matchBlocklist(d, op)` gating so: `"both"` matches any op (incl. `space`), `"activation"` matches `op ∈ {click, space}`, `"fill-or-space"` matches `op ∈ {fill, space}`, otherwise exact match. Do **not** change any rule's `appliesTo` value yet (US1/US3 do that). Keep `listBlocklistRules()` returning the `appliesTo` value verbatim.

**Checkpoint**: `interact` accepts `space` at the type level; the rule engine understands the
new reach keywords. No behavior change yet.

---

## Phase 3: User Story 1 — Fill a plain text field inside a form (Priority: P1) 🎯 MVP

**Goal**: `fill` succeeds on plain value fields inside a `<form>` (text/email/tel/url/
search/number/`<textarea>`/contenteditable), clearing then setting the value, with nothing
submitted and one audit entry per call.

**Independent Test**: Load the extended `form.html` fixture; `interact(fill, "#first_name",
"Iuliia")` and the email/tel/url/number/textarea fields all return `outcome: "permitted"`
and the DOM shows the values; a second `fill` on `#first_name` replaces (not appends); the
tab URL is unchanged and no `submit` event fired; `interaction-log.jsonl` has one
`permitted` line per call.

### Tests for User Story 1

- [X] T004 [P] [US1] Extend `tests/fixtures/form.html`: put `text`, `email`, `tel`, `url`, `number` inputs and a `<textarea>` (with stable `id`s) inside one `<form>`; add an inline listener that sets `window.__submitted = true` on the form's `submit` event.
- [X] T005 [P] [US1] Add unit tests in `tests/unit/blocklist.test.ts`: `listBlocklistRules()` reports `in-form` as `appliesTo: "click"`; `matchBlocklist(d, "fill")` never returns `ruleId: "in-form"` for a plain-text-in-form descriptor; `listSafeFillTypes()` returns exactly `text, email, tel, url, search, number` plus element kinds `textarea`, `contenteditable`; `isSafeFillTarget` accepts each allowed kind and rejects `date`/`color`/`range` with a reason.
- [X] T006 [P] [US1] Add integration tests in `tests/integration/interaction.spec.ts`: fill permitted on each plain field in `form.html`; value present in DOM; `window.__submitted` still undefined and tab URL unchanged after each; a repeated `fill` on the same field yields the replacement value, not a concatenation; each call appends exactly one `permitted` entry to the interaction log.

### Implementation for User Story 1

- [X] T007 [US1] In `src/main/safety/blocklist.ts`, change the `in-form` rule's `appliesTo` from `"both"` to `"click"` (FR-001). Leave its `matches` and `description` unchanged.
- [X] T008 [US1] In `src/main/safety/blocklist.ts`, add `export const SAFE_FILL_TYPES = ["text","email","tel","url","search","number"] as const`, `export function listSafeFillTypes()` (returns `{ types, elementKinds: ["textarea","contenteditable"] }`), and `export function isSafeFillTarget(d: TargetDescriptor): { ok: boolean; reason?: string }` per data-model.md §3 (textarea → ok; contenteditable → ok; `input` with effective type `d.type ?? "text"` in `SAFE_FILL_TYPES` → ok; `role ∈ {combobox,textbox}` on an `<input>`/contenteditable → ok; `input[type=file]`, `select`, `role="listbox"`, non-input container, checkbox/radio/hidden/button → deny with a `reason`).
- [X] T009 [US1] In `src/main/page/interact.ts` `fill` branch: after `matchBlocklist` passes, call `isSafeFillTarget(descriptor)`; on `!ok` throw a `HyppoError("REFUSED_EXTERNAL_ACT", …, { ruleId: "unsafe-fill-type", ruleDescription: reason })` and `log.record({ …, outcome: "refused", ruleId: "unsafe-fill-type" })` (FR-003, FR-014). On ok, change the in-page script to clear first then set: `el.focus(); el.value = ""; el.value = <value>; dispatch input+change` — for `contenteditable`, clear `textContent` then insert (FR-017, FR-006). Keep the existing single `permitted` `log.record` call.

**Checkpoint**: An agent can draft every plain field of a real multi-field form; no submit
path is opened. MVP is shippable here.

---

## Phase 4: User Story 2 — Dangerous form targets are still refused (Priority: P1)

**Goal**: Every submit control, consent toggle, credential field, file input, `<select>`,
and combobox *container* inside a form is still refused with its correct `ruleId`; only a
combobox's typed-text input newly accepts a `fill` (filter string only).

**Independent Test**: On the extended fixture, `click` on `button[type="submit"]` →
`submit-control`; `fill` on the file input, the `<select>`, and the combobox container →
`unsafe-fill-type`; `click` on the "I agree to the terms" checkbox → `consent-toggle`;
`fill` on a password field (login fixture) → `credential-field`; `fill` on the combobox's
inner `role="combobox"` `<input>` with `"Ger"` → permitted, option list narrows, nothing
submitted.

### Tests for User Story 2

- [X] T010 [P] [US2] Extend `tests/fixtures/form.html` further: add `<input type="file" id="resume">`, a `<select id="country">` with options, a react-select-style block (`<div role="combobox">` container wrapping `<input id="country-combobox-input" role="combobox">` and `role="option"` children), a consent `<label>I agree to the terms<input type="checkbox" id="agree"></label>`, and a `button[type="submit"]` — all inside the form. Reuse the existing password fixture (`tests/fixtures/*.html`) for the credential case or add `tests/fixtures/login.html` if none is suitable.
- [X] T011 [P] [US2] Add unit tests in `tests/unit/blocklist.test.ts`: for a `fill` descriptor that also matches `external-act-label` or `credential-field`, `matchBlocklist(d, "fill")` returns that rule's id (proving blocklist runs before the type allowlist, FR-005); `isSafeFillTarget` denies `file`, `select`, `listbox`, and a non-input combobox container, and accepts an `<input role="combobox">`.
- [X] T012 [P] [US2] Add integration tests in `tests/integration/interaction.spec.ts`: `click` submit → refused `submit-control`; `fill` file/select/combobox-container → refused `unsafe-fill-type`; `click` consent checkbox → refused `consent-toggle`; `fill` password → refused `credential-field`; `fill` combobox `<input>` with a filter string → permitted, `window.__submitted` still undefined; every refusal appends one `refused` line with the matching `ruleId` to the interaction log (FR-013, SC-002).

### Implementation for User Story 2

- [X] T013 [US2] Reconcile `isSafeFillTarget` in `src/main/safety/blocklist.ts` with the combobox distinction: a `role="combobox"`/`role="textbox"` element is `ok` only when `tagName === "input"` or `isContentEditable`; a `role="combobox"` on any other tag (the `<div>` container) is denied with `reason: "combobox container"`. Ensure the `fill` path in `src/main/page/interact.ts` never triggers option selection — it only sets the input value and dispatches `input`/`change` (FR-004).

**Checkpoint**: Narrowing `in-form` provably did not widen the hole — submit, consent, and
credential protection are unchanged; the only new fill surface is the combobox filter input.

---

## Phase 5: User Story 3 — Space activates the focused element, under the click rules (Priority: P2)

**Goal**: A new `interact` operation `space` acts on `document.activeElement`, evaluated
against `submit-control`, `consent-toggle`, `external-act-label`, and `credential-field`
(never `in-form`); permitted for benign option/checkbox/non-submit controls and text
insertion, refused for submit/consent/credential targets with the same `ruleId` a `click`
would give.

**Independent Test**: Focus a plain checkbox → `space` permitted, toggles; focus
`button[type="submit"]` → `space` refused `submit-control`; focus a plain
`<button type="button">` inside the form → `space` permitted (a `click` on it is refused by
`in-form`); focus a text input → `space` inserts one space, no submit; blur everything →
`space` refused with "no focused target" and `ruleId: null`; every call logs once.

### Tests for User Story 3

- [X] T014 [P] [US3] Extend `tests/fixtures/form.html`: add `<button type="button" id="add-another">Add another</button>` inside the form and ensure the checkbox / option / text inputs are programmatically focusable from the test helper.
- [X] T015 [P] [US3] Add unit tests in `tests/unit/blocklist.test.ts`: for descriptors matching `submit-control`, `consent-toggle`, `external-act-label`, `credential-field`, `matchBlocklist(d, "space")` and `matchBlocklist(d, "click")` return the identical `blocked`/`ruleId` (SC-003); for a plain-`<button>`-in-form descriptor, `matchBlocklist(d, "click")` returns `in-form` but `matchBlocklist(d, "space")` returns `{ blocked: false }`.
- [X] T016 [P] [US3] Add integration tests in `tests/integration/interaction.spec.ts`: `space` on a focused plain checkbox → permitted + toggled; on `button[type="submit"]` → refused `submit-control`; on the in-form `#add-another` button → permitted; on a focused text input → permitted, value gains exactly one `" "`, `window.__submitted` undefined; with `document.activeElement === body` → refused, reason mentions "no focused target", `ruleId: null`; on a focused `role="option"` → permitted; each call appends one interaction-log line carrying the resolved target descriptor (FR-013, SC-004).

### Implementation for User Story 3

- [X] T017 [US3] In `src/main/safety/blocklist.ts`, set `submit-control` and `consent-toggle` to `appliesTo: "activation"` and `credential-field` to `appliesTo: "fill-or-space"`; leave `external-act-label` at `"both"` and `in-form` at `"click"` (FR-009, FR-012). Add `export function activeElementDescriptorScript(): string` that runs the same name-assembly / descriptor logic as `targetDescriptorScript` but against `document.activeElement` (return `null` when it is `null`, `<body>`, or `<html>`).
- [X] T018 [US3] In `src/main/page/interact.ts`, add a `space` branch before the `selector` check: evaluate `activeElementDescriptorScript()`; if `null` → `log.record({ …, operation: "space", target: null, outcome: "refused", ruleId: null })` and throw `HyppoError("TARGET_NOT_FOUND"|"REFUSED_EXTERNAL_ACT", "No focused target for space.")` (FR-008). Otherwise `matchBlocklist(descriptor, "space")`; on `blocked` → refuse with the existing payload shape + log `refused` (FR-009, FR-014). On permitted: if the target is text input / textarea / contenteditable, dispatch a space-character insertion (`beforeinput`/`input` with `" "`, or `execCommand("insertText", false, " ")`), else dispatch `keydown`+`keyup` `key: " "` and fall back to `.click()` for elements that do not natively activate (FR-010, FR-011); then one `permitted` `log.record`. Use the resolved descriptor summary (e.g. `tagName#id`) as the logged `target`.
- [X] T019 [US3] In `src/main/mcp/tools.ts`, add `"space"` to the `operation` zod enum (`["click","fill","scroll","space"]`) and make `selector`/`value` optional for it (already optional). Update the `interact` tool description string to state that `fill` works on plain value fields and combobox filter inputs inside a form, and that `space` activates the focused element gated by the submit/consent/external-act/credential rules while submit/consent/credential targets and the Enter key remain unavailable (FR-016).

**Checkpoint**: All three stories independently functional; the keyboard gap for
option/checkbox commit is closed without an Enter key.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T020 Amend `.specify/memory/constitution.md` Principle I with the value-entry clause (entering a value into a non-credential, non-consent form field is permitted preparation, not an external act; submit/send/apply/connect/authenticate remain human-only); add an Amendment History entry dated 2026-08-29 with a one-line MINOR rationale; bump the footer `**Version**` `1.1.1 → 1.2.0` and set `**Last Amended**: 2026-08-29` (FR-015).
- [X] T021 [P] Update `README.md` "What the app will not do" / interaction section so it matches the shipped behavior (in-form `fill` on plain value + combobox filter inputs is allowed; `space` operation and its gating; Enter and submit/consent/credential still refused). Confirm no `.specify/templates/*` file references the `in-form` rule by name.
- [X] T022 Run the `specs/003-in-form-fill/quickstart.md` validation §1–§5 end to end and record results; run §6 e2e (`npm run test:e2e`) against a real Greenhouse form if network access is available, otherwise note it as manual follow-up.
- [X] T023 Final gate: `npm run build`, `npm run lint`, `npm run test` all clean; diff the interaction-log format to confirm no page text leaked into any new entry (Principle V).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: no dependencies.
- **Foundational (T002–T003)**: depends on Setup. **Blocks all user stories.**
- **US1 (T004–T009)**: depends on Foundational. Delivers the MVP.
- **US2 (T010–T013)**: depends on Foundational; shares `blocklist.ts` / `interact.ts` /
  fixtures / test files with US1, so run US1 → US2 sequentially (not in parallel) unless
  worked on the same branch with careful mer-ordering.
- **US3 (T014–T019)**: depends on Foundational (T002–T003 especially). Independent of US1/US2
  in behavior, but touches the same three source files — sequence after US2.
- **Polish (T020–T023)**: depends on US1–US3 complete. T020 (constitution) has no code
  dependency and may be done earlier if desired.

### Key task-level dependencies

- T009 depends on T007 + T008 (same file `blocklist.ts` for T007/T008 — do T007 then T008).
- T013 depends on T008.
- T017 depends on T003; T018 depends on T002 + T017; T019 depends on T002.
- T006 depends on T004 + T009; T012 depends on T010 + T013; T016 depends on T014 + T018.

### Parallel opportunities

- T002 and T004 are different files → parallelizable, but T004 is only useful once US1
  starts.
- Within US1: T004 / T005 / T006 are all `[P]` (fixture, unit test file, integration test
  file — three different files). Implementation T007→T008 are the same file (serial); T009
  is a different file, after T008.
- Within US2: T010 / T011 / T012 `[P]`; T013 after T008.
- Within US3: T014 / T015 / T016 `[P]`; T017→T018 same-ish path (serial); T019 different
  file.
- T021 `[P]` with T022 (docs vs. run).

## Parallel Example: User Story 1

```bash
# Different files, no ordering between them:
Task: "T004 Extend tests/fixtures/form.html with plain fields + submit listener"
Task: "T005 Add allowlist / in-form unit tests in tests/unit/blocklist.test.ts"
Task: "T006 Add fill integration tests in tests/integration/interaction.spec.ts"
# Then implement:
Task: "T007 in-form appliesTo -> click in src/main/safety/blocklist.ts"
Task: "T008 SAFE_FILL_TYPES + isSafeFillTarget in src/main/safety/blocklist.ts"  # after T007
Task: "T009 fill gate + clear-then-set in src/main/page/interact.ts"             # after T008
```

## Implementation Strategy

### MVP (US1 only)

T001 → T002–T003 → T004–T009 → validate the US1 Independent Test → the agent can draft a
full form. Ship or demo.

### Incremental delivery

1. Setup + Foundational → engine ready.
2. US1 → agent drafts plain fields → **MVP**.
3. US2 → prove the safety envelope is intact + combobox filter fill.
4. US3 → Space key for option/checkbox commit.
5. Polish → constitution amendment, README, quickstart, final gate.

## Notes

- `[P]` = different file, no incomplete dependency.
- Tests here are required by SC-004 / SC-006, not optional; write them to fail first.
- The refusal payload shape (`code`, `message`, `ruleId`, `ruleDescription`) must not change.
- `credential-field` byte-for-byte unchanged except its `appliesTo` widening in T017.
- Commit after each task or logical group; keep `blocklist.ts` edits ordered (T007 → T008 →
  T013 → T017) to avoid churn.
