# Implementation Plan: Local Security Hardening

**Branch**: `security-hardening-014-016` | **Date**: 2026-09-04 | **Spec**: [spec.md](spec.md)

## Summary

Protect new HTTP profiles with generated bearer authentication, harden the app-owned renderer with sandboxing and CSP, request owner-only permissions for local profile files, and document the local OS threat boundary and reset procedure.

## Technical Context

**Language/Version**: TypeScript 5, Node.js, Electron
**Primary Dependencies**: Electron, Node `http`/`fs`/`crypto`, Vitest, Playwright
**Storage**: Electron userData profile and human-readable settings/log files
**Testing**: Vitest unit tests, Playwright Electron integration tests, TypeScript build, ESLint
**Target Platform**: macOS first; Windows/Linux supported with best-effort permission tightening
**Project Type**: Desktop Electron application with embedded MCP server
**Constraints**: no shared-data page persistence, no credentials, no new daemon/database, preserve stdio
**Scale/Scope**: one app profile per instance and one loopback MCP listener per process

## Constitution Check

- Principle III: PASS — no service, database, shared index, or new IPC surface; settings remain human-readable.
- Principle IV: PASS — the bearer token is an app authorization secret, not a website credential; sessions remain Electron live profile state.
- Principle V: PASS — no page content is persisted or logged.
- Review gate: PASS — this hardens an existing control plane and does not add external actions.

## Project Structure

```text
src/main/config.ts                 # security defaults
src/main/settings.ts               # generated token defaults and safe file writes
src/main/mcp/server.ts             # default auth and diagnostics
src/main/index.ts                  # sandboxed chrome window
src/renderer/index.html            # CSP
src/main/safety/interaction-log.ts # restrictive log creation
docs/security.md                   # threat model and reset policy
tests/unit/*security*.test.ts      # unit coverage
tests/integration/security-hardening.spec.ts
```

**Structure Decision**: Extend existing pure settings/server modules and the single Electron entry point; keep security policy in a checked-in human-readable document.

## Design Decisions

- New profiles receive a generated token and persist it on the first normal startup. Existing explicit opt-outs remain compatible.
- `sandbox: true` is safe for the chrome preload because it only requires Electron's sandbox-supported `contextBridge` and `ipcRenderer` APIs.
- CSP is declared in the packaged HTML and allows only the local module, local images, and the inline stylesheet via a fixed content hash.
- File modes are tightened best-effort with `chmodSync`; unsupported filesystems do not prevent startup.
- Platform keychain migration is explicitly deferred; the policy names it as follow-up work rather than introducing a second storage system in this feature.
