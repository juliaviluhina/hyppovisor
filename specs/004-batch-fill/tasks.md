---

description: "Task list for feature 004 — Batch Fill Operation for `interact`"
---

# Tasks: Batch Fill Operation for `interact`

**Input**: Design documents from `/specs/004-batch-fill/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/batch-fill.md, quickstart.md

**Tests**: Included — the plan and quickstart call for a unit suite (`tests/unit/batch-fill.test.ts`) and an integration suite (`tests/integration/batch-fill.spec.ts`) covering US1–US4.

**Organization**: Tasks are grouped by user story. US1 and US2 are both P1 (MVP together); US3 is P2; US4 is P3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 / US4 — maps to the spec's user stories

## Path Conventions

Single-project Electron layout: `src/main/`, `src/shared/`, `tests/` at repository root (per plan.md).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Named config value and the test fixture hook that later stories depend on.

- [x] T001 [P] Add `batchFillCap: numFromEnv("HYPPO_BATCH_FILL_CAP", 50)` to the `config` object in `src/main/config.ts`, alongside the existing limits (`maxTextBytes`, `defaultWaitMs`, …).
- [x] T002 [P] Extend `tests/fixtures/form.html` with the US3 mid-write hook: a small inline script that removes `#phone` from the DOM the first time `#email` receives an `input` event. Leave all existing fixture elements and hooks untouched.

**Checkpoint**: `npm run build` clean; `config.batchFillCap` importable.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Types, the new error code, and the shared per-target check that every user story builds on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 [P] In `src/shared/types.ts`, add batch types: `BatchFillField { selector: string; value: string }`, `BatchFieldResult { selector: string; outcome: "permitted" | "error"; message?: string }`, `BatchFillResult { tabId: string; operation: "fill"; outcome: "permitted" | "partial"; fields: BatchFieldResult[]; summary: { requested: number; written: number; errored: number }; queueDepth: number }` (per data-model.md §1–§3).
- [x] T004 [P] In `src/shared/types.ts`, extend `InteractionLogEntry`: add `"partial"` to the `outcome` union and add optional `batch?: { requested: number; written: number; errored: number; refused: number }` (data-model.md §6). Leave `operation` as `string` — the summary entry uses `"fill_batch"`.
- [x] T005 [P] In `src/main/errors.ts`, add `"BATCH_REJECTED"` to the `ErrorCode` union and add optional `targets?: Array<{ selector: string; ruleId?: string; ruleDescription?: string; reason?: string }>` to `ErrorDetails` (data-model.md §4–§5). Confirm `HyppoError.toResult()` still spreads `details` so the serialised error is `{ error: { code, message, targets? } }`.
- [x] T006 In `src/main/page/interact.ts`, extract the per-target resolve+verdict logic currently inline in `interact()`'s `fill` branch into `resolveFillTarget(wc, selector): Promise<{ ok: true; descriptor } | { ok: false; offender: { selector; ruleId?; ruleDescription?; reason? } }>`. Order: `targetDescriptorScript` (null → `reason: "no element matches"`) → `matchBlocklist(descriptor, "fill")` (block → `ruleId` + `ruleDescription`) → `isSafeFillTarget(descriptor)` (`!ok` → `ruleId: "unsafe-fill-type"` + `reason`). Rewire the single `fill` branch to call it; behaviour must stay byte-for-byte equivalent (data-model.md §9, research.md R2).
- [x] T007 Run `npm run test` and `npm run test:e2e` to confirm T006's refactor left the existing single-`fill` unit and integration tests green before any batch code is added.

**Checkpoint**: Types compile, `BATCH_REJECTED` exists, `resolveFillTarget` shared and single-`fill` regression-clean.

---

## Phase 3: User Story 1 - Draft a whole form in one call (Priority: P1) 🎯 MVP

**Goal**: One `interact` fill call carrying an ordered `(selector, value)` list writes every field in order and returns one aggregate result. Nothing is submitted.

**Independent Test**: On `form.html`, one `fillBatch` call with five plain-field pairs → result `outcome: "permitted"`, `summary { requested: 5, written: 5, errored: 0 }`, five ordered `permitted` field entries; a follow-up probe shows the values; `window.__submitted` is `false`; tab URL unchanged.

