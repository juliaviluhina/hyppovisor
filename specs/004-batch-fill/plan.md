# Implementation Plan: Batch Fill Operation for `interact`

**Branch**: `004-batch-fill` | **Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-batch-fill/spec.md`

## Summary

Let `interact`'s `fill` operation take an ordered `fields` list of `(selector, value)` pairs
instead of a single `selector` + `value`. The whole list runs as one queued operation: an
all-or-nothing pre-write check (resolve + rule-check every target — reusing the exact logic a
single `fill` runs), then a best-effort write pass (reusing the existing native-setter
`fillScript`). One aggregate result with a batch-level outcome (`permitted` / `partial` /
`refused`), a per-field array, and counts. Per-field audit entries plus one batch-summary
entry. Cap of 50 pairs. No new tool, no new operation, no constitution amendment.

## Technical Context

**Language/Version**: TypeScript 5.7, Node ≥ 22 (ESM)

**Primary Dependencies**: Electron 33 (`WebContents.executeJavaScript`), `@modelcontextprotocol/sdk` 1.x, `zod` 3.x

**Storage**: Append-only `interaction-log.jsonl` in Electron `userData` (unchanged); no new store

**Testing**: `vitest` (unit), `@playwright/test` (`_electron` integration); fixtures in `tests/fixtures/*.html`

**Target Platform**: Electron desktop app, embedded Chromium

**Project Type**: Single project — Electron main-process app with an embedded MCP server

**Performance Goals**: One queued operation per batch; ≤ 2 s app-side for a 10-field batch (SC-002). No artificial inter-field delay.

**Constraints**: Refusal payloads keep a named `code` + message + structured detail; the batch cap is one named number; every write and the batch itself are audited; `in-form` must not gate the batch (inherited from `003`).

**Scale/Scope**: ~5 source files touched, +2 new types, +1 config value, +1 new fixture hook, no schema/migration. Cap 50 pairs.

## Constitution Check

*GATE: must pass before Phase 0. Re-checked after Phase 1 (below).*

| Principle | Constraint on this feature | Status |
|-----------|----------------------------|--------|
| **I. Human Does Every External Act (NON-NEGOTIABLE)** | A batch is N value entries, each evaluated against the *same* blocklist + safe-fill-type check a single `fill` runs (`003`). Any forbidden target (submit / consent / credential / file / outward-action) refuses the **whole** batch before anything is written. A completed batch never navigates or submits. No new permission, no Enter, no activation. FR-017: no amendment. | PASS |
| **II. Zero Business Logic** | The app types each given value in the given order. It does not read, validate, reorder, dedupe, or judge fields or values. The pre-write check is the mechanical rule match, not interpretation. | PASS |
| **III. Solid and Comprehensible** | No new tool and no new operation — `fill` gains one optional `fields` param (operation set stays `click`/`fill`/`scroll`/`space`). The cap is one named constant (`config.batchFillCap = 50`). The batch is **one** interaction in flight (one `queue.run`); writes inside are sequential. Observability: one audit line per field + one batch-summary line. Additive, plain-file: `InteractionLogEntry.outcome` gains `"partial"` and an optional `batch` counts object; still human-readable JSONL. | PASS — additive log/type changes noted in Complexity Tracking |
| **IV. User-Held Credentials** | `credential-field` is evaluated for every target in the pre-write check, unchanged. A batch containing a password / one-time-code target is refused whole; nothing is typed anywhere. | PASS |
| **V. Assistive Pace, Not Bulk Collection** | One batch fills one form the human opened, capped at 50 pairs, in one queue slot, writes sequential, no network, no crawl. No artificial delay between writes — Principle V pacing governs page loads and crawling to un-opened pages, not keystroke cadence within one opened form; the app-wide single-in-flight queue still bounds the batch as a whole. | PASS |

**Architecture Constraints**: MCP tool count unchanged. No dependency on `hyppograph`. No
writes to the shared data directory. Stack unchanged.

**Result**: PASS. No amendment, no unjustified violation. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/004-batch-fill/
├── plan.md              # This file
├── spec.md              # Feature spec (input)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── batch-fill.md    # Phase 1 output — interact fill-batch I/O contract
└── checklists/
    └── requirements.md  # Spec quality checklist (present)
```

### Source Code (repository root)

```text
src/
├── main/
│   ├── config.ts            # + batchFillCap: 50 (env HYPPO_BATCH_FILL_CAP)
│   ├── errors.ts            # + "BATCH_REJECTED" code; ErrorDetails gains optional
│   │                        #   targets: Array<{ selector; ruleId?; ruleDescription?; reason? }>
│   ├── page/
│   │   └── interact.ts      # extract resolveFillTarget(wc, selector) → { descriptor } |
│   │                        #   { offender } shared with single fill; add
│   │                        #   fillBatch(wc, log, tabId, fields): Promise<BatchFillResult>;
│   │                        #   reuse fillScript() unchanged
│   └── mcp/
│       └── tools.ts         # interact schema: + fields?: z.array({selector,value});
│                            #   dispatch fill+fields → fillBatch; enforce exactly-one-of
│                            #   (fields XOR selector/value); description update (FR-015)
├── shared/
│   └── types.ts             # InteractionLogEntry.outcome += "partial"; + optional
│                            #   batch: { requested; written; errored; refused };
│                            #   + BatchFillField, BatchFieldResult, BatchFillResult
└── main/index.ts            # e2e-only handle: fillBatch(tabId, fields)

tests/
├── unit/
│   └── batch-fill.test.ts   # cap / empty / exactly-one-of / offender-collection (pure)
├── integration/
│   └── batch-fill.spec.ts   # US1–US4 end to end against the fixture app
└── fixtures/
    └── form.html            # + a hook that removes #phone once #email receives input
                             #   (deterministic mid-write removal for US3)
```

**Structure Decision**: Single-project Electron layout, established. The change is localized
to `interact.ts` (new `fillBatch` + a small refactor to share the per-target check), the MCP
tool declaration, one config value, one error code, and additive type fields. No new
directories, no new module.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|------|-----------|-------------------------------------|
| `InteractionLogEntry.outcome` gains `"partial"` + optional `batch` counts object | FR-013 requires the batch-summary audit entry to carry the batch outcome and written/errored/refused counts; the existing entry shape has nowhere to put them. | Encoding counts into the free-text `error` field — rejected: not machine-readable, and the log is meant to be inspectable JSONL (Principle III). A separate batch-log file — rejected: two logs for one obligation, more hidden state. |
| New error code `BATCH_REJECTED` (vs. reusing `REFUSED_EXTERNAL_ACT`) | A whole-batch refusal aggregates *several* reasons (cap, empty, malformed call, one-or-more forbidden targets, one-or-more unresolved selectors) and carries a `targets[]` breakdown. Callers switch on `code`. | Reusing `REFUSED_EXTERNAL_ACT` — rejected: cap / empty / malformed are not external-act refusals, and a single `ruleId` cannot express multiple offenders. |
| `fields` as an optional param on `fill` (vs. a new `fill_batch` operation) | Spec FR-001 frames it as "an alternative to a single target + value" for `fill`; FR-016 keeps the operation set at four. | A 5th operation `fill_batch` — rejected: larger surface, and the spec explicitly treats it as one-of-two input forms for `fill`. |
