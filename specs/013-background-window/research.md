# Phase 0 Research: Unobtrusive / Background Window

The three `/speckit-clarify` answers (2026-09-01) plus the spec Assumptions resolve every
NEEDS CLARIFICATION. One genuine technical unknown — `capturePage()` on a hidden window —
is isolated in R2 with a scoped fallback.

---

## R1 — The `--background` flag and the visibility decision

**Decision**: `resolveInstance(argv, env, baseUserDataDir)` gains `background: boolean` on
`ResolvedInstance`, set by a bare `--background` in the argv scan (a boolean flag — no
value; `--background=true` / `--background=false` are not supported and any `=`-suffixed
form is ignored as "not the flag"). `main()` creates the `BrowserWindow` with `show: false`
**always**, then, immediately after `await win.loadFile(...)`, runs one switch:

```
if (resolved.background)              → leave hidden; app.dock?.hide(); win.setSkipTaskbar(true)
                                        win.webContents.setBackgroundThrottling(false)
else if (resolved.source === "instance") → win.showInactive()   // named --instance: visible, no focus
else                                  → win.show()             // default + env-dir: shown + focused
```

`resolved.source` is the feature-012 field (`"instance" | "env-dir" | "default"`).

**Implementation note (deviates from the first draft):** `showInactive()` is scoped to
`source === "instance"` only. `env-dir` launches (`HYPPO_USER_DATA_DIR` — CI, wrappers, the
e2e harness) fall in the `win.show()` branch with `default`. Reasons: (1) the only FR that
requires no-focus is FR-003, which names `--instance`; FR-004 / SC-007 pin the default to
shown+focused; `env-dir` is unconstrained. (2) `show: false` + `showInactive()` with several
`WebContentsView` children stacked on a never-activated window reproducibly SIGSEGV'd the
renderer on macOS (Electron 33) in `recent-urls.spec.ts` — a real crash, not a test artifact.
Keeping every non-`--instance` path on plain `win.show()` avoids it and leaves the whole
existing e2e suite on its pre-013 visibility behaviour. A spec that needs a genuinely hidden
window passes `--background` (harness default); one that needs a visible interactive window
passes `--no-background`.

**Rationale**:
- One `show: false` construction + one post-load switch is smaller than a three-way branch
  in the `BrowserWindow` options, and it removes the pre-load blank-window flash for every
  mode. The default instance still ends shown and focused (SC-007 is about end state).
- `showInactive()` shows the window without activating the app — exactly "visible but never
  focused" (FR-003 / FR-006). It is the cross-platform degrade for `--background` on a
  window manager with no true hidden state (FR-006): a spec that wants "hidden" but only
  gets "inactive" is still never focused.
- A boolean flag matches feature 012's hand-rolled scan style; no arg library.

**Alternatives considered**:
- *`show` decided in the constructor.* Rejected — a three-way branch at construction plus a
  second post-load `focus()` decision; the `show:false`-then-switch form is one place.
- *A `--foreground` counter-flag.* Rejected — the default is already foreground; the only
  thing a person needs to ask for is *less* prominence.

---

## R2 — `capturePage()` on a hidden window *(the one real risk)*

**Decision**: Create the window with `show: false` and rely on Electron's default
`webPreferences.paintWhenInitiallyHidden: true` plus `backgroundThrottling: false` on both
the window and the tab `WebContentsView`s. Assume `WebContents.capturePage()` on a tab
returns a real frame under those settings. **Validate it in `screenshot.spec.ts`** running
under the `--background` harness (SC-005). If any screenshot assertion fails there, apply a
fallback **only in `src/main/page/screenshot.ts`**:

- momentary `win.showInactive()` → `capturePage()` → `win.hide()` around the capture, or
- move the window fully off every display (`win.setPosition(-32000, -32000)`) while it is
  "shown", capture, restore.

**Rationale**:
- `read_page` / `read_form_fields` / `interact` / `wait_for_selector` use
  `executeJavaScript` and `sendInputEvent`, which do **not** depend on the window being
  painted — they work against a hidden window unchanged. Only `screenshot` (`capturePage`)
  needs a rendered surface.
- `paintWhenInitiallyHidden` (default `true`) makes a `show: false` window's own
  `webContents` keep painting. Whether an attached `WebContentsView` child inherits that is
  the exact thing the e2e screenshot spec will tell us — cheaper to measure than to guess.
- `backgroundThrottling: false` separately prevents `requestAnimationFrame` / timer
  throttling in a hidden window, so a site that renders on a rAF loop still settles before a
  read.

**Alternatives considered**:
- *`webPreferences.offscreen: true`.* Rejected as the default — it is a different rendering
  path (CPU raster, `paint` events, no GPU), changes `capturePage` semantics, and is
  heavier for every read, to solve a problem that may not exist.
- *Always keep the window shown but off-screen.* Rejected as the default — a window parked
  at `(-32000,-32000)` is still a window the OS can surface (Exposé, screen-share); truly
  `hide()`-ing it is cleaner. Kept only as the screenshot-path fallback.

---

## R3 — Summon: reuse the feature-012 `second-instance` handler

