# Contract — `read_page` MCP tool, `reduceDom` extension

**Direction**: MCP client (orchestrator) → HyppoVisor MCP server

**Changed by**: feature 017. Extends the existing `read_page` tool (`src/main/mcp/tools.ts`);
no new tool is added. Composes with feature 016's `selector` field (unchanged by this feature).

---

## Request

Existing fields unchanged (including 016's `selector`); one new optional field added.

| Arg | Type | Notes |
|---|---|---|
| `tabId` | `string` | unchanged |
| `includeDom` | `boolean`, optional, default `false` | unchanged |
| `selector` | `string`, optional | unchanged (feature 016) |
| `reduceDom` | `boolean`, optional, default `true` | **NEW**. Only meaningful when `includeDom` is `true`. When `true` (or omitted), the returned `dom` has noise reduction applied (script/style/comment nodes and `class`/`style` attributes removed). When `false`, `dom` is returned exactly as it was before this feature existed. |

## Behaviour

1. Runs inside `queue.run(...)`, exactly as today — unchanged.
2. `includeDom` not requested → `reduceDom` has no effect; response shape unchanged
   (no `dom`, no `domReduced`).
3. `includeDom: true`, `reduceDom` omitted or `true` (the default):
   a. The subtree that would have been serialized (the whole page, or a 016 `selector` match)
      is cloned (`cloneNode(true)`) before any mutation — the live page is never altered.
   b. `<script>`, `<style>` elements and comment nodes are removed from the clone.
   c. `class` and `style` attributes are removed from every element in the clone.
   d. No text node, no non-`class`/`style` attribute, and no element is removed for being
      emptied by the above steps.
   e. The clone's `outerHTML` becomes `dom`; the result includes `domReduced: true`.
4. `includeDom: true`, `reduceDom: false`:
   a. `dom` is exactly the subtree's `outerHTML`, with no reduction — byte-for-byte identical
      to this feature's pre-existing behavior.
   b. The result does not include `domReduced` (FR-008).
5. Existing size limits and truncation (`config.maxDomBytes`, `truncated.dom`) apply unchanged,
   applied to whichever string (reduced or verbatim) was produced.
6. `text` is entirely unaffected by `reduceDom` in every case — the plain-text output path is
   unchanged by this feature.

## Response (resolve) — `PageReadResult`

```ts
interface PageReadResult {
  tabId: string;
  url: string;
  title: string;
  text: string;
  dom?: string;
  observedAt: string;
  truncated: { text: boolean; dom: boolean };
  queueDepth: number;
  scopedTo?: string;     // unchanged (feature 016)
  domReduced?: boolean;  // NEW — present and true only when `dom` is present and was reduced
}
```

## Response (reject) — `HyppoError`

No new error codes. This feature introduces no new failure mode: `reduceDom` is a plain
boolean with no invalid values beyond normal type validation (handled by the existing MCP
schema layer, same as `includeDom`).

---

## Compatibility guarantee (FR-002, User Story 2, SC-002)

Every existing caller of `read_page` that passes `reduceDom: false` (or, before this feature
existed, any caller of `includeDom: true`) observes **zero** change in `dom` content, size, or
fields versus this feature's pre-existing behavior. Callers that omit `reduceDom` (the new
default) will observe `dom` shrink and gain a `domReduced: true` field — this is the feature's
intended, deliberate default (Clarifications), not a compatibility break for callers that
explicitly opt out.

## Test hooks

The e2e test handle (`globalThis.__hyppo`, `HYPPO_E2E=1`) exposes
`read(tabId, includeDom = false, selector?: string)` (`src/main/index.ts`, as of feature 016).
This feature adds a fourth optional parameter:
`read(tabId, includeDom = false, selector?: string, reduceDom = true)`, forwarding to
`readPage(wc, tabId, includeDom, depth, selector, reduceDom)`.
