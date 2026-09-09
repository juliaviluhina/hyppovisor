# Tasks: User-Configurable Blocked Domains

## Phase 1: Foundation
- [ ] T001 [P] Add `blockedDomains` types and error code in `src/shared/types.ts` and `src/main/errors.ts`.
- [ ] T002 [P] Extend settings parsing, validation, env precedence, and persistence in `src/main/settings.ts` and `contracts/settings-file.md`.
- [ ] T003 [P] Implement hostname normalization and subdomain matching in `src/main/tabs/url-policy.ts`.

## Phase 2: User Story 1 - Enforce blocked domains (P1)
- [ ] T004 [P] [US1] Add unit coverage for normalization, matching, empty defaults, and `DOMAIN_BLOCKED` in `tests/unit/url-policy.test.ts`.
- [ ] T005 [US1] Thread effective blocked domains through MCP `open_url`/`navigate` validation in `src/main/mcp/tools.ts` and `src/main/tabs/url-policy.ts`.
- [ ] T006 [US1] Enforce the shared decision for redirects and top-level navigation in `src/main/tabs/navigation-policy.ts` and `src/main/tabs/tab-manager.ts`.
- [ ] T007 [US1] Enforce blocked child-window destinations in `src/main/tabs/tab-manager.ts` while preserving permitted HTTP(S) behavior.
- [ ] T008 [US1] Apply shim unwrapping before blocked-host validation in `src/main/tabs/unwrap-url.ts` and navigation callers.

## Phase 3: User Story 2 - Manage the setting (P2)
- [ ] T009 [P] [US2] Add settings IPC read/write and environment-pinned metadata in `src/main/index.ts` and `src/main/settings.ts`.
- [ ] T010 [US2] Add the multiline blocked-domain field, validation hint, save behavior, and read-only env state in `src/renderer/panel.ts` and `src/renderer/app.ts`.
- [ ] T011 [US2] Add settings persistence and panel integration tests in `tests/unit/settings.test.ts` and existing renderer tests.

## Phase 4: User Story 3 - Audit blocked attempts (P3)
- [ ] T012 [US3] Record blocked host and outcome metadata through `src/main/safety/interaction-log.ts` and policy callers without page content.
- [ ] T013 [US3] Add audit assertions for blocked direct and redirect attempts in `tests/unit/interaction-log.test.ts`.

## Phase 5: Polish
- [ ] T014 Run the feature quickstart and full test suite; update `specs/026-user-configurable-blocked-domains/quickstart.md` if commands differ.

## Dependencies
- T001-T003 are foundational and can proceed in parallel.
- T004-T008 depend on T001-T003; T006-T008 share navigation files and run sequentially.
- T009-T011 depend on T002; T012-T013 depend on T005-T008.
- T014 follows all implementation tasks.

## MVP
T001-T008 deliver the core safety guarantee. T009-T011 add the user-facing configuration surface;
T012-T013 add auditability.
