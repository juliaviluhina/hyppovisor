---
description: "Task list for feature 016 — Read Page Selector Scoping"
---

# Tasks: Read Page Selector Scoping

**Input**: Design documents from `/specs/016-read-page-selector-scoping/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED. The repo gates every PR on the five constitution principles and on
`npm run test` + `npm run test:e2e` (quickstart.md names the specs that must pass). Test
tasks are therefore first-class here, matching feature 015's precedent.

**Organization**: by user story. Note the real coupling — all three stories land in the same
`read.ts` selector-resolution change (US1 is the mechanism; US2 is "don't break the no-selector
path," provable only once US1 exists; US3's `scopedTo` field is set by the same code path as
US1). Each story still gets its own dedicated test task so it stays independently verifiable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different file, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 — omitted for Setup, Foundational, Polish

## Path Conventions

Single-project Electron app: `src/{shared,main,preload,renderer}/`, `tests/{unit,integration}/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: nothing to scaffold — the feature edits existing files in an established
project, reusing `src/main/page/selector-syntax.ts` as-is. This phase only confirms a clean
baseline.

- [X] T001 Confirm a clean build and green baseline: `npm run build && npm run lint && npm run test` all pass on `016-read-page-selector-scoping` before any change.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the one shared shape change every story's assertions depend on. See
data-model.md.

**⚠️ CRITICAL**: no user-story work starts until Phase 2 is complete.

- [X] T002 Add `scopedTo?: string` to the `PageReadResult` interface in `src/shared/types.ts` (after `queueDepth`), per data-model.md. Present only when a selector scoped the read.

**Checkpoint**: the result type can carry a scoping indicator; no behavior changed yet.

---

## Phase 3: User Story 1 - Scope a read to one part of the page (Priority: P1) 🎯 MVP

**Goal**: `read_page` accepts an optional `selector`; when supplied, both `text` and (if
`includeDom` is also requested) `dom` narrow to the first matching element's subtree instead
of the full page — invalid CSS and no-match both fail with distinct, existing error codes.

**Independent Test**: open `tests/fixtures/chat-shell-repro.html`, click `#advance` several
times to grow `#chat-log`, then `read_page({ tabId, selector: "#detail-pane" })` — the result
contains only `"Turn N"`, never any chat-log content, regardless of prior growth.

### Tests for User Story 1

