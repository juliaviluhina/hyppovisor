# Implementation Plan: Recent-URLs Dropdown

**Branch**: `plan-009-recent-urls-dropdown` (feature dir `specs/009-recent-urls-dropdown`) |
**Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-recent-urls-dropdown/spec.md`

## Summary

Add a most-recent-first history of person-opened, successfully-loaded URLs, surfaced as a
native `<datalist>` on the existing `#address` input, persisted to one plaintext file in the
app's user-data area, with a "Clear recent URLs" button on the connection panel.

Technical approach: a new `src/main/recent-urls.ts` owns `<userData>/recent-urls.json` (a
JSON array of strings) with the same atomic temp-write + `renameSync` and
defaults-on-corrupt pattern as `src/main/settings.ts`, plus a pure `addRecentUrl(list, url,
cap)` (exact-string dedupe, move-to-front, cap-evict). `TabManager` gains one event,
`onPersonOpen(url)`, fired from `open()` after a successful load when `openedBy === "person"`
(which already covers the address bar, Enter, and person-triggered `target=_blank` — those
call `open(url, "person")`). `src/main/index.ts` holds the in-memory list, wires the event
to `addRecentUrl` + save + a `recent-urls:changed` push, and registers two IPC handlers
(`chrome:recent-urls`, `chrome:clear-recent-urls`) **before** `win.loadFile`. The preload
bridge gains `recentUrls()`, `onRecentUrlsChanged(cb)`, `clearRecentUrls()`.
`src/renderer/index.html` gets a `<datalist id="recent-urls">` and `list="recent-urls"` on
`#address`; `src/renderer/app.ts` fills it on load and on the push; `src/renderer/panel.ts`
adds the clear button.

No change to the MCP tool surface, the blocklist, the interaction audit log, tab/agent
behaviour, or `settings.json`.

## Technical Context

**Language/Version**: TypeScript 5.7, Node ≥ 22, ESM for `src/main` / `src/shared`; isolated
`tsconfig.renderer.json` for `src/renderer`; Electron 33.

**Primary Dependencies**: Electron (`ipcMain.handle`, `webContents.send`,
`app.getPath("userData")`, `BrowserWindow`); `node:fs` (`readFileSync`, `writeFileSync`,
`renameSync`). No new runtime dependencies. `<datalist>` is a plain HTML element — no
library.

**Storage**: NEW — one plaintext file `<userData>/recent-urls.json`, a JSON array of URL
strings (length ≤ 20, most-recent-first, no duplicates). Same directory family as
`settings.json` and `interaction-log.jsonl`. Human-readable, safe to delete, never written
to the shared data directory, never read by any orchestrator. Justified in the Constitution
Check + Complexity Tracking below.

**Testing**: `vitest` unit — `recent-urls.ts`: `addRecentUrl` (dedupe / move-to-front /
cap-evict / order), `loadRecentUrls` (missing / non-JSON / non-array / non-string entries →
`[]`, no rewrite), `saveRecentUrls` (round-trip, temp file removed). `@playwright/test`
`_electron` integration — `tests/integration/recent-urls.spec.ts` drives the real renderer
address input and datalist with `HYPPO_USER_DATA_DIR` isolating the file; asserts
person-open vs agent-open, failed-load exclusion, restart persistence, and the panel clear
button.

**Target Platform**: Electron desktop app (macOS primary; Windows/Linux build).

**Project Type**: Single project — existing `src/main/**` + `src/preload/**` + `src/shared/**`
+ `src/renderer/**` + `tests/**` layout.

**Performance Goals**: One synchronous small-file write per person-open (a ≤ 20-line JSON
file). One IPC round-trip to fill the datalist on renderer load; one push per addition or
clear. No polling.

**Constraints**: One window (Principle III) — the datalist is a child of the existing input,
the clear button lives in the existing panel overlay. No external act (Principle I) — the
datalist only fills the field; the person still triggers Open. No page content stored
(Principle V).

**Scale/Scope**: ≤ 20 entries; ~50–70 lines of implementation across main + preload +
renderer + panel, plus tests.

## Constitution Check

*GATE: re-checked after Phase 1 design — still passing.*

### I. Human Does Every External Act (NON-NEGOTIABLE) — PASS

The datalist populates the address field from local history; the person still presses Open.
Nothing is opened, navigated, submitted, or sent by this feature. FR-002 and FR-012 make
this explicit.

### II. Zero Business Logic in HyppoVisor — PASS

