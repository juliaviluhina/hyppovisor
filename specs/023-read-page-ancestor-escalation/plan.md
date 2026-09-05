# Implementation Plan: Read Page Ancestor Escalation and Exclusion

**Branch**: `009-read-page-ancestor-escalation` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

## Summary

Extend the existing MCP `read_page` primitive so a selector match can be widened to an ancestor
and then trimmed with descendant exclusion selectors. Resolve and clone the effective subtree in
the browser, compute text from the clone so exclusions affect both outputs, retain existing DOM
reduction/truncation, and return additive scope metadata.

## Technical Context

**Language/Version**: TypeScript, Node.js, Electron
**Primary Dependencies**: Electron WebContents, Zod, Vitest
**Storage**: N/A; page reads are transient
**Testing**: Vitest unit tests and existing Playwright-style integration harness
**Target Platform**: Electron desktop app, Chromium page context
**Project Type**: Desktop app with embedded MCP server
**Performance Goals**: One bounded DOM traversal per read; no additional page loads or persistent work
**Constraints**: Preserve omitted-input compatibility; never mutate the live DOM; retain byte limits
**Scale/Scope**: One `read_page` request and its selected DOM subtree; MCP surface only

## Constitution Check

| Principle | Status | Design response |
|---|---|---|
| I — Human does every external act | PASS | Read-only DOM inspection; no interaction or navigation. |
| II — Zero business logic | PASS | Structural selector matching only; no content interpretation. |
| III — Solid and comprehensible | PASS | Extends existing `read.ts`, schema, shared result; no store/service. |
| IV — User-held credentials | PASS | No credential handling; exclusions can reduce returned exposure. |
| V — Assistive pace and verbatim reads | PASS | Existing opt-in scope is explicit in metadata; no persistence; raw mode remains available. |

## Project Structure

```text
src/main/page/read.ts       # browser-context scope, exclusion, reduction, serialization
src/main/mcp/tools.ts       # read_page request schema and dispatch
src/shared/types.ts         # PageReadResult scope metadata
tests/unit/read-page-ancestor-escalation.test.ts
tests/integration/read-page.spec.ts
```

**Structure Decision**: Single Electron/TypeScript project. No renderer changes are needed because
`read_page` is MCP-only.

## Complexity Tracking

No violations.
