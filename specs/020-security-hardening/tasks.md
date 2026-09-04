# Tasks: Local Security Hardening

## Phase 1: Setup

- [x] T001 [P] Add security specification, plan, research, checklist, quickstart, and policy docs in `specs/020-security-hardening/` and `docs/security.md`

## Phase 2: Foundational

- [x] T002 Add owner-only permission helpers for profile and sensitive local files in `src/main/security/file-permissions.ts`
- [x] T003 [P] Add generated secure defaults and migration behavior in `src/main/settings.ts`

## Phase 3: User Story 1 — Protected local control plane (P1)

- [x] T004 [P] [US1] Add unit coverage for generated tokens and secret-safe server configuration in `tests/unit/mcp-server.test.ts`
- [x] T005 [US1] Make HTTP authentication default-on for new/reset profiles in `src/main/settings.ts` and `src/main/index.ts`
- [x] T006 [US1] Apply permission tightening to settings and interaction log writes in `src/main/settings.ts` and `src/main/safety/interaction-log.ts`

## Phase 4: User Story 2 — Reduced renderer blast radius (P2)

- [x] T007 [P] [US2] Add chrome security and CSP integration assertions in `tests/integration/security-hardening.spec.ts`
- [x] T008 [US2] Enable sandboxed app chrome and Node integration disablement in `src/main/index.ts`
- [x] T009 [US2] Add restrictive packaged-resource CSP to `src/renderer/index.html`

## Phase 5: User Story 3 — Explicit local storage boundary (P3)

- [x] T010 [P] [US3] Add permission helper unit tests in `tests/unit/file-permissions.test.ts`
- [x] T011 [US3] Verify runtime/profile writes request restrictive modes in `src/main/instances/registry.ts` and `src/main/index.ts`
- [x] T012 [US3] Document threat model, backup limitation, logout/reset procedure, and deferred keychain work in `docs/security.md`

## Phase 6: Polish

- [x] T013 Run build, lint, unit tests, and security-focused Electron integration tests; record results in the implementation handoff

## Dependencies & Execution Order

- T002 and T003 precede all user stories.
- US1, US2, and US3 depend on the foundational phase and can otherwise be developed incrementally.
- T013 depends on all implementation tasks.

## Implementation Strategy

Deliver US1 first because it closes the highest-impact exposure, then US2, then the policy and permission work in US3. Preserve stdio and explicit legacy opt-outs for compatibility.
