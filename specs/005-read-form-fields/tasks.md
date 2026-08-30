---

description: "Task list for feature 005 — Structured Form-Field Reader"
---

# Tasks: Structured Form-Field Reader

**Input**: Design documents from `/specs/005-read-form-fields/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/read-form-fields.md, quickstart.md

**Tests**: Included — the plan and quickstart call for a unit suite (`tests/unit/form-fields.test.ts`) and an integration suite (`tests/integration/read-form-fields.spec.ts`) covering US1–US4 and SC-001…SC-008.

**Organization**: Tasks are grouped by user story. US1 and US2 are both P1 (MVP together); US3 is P2; US4 is P3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 / US4 — maps to the spec's user stories

## Path Conventions

Single-project Electron layout: `src/main/`, `src/shared/`, `tests/` at repository root (per plan.md).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Named config caps and the fixture extensions later stories depend on.

- [x] T001 [P] Add `formFieldControlCap: numFromEnv("HYPPO_FORM_FIELD_CONTROL_CAP", 200)` and `formFieldOptionCap: numFromEnv("HYPPO_FORM_FIELD_OPTION_CAP", 200)` to the `config` object in `src/main/config.ts`, beside the existing limits.
- [x] T002 [P] Extend `tests/fixtures/form.html`: add a second `<form id="otherform">` containing exactly one text `<input id="other_field">`; add one `<input type="text">` with **neither `id` nor `name`** inside `#theform` (selector synthesis); add a `<fieldset id="shift">` with two `<input type="radio" name="shift">` radios (`group`). Leave every existing element, id, and `<script>` hook untouched.

**Checkpoint**: `npm run build` clean; `config.formFieldControlCap` / `formFieldOptionCap` importable.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types and the pure verdict functions every user story builds on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 [P] In `src/shared/types.ts`, add: `FieldVerdict { verdict: "permitted" | "refused"; ruleId?: string; ruleDescription?: string }`; `FieldOption { label: string; value: string }`; `FormFieldRecord` with every field in data-model.md §3 (`selector: string | null`, `selectorSynthesised`, `duplicateId`, `kind` union, `type: string | null`, `label`, `required`, `group: string | null`, `inFormAncestor`, `visible`, `currentValue?` — optional so it can be omitted, `options: FieldOption[]`, `optionsAvailable`, `optionsTruncated`, `fillVerdict: FieldVerdict`, `clickVerdict: FieldVerdict`); `FormFieldMap { tabId; url; observedAt; truncated: boolean; records: FormFieldRecord[]; queueDepth: number }`.
- [x] T004 In `src/main/safety/blocklist.ts`: (a) extract the accessible-name source list currently inline in `DESCRIPTOR_BODY` into a shared in-page snippet that pushes the raw parts (associated `label[for]`, wrapping `<label>`, `aria-label`, `aria-labelledby` text, `placeholder`, `title`); `DESCRIPTOR_BODY` keeps joining + lowercasing them for `name` (no behaviour change). (b) Add pure `fillVerdictFor(d: TargetDescriptor): FieldVerdict` — `matchBlocklist(d, "fill").blocked` → `refused` + `ruleId` + `ruleDescription`; else `isSafeFillTarget(d).ok === false` → `refused` + `ruleId: "unsafe-fill-type"` + `ruleDescription: \`Not a safe value field: ${reason}.\``; else `{ verdict: "permitted" }`. (c) Add pure `clickVerdictFor(d): FieldVerdict` — from `matchBlocklist(d, "click")`. (data-model.md §6, research.md R8.)
- [x] T005 Run `npm run test` and `npm run test:e2e` to confirm T004's extraction left `matchBlocklist` / `targetDescriptorScript` behaviour byte-identical (existing blocklist unit tests + interaction e2e still green) before any reader code is added.

**Checkpoint**: Types compile; `fillVerdictFor` / `clickVerdictFor` exported and regression-clean.

---

## Phase 3: User Story 1 - Get the field map for a form in one call (Priority: P1) 🎯 MVP

**Goal**: `read_form_fields(tabId)` returns a document-ordered list of the page's form controls, each with a working `selector`, a `kind`, a verbatim `label`, `required`, `group`, `inFormAncestor`, `visible`, and `currentValue` — one inline payload, no DOM dump, no local parsing.

