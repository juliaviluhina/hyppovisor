# Implementation Plan: Fill Form Fields and the Space Key

**Branch**: `003-in-form-fill` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-in-form-fill/spec.md`

## Summary

Narrow the `in-form` safety rule so it gates `click` only, add a named allowlist of
safe fill input types, and add a fourth `interact` operation `space` that activates
`document.activeElement` under the same rules a `click` would face (minus `in-form`).
Amend constitution Principle I with a one-clause carve-out: entering a value into a
non-credential, non-consent field is permitted *preparation*, not an external act.
All changes land in the existing `src/main/safety/` and `src/main/page/` modules plus
`src/main/mcp/tools.ts`; no new stores, services, or IPC channels.

## Technical Context

**Language/Version**: TypeScript 5.7, Node ≥ 22 (ESM)

**Primary Dependencies**: Electron 33 (`WebContents.executeJavaScript`), `@modelcontextprotocol/sdk` 1.x, `zod` 3.x

**Storage**: Append-only `interaction-log.jsonl` in Electron `userData` (unchanged); no new store

**Testing**: `vitest` (unit + integration), `@playwright/test` (e2e); fixtures in `tests/fixtures/*.html`

**Target Platform**: Electron desktop app (darwin/win/linux), embedded Chromium

**Project Type**: Single project — Electron main-process app with an embedded MCP server

**Performance Goals**: Not performance-sensitive; one interaction in flight app-wide (Principle V), sub-second per call

**Constraints**: No external act; refusal payload shape fixed (`code`, `message`, `ruleId`, `ruleDescription`); rules stay pure and unit-testable; allowlist enumerable like `listBlocklistRules()`

**Scale/Scope**: ~5 source files touched, ~1 constitution amendment, ~3 new fixture forms, no schema/migration

## Constitution Check

*GATE: must pass before Phase 0. Re-checked after Phase 1 (below).*

| Principle | Constraint on this feature | Status |
|-----------|----------------------------|--------|
| **I. Human Does Every External Act (NON-NEGOTIABLE)** | This feature *amends* Principle I. It does **not** grant an external act: submit/send/apply/connect/authenticate stay refused for both `click` and `space`; `submit-control`, `consent-toggle`, `external-act-label`, `credential-field` are unchanged. The carve-out is "type a value into a safe field," which the current text already lists `fill` among permitted actions for and already contemplates "preparing drafts." Amendment is MINOR (expands existing guidance, invalidates no conforming artifact). Requires: written rationale (issue 001 + spec Overview), version bump, Amendment History entry, template wording review. | PASS — governance action tracked as FR-015; called out in Complexity Tracking |
| **II. Zero Business Logic** | App types the value it is given; it does not read, validate, classify, or judge the field, the value, or the page. `space` resolves `activeElement` and applies the *same* mechanical rule match — no interpretation. | PASS |
| **III. Solid and Comprehensible** | One new operation on an existing tool; one new named list (`SAFE_FILL_TYPES`) inspectable exactly like `listBlocklistRules()`. No new entry point, store, service, daemon, or IPC channel. `in-form` changes one field (`appliesTo: "both"` → `"click"`). | PASS |
| **IV. User-Held Credentials** | `credential-field` rule byte-for-byte unchanged and still evaluated before the type-allowlist check. Password / `current-password` / `new-password` / `one-time-code` never filled; `space` also refused on them (FR-009). | PASS |
| **V. Assistive Pace** | Every `fill` and every `space` — permitted or refused — appends exactly one `interaction-log.jsonl` entry (FR-013). All calls still go through the app-wide `ActionQueue`; one in flight at a time. No new network behavior, no crawl. | PASS |

**Architecture Constraints**: MCP surface stays at the same tool count (`interact` gains an
enum value, not a new tool). No dependency on `hyppograph`. No writes to the shared data
directory. Stack unchanged.

**Result**: PASS with one tracked governance action (Principle I amendment). No unjustified
violation. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/003-in-form-fill/
├── plan.md              # This file
├── spec.md              # Feature spec (input)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── interact-tool.md # Phase 1 output — interact operation contract
└── checklists/
    └── requirements.md  # Spec quality checklist (already present)
```

### Source Code (repository root)

```text
src/
├── main/
│   ├── safety/
│   │   ├── blocklist.ts          # in-form appliesTo → "click"; add SAFE_FILL_TYPES +
│   │   │                         #   listSafeFillTypes(); add isSafeFillTarget(descriptor);
│   │   │                         #   extend targetDescriptorScript if a new descriptor
│   │   │                         #   field is needed for combobox-text detection
│   │   └── interaction-log.ts    # unchanged (already records any operation string)
│   ├── page/
│   │   └── interact.ts           # add "space" branch: resolve activeElement, build
│   │                             #   descriptor, matchBlocklist(desc, "space"), then
│   │                             #   dispatch a space keystroke or .click(); fill branch
│   │                             #   gains clear-then-set + safe-type gate
│   └── mcp/
│       └── tools.ts              # interact zod enum gains "space"; tool description text
├── shared/
│   └── types.ts                  # InteractOperation adds "space"
└── ...

tests/
├── unit/
│   └── blocklist.test.ts         # in-form is click-only; SAFE_FILL_TYPES coverage;
│                                 #   space verdict parity for the 4 kept rules
├── integration/
│   ├── interaction.spec.ts       # in-form fill permitted; dangerous targets still refused;
│   │                             #   space on checkbox / submit / text / no-focus; clear-then-set
│   └── fixtures usage
└── fixtures/
    ├── form.html                 # extend: plain fields, file input, consent checkbox,
    │                             #   submit button, a react-select-like combobox stub
    └── (reuse existing)

.specify/memory/constitution.md   # Principle I amended clause + Amendment History entry (FR-015)
README.md                         # "What the app will not do" + interact description sync (FR-016)
```

**Structure Decision**: Single-project Electron layout, already established. The feature is a
localized change to the safety layer (`src/main/safety/blocklist.ts`), the interaction
executor (`src/main/page/interact.ts`), the operation enum (`src/shared/types.ts`), and the
MCP tool declaration (`src/main/mcp/tools.ts`), plus the governance file and docs. No new
directories.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|------|-----------|-------------------------------------|
| Amendment to Principle I (NON-NEGOTIABLE) | Every field of a real application form sits inside one `<form>`; `in-form: both` blocks 100% of fills, so an agent cannot draft anything — the issue this feature exists to fix (`specs/issues/001-in-form-rule-blocks-all-field-fills.md`). Value entry with no submit path is preparation, which Principle I already permits in spirit. | Leaving `in-form` as-is: rejected — makes the draft-preparation use case impossible, which is the product's core value. A per-site exception list: rejected — that *is* business logic (Principle II) and unbounded. A looser rule that also permits submit-ish clicks: rejected — widens the hole the amendment is careful not to widen. |
| New `space` operation (vs. reusing `click`) | Some widgets (open listbox option, focused plain checkbox) need activation that a value `fill` cannot express, and `click` on them is blocked by `in-form`. Space has no implicit form-submit behavior, so it can be gated safely by an `activeElement` check; Enter cannot. | Adding Enter: rejected — triggers implicit form submission from any text field, ungateable (spec Out of Scope). Driving every widget by clicking option elements only: kept as the primary path; `space` is the smaller keyboard complement for when option clicks are unreliable. |
