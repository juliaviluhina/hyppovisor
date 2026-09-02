# Phase 0 Research — Address Bar Reflects and Navigates the Active Tab

All Technical Context items were known from the existing codebase; there were no
`NEEDS CLARIFICATION` markers (the one open question, FR-006's new-tab affordance, was
settled in the spec's 2026-09-01 clarify session). This document records the design
decisions that shape Phase 1.

---

## R1 — How the renderer learns the authoritative active tab

**Decision**: Change the `tabs:changed` IPC event payload from a bare `TabSummary[]` to
`{ tabs: TabSummary[]; activeTabId: string | null }`. Add a `get activeTabId()` getter to
`TabManager`. The renderer sets its `activeId` from `activeTabId` on every event and drops
its current "if activeId is unknown, guess the last tab" heuristic
(`src/renderer/app.ts:155-160`).

**Rationale**:
- `TabSummary` has no `active` field and `tabs:changed` currently sends only the array, so
  the renderer *guesses* which tab is active. That guess is wrong exactly in the cases this
  feature must get right: rapid tab switching (spec edge case — "the input always ends on
  the finally-active tab's URL"), and activation changes driven by the agent or by closing
  a tab.
- `TabManager` already holds the true `activeId` (`tab-manager.ts:39`) and already fires
  `onChange` on every activation, load-state change, redirect, and title update — the
  address bar needs no new event, just the active id on the existing one.

**Alternatives considered**:
- *Add `active: boolean` to `TabSummary`.* Rejected: `TabSummary` is also the return shape
  of the MCP `list_open_tabs` tool (`src/shared/types.ts:7`, feature 001). Adding a field
  there is an MCP contract change, which FR-012's scope guard tells us to avoid. Keeping
  the change on the renderer-only IPC event confines it to the chrome boundary.
- *A separate `active-tab:changed` event carrying just the id.* Rejected: two events that
  always fire together is more moving parts for no benefit (Principle III — smallest
  mechanism).

**Ripple**: three `send("tabs:changed", tabs.list())` call sites in `index.ts`
(the `onChange` wiring at ~:223, and two explicit `send("tabs:changed", tabs.list())` after
`win.loadFile` at ~:474 and in the e2e branch). All change to
`send("tabs:changed", { tabs: tabs.list(), activeTabId: tabs.activeTabId })`. `chrome.cjs`
`onTabsChanged` forwards the object; `app.ts` destructures it.

---

## R2 — Navigating the active tab in place

**Decision**: Add `async navigateActive(rawUrl: string): Promise<TabSummary>` to
`TabManager`. It:
1. throws `HyppoError("NO_ACTIVE_TAB", …)` if `this.activeId` is null;
2. runs `unwrapUrl` → `validateUrl` → `recordUnwrap` → `load(tab, url)` — the *same* body
   as the existing `navigate(tabId, url)` (`tab-manager.ts:117-126`), targeting the active
   tab;
3. on `tab.loadState === "loaded"`, fires `this.events.onPersonOpen(url)` (see R3);
4. returns `this.summary(tab)`.

New IPC route in `index.ts`, mirroring `chrome:open-url` exactly:

```ts
ipcMain.handle("chrome:navigate-active", (_e, url: string) =>
  queue.run(() => tabs.navigateActive(url)).then((r) => ({ ...r.value, queueDepth: r.queueDepth })),
);
```

Preload: `navigateActive: (url) => ipcRenderer.invoke("chrome:navigate-active", url)`.

**Rationale**:
- Reusing the `navigate` body gives FR-008 (URL policy + link-shim unwrap + refusal
  messaging), FR-009 (failed-load state, no silent new-tab fallback — `navigateActive`
  *never* calls `open`), and US2 scenarios 2/3 for free.
- A **dedicated person-only method** rather than adding an `openedBy` argument to the
  existing `navigate(tabId, url)`: `navigate` is called by the MCP `navigate` tool
  (`src/main/mcp/tools.ts:141`) and by the e2e test handle. Those are agent-driven and MUST
  NOT feed recent-URLs (feature 009's rule: person-initiated only). Keeping a separate
  entry point means the MCP path is untouched and the person path is unambiguous.
- Routing through `queue.run` keeps the app-wide one-load-at-a-time guarantee
  (Constitution V), identical to `chrome:open-url`.

**Alternatives considered**:
- *Renderer calls the existing `chrome:open-url` and main decides.* Rejected: `open-url`'s
  contract is "new tab"; overloading it to sometimes navigate in place makes two callers of
  one channel mean different things.
- *`navigate(tabId, url, openedBy)` with a default.* Rejected: adds a
  person/agent branch to a method three callers share; the separate method is clearer and
  the shared internals are already small.

---

## R3 — Feeding recent-URLs from a person-initiated navigation (FR-010)

**Decision**: `navigateActive` fires the existing `TabEvents.onPersonOpen(url)` when the
load reaches `"loaded"`, with `url` = the `validateUrl`-normalised entered URL (not the
redirect landing URL). No change to `recent-urls.ts`, to the `onPersonOpen` handler in
`index.ts:226-230`, or to the file format.

**Rationale**: `onPersonOpen`'s contract (`tab-manager.ts:28-33`) is already exactly
"a tab the *person* opened reached loaded; `url` is the entered address, not the landing
URL; agent opens and failed loads never fire it." A person-initiated in-place navigation
that succeeds is the same event class. The spec's Assumptions section anticipates this:
"a small change to the `onPersonOpen` trigger, not a new store."

**Consequence for tests**: feature 009's `recent-urls.spec.ts` asserts *only person opens*
land in the history; the new spec adds the parallel assertion for *navigate in place*
(entered URL recorded on success; nothing recorded on a policy refusal or a failed load).

---

## R4 — Where `navigateActive` gets tested

**Decision**: Primary coverage is a new Playwright integration spec
(`tests/integration/address-bar-navigation.spec.ts`) driving the real renderer top bar
against the fixture server, in the style of `recent-urls.spec.ts` (`launchAppFull`,
`--no-background` for a real window). Add a `tests/unit` file **only** for pure logic that
does not need a window — realistically just the `NO_ACTIVE_TAB` guard and the
entered-vs-landing URL passed to `onPersonOpen`, if they can be reached with a stub
`WebContentsView`. `TabManager` imports `electron` directly, so unit-testing it needs the
same mock scaffold the repo uses elsewhere; if that scaffold does not already exist for
`TabManager`, skip the unit file and rely on integration (the repo's existing
`tab-manager` behaviour is integration-tested, not unit-tested — `tests/integration/open-url.spec.ts`).

**Rationale**: matches the repo's existing testing seam for tab behaviour; avoids
introducing an Electron mock harness just for two asserts.

---

## R5 — Not clobbering an in-progress edit (FR-003), and the tab-switch edge case

**Tension in the spec**: US1 acceptance scenario 4 says a background URL change —
explicitly including an "activation change" — leaves the person's typed text intact. The
Edge Cases section says when the person "clicks a different tab without submitting, the
edit is discarded and the input shows the newly active tab's URL."

**Decision**: Resolve on **focus**. The reflect routine (`syncAddress()`) runs on every
`tabs:changed`:
- If `#address` is **not** focused → set `address.value` to the active tab's current URL
  (or `""` + placeholder when there is no active tab). This covers redirects, agent
  navigations, tab closes, and — crucially — the case where the person clicked another tab,
  because clicking a tab in the strip or the dropdown **blurs** `#address` first.
- If `#address` **is** focused → leave `address.value` exactly as the person left it. This
  is "an edit in progress"; a background redirect / agent nav / activation change does not
  steal it (scenario 4).
- On `#address` `blur` with no pending submit → run `syncAddress()` once, so an abandoned
  edit snaps back to the active tab's URL (edge case: "The address input is focused and
  empty while a tab is active: leaving it … is a no-op").

This satisfies both: the person is still literally typing ⇒ focused ⇒ preserved; the person
switched tabs ⇒ the strip/dropdown took focus ⇒ refreshed. No dirty-tracking flag, no
"which field changed" comparison needed.

**Title-only change (edge case)**: `syncAddress()` reads the active tab's `url`; a
`page-title-updated`-only `tabs:changed` carries an unchanged `url`, so setting
`address.value` to the same string is a no-op and the field does not flicker.

**Rationale**: focus is the signal the spec's two clauses actually differ on, it needs no
new state, and it is how real browsers behave (typing in the omnibox is not interrupted by
background tab chatter; clicking another tab repaints the omnibox).

**Alternatives considered**:
- *Dirty flag set on `input`, cleared on submit/blur.* Rejected: needs care to distinguish
  "dirty because the person typed" from "value differs because a redirect landed while
  unfocused"; focus already encodes the intent.

---

## R6 — The "+" new-tab button (FR-006) and the → button / Enter

**Decision**:
- Add `<button id="newtab">` to `#bar-row` in `index.html`, immediately after `#go`, with a
  "+" glyph (inline SVG plus/`+`), `title`/`aria-label` "Open in a new tab". It is always
  present whenever the address row is (FR-006). CSS mirrors `#go`.
- `#newtab` click handler → always `hyppo.openUrl(address.value.trim())` (the existing
  new-tab path), regardless of whether a tab is active.
- `#go` click and `#address` Enter → a single `submit()`:
  - `activeId` set → `hyppo.navigateActive(url)`;
  - `activeId` null → `hyppo.openUrl(url)` (FR-007).
- Empty input → `submit()` and the "+" handler are both no-ops (edge case).
- Value handling after a successful `submit()` in navigate mode: do **not** force-clear;
  the ensuing `tabs:changed` runs `syncAddress()` (input has usually blurred, or will) and
  the field shows the tab's resolved URL. After `openUrl` (new tab / no active tab) keep
  the existing `address.value = ""` clear so `recent-urls.spec.ts`'s
  `toHaveValue("", …)` wait still holds.

**Placeholder (FR-011)**: change the static
`"https://…  — Enter opens a new tab"` to reflect the resolved model. Use a single
tab-independent string: `"https://…  — Enter navigates this tab · + opens a new tab"`.
(Keeping it static avoids a second reason for `syncAddress()` to touch the DOM; the "no
active tab ⇒ Enter opens a new tab" case is a reasonable read of "navigates this tab" when
there is no tab, and US2 scenario 4 is still covered by behaviour.)

**Rationale**: one submit path with a single active/no-active branch is the least code and
matches the spec's FR-005/FR-007 split; the "+" is unconditional so US3 scenario 2 (no tab
⇒ "+" opens a new tab) needs no special case.

---

## R7 — `NO_ACTIVE_TAB` should never actually reach the user

`navigateActive` throws `HyppoError("NO_ACTIVE_TAB")` as defence in depth, but the renderer
decides *before* calling: `submit()` checks `activeId` and calls `openUrl` when it is null.
The throw only fires on a race (last tab closed between the keystroke and the IPC landing);
in that case the renderer's existing `catch` shows the error notice, and the person retries
into the now-empty bar (which opens a new tab). Acceptable — no fallback auto-open (FR-009
forbids a silent new tab as a fallback for a *failed navigation*; this is a different case,
but keeping it a visible retry rather than a surprise tab is consistent with the spec's
intent).
