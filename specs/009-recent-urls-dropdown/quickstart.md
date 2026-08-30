# Quickstart / Validation: Recent-URLs Dropdown

Runnable checks proving the feature end-to-end. Offline, against local fixtures.

## Prerequisites

```bash
npm install
npm run build
```

Integration tests launch the real app with `HYPPO_USER_DATA_DIR` pointed at a throwaway
directory so `recent-urls.json` is isolated per test. Fixture pages
(`tests/fixtures/static.html`, `redirect.html`, plus a non-resolving URL) stand in for real
sites.

## 1. Unit — the list rules

```bash
npx vitest run tests/unit/recent-urls.test.ts
```

Expect:

- `addRecentUrl([], "a", 20)` → `["a"]`.
- `addRecentUrl(["a","b"], "b", 20)` → `["b","a"]` (moved to front, still length 2).
- `addRecentUrl(["a","b","c"], "d", 3)` → `["d","a","b"]` (oldest evicted).
- `addRecentUrl(["a"], "a", 20)` → `["a"]` (idempotent at front).
- `loadRecentUrls` on: no file → `[]`; `"{}"` → `[]`; `'["a", 3, ""]'` → `[]`; a valid
  array → that array. None of these rewrite the file.
- `saveRecentUrls` then `loadRecentUrls` round-trips; no `*.tmp` left behind.

## 2. Integration — record, persist, filter

```bash
npx playwright test tests/integration/recent-urls.spec.ts
```

Expect:

- **Person open, live update**: type `static.html`'s URL into `#address`, Open; once the tab
  loads, the `<datalist id="recent-urls">` contains that URL — without re-focusing.
  Open a second URL; the datalist shows both, the newest first.
- **Move to front, no dup**: re-open the first URL; it is now first and appears once.
- **Restart persistence**: relaunch the app with the same `HYPPO_USER_DATA_DIR`; the
  datalist is populated identically on load.
- **Agent open excluded**: call `open_url` (MCP) for a URL not otherwise visited; it does
  **not** appear in the datalist.
- **Failed load excluded**: type a non-resolving URL, Open; after the load fails, it does
  **not** appear in the datalist.
- **Redirect**: open `redirect.html` (which 302s elsewhere); the datalist holds the entered
  URL, not the landing URL.
- **Corrupt file**: pre-write `recent-urls.json` as `not json`; launch; the app starts, the
  datalist is empty, and the file is untouched until the next person-open.
- **Clear button**: with a non-empty history, click "Clear recent URLs" in the connection
  panel; the datalist empties immediately and `recent-urls.json` is a valid `[]`.

## 3. No regression

```bash
npm run build && npm run lint && npm test && npm run test:e2e
```

Existing top-bar, tab, connection-panel, and MCP e2e all still pass (`test:e2e` needs local
port 7357 free). Confirm `settings.json` is unaffected by any recent-URL operation.

## 4. Docs

- `README.md` lists `recent-urls.json` in the "what the app writes to the user-data area"
  inventory and mentions the address-bar dropdown + the panel clear action.