- [x] T008 [US1] In `src/main/page/interact.ts`, add `export async function fillBatch(wc, log, tabId, fields: BatchFillField[]): Promise<BatchFillResult>`. This story implements: the cap/empty guard (`fields.length === 0` → `HyppoError("BATCH_REJECTED", "Batch fill requires at least one field.")`; `fields.length > config.batchFillCap` → `HyppoError("BATCH_REJECTED", "Batch fill accepts at most 50 fields; N supplied. Nothing was written.")` — both with **no** `targets`); the pre-write pass calling `resolveFillTarget` for every pair (offender handling is US2 — for now assume all resolve); the write pass calling the existing `fillScript(selector, value)` once per pair in order; and assembling `BatchFillResult` with `outcome: "permitted"` when all written. Append one `{ operation: "fill", target: selector, outcome: "permitted" }` audit entry per field and one `{ operation: "fill_batch", target: null, outcome: "permitted", batch: { requested, written, errored: 0, refused: 0 } }` summary entry (data-model.md §6 table, research.md R2 steps 1–5).
- [x] T009 [US1] In `src/main/mcp/tools.ts`, add `fields: z.array(z.object({ selector: z.string(), value: z.string() })).optional()` to the `interact` input schema. For `operation === "fill"`: enforce exactly-one-of `fields` XOR (`selector` + `value`) — both or neither → `HyppoError("BATCH_REJECTED", "fill requires either (selector, value) or fields, not both.")` (no `targets`). When `fields` is present, dispatch to `fillBatch`; otherwise keep the single-`fill` path. `fields` is ignored for `click` / `scroll` / `space` (data-model.md §8).
- [x] T010 [P] [US1] In `src/main/index.ts`, add an e2e-only handle to `globalThis.__hyppo` (inside the `HYPPO_E2E` block): `fillBatch: (tabId, fields) => withCode(() => queue.run(() => fillBatch(tabs.webContentsFor(tabId), log, tabId, fields)).then((r) => r.value))` (research.md R8). Leave the single `interact` handle untouched.
- [x] T011 [P] [US1] Create `tests/unit/batch-fill.test.ts`: assert `fillBatch` with `[]` → `BATCH_REJECTED` whose message mentions "at least one"; with 51 synthetic pairs → `BATCH_REJECTED` naming `50` and `51`; and that the `interact` zod dispatch (from `tools.ts`) rejects `operation: "fill"` given **both** `fields` and `selector`/`value`, and given **neither**. Use `HYPPO_BATCH_FILL_CAP` if needed to keep fixtures small (quickstart §1, §5).
- [x] T012 [US1] Create `tests/integration/batch-fill.spec.ts` with the US1 case (quickstart §2): load `form.html`, one `fillBatch(tabId, [["#first_name","Iuliia"],["#last_name","Iliukhina"],["#email","iuliia@example.com"],["#website","https://example.com"],["#age","12"]])` → `outcome: "permitted"`, `summary { requested: 5, written: 5, errored: 0 }`, five ordered `permitted` entries; `probe` each field holds its value; `window.__submitted === false`; tab URL unchanged; interaction log grew by 6 lines (5 `fill` `permitted` + 1 `fill_batch` `permitted` with `batch.written === 5`). Add the SC-007 duplicate-selector case: `[["#first_name","A"],["#first_name","B"]]` → `#first_name` reads `"B"`.

**Checkpoint**: US1 fully functional — one call drafts a whole form, audited, nothing submitted. MVP demoable if US2 also done.

---

## Phase 4: User Story 2 - A batch with a forbidden target is refused whole (Priority: P1)

**Goal**: Any forbidden or unresolved target in the batch refuses the whole call before any write; the refusal names every offender.

**Independent Test**: `fillBatch` with four plain pairs + `#password` + `#resume` → `BATCH_REJECTED`; `targets` lists both `#password` (`credential-field`) and `#resume` (`unsafe-fill-type`); probe shows the four plain fields unchanged; log grew by 3 lines (2 `fill` `refused` + 1 `fill_batch` `refused`), no `permitted` field line.

