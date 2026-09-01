# Contract delta: connection state & panel (feature 007 → 012)

Feature 012 adds three fields to `EffectiveConnection`, one `ConnectionSource` value, a
`serverName` to the snippet builders, and one conditional block + one header line in the
panel. **No IPC channel is added or removed.** The `connection:changed` push and
`chrome:get-connection` reply simply carry the new fields.

## `EffectiveConnection` (src/shared/types.ts)

```ts
type ConnectionSource = "env" | "cli" | "persisted" | "default";   // + "cli"

interface EffectiveConnection {
  // ...unchanged fields...
  portSource: ConnectionSource;      // may now be "cli"
  serverStatus: "listening" | "port-unavailable" | "error" | "stdio";  // NEW
  instanceLabel: string;             // NEW — "" for the default instance
  serverName: string;                // NEW — "hyppovisor" | "hyppovisor-<label>"
}
```

`chrome:get-connection` reply = `EffectiveConnection` + the existing
`{ stdioLaunch, appVersion, license }`. Add nothing else.

## `resolveEffective` (src/main/settings.ts)

```ts
resolveEffective(settings, env, existed, cliPort?: number): EffectiveConnection
```

- port = `env.port ?? cliPort ?? settings.port`
- `portSource`: `env.port !== undefined` → `"env"`; else `cliPort !== undefined` → `"cli"`;
  else `existed` → `"persisted"`; else `"default"`
- `serverStatus`, `instanceLabel`, `serverName` are filled by the caller
  (`currentEffective()` in `index.ts`), like `lastRequest` today.

## `chrome:set-port` (src/main/index.ts) — recovery path

Current: returns `{ ok:false, error:"the HTTP MCP server is not running" }` when
`!httpHandle`.

New: when `transport === "http"` and `portSource !== "env"`:

- `httpHandle` exists → `rebind(port)` as today.
- `httpHandle` undefined (never bound / `port-unavailable` / `error`) → call
  `startHttpMcpServer` afresh on `port`; on success set `httpHandle`, persist when `port`
  differs from the env/default, `pushConnection()` (now `serverStatus: "listening"`).
- bind fails → `{ ok:false, error }`, `serverStatus` unchanged.

A same-port retry is "Apply" with the unchanged number.

## MCP server name (src/main/mcp/server.ts)

```ts
makeServer(deps, serverName = "hyppovisor")
startHttpMcpServer(deps, { ..., serverName?: string })
startStdioMcpServer(deps, { serverName?: string })
```

`new McpServer({ name: serverName, version: "0.1.0" })` — surfaces in the `initialize`
response as `serverInfo.name`. Default `"hyppovisor"` keeps the handshake identical for the
default instance.

## Snippet builders (src/renderer/snippets.ts)

```ts
interface SnippetState { port; tokenRequired; token; serverName?: string /* = "hyppovisor" */ }
stdioJsonConfig(launch, serverName = "hyppovisor")
```

`mcpAddCommand` / `mcpJsonConfig` / `stdioJsonConfig` emit `serverName` as the
`claude mcp add` name / `mcpServers` key.

## Panel (src/renderer/panel.ts + index.html)

- `index.html` `#panel-head`: add `<span id="panel-instance"></span>` after the `<h2>`;
  CSS `.panel-error { color: crimson; font-weight: 600; margin: 8px 0; }`.
- `panel.ts`:
  - local `type ConnectionSource` gains `"cli"`.
  - `open()` / `render()` set `#panel-instance` text = `c.instanceLabel` (empty → blank).
  - `renderHttp(c)`: if `c.serverStatus === "port-unavailable"`, prepend a `.panel-error`
    div — *"Port {c.port} is in use — another HyppoVisor instance? Change the port below
    and Apply, or relaunch with a different --port."* If `"error"`, *"The MCP server could
    not start."* Endpoint + snippet blocks still render.
  - `renderPortSection(c)`: `c.portSource === "cli"` → field stays enabled, notice
    *"Launched with --port {c.port}."*; only `"env"` disables the field (unchanged).
  - snippet builders receive `serverName: c.serverName`.

## Backward compatibility

- Default instance: `serverStatus:"listening"`, `instanceLabel:""`, `serverName:"hyppovisor"`,
  `portSource` one of the pre-012 values → panel and snippets render exactly as before
  (SC-007).
- `connection-snippets.test.ts` cases that omit `serverName` exercise the `"hyppovisor"`
  default.
