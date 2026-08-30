---

description: "Task list for feature 008 — form-filling robustness"
---

# Tasks: Form-Filling Robustness

**Input**: Design documents in `specs/008-form-filling-robustness/`
(`plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/mcp-tools-008-delta.md`,
`quickstart.md`)

**Tests**: included — every prior feature in this repo ships `vitest` unit + Playwright
`_electron` integration, and the spec defines an Independent Test per story.

**Organization**: by user story (spec priority order): US1 list_options (P1), US2 bounded
scoped reads (P1), US3 selector/operation hygiene (P2), US4 screenshot (P2), US5
invalid-selector feedback (P3).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: different file, no dependency on an incomplete task → parallelisable
- **[Story]**: US1–US5; Setup / Foundational / Polish carry no story label

## Path Conventions

Single project — `src/main/**`, `src/renderer/**`, `src/shared/**`, `tests/**` at repo root
(existing layout, per plan.md).

---

## Phase 1: Setup (fixtures)

- [x] T001 [P] Add `tests/fixtures/combobox.html` — a scripted dropdown whose
  `[role="option"]` nodes are injected only after the control is clicked, backed by a hidden
  `<input type="hidden" name="q_role">` value-mirror; plus a plain native `<select>` and a
  `<select multiple>`; plus one widget wired to never inject options.
- [x] T002 [P] Extend `tests/fixtures/form.html` — add a
  `maxlength="20" pattern="[0-9]*" inputmode="numeric"` text input, a group of `required`
  inputs left empty, and a plain `<button type="button">`.

---

## Phase 2: Foundational (blocking prerequisites)

**⚠️ No user-story work starts until this phase is done.**

- [x] T003 Add config keys to `src/main/config.ts`: `formFieldReadMaxBytes`
  (`HYPPO_FORM_FIELD_READ_MAX_BYTES`, 65536), `screenshotMaxBytes`
  (`HYPPO_SCREENSHOT_MAX_BYTES`, 262144), `screenshotJpegQualityStart`
  (`HYPPO_SCREENSHOT_JPEG_QUALITY_START`, 80), `screenshotJpegQualityFloor`
  (`HYPPO_SCREENSHOT_JPEG_QUALITY_FLOOR`, 30), all via the existing `numFromEnv`.
- [x] T004 Add `"INVALID_SELECTOR"` and `"SCREENSHOT_FAILED"` to the `ErrorCode` union in
  `src/main/errors.ts` (no new `details` fields).
- [x] T005 Create `src/main/page/selector-syntax.ts` — export `INVALID_SELECTOR_MESSAGE`
  (the fixed text from `research.md` R9) and `assertSelectorValid(marker: unknown)` which
  throws `new HyppoError("INVALID_SELECTOR", INVALID_SELECTOR_MESSAGE)` when the in-page
  script returned `{ __invalidSelector: true }`. Also export the JS snippet string that
  wraps a `querySelector(All)` call in the `SyntaxError`-catching `try/catch`.
- [x] T006 [P] Declare shared types in `src/shared/types.ts`: extend `FormFieldRecord` with
  optional `operation` (`"fill"|"choose"|"activate"|"none"`), `chooseVerdict`
  (`{ allowed: boolean; ruleId?: string; description?: string }`), `interactive` (boolean),
  `mirrors` (string), `maxLength` / `pattern` / `inputMode` (all optional); add
  `ListOptionsResult` and `ScreenshotResult` per `data-model.md` §3–§4.
- [x] T007 [P] Unit test `tests/unit/selector-syntax.test.ts` — `assertSelectorValid`
  throws `INVALID_SELECTOR` on the sentinel and is a no-op otherwise; message names
  `:has-text()`, `text=`, `>>`.

**Checkpoint**: shared plumbing ready — stories can proceed (US1 → US2 → US3 share
`form-fields.ts`/`choose-option.ts`; US4, US5 are independent).

---

## Phase 3: User Story 1 — enumerate a custom dropdown's choices (Priority: P1) 🎯 MVP

**Goal**: a read-only `interact` `list_options` that returns any dropdown's choices without
selecting anything and without an audit entry.

**Independent Test**: point it at `combobox.html`'s scripted widget → full label list back,
control value unchanged, menu closed, `interaction-log.jsonl` line count unchanged.

### Tests for User Story 1

- [x] T008 [P] [US1] Extend `tests/unit/choose-option.test.ts`: `listOptions()` returns a
  native `<select>`'s options with `optionsPresent: true` and no open/close; drives
  open → gather → close for a scripted widget; a never-populating widget yields
  `{ options: [], optionsPresent: false, optionsTruncated: false }`; `<select multiple>`
  classifies as not-a-dropdown; the option cap sets `optionsTruncated`.