- [x] T013 [US2] In `src/main/page/interact.ts` `fillBatch`, complete the pre-write pass: collect **every** offender from `resolveFillTarget` (not just the first). If any offender exists, append one `{ operation: "fill", target: selector, outcome: "refused", ruleId?, error: reason? }` audit entry per offender, then one `{ operation: "fill_batch", target: null, outcome: "refused", batch: { requested, written: 0, errored: 0, refused: offenders.length } }` summary entry, and throw `HyppoError("BATCH_REJECTED", "N target(s) refused; no fields were written.", { targets })`. **Zero** `fillScript` calls in this path (FR-005, FR-014; data-model.md §6 table row 3).
- [x] T014 [US2] Extend `tests/unit/batch-fill.test.ts`: assert `resolveFillTarget` returns an `offender` for a `credential-field` descriptor, an `unsafe-fill-type` descriptor (`<select>` / `<input type="file">` / checkbox), and an unresolved selector, and `ok` for a plain text descriptor — matching the verdicts `matchBlocklist` + `isSafeFillTarget` give a single `fill` (quickstart §1, SC-003).
- [x] T015 [US2] Extend `tests/integration/batch-fill.spec.ts` with the US2 cases (quickstart §3): batch `[["#first_name","Iuliia"],["#password","hunter2"],["#email","x@y.co"],["#resume","cv"]]` → `code: "BATCH_REJECTED"`, `targets` names both `#password` (`credential-field`) and `#resume` (`unsafe-fill-type`); `probe` `#first_name` / `#email` still empty; log grew by 3 lines (2 `fill` `refused` with `ruleId` + 1 `fill_batch` `refused`), no `permitted` line. Add: a batch containing `#submitBtn` → `targets` names it with `submit-control`; a batch containing `#agree` → `consent-toggle`; a batch containing an unresolved selector → `targets` entry with a "no element matches" reason and nothing written.

**Checkpoint**: US1 + US2 both pass independently — MVP complete.

---

## Phase 5: User Story 3 - A field that fails mid-write is reported, not fatal (Priority: P2)

**Goal**: After a passing pre-write check, a single field whose element vanished before its write is marked `error`; the rest still fill; batch outcome is `partial`.

**Independent Test**: batch of five pairs that all pass the pre-write check, fixture removes `#phone` on `#email` input → four `permitted`, `#phone` `error`, batch `outcome: "partial"`, `summary { requested: 5, written: 4, errored: 1 }`.

- [x] T016 [US3] In `src/main/page/interact.ts` `fillBatch`, make the write pass best-effort: wrap each `fillScript(selector, value)` in try/catch. Success → `BatchFieldResult { selector, outcome: "permitted" }` + one `{ operation: "fill", target: selector, outcome: "permitted" }` audit entry. Throw → `BatchFieldResult { selector, outcome: "error", message: reason }` + one `{ operation: "fill", target: selector, outcome: "error", error: reason }` audit entry, and **continue** with remaining pairs (FR-008). Batch `outcome`: `"permitted"` iff `errored === 0`, else `"partial"`; the `fill_batch` summary entry carries `outcome` and `batch: { requested, written, errored, refused: 0 }` (data-model.md §6 table rows 1–2).
- [x] T017 [US3] Extend `tests/integration/batch-fill.spec.ts` with the US3 case (quickstart §4): batch `[["#first_name","A"],["#email","a@b.co"],["#phone","555"],["#website","https://z.co"],["#age","9"]]` → `outcome: "partial"`, `summary { requested: 5, written: 4, errored: 1 }`, `#phone` entry is `{ outcome: "error", message: … }`, other four `permitted`; probe the four → filled; `window.__submitted === false`; log: 4 `fill` `permitted` + 1 `fill` `error` + 1 `fill_batch` `partial` with `batch.errored === 1`.

**Checkpoint**: US1–US3 independently functional.

---

## Phase 6: User Story 4 - An oversized or empty batch is refused (Priority: P3)

**Goal**: A batch over the cap, or with zero pairs, is refused with a clear message and nothing written.

**Independent Test**: `fillBatch(tabId, [])` → `BATCH_REJECTED` "at least one"; `fillBatch(tabId, <cap+1 pairs>)` → `BATCH_REJECTED` naming the cap and the count; no field changed; one `fill_batch` `refused` audit line, no `targets`.

- [x] T018 [US4] Verify/confirm the cap and empty guards from T008 emit the exact messages FR-003 requires (cap + count for oversized; "no fields" reason for empty) and append exactly one `{ operation: "fill_batch", target: null, outcome: "refused", batch: { requested, written: 0, errored: 0, refused: 0 } }` entry with **no** `targets` (data-model.md §6 table row 4). Adjust the message strings in `fillBatch` if they do not already match.
- [x] T019 [US4] Extend `tests/integration/batch-fill.spec.ts` with the US4 cases (quickstart §5): `fillBatch(tabId, [])` → `BATCH_REJECTED` "at least one", log grew by 1 `fill_batch` `refused`, no field changed; with `HYPPO_BATCH_FILL_CAP=3` in the test env, a 4-pair batch → `BATCH_REJECTED` naming `3` / `4`, nothing written.

