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

## Recent URLs

The address bar offers a dropdown of the last 20 URLs **you** opened from it
(newest first, no duplicates). Agent opens and failed loads are not recorded.
It persists to `recent-urls.json` in the user-data directory — a plain JSON
array of strings, safe to hand-edit or delete. The **Connection & MCP** panel
has a **Clear recent URLs** button. Cap override for tests only:
`HYPPO_RECENT_URLS_CAP`.

## What the app writes to the user-data directory

`settings.json` (panel settings), `recent-urls.json` (address-bar history),
`interaction-log.jsonl` (every MCP interaction, permitted or refused). Nothing
else; no page content is ever persisted.
