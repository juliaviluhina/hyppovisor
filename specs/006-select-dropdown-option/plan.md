# Implementation Plan: Choose an Option in a Dropdown

**Branch**: `clarify-plan-004-006` (feature dir `specs/006-select-dropdown-option`) |
**Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-select-dropdown-option/spec.md`

## Summary

Add one new `interact` operation, **`choose_option`**, that — given a chooser control and a
target option (by visible `label`, by `value`, or both) — makes that control hold that
option as its selected value and fires the events a real choice produces. The app does the
mechanics: for a native `<select>` it sets the value and dispatches `input`/`change`; for a
custom combobox it opens the menu, optionally types the label into the widget's own filter
input to narrow the list, activates the single exactly-matching `role="option"`, closes the
widget, and then **re-reads the control to confirm the value stuck** before reporting
success.

It is preparation, not an external act: `choose_option` cannot submit, send, or apply, and
the existing blocklist rules `submit-control`, `consent-toggle`, `external-act-label`, and
`credential-field` still refuse the whole operation. `in-form` does **not** gate it (choosing
an option is like `fill`). The change is confined to the identified chooser's own option
list — it never becomes "activate anything in a form."

Technical approach: a new page module `src/main/page/choose-option.ts` (beside `read.ts` /
`interact.ts`), dispatched from `interact()` on `operation === "choose_option"`. Two pure
helpers (`chooserKindFor`, `matchOption`) are unit-tested in isolation; the DOM mechanics
live in injected isolated-world scripts. One new `ErrorCode` (`CHOOSE_OPTION_FAILED`) with a
`reason` discriminator carries the six non-rule refusals. A one-line Principle I clarifying
amendment (1.2.0 → 1.3.0, MINOR) makes the dropdown boundary explicit (FR-017).

## Technical Context

**Language/Version**: TypeScript 5.7, Node ≥ 22 (ESM), Electron 33.

**Primary Dependencies**: Electron `WebContents.executeJavaScript(code, true)` (isolated
world); `@modelcontextprotocol/sdk`; `zod`. No new runtime dependencies.

**Storage**: N/A. No persistence; one line appended to the existing `interaction-log.jsonl`
via `InteractionLog`. Nothing written to the shared data directory.

**Testing**: `vitest` unit (`matchOption`, `chooserKindFor`, `ruleCovers` coverage for
`choose_option`, reason→code mapping); `@playwright/test` `_electron` integration
(`tests/integration/choose-option.spec.ts`) against an extended `tests/fixtures/form.html`.

**Target Platform**: Electron desktop app (macOS / Linux / Windows) + embedded MCP server.

**Project Type**: Single project — `src/main/**` (main process) + `src/shared/**` + `tests/**`.

**Performance Goals**: One selection per call, in the app-wide single-in-flight `queue.run`.
Bounded async wait ≤ `config.chooseOptionWaitMs` (default = `defaultWaitMs`, 10 s;
env-overridable for tests). No parallelism, no polling loops beyond one `MutationObserver`.

**Constraints**: No external act (Principle I). No interpretation / fuzzy matching
(Principle II). Exactly one audit entry per call, permitted or refused (FR-015). Any refusal
leaves the control unchanged (FR-005/006/007/010/013). The widget MUST be left closed
(FR-009). Enter is never pressed.

**Scale/Scope**: ~7 single-select dropdowns on the Legion application form (SC-001). No caps
needed — one control per call; the option list is whatever the DOM already holds.

**Unknowns**: none. The five `/speckit-clarify` answers plus the spec's Assumptions resolve
operation name (`choose_option`), chooser definition (`<select>` / `role=combobox` /
`role=listbox` / owner of a `role=listbox` via `aria-controls`/`aria-owns`), error taxonomy
(`CHOOSE_OPTION_FAILED` + `reason`), read-back verification (enforced), and label+value
precedence (value primary, label cross-check).

## Constitution Check

*GATE: evaluated before Phase 0 and re-checked after Phase 1 design.*

| Principle | Verdict | Notes |
|-----------|---------|-------|
| **I — Human Does Every External Act (NON-NEGOTIABLE)** | **PASS with bundled amendment** | `choose_option` selects an option and fires the change events a real choice makes; it performs no submit/send/apply and never presses Enter. Internal mechanics (open menu, type filter, click the one matching option, close) are confined to the identified chooser's own option list. `submit-control`, `consent-toggle`, `external-act-label`, `credential-field` still refuse the whole operation. FR-017 requires a one-line Principle I clause + Amendment History entry, **1.2.0 → 1.3.0 (MINOR)** — same shape and reasoning as `003`'s 1.2.0 bump; pre-approved in the spec (FR-017, Assumptions). Not a new external act, so it is a clarifying expansion, not a redefinition. |
| **II — Zero Business Logic** | **PASS** | The caller names the option. Match is exact (case-insensitive + trimmed label, or exact `value`); no fuzzy/prefix/substring, no ranking, no option creation (FR-004/008). Ambiguity and no-match refuse rather than guess. |
| **III — Solid and Comprehensible** | **PASS (complexity recorded below)** | One new operation on the **existing** `interact` tool (no new tool). One new module. One new `ErrorCode`. One env-overridable config value. `TargetDescriptor` unchanged. One audit entry per call. |
| **IV — User-Held Credentials** | **PASS** | A credential field is not a chooser and is refused by `credential-field` before any mechanics run (FR-003). No password handling added. |
| **V — Assistive Pace** | **PASS** | One call → one option in one control the human's page already shows. Runs in `queue.run` (app-wide single-in-flight). Nothing stored; snapshot behaviour; one bounded wait. |

**Architecture Constraints**: the MCP surface stays six tools; `interact` gains one value in
its `operation` enum and one optional `label` input — the constitution enumerates "the
click/fill/scroll/wait interaction primitives" by category, not by count, so a new
interaction operation fits the existing category. No new IPC channel, no new store, no
`hyppograph` dependency.

### Complexity Tracking

| Choice | Why needed | Simpler alternative rejected because |
|--------|------------|-------------------------------------|
| New `choose_option` operation rather than overloading `fill` | `fill` on a `<select>` / listbox / combobox container is deliberately refused (`003`'s `unsafe-fill-type`) and typing into one is meaningless; a "commit a choice" verb is a different act with a different result shape (`{label,value}`). | Overloading `fill` would erase the `unsafe-fill-type` guard and conflate "type a draft value" with "commit a selection." |
| New module `src/main/page/choose-option.ts` | The mechanics (classify chooser, read options, open menu, wait, type filter, activate one option, close, read back) are ~150 page-side lines. Inlining pushes `interact.ts` past "hold it in your head" (Principle III). | Inlining in `interact()` — `interact.ts` is already ~325 lines across four operations; a fifth this size makes the file the thing that needs babysitting. |
| `interact()` gains a trailing `label?: string` param and a non-`void` return `{ chosenOption? }` | The option identifier needs a second field beyond the reused `value`, and FR-014 requires returning the chosen `{label,value}`. | Packing `{label,value}` into the `value` string (opaque, un-typed) or a parallel tool handler that bypasses `interact()`'s single-audit-entry `logged` guard. |
| `ruleCovers()` broadened so `choose_option` is covered by the `activation` and `fill-or-space` rule groups | FR-003 requires `submit-control`, `consent-toggle` (both `activation`) and `credential-field` (`fill-or-space`) to gate `choose_option`; `external-act-label` (`both`) and `in-form` (`click`) already resolve correctly. | Re-tagging every rule with a new `appliesTo` bucket is a larger, riskier diff than extending the two `switch` arms with a comment. |
| New `config.chooseOptionWaitMs` (env-overridable, defaults to `defaultWaitMs`) | A test must hit `option-not-appeared` in <1 s without a real 10 s wait — same pattern `004`/`005` use for their caps. | Hard-coding `defaultWaitMs` makes the async-refusal path a 10 s test or untested. |

**Post-Phase-1 re-check**: still PASS. The design adds no store, no service, no IPC channel;
the only cross-cutting edit is the `ruleCovers` broadening (covered by new unit tests) and
the bundled constitution amendment (a tracked deliverable, not scope creep).

## Project Structure

### Documentation (this feature)

```text
specs/006-select-dropdown-option/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions R1–R12
├── data-model.md        # Phase 1 — types, config, errors, blocklist, matching table
├── quickstart.md        # Phase 1 — runnable validation (§1 unit … §7 gate)
├── contracts/
│   └── choose-option.md # Phase 1 — the choose_option operation contract
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source code (repository root)

```text
src/
├── main/
│   ├── config.ts                 # + chooseOptionWaitMs
│   ├── errors.ts                 # + ErrorCode "CHOOSE_OPTION_FAILED"; ErrorDetails + reason?, candidates?
│   ├── index.ts                  # e2e __hyppo.interact handle: + label arg, return chosenOption
│   ├── mcp/
│   │   └── tools.ts              # interact: enum + "choose_option"; input + label?; description (FR-018); merge chosenOption
│   ├── page/
│   │   ├── interact.ts           # interact() + label? param, non-void return; dispatch choose_option
│   │   └── choose-option.ts      # NEW — chooseOption(); chooserKindFor(); matchOption(); in-page scripts
│   └── safety/
│       └── blocklist.ts          # ruleCovers(): choose_option ∈ activation + fill-or-space groups; comment
├── shared/
│   └── types.ts                  # InteractOperation + "choose_option"; + ChosenOption, ChooseOptionReason;
│                                 #   InteractionLogEntry + reason?
tests/
├── fixtures/
│   └── form.html                 # + closed react-select combobox (populates on open); + filter-narrowing
│                                 #   combobox; + async-never-render combobox; + <select> consent label;
│                                 #   + <select> duplicate option labels; + <select> disabled option;
│                                 #   + <select multiple>; + aria-owns owned-listbox combobox; + creatable combobox
├── unit/
│   └── choose-option.test.ts     # NEW — matchOption, chooserKindFor, ruleCovers, reason→code
└── integration/
    └── choose-option.spec.ts     # NEW — US1–US4 against form.html

.specify/memory/constitution.md   # Principle I clause + Amendment History 1.3.0 + version header (FR-017)
README.md                         # interact operations list / "what the app will not do" (FR-018 parity)
specs/001-open-any-url/contracts/mcp-tools.md  # interact operation enum: + choose_option (doc parity sweep)
```

**Structure Decision**: Single project, existing layout. `choose-option.ts` mirrors the
`read.ts` / `interact.ts` sibling pattern (and `005`'s planned `form-fields.ts`): pure
helpers exported for unit tests, DOM work in injected scripts, orchestration in one async
function called from `interact()`. No `hyppograph` coupling; `006` shares *approach* with
`005` (option discovery, chooser vocabulary) but imports no `004`/`005` code — neither is
implemented yet. When `005` lands, `choose-option.ts`'s option-source snippet and
`form-fields.ts`'s should be reconciled into one shared helper (a later refactor, not a
`006` blocker).

## Phase 0 — Research

See [research.md](./research.md). No open `NEEDS CLARIFICATION`. Decisions R1–R12 cover: the
operation vs. a new tool (R1); module boundary and orchestration (R2); chooser classification
(R3); the blocklist gate and `ruleCovers` change (R4); the matching algorithm (R5); the
per-kind mechanics incl. open / filter / activate / close (R6); the read-back verification
(R7); result + audit shape (R8); config (R9); types (R10); errors (R11); the constitution
amendment (R12).

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — `ChooseOptionRequest`, `ChooserKind`, `OptionRecord`,
  `ChooseOptionReason`, `ChosenOption`; `InteractionLogEntry.reason?`;
  `config.chooseOptionWaitMs`; `errors.ts` additions; the `ruleCovers` matrix; the
  label/value matching table.
- [contracts/choose-option.md](./contracts/choose-option.md) — input schema, success and
  refusal payloads, a scenario→code/reason table, the behavioural contract, non-goals.
- [quickstart.md](./quickstart.md) — §1 unit, §2 US1, §3 US2, §4 US3, §5 US4, §6 MCP
  surface, §7 docs + full gate; SC-001…SC-007 mapped to checks.

## Post-Design Constitution Re-Check

PASS — unchanged from the pre-Phase-0 gate. No new violation surfaced during design; the
Complexity Tracking table above is complete and each row is the smallest mechanism that
works.
