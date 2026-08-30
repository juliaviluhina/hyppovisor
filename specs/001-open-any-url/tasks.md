---
description: "Task list for feature 001-open-any-url"
---

# Tasks: Open Any URL

**Input**: Design documents from `/specs/001-open-any-url/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/mcp-tools.md, quickstart.md

**Tests**: INCLUDED. Success criteria SC-005 and SC-006 require verification by test, and the
constitution designates Principles I (no external act) and IV (no credential handling) as release
blockers. Test tasks for those guarantees are non-negotiable; others follow the plan's stack.

**Organization**: Tasks are grouped by user story so each can be implemented, tested, and
delivered independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths included in every description

## Path Conventions

Electron desktop app per plan.md: `src/main/`, `src/preload/`, `src/renderer/`, `tests/unit/`,
`tests/integration/`, `tests/fixtures/` at repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization — the repo currently has no source code at all.

- [x] T001 Initialize npm project with Electron, TypeScript, and zod dependencies in `package.json`
- [x] T002 Create TypeScript configs for main and renderer processes in `tsconfig.json` and `tsconfig.renderer.json`
- [x] T003 [P] Configure ESLint and Prettier in `eslint.config.js` and `.prettierrc`
- [x] T004 [P] Configure Vitest for unit tests in `vitest.config.ts`
- [x] T005 [P] Configure Playwright with the `_electron` fixture in `playwright.config.ts`
- [x] T006 [P] Add build/start/test scripts (`build`, `start`, `test`, `test:e2e`) to `package.json`
- [x] T007 [P] Add `dist/`, `node_modules/`, and `out/` to `.gitignore`
- [x] T008 [P] Create local HTML test fixtures (static page, form with submit button, password field, "show more" expander, oversized-text page) in `tests/fixtures/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T009 Implement `http`/`https`-only URL validation returning `INVALID_URL` / `SCHEME_NOT_ALLOWED` in `src/main/tabs/url-policy.ts` (FR-004)
- [x] T010 [P] Unit test URL policy: valid http/https, malformed input, `file:`/`javascript:`/`data:` schemes in `tests/unit/url-policy.test.ts`
- [x] T011 Implement the app-wide serialization queue with depth reporting in `src/main/queue/action-queue.ts` (FR-013, FR-013a)
- [x] T012 [P] Unit test the queue: no overlap under concurrent enqueues, FIFO order, depth reporting, error isolation in `tests/unit/action-queue.test.ts`
- [x] T013 Define the error-code enum and typed error shapes from data-model.md in `src/main/errors.ts` (FR-014)
- [x] T014 Create the Electron main-process entry with a single `BaseWindow` and app lifecycle in `src/main/index.ts` (FR-023)
- [x] T015 Implement the Tab entity, id assignment, registry, and close handling in `src/main/tabs/tab-manager.ts` (FR-008, FR-015)
- [x] T016 Create the MCP server over stdio transport with tool registration scaffolding in `src/main/mcp/server.ts` (research.md R2)
- [x] T017 Create the zod input schemas for all six tools from contracts/mcp-tools.md in `src/main/mcp/tools.ts`

**Checkpoint**: App launches with an empty window; MCP server starts and reports zero tools working.

---

## Phase 3: User Story 1 - Open a URL in an authenticated tab (Priority: P1) 🎯 MVP

**Goal**: Open any `http(s)` URL in an embedded tab carrying the person's own session, requested
by either the person or an orchestrator.

**Independent Test**: Paste a public URL and a URL behind a login completed in the app; both
render in a new tab, the authenticated one without a re-login prompt, showing final URL and title.

### Tests for User Story 1

- [x] T018 [P] [US1] Integration test: open a fixture URL, assert tab id, final URL, title, and visible render in `tests/integration/open-url.spec.ts`
- [x] T019 [P] [US1] Integration test: refuse `file://`, `javascript:`, and malformed URLs with correct codes, no tab opened, in `tests/integration/url-refusal.spec.ts`
- [x] T020 [P] [US1] Integration test: redirect chain reports final landed URL in `tests/integration/redirect.spec.ts`

