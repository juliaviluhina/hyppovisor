# Contract: `settings.json`

The one persistent artifact this feature adds.

## Location

`<app.getPath("userData")>/settings.json`

- Same directory as `interaction-log.jsonl` (`InteractionLog` uses the same base path).
- Overridable for tests via `HYPPO_USER_DATA_DIR` → `app.setPath("userData", dir)` before
  `app.whenReady()`.
- **Never** the shared data directory. Not read, referenced, or required by any orchestrator
  (FR-028).

## Schema

```json
{
  "port": 7357,
  "tokenRequired": false,
  "token": null
}
```

| Key | Type | Constraint |
|---|---|---|
| `port` | number | integer, `1 ≤ port ≤ 65535` |
| `tokenRequired` | boolean | — |
| `token` | string \| null | 32 lowercase hex chars when `tokenRequired` is `true`; `null` when `false` |

Written as `JSON.stringify(settings, null, 2)` + `"\n"`. Human-readable and safe to delete
(FR-030).

## Precedence with the environment (FR-029)

For `port` and for the token state, the value in force is:

```
environment variable  >  settings.json  >  built-in default
```

- `HYPPO_MCP_PORT` set and valid → that port; `settings.json.port` is **kept as-is** on disk
  but not applied while the env var is present.
- `HYPPO_MCP_TOKEN` set (non-empty) → token required with that value; `settings.json`'s
  `tokenRequired` / `token` kept but not applied.
- `HYPPO_MCP_STDIO=1` → no HTTP listener; port/token in `settings.json` are irrelevant this
  run but untouched.
- Built-in default: `port` 7357, no token — used only when `settings.json` is absent/invalid
  and no env var applies.

## Missing / unparseable (FR-030)

`loadSettings()` returns `DEFAULTS` and `existed: false` — without throwing, without
blocking startup, without rewriting the file — when the file:

- does not exist, or
- cannot be read, or
- does not parse as a JSON object, or
- fails any schema constraint above (including `token` non-null while `tokenRequired` is
  `false`, or vice versa).

The malformed file is left in place; the first successful `saveSettings()` (triggered by a
panel action) overwrites it with a valid document.

## Writes

`saveSettings(settings)` is called only after a successful `chrome:set-port` /
`chrome:set-token-required` / `chrome:regenerate-token`. It writes the whole object
atomically (write temp + rename, or `writeFileSync` — small file, single writer). No partial
updates, no append. Idempotent: writing the same object twice is a no-op in effect.

## What is *not* here

- No window bounds, zoom, theme, or tab state (out of scope; not this feature).
- No MCP request history (the last-request line is in-memory only).
- No secrets other than the MCP bearer token, which is explicitly not a site credential
  (constitution 1.3.1, FR-032).
