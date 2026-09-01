# Contract: Instance registry (`runtime.json` + `chrome:list-instances`)

The discovery half of User Story 1. Consumed by `src/main/instances/registry.ts` and one
IPC handler in `src/main/index.ts`. No network beyond a loopback TCP `connect`.

## The file — `<profile>/runtime.json`

One per running instance, in that instance's own profile directory:

- default instance → `<app-support-root>/runtime.json`
- `--instance <name>` → `<app-support-root>/instances/<name>/runtime.json`
- `HYPPO_USER_DATA_DIR=<dir>` → `<dir>/runtime.json` (enumerable only if `<dir>` is under
  `<app-support-root>/instances/`)

`<app-support-root>` = the value of `app.getPath("userData")` read **before**
`app.setPath("userData", …)` in `main()` (identical to feature 012's `baseUserDataDir`).

```jsonc
{
  "schema": 1,
  "pid": 40321,
  "port": 7358,            // number, or null in stdio mode
  "mode": "background",    // "foreground" | "background"
  "label": "work",         // "" for the default instance
  "startedAt": "2026-09-01T18:22:04.511Z"
}
```

Write is atomic: write `runtime.json.<pid>.tmp`, `renameSync` over `runtime.json`.

| Event | Registry call |
|---|---|
| MCP server bound, end of startup | `writeRuntimeFile(userDataDir, { pid, port, mode, label, startedAt })` |
| `chrome:set-port` success (new port) | `rewriteRuntimePort(userDataDir, port)` |
| `app.on("before-quit")` | `clearRuntimeFile(userDataDir)` |
| scan finds a dead-PID file | best-effort `unlinkSync` |

## `listInstances(appSupportRoot, self, cfg) → Promise<InstanceSummary[]>`

1. `dirs = enumerateProfiles(appSupportRoot)` — `[appSupportRoot]` plus each subdirectory
   of `appSupportRoot/instances/` (missing `instances/` → just the root).
2. For each dir: `r = readRuntimeFile(dir)`. Skip on `null` (absent / unreadable / bad
   `schema` / missing field).
3. Skip (and best-effort `unlinkSync`) when `!isPidAlive(r.pid)`.
4. Skip when `r.pid === self.pid` (merged from `self` in step 6, authoritatively).
5. For the survivors, `probePort(r.port, cfg.probeTimeoutMs)` in parallel →
   `state = ok ? "responding" : "not-responding"`; `r.port === null` → `state = "stdio"`.
6. Prepend `self` as an `InstanceSummary` with `isCurrent: true`,
   `state: self.port === null ? "stdio" : "responding"`.
7. Sort: current first, then `label` locale compare, then `port`.

Never throws — a filesystem error on one dir drops that dir only.

## `chrome:list-instances`

| | |
|---|---|
| Args | none |
| Reply | `InstanceSummary[]` (see `data-model.md` §3) |
| Errors | none — a scan failure yields `[selfRow]`, and the renderer shows a "can't list other instances" note when `length === 1` and the scan raised (FR-010) |

## `InstanceSummary`

```ts
interface InstanceSummary {
  pid: number;
  label: string;                 // "" → UI shows "(default)"
  port: number | null;           // null → UI shows "stdio"
  mode: "foreground" | "background";
  state: "responding" | "not-responding" | "stdio";
  isCurrent: boolean;
  startedAt: string;
}
```

## Guarantees

- **No shared file.** N instances ⇒ N independent `runtime.json` files, each written only
  by its owner. There is no index, no append log, no lock.
- **Self-healing.** A crashed / `SIGKILL`ed instance leaves a stale file; the next scan
  removes it. A missing file for a live instance (write not yet done, or race) just omits
  it from that poll; the next poll picks it up.
- **Loopback only.** `probePort` connects to `127.0.0.1:<port>`; never a routable address
  (FR-008). It is a bare TCP connect — no HTTP, no MCP call, no token.
- **Same user.** `process.kill(pid, 0)` returning `EPERM` (alive, different owner) still
  lists the instance, but `closeInstance` will surface `{ ok:false, error:"not permitted" }`
  (see `instance-shutdown.md`).
