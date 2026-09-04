# Implementation Plan: Read Page Reduction Hardening

**Branch**: `018-read-page-reduction-hardening` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/018-read-page-reduction-hardening/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Fixes and hardens the `reduceDom` reduction pass shipped in feature 017
(`src/main/page/read.ts`): the root element of a `selector`-scoped read is
never itself stripped when it matches a removal target (FR-001/FR-002); the
test suite doesn't actually exercise scoped script/style removal or several
of the feature's stronger claims (FR-003 through FR-008); reduction work
(clone + `TreeWalker` + attribute-strip) runs even when `includeDom` is
`false` and its result is discarded (FR-009/FR-010); and the already-decided
`reduceDom` default-on behavior change has no release-note callout (FR-011).
Approach: extend `__reduceDom` to classify the root node itself alongside
its descendants, gate the whole reduction/serialization branch in
`readPageScript` on `includeDom`, extend the existing fixture and
`read-page.spec.ts` with the missing scoped/attribute/mutation/truncation
cases, and add one release-note entry.

## Technical Context

**Language/Version**: TypeScript 5.7 (Node >=22), compiled via `tsc`, runs under Electron 33

**Primary Dependencies**: Electron (`WebContents.executeJavaScript`, isolated world), `@modelcontextprotocol/sdk` (MCP transport, unaffected by this feature)

**Storage**: N/A — no persistence; reads are per-request only (Principle V)

**Testing**: `vitest` for unit-level logic; `@playwright/test` for `tests/integration/read-page.spec.ts` (launches the real Electron app against a local fixture server)

**Target Platform**: Electron desktop app (macOS primary), main-process code (`src/main/page/read.ts`) plus in-page script injected into a tab's isolated world

**Project Type**: Single project — desktop app + embedded MCP server (see repo root `src/main/`)

**Performance Goals**: No numeric latency contract (per spec Assumptions); SC-003 requires a text-only read's cost to no longer scale with DOM size / `reduceDom`, verified by a relative regression check, not an absolute target

**Constraints**: `reduceDom: false` must remain byte-for-byte the pre-017 script (existing FR-002 of feature 017, reaffirmed here); no new MCP tool parameters; no change to `reduceDom`'s default value

**Scale/Scope**: One file (`src/main/page/read.ts`), one fixture (`tests/fixtures/dom-noise-repro.html`), one integration spec (`tests/integration/read-page.spec.ts`), one release-note entry

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Human Does Every External Act)**: Not implicated. This feature only changes
  what a `read_page` call returns/costs; it adds no new browser action and no new interaction
  primitive.
- **Principle II (Zero Business Logic in HyppoVisor)**: Not implicated. `__reduceDom` remains
  purely structural (removes fixed node/attribute categories); it does not interpret page
  content.
- **Principle III (Solid and Comprehensible)**: Reaffirmed. No new persistent store, service,
  or IPC channel; the fix stays inside the existing `read_page` code path.
- **Principle IV (User-Held Credentials and Sessions)**: Not implicated.
- **Principle V (Assistive Pace, Not Bulk Collection)**: Directly relevant and reinforced —
  FR-001/FR-002 fix a case where the verbatim/self-sufficient payload guarantee ("every read
  payload MUST be verbatim... and self-sufficient") was silently violated for root-matched
  removable nodes (the caller got neither the removed node nor an indication it was ever
  there beyond the existing `domReduced` flag). FR-009/FR-010 reduce unnecessary work without
  changing what is captured. No conflict.

**Result**: PASS. No violations requiring Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/018-read-page-reduction-hardening/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/main/page/
├── read.ts                          # readPageScript(), DOM_REDUCTION_HELPER, readPage() — all four fixes land here
└── truncate.ts                      # truncateToBytes() — unchanged, referenced by FR-008's truncation test

shared/
└── types.ts                         # PageReadResult — unchanged shape, referenced for contract clarity

tests/
├── fixtures/
│   └── dom-noise-repro.html         # gains in-subtree script/style/comment descendants + root-removable-node cases (FR-003, FR-005)
└── integration/
    └── read-page.spec.ts            # gains FR-004 through FR-008 cases; existing US2 read tests extended for FR-009/FR-010
```

**Structure Decision**: Single project, no new directories. All production-code changes are
confined to `src/main/page/read.ts` (the existing home of the reduction pass); all test
changes are confined to the existing fixture and integration spec that already cover
`read_page`. No new modules, services, or contracts are introduced — this is a hardening pass
on shipped code, not new surface.

## Complexity Tracking

*No Constitution Check violations — section not applicable.*