- [x] T009 [P] [US1] Add `tests/integration/list-options.spec.ts`: native select, scripted
  widget, plain `<div>` → `CHOOSE_OPTION_FAILED`/`reason:"not-a-dropdown"`, never-populating
  widget → empty + `optionsPresent:false` (with a lowered `HYPPO_CHOOSE_OPTION_WAIT_MS`),
  control value + menu state unchanged after the call, **`interaction-log.jsonl` unchanged**,
  and blocklist parity: pointed at a submit button / consent checkbox / password field it is
  refused `REFUSED_EXTERNAL_ACT` with the same `ruleId` `choose_option` returns there.

### Implementation for User Story 1

- [x] T010 [US1] Refactor `src/main/page/choose-option.ts`: extract the
  probe → (open if `!optionsPresent`) → `gatherScript` → `closeReadbackScript` sequence into
  an exported `listOptions(wc, selector)` returning `{ options, optionsPresent, optionsTruncated }`
  (cap via `config.formFieldOptionCap` + `capList`); make `chooseOption` call the shared
  steps so there is one copy; add the `SyntaxError` catch from `selector-syntax.ts` to
  `probeScript` and surface `{ __invalidSelector: true }`.
- [x] T011 [US1] Add the `list_options` branch to `src/main/page/interact.ts`: blocklist
  gate via the same rule set `choose_option` uses (`matchBlocklist(descriptor, "choose_option")`),
  call `listOptions`, map probe not-a-dropdown / `<select multiple>` to
  `CHOOSE_OPTION_FAILED`, call `assertSelectorValid` on the invalid-selector marker, and
  write **no** `log.record` entry on any path (success, refusal, error).
- [x] T012 [US1] In `src/main/mcp/tools.ts` add `"list_options"` to the `interact`
  `operation` zod enum and to the tool description; return the `ListOptionsResult` shape
  (`tabId`, `selector`, `options`, `optionsPresent`, `optionsTruncated`, `queueDepth`) via
  `ok(...)`.
- [x] T013 [US1] Update `specs/001-open-any-url/contracts/mcp-tools.md`: add the
  `list_options` operation row from `contracts/mcp-tools-008-delta.md` (request, response,
  read-only + no-audit guarantees, error table).

**Checkpoint**: US1 fully functional and testable on its own.

---

## Phase 4: User Story 2 — scoped, size-budgeted form reads (Priority: P1)

**Goal**: `read_form_fields` gains `fields` projection, `includeNonInteractive` (default
off), a 64 KB byte budget with a `truncated` flag, `only: "required-unfilled"`, and text
input-constraint hints.

**Independent Test**: a `fields`-scoped read returns exactly the named records; a normal
read stays ≤ 64 KB and flags trimming; a plain button is absent by default.

### Tests for User Story 2

- [x] T014 [P] [US2] Extend `tests/unit/form-fields.test.ts`: byte-budget tail-drop is
  order-stable and sets `truncated`; `required-unfilled` predicate (empty string / unchecked
  / no option chosen / placeholder-only count as empty); `maxLength` / `pattern` /
  `inputMode` extraction only when the attribute is present; `fields` + `containerSelector`
  together is rejected as an argument error.
- [x] T015 [P] [US2] Extend `tests/integration/read-form-fields.spec.ts`: `fields:
  ["#first_name","#email","#q_role"]` returns exactly those three in document order and
  includes `#q_role` though it is a hidden mirror (explicit selector overrides exclusion);
  default read omits the plain `<button type="button">`; `includeNonInteractive: true`
  includes it; `only: "required-unfilled"` returns only the empty required set; a lowered
  `HYPPO_FORM_FIELD_READ_MAX_BYTES` makes a full read `truncated: true` with tail records
  dropped; the constrained field's record carries `maxLength`/`pattern`/`inputMode`.

### Implementation for User Story 2

- [x] T016 [US2] `src/main/page/form-fields.ts` collector: accept a `fields: string[]`
  argument — for each entry run `document.querySelectorAll` inside the `SyntaxError` catch,
  union + dedupe matched elements in document order, and when `fields` is present emit
  records only for those elements (skipping the non-interactive exclusion for named
  elements); return `{ __invalidSelector: true }` on a bad entry.
- [x] T017 [US2] `src/main/page/form-fields.ts` collector: for text-like kinds read
  `el.maxLength` (emit when ≥ 0 and set), `getAttribute("pattern")`,
  `getAttribute("inputmode")`; attach to the record only when present.