**Checkpoint**: All four user stories pass independently.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T020 [P] Update the `interact` tool description in `src/main/mcp/tools.ts` per FR-015: document the batch form of `fill` (ordered `(target, value)` list applied in one call), whole-batch refusal when any target is forbidden or unresolved, best-effort completion for write-time errors, and the 50-pair cap.
- [x] T021 [P] Update `README.md`: in the "What the app will not do" / interaction section, note the batch form of `fill` if operations are enumerated there; confirm the batch adds no new permission.
- [x] T022 Run the full gate from quickstart §7: `npm run build`, `npm run lint`, `npm run test`, `npm run test:e2e` — all clean. Spot-check new `interaction-log.jsonl` lines: `target` is a selector or `null`, never page text; every batch has exactly one `fill_batch` line.
- [x] T023 Walk quickstart.md §1–§6 end to end against the built app and confirm each "Expected" holds; mark this feature's `checklists/requirements.md` items still satisfied.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup. **Blocks all user stories.** T006 (extract `resolveFillTarget`) must precede any `fillBatch` work; T007 gates on T006.
- **US1 (Phase 3)**: depends on Phase 2. Delivers `fillBatch` skeleton + happy path + MCP dispatch.
- **US2 (Phase 4)**: depends on US1 (extends `fillBatch` pre-write pass and the same test files). Same-file with US1 on `interact.ts` and `batch-fill.spec.ts` → sequential after US1.
- **US3 (Phase 5)**: depends on US1 (extends `fillBatch` write pass). Independent of US2 in logic but same file → run after US2.
- **US4 (Phase 6)**: mostly verification of guards written in T008; depends on US1.
- **Polish (Phase 7)**: after all targeted stories.

### Within Each User Story

- Tests and implementation for a story are in the same phase; the integration spec is extended incrementally (T012 → T015 → T017 → T019).
- `src/main/page/interact.ts` is touched by T006, T008, T013, T016 — strictly sequential, never `[P]`.
- `tests/integration/batch-fill.spec.ts` is touched by T012, T015, T017, T019 — strictly sequential.

### Parallel Opportunities

- **Phase 1**: T001 and T002 in parallel (different files).
- **Phase 2**: T003, T004, T005 in parallel (T003/T004 both edit `types.ts` — do T003 then T004, or one commit; T005 is `errors.ts`, fully parallel). T006 after, T007 after T006.
- **Phase 3**: T010 (`index.ts`) and T011 (`batch-fill.test.ts`) in parallel with each other once T008 lands; T009 (`tools.ts`) parallel with T010/T011.
- **Phase 7**: T020 and T021 in parallel (different files); T022 then T023.

---

## Parallel Example: Phase 2 Foundational

```bash
# After Setup, launch the independent type/error edits together:
Task: "Add BatchFill* types in src/shared/types.ts"          # T003
Task: "Add BATCH_REJECTED + targets in src/main/errors.ts"   # T005
# then:
Task: "Extend InteractionLogEntry in src/shared/types.ts"    # T004  (same file as T003)
Task: "Extract resolveFillTarget in src/main/page/interact.ts" # T006
```

---

## Implementation Strategy

### MVP (US1 + US2 — both P1)

1. Phase 1 Setup → Phase 2 Foundational (T001–T007).
2. Phase 3 US1 (T008–T012) — one call drafts a form.
3. Phase 4 US2 (T013–T015) — a forbidden target refuses the whole batch.
4. **STOP and VALIDATE**: quickstart §2 and §3 pass; `build` + `test` + `test:e2e` clean.

### Incremental Delivery

- MVP (US1+US2) → demo: batch fill with whole-batch safety.
- + US3 (T016–T017) → resilience to mid-write DOM changes.
- + US4 (T018–T019) → cap/empty guard rails.
- + Polish (T020–T023) → docs + full gate.

---

## Notes

- No constitution amendment (FR-017). No new MCP tool, no new operation value — `fill` gains an optional `fields` param.
- No `.specify/extensions.yml` → no Spec Kit hooks run for this feature.
- Commit after each phase or logical group. Keep `interaction-log.jsonl` entries plain JSONL; `target` is a selector or `null`, never page text.