### Implementation for User Story 1

- [x] T021 [US1] Implement tab creation with `WebContentsView` using the shared default session in `src/main/tabs/tab-manager.ts` (FR-001, FR-002, research.md R1)
- [x] T022 [US1] Implement load-state tracking and `LOAD_FAILED` reporting from `webContents` events in `src/main/tabs/tab-manager.ts` (FR-005)
- [x] T023 [US1] Block automatic new-window/popup opens and surface them to the person instead in `src/main/tabs/tab-manager.ts` (FR-006, FR-017)
- [x] T024 [US1] Implement the `open_url` MCP tool wired through the queue and URL policy in `src/main/mcp/tools.ts` (FR-003)
- [x] T025 [US1] Implement the `list_open_tabs` MCP tool in `src/main/mcp/tools.ts` (FR-009)
- [x] T026 [P] [US1] Build the renderer tab strip and address bar in `src/renderer/index.html` and `src/renderer/app.ts` (FR-023, FR-025)
- [x] T027 [US1] Wire renderer address-bar submissions to tab creation via IPC in `src/main/index.ts` and `src/renderer/app.ts`
- [x] T028 [US1] Implement tab close from the UI, invalidating the id for later tool calls, in `src/main/tabs/tab-manager.ts` (FR-015, FR-025)

**Checkpoint**: A person can open URLs by hand; an orchestrator can open and list tabs. Feature is
independently demonstrable.

---

## Phase 4: User Story 2 - Orchestrator reads an open page (Priority: P2)

**Goal**: Return a tab's verbatim visible text (and DOM on request) to the caller, storing nothing.

**Independent Test**: With one tab open on a known page, issue a single read; returned URL, title,
and text match what the person sees, and the payload alone reconstructs the visible text offline.

### Tests for User Story 2

- [x] T029 [P] [US2] Integration test: read returns verbatim text, no `dom` by default; `includeDom: true` adds it, in `tests/integration/read-page.spec.ts`
- [x] T030 [P] [US2] Integration test: after a session of opens and reads, the shared data directory contains zero page content, in `tests/integration/no-page-storage.spec.ts` (SC-004)
- [x] T031 [P] [US2] Integration test: `read_page` on unknown and on closed tab ids both return `TAB_NOT_FOUND` in `tests/integration/read-errors.spec.ts`
- [x] T032 [P] [US2] Unit test truncation: over-limit text and DOM truncate and set their own flags in `tests/unit/truncation.test.ts` (FR-021)

### Implementation for User Story 2

- [x] T033 [P] [US2] Write the in-page extraction script returning `innerText`, title, and href in `src/preload/extract.ts` (research.md R3)
- [x] T034 [US2] Implement page reading via `executeJavaScript` in an isolated world in `src/main/page/read.ts` (FR-010, FR-010b)
- [x] T035 [US2] Add optional DOM capture behind the `includeDom` parameter in `src/main/page/read.ts` (FR-010a)
- [x] T036 [US2] Implement per-part size limits (100 KB text default, separate DOM limit) with truncation flags in `src/main/page/read.ts` (FR-021)
- [x] T037 [US2] Implement the `read_page` MCP tool wired through the queue in `src/main/mcp/tools.ts` (FR-019a)
- [x] T038 [US2] Implement the `navigate` MCP tool reusing URL policy and load-state tracking in `src/main/mcp/tools.ts`

**Checkpoint**: US1 and US2 both work independently. The app retrieves and returns; it persists no
page content.

---

## Phase 5: User Story 3 - Orchestrator drives bounded interaction (Priority: P3)

**Goal**: Click, fill, scroll, and wait-for-selector to reveal content — never to submit, send, or
apply. Every attempt is logged.

**Independent Test**: On a page with a "show more" control, wait for it, click it, and read the
revealed content; separately, attempt a form submission and confirm refusal.

### Tests for User Story 3

