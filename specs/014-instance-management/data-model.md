# Phase 1 Data Model: Local Instance Management Panel

Three new shapes in `src/shared/types.ts`, one new method on `TabManager`, and an IPC
delta. **No change to any existing persisted file format.** One new per-profile file
(`runtime.json`) that is transient runtime state, not pipeline data.

---

## 1. `InstanceMode` — shared union

```ts
export type InstanceMode = "foreground" | "background";
```

`"background"` ⇔ `ResolvedInstance.background === true` (feature 013 `--background`).
`"foreground"` is every other launch.

---

## 2. `InstanceRuntime` — the `<profile>/runtime.json` file

Written by the owning process only. Atomic (temp file + `renameSync`), like `settings.ts`.

| Field | Type | Rule |
|---|---|---|
| `schema` | `1` | Format version. A reader that sees any other value ignores the file. |
| `pid` | `number` | `process.pid` of the owning instance. |
| `port` | `number \| null` | The **effective** MCP HTTP port at write time (`env ?? cli ?? persisted ?? default`). `null` in stdio mode. |
| `mode` | `InstanceMode` | From `ResolvedInstance.background`. |
| `label` | `string` | `ResolvedInstance.label` — `""` for the default instance. |
| `startedAt` | `string` | ISO 8601, set once when the file is first written. |

**Lifecycle**

| When | Action |
|---|---|
| MCP server bound (end of `main()` startup, after `pushConnection()`) | `writeRuntimeFile(userDataDir, { pid, port, mode, label, startedAt: now })` |
| `chrome:set-port` succeeds with a new port | `rewriteRuntimePort(userDataDir, newPort)` (re-writes the file, `startedAt` preserved) |
| `app.on("before-quit")` | `clearRuntimeFile(userDataDir)` — best-effort `unlinkSync` |
| A `listInstances` scan finds `runtime.json` whose `pid` is dead | best-effort `unlinkSync` (stale-crash reclaim) |

**Tolerance**: absent, unreadable, non-JSON, wrong `schema`, or missing required field →
the entry is skipped, never throws.

---

## 3. `InstanceSummary` — one row in the panel (IPC payload)

Produced by `listInstances()`; carried by `chrome:list-instances`.

| Field | Type | Meaning |
|---|---|---|
| `pid` | `number` | Target for `chrome:close-instance`; part of the row key. |
| `label` | `string` | Display name; `""` renders as `"(default)"`. |
| `port` | `number \| null` | MCP port; `null` → shown as `"stdio"`. |
| `mode` | `InstanceMode` | `"foreground"` / `"background"`. |
| `state` | `"responding" \| "not-responding" \| "stdio"` | Loopback `connect` probe result (R3). |
| `isCurrent` | `boolean` | `pid === process.pid` — row marked "this instance", close control disabled (FR-003 / FR-005). |
| `startedAt` | `string` | ISO 8601, for a relative "up for …" hint (optional in the UI). |

**Ordering**: current instance first, then the rest by `label` (locale compare), then by
`port`. Two entries with the same `label` (distinct `HYPPO_USER_DATA_DIR` dirs) are kept
separate and distinguished by `port` (spec edge case).

**Dedupe**: keyed by `pid`. If the scan re-reads the current instance's own file, the
in-process record wins (authoritative `port` / `mode` / `state`).

---

## 4. Registry module — `src/main/instances/registry.ts`

Pure-ish; `node:fs` + `node:net` + `process.kill`. No Electron import (testable under
`vitest`).