**Independent Test**: On `form.html`, one call → `records` non-empty in document order; every visible control has a non-null `selector`, a `kind`, and a non-empty `label`; each `selector` resolves to exactly one element; the result is returned inline (no `tool-results/*` file); the interaction log line count is unchanged; nothing written to the shared data dir.

- [x] T006 [US1] Create `src/main/page/form-fields.ts` with the in-page collector script `FORM_FIELDS_SCRIPT` (isolated world): resolve the scope root (`document` when no container; sentinel `{ containerFound: false }` when a container selector resolves to nothing); collect candidate controls in document order (`input, select, textarea, button, [contenteditable], [role]` filtered to the FR-003 form-ish roles); per control emit a raw record with `tagName`, `type`, `role`, `hasFormAncestor`, `isContentEditable`, `autocomplete`, the lowercased `name` (for the descriptor), the verbatim `label` (first non-empty of the shared sources, case preserved — research.md R8), `required` (`required` / `aria-required` / literal `*` in label), `group` (radios only — `name` → `<fieldset>` id → synthesised `group:<n>`), `visible` (research.md R7a), and `currentValue` (research.md R7 — text value / `checked` / selected option value / `null`; emit for **all** controls in this story, credential omission is US2). Apply the control cap (`config.formFieldControlCap`) in document order and set a top-level `truncated` flag. Return `{ containerFound: true, observedAt: <ISO>, records, truncated }`.
- [x] T007 [US1] In `src/main/page/form-fields.ts`, add the selector-synthesis logic (research.md R3), runnable both in-page (in the collector) and as an exported pure helper for unit tests: `#id` when unique in the root → `[name="…"]` (tag-qualified if needed) when unique → structural `nth-of-type` path; verify `=== 1` against the root; set `selectorSynthesised` for the structural case, `duplicateId` when an `id` is present but not unique, `selector: null` when no unique selector can be built. Add the pure `kindFor(tagName, type, role, isContentEditable)` mapping (research.md R4 table).
- [x] T008 [US1] In `src/main/page/form-fields.ts`, add `export async function readFormFields(wc, tabId, containerSelector: string | undefined, queueDepth: number): Promise<FormFieldMap>`: call `wc.executeJavaScript(FORM_FIELDS_SCRIPT(containerSelector), true)`; `containerFound === false` → throw `HyppoError("TARGET_NOT_FOUND", …)`; otherwise build each `FormFieldRecord` from its raw record — construct a `TargetDescriptor` and attach `fillVerdict: fillVerdictFor(d)` / `clickVerdict: clickVerdictFor(d)` (US2 refines credential handling), default `options: []` / `optionsAvailable: false` / `optionsTruncated: false` (US3 fills these) — and return `FormFieldMap` with `tabId`, `wc.getURL()`, `observedAt`, `truncated`, `records`, `queueDepth`. **No `log.record` call** (FR-014).
- [x] T009 [US1] In `src/main/mcp/tools.ts`, register a seventh tool `read_form_fields` — input `{ tabId: z.string(), containerSelector: z.string().optional() }`, body `queue.run((depth) => readFormFields(tabs.webContentsFor(tabId), tabId, containerSelector, depth))` then `ok(value)`, `catch` → `fail(e)`. Write a description per FR-015 (read-only; returns form controls with selector/kind/label; per-control fill & click verdicts; `<select>`/combobox options; credential values omitted; bounded with a truncation flag; `read_page` unchanged). Update the file header comment "Six tools" → "Seven tools".
- [x] T010 [P] [US1] In `src/main/index.ts` (`HYPPO_E2E` block), add `readFormFields: (tabId, containerSelector) => withCode(() => queue.run((d) => readFormFields(tabs.webContentsFor(tabId), tabId, containerSelector, d)).then((r) => r.value))` to `globalThis.__hyppo`, mirroring the `read` handle. Import `readFormFields`.
- [x] T011 [P] [US1] Create `tests/unit/form-fields.test.ts`: assert `kindFor(...)` matches research.md R4's table for each combination (password input → `kind:"text"`, `type:"password"`; `contenteditable` → `richtext`; `<div role="combobox">` → `combobox`; `<input type="file">` → `file`); assert selector synthesis on a synthetic DOM — unique `id` → `#id`; duplicate `id` → `duplicateId:true` + structural selector that resolves to one node; unique `name` only → `[name="…"]`; neither → `nth-of-type` path resolving to one node with `selectorSynthesised:true`. Use `HYPPO_FORM_FIELD_CONTROL_CAP=3` to assert a 5-control root yields 3 records + `truncated:true`.
- [x] T012 [US1] Create `tests/integration/read-form-fields.spec.ts` with the US1 case (quickstart §2): load `form.html`, `readFormFields(tabId)` → `records` non-empty and in document order; every visible control has a non-null `selector`, a `kind`, and a non-empty `label`; feed each `selector` through `callHandle(app, "probe", …)` or `wait_for_selector` and confirm it resolves to one element; assert the app's `userData` grew no `tool-results/*` file; capture the interaction-log line count before and after and assert it is unchanged; assert no `capture|page|content` file in the shared data dir. Add: a pre-filled control reports its value in `currentValue`.

