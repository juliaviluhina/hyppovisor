# Implementation Plan: Unobtrusive / Background Window

**Branch**: `013-background-window` (feature dir `specs/013-background-window`) |
**Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-background-window/spec.md`

## Summary

Give a HyppoVisor instance an unobtrusive launch. `resolveInstance` (feature 012) gains a
`background` boolean from a new `--background` argv flag. `main()` always creates the
`BrowserWindow` with `show: false`, and *after* `win.loadFile()` decides how to reveal it:

| Launch | Window | Focus | macOS Dock / ⌘-Tab | Taskbar |
|---|---|---|---|---|
| default (`source === "default"`, no `--background`) | `win.show()` | takes focus (unchanged) | shown | shown |
| any non-default source, no `--background` (named `--instance`, env-dir) | `win.showInactive()` | never | shown | shown |
| `--background` (any source) | stays hidden | never | `app.dock.hide()` → no icon, no ⌘-Tab | `setSkipTaskbar(true)` |

The `second-instance` handler (already the same-profile relaunch hook from feature 012)
becomes the **summon** gesture: unhide + `show()` + `focus()` + `app.dock.show()` +
`setSkipTaskbar(false)`. For a `--background` instance, `win.on("close")` is intercepted —
`preventDefault()` + `hide()` + re-hide the Dock — so closing a summoned window returns it
to the background instead of quitting; a `before-quit` flag lets a real quit through.
`SIGINT` / `SIGTERM` call `app.quit()` so terminal Ctrl-C exits cleanly; Cmd/Ctrl-Q (the
existing default menu) still quits.

The e2e harness (`helpers.ts`) adds `--background` to every launch, so local
`npm run test:e2e` shows no windows; the screenshot spec proves `capturePage()` still works
against a hidden window.

Plus a PATCH constitution amendment (1.4.1 → 1.4.2) recording that the one window may start
hidden and be summoned, and doc edits to `docs/configuration.md`.

No new MCP tool, no browser interaction primitive, no external act, no persisted state, no
new IPC channel, no new UI surface (FR-016 / FR-018 / FR-012).

## Technical Context

**Language/Version**: TypeScript 5.7, Node ≥ 22 (ESM for `src/main`; renderer compiled in
isolation), Electron 33.

**Primary Dependencies**: Electron — `BrowserWindow({ show, webPreferences.backgroundThrottling })`,
`win.show()` / `win.showInactive()` / `win.hide()` / `win.isVisible()` / `win.setSkipTaskbar()`,
`win.on("close")`, `app.on("second-instance" | "before-quit")`, `app.dock.hide()` /
`app.dock.show()` (macOS only), `WebContents.capturePage()` (existing), `process.on("SIGINT" | "SIGTERM")`.
**No new runtime dependency.**

**Storage**: None. `--background` is launch-flag only (Clarification Q2) — no new file, no new
field in `settings.json`.

**Testing**:
- `vitest` unit — `src/main/instance.ts`: `--background` parsing (present / absent / `=` form
  is meaningless for a boolean but must not break), and that it composes with `--instance` /
  `--port` / `HYPPO_USER_DATA_DIR`.
- `@playwright/test` `_electron` integration:
  - new `tests/integration/background-window.spec.ts` — US1 (two `--background` instances:
    no window, MCP reachable, drive both), US2 (summon via a second `_electron.launch` into
    the same profile → window becomes visible; close it → still running, still on its port),
    US3 (named instance without `--background` → `win.isVisible()` true, but the OS-focused
    window is unchanged — asserted via `app.evaluate` on `BrowserWindow.getFocusedWindow()`),
    US5 (`app.quit()` / SIGINT exits; siblings untouched).
  - `tests/integration/screenshot.spec.ts` — unchanged assertions, now runs under the
    `--background` harness (SC-005 / the capturePage-while-hidden risk, R2).
  - All offline (fixture server / loopback only).

**Target Platform**: Electron desktop (macOS primary; Windows/Linux build) + embedded MCP
HTTP/stdio server.

**Project Type**: Single project — existing `src/main/**` + `src/renderer/**` + `tests/**`
layout.

**Performance Goals**: The show/hide decision is one synchronous Electron call after
`loadFile`; no measurable startup cost. Summon completes within ~2 s (SC-003) — it is one
`show()` + `focus()`.

**Constraints**: Loopback only (unchanged). The action queue is untouched (Principle V). The
default single instance (no `--instance`, no `--background`, no env) ends up shown and
focused exactly as today (FR-004 / SC-007) — the only change is the window appears when the
renderer has loaded instead of blank-then-loading.

**Scale/Scope**: ~1 field on `ResolvedInstance` + ~10-line flag parse; ~40 lines of window
lifecycle in `index.ts`; 1 line in `tab-manager.ts`; 1 new integration spec; 2 contract
docs; `helpers.ts` + `instance.test.ts` edits; `docs/configuration.md`; a PATCH amendment.

**Unknowns**: one, isolated to research — whether `WebContents.capturePage()` on a tab
inside a `show: false` window returns a real frame with `backgroundThrottling: false` +
`paintWhenInitiallyHidden` (Electron default `true`), or needs a momentary reveal in the
screenshot path only (R2). Everything else the three `/speckit-clarify` answers and the
spec settle.

**Known risk (mitigated)**: `capturePage()` on a hidden window (R2). Mitigation is scoped to
`src/main/page/screenshot.ts` if the e2e screenshot spec fails under the `--background`
harness: a `win.showInactive()` → capture → `win.hide()` wrapper, or an off-screen
`win.setPosition` while capturing. No change to any other path.

## Constitution Check

*GATE: re-checked after Phase 1 design — still PASS.*

### I. Human Does Every External Act (NON-NEGOTIABLE) — PASS

No page is touched, no interaction primitive is added, no MCP tool is added. Window
visibility and focus only.

### II. Zero Business Logic in HyppoVisor — PASS

A launch flag, a show/hide decision table, a summon gesture, a close interceptor. No
scoring, ranking, filtering, or judgement; no orchestrator concept.

### III. Solid and Comprehensible — PASS **with a bundled PATCH amendment**

- **One window.** Each process still opens exactly one `BrowserWindow` and has one entry
  point. A window that starts hidden and is summoned by re-launch is still that one window —
  not a second surface. The 1.3.2 / 1.4.1 carve-outs are untouched.
- **No hidden state.** `--background` persists nothing (Clarification Q2); no new file, no
  new `settings.json` field, no new IPC channel. The only new runtime state is one boolean
  and one "am I quitting" flag inside `main()`.
- **No new UI surface.** No system-tray / status-bar icon (FR-018). The summon gesture is
  the existing `second-instance` relaunch; quit is Ctrl-C or the platform's existing
  Cmd/Ctrl-Q. The macOS Dock icon / ⌘-Tab entry is presentation that `app.dock.hide()` /
  `.show()` toggles — not a persistent resident (it comes and goes with the window).
- **Smallest mechanism.** A boolean flag and a handful of `win.show()` / `win.hide()` /
  `app.dock.*` calls, versus a tray, a menu-bar app, or an offscreen render pipeline.
- **Amendment.** Bundle a PATCH bump (1.4.1 → 1.4.2): Principle III bullet one gains a
  sentence permitting the hidden-and-summoned window; Amendment History gains a 1.4.2 entry.
  Tracked in Complexity Tracking. Precedent: 1.3.2 / 1.4.1 — scoped clarifications of the
  same "one window" sentence that bless no new capability kind.

### IV. User-Held Credentials and Sessions — PASS

Unchanged. The person still signs into each site inside a visible tab — which is exactly why
a background instance stays summonable (FR-017). No token moves anywhere.

### V. Assistive Pace, Not Bulk Collection — PASS

The app-wide action queue is not modified. A background instance is still a session the
person started, still human-paced, and still summonable so the person can watch and
intervene. Fully headless / unattended operation is an explicit non-goal in the spec
(FR-017) — this feature adds no path to it.

## Project Structure

### Documentation (this feature)

```text
specs/013-background-window/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions R1–R8
├── data-model.md        # Phase 1 — ResolvedInstance delta, window lifecycle state
├── quickstart.md        # Phase 1 — run background instances; validate US1–US5
├── contracts/
│   ├── launch-flag.md          # CLI: --background, precedence with --instance / env, the decision table
│   └── window-lifecycle.md     # show/showInactive/hide, second-instance summon, close→hide, quit paths
├── checklists/requirements.md  # from /speckit-specify (16/16)
└── tasks.md             # /speckit-tasks output — NOT created here
```

### Source Code (repository root)

```text
src/main/
├── instance.ts          # EDIT — ResolvedInstance.background: boolean; parse a bare --background
│                         #        flag in the argv scan (no value); compose with existing flags
├── index.ts             # EDIT — BrowserWindow({ show: false, webPreferences.backgroundThrottling: false });
│                         #        after loadFile: win.show() (default) | win.showInactive()
│                         #        (named/env-dir) | stay hidden + app.dock.hide() + setSkipTaskbar(true)
│                         #        (--background); second-instance handler also app.dock.show() +
│                         #        setSkipTaskbar(false); win.on("close") → preventDefault + hide +
│                         #        re-hide Dock for a --background instance, gated by a `quitting`
│                         #        flag set on app.on("before-quit"); process.on("SIGINT"|"SIGTERM")
│                         #        → app.quit()
└── tabs/tab-manager.ts  # EDIT — backgroundThrottling: false on the WebContentsView webPreferences,
                          #        so a hidden instance's tabs don't throttle timers / rAF

src/renderer/**          # (no change — the renderer never learns whether the window is visible)
src/preload/**           # (no change)
src/shared/types.ts      # (no change — nothing new crosses IPC)

tests/
├── unit/instance.test.ts              # EDIT — --background parsing + composition cases
├── integration/background-window.spec.ts  # NEW — US1 / US2 / US3 / US5
├── integration/screenshot.spec.ts     # (no change — must still pass under the --background harness; R2)
└── integration/helpers.ts             # EDIT — launchApp + launchAppFull add --background to args

docs/configuration.md    # EDIT — --background, the summon gesture, quitting a background
                          #        instance, macOS Dock / ⌘-Tab behaviour; recommend it for
                          #        multi-instance in the "Run more than one HyppoVisor" section

.specify/memory/constitution.md  # EDIT — PATCH 1.4.1 → 1.4.2 (Principle III: hidden + summoned window)
```

**Structure Decision**: Existing single-project layout. No new source file — the flag lives
on `instance.ts`'s existing `ResolvedInstance` and the behaviour is window-lifecycle wiring
in `index.ts` plus one line in `tab-manager.ts`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| PATCH constitution amendment (1.4.1 → 1.4.2), Principle III | Principle III says "one window"; without a clause, the review gate could read "a window that never shows, summoned by re-launch" as a hidden surface or a background-service pattern. The amendment scopes it: still one window, still one entry point, nothing persisted, no tray. | Not amending — rejected: leaves the gate to argue a change that is squarely a Principle III "one window" topic, the same reason 1.3.2 and 1.4.1 took scoped PATCHes rather than reviewer judgement. |
| `win.on("close")` interceptor for `--background` instances | FR-009: closing a summoned window must return the instance to the background, not quit. The existing `window-all-closed → app.quit()` path would otherwise kill the MCP server and drop the connected agent on every close. | A "minimise instead of close" hint or relying on the person to not close the window — rejected: unreliable and surprising; the interceptor + `before-quit` flag is the standard Electron pattern for a summonable background app. |
| Always create the window `show: false`, then reveal | One code path for all three launch modes (default / named / background) instead of branching `BrowserWindow` options. Side benefit: the default instance's window appears loaded instead of blank-then-loading. | Branching `show` in the `BrowserWindow` constructor — rejected: three-way branch at construction plus a second decision after load; one `show: false` + a post-load switch is smaller and the default end state (shown + focused) is unchanged (SC-007). |