**Decision**: The `app.on("second-instance", …)` handler already added by feature 012
(restore + `show()` + `focus()` on a same-profile relaunch) **is** the summon gesture
(FR-007). Extend it:

```ts
app.on("second-instance", () => {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();                 // unhides a --background window
  win.focus();
  win.setSkipTaskbar(false);
  if (process.platform === "darwin") app.dock?.show();
});
```

`win.show()` on a `show: false` window makes it visible and focused — no special "unhide"
call needed. The gesture is: `npx electron . --instance <name>` (dev) or
`open -na HyppoVisor --args --instance <name>` (packaged) — the same relaunch feature 012
already routes through the single-instance lock.

**Rationale**: zero new mechanism. The lock is keyed on the profile dir; a second launch of
a running `--background` instance is refused *for a new window* and instead fires
`second-instance` in the original — which now reveals it. FR-016 non-goal (falls through to
a normal launch when the instance is **not** running) is automatic: no lock holder → the
new process starts normally and, without `--background`, shows its window.

**Alternatives considered**:
- *A dedicated `--summon` flag or an IPC ping.* Rejected — the relaunch already carries the
  instance identity and already reaches the running process; a second path is redundant.
- *An OS notification with a "Show" action.* Rejected — a new surface; listed as a Follow-up.

---

## R4 — Close returns a `--background` instance to the background (FR-009)

**Decision**: For a `--background` instance, intercept the window `close`:

```ts
let quitting = false;
app.on("before-quit", () => { quitting = true; });
win.on("close", (e) => {
  if (quitting || !resolved.background) return;   // real quit, or a non-background instance
  e.preventDefault();
  win.hide();
  win.setSkipTaskbar(true);
  if (process.platform === "darwin") app.dock?.hide();
});
```

- Non-`--background` instance → `close` proceeds → window destroyed →
  `window-all-closed → app.quit()` (feature-001 behaviour, unchanged).
- `--background` instance → `close` is cancelled, the window hides, the process and its MCP
  server keep running (FR-009). `window-all-closed` never fires because the window is never
  destroyed.
- A real quit (`app.quit()` from Cmd/Ctrl-Q or the SIGINT handler) sets `quitting` first, so
  the same `close` handler lets the window go and the process exits.

**Rationale**: the `preventDefault` + `hide` + `before-quit`-flag trio is the standard
Electron pattern for a summonable background app (the macOS "close ≠ quit" convention,
applied deliberately and only for `--background`). No timer, no polling.

**Alternatives considered**:
- *`win.on("close")` for every instance, keying off a "has the agent ever connected" heuristic.*
  Rejected — Principle II (a heuristic/judgement); the explicit `--background` flag is the
  signal.
- *Quit on close, re-background by relaunch.* This was Clarification Q1 option B; the user
  chose A (close → background).

---

## R5 — Quitting a background instance (FR-011)

**Decision**: Three paths, all already near-free:

1. **Terminal Ctrl-C** — add `process.on("SIGINT", () => app.quit())` and the same for
   `SIGTERM`. `app.quit()` fires `before-quit` → `quitting = true` → the `close` handler
   lets the window close → process exits. This is the primary documented method for a
   `--background` instance launched from a shell.
2. **Cmd-Q (macOS)** — the default Electron application menu already provides Quit /
   `Cmd+Q`; no code. Works when the instance is summoned (foreground).
3. **Ctrl+Q (Windows / Linux)** — the default Electron menu already provides File → Quit /
   `Ctrl+Q`; no code. The menu bar's visibility is unchanged from today (not touched by this
   feature).

No application menu is added or replaced (keeps the default Edit accelerators that matter
for signing in). No `globalShortcut` (heavy-handed, cross-instance collisions).

**Rationale**: the launch styles this feature documents (`npx electron .`,
`open -na HyppoVisor --args …`) all run under a controlling process or the Finder; Ctrl-C is
universal for the shell case and the platform Quit accelerator covers the summoned case.
FR-011's "a Quit menu item / keyboard shortcut in the window" is satisfied by the existing
default menu — no new surface.

**Alternatives considered**:
- *A custom `Menu` with `autoHideMenuBar`.* Rejected for now — it would change the
  Windows/Linux menu-bar behaviour for *every* instance (a visible-chrome change to the
  default instance) to solve a problem the default menu already solves. Noted as a possible
  Follow-up if the hidden-menu-bar ergonomics are wanted.
- *`before-input-event` on the chrome webContents for Ctrl+Q.* Rejected — fires only when
  the chrome (not a tab) has key focus; unreliable. The default menu accelerator is robust.

---

## R6 — macOS Dock / ⌘-Tab and Windows/Linux taskbar (FR-005)

**Decision**:
- **macOS**: `app.dock.hide()` when an instance is (or returns to) background;
  `app.dock.show()` when it is summoned or shown. `app.dock.hide()` sets the activation
  policy to accessory, which removes both the Dock icon **and** the ⌘-Tab entry — one call
  covers FR-005. Guard every call with `process.platform === "darwin"` and optional chaining
  (`app.dock?.hide()`), since `app.dock` is undefined off macOS.