**Checkpoint**: US1 fully functional — one call returns the field map, inline, no side effects.

---

## Phase 4: User Story 2 - Know which fields a fill would refuse, before sending the batch (Priority: P1)

**Goal**: Each record's `fillVerdict` / `clickVerdict` matches exactly what `interact` returns for that target; a credential field's `currentValue` is omitted entirely.

**Independent Test**: On `form.html`, `#submitBtn` → `refused`/`submit-control`; `#password` → `fillVerdict refused`/`credential-field` **and** `"currentValue" in record === false`; `#resume` → `refused`/`unsafe-fill-type`; `#agree` → `refused`/`consent-toggle`; every plain text/email/tel/url/number/textarea/contenteditable control → `fillVerdict permitted`; a sampled cross-check against a real `interact` call agrees.

- [x] T013 [US2] In `src/main/page/form-fields.ts` `readFormFields`, finalise verdict wiring: ensure the `TargetDescriptor` built per record carries `name` (lowercased), `type`, `role`, `hasFormAncestor`, `autocomplete`, `isContentEditable` so `fillVerdictFor` / `clickVerdictFor` see exactly what `interact` sees. When `fillVerdictFor(d)` returns `ruleId: "credential-field"` (or `d.type === "password"` / credential `autocomplete`), **omit the `currentValue` key from the record entirely** — do not set it to `null` or a placeholder (FR-005, SC-005). Do this at record assembly so the value never enters the payload.
- [x] T014 [US2] Extend `tests/unit/form-fields.test.ts`: for descriptors covering every rule category (`submit-control`, `consent-toggle`, `external-act-label`, `credential-field`, `unsafe-fill-type`, `in-form`, and a plain text field), assert `fillVerdictFor(d)` / `clickVerdictFor(d)` return the same `verdict` + `ruleId` that `interact`'s own path produces for the same descriptor (`in-form` appears in `clickVerdict` only, never `fillVerdict`). Assert record assembly omits the `currentValue` own-property for a credential descriptor (`"currentValue" in record === false`).
- [x] T015 [US2] Extend `tests/integration/read-form-fields.spec.ts` with the US2 cases (quickstart §3): from one `readFormFields(tabId)` map on `form.html`, assert the verdicts for `#submitBtn`, `#password` (+ no `currentValue` key), `#resume`, `#agree`, and the plain fields `#first_name`/`#email`/`#phone`/`#website`/`#age`/`#bio`/`#cover` (`fillVerdict permitted`, `clickVerdict refused in-form`). For a sample of each category, also call `interact` with the matching operation and assert the same permitted/refused + `ruleId` (SC-004).

**Checkpoint**: US1 + US2 both pass independently — MVP complete: a self-describing field map.

---

## Phase 5: User Story 3 - See the choices a dropdown offers (Priority: P2)

**Goal**: `<select>` records list all `(label, value)` option pairs; a combobox with option elements in the DOM lists them; a combobox with none reports `optionsAvailable: false`. Option cap truncates with a per-record flag.

