# Implementation Plan: Copy Instance Settings

**Branch**: `028-copy-instance-settings` | **Date**: 2026-09-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/028-copy-instance-settings/spec.md`

## Summary

Every row of the instance-management list gains copy actions producing that instance's MCP connection settings — the same shell command and JSON config block the Connection & MCP panel builds for the local instance, parameterized per row (server name, effective port, bearer token). Data comes from the existing per-instance files (runtime + settings) read at display time; nothing new is stored, no instance is disturbed, and unreachable rows offer last-known settings marked as such.

## Technical Context

**Language/Version**: TypeScript 5.7, Node ≥ 22 (Electron 33; Jest-free — `vitest run` for unit, `playwright test` for e2e)

**Primary Dependencies**: None new — Electron clipboard, existing `renderer/panel.ts` + `renderer/snippets.ts` builders, existing `main/instances/registry.ts` discovery

**Storage**: None new — reads sibling `<profile>/runtime.json` (liveness/port, existing) and `<profile>/settings.json` (token auth state + token, existing) at display time; writes nothing

**Testing**: `vitest run` (unit: snippet builders per-instance, settings-file parsing, unreachable/unreadable handling), `playwright test` (e2e: two instances, copy from sibling row, register-equivalent handshake reaches the right instance)

**Target Platform**: macOS Electron desktop app (same-user, same-machine multi-instance)

**Project Type**: desktop-app + embedded MCP server

**Performance Goals**: List rendering stays interactive with a dozen instances; per-row settings assembly is file-local and completes within the panel's existing poll cadence

**Constraints**: Same-user only (sibling profiles must be readable; unreadable ⇒ row without copy, never fabricated); copying disturbs no instance (no focus, no relaunch, no writes); stdio rows get stdio variants, not HTTP blocks

**Scale/Scope**: One panel, N rows (single digits typical); two snippet formats per row

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Human Does Every External Act** — PASS. Copying connection text performs no browser or external act; it hands the human paste-ready text for an agent *they* configure.
- **II. Zero Business Logic in HyppoVisor** — PASS. No scoring, ranking, or judgment of any kind; pure derivation of connection coordinates.
- **III. Solid and Comprehensible** — PASS. No new store, service, daemon, or channel: per-row settings are derived at display time from the same per-instance files feature 014 already reads (runtime) plus each profile's existing settings file. One new UI affordance (row copy actions) inside the existing list surface — no new surface.
- **IV. User-Held Credentials and Sessions** — PASS with recorded justification (see Complexity Tracking). Sibling bearer tokens are the same *kind* of secret as the local one (loopback app-to-client authorization, amendment 1.3.1 — explicitly not a user credential), belonging to the same user on the same machine, read from files that user already owns. Display/copy stays inside the local UI the user operates; nothing is transmitted anywhere.
- **V. Assistive Pace, Not Bulk Collection** — PASS. No page loads, no MCP calls to siblings (which would need their tokens first — circular), no pacing impact. Liveness continues via the existing loopback probe.

Gates: no ERROR. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/028-copy-instance-settings/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── instance-settings-copy.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Single project (default). This feature touches:

```text
src/
├── main/
│   ├── instances/
│   │   ├── registry.ts         # sibling settings read (token auth state + token) alongside runtime
│   │   └── settings-copy.ts    # NEW (or registry-adjacent): per-instance SnippetState assembly
│   └── settings.ts             # reuse token/port resolution (no change expected)
├── renderer/
│   ├── snippets.ts             # reuse mcpAddCommand / mcpJsonConfig / stdioJsonConfig per row
│   └── panel.ts                # per-row copy buttons + unreachable/unreadable states
├── shared/types.ts             # per-row settings type (additions only)
tests/unit/
├── instance-settings-copy.test.ts  # NEW: builders per row, auth-off omission, unreadable handling
└── instances-registry.test.ts      # extend: sibling settings reads
tests/integration/ (playwright, e2e)
└── instance-settings-copy.spec.ts  # NEW: two instances, copy sibling row, handshake reaches it
```

**Structure Decision**: Single-project layout retained; settings assembly colocates with the existing instance registry (same filesystem-only, Electron-free module so unit tests drive it directly); snippet rendering reuses the pure `snippets.ts` builders.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle IV (credential handling): reading + displaying sibling instances' bearer tokens | The feature's entire purpose is retrieving a background instance's token without digging through profile files; the token is unobtainable any other way (querying the sibling over MCP needs the token first — circular) | Copying only endpoint/port without the token was rejected at clarify time implicitly (FR-002 requires verbatim-connectable blocks) and would leave the core pain unsolved. Masking was explicitly rejected by the user (FR-004). Mitigation: same-user/same-machine only, existing file permissions apply, display stays in the local UI, nothing transmitted |