- [x] T018 [US2] `src/main/page/form-fields.ts` main process: add `includeNonInteractive`
  (default `false`) — filter out `kind === "button"` records unless set or named in
  `fields`; after the count cap, run the byte-budget trim against
  `config.formFieldReadMaxBytes` (measure `Buffer.byteLength(JSON.stringify(payload))`, drop
  the last record while over budget, set `truncated`); reject `fields` + `containerSelector`
  supplied together.
- [x] T019 [US2] `src/main/page/form-fields.ts` main process: add `only: "required-unfilled"`
  — keep only records where `required === true` and the current value is empty per the
  `data-model.md` definition.
- [x] T020 [US2] `src/main/mcp/tools.ts` `read_form_fields`: add `fields` (`z.array(z.string())`),
  `includeNonInteractive` (`z.boolean().optional()`), `only` (`z.enum(["required-unfilled"]).optional()`)
  params + description text; thread them to `readFormFields`; convert the invalid-selector
  marker to `INVALID_SELECTOR` via `assertSelectorValid`.
- [x] T021 [US2] Update `specs/001-open-any-url/contracts/mcp-tools.md`: `read_form_fields`
  new params + the `truncated`-now-covers-byte-budget note from the delta doc.

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 — one unambiguous selector + operation per control (Priority: P2)

**Goal**: a scripted dropdown backed by a hidden input collapses to one interactive record
whose `selector` `choose_option` accepts; every record states its `operation` and carries a
`chooseVerdict`.

**Independent Test**: `combobox.html`'s scripted widget yields one record; feeding its
`selector` to `interact choose_option` succeeds on the first try.

### Tests for User Story 3

- [ ] T022 [P] [US3] Extend `tests/unit/form-fields.test.ts`: the mirror classifier tags a
  hidden same-`name` input beside a combobox `interactive: false` + `mirrors:
  "<combobox selector>"`; the combobox record's synthesised `selector` is the chooser
  element, never the `[name]` input; `operation` derivation matches the `data-model.md`
  table. Extend `tests/unit/blocklist.test.ts`: `chooseVerdictFor` refuses exactly the
  `submit-control` / `consent-toggle` / `credential-field` / `external-act-label` targets
  and permits an in-form plain field.
- [ ] T023 [P] [US3] Extend `tests/integration/read-form-fields.spec.ts`: `combobox.html`'s
  scripted widget appears as one record; that `selector` passed to
  `interact { operation: "choose_option" }` succeeds first try (no `not-a-dropdown`); each
  record's `operation` matches its kind; the hidden mirror appears only under
  `includeNonInteractive` or when named in `fields`, always tagged `interactive: false`.

### Implementation for User Story 3

- [ ] T024 [US3] `src/main/safety/blocklist.ts`: add `chooseVerdictFor(descriptor)` — apply
  the `choose_option` gate (`submit-control`, `consent-toggle`, `credential-field`,
  `external-act-label` refuse; `in-form` does not gate), returning the same
  `{ allowed, ruleId?, description? }` shape as `fillVerdictFor` / `clickVerdictFor`.
- [ ] T025 [US3] `src/main/page/form-fields.ts` collector: cluster pass — for each
  `role="combobox"` / `role="listbox"` / listbox-owner candidate, find an associated hidden
  `<input>` (shares `name`, or the combobox sits inside the input's nearest widget
  container); tag that input `interactive: false` + `mirrors: "<combobox selector>"`, and
  constrain `synthesizeSelector` for the combobox record to the chooser element (never the
  `[name]` input).
- [ ] T026 [US3] `src/main/page/form-fields.ts` main process: set `operation` on every
  record from `kind` (`data-model.md` R8 table) and `chooseVerdict` from
  `chooseVerdictFor(descriptor)`; extend the default non-interactive exclusion to also drop
  `interactive === false` records (unless named in `fields` or `includeNonInteractive`).
- [ ] T027 [US3] Update `specs/001-open-any-url/contracts/mcp-tools.md`: the new record
  fields (`operation`, `chooseVerdict`, `interactive`, `mirrors`) and the "one record per
  scripted dropdown, chooser selector" guarantee.

**Checkpoint**: US1–US3 independently functional; a scripted-dropdown form is now fully
fillable without guessing.

---

## Phase 6: User Story 4 — see the current state of the page (Priority: P2)

**Goal**: a new `screenshot` MCP tool — viewport / element clip / full page, JPEG by
default, bounded to 256 KB, image content block + metadata, no disk write, no audit entry.

