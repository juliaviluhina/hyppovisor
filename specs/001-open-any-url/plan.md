# Implementation Plan: Open Any URL

**Branch**: `001-open-any-url` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-open-any-url/spec.md`

## Summary

Ship HyppoVisor's stage-1 primitive: an Electron desktop app that opens any `http(s)` URL in an
embedded browser view carrying the person's own logged-in session, and exposes those views to a
connected agent over an embedded MCP server (Streamable HTTP on 127.0.0.1, or stdio) offering `list_open_tabs`, `read_page`,
`navigate`, and bounded interaction (`click`, `fill`, `scroll`, `wait_for_selector`).

The app retrieves and returns; it never stores page content and never performs an external act.
Enforcement is a blocklist checked before every interaction, with an append-only interaction log
making the permit-by-default posture auditable. All page loads and interactions are sequenced
app-wide through a single queue.

## Technical Context

**Language/Version**: TypeScript 5.x, Node 22 (bundled with Electron 3x)

**Primary Dependencies**: Electron (app shell + `WebContentsView` for embedded tabs);
`@modelcontextprotocol/sdk` (MCP server: Streamable HTTP + stdio transports); `zod` (tool input schemas)

**Storage**: No database. Page content is never persisted. The app writes exactly one file —
an append-only JSONL interaction log — under Electron's `userData` directory (app-local
operational data, deliberately not the shared data directory)

**Testing**: Vitest (unit: URL validation, blocklist matching, queue ordering, truncation);
Playwright `_electron` (integration: real Electron instance, real pages, MCP round-trips)

**Target Platform**: macOS desktop first (the person's primary OS); Windows/Linux buildable but
unverified in this feature

**Project Type**: Desktop application with an embedded MCP server

**Performance Goals**: Page visible within 5s of submit, network permitting (SC-001); default
read payload ≤100 KB of visible text (SC-003a)

**Constraints**: Exactly one page load or interaction in flight app-wide (FR-013); zero page
content written to the shared data directory (FR-019); no credential handling (FR-016)

**Scale/Scope**: Single person, single machine, one orchestrator client at a time, tens of tabs
at most. Three MCP operation families, ~4 UI surfaces (tab strip, address bar, content view,
activity indicator)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against constitution v1.1.0.

| Principle | Gate | Status |
|---|---|---|
| I. Human Does Every External Act | No tool submits forms, sends messages, or applies. Blocklist checked before every interaction; refusals logged | **PASS** — no submit-capable tool exists in the contract; `click`/`fill` gated by blocklist |
| II. Zero Business Logic | No parsing, scoring, classification, or extraction. Raw content only | **PASS** — `read_page` returns verbatim text/DOM; no interpretation anywhere in the design |
| III. Solid and Comprehensible | One window, one entry point, no database, no services, human-readable state | **PASS** — single Electron app, one JSONL log, no persistent store |
| IV. User-Held Credentials | No password capture, storage, autofill, or transmission | **PASS** — person logs in inside the view; `fill` refuses credential inputs; no credential code path exists |
| V. Assistive Pace, Not Bulk Collection | Only requested URLs, app-wide sequencing, verbatim self-sufficient payloads, no page content written to the data directory | **PASS** — single global queue; `read_page` returns verbatim; app writes no page content |

**Post-Phase-1 re-check**: PASS. The design added no persistent page storage, no external-act
capability, and no interpretation step. The one file the app writes (interaction log) is
operational data about the app's own behavior, not page content or business data — it lives in
`userData`, outside the shared data directory, so Principle V's prohibition is structurally
satisfied rather than merely observed.

**Complexity Tracking**: no violations, table omitted.

## Project Structure

### Documentation (this feature)

```text
specs/001-open-any-url/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── mcp-tools.md     # MCP tool contract
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── main/                     # Electron main process
│   ├── index.ts              # App entry: window, lifecycle, wiring
│   ├── tabs/
│   │   ├── tab-manager.ts    # Tab registry, ids, lifecycle, WebContentsView
│   │   └── url-policy.ts     # http(s)-only scheme validation (FR-004)
│   ├── queue/
│   │   └── action-queue.ts   # App-wide serialization of loads + interactions (FR-013)
│   ├── safety/
│   │   ├── blocklist.ts      # External-act rules, enumerable (FR-012a)
│   │   └── interaction-log.ts# Append-only JSONL audit (FR-024a)
│   ├── page/
│   │   ├── read.ts           # Verbatim text/DOM extraction + truncation (FR-010, FR-021)
│   │   └── interact.ts       # click / fill / scroll / wait_for_selector
│   └── mcp/
│       ├── server.ts         # MCP server: HTTP (loopback, default) + stdio
│       └── tools.ts          # Tool definitions + zod schemas
├── preload/
│   └── extract.ts            # In-page extraction script (isolated world)
└── renderer/
    ├── index.html
    └── app.ts                # Tab strip, address bar, activity indicator

tests/
├── unit/                     # url-policy, blocklist, action-queue, truncation
└── integration/              # Playwright _electron: open → read → interact → refuse
```

**Structure Decision**: Single Electron project, split by process boundary (`main` / `preload` /
`renderer`) since that split is forced by the platform, then by responsibility within `main`.
Each constitutional guarantee gets exactly one enforcing module — `url-policy` (FR-004),
`action-queue` (FR-013), `blocklist` (FR-012a), `interaction-log` (FR-024a) — so a reviewer can
verify a principle by reading one file, per Principle III.