**Independent Test**: `#country` → `options` has 3 verbatim `(label, value)` pairs in document order, `optionsAvailable: true`, `kind: "select"`; `#locationCombobox` (menu present) → `optionsAvailable: true`, lists "Berlin, Germany" / "Munich, Germany"; a combobox whose options are absent → `options: []`, `optionsAvailable: false`.

- [ ] T016 [US3] In `src/main/page/form-fields.ts` collector, add options extraction (research.md R5): `<select>` → `[...el.options].map(o => ({ label: o.label || o.text, value: o.value }))`, `optionsAvailable: true`. Role `combobox`/`listbox` → find option elements (`[role="option"]` within the element, or within `getElementById(aria-controls / aria-owns)`, or a descendant/sibling `[role="listbox"]`); found → map to `{ label: text, value: data-value ?? value ?? id ?? "" }`, `optionsAvailable: true`; none in DOM → `options: []`, `optionsAvailable: false`. Every other kind → `[]` / `false`. Apply `config.formFieldOptionCap` per control in document order, set `optionsTruncated: true` when cut. Labels/values verbatim (FR-011). The reader never opens a menu.
- [ ] T017 [US3] Extend `tests/unit/form-fields.test.ts`: with `HYPPO_FORM_FIELD_OPTION_CAP=2`, a synthetic 4-`<option>` `<select>` → 2 options + `optionsTruncated: true`; a `role="combobox"` with no `[role="option"]` in the DOM → `options: []`, `optionsAvailable: false`.
- [ ] T018 [US3] Extend `tests/integration/read-form-fields.spec.ts` with the US3 cases (quickstart §4): `#country` options (3 pairs, order, values `""`/`de`/`us`, `optionsAvailable: true`); `#locationCombobox` options (two verbatim labels, `optionsAvailable: true`); assert a combobox with removed options reports `optionsAvailable: false` (remove them via `probe`/`executeJavaScript` in the test, then re-read).

**Checkpoint**: US1–US3 independently functional.

---

## Phase 6: User Story 4 - Scope to one form and handle an oversized page (Priority: P3)

**Goal**: An optional container selector scopes the read; an unresolved container errors; more controls than the cap truncates with the top-level flag.

**Independent Test**: `readFormFields(tabId, "#otherform")` → only `#otherform`'s control; `readFormFields(tabId, "#theform")` → every `#theform` control, none from outside; `readFormFields(tabId, "#no-such")` → `TARGET_NOT_FOUND`; with `HYPPO_FORM_FIELD_CONTROL_CAP=4`, whole-page read → 4 records + `truncated: true`, the first 4 in document order.

- [ ] T019 [US4] In `src/main/page/form-fields.ts` collector, confirm/complete container scoping: when `containerSelector` is given, the scope root is `document.querySelector(containerSelector)`; unresolved → return `{ containerFound: false }`; all `querySelectorAll` and uniqueness checks run against the root, not `document`. Confirm `readFormFields` maps `containerFound: false` to `HyppoError("TARGET_NOT_FOUND", \`No element matches container selector …\`)`.
- [ ] T020 [US4] Extend `tests/integration/read-form-fields.spec.ts` with the US4 cases (quickstart §5): scoped reads for `#otherform` and `#theform` (assert included/excluded selectors: `#safeBtn`, `#connectLink`, `#saveBtn`, `#tos`, `#remoteOnly` absent from the `#theform` scope); `#no-such-container` → `TARGET_NOT_FOUND`; relaunch the app (or a fresh context) with `HYPPO_FORM_FIELD_CONTROL_CAP=4` and assert `truncated: true` with 4 document-ordered records.