**Independent Test**: `screenshot { tabId }` returns an image + `{ width, height, scale }`
under 256 KB; `userData` gains no file and the audit log is unchanged.

### Tests for User Story 4

- [ ] T028 [P] [US4] Add `tests/unit/screenshot.test.ts`: the scale/compress loop with a
  stubbed encoder — walks JPEG quality down to the floor, then downscales by 0.8, bounded to
  ≤ 6 iterations; reports `scale` = finalWidth / naturalWidth and `limitNotMet` when still
  over budget at the floor; the PNG path only downscales.
- [ ] T029 [P] [US4] Add `tests/integration/screenshot.spec.ts`: viewport shot returns an
  image block + metadata (`width`/`height` > 0, `scale: 1`, `format: "jpeg"`, ≤ 256 KB);
  `maxBytes: 20000` → `scale < 1` and/or lower quality, `limitNotMet` truthful; element clip
  dimensions ≈ the input's bounding box and `element` echoes the selector; a zero-size /
  off-viewport element → `SCREENSHOT_FAILED`; `fullPage: true` on a tall fixture →
  `height` >> viewport and `fullPage: true`; before/after, `userData` gains no file and
  `interaction-log.jsonl` is unchanged.

### Implementation for User Story 4

- [ ] T030 [US4] Create `src/main/page/screenshot.ts` — `takeScreenshot(wc, opts)`:
  viewport via `wc.capturePage()`; element via `getBoundingClientRect` in an isolated world
  + renderable check (`width < 1 || height < 1` or fully off-viewport → `SCREENSHOT_FAILED`)
  then `wc.capturePage(rect)`; `fullPage` via `wc.debugger.attach("1.3")` +
  `Page.captureScreenshot({ format, quality, captureBeyondViewport: true })` with
  detach in `finally`; the scale/compress loop from T028 using `NativeImage`
  `toJPEG` / `toPNG` / `resize`; returns `{ bytes, mimeType, meta: ScreenshotResult }`;
  throws `INVALID_SELECTOR` / `SCREENSHOT_FAILED` (with `cause`).
- [ ] T031 [US4] `src/main/mcp/tools.ts`: add an `okImage(dataBase64, mimeType, meta)`
  helper returning `{ content: [{ type: "image", data, mimeType }, { type: "text", text:
  JSON.stringify(meta, null, 2) }] }`; register the `screenshot` tool (zod: `tabId`,
  `selector?`, `fullPage?`, `format?`, `maxBytes?`) running through `queue.run`, no
  `log.record`, returning `okImage(...)`.
- [ ] T032 [US4] `src/main/mcp/tools.ts`: add `"screenshot"` to `TOOL_NAMES` (7 → 8).
- [ ] T033 [P] [US4] `src/renderer/snippets.ts`: add a `screenshot` line to the About-text
  tool list (one-line purpose, e.g. "screenshot   a picture of a tab, to check rendered
  state"); run `tests/unit/connection-snippets.test.ts` (the guard iterates `TOOL_NAMES` and
  must pass).
- [ ] T034 [US4] Update `specs/001-open-any-url/contracts/mcp-tools.md` and the `README.md`
  tool table: add the `screenshot` row incl. the privacy note from the delta doc.

**Checkpoint**: US1–US4 independently functional.

---

## Phase 7: User Story 5 — actionable feedback for an unusable selector (Priority: P3)

**Goal**: a non-CSS selector anywhere in the tool surface returns `INVALID_SELECTOR`, not
`TARGET_NOT_FOUND`.

**Independent Test**: `interact` and `wait_for_selector` with `a:has-text('x')` →
`INVALID_SELECTOR`; a valid-but-unmatched selector still → `TARGET_NOT_FOUND`.

### Tests for User Story 5

- [ ] T035 [P] [US5] Extend `tests/integration/interaction.spec.ts`: `interact` `click`
  (and one more op) with `a:has-text('Apply')` → `INVALID_SELECTOR` whose message names the
  unsupported forms; `wait_for_selector` with the same → `INVALID_SELECTOR`;
  `#definitely-not-here` (valid CSS) still → `TARGET_NOT_FOUND`.
- [ ] T036 [P] [US5] Extend `tests/integration/read-form-fields.spec.ts`: a bad
  `containerSelector` and a bad entry in `fields` each → `INVALID_SELECTOR`.

### Implementation for User Story 5

