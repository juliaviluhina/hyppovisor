---
description: "Task list for feature 002 — Unwrap Link-Shim URLs"
---

# Tasks: Unwrap Link-Shim URLs

**Input**: Design documents from `specs/002-unwrap-link-shims/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/mcp-tools-002-delta.md](./contracts/mcp-tools-002-delta.md),
[quickstart.md](./quickstart.md)

**Tests**: included — SC-006 / SC-007 explicitly require a per-table-entry unit test and an
offline purity test; every other SC is a verifiable check. Write each test task first and
see it fail before the matching implementation task.

**Organization**: by user story. US1 (P1) is the MVP and carries the whole `unwrapUrl`
implementation; US2 (P1) and US3 (P2) are guard + hardening coverage on top of it — mostly
test tasks. No constitution amendment (unlike feature 011).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different file, no dependency on an incomplete task — may run in parallel
- Paths are repo-relative; single-project layout (`src/`, `tests/`)

---

## Phase 1: Setup

- [ ] T001 Confirm branch `002-unwrap-link-shims`, run `npm ci`, then `npm run build && npm run lint && npm test && npm run test:e2e`; record the baseline pass counts in this file (note any pre-existing `connection-panel.spec.ts` port-collision failures so they are not attributed to this feature)

---

## Phase 2: Foundational (the pipe, connected end to end)

**Purpose**: create the module and thread it into `TabManager` so every caller resolves
URLs identically. `unwrapUrl`'s matching loop is built here; the story phases add the
scheme guard, the audit entry, and coverage.

- [ ] T002 [P] Create `src/main/tabs/unwrap-url.ts`: the `ShimRule` interface (`id`, `hostMatch(host): boolean`, `pathPrefix`, `param`), `SHIM_RULES: readonly ShimRule[]` with all five rows from data-model.md §ShimRule (LinkedIn, Google + the curated `www.google.<tld>` set from research R3, Facebook `l.`/`lm.`, Reddit `out.reddit.com`, Outlook `*.safelinks.protection.outlook.com`), and `listShimRules(): Array<{ id; pathPrefix; param }>`. No Electron import — pure, like `url-policy.ts`.
- [ ] T003 [P] Add `unwrap?: { hops: number }` to `InteractionLogEntry` in `src/shared/types.ts`, with a doc comment: "Set only on an `operation: "unwrap"` entry (feature 002)."
- [ ] T004 In `src/main/tabs/unwrap-url.ts`, implement `unwrapUrl(raw: string): { url: string; hops: number; wrapper?: string }` — the match/decode loop: parse with `new URL`; for each `SHIM_RULES` row test `hostMatch(url.host.toLowerCase())` and the path prefix (`pathname === prefix || pathname.startsWith(prefix)`; `"/"` matches any); on a match read `searchParams.get(param)`, and if it is a non-empty absolute `http(s)` URL, set it as the current URL and iterate. Never throws (any parse failure / miss → return the current URL). Depth cap and non-`http(s)` handling are finalised in US1/US3.
- [ ] T005 Thread the log into `TabManager`: add `private readonly log: InteractionLog` as the third constructor param in `src/main/tabs/tab-manager.ts`; update `new TabManager(win, { … })` in `src/main/index.ts` to `new TabManager(win, { … }, log)` (the `log` instance already exists at `index.ts:84`).
- [ ] T006 In `src/main/tabs/tab-manager.ts`, call `unwrapUrl(rawUrl)` as the first statement of `open()` and `navigate()` — before `validateUrl` — and pass its `.url` onward. (No audit write yet; that lands in US1 T010.)

**Checkpoint**: `npm run build` green; existing `open-url.spec.ts` still passes (unwrap is a
no-op for non-shim URLs by construction).

---

## Phase 3: User Story 1 — Reach the destination behind a link shim (Priority: P1) 🎯 MVP

**Goal**: `open_url` / `navigate` given a known shim URL open its stated `http(s)`
destination directly, with one `operation: "unwrap"` audit entry.

**Independent Test**: `open_url` with
`https://www.linkedin.com/safety/go/?url=<encoded local fixture>` → the returned `url` is
the fixture, `read_page` shows the fixture, and the interaction log's last line is an
`unwrap` entry naming both URLs.

### Tests for User Story 1

