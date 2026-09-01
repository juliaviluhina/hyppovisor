# Contract delta: window lifecycle (feature 012 → 013)

The exact changes to `main()`'s window handling. **No new IPC channel, no renderer change,
no `shared/types.ts` change.** Everything here is `src/main/index.ts` plus one line in
`src/main/tabs/tab-manager.ts`.

## `BrowserWindow` construction (`src/main/index.ts`)

```ts
const win = new BrowserWindow({
  width: 1280,
  height: 900,
  title: windowTitle,
  show: false,                                   // NEW — was default true
  icon: join(here, "../../build/icon.png"),
  webPreferences: {
    preload: join(here, "../preload/chrome.cjs"),
    contextIsolation: true,
    sandbox: false,
    backgroundThrottling: false,                 // NEW — hidden tabs must not throttle
  },
});
```

## Reveal decision — immediately after `await win.loadFile(...)`

```ts
if (resolved.background) {
  win.setSkipTaskbar(true);
  if (process.platform === "darwin") app.dock?.hide();
  // window stays hidden
} else if (resolved.source === "default") {
  win.show();          // shown + focused — byte-identical end state to feature 012
} else {
  win.showInactive();  // named / env-dir: visible, never focused
}
```

`loadFile` is already `await`-ed before `send("tabs:changed", …)` / `pushConnection()` in
feature 012 — the reveal slots in at that point, so the window never appears blank.

## `second-instance` handler — becomes the summon gesture (FR-007)

Feature 012:

```ts
app.on("second-instance", () => {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});
```

Feature 013 — add the un-hide bookkeeping:

```ts
app.on("second-instance", () => {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();                       // also un-hides a --background window
  win.focus();
  win.setSkipTaskbar(false);
  if (process.platform === "darwin") app.dock?.show();
});
```

## Close interceptor (FR-009) + quit flag (FR-011)

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

- non-`--background` → handler is a no-op; `close` proceeds → `window-all-closed` →
  `app.quit()` (feature-001 behaviour, unchanged).
- `--background` → `close` cancelled, window hidden, MCP server keeps running. `window-all-closed`
  never fires (window not destroyed).
- real quit → `quitting` already `true` → handler returns early → window closes → exit.

## Terminal quit (FR-011)

```ts
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => app.quit());   // → before-quit → quitting = true → clean exit
}
```

Cmd-Q (macOS) and Ctrl+Q (Windows/Linux) already come from Electron's **default**
application menu — no menu code is added or replaced.

## `window-all-closed` — unchanged

```ts
app.on("window-all-closed", () => app.quit());
```

Still quits when the (non-background) window is destroyed. A `--background` instance's window
is hidden, not destroyed, so this never fires for it.

## Tab views (`src/main/tabs/tab-manager.ts`)

```ts
const view = new WebContentsView({
  webPreferences: {
    // …existing…
    backgroundThrottling: false,     // NEW
  },
});
```

## Backward compatibility

- **Default instance** (no `--instance`, no `--background`, no env): `show: false` then
  `win.show()` → shown and focused. The only observable difference is the window appears
  when the renderer has loaded rather than blank-then-loading. Dock / taskbar / menu
  unchanged. SC-007 holds (end state: shown + focused).
- **Named instance without `--background`** (feature 012 behaviour): now `showInactive()` —
  visible, not focused. This is the deliberate Clarification-Q3 revision; feature 012's
  integration specs that assert a window exists still pass (the window is visible), and the
  e2e harness runs with `--background` so it is unaffected either way.
