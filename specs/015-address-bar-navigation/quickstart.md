# Quickstart — Address Bar Reflects and Navigates the Active Tab

Validation guide for feature 015. Covers the manual walkthrough and the automated specs
that must pass. Implementation detail lives in `plan.md` / `research.md`; contract detail in
`contracts/`.

## Prerequisites

```bash
npm install
npm run build          # tsc (main + renderer) + copy-assets
```

- macOS/Linux/Windows dev machine with a display for the manual run.
- No network needed for the automated specs (local fixture server).

---

## Manual walkthrough

```bash
npm start              # builds + launches Electron
```

### US1 — the bar reflects the active tab

1. In the address bar type a URL (e.g. `https://example.com`) and press **Enter**.
   Since no tab is open yet, a tab opens. ✅ The bar now shows `https://example.com/`
   (post-redirect / normalised form).
2. Open a second tab: type another URL and click the **"+"** button. ✅ A second tab opens
   and becomes active; the bar shows the second URL; the first tab is unchanged.
3. Click the first tab in the strip (or pick it from the dropdown). ✅ The bar switches to
   the first tab's URL with no perceptible delay (SC-001).
4. In the active tab, click a link that redirects. ✅ Within ~1 s of the load settling the
   bar shows the final URL (SC-005).
5. Close tabs until none remain. ✅ The bar goes empty and shows its placeholder (FR-002).

### US2 — Enter navigates the active tab in place

6. With one tab active, select the bar, replace the URL, press **Enter**. ✅ The **same**
   tab loads the new page; the tab count does not change; it is still the active tab
   (SC-002). Repeat with the **→** button — same result (in-place, not a new tab).
7. Enter `ftp://example.com` and press Enter. ✅ Refused with a notice; the tab stays on
   its current page (US2 scenario 2).
8. Enter a well-formed URL on a dead port. ✅ The tab shows its failed-load state and a
   notice; **no** new tab is created (US2 scenario 3, FR-009).
9. After a successful in-place navigation, open the connection panel (hippo button) →
   the entered URL is in the recent-URLs list; open the address bar dropdown and confirm
   it appears (FR-010). A refused or failed navigation adds nothing.

### US3 — open a new tab while a tab is active

10. With a tab active, type a URL and click **"+"**. ✅ A second tab opens and activates;
    the first tab's page is untouched (US3 scenario 1).

### FR-003 — an edit in progress is not clobbered

11. With a tab active, click into the address bar and start typing a new URL (do **not**
    press Enter). While the caret is in the field, trigger a background change — e.g. have
    the agent `navigate` the active tab, or let a redirect land. ✅ Your typed text stays
    exactly as you left it (US1 scenario 4).
12. Now click a **different tab** without submitting. ✅ The edit is discarded; the bar
    shows the newly-active tab's URL (edge case — an unsubmitted edit is not carried
    between tabs).
13. Click into the bar, clear it, click away (blur) without pressing Enter. ✅ The bar
    snaps back to the active tab's URL; nothing navigates, no new tab.

---

## Automated validation

```bash
npm run test           # vitest — unit
npm run test:e2e       # Playwright _electron — integration
npm run lint
```

### Must pass — new

- **`tests/integration/address-bar-navigation.spec.ts`** (new):
  - *US1*: open two tabs on different fixture URLs; switch via the strip and the
    `#tabselect` dropdown; assert `#address` value each time. Trigger `/redirect` in the
    active tab; assert `#address` updates to the landing URL. Close all; assert `#address`
    is `""`.
  - *US2*: one tab open; `#address` fill + Enter; assert `hyppo.listTabs()` count
    unchanged, active tab URL changed, still active. Repeat via `#go` click. Enter a
    non-http URL; assert an error notice and the tab unchanged. Enter a dead-port URL;
    assert failed state + notice + still one tab. Enter a link-shim-wrapped URL; assert the
    active tab lands on the unwrapped target in place (FR-008). Assert the successful
    entered URL lands in `#recent-urls`.
  - *US3*: one tab open; fill `#address`; click `#newtab`; assert a second tab exists and
    is active and the first tab's URL is unchanged.
  - *FR-003*: focus `#address`, type; drive `__hyppo.navigate(activeTabId, otherUrl)` in
    the background; assert `#address` still holds the typed text. Then click the other tab;
    assert `#address` now shows that tab's URL.

- **`tests/unit/tab-manager-navigate-active.test.ts`** (new, *only if* `TabManager` is
  unit-reachable without a window — see research R4): `NO_ACTIVE_TAB` when none active; the
  URL passed to `onPersonOpen` is the validated entered URL, not the landing URL; no
  `onPersonOpen` on a failed load.

### Must still pass — unchanged

- `tests/integration/recent-urls.spec.ts` — the `#address` clear-after-open behaviour
  (`toHaveValue("", …)`) must still hold for the **new-tab** path (`openUrl`); only the
  navigate-in-place path skips the forced clear.
- `tests/integration/open-url.spec.ts`, `close-all-tabs.spec.ts`,
  `instance-management.spec.ts` — anything asserting on `tabs:changed` / the tab strip must
  survive the payload shape change (`{ tabs, activeTabId }`).
- `tests/unit/mcp-tools.test.ts` — the MCP `navigate` tool path is untouched; confirm no
  regression.

---

## Definition of done

- [ ] `#address` reflects the active tab's post-redirect URL on activation, redirect, and
      agent navigation; empty with placeholder when no tab is open.
- [ ] Enter and → navigate the active tab in place (0 new tabs); with no tab, they open a
      new tab.
- [ ] The "+" button opens a new tab without disturbing the active tab, and is always
      present with the address row.
- [ ] Person-initiated navigation obeys URL policy + link-shim unwrapping + failed-load
      messaging identically to opening a new tab, with no silent new-tab fallback.
- [ ] A successful person-initiated navigation is recorded in recent-URLs; a refused or
      failed one is not.
- [ ] An in-progress edit (input focused) survives a background refresh; switching tabs
      discards it.
- [ ] Placeholder text reflects the resolved behaviour (FR-011).
- [ ] `npm run lint`, `npm run test`, `npm run test:e2e` all green.
- [ ] PR description notes the new `chrome:navigate-active` IPC channel and the
      `tabs:changed` payload change for the Principle III review gate.
