# Contract — `chrome:navigate-active` IPC route

**Direction**: renderer → main (`ipcRenderer.invoke` / `ipcMain.handle`)

**Added by**: feature 015. Sibling of `chrome:open-url` and `chrome:reload-tab`.

**Preload exposure**: `window.hyppo.navigateActive(url: string): Promise<NavigateActiveResult>`

---

## Request

| Arg | Type | Notes |
|---|---|---|
| `url` | `string` | The raw address the person entered. Trimmed by the renderer before sending. May be a link-shim / redirect-interstitial URL — it is unwrapped in main before validation (feature 002), same as `open_url`. |

## Behaviour

1. Runs inside `queue.run(...)` — obeys the app-wide one-load-at-a-time rule (Constitution V).
2. Delegates to `TabManager.navigateActive(url)`:
   - no active tab → rejects `NO_ACTIVE_TAB` (renderer normally prevents this call when no
     tab is active; the guard is defence in depth);
   - `unwrapUrl(url)` → `validateUrl(resolved)` → load the **active** tab in place;
   - the tab keeps its id and stays the active tab; **no new tab is created**;
   - on success (`loadState === "loaded"`) fires `onPersonOpen(validatedEnteredUrl)` →
     feeds feature 009's recent-URLs history;
   - never falls back to opening a new tab on failure (FR-009).

## Response (resolve)

```ts
interface NavigateActiveResult {
  tabId: string;        // the active tab — unchanged identity
  url: string;          // post-redirect URL after the load settled
  title: string;
  loadState: "loaded";  // "failed" is delivered as a rejection, not here
  queueDepth: number;
}
```

## Response (reject) — `HyppoError`, `code` in `.message`

| `code` | Meaning | Renderer surface |
|---|---|---|
| `INVALID_URL` | not an absolute URL | error notice; tab stays on current page |
| `SCHEME_NOT_ALLOWED` | scheme not http/https | error notice; tab stays on current page |
| `LOAD_FAILED` | valid URL, load failed | error notice; active tab shows its `failed` load state (US2 scenario 3) |
| `NO_ACTIVE_TAB` | no tab active when the handler ran | error notice; person retries (bar is now empty → next submit opens a new tab) |

Policy, unwrapping, and messaging are **identical to `chrome:open-url`** (FR-008) — the
same `unwrapUrl` + `validateUrl` + `load` path is reused.

---

## Test hooks

The e2e test handle (`globalThis.__hyppo`, `HYPPO_E2E=1`) already exposes
`navigate(tabId, url)` → `TabManager.navigate` (agent path). This feature's integration
spec drives the **renderer** path (`window.hyppo.navigateActive` via the address bar), so
no new test-handle method is required. Add one (`navigateActive(url)`) only if a spec needs
to call it without going through the DOM.
