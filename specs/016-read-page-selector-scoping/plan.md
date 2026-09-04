# Implementation Plan: Read Page Selector Scoping

**Branch**: `016-read-page-selector-scoping` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-read-page-selector-scoping/spec.md`

## Summary

Add an optional `selector` input to `read_page` so a caller can narrow a read to one
element's subtree instead of `document.body`, mirroring the `containerSelector` precedent
`read_form_fields` already established. When `selector` is supplied, both the returned text
*and* the optional DOM output (when `includeDom` is also requested) are scoped to the first
element the selector matches; the result carries a `scopedTo` field naming the selector used.
When `selector` is omitted, `read_page` is byte-for-byte unchanged from today. Invalid CSS and
"selector matches nothing" reuse the exact `INVALID_SELECTOR` / `TARGET_NOT_FOUND` error codes
and shared in-page detection helper (`selector-syntax.ts`) `read_form_fields` already uses —
no new error code, no new detection mechanism. DOM noise-reduction is explicitly out of scope
(deferred to `specs/issues/008-read-page-dom-noise-reduction.md`).

## Technical Context

**Language/Version**: TypeScript 5.7, ESM, Node ≥ 22

**Primary Dependencies**: Electron (`WebContents.executeJavaScript`, isolated world); no new
dependencies — reuses `src/main/page/selector-syntax.ts` and `src/main/page/truncate.ts`,
both already shipped for `read_form_fields` / `read_page`.

**Storage**: N/A — read results are never persisted (Principle V); unchanged by this feature.

**Testing**: vitest (`tests/unit`) + Playwright `_electron` (`tests/integration`)

**Target Platform**: macOS desktop (Electron); Linux/Windows for dev

**Project Type**: Single-project Electron app (main / preload / renderer / shared)

**Performance Goals**: no new goal — a scoped read does strictly less serialization work than
today's full-body read (SC-001's "constant size regardless of shell growth" is satisfied by
construction: `Element.innerText` / `outerHTML` of the matched node only, never the growing
sibling content).

**Constraints**: Principle V — unscoped `read_page` MUST remain byte-for-byte identical to
today (FR-002); a scoped read MUST self-describe via `scopedTo` so it is never mistaken for a
full-page capture (FR-006/FR-007). Principle II — selector matching is structural (CSS-only),
never content-aware, so it stays outside "business logic."

**Scale/Scope**: ~5 files touched, ~90 LOC (schema + script + result field + tests). No new
module: `read.ts` gains a selector-aware `READ_SCRIPT` builder, reusing
`selector-syntax.ts` exactly as `form-fields.ts` does.

## Constitution Check

*GATE: re-checked after Phase 1 design — still passing.*

| Principle | Assessment |
|---|---|
| **I — Human does every external act** | PASS, no amendment. `read_page` is already a permitted read action; selector scoping narrows *what part of the page* is read, not *what kind of act* is performed. No submit/consent/credential/outward control is touched. |
| **II — Zero business logic** | PASS. A CSS-selector match is structural narrowing — the same category `read_form_fields`'s `containerSelector` already performs — and requires no understanding of the content, only which DOM node to start from (spec issue's own framing, reused verbatim). |
| **III — Solid and comprehensible** | PASS. Smallest mechanism: extends the existing `read_page` schema and `READ_SCRIPT` with one optional string field; reuses the existing `selector-syntax.ts` helper and `INVALID_SELECTOR` / `TARGET_NOT_FOUND` error codes verbatim — no new error code, no new module, no new persistent state. |
| **IV — User-held credentials** | PASS. No credential handling; a selector can target any visible element, same exposure as an unscoped read already has (whole-page text) — narrowing reduces exposure, it does not add any. |
| **V — Assistive pace, verbatim/self-sufficient reads** | PASS, with an explicit addition: this is the exact case the spec's source issue (`specs/issues/007-read-page-selector-scoping.md`) flagged as needing a Principle V note. A selector-scoped read is *not* a reconstruction of the page's full visible text, so it MUST be opt-in (FR-001: `selector` omitted by default), MUST leave the unscoped call's guarantee untouched (FR-002), and MUST self-describe when it narrows (FR-006/FR-007: `scopedTo`). Framed this way the change is additive to Principle V, not a weakening — the unscoped guarantee is untouched and a scoped call is legible as exactly what it is. No constitution amendment required: this is a new opt-in lever on an existing permitted action, not a redefinition of what "verbatim" means for the default case. |

**No entries in Complexity Tracking** — no violations, no amendment needed.

## Project Structure

### Documentation (this feature)

```text
specs/016-read-page-selector-scoping/
├── plan.md              # this file
├── research.md          # Phase 0 — reuse decisions (selector-syntax.ts, error codes, first-match convention)
├── data-model.md         # Phase 1 — PageReadResult field addition; no persisted entities
├── quickstart.md         # Phase 1 — manual + automated validation walkthrough using chat-shell-repro.html
├── contracts/
│   └── read-page-selector.md   # read_page request/response shape with `selector` / `scopedTo`
├── checklists/           # (exists)
└── tasks.md              # Phase 2 — /speckit-tasks, NOT created here
```

### Source Code (repository root)

```text
src/
├── shared/
│   └── types.ts                 # PageReadResult + scopedTo?: string
├── main/
│   ├── page/
│   │   ├── read.ts              # READ_SCRIPT becomes selector-aware; readPage() takes `selector`;
│   │   │                        #   reuses selector-syntax.ts (__querySafe, assertSelectorValid,
│   │   │                        #   isInvalidSelectorMarker) and truncate.ts unchanged
│   │   └── selector-syntax.ts   # unchanged — reused as-is (already exported for form-fields.ts)
│   ├── mcp/
│   │   └── tools.ts             # read_page schema: + selector: z.string().optional()
│   └── index.ts                 # __hyppo.read(tabId, includeDom, selector?) e2e test handle
└── (no preload/renderer changes — read_page is MCP-only, no chrome UI surface)

tests/
├── unit/
│   └── read-page-selector.test.ts     # NEW — selector-aware READ_SCRIPT / readPage() unit coverage
│                                       #   (invalid selector, no-match, first-match, scopedTo presence)
├── integration/
│   └── read-page.spec.ts              # EXTENDED — US1/US2/US3 acceptance scenarios against
│                                       #   tests/fixtures/chat-shell-repro.html (already committed)
└── fixtures/
    └── chat-shell-repro.html          # already exists (issue 007) — the acceptance fixture
```

**Structure Decision**: The repo is a single Electron project with a fixed
`main` / `preload` / `renderer` / `shared` split. This feature touches only the `main/page`
and `main/mcp` layers already responsible for `read_page` — no new module, no renderer or
preload change, since `read_page` has no chrome UI surface (it's MCP-only, unlike feature
015's address bar). `tests/integration` is the primary proving ground because the acceptance
fixture (`chat-shell-repro.html`) exercises the full stack end-to-end; `tests/unit` covers the
selector-resolution edge cases (invalid CSS, no match, first-of-many-matches) more cheaply.

## Complexity Tracking

No Constitution violations — table intentionally empty.