No scoring, ranking, or interpretation. Dedupe is **exact-string** (clarify session) — no
normalization, no tracking-param judgement. Ordering is mechanical recency.

### III. Solid and Comprehensible — PASS (new store + IPC noted)

- **One new plaintext file** (`recent-urls.json`), same shape and write discipline as
  `settings.json`, human-readable, safe to delete. Added to the user-data-writes inventory
  (README + the plan doc). No database, no service.
- **Two new IPC handlers + one push channel** on the existing `chrome:*` renderer↔main
  surface — the same pattern feature 007 established (`chrome:get-connection` +
  `connection:changed`). No new transport, nothing on the MCP surface.
- One window: the datalist is part of the address input; the clear button is in the existing
  panel.
- Justified in Complexity Tracking below per the Principle III requirement for new stores /
  IPC channels.

### IV. User-Held Credentials and Sessions — PASS

URLs only. No passwords, tokens, cookies, or session state. The history file holds nothing
that is not a URL the person typed or clicked.

### V. Assistive Pace, Not Bulk Collection — PASS

- No page content is stored — the file holds URL strings the person authored by opening
  pages, nothing else (FR-010).
- The file is in the app's own user-data area, **not** the shared data directory — matching
  `settings.json` / `interaction-log.jsonl`. No provenance-log entry (that is for shared-dir
  writes).
- Agent-opened URLs are excluded (FR-003/FR-004): this is the person's own navigation
  history, not a traversal record.
- The list is capped at 20 and the person can clear it (FR-013) — bounded, need-driven, not
  bulk retention.

### Architecture Constraints — PASS

No dependency on `hyppograph`. MCP surface unchanged. The new file is app-local config, not
a shared-directory artifact, so the `inputs/` + `outputs/` + `provenance-log.md` structure
is untouched.

## Project Structure

### Documentation (this feature)

```text
specs/009-recent-urls-dropdown/
├── plan.md
├── research.md          # Phase 0 — decisions R1–R5
├── data-model.md        # Phase 1 — the history entity + file schema
├── quickstart.md        # Phase 1 — validation runs
├── contracts/
│   └── recent-urls.md   # Phase 1 — file schema + IPC/preload contract
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/main/
├── recent-urls.ts             # NEW — load/save (atomic, defaults-on-corrupt) + pure
│                              #   addRecentUrl(list, url, cap)
├── config.ts                  # + recentUrlsCap (HYPPO_RECENT_URLS_CAP, 20)
├── index.ts                   # hold the list; wire onPersonOpen → add+save+push;
│                              #   register chrome:recent-urls + chrome:clear-recent-urls
│                              #   BEFORE win.loadFile
└── tabs/
    └── tab-manager.ts         # + TabEvents.onPersonOpen(url); fire after a successful
                               #   load when openedBy === "person"

src/preload/
└── chrome.cjs                 # + recentUrls(), onRecentUrlsChanged(cb), clearRecentUrls()

src/renderer/
├── index.html                 # + <datalist id="recent-urls">; list="recent-urls" on #address
├── app.ts                     # fill the datalist on load + on recent-urls:changed
└── panel.ts                   # + "Clear recent URLs" button → hyppo.clearRecentUrls()

tests/
├── unit/
│   └── recent-urls.test.ts    # NEW — addRecentUrl, loadRecentUrls, saveRecentUrls
└── integration/
    └── recent-urls.spec.ts    # NEW — person vs agent open, failed-load exclusion,
                               #   restart persistence, live update, panel clear

README.md                      # user-data-writes inventory + a line on the dropdown
```

**Structure Decision**: Single project, existing layout. `recent-urls.ts` is a direct
sibling of `settings.ts` and follows its shape so the persistence discipline is reviewed
once and reused.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| New file `recent-urls.json` under `userData` | The feature's whole value is "the URL I had open yesterday" — it must survive a restart. | In-memory only: rejected — loses the list on every quit, which is the primary use case. Storing inside `settings.json`: rejected — mixes an append-heavy list with the connection config and complicates that file's strict schema/validation. |
| IPC `chrome:recent-urls` + `chrome:clear-recent-urls` + push `recent-urls:changed` | The list lives in the main process (it is written from the tab lifecycle); the renderer datalist and the panel button need to read it and to trigger a clear, and the datalist must update live. | Reading the file directly from the renderer: rejected — the renderer has no `fs` access under `contextIsolation` + `sandbox`, and it would race the main-process writer. Polling: rejected — a push on change is the established feature-007 pattern and cheaper. |