- [ ] T037 [US5] `src/main/page/interact.ts`: wrap the caller-selector `querySelector`
  calls in `targetDescriptorScript` / `activeElementDescriptorScript` and the
  `waitForSelector` poll script with the `SyntaxError` catch from `selector-syntax.ts`;
  call `assertSelectorValid` on the marker so every `interact` operation (`click`, `fill`,
  `scroll`, `space`, `choose_option`, `list_options`) and `wait_for_selector` return
  `INVALID_SELECTOR` before the "not found" path.
- [ ] T038 [US5] Audit the US1 (`choose-option.ts` `probeScript`) and US2/US3
  (`form-fields.ts` collector) invalid-selector paths added earlier: confirm they route
  through the one shared module + message; add any missing call site.

**Checkpoint**: all five user stories independently functional.

---

## Phase 8: Polish & cross-cutting

- [ ] T039 [P] `README.md` "What the app will not do": add a line that attaching files to a
  file-upload control is not supported and is a human step (FR-029); keep the existing
  `kind: "file"` + refusing `fillVerdict` behaviour as the hand-off signal.
- [ ] T040 [P] `README.md` and the `interact` `fill` description in `src/main/mcp/tools.ts`:
  add that choosing among address / place autocomplete suggestions is a human step —
  `fill` types the literal text and stops (FR-030).
- [ ] T041 Fold `specs/008-form-filling-robustness/contracts/mcp-tools-008-delta.md` fully
  into `specs/001-open-any-url/contracts/mcp-tools.md`; replace any "seven tools" / "six
  tools" phrasing with eight and reconcile the tool list.
- [ ] T042 Run `specs/008-form-filling-robustness/quickstart.md` §1–§7 end to end against a
  built app; fix any drift between the docs and behaviour.
- [ ] T043 Full gate: `npm run build && npm run lint && npm test && npm run test:e2e`
  (ensure local port 7357 is free for the connection-panel e2e).

---

## Dependencies & Execution Order

### Phase order

- **Setup (T001–T002)**: immediately, in parallel.
- **Foundational (T003–T007)**: after Setup. **Blocks every story.** T003/T004/T005 are
  sequential-ish (small, all in different files though, so effectively parallel); T006/T007
  are `[P]`.
- **US1 (T008–T013)** → **US2 (T014–T021)** → **US3 (T022–T027)**: run in this order —
  US1 refactors `choose-option.ts`; US2 and US3 both edit `src/main/page/form-fields.ts`
  and `src/main/mcp/tools.ts` (`read_form_fields`), so their implementation tasks are
  file-serialised. Each remains independently *testable* at its checkpoint.
- **US4 (T028–T034)**: independent of US1–US3 except it also edits `src/main/mcp/tools.ts`
  (`TOOL_NAMES`, new tool) and `specs/001-.../mcp-tools.md`; can run in parallel with
  US1–US3 only if those `tools.ts` edits are coordinated, otherwise sequence after US3.
- **US5 (T035–T038)**: after US1 and US2 land (it audits their invalid-selector call
  sites); T037 itself only needs Foundational.
- **Polish (T039–T043)**: after all desired stories.

### Story independence

- US1: no dependency on US2–US5.
- US2: no dependency on US1/US3–US5 (shares files, not behaviour).
- US3: builds on US2's `form-fields.ts` record shape but is independently verifiable.
- US4: fully independent (new module + new tool).
- US5: exercises selector entry points added by US1/US2 but its own change (T037) stands
  alone.

### Parallel opportunities

- T001 ‖ T002.
- T006 ‖ T007 (after T003–T005).
- Within a story, the two test tasks (`[P]`) run together and before implementation.
- T033 (`snippets.ts`) ‖ T030/T031 within US4.
- T039 ‖ T040 in Polish.

---

## Implementation Strategy

### MVP (US1 only)

Setup → Foundational → US1 → validate `list-options.spec.ts` + the no-audit-entry assertion
→ this alone unblocks scripted-dropdown forms (the hard blocker from the captured session).

### Incremental delivery

US1 (unblock dropdowns) → US2 (stop oversized reads) → US3 (first-try selectors) → US4
(visual state) → US5 (selector error) → Polish (non-goal docs + contract merge). Each
checkpoint is a shippable increment that does not regress the previous ones.

---

## Notes

- `[P]` = different file, no incomplete-task dependency.
- `list_options` and `screenshot` MUST NOT write an `interaction-log.jsonl` entry — asserted
  in T009 and T029.
- Verify each story's tests fail before its implementation tasks.
- Commit after each task or logical group; keep `specs/001-.../mcp-tools.md` edits small and
  reconcile fully in T041.
- The CDP `wc.debugger` path (T030) is the only new mechanism — see plan.md Complexity
  Tracking; keep it confined to the `fullPage` branch.
