# Contract amendment — `read_page` MCP tool, `reduceDom`/`includeDom` correctness fixes

**Direction**: MCP client (orchestrator) → HyppoVisor MCP server

**Changed by**: feature 018. Amends feature 017's contract
(`specs/017-read-page-dom-noise-reduction/contracts/read-page-noise-reduction.md`) — no
request field, response field, or error code is added, removed, or renamed. This document
records only the two behavioral corrections; it does not restate unchanged behavior (see the
017 contract for the full request/response shape).

---

## Correction 1 — root-element removal (FR-001, FR-002)

**Before (017, as shipped)**: When `selector` resolves directly to a node that is itself a
removal target (`<script>`, `<style>`, or `svg[aria-hidden="true"]`), reduction only swept
*descendants* of that node (`clone.querySelectorAll(...)` never matches the calling element
itself). The root's own markup was returned unstripped in `dom`, contradicting the "no
`<script>`/`<style>`/decorative-`<svg>` markup in `dom`" guarantee (017 contract, Behaviour
step 3b/3c).

**After (018)**: The same removal predicates (tag name is `script`/`style`, or the element
matches `svg[aria-hidden="true"]`) are additionally checked against the root node before any
descendant sweep. If the root matches, `dom` is the empty string `""` — the same value
removal already produces when a non-root node is fully stripped from within a larger subtree.
`text`, `url`, `title`, `domReduced`, and all other fields are computed exactly as they are
today, unaffected by `dom` being empty.

| Scenario | `dom` (017, before) | `dom` (018, after) |
|---|---|---|
| `selector: "script"` matching a `<script>` element | script markup present (bug) | `""` |
| `selector` matching a root `<style>` element | style markup present (bug) | `""` |
| `selector` matching a root `svg[aria-hidden="true"]` | icon markup present (bug) | `""` |
| Same three cases, `reduceDom: false` | unaffected (escape hatch) | unaffected (escape hatch) |

## Correction 2 — no reduction work when `includeDom` is false (FR-009, FR-010)

**Before (017, as shipped)**: `readPageScript(selector, reduceDom)` always emitted a script
that computed `dom` (via `__reduceDom` when `reduceDom` was true) regardless of whether the
caller requested it; `readPage()` discarded the computed `dom` before attaching it to the
response when `includeDom` was `false`. Response fields were correct, but the in-page script
paid for a full clone + `TreeWalker` comment pass + attribute-strip loop for a value the
caller never sees.

**After (018)**: `readPageScript` additionally takes `includeDom`. When `includeDom` is
`false`, the emitted script computes only `text` (`url`/`title` unchanged) and never
references `__reduceDom`, `outerHTML`, or the attribute-strip loop. Response fields and their
values are unchanged (SC-004) — this is a cost-only change, verified by SC-003's relative
regression check rather than a new field or new error mode.

| Scenario | Response fields (before → after) | In-page cost (before → after) |
|---|---|---|
| `read_page({ tabId })`, no `includeDom` | unchanged → unchanged | full clone/reduce work → `text` only |
| `read_page({ tabId, includeDom: true })` | unchanged → unchanged | unchanged (still computes `dom`) | unchanged |

## Error codes

No new error codes. Both corrections are behavioral fixes to existing success-path output;
neither introduces a new failure mode.

## Test hooks

The e2e test handle signature (`src/main/index.ts`, `HYPPO_E2E=1`) is unchanged:
`read(tabId, includeDom = false, selector?: string, reduceDom = true)`.
