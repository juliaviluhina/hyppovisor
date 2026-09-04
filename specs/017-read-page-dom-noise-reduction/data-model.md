# Phase 1 Data Model: Read Page DOM Noise Reduction

No persisted entities — page reads are never stored (Principle V). This feature's only data
shape change is one additional field on the existing in-memory `PageReadResult`.

## `PageReadResult` (extended)

Defined in `src/shared/types.ts`; already extended once by feature 016 (`scopedTo`).

| Field | Type | Change |
|---|---|---|
| `tabId` | `string` | unchanged |
| `url` | `string` | unchanged |
| `title` | `string` | unchanged |
| `text` | `string` | unchanged — reduction does not affect the plain-text output path |
| `dom` | `string \| undefined` | unchanged shape; content is reduced by default when present (see below) |
| `observedAt` | `string` | unchanged |
| `truncated` | `{ text: boolean; dom: boolean }` | unchanged — truncation is applied to `dom` after reduction, same size limit as today |
| `queueDepth` | `number` | unchanged |
| `scopedTo` | `string \| undefined` | unchanged (feature 016) |
| **`domReduced`** | `boolean \| undefined` | **new** — `true` when `dom` is present and was returned with noise reduction applied; absent when `dom` is absent (no DOM requested) or reduction was explicitly opted out (research.md R4) |

## Request shape (`read_page` MCP tool input, extended)

| Field | Type | Change |
|---|---|---|
| `tabId` | `string` | unchanged |
| `includeDom` | `boolean` (default `false`) | unchanged |
| `selector` | `string \| undefined` | unchanged (feature 016) |
| **`reduceDom`** | `boolean` (default `true`) | **new** — when `includeDom` is requested, controls whether the returned `dom` has noise reduction applied (research.md R5). Has no effect when `includeDom` is not requested. |

## In-page reduction pass (internal, not a persisted/serialized entity)

Not part of any external contract, but documented here since it's the core transform this
feature adds, operating on a `Node` subtree already resolved by the existing (016) selector
logic:

1. Clone the resolved subtree (`cloneNode(true)`) — the live page is never mutated
   (research.md R2).
2. Remove every `<script>` and `<style>` element found within the clone.
3. Remove every `<svg>` element matching `[aria-hidden="true"]` found within the clone —
   decorative icon graphics the page itself already marked as carrying no accessible content
   (research.md R7, FR-011). An `<svg>` without `aria-hidden="true"` (e.g. one carrying
   `role="img"` + `aria-label`) is left untouched.
4. Remove every comment node found within the clone (`TreeWalker` + `SHOW_COMMENT`,
   research.md R3).
5. Remove the `class` and `style` attributes from every element in the clone, including the
   clone's own root element if present.
6. Serialize the clone's `outerHTML` (or, for the plain-text path, the *original*, unreduced
   element's `innerText` — the plain-text output is never passed through this pass; it is
   already noise-free via native `innerText` behavior).

This pass never removes text nodes, never removes non-`class`/`style` attributes, never removes
an `<svg>` unless it is itself marked `aria-hidden="true"`, and never removes an element solely
because it became attribute-less or content-empty after stripping (FR-005/FR-006 — an emptied
element still describes structure and stays in the output).
