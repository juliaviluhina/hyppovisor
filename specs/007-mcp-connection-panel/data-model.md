# Phase 1 Data Model: MCP Connection Panel

One new persistent file (`<userData>/settings.json`), a handful of in-memory structures, and
the IPC payloads. Nothing is written to the shared data directory. No new `ErrorCode` — IPC
handlers return plain `{ ok, error }` objects; the MCP error surface is untouched.

## 1. `ConnectionSettings` — `src/main/settings.ts`, persisted

```ts
interface ConnectionSettings {
  port: number;              // integer 1–65535
  tokenRequired: boolean;
  token: string | null;      // 32 hex chars when tokenRequired; null otherwise
}

const DEFAULTS: ConnectionSettings = { port: 7357, tokenRequired: false, token: null };
```

Serialised as `<userData>/settings.json`, `JSON.stringify(settings, null, 2)` + trailing
newline.

**Validation (on load and before save):**

| Field | Rule | On violation (load) |
|---|---|---|
| `port` | `Number.isInteger` and `1 ≤ port ≤ 65535` | whole file → `DEFAULTS`, `existed: false` |
| `tokenRequired` | `typeof === "boolean"` | whole file → `DEFAULTS` |
| `token` | `string` (32 hex) or `null`; non-null **iff** `tokenRequired` | whole file → `DEFAULTS` |
| file | exists, readable, parses as JSON object | `DEFAULTS`, `existed: false` |

A malformed file is not rewritten on load; the next `saveSettings()` overwrites it (R3).

## 2. `EnvOverrides` — `src/main/settings.ts`, read once at startup

```ts
interface EnvOverrides {
  port?: number;             // HYPPO_MCP_PORT, parsed; ignored if not a valid port
  token?: string | null;     // HYPPO_MCP_TOKEN: non-empty → that string; set-but-empty → undefined (unset)
  stdio: boolean;            // HYPPO_MCP_STDIO === "1"
}
```

`readEnvOverrides()` reproduces today's parsing: `Number(HYPPO_MCP_PORT) || undefined` then
range-check; `HYPPO_MCP_TOKEN?.trim() || undefined`.

## 3. `EffectiveConnection` — resolved, read-only, crosses IPC

```ts
type Transport = "http" | "stdio";
type Source = "env" | "persisted" | "default";

interface EffectiveConnection {
  transport: Transport;
  port: number;                 // meaningful only when transport === "http"
  endpointUrl: string;          // `http://127.0.0.1:${port}/mcp`; "" when stdio
  tokenRequired: boolean;
  token: string | null;         // the real value (masked by the renderer); null when not required
  portSource: Source;
  tokenSource: Source;
  lastRequest: LastRequestInfo | null;
}
```

`resolveEffective(settings, env, settingsFileExisted)`:

| Field | Value | Source rule |
|---|---|---|
| `transport` | `env.stdio ? "stdio" : "http"` | — |
| `port` | `env.port ?? settings.port` (settings is `DEFAULTS` when absent) | `env.port!=null` → `env`; else `settingsFileExisted` → `persisted`; else `default` |
| `tokenRequired` | `env.token!==undefined ? env.token!==null` : `settings.tokenRequired` | as above against `env.token` |
| `token` | `env.token!==undefined ? env.token` : `settings.tokenRequired ? settings.token : null` | as above |

## 4. `LastRequestInfo` — in-memory only (`HttpMcpHandle`), P3

```ts
interface LastRequestInfo {
  at: number;                       // Date.now() ms
  tool: string | null;              // registered tool name; null for a rejected (401) request
  outcome: "ok" | "rejected";
}
```

Never persisted. Set by `onToolInvoked(name)` (→ `ok`) or the handler's 401 branch (→
`rejected`). `index.ts` pushes it on `connection:changed`, throttled ~1/s.

## 5. `StdioLaunch` — computed in main, carried in `chrome:get-connection`

```ts
interface StdioLaunch {
  command: string;   // process.execPath (the electron binary)
  args: string[];    // [ <abs path to dist/main/index.js> ]
  env: { HYPPO_MCP_STDIO: "1" };
}
```

Used by `stdioJsonConfig()` in the renderer. Present in every `get-connection` reply (cheap;
lets the panel render the stdio snippet immediately if `transport === "stdio"`).

## 6. `HttpMcpHandle` — extended (`src/main/mcp/server.ts`)

```ts
interface HttpMcpHandle {
  readonly url: string;                 // tracks the current port
  readonly port: number;
  readonly requiresToken: boolean;      // authToken !== null
  rebind(port: number): Promise<void>;  // resolve = now on new port & old closed; reject = old kept
  setToken(token: string | null): void; // live; no rebind
  lastRequest(): LastRequestInfo | null;
  close(): void;
}
```

Internal mutable state: `let server: HttpServer`, `let currentPort: number`,
`let authToken: string | null`, `let last: LastRequestInfo | null`. `generateToken()` (exists)
produces the 32-hex token.

## 7. IPC payloads — see [contracts/ipc-connection.md](./contracts/ipc-connection.md)

| Channel | In | Out |
|---|---|---|
| `chrome:get-connection` | — | `EffectiveConnection & { stdioLaunch: StdioLaunch; appVersion: string; license: "Apache-2.0" }` |
| `chrome:set-port` | `number` | `{ ok: true; port: number } \| { ok: false; error: string }` |
| `chrome:set-token-required` | `boolean` | `{ ok: true } & EffectiveConnection \| { ok: false; error: string }` |
| `chrome:regenerate-token` | — | `{ ok: true } & EffectiveConnection \| { ok: false; error: string }` |
| `chrome:set-panel-open` | `boolean` | `void` |
| `connection:changed` (event) | — | `EffectiveConnection` |

**`set-port` errors**: `"port must be an integer between 1 and 65535"`,
`"port <n> is already in use"`, `"port is set by the HYPPO_MCP_PORT environment variable"`,
`"stdio mode has no network port"`. `< 1024` is accepted with `{ ok: true }` but the panel
shows a non-blocking warning (FR-012).

**`set-token-required` / `regenerate-token` errors**:
`"token is set by the HYPPO_MCP_TOKEN environment variable"`, `"stdio mode uses no token"`.

## 8. `settings.json` lifecycle

```
startup ─► loadSettings() ─► resolveEffective(…, env, existed) ─► startHttpMcpServer({ port, token })
                                                                         │
panel: set-port n ─► validate ─► handle.rebind(n) ─┬─ resolve ─► settings.port = n ─► saveSettings ─► connection:changed
                                                   └─ reject  ─► { ok:false, error } (no write, old port kept)

panel: set-token-required b ─► b ? token = generateToken() : token = null
                              ─► handle.setToken(token) ─► settings.{tokenRequired,token} ─► saveSettings ─► connection:changed

panel: regenerate-token ─► token = generateToken() ─► handle.setToken(token) ─► saveSettings ─► connection:changed
```

When an env override is in force for a field, the corresponding handler returns
`{ ok: false, error }` and writes nothing; the persisted value is retained for a future
launch without the override (FR-014/FR-021).

## 9. Renderer-side types (redeclared in `src/renderer/panel.ts`)

`panel.ts` redeclares `EffectiveConnection`, `StdioLaunch`, `LastRequestInfo`, and a
`HyppoConnectionApi` interface for the new preload methods — mirroring how `app.ts` already
redeclares `TabSummary` / `HyppoApi`. `snippets.ts` exports only pure functions +
`ABOUT_TEXT` and imports nothing from Electron.