> **NOTE**: Write these first, confirm they FAIL (or don't compile) before implementation.

- [X] T003 [P] [US1] Add `tests/unit/read-page-selector.test.ts`: unit-test a new pure exported builder `readPageScript(selector: string | undefined): string` from `src/main/page/read.ts` (mirrors `formFieldsScript`'s testability, research.md R1) — assert it embeds the selector via `JSON.stringify` (safe against quotes/backslashes in the selector string), and that `readPageScript(undefined)` is textually equivalent to today's unscoped `READ_SCRIPT` (same `document.body.innerText` / `document.documentElement.outerHTML` fallback). Expect FAIL until T005.
- [X] T004 [P] [US1] Extend `tests/integration/read-page.spec.ts` with the **US1** cases against `tests/fixtures/chat-shell-repro.html` (serve it via the existing `startFixtureServer` helper, same pattern as `static.html`): (a) click `#advance` 3×, `read({ tabId }, false, "#detail-pane")` → `text === "Turn 4"` exactly (no `"Chat line"` substring); (b) a selector matching two elements (add a second matching node to the fixture only if needed, or use an existing multi-match case) uses the first match, document order; (c) `selector: "???"` rejects with a message containing `INVALID_SELECTOR`; (d) `selector: "#does-not-exist"` rejects with a message containing `TARGET_NOT_FOUND`; (e) `read({ tabId }, true, "#detail-pane")` → `dom` contains `id="detail-pane"` and does NOT contain `id="chat-log"` (FR-010, US1 scenario 5). Expect FAIL until T005–T007.

### Implementation for User Story 1

- [X] T005 [US1] In `src/main/page/read.ts`: import `SELECTOR_SYNTAX_HELPER`, `assertSelectorValid`, `isInvalidSelectorMarker` from `./selector-syntax.js` (research.md R1). Replace the fixed `READ_SCRIPT` string with an exported `readPageScript(selector: string | undefined): string` builder, mirroring `form-fields.ts`'s `formFieldsScript` shape: when `selector` is `undefined`, emit the exact current script body (`document.body.innerText` / `document.documentElement.outerHTML`); when defined, prepend `SELECTOR_SYNTAX_HELPER`, resolve `const el = __querySafe(document, ${JSON.stringify(selector)})`, return `{ __invalidSelector: true }` on catch (matching the `selector-syntax.ts` contract), otherwise return `{ notFound: true }` when `el` is null, else `{ url, title, text: el.innerText, dom: el.outerHTML }`.
- [X] T006 [US1] In `src/main/page/read.ts`, update `readPage(wc, tabId, includeDom, queueDepth, selector?: string)`: call `wc.executeJavaScript(readPageScript(selector), true)`; call `assertSelectorValid(raw)` before interpreting the result (throws `INVALID_SELECTOR`, research.md R1/R2); when `selector` was supplied and the raw result signals not-found, throw `new HyppoError("TARGET_NOT_FOUND", \`No element matches selector ${JSON.stringify(selector)}.\`)` (reuses the existing error code, research.md R2); otherwise proceed exactly as today (`truncateToBytes` on `text`/`dom`, same `truncated` shape, research.md R5) and set `result.scopedTo = selector` only when `selector` was supplied (FR-006/FR-007).
- [X] T007 [US1] In `src/main/mcp/tools.ts`, add `selector: z.string().optional().describe("CSS selector to scope the read to one element's subtree")` to the `read_page` tool's input schema, and pass it through to `readPage(wc, tabId, includeDom, depth, selector)`. Update the tool's description to mention scoping in one clause.
- [X] T008 [US1] In `src/main/index.ts`, update the `__hyppo.read` e2e test handle to `read: (tabId: string, includeDom = false, selector?: string) => …` forwarding to `readPage(tabs.webContentsFor(tabId), tabId, includeDom, d, selector)` (contracts/read-page-selector.md, Test hooks).
- [X] T009 [US1] Run T003 and T004 green; `npm run lint`.

**Checkpoint**: US1 is fully functional and independently testable — selector scoping works for text and DOM, with correct error codes. This is a shippable MVP.

---

## Phase 4: User Story 2 - Full-page reads remain unchanged by default (Priority: P1)

**Goal**: prove the compatibility guarantee — every existing caller that never passes
`selector` sees byte-for-byte identical behavior to before this feature (FR-002, SC-002).

**Independent Test**: read the same fixture page without a selector, before and after; same
full-body text, same truncation behavior, same fields, no `scopedTo`.

### Tests for User Story 2

- [X] T010 [P] [US2] Add the **US2** regression cases to `tests/integration/read-page.spec.ts`: (a) on `chat-shell-repro.html`, `read({ tabId })` with no `selector` after several `#advance` clicks returns text containing every `"Chat line N"` seen so far plus the latest `"Turn N"` (the full, un-narrowed shell — confirms nothing was accidentally scoped by default); (b) that same unscoped result has no `scopedTo` key at all (not `undefined`-but-present — actually absent); (c) re-run the existing `read-page.spec.ts` T029/T030/T031/T032 cases (verbatim text, no DOM by default, nothing persisted, `TAB_NOT_FOUND`, truncation) unmodified and confirm they still pass untouched, proving the new optional parameter didn't perturb any existing path. Expect this file to already be green after T005–T008 (this phase is a proof task, not new production code) — if red, treat as a defect in T005/T006 to fix before continuing.

### Implementation for User Story 2

- [X] T011 [US2] No new production code expected — this story validates T005/T006's `selector === undefined` branch is truly a no-op vs. today's behavior. If T010 finds any deviation (e.g. an extra key, a different truncation outcome), fix it in `src/main/page/read.ts` here. **No deviation found** — T010 and the pre-existing T029–T032 cases all pass unmodified; no fix needed.

**Checkpoint**: US1 + US2 both verified — scoping works, and the unscoped path is provably untouched.

---

## Phase 5: User Story 3 - Caller can tell a scoped read apart from a full-page read (Priority: P2)

**Goal**: a scoped result is self-describing (`scopedTo` present with the selector used); an
unscoped result carries no such field, so nothing is ever mistaken for the other (FR-006,
FR-007, SC-003).

**Independent Test**: perform a scoped read and inspect the result for `scopedTo`; perform an
unscoped read and confirm its absence.

### Tests for User Story 3

- [X] T012 [P] [US3] Add the **US3** cases to `tests/integration/read-page.spec.ts`: (a) `read({ tabId }, false, "#detail-pane")` → result has `scopedTo === "#detail-pane"` (the selector as supplied, not normalized — data-model.md); (b) confirm (re-asserting T010b from the other direction) an unscoped `read({ tabId })` result has no `scopedTo` property via `expect("scopedTo" in result).toBe(false)`. Expect green already after T005–T008 — this is a proof task like Phase 4.

### Implementation for User Story 3

- [X] T013 [US3] No new production code expected — `scopedTo` was already set in T006. If T012 finds any deviation, fix it in `src/main/page/read.ts` here. **No deviation found** — T012 passes as written.

**Checkpoint**: all three user stories independently functional and verified.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T014 [P] Update `specs/001-open-any-url/contracts/mcp-tools.md` (the canonical living MCP contract doc `tools.ts`'s header comment points at, already kept current by later features like `read_form_fields`'s `containerSelector`) to document `selector` / `scopedTo` / the two new possible errors on `read_page`.
- [ ] T015 Run the full `quickstart.md` manual walkthrough (steps 1–7) against `npm start`. **Not run by the implementing agent — needs a human at a display.** The automated integration tests (T004, T010, T012) cover the same paths headlessly and are green (see T016).
- [X] T016 Full green gate: `npm run build && npm run lint && npm run test && npm run test:e2e`. 330/330 unit, 147/147 e2e, clean build + lint.
- [ ] T017 In the PR description, call out for the Principle V review gate: this adds an opt-in-only narrowing lever to `read_page` (selector omitted ⇒ unchanged behavior, FR-002) with a self-describing `scopedTo` field on scoped results (FR-006/FR-007) — per plan.md's Constitution Check, citing `specs/issues/007-read-page-selector-scoping.md`'s Principle V note. **Pending — no PR opened yet;** copy the note above into the PR body when it is raised.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately.
- **Foundational (Phase 2)**: after Setup. **Blocks US1, US2, US3** (all three assert against the `scopedTo` field T002 adds).
- **US1 (Phase 3)**: after Phase 2. Carries all the real production code.
- **US2 (Phase 4)**: after US1 (Phase 3) — it proves a property of US1's implementation; there is no independent code to write first.
- **US3 (Phase 5)**: after US1 (Phase 3) — same reason; proves another property of the same implementation.
- **Polish (Phase 6)**: after US1–US3.

### Story Independence & the shared-file constraint

- `src/main/page/read.ts` is edited by T005–T006 (US1) only; T011/T013 (US2/US3) touch it
  only if a regression is found. Sequential by construction — one file, one story's worth of
  real change.
- `tests/integration/read-page.spec.ts` is extended by T004 (US1), then T010 (US2), then T012
  (US3) — sequential appends to one file, same pattern as feature 015's shared spec file.
- `src/main/mcp/tools.ts` and `src/main/index.ts`: touched once each, by T007/T008 (US1) only.

Despite the `[US2]` / `[US3]` labels, this feature's real engineering work is entirely in
Phase 3 (US1); Phases 4–5 are verification-and-fix phases proving FR-002/FR-006/FR-007 hold,
kept as separate phases only so each user story remains independently checkable per Spec Kit
convention.

### Within Each User Story

- Write the story's test task first; confirm it fails (or is a no-op check for US2/US3);
  then implement (US1 only); then re-run green.

### Parallel Opportunities

- T003 (unit test) and T004 (integration test) are `[P]` — different files.
- T010 and T012 are `[P]` relative to each other in principle (different assertions), but
  both append to `read-page.spec.ts`, so land T004 → T010 → T012 in that order in practice.
- T014 (docs, if applicable) is independent of the test/verification tasks.

---

## Parallel Example: User Story 1

```bash
# Launch both US1 test tasks together (different files):
Task: "Add tests/unit/read-page-selector.test.ts for readPageScript()"
Task: "Extend tests/integration/read-page.spec.ts with US1 scoping cases"
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 (T001) → Phase 2 (T002) → Phase 3 (T003–T009).
2. **STOP and validate**: selector scoping works end-to-end against the fixture; error codes
   are correct; DOM scoping is consistent with text scoping. Shippable on its own — US2/US3
   are verification of properties this MVP already has.

### Incremental delivery

1. Foundational → `scopedTo` field exists on the type.
2. + US1 → selector scoping works (MVP).
3. + US2 → proven the unscoped path is untouched.
4. + US3 → proven `scopedTo` is present/absent correctly.
5. Polish → docs (if any) + full gate + PR review-gate note.

---

## Notes

- `[P]` = different file, no dependency on an incomplete task.
- No new error code, no new module, no constitution amendment — reuses
  `selector-syntax.ts`, `INVALID_SELECTOR`, and `TARGET_NOT_FOUND` verbatim (research.md
  R1/R2).
- Commit after each task or logical group; repo convention is `feat(016): …` /
  `test(016): …` prefixes (see `commit-message` skill).
- `specs/issues/008-read-page-dom-noise-reduction.md` (deferred follow-on) is out of scope
  for every task above.