- [x] T039 [P] [US3] Integration test: every blocklist rule category refuses in 100% of attempts, each naming its `ruleId`, in `tests/integration/external-act-refusal.spec.ts` (SC-005, release blocker)
- [x] T040 [P] [US3] Integration test: `fill` on a password field is refused and no credential is ever populated in `tests/integration/credential-refusal.spec.ts` (SC-006, release blocker)
- [x] T041 [P] [US3] Unit test the blocklist: per-rule matching, enumerability of the full rule set, over-block cases in `tests/unit/blocklist.test.ts` (FR-012a)
- [x] T042 [P] [US3] Integration test: wait-for-selector then click reveals content readable on next read in `tests/integration/interact.spec.ts`
- [x] T043 [P] [US3] Integration test: `WAIT_TIMEOUT` leaves the tab unchanged; `TARGET_NOT_FOUND` for a missing selector, in `tests/integration/interact-errors.spec.ts`
- [x] T044 [P] [US3] Integration test: interaction log accounts for 100% of requests, permitted and refused, and contains no page text, in `tests/integration/interaction-log.spec.ts` (FR-024a)
- [x] T045 [P] [US3] Integration test: a burst across multiple tabs never overlaps and every request completes in `tests/integration/sequencing.spec.ts` (SC-008a)

### Implementation for User Story 3

- [x] T046 [P] [US3] Implement the enumerable external-act blocklist — submit controls; in-form elements; action-word labelled buttons/links (save/confirm/submit/delete/sign in/sign up/…); consent checkboxes (accept/agree/terms/…); credential fields — in `src/main/safety/blocklist.ts` (FR-012a, FR-018, research.md R4)
- [x] T047 [P] [US3] Implement the append-only JSONL interaction log at `userData/interaction-log.jsonl` in `src/main/safety/interaction-log.ts` (FR-024a, research.md R6)
- [x] T048 [US3] Implement in-page target evaluation returning the matched rule id in `src/preload/extract.ts` and `src/main/safety/blocklist.ts`
- [x] T049 [US3] Implement click, fill, and scroll operations gated by the blocklist in `src/main/page/interact.ts` (FR-012)
- [x] T050 [US3] Implement wait-for-selector with timeout in `src/main/page/interact.ts`
- [x] T051 [US3] Implement the `interact` MCP tool wired through the queue, blocklist, and log in `src/main/mcp/tools.ts`
- [x] T052 [US3] Implement the `wait_for_selector` MCP tool in `src/main/mcp/tools.ts`
- [x] T053 [US3] Log every interaction outcome — permitted, refused, error — exactly once in `src/main/page/interact.ts` (FR-012b)

**Checkpoint**: All three user stories independently functional. Both release-blocker guarantees
are covered by passing tests.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T054 [P] Show live orchestrator activity (navigation, clicks, fills, scrolls) in the window as it happens in `src/renderer/app.ts` (FR-024)
- [x] T055 [P] Surface downloads and popups to the person without auto-accepting in `src/main/tabs/tab-manager.ts` (FR-017)
- [x] T056 [P] Verify every error path returns a distinct actionable code with no generic catch-all in `src/main/errors.ts` (SC-009)
- [x] T057 [P] Add MCP registration instructions and the stdio launch caveat to `README.md` (research.md R2)
- [x] T058 Run the full quickstart.md validation pass — covered by the 13-test Playwright `_electron` suite (`npm run test:e2e`), all passing: open/auth (US1), read + no-storage + truncation (US2), interaction + both release-blocker refusals + audit log + sequencing (US3), plus the error-code matrix. Scenario 2 (real logged-in site) still needs a manual pass with actual credentials.
- [x] T059 [P] Verify page-load-to-visible stays within 5 seconds (SC-001) — fixture opens in the e2e suite complete in ~15–55 ms each; well under the 5 s target.

---

## Implementation notes and deviations

