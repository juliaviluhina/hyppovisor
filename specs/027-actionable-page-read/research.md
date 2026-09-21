# Research: Actionable Page Read

**Feature**: `027-actionable-page-read` | **Date**: 2026-09-21

All Technical Context unknowns are resolved below (no NEEDS CLARIFICATION remained open). Each entry records Decision / Rationale / Alternatives.

## R0. Reuse survey (T001, implementation-time confirmation)

- **Reused as-is**: `domReadyScript` (bounded ready wait), `DESCRIPTOR_BODY` + `ACCESSIBLE_NAME_SOURCES_BODY` (in-page descriptor/label sources), `fillVerdictFor` / `clickVerdictFor` / `chooseVerdictFor` (main-side verdicts), `kindFor` + `operationForKind` (kind → operation mapping), `capList` (count caps), `truncateToBytes` (byte-bounded text with marker), `HyppoError` named codes, `runTabAction` queue wrapper + `ok`/`fail` envelopes, `config.numFromEnv` cap pattern.
- **Adapted**: visibility check extended with viewport-overlap + `elementFromPoint` occlusion (form-fields checks layout visibility only); label order starts with `aria-labelledby`/`aria-label` and falls back to `innerText` for button/link/select; value extraction adds checkbox `checked` state and `<select>` selected-option labels; new `generation` token (`sha256(url + observedAt + records + text)`) for stale rejection.
- **Deliberately not reused**: selector synthesis (`synthesizeSelector`) — snapshot indices replace selectors per FR-005; `fields`/`containerSelector` scoping and `includeNonInteractive`/`only` projections — the snapshot is always whole-page with refused markers instead of exclusions.

## R1. Snapshot collector pattern

- **Decision**: Extend the `read_form_fields` architecture (`src/main/page/form-fields.ts`): one read-only isolated-world DOM walk in document order gathering raw per-control records, with verdict/marker attachment done in the main process through the shared pure functions in `src/main/safety/blocklist.ts` (`fillVerdictFor`, `clickVerdictFor`, `chooseVerdictFor`, `DESCRIPTOR_BODY`, accessible-name sources). Add jev-ultrafast snapshot ideas on top: visibility + viewport filtering (`checkVisibility`, zero-area and offscreen rejection), `fill` vs `click` split for editables, per-`<select>`-option fan-out, omission counting, and a bounded visible-text extract alongside the table.
- **Rationale**: Keeps refused markers agreeing with `interact` by construction (the SC-004 property feature 005 already relies on); read-only collectors write no audit entry and touch no shared state (FR-013/FR-014 precedent).
- **Alternatives considered**: A second independent collector with its own verdict logic (rejected — verdict drift risk); doing visibility filtering main-side from full records (rejected — larger bridge payload, more work per read).

## R2. Snapshot-scoped indices and stale safety

- **Decision**: Indices (`1..N`) are valid only for the snapshot generation that issued them. The payload carries a snapshot generation token (URL + DOM fingerprint captured atomically with the walk). Any `interact` use of an index resolves index → verified selector at execution time and re-checks document freshness (same-document token plus target re-validation: still connected, still visible, still enabled, same role/label); on mismatch it fails with the existing stale-rejection path. Model output never becomes a selector, coordinate set, or script.
- **Rationale**: Directly implements FR-005 and mirrors jev-ultrafast's `fresh()`/`guard` split (identity + semantics re-checked immediately before input, geometry resolved at use time). Reuses `interact`'s plain-`querySelector` + uniqueness-verified selectors from feature 005, so no new addressing machinery.
- **Alternatives considered**: Returning raw selectors in the snapshot (rejected — violates FR-005, lets model output become executable input); opaque per-element UUIDs (rejected — same safety with worse readability; numeric indices match the jev-ultrafast element-table ergonomics).

## R3. Jev ranking call shape and failure policy

- **Decision**: One `POST https://api.typesafe.ai/v1/systemone` per ranked call carrying a single `choice` question over the offered indices (goal + element table + budgeted text as `state`), sharing the established `jev-call` contract (`choice` + `probabilities` + `confidence`). No operation fan-out, no text helper — ranking only. Retry: bounded exponential backoff on 429/529/503 (mirrors jev-ultrafast `post_json` and the `jev-call` skill convention); 401 → `unavailable-missing-or-invalid-key` with no retry; validation-shaped failures → `unavailable-request-failure`; overall deadline bounded so a read stays responsive. Every failure path yields the unranked snapshot + `RankingStatus`, never a throw (FR-010).
- **Rationale**: Single-round-trip ranking is the core jev-ultrafast idea being reused; stripping the operation/target heads removes autonomy while keeping the latency win. Retry policy matches both precedents the repo already documents.
- **Alternatives considered**: Caller-side ranking (rejected by user decision at specify time); embedding operation choice in the Jev call (rejected — autonomous policy conflicts with Principle I and the Claude-plans/`interact`-executes split).

## R4. Budgets and caps

- **Decision**: Follow the `src/main/config.ts` env-overridable pattern (`numFromEnv("HYPPO_*", fallback)`): element cap, per-record option cap, text byte budget, and total payload byte budget, each with a documented default guided by precedent (`read_form_fields`: 200 controls / 200 options / 64 KB payload; `read_page`: 100 KB text). Tail records drop past the payload budget with counts preserved in the omission record. Exact defaults are set at implementation; the contract guarantees caps exist and omissions are reported, not their values.
- **Rationale**: Precedent-consistent, test-tunable (features 006/011 already use env overrides to make timing/cap tests fast), and satisfies FR-004 + Principle V (explicit truncation).
- **Alternatives considered**: Hard-coded caps (rejected — untestable at speed, inconsistent with repo convention); fully caller-supplied budgets with no defaults (rejected — unbounded reads by default).

## R5. Registration ripple of a 9th tool

- **Decision**: Update the five places that enumerate the tool surface: `TOOL_NAMES` in `src/main/mcp/tools.ts`, `docs/tools.md` ("Eight MCP tools" → nine + row), `skills/hyppovisor/SKILL.md` tool list, the feature-007 connection-panel About-text consistency guard + `tests/unit/connection-snippets.test.ts`, and `specs/001-open-any-url/contracts/mcp-tools.md`. `TYPESAFE_API_KEY` documented in `docs/configuration.md` as user-supplied env config.
- **Rationale**: Prior features (005, 008) each updated this same set; missing one breaks contract tests by design.
- **Alternatives considered**: None — this is a checklist, not a choice.

## R6. Test strategy

- **Decision**: Unit (`vitest`): kind mapping incl. refused-marker kinds, omission accounting under caps, ranking-status mapping (missing key / 401 / 429-then-success / 429-exhausted / malformed response), stale-index rejection, no-throw guarantee on ranking failure (all with stubbed network — no live Jev in automation). Contract: extend `tests/unit/mcp-tools.test.ts` for the 9th tool's input/output shape. E2E (`playwright`): snapshot on local fixture pages (content-heavy, form with submit/credential controls, empty page). Live Jev ranking verified manually once (paid API), same as other model-backed paths.
- **Rationale**: Mirrors the repo's test layering (pure-code unit at $0, harness/contract, manual live checks); keeps CI free of secrets and flaky network.
- **Alternatives considered**: Recorded/live Jev fixtures in CI (rejected — secrets in CI, paid calls per run, nondeterministic model output).
