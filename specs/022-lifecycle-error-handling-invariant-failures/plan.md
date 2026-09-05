# Implementation Plan: Lifecycle Error Handling and Invariant Failures

**Branch**: `018-lifecycle-error-handling-invariant-failures` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/022-lifecycle-error-handling-invariant-failures/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Replace process-wide log-and-continue behavior with an explicit lifecycle health model. Classify expected operational failures separately from invariant failures, propagate degraded status through the existing main/renderer IPC connection surface, and make the HTTP transport report bind, request, and shutdown failures deterministically. Gate new queued actions while the affected runtime is degraded.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript, Node.js >=22, Electron 33

**Primary Dependencies**: Electron, Node HTTP, MCP SDK, Vitest, Playwright

**Storage**: In-memory lifecycle state; existing user-data logs only

**Testing**: Vitest unit tests and Playwright Electron integration tests

**Target Platform**: Electron desktop app on macOS, Linux, and Windows

**Project Type**: Desktop application with embedded loopback MCP HTTP/stdio transport

**Performance Goals**: Health updates are synchronous/in-memory and do not delay normal requests; renderer updates remain throttled where existing activity updates are throttled.

**Constraints**: Loopback-only transport, no new persistent store, no external actions, idempotent shutdown, preserve healthy-path behavior.

**Scale/Scope**: One Electron process, one renderer, one shared action queue, one optional HTTP listener.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

PASS. Principle I is preserved because this feature only reports failures and gates internal actions. Principle II is preserved because no business judgment is added. Principle III is met with an in-memory status object and existing panel/IPC surface, without a database, daemon, or new IPC channel family. Principle IV is unaffected. Principle V is preserved because queue serialization remains unchanged and failures stop unsafe continuation.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
src/
├── main/
│   ├── errors.ts              # normalized failure classification/status
│   ├── lifecycle.ts            # process/runtime health state
│   ├── index.ts                # wiring and process-level handlers
│   ├── mcp/server.ts           # transport lifecycle callbacks
│   └── queue/action-queue.ts   # degraded gating
├── renderer/
│   ├── app.ts                  # visible degraded notice
│   └── panel.ts                # connection health details
└── shared/types.ts             # renderer-visible health contracts

tests/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: Keep the existing single Electron project. Add a small lifecycle module and shared types, extend the current MCP and renderer connection surfaces, and test transport behavior at unit level plus app-visible behavior at integration level.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
