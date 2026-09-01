# Phase 1 Data Model: Unobtrusive / Background Window

Two shapes, both transient. **No new persisted file and no format change** to any per-profile
file (FR-012 / Clarification Q2).

---

## 1. `ResolvedInstance` — one new field (`src/main/instance.ts`)

Computed once at the top of `main()` (feature 012). Not serialised.

| Field | Type | New? | Rule |
|---|---|---|---|
| `name` | `string \| null` | — | validated `--instance` value, or `null` |
| `label` | `string` | — | title / header / serverName label |
| `userDataDir` | `string \| null` | — | profile dir to `setPath`, or `null` |
| `cliPort` | `number \| undefined` | — | `--port` value |
| `source` | `"instance" \| "env-dir" \| "default"` | — | which rule set `userDataDir`; **drives the focus decision** — only `"default"` may take focus |
| `background` | `boolean` | **new** | `true` iff a bare `--background` appears in argv. Boolean flag — no value; `--background=…` forms do not match. |

**Parsing rule (added to the existing argv scan)**

- `--background` present anywhere in `argv` → `background: true`.
- absent → `background: false`.
- It composes with every other flag: `--instance work --port 7358 --background` and
  `--background --instance work` are equivalent; `HYPPO_USER_DATA_DIR` + `--background` is a
  hidden env-dir instance.
- No validation can fail — `--background` never aborts startup.

---

## 2. Window lifecycle state (in `main()`)

Not a struct — three pieces of `main()`-local state and the decisions they gate.

### Startup (after `await win.loadFile(...)`)

The window is constructed `show: false` regardless. Then exactly one branch runs:

```
resolved.background === true
    → (leave hidden)
      app.dock?.hide()                       // macOS: no Dock icon, no ⌘-Tab
      win.setSkipTaskbar(true)               // Windows/Linux

resolved.background === false
  && resolved.source === "default"
    → win.show()                             // shown + focused — unchanged from today

resolved.background === false
  && resolved.source !== "default"
    → win.showInactive()                     // named / env-dir: visible, never focused
```

### `quitting` flag

```
let quitting = false;
app.on("before-quit", () => { quitting = true; });
```

Set once, never cleared. Distinguishes a real quit from a window close.

### State transitions — window visibility (`--background` instance)

```
                 (startup, --background)
   (start) ───────────────────────────────────►  hidden
      │                                            │  second-instance (summon):
      │                                            │    win.show(); win.focus();
      │                                            │    win.setSkipTaskbar(false); app.dock?.show()
      │                                            ▼
      │                                          visible (foreground)
      │                                            │  win.on("close") && !quitting:
      │                                            │    e.preventDefault(); win.hide();
      │                                            │    win.setSkipTaskbar(true); app.dock?.hide()
      │  ◄─────────────────────────────────────────┘
      │
      │  app.quit()  (SIGINT / SIGTERM / Cmd·Ctrl-Q)  →  quitting = true
      ▼                                                   → win.on("close") lets it through
   process exits   (window-all-closed never fired while hidden; app.quit() drives the exit)
```

### State — a non-`--background` instance

```
default source     : win.show()        → close → window destroyed → window-all-closed → app.quit()
named / env-dir     : win.showInactive() → (same close path; showInactive only affects focus, not close)
```

No `close` interception, no Dock/taskbar calls, no `quitting` dependence — identical to
feature 012 except the initial reveal is `showInactive()` instead of focused `show()` for a
named / env-dir instance.

---

## 3. `webPreferences` delta (R7)

| Surface | Change |
|---|---|
| `BrowserWindow` (`src/main/index.ts`) | `show: false` (was default `true`); `webPreferences.backgroundThrottling: false` |
| tab `WebContentsView` (`src/main/tabs/tab-manager.ts`) | `webPreferences.backgroundThrottling: false` |

Nothing else in `webPreferences` changes; `sandbox`, `contextIsolation`, `preload` are as
feature 012 left them.

---

## 4. Not changed

- `src/shared/types.ts` — nothing new crosses IPC; the renderer never learns visibility.
- `src/main/settings.ts` / `settings.json` — no field (Q2).
- `src/main/mcp/**` — the MCP surface, tool set, and handshake are identical for a hidden
  instance.
- The action queue — untouched (Principle V).
