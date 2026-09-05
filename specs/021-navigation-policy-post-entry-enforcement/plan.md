# Implementation Plan: Post-Entry Navigation Policy Enforcement

**Branch**: `021-navigation-policy-post-entry-enforcement` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/021-navigation-policy-post-entry-enforcement/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Add post-entry enforcement to each embedded tab so cancellable main-frame navigation and server
redirect events are passed through the existing `validateUrl` policy. Denied events are cancelled,
reported through the existing blocked-action feedback channel, and do not alter tab ownership or
open a new tab. Existing explicit `loadURL` calls remain governed by their current pre-validation;
event handlers must avoid double-reporting those programmatic loads.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript, Node.js 22 (repository baseline)

**Primary Dependencies**: Electron WebContents/WebContentsView, existing URL policy and activity event interfaces

**Storage**: None; navigation feedback is transient

**Testing**: Vitest unit tests and Playwright Electron integration tests

**Target Platform**: Electron desktop app on macOS, with cross-platform URL-policy behavior

**Project Type**: Desktop app with embedded browser tabs and an MCP control surface

**Performance Goals**: A synchronous, constant-time policy check per top-level navigation; no added network request or page-content processing

**Constraints**: Preserve the existing http/https policy, human-only external actions, app-wide operation queue, popup rules, and authenticated tab sessions

**Scale/Scope**: One handler pair per embedded tab; main-frame navigations only. Frames, subresources, same-document navigation, and child-window policy are out of scope.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

* **PASS** — Principle I: this only blocks navigation and performs no external act.
* **PASS** — Principle II: no page interpretation, scoring, or business judgment is added.
* **PASS** — Principle III: reuses the existing policy, tab manager, and feedback channel; no store, daemon, or IPC surface.
* **PASS** — Principle IV: feedback must not expose credentials or session state.
* **PASS** — Principle V: enforcement is event-local and does not crawl, read, or persist page content.

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
├── main/tabs/tab-manager.ts       # wire main-frame navigation guards
├── main/tabs/navigation-policy.ts # pure decision and safe feedback seam
├── main/tabs/url-policy.ts        # existing policy source of truth
└── shared/types.ts                # unchanged unless test-facing event typing requires it

tests/
├── integration/navigation-policy.spec.ts  # end-to-end redirect/script cases
├── fixtures/navigation-policy-*.html      # local deterministic navigation fixtures
└── unit/tab-manager-navigation.test.ts    # handler/policy edge cases if test seam permits
```

**Structure Decision**: Keep the change in the existing tab-manager navigation lifecycle and
reuse `validateUrl`, `onBlockedAction`, and the existing Electron integration harness. Add no new
runtime layer or persistent model. Tests use local fixture pages and the established Electron app
launch helpers.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | The feature fits the existing single-project structure. |
