---
description: "Task list for feature 011 — Form-Fill Fidelity"
---

# Tasks: Form-Fill Fidelity

**Input**: Design documents from `specs/011-form-fill-fidelity/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/mcp-tools-011-delta.md](./contracts/mcp-tools-011-delta.md),
[quickstart.md](./quickstart.md)

**Tests**: included — the spec requires per-rule blocklist coverage (FR-012, FR-019 lineage)
and every SC is phrased as a verifiable check. Write each test task first and see it fail
before the matching implementation task.

**Organization**: by user story (spec priority order). US1 is the MVP. US2 → US3 have a
one-way code dependency (noted). US4 is gated on a constitution amendment (T019).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different file, no dependency on an incomplete task — may run in parallel
- Paths are repo-relative; single-project layout (`src/`, `tests/`, `docs/`)

---

## Phase 1: Setup

- [X] T001 Confirm branch `011-form-fill-fidelity`, run `npm ci`, then `npm run build && npm run lint && npm test && npm run test:e2e` and record the baseline result in this file (note any pre-existing `connection-panel.spec.ts` port-collision failures so they are not attributed to this feature)

---

## Phase 2: Foundational (shared primitives)

**Purpose**: two low-risk additions the story code references. Both are inert until used.

- [X] T002 [P] Add `"WRITE_NOT_APPLIED"` to the `ErrorCode` union and `currentValue?: string` to `ErrorDetails` (with a doc comment: "set only for WRITE_NOT_APPLIED") in `src/main/errors.ts`
- [X] T003 [P] Add `domReadyTimeoutMs` (default `1000`) to the config object and its schema/parse path in `src/main/config.ts`

**Checkpoint**: `npm run build` still green. User stories can begin.

---

## Phase 3: User Story 1 — A `fill` success means the value landed (Priority: P1) 🎯 MVP

**Goal**: `fill` types with real key events so input masks receive the value, then reads the
value back and reports the truth — success with the final `currentValue`, or
`WRITE_NOT_APPLIED` with `currentValue`. Never a bare success on an empty field.

**Independent Test**: `fill` a masked `MM/YYYY` field with a well-formed value → the field
holds it and the response says so; `fill` a format the mask rejects → `WRITE_NOT_APPLIED`
with the read-back value on the same call; a plain field is unchanged in behaviour.

### Tests for User Story 1

- [X] T004 [P] [US1] Fixture `tests/fixtures/masked.html`: an `MM/YYYY` text input whose JS mask rebuilds `.value` from `keydown`/`beforeinput` and discards a bulk programmatic `.value` set; a `(###) ###-####` phone mask with the same behaviour
- [X] T005 [US1] Unit `tests/unit/interact.test.ts`: the read-back comparator — `"091992"` vs `"09/1992"` → match; `""` → not applied; `"09/19"` vs `"09/1992"` → truncated; case/reorder change → not applied; and the per-character fill-script shape emits `keydown`/`beforeinput`/`input`/`keyup` per character
- [X] T006 [US1] Integration `tests/integration/interaction.spec.ts`: on `masked.html`, `fill` `MM/YYYY` with `09/1992` → response `currentValue` is `09/1992` and an independent `read_form_fields` shows the same (SC-001); `fill` with a mask-rejected format → `WRITE_NOT_APPLIED` carrying `currentValue` on the same call, interaction-log entry `outcome:"error"` (SC-002)
- [X] T007 [US1] Integration `tests/integration/batch-fill.spec.ts`: a 4-entry batch where entry 2 targets the masked field with a bad format → entry 2 `outcome:"error"`, entries 1/3/4 `written` and confirmed by read-back; a pre-check refusal on any target still `BATCH_REJECTED` with nothing written (unchanged)

### Implementation for User Story 1

- [X] T008 [US1] Add `FillResult { currentValue?: string }` to `src/shared/types.ts`; export from the page-interact module surface
- [X] T009 [US1] In `src/main/page/interact.ts` `fillScript`: replace the single native-setter write with a per-character loop for non-`contentEditable` text controls — per char dispatch `keydown`, `beforeinput` (`inputType:"insertText"`, `data:ch`), advance value via the native setter, dispatch `input`, then `keyup`; keep the `contentEditable` branch, the final `change`+`blur`, and the combobox/textbox blur-skip
- [X] T010 [US1] In `src/main/page/interact.ts`: after the fill script runs, evaluate an in-page read-back (`el.value` / `el.innerText`) and apply the R2 comparator (strip `/ - . space ( ) :` from both sides; empty | unchanged | proper-short-prefix → not applied)
- [X] T011 [US1] In `src/main/page/interact.ts` single-`fill` path: on a landed write, resolve `{ currentValue }` (post-format string); on a lost write, `throw new HyppoError("WRITE_NOT_APPLIED", <message with typed value + read-back>, { currentValue })` and record the interaction-log entry as `outcome:"error"` (not `refused`, not `permitted`); for a `credential-field` target verify non-empty / expected length only and omit `currentValue` (FR-007)
- [X] T012 [US1] In `src/main/page/interact.ts` `fillBatch`: wrap each per-entry write so a thrown `WRITE_NOT_APPLIED` becomes that entry's `error` outcome with the reason, and the remaining entries still run (existing mid-write continue behaviour); no change to pre-check atomicity
- [X] T013 [US1] In `src/main/mcp/tools.ts`: surface `currentValue` in the single-`fill` success payload; ensure `WRITE_NOT_APPLIED` flows through `HyppoError.toResult()` with `currentValue`; update the `interact` tool description text for the read-back / masked-input behaviour
- [X] T014 [US1] Update `specs/001-open-any-url/contracts/mcp-tools.md`, `docs/safety.md`, and the README tool table with the `fill` read-back + `WRITE_NOT_APPLIED` semantics; keep wording identical across the three so the consistency guard passes

**Checkpoint**: US1 fully functional — masked fields fill or fail honestly; MVP demoable.

---

## Phase 4: User Story 2 — A refusal names a rule that applies to *this* control (Priority: P1)

**Goal**: the `external-act-label` rule matches only the target control's own accessible
name, not its drafted content. A plain field whose own label is innocuous is permitted on
every call, before and after a value containing a common word is drafted into it.

**Independent Test**: `fill` a `<textarea>` (innocuous own label) with text containing
"apply", then `fill` it again with revised text → both permitted; a control whose own
`<label>` reads "Submit application" is still refused.

### Tests for User Story 2

- [X] T015 [US2] Fixture: add to `tests/fixtures/form.html` a `<textarea id="startup_q">` with an empty initial value and an associated `<label>` of innocuous text, placed next to a `<button type="submit">`; give it `id`/`name` in the `CA_…` / `submit_…` shape
- [X] T016 [US2] Unit `tests/unit/blocklist.test.ts`: the descriptor `name` for a `<textarea>` / `contentEditable` / text `<input>` excludes `el.innerText` / `el.value` / the `textContent` fallback; the `name` for a `<button>` and `<input type=submit|button|reset|image>` still includes `value` / text; `external-act-label` verdict is identical for `startup_q` before and after a drafted value containing "apply" / "join"; the `id`/`name` attribute string is never matched (locks FR-010)
- [X] T017 [US2] Integration `tests/integration/interaction.spec.ts`: on `form.html`, `fill` `#startup_q` with a draft containing "apply", read `fillVerdict` → `permitted`, `fill` again with revised text → `permitted` (SC-003, SC-004); a `<textarea>` whose own `<label>` is "Submit application" → `fill` refused `external-act-label`

### Implementation for User Story 2

- [X] T018 [US2] In `src/main/safety/blocklist.ts` `DESCRIPTOR_BODY`: keep `ACCESSIBLE_NAME_SOURCES_BODY` always folded into `name`; gate the own-content parts (`el.innerText`, `el.value`, the `el.textContent` fallback) so they are added only when the element is **not** value-bearing — i.e. not `<textarea>`, not `isContentEditable`, and not an `<input>` whose type is in `SAFE_FILL_TYPES` or is a bare/absent text type; `<button>` and submit-type inputs keep the current behaviour
- [X] T019 [US2] Confirm `fillVerdictFor` / `clickVerdictFor` / `chooseVerdictFor` bodies are unchanged and pure, and that both `targetDescriptorScript` (interact) and `descriptorFor` (`src/main/page/form-fields.ts`) consume the updated `DESCRIPTOR_BODY` — add/extend a unit assertion that a filled field yields the same `fillVerdict` from `read_form_fields` and from the `interact` pre-check (feature-005 SC-004 parity)

**Checkpoint**: US2 done — no plain field is refused because of what was typed into it.

---

## Phase 5: User Story 3 — The verdict is stable across reads of an unchanged page (Priority: P2)

**Goal**: a control's fill/click/choose verdict is a function of the DOM at call time.
Two reads of the same selector with no page change return the same verdict, including
immediately after page load.

**Depends on**: US2 (T018) — the descriptor decoupling is the primary fix; this phase adds
the readiness gate on top.

**Independent Test**: read a field's `fillVerdict` 10× with nothing else done → identical
every time; `fill` then immediately `fill` again → the second call is not refused.

### Tests for User Story 3

- [X] T020 [US3] Unit `tests/unit/form-fields.test.ts`: the collection path awaits `document.readyState === "complete"`, bounded by `config.domReadyTimeoutMs`, then proceeds even on timeout; verdicts are computed only after the wait resolves
- [X] T021 [US3] Integration `tests/integration/interaction.spec.ts`: on `form.html`, `read_form_fields` scoped to one field 10× with no navigation/mutation → identical `fillVerdict` each time (SC-005); `fill` a field then immediately `fill` the same selector again → second call not refused by a rule that did not fire first (SC-006); a fixture control that a script converts into a submit trigger after load → verdict may change, and only then (US3 scenario 3)

### Implementation for User Story 3

- [X] T022 [US3] In `src/main/page/form-fields.ts` `readFormFields`: before `executeJavaScript(formFieldsScript(...))`, run a bounded in-page poll for `document.readyState === "complete"` (resolve on ready or after `config.domReadyTimeoutMs`, then continue); leave `src/main/page/read.ts` (`read_page`) untouched
- [X] T023 [US3] Add a regression comment in `form-fields.ts` linking the determinism guarantee to the US2 descriptor change and this gate; extend `tests/unit/form-fields.test.ts` with a "same descriptor in → same verdict out" assertion

**Checkpoint**: US3 done — the planning read is trustworthy.

---

## Phase 6: User Story 4 — Reveal a sub-form the agent needs to fill (Priority: P2)

**Goal**: `click` on an in-form `<button type="button">` with no `formaction`, not the
implicit submit, and no outward-act own label is permitted; every terminal control stays
refused. B1: no sibling submit control is required.

**⚠️ GATED**: T024 (constitution amendment) MUST merge before any code task in this phase.
Also touches `src/main/safety/blocklist.ts` `DESCRIPTOR_BODY` — sequence after US2's T018.

### Governance

- [X] T024 [US4] Constitution amendment **1.4.0** in `.specify/memory/constitution.md`: append the in-form-reveal clause to Principle I (wording from [research.md](./research.md) R7); bump `**Version**: 1.3.2` → `1.4.0` and `Last Amended`; add a one/two-line Amendment History entry citing feature `011` and `specs/issues/005-form-fill-second-workable-session.md`; update the "Allowed — preparation / Refused — outward act" table row for in-form `click` in `docs/design-notes.md`. **Its own commit, first in this phase.**

### Tests for User Story 4

- [X] T025 [P] [US4] Fixture `tests/fixtures/expander.html`: an `<button type="button">Add Experience</button>` **inside a `<form>`** that reveals a hidden `<fieldset>` of text inputs; a sibling `<button type="submit">` in the same form; a second `<form>` on the page with the same reveal button and **no** submit control
- [X] T026 [US4] Unit `tests/unit/blocklist.test.ts`: the narrowed `in-form` rule — `<button type="button">` no `formaction` inside a form → not blocked; `<button type="submit">`, `<button type="button" formaction="…">`, `<button type="button">` whose own label is "Save"/"Apply"/"Continue", and a non-`<button>` clickable inside a form → still blocked; the `type="button"` permit holds whether or not the form has a submit control (B1)
- [X] T027 [US4] Integration `tests/integration/interaction.spec.ts`: on `expander.html`, `click` the in-form `type="button"` → permitted, the hidden `<fieldset>` becomes readable via `read_form_fields`, URL unchanged, an interaction-log `permitted` entry exists (SC-007); `click` the sibling `<button type="submit">` → `REFUSED_EXTERNAL_ACT` / `submit-control`; the no-submit form variant → the `type="button"` click still permitted

### Implementation for User Story 4

- [X] T028 [US4] Add `formAction: string | null` to `TargetDescriptor` in `src/shared/types.ts`; in `src/main/safety/blocklist.ts` `DESCRIPTOR_BODY` set it from `el.getAttribute("formaction")` (lowercased, `null` when absent)
- [X] T029 [US4] In `src/main/safety/blocklist.ts`: change the `in-form` rule `matches` to `d.hasFormAncestor && !(d.tagName === "button" && d.type === "button" && d.formAction === null)`; update its `description` string to name the carve-out
- [X] T030 [US4] Update `specs/001-open-any-url/contracts/mcp-tools.md` and `docs/safety.md` with the in-form carve-out and its four conditions; state that the final Submit, file attachment, and Enter remain out of scope

**Checkpoint**: US4 done — repeatable sub-forms are reachable; the amendment is on record.

---

## Phase 7: User Story 5 — A large form's default map fits in one response (Priority: P3)

**Goal**: an unscoped `read_form_fields` on a ~60-control form returns every control within
the 64 KB budget with no record trimmed; the dropped diagnostic fields return under
`includeNonInteractive`.

**Touches** `src/main/page/form-fields.ts` — sequence after US3's T022.

### Tests for User Story 5

- [X] T031 [P] [US5] Fixture: ensure a ~60-control form exists for the budget test — extend `tests/fixtures/form.html` (or add `tests/fixtures/big-form.html`) with a mix of text inputs, selects, radios, and a required-empty block
- [X] T032 [US5] Unit `tests/unit/form-fields.test.ts`: the default record omits `selectorSynthesised` / `duplicateId` / `optionsTruncated` / `optionsAvailable` and omits `options` for non-dropdown kinds; a dropdown record keeps `options` in the default; `includeNonInteractive: true` restores all four fields and the empty `options` arrays
- [X] T033 [US5] Integration `tests/integration/read-form-fields.spec.ts`: an unscoped, unprojected read of the ~60-control fixture returns within the 64 KB budget with `truncated` false and every control represented (SC-008); the same read with `includeNonInteractive` carries the diagnostic superset; a `fields` / `only` read still returns its scoped records

### Implementation for User Story 5

- [X] T034 [US5] In `src/shared/types.ts`: make `selectorSynthesised`, `duplicateId`, `optionsTruncated`, `optionsAvailable` optional on `FormFieldRecord`
- [X] T035 [US5] In `src/main/page/form-fields.ts`: emit those four fields only when `includeNonInteractive`; emit `options` in the default record only for dropdown kinds (`select` / `combobox` / `listbox`); apply the lean record to `fields` / `only` reads too; when `includeNonInteractive` is set, restore the full record exactly as today
- [X] T036 [US5] Update the `read_form_fields` tool description in `src/main/mcp/tools.ts` and `specs/001-open-any-url/contracts/mcp-tools.md` with the default-vs-verbose record split and the second effect of `includeNonInteractive`

**Checkpoint**: US5 done — the first read of a big form is one clean response.

---

## Phase 8: Polish & Cross-Cutting

- [X] T037 [P] Review `docs/design-notes.md` "Why these eight MCP tools" / test-layering sections for any wording the deltas make stale; update in place
- [X] T038 [P] Confirm the About-text / `connection-snippets` consistency guard passes with every doc edit (contract, safety, README, design-notes) — SC-010
- [X] T039 Run `npm run build && npm run lint && npm test && npm run test:e2e`; record pass/fail counts and any known-unrelated failures in this file
- [ ] T040 Manual acceptance per [quickstart.md](./quickstart.md) against the live A2Z Sync Workable form (memory `feature-011-test-form`); capture SC-001…SC-010 evidence and paste it under a "Verification" heading here, noting live-markup drift vs. the fixture suite as the deterministic proof

---

## Dependencies & Execution Order

### Phase order

- **Phase 1 Setup** → **Phase 2 Foundational** → **Phases 3–7 stories** → **Phase 8 Polish**
- Foundational (T002, T003) blocks nothing hard but should land before the story code that
  references the new code / config.

### Story dependencies

- **US1 (P1)** — independent. The MVP. No dependency on US2–US5.
- **US2 (P1)** — independent of US1. Edits `blocklist.ts` `DESCRIPTOR_BODY`.
- **US3 (P2)** — **depends on US2 (T018)**: the descriptor decoupling is the primary
  determinism fix; T022 adds the readiness gate on top. Do US2 first.
- **US4 (P2)** — **depends on T024 (amendment)** for its code tasks, and on **US2 (T018)**
  because T028 edits the same `DESCRIPTOR_BODY`. Otherwise independent.
- **US5 (P3)** — independent of US1/US2/US4. Shares `form-fields.ts` with US3 (T022) —
  sequence US5 impl after US3 impl.

### Same-file sequences (no [P] across these)

- `src/main/safety/blocklist.ts`: T018 (US2) → T028, T029 (US4)
- `src/main/page/form-fields.ts`: T022 (US3) → T035 (US5); T019/T023/T032 read-only or test
- `src/main/page/interact.ts`: T009 → T010 → T011 → T012 (US1, strictly sequential)
- `src/shared/types.ts`: T008 (US1), T028 (US4), T034 (US5) — different interfaces, but
  same file: apply sequentially, no [P]
- `tests/integration/interaction.spec.ts`: T006 (US1), T017 (US2), T021 (US3), T027 (US4)
- `tests/unit/blocklist.test.ts`: T016 (US2) → T026 (US4)
- `tests/fixtures/form.html`: T015 (US2), T031 (US5)

### Parallel opportunities

- T002 ‖ T003 (Foundational)
- Within US1: T004 (fixture) ‖ start of T005 (unit) once T002 lands
- US2, US4-governance (T024), US5 fixture/unit work can proceed in parallel with US1
- Across stories, once US2's T018 has merged: US3 and US5 implementation can run in
  parallel (different files after the sequence note), US4 code after T024

---

## Implementation Strategy

### MVP (US1 only)

1. Phase 1 Setup + Phase 2 Foundational.
2. Phase 3 US1 — masked fields fill with real key events; `WRITE_NOT_APPLIED` on a lost
   write; `currentValue` in every `fill` response.
3. **Stop and validate**: `masked.html` integration green; manual check on one real masked
   field. Ship as the fidelity MVP.

### Incremental delivery

1. MVP (US1) → demo.
2. US2 → the `#CA_42882`-class false refusal is gone → demo.
3. US3 → verdicts stop flickering → demo.
4. US4 (after amendment 1.4.0 merges) → "Add Experience" rows are reachable → demo.
5. US5 → the first big-form read is one clean response → demo.

### Commit discipline

- One commit per task or tight logical group; trailers per repo convention.
- T024 (the amendment) is its own commit and must precede T028–T030 in history.

---

## Verification (2026-08-31)

Automated — all green on branch `011-form-fill-fidelity`:

- `npm run build` — clean (tsc main + renderer + copy-assets).
- `npm run lint` — clean.
- `npm test` (vitest) — **201 passed** (was 173 at baseline; +28 for feature 011:
  `interact.test.ts` read-back comparator + fill-script shape, `blocklist.test.ts` in-form
  carve-out boundary + descriptor `name` guard, `form-fields.test.ts` `domReadyScript` +
  lean record + verdict purity).
- `npm run test:e2e` (playwright) — **106 passed, 0 failed** (was 88 + 4 flaky
  port-collision at feature-010 baseline; no HyppoVisor instance held :7357 this run).
  New coverage: `interaction.spec.ts` US1 masked fill / `WRITE_NOT_APPLIED` / US2 drafted
  "apply" re-fill / US3 verdict stability / US4 reveal-button carve-out;
  `batch-fill.spec.ts` per-entry masked no-op; `read-form-fields.spec.ts` US5 lean record.

Constitution amendment **1.4.0** (Principle I — in-form reveal-button clause) landed as
T024 before the `in-form` rule change.

Adjustment recorded during implementation: US5 keeps `selectorSynthesised` / `duplicateId`
in the default record (small, workflow-critical); only the options triplet is dropped from
non-dropdown records. See research.md R6, data-model.md.

- [X] T040 Manual acceptance against the live A2Z Sync Workable form (memory
  `feature-011-test-form`), 2026-09-01 — all three issue-005 blockers cleared on the exact
  form:
  - **US1**: `[name="start_date"]` / `[name="end_date"]` (masked `MM/YYYY`, `inputMode:tel`)
    filled to `03/2021` / `08/2024` and a re-read confirmed them; issue 005 had `written:1`
    with the field empty. Every `fill` returned `currentValue`. Batch fills 5/5 then 3/3
    written, 0 errored.
  - **US2/US3**: `#CA_42882` ("Do you have startup experience?") filled with text containing
    "startup"/"applied"/"apply", then re-filled with a revised answer — `permitted` both
    times; `read_form_fields` reports `fillVerdict: permitted` on every read. Issue 005 hit
    `REFUSED_EXTERNAL_ACT` / `external-act-label` on every call after the first.
  - **US4**: "Add Experience" / "Add Education" (`<button type="button">`) report
    `clickVerdict: permitted`; clicking "Add Experience" revealed the sub-form and its
    fields became fillable. "Submit application" and the "Clear …" links stay `refused`.
  Nothing was submitted. Live markup has drifted since issue 005 (start/end dates are now
  "(Optional)"); the fixture suite is the deterministic SC-001…SC-010 proof.