**Checkpoint**: All four user stories pass independently.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T021 [P] Update `README.md`: add a `read_form_fields` row to the MCP tool table; confirm the "What the app will not do" section still accurate (read-only, adds no permission, `read_page` unchanged).
- [ ] T022 [P] Sweep for any doc/comment that says "six tools" (e.g. `specs/001-*/contracts/mcp-tools.md`, `CLAUDE.md` if present) and update to seven, or note the addition — do not rewrite unrelated content.
- [ ] T023 Run the full gate (quickstart §7): `npm run build`, `npm run lint`, `npm run test`, `npm run test:e2e` — all clean. Confirm the MCP tool list has seven tools and `read_form_fields`'s schema accepts `{ tabId }` and `{ tabId, containerSelector }`.
- [ ] T024 Walk quickstart.md §1–§6 end to end against the built app; demonstrate SC-001…SC-008 (SC-008: build a `004` batch from only `fillVerdict: "permitted"` selectors on `form.html` and confirm it passes `004`'s pre-write check once `004` is merged; until then, `fill` each `permitted` selector individually with no refusal). Mark this feature's `checklists/requirements.md` items still satisfied.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies. T001 ∥ T002.
- **Foundational (Phase 2)**: depends on Setup. T003 ∥ T004; T005 after T004. **Blocks all user stories.**
- **US1 (Phase 3)**: depends on Phase 2. Builds `form-fields.ts` (T006 → T007 → T008), the tool (T009), the handle (T010), tests (T011 ∥, T012).
- **US2 (Phase 4)**: depends on US1 (refines `readFormFields` record assembly and the same test files). Same-file with US1 on `form-fields.ts` and `read-form-fields.spec.ts` → sequential after US1.
- **US3 (Phase 5)**: depends on US1 (extends the collector). Independent of US2 in logic but same file → after US2.
- **US4 (Phase 6)**: mostly confirmation of scoping/cap logic written in T006/T008; depends on US1.
- **Polish (Phase 7)**: after all targeted stories.

### Within a story / same-file spine

- `src/main/page/form-fields.ts` — T006, T007, T008, T013, T016, T019 — strictly sequential, never `[P]`.
- `tests/integration/read-form-fields.spec.ts` — T012, T015, T018, T020 — strictly sequential.
- `tests/unit/form-fields.test.ts` — T011, T014, T017 — strictly sequential.
- `src/main/safety/blocklist.ts` (T004) must land before any `form-fields.ts` work.

### Parallel Opportunities

- **Phase 1**: T001 (`config.ts`) ∥ T002 (`form.html`).
- **Phase 2**: T003 (`types.ts`) ∥ T004 (`blocklist.ts`).
- **Phase 3**: once T008 lands, T009 (`tools.ts`) ∥ T010 (`index.ts`) ∥ T011 (`form-fields.test.ts`).
- **Phase 7**: T021 (`README.md`) ∥ T022 (doc sweep); then T023, T024.

---

## Parallel Example: Phase 3 (after the form-fields.ts spine)

```bash
Task: "Register read_form_fields tool in src/main/mcp/tools.ts"          # T009
Task: "Add readFormFields e2e handle in src/main/index.ts"              # T010
Task: "Unit: kindFor + selector synthesis in tests/unit/form-fields.test.ts"  # T011
```

---

## Implementation Strategy

### MVP (US1 + US2 — both P1)

1. Phase 1 Setup (T001–T002) → Phase 2 Foundational (T003–T005).
2. Phase 3 US1 (T006–T012) — the field map in one call.
3. Phase 4 US2 (T013–T015) — verdicts match `interact`; credential value never in the payload.
4. **STOP and VALIDATE**: quickstart §2 + §3 pass; `build` + `lint` + `test` + `test:e2e` clean.

### Incremental Delivery

- MVP (US1+US2) → demo: a self-describing field map that feeds a clean `004` batch.
- + US3 (T016–T018) → dropdown option lists (input to `006`).
- + US4 (T019–T020) → container scoping + oversized-page truncation.
- + Polish (T021–T024) → docs, seven-tool sweep, full gate, SC walk.

---

## Notes

- No constitution amendment (FR-016). New surface: one MCP tool (6 → 7) and one module (`src/main/page/form-fields.ts`) — flagged for review under Principle III (recorded in plan.md Complexity Tracking).
- No new `ErrorCode` — reuse `TAB_NOT_FOUND` / `TARGET_NOT_FOUND`.
- No `.specify/extensions.yml` → no Spec Kit hooks run for this feature.
- The reader writes nothing and adds no interaction-log entry; the integration tests assert both.
- Commit after each phase or logical group.