- [ ] T007 [P] [US1] Unit `tests/unit/unwrap-url.test.ts`: for **each** of the five `SHIM_RULES` ids, a wrapper whose `param` encodes `https://example.test/job/123` → `unwrapUrl` returns `{ url: "https://example.test/job/123", hops: 1 }` (offline, no Electron — SC-006, SC-007); plus `listShimRules()` returns five rows each with non-empty `id` / `pathPrefix` / `param`; plus the Google-variant cases from research R3 (`www.google.co.uk`, bare `google.com` unwrap; `www.google.evil` does not)
- [ ] T008 [US1] Integration `tests/integration/open-url.spec.ts`: `open` with `https://www.linkedin.com/safety/go/?url=${encodeURIComponent(`${base}/static.html`)}` → returned `url` is `${base}/static.html` and `read_page` shows the fixture text (SC-001, no second call); then `navigate` an existing tab with a Google `https://www.google.com/url?q=${enc}` wrapper → tab ends on the fixture
- [ ] T009 [US1] Integration `tests/integration/open-url.spec.ts`: after T008's `open_url`, the interaction log (`handleValue(app, "logPath")`) last line is `{ operation: "unwrap", url: <wrapper>, target: "${base}/static.html", outcome: "permitted", ruleId: null, unwrap: { hops: 1 } }` (SC-005)

### Implementation for User Story 1

- [ ] T010 [US1] In `src/main/tabs/unwrap-url.ts` `unwrapUrl`: finalise the accepted-candidate rule — a candidate is used only when `new URL(candidate)` succeeds and its `protocol` is `http:` or `https:`; otherwise stop and return the current URL. Count `hops` as iterations that changed the URL; set `wrapper` to the original input when `hops > 0`.
- [ ] T011 [US1] In `src/main/tabs/tab-manager.ts` `open()` and `navigate()`: after computing `const r = unwrapUrl(rawUrl)`, when `r.hops > 0` call `this.log.record({ operation: "unwrap", tabId: <this tab's id>, url: r.wrapper!, target: r.url, outcome: "permitted", ruleId: null, error: null, unwrap: { hops: r.hops } })`. In `open()` the id is minted just before `load()`; in `navigate()` it is the `tabId` arg. Write nothing when `r.hops === 0`.
- [ ] T012 [US1] Update the `open_url` tool description in `src/main/mcp/tools.ts` to the wording in `contracts/mcp-tools-002-delta.md` (drop "or follow links on its own"; add the "resolves a known redirect-interstitial / link-shim URL … opens that directly; every other URL opens verbatim" sentence); apply the same "resolves known link-shim URLs" sentence to the `navigate` description

**Checkpoint**: US1 works end to end — a shim URL lands on its destination, audited once.

---

## Phase 4: User Story 2 — Ordinary URLs are untouched (Priority: P1)

**Goal**: every URL not on the known list — including one that merely carries a
`url`/`q`/`u` parameter — opens byte-for-byte unchanged, with no audit entry.

**Independent Test**: `open_url` with `${base}/static.html?q=https://evil.test` → the tab
opens that exact URL and the interaction log gains no line.

### Tests for User Story 2

- [ ] T013 [P] [US2] Unit `tests/unit/unwrap-url.test.ts`: `unwrapUrl` returns `{ url: <input>, hops: 0 }` for — a non-shim host with a `?q=`/`?url=` param; a shim host with a non-matching path (`https://www.google.com/maps?q=…`); a shim host + matching path but the named param absent; and the param present but empty (FR-008, SC-002)
- [ ] T014 [US2] Integration `tests/integration/open-url.spec.ts`: `open` with `${base}/static.html?q=https://evil.test` → returned `url` still carries `?q=https://evil.test` unchanged; and `handleValue(app, "logPath")` shows no new line versus before the call (SC-002, SC-005, FR-011)

### Implementation for User Story 2

- [ ] T015 [US2] Verify (and adjust if needed) that `unwrapUrl` in `src/main/tabs/unwrap-url.ts` returns the input verbatim — same string, same query, same fragment — on every non-match path, and that `TabManager` passes `r.url` (not a re-serialised form) to `validateUrl`. No behaviour change expected beyond Foundational; this task is the guard against a normalisation regression.

**Checkpoint**: US1 and US2 both hold — resolution fires only on the known list.

---

## Phase 5: User Story 3 — Refuse non-web destinations, unwrap nested shims (Priority: P2)

**Goal**: a shim param carrying `javascript:` / `data:` / `mailto:` / an unparseable value
never navigates there; a shim wrapping a shim resolves through; a chain deeper than 3 stops
without looping.

**Independent Test**: `open_url` with a LinkedIn `safety/go` URL whose `url=javascript:alert(1)`
→ the app opens the wrapper verbatim (or reports it cannot resolve), never a `javascript:`
URL, and writes no `unwrap` entry.

### Tests for User Story 3

