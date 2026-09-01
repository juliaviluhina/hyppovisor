# Phase 1 Data Model: Run More Than One HyppoVisor

Three shapes. Two are transient (computed at launch, never persisted); the third is the
existing feature-007 `EffectiveConnection` with three new fields. **No new persisted file
and no format change** to any per-profile file (FR-024).

---

## 1. `ResolvedInstance` — transient, from `src/main/instance.ts`

Computed once at the top of `main()` from `process.argv` + `process.env` + the pre-override
`userData` path. Not serialised.

| Field | Type | Rule |
|---|---|---|
| `name` | `string \| null` | The validated `--instance` value (`/^[a-z0-9][a-z0-9_-]{0,31}$/`), or `null` for a default / env-dir launch. |
| `label` | `string` | Precedence: `name` → basename of `HYPPO_USER_DATA_DIR` run through `deriveLabel` → `""`. Drives window title, panel header, `serverName`. |
| `userDataDir` | `string \| null` | `HYPPO_USER_DATA_DIR` verbatim if set; else `join(baseUserDataDir, "instances", name)` if `name`; else `null` (leave Electron's default). |
| `cliPort` | `number \| undefined` | `--port` value if an integer in 1–65535; `undefined` otherwise. An out-of-range/non-numeric `--port` aborts startup (FR-002). |
| `source` | `"instance" \| "env-dir" \| "default"` | Which rule set `userDataDir`. Diagnostic + the panel's "launched with…" notice. |

**Derived helpers (pure, same module)**

| Function | Signature | Rule |
|---|---|---|
| `validateInstanceName` | `(raw: string) => { ok: true; name } \| { ok: false; reason }` | Regex above. `reason` names the allowed form. |
| `deriveLabel` | `(raw: string) => string` | Lowercase; replace each run of non-`[a-z0-9_-]` with `-`; trim leading/trailing `-`; clamp to 32. May return `""`. |
| `serverNameFor` | `(label: string) => string` | `label ? \`hyppovisor-${label}\` : "hyppovisor"`. |
| `collisionMessage` | `(r: ResolvedInstance) => { title: string; body: string }` | Names the profile (label or "the default profile") and the fix (`--instance <name>` + a different `--port`). |
| `classifyListenError` | `(err: unknown) => "port-unavailable" \| "error"` | `err.code === "EADDRINUSE"` or `/EADDRINUSE\|in use/i` on the message → `"port-unavailable"`; else `"error"`. |

**Validation / precedence rules**

1. `--instance` present and invalid → `showErrorBox` + `exit(1)` before `setPath` / the
   lock / any `mkdir` (FR-003).
2. `HYPPO_USER_DATA_DIR` set → it wins for `userDataDir` regardless of `--instance`
   (FR-004); `label` still comes from `--instance` when that name is present, else the
   override's basename (FR-004a).
3. Neither set → `userDataDir = null`, `label = ""`, `source = "default"` — byte-identical
   to today (FR-005 / SC-007).

---

## 2. Startup sequence state (in `main()`)

Order is load-bearing (all before `app.whenReady()` except the window):

1. `const resolved = resolveInstance(process.argv, process.env, app.getPath("userData"))`.
2. If `--instance` was invalid → `showErrorBox` + `exit(1)`.
3. If `resolved.userDataDir` → `mkdirSync(dir, { recursive: true })` then
   `app.setPath("userData", dir)`.
4. `if (!app.requestSingleInstanceLock()) { showErrorBox(collisionMessage(resolved)); app.exit(0) }`.
5. `app.on("second-instance", …)` → restore/show/focus the window (FR-008).
6. `await app.whenReady()`; create the one `BrowserWindow({ title })`; add the
   `page-title-updated` guard.
7. Compute `serverName = serverNameFor(resolved.label)`; resolve the effective port
   (`env ?? resolved.cliPort ?? persisted ?? default`).
8. `try { httpHandle = await startHttpMcpServer(deps, { port, token, serverName, … }) }
   catch (err) { serverStatus = classifyListenError(err) }` — `serverStatus` starts
   `"listening"` (or `"stdio"`); on catch it becomes `"port-unavailable"` / `"error"` and
   `httpHandle` stays `undefined`.

---

## 3. `EffectiveConnection` — existing (feature 007), three new fields

`src/shared/types.ts`. Produced by `currentEffective()`; carried by `chrome:get-connection`
and the `connection:changed` push (no new channel).

| Field | Type | New? | Meaning |
|---|---|---|---|
| `transport` | `"http" \| "stdio"` | — | unchanged |
| `port` | `number` | — | effective port (now `env ?? cli ?? persisted ?? default`) |
| `endpointUrl` | `string` | — | unchanged |
| `tokenRequired` / `token` | `boolean` / `string \| null` | — | unchanged |
| `portSource` | `"env" \| "cli" \| "persisted" \| "default"` | **`"cli"` added** | `"cli"` when `--port` set the value; panel field stays editable (only `"env"` is read-only) with a "Launched with --port N" notice |
| `tokenSource` | `"env" \| "persisted" \| "default"` | — | unchanged |
| `lastRequest` | `LastRequestInfo \| null` | — | unchanged |
| `serverStatus` | `"listening" \| "port-unavailable" \| "error" \| "stdio"` | **new** | HTTP bind outcome; `"stdio"` when `transport === "stdio"` |
| `instanceLabel` | `string` | **new** | `resolved.label`; `""` for the default instance → panel header shows nothing |
| `serverName` | `string` | **new** | `serverNameFor(label)`; snippets and the MCP handshake use it |

`ConnectionSource` (the shared union) gains `"cli"`. `panel.ts`'s local redeclaration and
`settings.ts`'s `sourceFor` follow.

**State transitions — `serverStatus`**

```
                 startHttpMcpServer ok
   (start) ─────────────────────────────────► listening
      │                                          │
      │ EADDRINUSE                                │ chrome:set-port(freePort) ok
      ▼                                           │  (restarts the never-bound server,
 port-unavailable ◄────────────────────────────── ┘   or rebinds the live one)
      │  chrome:set-port(stillBusy) fails → stays port-unavailable
      │
      │ non-EADDRINUSE bind failure
      ▼
    error  ── chrome:set-port(freePort) ok ──► listening

 transport === "stdio"  ──►  stdio   (terminal; no port)
```

---

## 4. Snippet builder input (`src/renderer/snippets.ts`)

| Shape | Change |
|---|---|
| `SnippetState` | `+ serverName?: string` (default `"hyppovisor"`) |
| `StdioLaunchLike` consumers | `stdioJsonConfig(launch, serverName = "hyppovisor")` |

`mcpAddCommand` / `mcpJsonConfig` / `stdioJsonConfig` emit `serverName` as the `mcpServers`
key / `claude mcp add` name. Default preserved so SC-007 and every existing
`connection-snippets.test.ts` case without `serverName` still pass.
