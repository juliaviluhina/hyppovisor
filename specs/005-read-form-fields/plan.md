# Implementation Plan: Structured Form-Field Reader

**Branch**: `005-read-form-fields` | **Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-read-form-fields/spec.md`

## Summary

Add a seventh MCP tool, `read_form_fields`: one read-only call that returns a bounded,
document-ordered list of a tab's form controls, one record each — `selector` (usable by
`interact`), `kind`, raw `type`, verbatim `label`, `required`, `group`, `inFormAncestor`,
`visible`, `currentValue` (omitted for credentials), `options` (`<select>` and in-DOM
combobox menus), and the `fillVerdict` / `clickVerdict` `interact` would return for that
target. It performs no interaction, writes nothing, and adds no audit-log entry. `read_page`
is untouched — this is an explicitly derived view (filter + reorder + annotate), computed
from the same accessible-name assembly and the same blocklist / safe-fill-type checks
`interact` uses, so the verdicts agree by construction. Caps: 200 controls, 200 options per
control, both named config values; truncation is flagged. No constitution amendment.

## Technical Context

**Language/Version**: TypeScript 5.7, Node ≥ 22 (ESM)

**Primary Dependencies**: Electron 33 (`WebContents.executeJavaScript` in an isolated world), `@modelcontextprotocol/sdk` 1.x, `zod` 3.x

**Storage**: None. Nothing persisted; the returned payload is the only copy (Principle V). The interaction audit log is not written (FR-014).

**Testing**: `vitest` (unit — kind mapping, selector synthesis, verdict parity, credential omission, caps), `@playwright/test` `_electron` (integration — US1–US4 against `tests/fixtures/form.html`)

**Target Platform**: Electron desktop app, embedded Chromium

**Project Type**: Single project — Electron main-process app with an embedded MCP server

**Performance Goals**: One queued read per call; a form up to the control cap returns in one tool payload well under the `read_page` full-DOM size limit — never spills to file (SC-003).

**Constraints**: Read-only (Principle I). Structure only — no value inference, no ranking (Principle II). Bounded list with explicit caps + truncation flags (Principle III). No credential `currentValue` (Principle IV). Labels and option text verbatim; nothing stored (Principle V).

**Scale/Scope**: ~4 source files touched + 1 new module; +4 shared types; +2 config values; +1 fixture extension; 2 new test files. No schema, no migration, no new store. Caps 200 / 200.

## Constitution Check

*GATE: must pass before Phase 0. Re-checked after Phase 1 (below).*

| Principle | Constraint on this feature | Status |
|-----------|----------------------------|--------|
| **I. Human Does Every External Act (NON-NEGOTIABLE)** | The tool reads and returns. It never fills, clicks, opens a menu, navigates, or submits. It *reports* the verdict `interact` would give — it does not act on it. FR-016: no amendment; read-only adds no external act. | PASS |
| **II. Zero Business Logic** | The result is structure only: selectors, kinds, verbatim labels/options, current values, and the mechanical rule verdict. The tool MUST NOT infer what value a field wants, rank fields by importance, or decide which are "worth" filling. `required` and `group` are read from attributes / a literal "*" in the label — no interpretation. Selection is "every form control (optionally within a container), in document order"; there is no judgement in what to include. | PASS |
| **III. Solid and Comprehensible** | Adds one MCP tool (surface goes 6 → 7) and one module (`src/main/page/form-fields.ts`). The tool returns a **bounded** list, not the DOM — control cap and options cap are named config values (`formFieldControlCap`, `formFieldOptionCap`), truncation is an explicit result-level flag + per-record indicator. One `queue.run`. No new store, no new IPC channel, no persistence. Additive plain types. | PASS — new tool + new module recorded in Complexity Tracking |
| **IV. User-Held Credentials** | A credential field (`type="password"` or a credential `autocomplete`, i.e. exactly what `credential-field` matches) is listed, but its `currentValue` is **omitted entirely** — not redacted in place, so payload length cannot leak the secret's length (spec Edge Cases, FR-005, SC-005). | PASS |
| **V. Assistive Pace, Not Bulk Collection** | One bounded snapshot of one page the human opened. `read_page` stays the verbatim accessor; this is a derived view and does not replace it (FR-015). Every `label` and every option `label`/`value` is verbatim page text — never summarised, paraphrased, or reordered within its list (FR-011). One payload, no spill-to-file. Nothing written to the shared data directory; the payload is the only copy (FR-013). Not a crawl, not third-party bulk extraction. | PASS |

**Architecture Constraints**: MCP remains the only session bridge — this is one more read accessor of the kind the constitution already enumerates (`read_page`, `list_open_tabs`, …). No dependency on `hyppograph`. No writes to the shared data directory. Stack unchanged.

**Result**: PASS. No amendment. The 6 → 7 tool-count change and the new module are justified in Complexity Tracking and must be called out at review (Principle III). Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/005-read-form-fields/
├── plan.md              # This file
├── spec.md              # Feature spec (input)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── read-form-fields.md   # Phase 1 output — tool I/O contract
└── checklists/
    └── requirements.md  # Spec quality checklist (present, 16/16)
```