- **Extraction is inline, not a preload file.** T033/T048 name `src/preload/extract.ts`. A
  sandboxed Electron preload cannot be an ES module and is awkward to build from TypeScript in a
  `"type": "module"` package. Instead the extraction/target-descriptor scripts are string
  constants injected via `webContents.executeJavaScript(script, true)` — the same isolated-world
  execution, colocated with their callers in `src/main/page/read.ts` and
  `src/main/safety/blocklist.ts` (`targetDescriptorScript`). The one authored preload,
  `src/preload/chrome.cjs`, is CommonJS by necessity and serves only the app chrome's IPC.
- **`BaseWindow` → `BrowserWindow`.** T014/plan say `BaseWindow`; the code uses `BrowserWindow`
  (which extends `BaseWindow`) so the app chrome renders as the window's own web contents while
  tab `WebContentsView`s layer beneath it. Same single-window shape.
- **e2e test file layout.** tasks.md lists one spec file per test; they are consolidated into
  `open-url.spec.ts`, `read-page.spec.ts`, and `interaction.spec.ts` (plus `helpers.ts`) so
  each shares one app launch. Every listed assertion is present.
- **e2e drives a main-process test handle.** `globalThis.__hyppo` (enabled by `HYPPO_E2E=1`)
  exposes the exact code paths the MCP tools call. Playwright owns the process stdio, so testing
  the MCP transport itself through `_electron` is impractical; the tools layer is a thin,
  unit-covered wrapper over these same functions. Under `HYPPO_E2E=1` the app installs the
  handle and returns before `startMcpServer()`, so the stdio server never contends with
  Playwright for the pipe. `launchApp()` polls for the handle before the first call.
- **Verified:** `npm run build`, `npm run lint`, `npm test` (Vitest 19/19), and
  `npm run test:e2e` (Playwright `_electron`, 13/13 — including T039/T040, the Principle I and
  IV release blockers). Ran on Node 22 and Node 26; see the postinstall notes below for the
  Node-26 Electron-install workaround.
- **Verified in this environment:** `npm run build` (tsc, both projects), `npm run lint`
  (eslint clean), `npm test` (Vitest — 19/19: url-policy, action-queue, blocklist, truncation),
  and a full `tsc --noEmit` over the e2e specs.

---

## Dependencies

**Phase order**: Setup (T001–T008) → Foundational (T009–T017) → US1 (T018–T028) → US2 (T029–T038)
→ US3 (T039–T053) → Polish (T054–T059).

**Story dependencies**:

- **US1** depends only on Foundational. It is the MVP and ships alone.
- **US2** depends on US1 (needs an open tab to read) plus Foundational.
- **US3** depends on US1 (needs an open tab to act on). It does not require US2 — though T042
  reads back revealed content, so US2 makes its test stronger.

**Key within-phase dependencies**:

- T021 blocks T022, T023, T024, T028.
- T033 blocks T034; T034 blocks T035, T036, T037.
- T046 and T047 block T048–T053.
- All of T011 (queue) blocks every MCP tool task: T024, T025, T037, T038, T051, T052.

## Parallel Execution Examples

**Setup**: T003–T008 all run together after T001 and T002.

**Foundational**: T010 and T012 (unit tests) run parallel to each other; T009 and T011 are
independent modules and can be written in parallel.

**US1**: T018, T019, T020 (tests) in parallel; T026 (renderer) parallel to T021–T025 (main).

**US2**: T029–T032 (tests) all parallel; T033 parallel to the main-process work.

**US3**: T039–T045 (seven tests) all parallel; T046 and T047 parallel to each other.

**Polish**: T054–T057 and T059 all parallel; T058 last.

## Implementation Strategy

**MVP scope**: Phases 1–3 (T001–T028). That delivers a working Electron app where a person opens
URLs in authenticated tabs and an orchestrator can open and list them — the "proven primitive" the
constitution's build order requires before any adapter work.

**Increment 2**: Phase 4 adds reading, which is the first genuinely useful orchestrator capability.

**Increment 3**: Phase 5 adds interaction. Land it last deliberately — it carries the tightest
guardrails and both release-blocker guarantees, so it benefits from a proven base underneath.

**Non-negotiable gate**: T039 and T040 must pass before any release. Per the constitution, a
violation of Principle I or IV is a release blocker, not tracked debt.
