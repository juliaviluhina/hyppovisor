# Implementation Plan: Async Selector Readiness for Page Reads

**Branch**: `025-read-page-async-selector-wait` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/025-read-page-async-selector-wait/spec.md`

## Summary

Extend MCP `read_page` with an opt-in readiness wait for a supplied positive CSS selector.
Validate the selector and timeout, wait for DOM presence in the target tab, then run the existing
scoped read unchanged. A timeout is actionable and never broadens the read.

## Technical Context

**Language/Version**: TypeScript, Node.js >=22, Electron

**Primary Dependencies**: Electron WebContents, Zod, Vitest, Playwright integration harness

**Storage**: N/A; page reads and waits are transient

**Testing**: Vitest unit tests and existing Playwright-style Electron integration tests

**Target Platform**: Electron desktop app with Chromium page context

**Project Type**: Desktop app with embedded MCP server

**Performance Goals**: One bounded sequential wait and one scoped read per request; no page loads or parallel polling

**Constraints**: Wait is opt-in, requires a positive selector, is bounded by a positive timeout, and preserves no-broadening privacy semantics and existing payload behavior

**Scale/Scope**: One MCP request and one selected DOM target in one existing tab; no persistence or new service

## Constitution Check

| Principle | Status | Design response |
|---|---|---|
| I — Human does every external act | PASS | Readiness observes DOM presence only; no navigation, interaction, submission, or authentication. |
| II — Zero business logic | PASS | Selector matching and waiting are structural browser operations only. |
| III — Solid and comprehensible | PASS | Reuses `config.defaultWaitMs`, existing page-read code, queue serialization, and MCP schemas. |
| IV — User-held credentials and sessions | PASS | Reads live browser state only; no credentials or page content are stored. |
| V — Assistive pace, not bulk collection | PASS | One bounded sequential wait precedes one read; existing verbatim and transient behavior remains. |

No violations or unresolved clarifications remain.

## Project Structure

```text
src/main/mcp/tools.ts       # request schema, descriptions, validation, dispatch
src/main/page/read.ts       # selector validation, readiness wait, scoped read
src/main/config.ts          # existing bounded defaultWaitMs
src/main/errors.ts          # timeout error mapping if required
src/shared/types.ts         # unchanged PageReadResult shape unless additive metadata is justified
tests/unit/read-page-selector.test.ts
tests/integration/read-page.spec.ts
tests/fixtures/             # delayed target and persistent private-panel fixture
```

**Structure Decision**: Single Electron/TypeScript project. Only the MCP schema/page-read path
and existing read tests need extension; no renderer, persistence, or new transport is needed.

## Complexity Tracking

No violations.