| Export | Signature | Notes |
|---|---|---|
| `writeRuntimeFile` | `(profileDir: string, r: Omit<InstanceRuntime,"schema">) => void` | Atomic write; creates nothing else. |
| `rewriteRuntimePort` | `(profileDir: string, port: number \| null) => void` | Reads, patches `port`, atomic re-write. No-op if the file is gone. |
| `clearRuntimeFile` | `(profileDir: string) => void` | Best-effort `unlinkSync`; swallows `ENOENT`. |
| `readRuntimeFile` | `(profileDir: string) => InstanceRuntime \| null` | Parse + schema/field guard; `null` on any problem. |
| `enumerateProfiles` | `(appSupportRoot: string) => string[]` | `[appSupportRoot, ...readdirSync(join(appSupportRoot,"instances"),{withFileTypes:true}).filter(isDir).map(join)]`; tolerates a missing `instances/` dir. |
| `isPidAlive` | `(pid: number) => boolean` | `try { process.kill(pid, 0); return true } catch (e) { return e.code === "EPERM" }` (EPERM ⇒ alive but not ours). |
| `probePort` | `(port: number, timeoutMs: number) => Promise<boolean>` | `net.connect` to `127.0.0.1:port`; resolve `true` on `"connect"`, `false` on `"error"`/timeout; always `destroy()`. |
| `listInstances` | `(appSupportRoot: string, self: SelfRecord, cfg: {probeTimeoutMs}) => Promise<InstanceSummary[]>` | enumerate → read files → drop dead PIDs (unlink stale) → probe live ports in parallel → merge `self` → sort. |
| `closeInstance` | `(pid: number, cfg: {graceMs}) => Promise<{ok:true,forced?:boolean,alreadyGone?:boolean} \| {ok:false,error:string}>` | `SIGTERM`; poll `isPidAlive` @250 ms; `SIGKILL` after `graceMs`; map `ESRCH`→`alreadyGone`, `EPERM`→`{ok:false,"not permitted"}`. |

`SelfRecord` = `{ pid: number; label: string; port: number \| null; mode: InstanceMode;
startedAt: string }` — passed from `index.ts` so the current instance never depends on its
own file being readable.

---

## 5. `TabManager.closeAll()` — `src/main/tabs/tab-manager.ts`

```ts
closeAll(): void
```

For every tab: `this.win.contentView.removeChildView(tab.view)`, `tab.view.webContents.close()`.
Then `this.tabs.clear()`, `this.activeId = null`, `this.layout()`, `this.events.onChange()`
(one event, not one per tab). Idempotent — a no-op when `this.tabs` is already empty
(returns without firing `onChange`). Does not touch `overlay`, the MCP server, settings, or
the session.

---

## 6. IPC delta — `src/preload/chrome.cjs` + `src/main/index.ts`

**No channel is removed.** Three new `ipcMain.handle` invoke routes on the existing `hyppo`
bridge; no new push channel (the panel polls while open).

| Channel | Args | Reply | Handler |
|---|---|---|---|
| `chrome:list-instances` | — | `InstanceSummary[]` | `listInstances(appSupportRoot, selfRecord, { probeTimeoutMs: config.instanceProbeTimeoutMs })` |
| `chrome:close-instance` | `pid: number` | `{ ok:true, forced?, alreadyGone? } \| { ok:false, error }` | reject if `pid === process.pid` → `{ ok:false, error:"can't close the current instance" }`; else `closeInstance(pid, { graceMs: config.instanceShutdownGraceMs })` |
| `chrome:close-all-tabs` | — | `{ closed: number }` | `const n = tabs.list().length; tabs.closeAll(); return { closed: n }` |

`preload/chrome.cjs` adds:

```js
listInstances: () => ipcRenderer.invoke("chrome:list-instances"),
closeInstance: (pid) => ipcRenderer.invoke("chrome:close-instance", pid),
closeAllTabs: () => ipcRenderer.invoke("chrome:close-all-tabs"),
```

The renderer confirm modal (R4) gates `closeInstance`; `main` still hard-refuses
`pid === process.pid` as defence in depth.

---

## 7. `config.ts` additions

| Key | Default | Env | Purpose |
|---|---|---|---|
| `instanceShutdownGraceMs` | `5000` | `HYPPO_INSTANCE_SHUTDOWN_GRACE_MS` | SIGTERM→SIGKILL window (R2). |
| `instanceProbeTimeoutMs` | `400` | `HYPPO_INSTANCE_PROBE_TIMEOUT_MS` | loopback connect deadline (R3). |
| `instancePollMs` | `2000` | `HYPPO_INSTANCE_POLL_MS` | renderer list refresh cadence while the panel is open (FR-007 / SC-005). |

---

## 8. Renderer state — `src/renderer/panel.ts`

No persisted renderer state. While `#panel` is open:

- `instTimer: number | undefined` — `setInterval(refreshInstances, instancePollMs)`,
  cleared in `close()`.
- `pendingClose: { pid: number; label: string; port: number | null } | null` — the row
  awaiting confirm-modal resolution.
- `tabCount: number` — from the existing `onTabsChanged` feed, drives the "Close all tabs"
  `disabled`.

`refreshInstances()` calls `hyppo.listInstances()`, diffs by `pid`, re-renders the section.
A `closeInstance` result of `{ ok:false }` shows an inline `.notice` in the section (same
pattern as the port/token notices); success lets the next poll drop the row.