- **Windows / Linux**: `win.setSkipTaskbar(true)` while hidden, `setSkipTaskbar(false)` on
  summon. A `show: false` window has no taskbar button anyway; `setSkipTaskbar` makes the
  intent explicit and covers the degrade-to-inactive case (FR-006) where the window *is*
  shown.

The default and named-visible instances never call `app.dock.*` / `setSkipTaskbar` — their
Dock / taskbar presence is unchanged (SC-007).

**Rationale**: `app.dock.hide()` is the documented, reversible way to make an Electron app
an "agent" without an Info.plist `LSUIElement` (which would make *every* instance, including
the default, dock-less permanently). Toggling it with visibility keeps the icon a truthful
signal: present iff a window is on screen.

**Alternatives considered**:
- *`LSUIElement` in `electron-builder.yml` `mac.extendInfo`.* Rejected — it is global and
  permanent; the default instance must keep its Dock icon.
- *`app.setActivationPolicy("accessory")` directly.* Equivalent to `app.dock.hide()` on
  macOS; `app.dock.hide()` is the higher-level call and also hides the icon. Use it.

---

## R7 — Background throttling and the tab views

**Decision**: disable background throttling for a `--background` instance only, applied at
runtime rather than in `webPreferences`:
- `win.webContents.setBackgroundThrottling(false)` in the reveal switch's `--background` branch;
- `view.webContents.setBackgroundThrottling(false)` per tab in `tab-manager.ts`, gated by a
  constructor flag (`new TabManager(win, events, log, resolved.background)`).

**Implementation note (deviates from the first draft):** the `webPreferences.backgroundThrottling: false`
form on the `BrowserWindow` / `WebContentsView` was part of the macOS SIGSEGV repro in R2's
recent-urls case; the runtime `setBackgroundThrottling(false)` call is the documented
equivalent (see Alternatives) and is only invoked for `--background`, so a foreground
instance's views are byte-identical to pre-013.

**Rationale**: Chromium throttles timers and `requestAnimationFrame` in occluded /
backgrounded renderers. A `--background` instance's tabs are always occluded, so a site that
lays out or reveals content on a rAF loop could stay unsettled when `read_page` /
`read_form_fields` runs. Disabling background throttling keeps a hidden tab running at
foreground cadence. Cost: a hidden instance uses a little more CPU than a fully-throttled
one — acceptable for a tool the person deliberately started and an agent is actively
driving.

**Alternatives considered**:
- *Leave throttling on and add settle waits.* Rejected — feature 011 already tuned
  `domReadyTimeoutMs` / `chooseOptionWaitMs`; adding hidden-window-only slack is fragile and
  invisible in tests.
- *`webContents.setBackgroundThrottling(false)` at runtime instead of in `webPreferences`.*
  Equivalent; the `webPreferences` form is set once at view creation and needs no re-apply.

---

## R8 — Test harness runs windowless; the constitution amendment

### Harness (FR-013 / US4)

`tests/integration/helpers.ts` — `launchApp` and `launchAppFull` append `--background` to
`args` (both already assemble `args` with `--instance e2e` / caller `extraArgs`). Then:

- local `npm run test:e2e` shows **no** windows (US4 / SC-005);
- `_electron.firstWindow()` still resolves — Playwright hooks window *creation* via CDP, not
  visibility, so `launchAppFull`'s "wait for firstWindow + ping the port" loop is unaffected;
- `screenshot.spec.ts` becomes the live proof of R2 (capturePage while hidden). If it fails,
  R2's screenshot-path fallback lands and the spec is re-run — no spec assertion changes.

A spec that specifically needs a **visible** window (none today; a future summon-focus
assertion) can pass its own `extraArgs` without `--background`, or assert via
`app.evaluate(() => BrowserWindow.getAllWindows()[0].isVisible())`.

### Amendment (PATCH 1.4.1 → 1.4.2)

Principle III bullet one, appended after the feature-012 sentence:

> The one window may also start hidden (`--background`) and be brought to the foreground by
> re-launching the instance; while hidden it shows no Dock, taskbar, or app-switcher entry.
> This is presentation of the same one window — no second surface, no background service,
> nothing persisted.

Amendment History entry:

> **1.4.2** (2026-09-01) — Principle III: the one window may start hidden (`--background`)
> and be summoned by re-launching the instance; its Dock / taskbar / ⌘-Tab presence follows
> its visibility. PATCH: a scoped clarification of "one window" — redefines no principle,
> adds no persistent store (the flag persists nothing), adds no MCP tool, adds no external
> act, adds no UI surface (the summon gesture is the existing relaunch; quit is the existing
> menu / Ctrl-C). Precedent: 1.3.2 / 1.4.1 (scoped clarifications of the same sentence).
> Recorded in feature `013-background-window`.

Footer: `**Version**: 1.4.2 | **Ratified**: 2026-08-29 | **Last Amended**: 2026-09-01`.

**Rationale**: without the clause, a window that may never appear reads to the review gate
like a background service or hidden state. PATCH, not MINOR — no principle is redefined and
no new *kind* of capability, store, or surface is blessed (contrast 1.2.0 / 1.3.0, which
expanded what a browser action may *do*).