- [ ] T016 [P] [US3] Unit `tests/unit/unwrap-url.test.ts`: a LinkedIn wrapper whose `url=` is `javascript:alert(1)`, `data:text/html,x`, `mailto:a@b.c`, `tel:+1`, or a non-absolute string (`/foo`) → `unwrapUrl` returns `{ url: <wrapper>, hops: 0 }` (SC-003, FR-006)
- [ ] T017 [P] [US3] Unit `tests/unit/unwrap-url.test.ts`: an Outlook safelink whose `url=` encodes a LinkedIn `safety/go` whose `url=` encodes `https://example.test/x` → `{ url: "https://example.test/x", hops: 2 }` (FR-007)
- [ ] T018 [P] [US3] Unit `tests/unit/unwrap-url.test.ts`: a hand-built chain of ≥ 4 nested shims → `unwrapUrl` performs at most 3 iterations, returns the URL reached after the 3rd hop, and neither throws nor loops (SC-004); a self-referential `A?url=B?url=A` chain terminates at the cap
- [ ] T019 [US3] Integration `tests/integration/open-url.spec.ts`: `open` with a LinkedIn wrapper whose `url=javascript:alert(1)` → returned `url` is the wrapper (not a `javascript:` URL), the tab did not navigate to a script URL, and the interaction log has no `unwrap` entry (SC-003)

### Implementation for User Story 3

- [ ] T020 [US3] In `src/main/tabs/unwrap-url.ts` `unwrapUrl`: make the depth cap explicit — a `for` loop bounded to 3 iterations (or a counter), stopping early on the first iteration that yields no new accepted `http(s)` URL. Confirm the non-`http(s)` / unparseable candidate path (from T010) returns the current URL and does **not** count as a hop. Add a short comment citing FR-006 / FR-007.

**Checkpoint**: the dangerous and recursive tail is bounded; all three stories hold.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T021 [P] Update `specs/001-open-any-url/contracts/mcp-tools.md`: `open_url` / `navigate` description + a "Link-shim resolution" paragraph and the new `operation: "unwrap"` log entry, per `contracts/mcp-tools-002-delta.md`
- [ ] T022 [P] Update `docs/tools.md` (the `open_url` line + a short list of the recognized shims) and, if the README has an `open_url` / "what it does" mention, add "resolves known link-shim URLs" there
- [ ] T023 Run `npm run build && npm run lint && npm test && npm run test:e2e`; record pass counts and any known-unrelated failures under a "Verification" heading in this file
- [ ] T024 Manual smoke per [quickstart.md](./quickstart.md): in a running HyppoVisor, `open_url` a real LinkedIn `safety/go` "Apply" link from a job posting → the tab lands on the ATS page, no "You're leaving LinkedIn" interstitial, no Continue click; note the result

---

## Dependencies & Execution Order

### Phase order

- **Phase 1 Setup** → **Phase 2 Foundational** → **Phases 3–5 stories** → **Phase 6 Polish**.
- Foundational (T002–T006) blocks all three stories — it creates the module, the type
  field, and the `TabManager` wiring everything else builds on.

### Story dependencies

- **US1 (P1)** — depends only on Foundational. Carries the full `unwrapUrl` (T010) and the
  audit entry (T011). The MVP.
- **US2 (P1)** — independent of US1's *code*; its verbatim/no-entry behaviour falls out of
  Foundational + the never-throws contract. Phase is guard tests (T013, T014) + one
  regression check (T015).
- **US3 (P2)** — depends on US1 (T010's candidate-acceptance rule). Adds the explicit depth
  cap (T020) and the scheme/nesting/loop coverage.

### Same-file sequences (no [P] across these)

- `src/main/tabs/unwrap-url.ts`: T002 → T004 → T010 → T015 → T020
- `src/main/tabs/tab-manager.ts`: T005 → T006 → T011
- `tests/unit/unwrap-url.test.ts`: T007, T013, T016, T017, T018 all edit it — apply in task
  order (each adds a `describe`/`it`, no structural conflict, but same file)
- `tests/integration/open-url.spec.ts`: T008 → T009 → T014 → T019
- `src/main/mcp/tools.ts`: T012 only

### Parallel opportunities

- T002 ‖ T003 (Foundational).
- T007 (unit fixtures/cases) can start as soon as T004 lands.
- Once Foundational is done, the US2 and US3 **test** tasks (T013, T016, T017, T018) can be
  drafted in parallel with US1 implementation, since they target `unwrap-url.ts` behaviour
  the design already fixes — just land them after their same-file predecessors.
- T021 ‖ T022 (Polish docs).

---

## Implementation Strategy

### MVP (US1)

1. Phase 1 Setup + Phase 2 Foundational (module, type field, `TabManager` wiring).
2. Phase 3 US1 — scheme-guarded single/nested resolution + the `operation: "unwrap"` audit
   entry + the tool description.
3. **Stop and validate**: `open_url` with a LinkedIn wrapper pointing at a local fixture
   lands on the fixture; one audit line. Ship.

### Incremental delivery

1. MVP (US1) → demo (a shim URL now reaches its destination).
2. US2 → the guard tests prove non-shim URLs are byte-for-byte unchanged → demo.
3. US3 → `javascript:` payloads refused, nested shims resolved, chains bounded → demo.

### Commit discipline

- One commit per task or tight logical group; repo trailer convention.
- No constitution change — the spec's Principle I argument stands; no amendment commit.
