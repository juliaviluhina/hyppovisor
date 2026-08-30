# Contract: Connection-panel IPC

App-internal IPC between the renderer chrome and the main process. Not part of the MCP tool
surface. All channels are `ipcMain.handle` (renderer `ipcRenderer.invoke`) except
`connection:changed`, which is `webContents.send` → renderer. Exposed to the renderer via
`src/preload/chrome.cjs` under `window.hyppo`.

## Preload surface (additions to `window.hyppo`)

```ts
getConnection():        Promise<EffectiveConnection & { stdioLaunch: StdioLaunch }>
setPort(port: number):  Promise<{ ok: true; port: number } | { ok: false; error: string }>
setTokenRequired(b: boolean): Promise<{ ok: true } & EffectiveConnection | { ok: false; error: string }>
regenerateToken():      Promise<{ ok: true } & EffectiveConnection | { ok: false; error: string }>
setPanelOpen(open: boolean): Promise<void>
onConnectionChanged(cb: (c: EffectiveConnection) => void): void
```

`onMcpReady` is removed. Any existing caller uses `onConnectionChanged` instead.

## `chrome:get-connection`

- **In**: none.
- **Out**: the full `EffectiveConnection` (data-model §3) plus `stdioLaunch` (§5),
  `appVersion` (`app.getVersion()`), and `license` (`"Apache-2.0"`).
- Never throws. Safe to call any time; the panel calls it on open.

## `chrome:set-port`

- **In**: `number`.
- **Behaviour**:
  1. If `transport === "stdio"` → `{ ok: false, error: "stdio mode has no network port" }`.
  2. If `portSource === "env"` → `{ ok: false, error: "port is set by the HYPPO_MCP_PORT environment variable" }`.
  3. If not an integer in `1..65535` → `{ ok: false, error: "port must be an integer between 1 and 65535" }`.
  4. If equal to the current port → `{ ok: true, port }` (no rebind, no write).
  5. `handle.rebind(port)`:
     - **resolves** → `settings.port = port`; `saveSettings()`; emit `connection:changed`;
       return `{ ok: true, port }`.
     - **rejects** (`EADDRINUSE` etc.) → no write, old listener still serving; return
       `{ ok: false, error: "port <n> is already in use" }` (or the raw bind error message).
- **Post-condition on `ok`**: the server accepts MCP requests on `port` and refuses them on
  the previous port; every subsequent `get-connection` / `connection:changed` reports
  `port` and `portSource` ∈ {`persisted`}.
- **Post-condition on `!ok`**: server state byte-for-byte unchanged (SC-010).
- A value `< 1024` still returns `{ ok: true }`; the renderer shows a non-blocking "ports
  below 1024 may require elevated privileges" note (FR-012).

## `chrome:set-token-required`

- **In**: `boolean`.
- **Behaviour**:
  1. `stdio` → `{ ok: false, error: "stdio mode uses no token" }`.
  2. `tokenSource === "env"` → `{ ok: false, error: "token is set by the HYPPO_MCP_TOKEN environment variable" }`.
  3. `true`  → `token = generateToken()`; `handle.setToken(token)`.
     `false` → `token = null`; `handle.setToken(null)` (stored token discarded, not just hidden).
  4. `settings.tokenRequired = b`; `settings.token = token`; `saveSettings()`;
     emit `connection:changed`; return `{ ok: true, ...EffectiveConnection }`.
- **Post-condition (`true`)**: requests without `Authorization: Bearer <token>` get `401`;
  requests with it succeed.
- **Post-condition (`false`)**: all well-formed requests succeed; `settings.token === null`
  on disk.

## `chrome:regenerate-token`

- **In**: none.
- **Behaviour**: `stdio` / `tokenSource === "env"` → same rejections as above. If a token is
  not currently required → `{ ok: false, error: "no token to regenerate" }`. Else
  `token = generateToken()`; `handle.setToken(token)`; persist; emit `connection:changed`;
  return `{ ok: true, ...EffectiveConnection }`.
- **Post-condition**: the previous token immediately yields `401`; the new token succeeds.
  The renderer shows "connected clients must reconnect with the new token" (FR-019).

## `chrome:set-panel-open`

- **In**: `boolean`.
- **Behaviour**: `true` → `tabs.setChromeOverlay(true)` (every tab `WebContentsView`
  `setVisible(false)`); `false` → `setVisible(true)` for all. Idempotent. No settings change,
  no event.
- **Out**: `void`.

## `connection:changed` (event → renderer)

- **Payload**: `EffectiveConnection` (includes `lastRequest`).
- **Emitted**:
  - once, right after `win.loadFile(...)` (replaces `mcp:ready`);
  - after every successful `set-port` / `set-token-required` / `regenerate-token`;
  - on each last-request update, throttled to ≤ 1 per second.
- The renderer updates both the bottom status line (FR-001a) and the panel (if open).

## Environment-controlled behaviour (FR-014 / FR-021 / FR-029)

| Env var set | `get-connection` shows | mutations for that field |
|---|---|---|
| `HYPPO_MCP_PORT` | `portSource: "env"`, `port` = env value | `set-port` → `{ ok: false, error }` |
| `HYPPO_MCP_TOKEN` | `tokenSource: "env"`, `tokenRequired`/`token` per env | `set-token-required`, `regenerate-token` → `{ ok: false, error }` |
| `HYPPO_MCP_STDIO=1` | `transport: "stdio"`, `endpointUrl: ""` | all `set-*` → `{ ok: false, error }` |

The renderer additionally disables the affected control from `*Source` so the round-trip is
never needed, but main enforces regardless.

## Non-goals

- No channel to change transport, host, or any limit other than port/token.
- No channel exposes raw `process.env` or the settings file path.
- `connection:changed` never carries MCP request arguments or responses — only
  `lastRequest` metadata (`at`, `tool`, `outcome`).
