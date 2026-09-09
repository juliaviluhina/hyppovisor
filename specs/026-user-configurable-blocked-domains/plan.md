# Implementation Plan: User-Configurable Blocked Domains

**Branch**: `026-user-configurable-blocked-domains` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

## Summary

Add normalized blocked-host configuration to settings and enforce it through every top-level URL
policy path, including redirects and child windows. Reuse existing settings, IPC, and interaction
logging mechanisms.

## Technical Context

**Language/Version**: TypeScript, Node.js, Electron
**Primary Dependencies**: Electron WebContents, React renderer, Zod, Vitest
**Storage**: Human-readable settings.json under Electron userData
**Testing**: Vitest unit tests and existing Electron/browser integration tests
**Target Platform**: macOS desktop, Chromium embedded tabs
**Project Type**: Single Electron/TypeScript desktop app
**Performance Goals**: O(1) host lookup per navigation after configuration normalization
**Constraints**: Preserve empty-list behavior; no new store; never log page content
**Scale/Scope**: Per-instance settings and all top-level navigation paths

## Constitution Check

| Principle | Status | Design response |
|---|---|---|
| I — Human does every external act | PASS | Refuses navigation; performs no external act. |
| II — Zero business logic | PASS | Mechanical user-owned host policy, not judgment. |
| III — Solid and comprehensible | PASS | Reuses existing settings, policy, IPC, and log. |
| IV — User-held credentials | PASS | No credential or session data is handled. |
| V — Assistive pace | PASS | No crawling or page reads; only metadata is logged. |

## Project Structure

```text
src/main/settings.ts
src/main/tabs/url-policy.ts
src/main/tabs/navigation-policy.ts
src/main/tabs/tab-manager.ts
src/main/mcp/tools.ts
src/renderer/panel.ts
src/renderer/app.ts
src/shared/types.ts
tests/unit/*blocked-domain*.test.ts
```

**Structure Decision**: Extend existing settings and navigation paths; no new service or persistence
mechanism. The effective list is normalized once and consulted on each policy decision.

## Complexity Tracking

No violations.