### Source Code (repository root)

```text
src/
├── main/
│   ├── config.ts            # + formFieldControlCap: 200 (env HYPPO_FORM_FIELD_CONTROL_CAP)
│   │                        # + formFieldOptionCap: 200  (env HYPPO_FORM_FIELD_OPTION_CAP)
│   ├── page/
│   │   └── form-fields.ts   # NEW — readFormFields(wc, tabId, containerSelector?, observedAt)
│   │                        #   : Promise<FormFieldMap>. One isolated-world collector script
│   │                        #   walks the DOM → raw per-control descriptors (+ options, +
│   │                        #   currentValue, + synthesised selector); main process attaches
│   │                        #   fillVerdict / clickVerdict via the shared pure verdict fns.
│   ├── safety/
│   │   └── blocklist.ts     # extract the accessible-name SOURCE list shared by DESCRIPTOR_BODY
│   │                        #   so the reader's verbatim label uses the *same* sources;
│   │                        #   + pure fillVerdictFor(d) / clickVerdictFor(d): FieldVerdict
│   │                        #   (matchBlocklist + isSafeFillTarget, the exact interact logic)
│   └── mcp/
│       └── tools.ts         # register "read_form_fields" (7th tool); update the header
│                            #   comment ("Six tools" → "Seven tools"); wrap in queue.run
├── shared/
│   └── types.ts             # + FormFieldMap, FormFieldRecord, FieldOption, FieldVerdict
└── main/index.ts            # e2e-only handle: readFormFields(tabId, containerSelector?)

tests/
├── unit/
│   └── form-fields.test.ts  # kind mapping; selector-preference + synthesis + uniqueness;
│                            #   fillVerdictFor/clickVerdictFor parity with matchBlocklist;
│                            #   credential currentValue omission; cap/truncation flags
├── integration/
│   └── read-form-fields.spec.ts  # US1–US4 end to end against the fixture app
└── fixtures/
    └── form.html            # + a second <form> (US4 scoping), an id-less & name-less input
                             #   (selector synthesis), a radio group in a <fieldset> (group)
```

