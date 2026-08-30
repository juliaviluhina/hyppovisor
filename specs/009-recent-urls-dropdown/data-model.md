# Phase 1 Data Model: Recent-URLs Dropdown

One persisted entity. No cross-boundary type beyond `string[]`.

---

## Recent-URL history

| Property | Value |
|---|---|
| Shape | ordered list of URL strings |
| Order | most-recent-first (index 0 = most recently opened) |
| Length | 0 … `config.recentUrlsCap` (default 20) |
| Uniqueness | no two entries equal as exact strings |
| Entry value | the URL the person entered, after `validateUrl` normalization; never a page title, timestamp, or redirect target |
| Writer | `TabManager.onPersonOpen` → `addRecentUrl` → `saveRecentUrls` (one write per person-open that reached `loaded`); and `chrome:clear-recent-urls` → `saveRecentUrls([])` |
| Readers | `chrome:recent-urls` (renderer datalist), the panel clear button's enabled state, anyone opening the file |

### `addRecentUrl(list, url, cap)` — pure

1. `next = list.filter(u => u !== url)` — remove any exact duplicate.
2. `next.unshift(url)` — newest at the front.
3. `return next.slice(0, cap)` — evict the oldest beyond the cap.

Idempotent for a URL already at the front; moves it to the front otherwise; never grows
past `cap`.

---

## File: `<userData>/recent-urls.json`

```json
[
  "https://job-boards.greenhouse.io/acme/jobs/123",
  "https://www.linkedin.com/in/someone/",
  "https://mail.google.com/"
]
```

- A JSON array of strings. Nothing else — no wrapper object, no metadata.
- Written atomically: `recent-urls.json.<pid>.tmp` → `renameSync`.
- **Load tolerance** (FR-008): file missing, unreadable, not JSON, not an array, or any
  element not a non-empty string ⇒ treated as empty history; the file is **not** rewritten
  until the next legitimate update (mirrors `loadSettings`).
- Human-readable, safe to delete by hand. Sits beside `settings.json` and
  `interaction-log.jsonl` in the app's user-data directory — **not** the shared data
  directory.

---

## IPC / preload surface (see `contracts/recent-urls.md`)

| Channel | Direction | Payload |
|---|---|---|
| `chrome:recent-urls` | renderer → main (invoke) | → `string[]` (current history) |
| `chrome:clear-recent-urls` | renderer → main (invoke) | → `void` (history emptied, push fired) |
| `recent-urls:changed` | main → renderer (send) | `string[]` (new history) — fired on every add and on clear |

Preload (`window.hyppo`): `recentUrls(): Promise<string[]>`,
`clearRecentUrls(): Promise<void>`, `onRecentUrlsChanged(cb: (list: string[]) => void)`.

---

## Config addition

| Key | Env | Default |
|---|---|---|
| `recentUrlsCap` | `HYPPO_RECENT_URLS_CAP` | `20` |
