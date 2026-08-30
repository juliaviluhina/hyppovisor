# Configuration

## From the app (normal way)

Click the hippo button in the top bar to open the **Connection & MCP** panel.
Set the **Listening port** (Apply rebinds live) and toggle **Require a bearer
token** (generated, masked, regenerable). Both persist — see
[settings.json](#settingsjson).

## From the environment

For launches that can't touch the UI — CI, wrapper scripts, stdio — use env vars.

| Env var | Default | Effect |
|---|---|---|
| `HYPPO_MCP_PORT` | `7357` | HTTP port (always bound to `127.0.0.1`). Panel's port field goes read-only. |
| `HYPPO_MCP_TOKEN` | _unset_ | Require `Authorization: Bearer <token>`. Panel's token controls go read-only. |
| `HYPPO_MCP_STDIO` | _unset_ | `1` = stdio instead of HTTP. |

```bash
HYPPO_MCP_PORT=8080 HYPPO_MCP_TOKEN=s3cret npm start
```

## Precedence

**env var → `settings.json` → built-in default.**

An env-set value applies for that run only; the persisted value is kept for a
later launch without the override.

## settings.json

Port and token set in the panel persist to `settings.json` in the app's
user-data directory. Plain JSON, safe to delete.