**Structure Decision**: Single-project Electron layout, established. The new module
`form-fields.ts` sits beside `read.ts` and `interact.ts` under `src/main/page/`. The verdict
logic is a pure addition to `blocklist.ts` (the one module that owns the rule set), so the
reader and `interact` cannot diverge. Everything else is additive: two config numbers, four
types, one tool registration, one e2e handle.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|------|-----------|-------------------------------------|
| A 7th MCP tool (`read_form_fields`) rather than a mode on `read_page` | FR-015 keeps `read_page` the verbatim page-text/DOM accessor; the spec calls this an explicitly *derived* view with its own contract (filtered, reordered, annotated with verdicts and options). Folding a "structured" mode into `read_page` would make one tool return two incompatible payload shapes and blur "verbatim" vs "derived". | A `read_page` flag — rejected: two payload contracts under one name; the verbatim guarantee (Principle V) would no longer describe the whole tool. A local-parsing helper shipped to the agent — rejected: that is the status quo this feature removes. |
| New module `src/main/page/form-fields.ts` (a large in-page collector script) | The DOM walk, per-control descriptor assembly, options extraction, and selector synthesis are substantial and page-side; they do not belong in `tools.ts` (registration only) or `read.ts` (verbatim reader, must stay tiny). | Extending `read.ts` — rejected: `read.ts` is deliberately ~50 lines of "return raw content, no parsing"; a DOM-structuring walk is the opposite of its contract. |
| Pure `fillVerdictFor(d)` / `clickVerdictFor(d)` added to `blocklist.ts` | SC-004 requires 100% agreement between the reported verdict and what `interact` returns. The only way to guarantee that is to compute both from one function over one descriptor. `interact`'s fill path is two steps (`matchBlocklist` then `isSafeFillTarget`); the reader must replay exactly those. | Re-deriving the verdict in `form-fields.ts` — rejected: two copies of a rule sequence drift. Waiting for `004`'s `resolveFillTarget` — rejected: `004` is a separate branch and its helper takes a live `(wc, selector)`, not a descriptor; the pure descriptor-level core belongs in `blocklist.ts` and `004` can adopt it on merge. |
| Extract the accessible-name **source list** shared by `DESCRIPTOR_BODY` | FR-004 says the reader's `label` uses the *same* sources as the safety layer's name, but FR-011 says it must be verbatim (the safety `name` is lowercased + space-collapsed). One shared source list, two consumers (safety lowercases; reader keeps casing) keeps them from diverging. | A second independent label assembly in `form-fields.ts` — rejected: it would silently fall out of sync with `DESCRIPTOR_BODY` when either changes. |

## Phase 0 — Research

See [research.md](./research.md). No open `NEEDS CLARIFICATION`: the spec's Assumptions fix
the caps (200 / 200), the selector preference order, the whole-page default scope, the
"combobox options only when their elements are in the DOM" rule, and the read-only /
no-amendment posture. Research records R1 (new tool vs. mode), R2 (module + collector script
shape), R3 (selector synthesis algorithm), R4 (`kind` mapping table), R5 (options
extraction, `<select>` vs combobox), R6 (config caps), R7 (`currentValue` rules + credential
omission), R8 (shared accessible-name sources), R9 (e2e handle), R10 (no audit entry).

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — `FormFieldMap`, `FormFieldRecord`, `FieldOption`,
  `FieldVerdict`; the two config caps; the `kind` value set; `currentValue` rules;
  selector-synthesis output flags.
- [contracts/read-form-fields.md](./contracts/read-form-fields.md) — MCP `read_form_fields`
  input (`tabId`, optional `containerSelector`) and output (`FormFieldMap`), the empty-list
  and container-not-found behaviours, truncation shape, and the verdict-parity contract.
- [quickstart.md](./quickstart.md) — runnable validation for US1–US4 plus the SC checks
  (selector resolution, verdict parity across every rule category, no credential value, no
  spill-to-file, no shared-dir write, feeds a clean `004` batch).

### Post-Design Constitution Re-Check

**PASS.** The design adds no code path that acts on a page — `readFormFields` only calls
`wc.executeJavaScript` with a read-only collector and then runs pure functions. Verdicts come
from `blocklist.ts` unchanged in meaning. Credential `currentValue` is dropped at the
collector before the payload is built. Caps and truncation flags are in the contract. The
new tool and module are the only surface growth and are recorded above. No amendment.
