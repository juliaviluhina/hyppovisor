# Implementation Plan: Checked-In Changelog for Future Releases

**Branch**: `019-checked-in-changelog` | **Date**: 2026-09-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/024-checked-in-changelog/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Add a manually maintained `CHANGELOG.md`, a small release-verification script, and release-workflow wiring that extracts the matching version entry into the published GitHub Release. Existing generated GitHub notes remain supplemental. Feature 018's compatibility note belongs in the Unreleased section; no historical version is backfilled.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: Markdown; Node.js 22+ / JavaScript ESM

**Primary Dependencies**: Existing Node.js standard library and Vitest

**Storage**: Checked-in Markdown file

**Testing**: Vitest unit tests and pure parser/validator assertions

**Target Platform**: GitHub Actions and local Node.js development

**Project Type**: Desktop app repository with release tooling

**Performance Goals**: Verification completes in under one second for the repository changelog

**Constraints**: Fail closed; no network or runtime application behavior changes; preserve existing release artifacts and generated notes

**Scale/Scope**: One changelog and one release workflow for this repository

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

PASS. Principle III favors a human-readable checked-in file and the smallest mechanism; no database, service, or runtime state is introduced. Principles I, II, IV, and V are unaffected. Release tooling only validates and publishes documentation; it performs no external browser act and handles no user credentials.

## Project Structure

### Documentation (this feature)

```text
specs/024-checked-in-changelog/
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
CHANGELOG.md
scripts/check-release-changelog.js
docs/development.md
.github/workflows/release.yml
tests/unit/check-release-changelog.test.ts
```

**Structure Decision**: Keep release metadata at the repository root, put the verification helper beside existing release scripts, wire it into the existing `verify` job, and test the pure parser/validator without invoking GitHub Actions.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
No violations.
