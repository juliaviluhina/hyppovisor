# Configuration

## From the app (normal way)

Click the hippo button in the top bar to open the **Connection & MCP** panel.
Set the **Listening port** (Apply rebinds live) and toggle **Require a bearer
token** (generated, masked, regenerable). Both persist — see
[settings.json](#settingsjson).

## Launch flags

| Flag | Effect |
|---|---|
| `--instance <name>` | Run a **named instance**: its own profile directory (`<user-data>/instances/<name>/`) and a display label. `<name>` is 1–32 chars, lowercase letters / digits / `-` / `_`, first char alphanumeric (e.g. `work`, `client-2`). An out-of-form name aborts startup. |
| `--port <n>` | MCP HTTP port for this process (integer 1–65535). Omit it and the port resolves per the precedence below. Out-of-range aborts startup. |

```bash
npx electron . --instance work --port 7358
```

See [Run more than one HyppoVisor](#run-more-than-one-hyppovisor).

## From the environment

For launches that can't touch the UI — CI, wrapper scripts, stdio — use env vars.
They are **overrides**: they win over the launch flags and over `settings.json`,
and apply for that run only.

| Env var | Default | Effect |
|---|---|---|
| `HYPPO_MCP_PORT` | `7357` | HTTP port (always bound to `127.0.0.1`). Panel's port field goes read-only. |
| `HYPPO_MCP_TOKEN` | _unset_ | Require `Authorization: Bearer <token>`. Panel's token controls go read-only. |
| `HYPPO_MCP_STDIO` | _unset_ | `1` = stdio instead of HTTP. |
| `HYPPO_USER_DATA_DIR` | _Electron default_ | Use this exact directory as the profile (settings, recent URLs, interaction log, browser session). Overrides `--instance`'s directory; the display label then comes from `--instance` if given, else this path's last segment. |

```bash
HYPPO_MCP_PORT=8080 HYPPO_MCP_TOKEN=s3cret npm start
```

## Precedence

- **Profile directory:** `HYPPO_USER_DATA_DIR` → `--instance <name>` → Electron's default.
- **MCP port:** `HYPPO_MCP_PORT` → `--port <n>` → the port in that profile's
  `settings.json` → built-in default (`7357`).
- **Token:** `HYPPO_MCP_TOKEN` → that profile's `settings.json` → none.

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
else; no page content is ever persisted. A named instance (`--instance <name>`)
writes the same set under `instances/<name>/`.

## Run more than one HyppoVisor

Run one HyppoVisor per parallel agent session — one Claude Code project per
client or persona — each on its **own MCP port** with its **own profile**
(separate logins, settings, recent URLs, interaction log). The instances share
no state and neither one's calls wait on the other's.

```bash
# dev — a second instance, no rebuild
npx electron . --instance work --port 7358

# packaged, macOS — -n forces a new process
open -na HyppoVisor --args --instance work --port 7358
```

- **Never point two instances at the same profile directory.** A second launch
  against a profile another instance already holds shows a dialog and exits
  without opening a window; an accidental plain re-launch just raises the window
  already running.
- Each instance's window title, connection-panel header, and MCP handshake carry
  its label (`HyppoVisor — work`, server name `hyppovisor-work`), so two windows
  and two client registrations never get confused.
- If the chosen port is already in use, the window still opens and the browser
  still works — the **Connection & MCP** panel shows a "port in use" error with
  the fix. HyppoVisor never silently picks a different port. Change it in the
  panel (persists for that instance) or relaunch with a different `--port`.
- The environment overrides above still work and still win — use them for CI,
  wrapper scripts, and stdio; `--instance` / `--port` are the everyday path.

For stdio, add `--instance` to the spawn command — see
[connect an agent](./connect-an-agent.md#stdio-alternative).
