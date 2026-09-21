# Implementation Plan: Actionable Page Read

**Branch**: `027-actionable-page-read` | **Date**: 2026-09-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/027-actionable-page-read/spec.md`

## Summary

One new read-only MCP tool (proposed name: `read_actionable`) that returns a tab's actionable elements as an indexed table plus budgeted visible text in a single call, reusing the jev-ultrafast snapshot ideas (atomic DOM walk, visibility/viewport filtering, accessible-name labels, omission accounting). When the caller passes a goal and the user has `TYPESAFE_API_KEY` configured, the tool adds Jev relevance ordering over the table in the same call; ranking is advisory, failures stay in-payload, and every existing `interact` refusal applies unchanged.

## Technical Context

**Language/Version**: TypeScript 5.7, Node ≥ 22 (Electron 33, Chromium tabs via `WebContents`)

**Primary Dependencies**: `@modelcontextprotocol/sdk` (MCP server), `zod` (tool schemas); outbound HTTPS to `https://api.typesafe.ai/v1/systemone` for ranking only (no new npm dependency — plain fetch)

**Storage**: N/A — the tool persists nothing; payloads are held only for the requesting call (Principle V)

**Testing**: `vitest run` (unit: `tests/unit/`), `playwright test` (e2e); live Jev calls are manual-only (paid API), all automated tests use stubbed ranking responses

**Target Platform**: macOS Electron desktop app (arm64 build; Intel via source build)

**Project Type**: desktop-app + embedded MCP server

**Performance Goals**: One in-page DOM walk per call; at most one Jev request per ranked call; ranked call completes within the existing queue's single-flight pacing without blocking other tabs beyond one bounded wait

**Constraints**: App-wide single in-flight action (`ActionQueue`); loopback-only MCP surface; ranking failure (missing key, network error, rate limit after bounded retries) MUST surface as in-payload status, never thrown; snapshot indices are single-read scoped and MUST fail stale-safe

**Scale/Scope**: One tab per call; element table in the low hundreds (precedent: `read_form_fields` 200-control cap, 64 KB payload budget; exact caps set at implementation via env-overridable config)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Human Does Every External Act** — PASS. The tool is read-only: no navigation, no fill, no click, no submit path. Sensitive controls (credential/file/consent/submit) are listed with refused markers; `interact` verdicts are unchanged and still dispose. Stale indices reject rather than reinterpret.
- **II. Zero Business Logic in HyppoVisor** — PASS with recorded justification (see Complexity Tracking). DOM-relevance ordering is derived read-only guidance about *which control matches a stated goal*, on the same footing as `read_form_fields`' existing per-field fill/click verdicts. It scores no job, career fact, or connection; all fit/tier/tailor judgment stays in HyppoGraph.
- **III. Solid and Comprehensible** — PASS with one noted dependency (see Complexity Tracking). No new store, service, daemon, or IPC channel; no new persistent state. One new MCP tool (eighth → ninth; docs/`TOOL_NAMES`/panel snippets updated accordingly). The single new outbound HTTPS dependency (TypeSafe API, ranking only) is stateless and documented in research.md R3.
- **IV. User-Held Credentials and Sessions** — PASS. `TYPESAFE_API_KEY` is user-supplied env-level configuration for the user's own TypeSafe account (same category as `HYPPO_MCP_TOKEN` per amendment 1.3.1 — an app-to-service secret, not a user credential). It is never logged, never persisted to the data directory, and never sent anywhere except the ranking endpoint.
- **V. Assistive Pace, Not Bulk Collection** — PASS. Reads run through the existing app-wide queue (one in flight); text payload is verbatim with explicit truncation markers; nothing is written to the shared data directory; ranking adds at most one sequential request per ranked call.

Gates: no ERROR. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/027-actionable-page-read/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── read-actionable.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Single project (default). This feature touches:

```text
src/
├── main/
│   ├── mcp/tools.ts            # register 9th tool + TOOL_NAMES
│   ├── page/
│   │   ├── actionable.ts       # NEW: snapshot collector + payload assembly
│   │   ├── read.ts             # reuse text-extraction/truncation helpers
│   │   ├── form-fields.ts      # reuse kind mapping + verdict functions
│   │   └── interact.ts         # index→target resolution + stale rejection
│   ├── safety/blocklist.ts     # reuse fill/click/choose verdicts (no change expected)
│   ├── ranking/jev.ts          # NEW: single Jev ranking call + retry + status mapping
│   ├── config.ts               # NEW env-overridable caps (HYPPO_* precedent)
│   └── shared/types.ts         # NEW payload/record types
tests/unit/
├── actionable.test.ts          # NEW: mapping, budgets, omission accounting, statuses
└── mcp-tools.test.ts           # extend: 9th tool shape
docs/
├── tools.md                    # "Eight tools" → nine
├── configuration.md            # TYPESAFE_API_KEY
└── safety.md                   # refused-marker semantics if needed
skills/hyppovisor/SKILL.md      # tool list update
specs/001-open-any-url/contracts/mcp-tools.md  # contract update
```

**Structure Decision**: Single-project layout retained; new modules colocate with the existing `page/` (collection) and a small `ranking/` unit (one outbound call). No new top-level directories except the feature spec itself.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle II (no judgment): Jev relevance ordering computed inside HyppoVisor | Callers need goal-relative target selection in one round trip; an unranked snapshot alone reintroduces the 40-control reasoning burden the feature exists to remove | Caller-side ranking (snapshot only) was considered and explicitly rejected by the user at specify time (FR-006 decision: rank inside HyppoVisor). Ordering is confined to DOM relevance with confidence values — no job/career/connection judgment enters the app |
| Principle III (new external dependency): outbound HTTPS to TypeSafe API | Relevance ranking requires the Jev model; there is no local equivalent | Local heuristic ranking (label substring match) was rejected: brittle across sites and duplicates model capability the user already pays for. The dependency is stateless, ranking-only, and degrades to unranked output when unreachable |
