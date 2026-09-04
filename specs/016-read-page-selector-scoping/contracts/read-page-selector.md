# Contract — `read_page` MCP tool, `selector` extension

**Direction**: MCP client (orchestrator) → HyppoVisor MCP server

**Changed by**: feature 016. Extends the existing `read_page` tool (`src/main/mcp/tools.ts`);
no new tool is added. Sibling contract: `read_form_fields`'s `containerSelector`
(`src/main/page/form-fields.ts`).

---

## Request

Existing fields unchanged; one new optional field added.

| Arg | Type | Notes |
|---|---|---|
| `tabId` | `string` | unchanged |
| `includeDom` | `boolean`, optional, default `false` | unchanged |
| `selector` | `string`, optional | **NEW**. A CSS selector. When present, narrows both `text` and (if `includeDom` is also `true`) `dom` to the first matching element's subtree. When omitted, behavior is byte-for-byte identical to today. |

## Behaviour

1. Runs inside `queue.run(...)`, exactly as today — obeys the app-wide one-load-at-a-time
   rule (Constitution V). Unchanged.
2. `selector` omitted → identical to today: `text` is `document.body.innerText`, `dom` (if
   requested) is `document.documentElement.outerHTML`, no `scopedTo` field in the result.
3. `selector` supplied:
   a. Resolved via the shared `selector-syntax.ts` helper (`__querySafe` /
      `assertSelectorValid`), the same detection `read_form_fields` uses.
   b. Syntactically invalid CSS → rejects `INVALID_SELECTOR` (checked before "not found" is
      ever considered, same ordering as `read_form_fields`).
   c. Syntactically valid, matches nothing → rejects `TARGET_NOT_FOUND`.
   d. Matches one or more elements → uses the first match (document order); `text` becomes
      that element's `innerText`; `dom` (if `includeDom`) becomes that element's
      `outerHTML`.
   e. Result includes `scopedTo: selector` (the selector as supplied, not normalized).
4. Existing size limits and truncation (`config.maxTextBytes` / `config.maxDomBytes`,
   `truncated: { text, dom }`) apply unchanged to whichever string (full-page or scoped) was
   produced.

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
  scopedTo?: string;   // NEW — present only when `selector` was supplied
}
```

## Response (reject) — `HyppoError`, `code` in `.message`

| `code` | Meaning | When |
|---|---|---|
| `TAB_NOT_FOUND` | unknown/closed tab | unchanged, pre-existing |
| `INVALID_SELECTOR` | `selector` is not valid CSS | **NEW for `read_page`**; same fixed message as `read_form_fields` |
| `TARGET_NOT_FOUND` | `selector` is valid CSS but matches no element | **NEW for `read_page`**; same code as `read_form_fields`'s no-match case |

No other error codes are introduced or affected.

---

## Compatibility guarantee (FR-002, SC-002)

Every existing caller of `read_page` that never passes `selector` observes **zero** change in
request shape, response shape, response content, or error behavior. This contract is additive
only.

## Test hooks

The e2e test handle (`globalThis.__hyppo`, `HYPPO_E2E=1`) exposes
`read(tabId, includeDom = false)` (`src/main/index.ts`). This feature adds a third optional
parameter: `read(tabId, includeDom = false, selector?: string)`, forwarding to
`readPage(wc, tabId, includeDom, depth, selector)`.
