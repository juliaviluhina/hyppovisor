# Implementation Plan: Address Bar Reflects and Navigates the Active Tab

**Branch**: `015-address-bar-navigation` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-address-bar-navigation/spec.md`

## Summary

Make HyppoVisor's address input behave like a browser address bar. Two halves:

1. **Reflect** — the input shows the *active* tab's current (post-redirect) URL, tracking
   tab activation, redirects, in-page navigation, and agent `navigate`. Empty with a
   placeholder when no tab is open. An in-progress edit is never clobbered by an automatic
   refresh.
2. **Navigate in place** — with a tab active, Enter or the → button re-points *that* tab
   (no new tab); a new dedicated **"+"** button opens the typed URL in a new tab. With no
   tab active, Enter / → / "+" all open a new tab (unchanged).

Technical approach: one new IPC route (`chrome:navigate-active`) forwarding to a new
person-only `TabManager.navigateActive(url)` that reuses the existing
unwrap → `validateUrl` → `load` path (so URL policy, link-shim unwrapping, failed-load
state, and refusal messaging are identical to opening a new tab) and fires the existing
`onPersonOpen` event on success so feature 009's recent-URLs history is fed. The renderer
learns the authoritative active tab id from an augmented `tabs:changed` payload and syncs
`#address` from it unless the input is focused. No new persistent state, no MCP surface
change, no constitution amendment (FR-012).

## Technical Context

**Language/Version**: TypeScript 5.7, ESM, Node ≥ 22

**Primary Dependencies**: Electron 33 (`BrowserWindow`, `WebContentsView`); no new deps

**Storage**: none new. Recent-URLs history (`<userData>/recent-urls.json`, feature 009) is
*fed* by an additional trigger but its format and writer are unchanged.

**Testing**: vitest (`tests/unit`) + Playwright `_electron` (`tests/integration`)

**Target Platform**: macOS desktop (Electron); Linux/Windows for dev

**Project Type**: Single-project Electron app (main / preload / renderer / shared)

**Performance Goals**: address bar reflects an activation within 200 ms (SC-001); shows a
post-redirect URL within 1 s of load settling (SC-005) — both trivially met by riding the
existing `tabs:changed` push.

**Constraints**: app-wide single-in-flight sequencing (Constitution V) — person-initiated
navigation MUST go through the existing `ActionQueue`, exactly as `chrome:open-url` does.

**Scale/Scope**: ~6 files touched, ~120 LOC. No data model. One IPC route + one preload
forwarder + one `TabManager` method + renderer wiring + one HTML button.

## Constitution Check

*GATE: re-checked after Phase 1 design — still passing.*

| Principle | Assessment |
|---|---|
| **I — Human does every external act** | PASS, no amendment. `navigate` is already an explicitly permitted browser action; this feature only exposes the existing `TabManager.navigate` path to the person's own chrome (FR-012). The "no operation may press Enter" clause in Principle I governs *page interaction operations on web content* (it can trigger an implicit form submit); it does not govern the app's own chrome address bar, whose Enter triggers a top-level `loadURL`, never a DOM submit. No submit/consent/credential/outward control is touched. |
| **II — Zero business logic** | PASS. The address bar is mechanical string display + a `loadURL`. No scoring, ranking, or judgment. |
| **III — Solid and comprehensible** | PASS. Smallest mechanism: one new IPC channel (`chrome:navigate-active`) and a shape change to the existing `tabs:changed` event payload. No new store, service, daemon, or window. **Called out for review per III:** (a) the new IPC channel; (b) `tabs:changed` now carries `{ tabs, activeTabId }` instead of a bare `TabSummary[]`. Both stay inside the renderer↔main chrome boundary; the MCP surface is untouched. |
| **IV — User-held credentials** | PASS. No credential handling; nothing serialized. |
| **V — Assistive pace** | PASS. `chrome:navigate-active` runs inside `queue.run(...)` so it obeys the app-wide one-load-at-a-time rule. A person navigating a tab is one human-paced page load, same cost as a new-tab open. |

**No entries in Complexity Tracking** — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/015-address-bar-navigation/
├── plan.md              # this file
├── research.md          # Phase 0 — design decisions (edit-preservation rule, active-id plumbing, recent-URLs trigger)
├── data-model.md        # Phase 1 — no persisted entities; documents the tabs:changed payload + transient renderer state
├── quickstart.md        # Phase 1 — manual + automated validation walkthrough
├── contracts/
│   ├── ipc-navigate-active.md   # chrome:navigate-active request/response + error codes
│   └── tabs-changed-payload.md  # the augmented tabs:changed event shape
├── checklists/          # (exists)
└── tasks.md             # Phase 2 — /speckit-tasks, NOT created here
```

### Source Code (repository root)

```text
src/
├── shared/
│   └── types.ts                 # + TabsChangedPayload { tabs: TabSummary[]; activeTabId: string | null }
├── main/
│   ├── index.ts                 # + ipcMain.handle("chrome:navigate-active", …) via queue.run;
│   │                            #   change the 3 send("tabs:changed", tabs.list()) call sites to send the payload
│   └── tabs/
│       └── tab-manager.ts       # + get activeTabId(); + async navigateActive(rawUrl): Promise<TabSummary>
├── preload/
│   └── chrome.cjs               # + navigateActive(url); onTabsChanged now yields { tabs, activeTabId }
└── renderer/
    ├── index.html               # + "#newtab" ("+") button in #bar-row; placeholder text (FR-011); small CSS
    └── app.ts                   # active-id from payload (drop the "guess last tab" heuristic);
                                 #   syncAddress() reflect logic w/ focus guard; submit() → navigate-or-open;
                                 #   "+" handler; Enter + #go both call submit()

tests/
├── unit/
│   └── tab-manager-navigate-active.test.ts   # NEW — only if navigateActive is unit-reachable without a real window; see research R4
└── integration/
    └── address-bar-navigation.spec.ts        # NEW — US1 reflect, US2 navigate-in-place, US3 "+" new tab, FR-003 edit guard
```

**Structure Decision**: The repo is a single Electron project with a fixed
`main` / `preload` / `renderer` / `shared` split. This feature adds no module; it extends
`tab-manager.ts` (peer of the existing `reloadActive()`), threads one IPC channel through
`index.ts` + `chrome.cjs`, and does the visible work in `renderer/app.ts` +
`renderer/index.html`. `tests/integration` is the primary proving ground because the
behaviour is renderer↔main↔Electron; a unit test is added only if `navigateActive` logic
can be exercised without booting a window (see research.md R4).

## Complexity Tracking

No Constitution violations — table intentionally empty.
