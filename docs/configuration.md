# Configuration

## From the app (normal way)

Click the hippo button in the top bar to open the **Connection & MCP** panel.
Set the **Listening port** (Apply rebinds live) and toggle **Require a bearer
token** (generated, masked, regenerable). Both persist — see
[settings.json](#settingsjson).

## Launch flags

| Flag | Effect |
|---|---|
| `--instance <name>` | Run a **named instance**: its own profile directory (`<user-data>/instances/<name>/`) and a display label. `<name>` is 1–32 chars, lowercase letters / digits / `-` / `_`, first char alphanumeric (e.g. `work`, `client-2`). An out-of-form name aborts startup. A named instance's window **opens without taking focus** — it never interrupts what you are typing. |
| `--port <n>` | MCP HTTP port for this process (integer 1–65535). Omit it and the port resolves per the precedence below. Out-of-range aborts startup. |
| `--background` | Start with **no visible window** and without taking focus. The MCP server, tabs, navigation, page reads, form reads, and drafting all work exactly as a foreground instance's — an agent drives it the same way. The one exception is `screenshot`: a never-shown window has no rendered surface, so `screenshot` returns `SCREENSHOT_FAILED` until the instance is summoned. On macOS the instance shows **no Dock icon and no ⌘-Tab entry** while hidden; on Windows/Linux no taskbar button. Bare flag, no value. Never aborts startup. Composes with `--instance` / `--port` in any order. On a platform with no hidden-window state it degrades to a visible-but-inactive window (never focused). |

```bash
npx electron . --instance work --port 7358
npx electron . --instance work --port 7358 --background   # quiet: no window, no focus
```

See [Run more than one HyppoVisor](#run-more-than-one-hyppovisor) and
[Background instances](#background-instances).

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

For a multi-instance setup, add **`--background`** to each launch: no windows
appear, nothing steals focus, and every instance still serves its agent. Summon
one only when you need to sign in. See [Background instances](#background-instances).
To see every running instance and shut one down without hunting for its PID, use
the connection panel — see [Manage running instances](#manage-running-instances).

- **Re-launching a profile that is already running is the summon gesture.** The
  second process opens no window and exits quietly (a stderr line, no dialog);
  the running instance raises and un-hides its window. This is how you bring a
  `--background` instance to the front — see [Background instances](#background-instances).
  Two instances with genuinely different profiles never collide.
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

## Background instances

`--background` starts an instance with **no visible window** and without taking
focus. Its MCP server, tabs, navigation, page reads, form reads, and drafting
behave exactly as a foreground instance's — an agent drives it the same way.

**`screenshot` is the exception.** A window that has never been shown has no
rendered surface, so the `screenshot` tool returns `SCREENSHOT_FAILED` for a
`--background` instance. Every other tool is unaffected. Summon the window (below)
if you need a picture, or run that instance without `--background`.

```bash
# three quiet instances — no windows, no focus changes
npx electron . --instance work    --port 7358 --background
npx electron . --instance client  --port 7359 --background
npx electron . --instance triage  --port 7360 --background
```

- **macOS:** while hidden, the instance shows **no Dock icon and no ⌘-Tab
  entry**. Both reappear while its window is on screen and go away again when it
  returns to the background — it is not a permanent Dock resident.
- **Windows / Linux:** no taskbar button while hidden.
- A platform with no hidden-window concept degrades to a **visible-but-inactive**
  window — never focused, never raised — rather than failing to launch.

### Summon a background instance

Re-launch it with the same `--instance` identity. The running process brings its
window to the front and focuses it; a second window is never opened.

```bash
npx electron . --instance work                 # dev
open -na HyppoVisor --args --instance work      # packaged, macOS
```

Sign in, review a drafted form, switch tabs — an ordinary window. **Closing the
window returns the instance to the background** (its MCP server keeps running); it
does **not** quit. Summoning or dismissing one instance never affects another.

### Quit a background instance

- **Ctrl-C** in the terminal that launched it (also `SIGTERM`).
- **Cmd-Q** (macOS) / **Ctrl-Q** (Windows/Linux) from the standard application
  menu while the instance is summoned.

Quitting one instance leaves every other running instance untouched. `--background`
is a launch flag only — it persists nothing; a standing setup is your own shell
alias or per-project launch line.

## Manage running instances

The connection panel (the hippo button, top-right) has an **Instances** section
that lists every HyppoVisor this user is running on this machine — including
`--background` ones that have no window, Dock icon, or ⌘-Tab entry. Each row shows
the instance label (or `(default)`), its MCP port (or `stdio`), its mode
(foreground / background), and whether the port is currently responding. The row
for the instance you are looking at is tagged **this instance** and its close
control is disabled — you cannot shut down the window you are in by accident. The
list refreshes on its own about every 2 seconds
(`HYPPO_INSTANCE_POLL_MS`).

**Close** on any other row asks for a one-line confirmation naming the target and
its port, then shuts that instance down: a `SIGTERM` (its own handler turns that
into a clean quit — window closed, process ended, MCP port released), escalating
to `SIGKILL` if it has not exited within a grace window
(`HYPPO_INSTANCE_SHUTDOWN_GRACE_MS`, default 5000 ms). There is no undo. Any MCP
call in flight against that instance fails cleanly for its caller — the shutdown
does not wait for it. An instance that exits or crashes on its own (or is closed
from another instance's panel) drops off every list within a few seconds.

How discovery works: each instance writes a small `runtime.json` (`pid`, `port`,
`mode`, `label`, `startedAt`) into its **own** profile directory once its MCP
server has bound, and removes it on quit; the panel reads those sibling files,
drops any whose process is gone (reclaiming the stale file), and probes each live
port on loopback. There is no shared registry, no index, no daemon — just N
independent per-instance files. **Limitation:** an instance launched with
`HYPPO_USER_DATA_DIR` pointing outside the app-support `instances/` tree (test
harnesses, wrapper scripts) is not enumerable from other instances; its own panel
still lists it and shows a "can't list other instances" note if nothing else is
found.

| Env var | Default | Effect |
| --- | --- | --- |
| `HYPPO_INSTANCE_POLL_MS` | `2000` | How often the panel re-lists instances while open. |
| `HYPPO_INSTANCE_PROBE_TIMEOUT_MS` | `400` | Loopback connect deadline for the responding / not-responding check. |
| `HYPPO_INSTANCE_SHUTDOWN_GRACE_MS` | `5000` | `SIGTERM` → `SIGKILL` window when closing another instance. |

On Windows `SIGTERM` is an immediate terminate (no graceful hook), so the close is
abrupt there and the `SIGKILL` escalation is a no-op; macOS and Linux get the true
graceful-then-forced behaviour.

### Top-bar tab actions

Two icon buttons sit in the top bar, stacked between the address row and the
hippo button:

- **Reload the current tab** (circular arrow) — reloads the active tab's page in
  place. Same as a browser refresh; no navigation, nothing submitted.
- **Close all tabs** (crossed square) — tears down every open content tab and
  leaves the instance in the freshly-launched state (no tabs — HyppoVisor has no
  placeholder/home tab). The MCP server, `settings.json`, recent URLs, and every
  logged-in browser session are untouched; only the tabs close.

Both are disabled when no tab is open.
