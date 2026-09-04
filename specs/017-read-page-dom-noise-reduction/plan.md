# Implementation Plan: Read Page DOM Noise Reduction

**Branch**: `017-read-page-dom-noise-reduction` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-read-page-dom-noise-reduction/spec.md`

## Summary

When a caller requests `read_page`'s optional DOM content, strip `<script>`, `<style>`, and
HTML comment nodes plus `class`/`style` attributes from the returned markup before
serialization — deterministically, in the isolated-world in-page script, before `outerHTML` is
read — since a fixed strip-list requires no understanding of page content (Principle II). This
applies **by default** whenever `includeDom` is requested (Clarifications: `includeDom` is
itself already an explicit opt-in, and reduction is defined to never drop visible text or
non-presentational attributes, so a reduced-by-default DOM stays self-sufficient for the common
case); a caller needing fully verbatim DOM opts out with a new boolean input. The result
self-describes via a reduction indicator, mirroring feature 016's `scopedTo` field. Composes
with 016's `selector` scoping: reduction applies to whatever subtree scoping already selected.
`tests/fixtures/dom-noise-repro.html` (already committed) is the acceptance fixture.

## Technical Context

**Language/Version**: TypeScript 5.7, ESM, Node ≥ 22

**Primary Dependencies**: Electron (`WebContents.executeJavaScript`, isolated world); no new
runtime dependency. The stripping is plain DOM traversal (`querySelectorAll`,
`removeAttribute`, `.remove()`) done inside the same in-page script `readPageScript()` already
builds — no serialization library, no HTML parser.

**Storage**: N/A — read results are never persisted (Principle V); unchanged by this feature.

**Testing**: vitest (`tests/unit`) + Playwright `_electron` (`tests/integration`)

**Target Platform**: macOS desktop (Electron); Linux/Windows for dev

**Project Type**: Single-project Electron app (main / preload / renderer / shared)

**Performance Goals**: no new goal — stripping is a single pass over the already-serialized
subtree's elements before `outerHTML`, on the same order of cost as the `outerHTML` call
itself; SC-001's ≥50%-smaller target is satisfied by construction for DOM shapes matching the
measured real-world evidence (script/style/comment removal is O(1) for typical pages; the
`class`/`style` sweep is O(elements in the subtree)).

**Constraints**: Principle V — a reduced DOM MUST never drop visible text or non-presentational
attributes (FR-005/FR-006); an opted-out (verbatim) DOM read MUST remain byte-for-byte
identical to today's `includeDom: true` output (FR-002, User Story 2's compatibility
guarantee). Principle II — the strip-list (`<script>`, `<style>`, comments, `class`, `style`)
is fixed and predetermined, never content-aware.

**Scale/Scope**: ~4 files touched, ~60 LOC (schema + script + result field + tests). No new
module: `read.ts`'s `readPageScript()` gains an in-page reduction pass; no change to
`selector-syntax.ts` (reduction is independent of selector resolution).

## Constitution Check

*GATE: re-checked after Phase 1 design — still passing.*

| Principle | Assessment |
|---|---|
| **I — Human does every external act** | PASS, no amendment. Reduction only changes how already-permitted DOM output is serialized; no new act, no submit/consent/credential/outward control is touched. |
| **II — Zero business logic** | PASS. The strip-list (`<script>`, `<style>`, HTML comments, `class`, `style` attribute) is fixed at build time and requires no understanding of page content — removing a script tag or a styling attribute is structural, the same category as 016's CSS selector match. |
| **III — Solid and comprehensible** | PASS. Smallest mechanism: extends `readPageScript()`'s in-page script with one traversal pass and `read_page`'s schema with one boolean input; no new module, no new error code, no new persistent state. |
| **IV — User-held credentials** | PASS. No credential handling; reduction only removes markup, never adds exposure. |
| **V — Assistive pace, verbatim/self-sufficient reads** | PASS, with the same explicit framing 016 used. Reduction is lossy by construction, so it MUST self-describe (FR-007/FR-008) and MUST always be reversible by an explicit opt-out that reproduces today's exact `includeDom` output (FR-002, User Story 2). Defaulting reduction to **on** is deliberately scoped to DOM output alone: `includeDom` is already an explicit ask, and FR-005/FR-006 guarantee no visible text or non-presentational attribute is ever dropped, so the reduced default stays self-sufficient for the common "understand structure" case while the verbatim guarantee remains one explicit call away. This is recorded as a resolved Clarification in spec.md, not an unreviewed default — no constitution amendment required, since it does not touch the plain-text output path (already unaffected, `innerText`-based) and does not weaken the always-available verbatim path. |

**No entries in Complexity Tracking** — no violations, no amendment needed.

## Project Structure

### Documentation (this feature)

```text
specs/017-read-page-dom-noise-reduction/
├── plan.md              # this file
├── research.md          # Phase 0 — strip-list decisions, in-page traversal approach, indicator naming
├── data-model.md         # Phase 1 — PageReadResult field addition; no persisted entities
├── quickstart.md         # Phase 1 — manual + automated validation walkthrough using dom-noise-repro.html
├── contracts/
│   └── read-page-noise-reduction.md   # read_page request/response shape with the new input/indicator
├── checklists/           # (exists)
└── tasks.md              # Phase 2 — /speckit-tasks, NOT created here
```

### Source Code (repository root)

```text
src/
├── shared/
│   └── types.ts                 # PageReadResult + a reduction indicator field
├── main/
│   ├── page/
│   │   ├── read.ts              # readPageScript() gains an in-page DOM-reduction pass;
│   │   │                        #   readPage() takes the new opt-out input; selector-syntax.ts
│   │   │                        #   untouched (reduction is independent of selector resolution)
│   │   └── selector-syntax.ts   # unchanged
│   ├── mcp/
│   │   └── tools.ts             # read_page schema: + reduction opt-out boolean input
│   └── index.ts                 # __hyppo.read(...) e2e test handle gains the new param
└── (no preload/renderer changes — read_page is MCP-only, no chrome UI surface)

tests/
├── unit/
│   └── read-page-noise-reduction.test.ts   # NEW — readPageScript() reduction-pass unit coverage
│                                             #   (script/style/comment removal, class/style removal,
│                                             #   text preserved, non-presentational attrs preserved)
├── integration/
│   └── read-page.spec.ts                    # EXTENDED — US1/US2/US3 acceptance scenarios against
│                                             #   tests/fixtures/dom-noise-repro.html (already committed)
└── fixtures/
    └── dom-noise-repro.html                 # already exists (issue 008) — the acceptance fixture
```

**Structure Decision**: Same single-project layout 016 used — this feature touches only the
`main/page` and `main/mcp` layers already responsible for `read_page`. No new module, no
renderer or preload change. `tests/integration` is the primary proving ground via
`dom-noise-repro.html`'s byte-measurable before/after comparison; `tests/unit` covers the
reduction pass's element/attribute-level behavior more cheaply, mirroring how
`read-page-selector.test.ts` covered 016's script builder.

## Complexity Tracking

No Constitution violations — table intentionally empty.
