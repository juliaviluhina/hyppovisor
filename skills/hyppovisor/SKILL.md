---
name: hyppovisor
description: >-
  Drive HyppoVisor's MCP browser to read or draft on web pages the user is
  already signed into. Use when a task needs a logged-in page read, a form
  prepared, or rendered content checked. Covers launching the right per-project
  instance, registering the MCP endpoint with the correct parameters, and the
  read-only / never-submit rules.
metadata:
  source: https://github.com/juliaviluhina/hyppovisor
  install: copy this folder to .claude/skills/hyppovisor/ in the project that will use HyppoVisor
---

# HyppoVisor

HyppoVisor is a local Electron app plus an MCP server. It opens URLs in real
browser tabs that carry the **user's own logins** and exposes them as MCP tools:
`open_url`, `list_open_tabs`, `navigate`, `read_page`, `read_form_fields`,
`interact`, `wait_for_selector`, `screenshot`.

You use it to read pages behind a login and to prepare drafts. You never complete
an external action.

## Non-negotiable rules

- **Never** submit a form, press Enter, send a message, apply, connect, or
  authenticate. The user performs every external act.
- **Never** sign in. If a page shows a login wall, stop and ask the user to log
  in inside the HyppoVisor window, then continue.
- `interact` is preparation only: `fill` a plain field, `space` a plain checkbox,
  `choose_option` in a plain `<select>` / combobox, `click` **only** to reveal
  more content (pagination, "show more", "Add another"). Submit, consent, and
  credential controls are refused by the app — don't work around a refusal.
- One action is in flight at a time across all tabs; treat calls as serial.
- Read payloads are verbatim — don't ask HyppoVisor to summarise; summarise
  yourself after.

## Before using it — check the connection

Call `list_open_tabs`. If the tool is unavailable or errors, HyppoVisor is not
registered or not running — walk the user through **Setup** below, then retry.

## Setup

The user runs these; you supply the exact commands.

### 1. Launch a per-project instance

Choose a **short project slug** (`[a-z0-9][a-z0-9_-]*`, ≤ 32 chars) and a
**dedicated port** so parallel projects never collide — `7357` for the first,
`7358` for the next, and so on. The user runs one of:

```bash
# from a HyppoVisor checkout (dev)
npx electron . --instance <slug> --port <port>

# packaged app, macOS  (-n forces a new process)
open -na HyppoVisor --args --instance <slug> --port <port>
```

The window title reads `HyppoVisor — <slug>`. If the port is already in use, the
app's **Connection & MCP** panel shows a "port in use" error — the user frees the
port or relaunches with a different `--port`. HyppoVisor never silently picks
another port.

Omitting `--port` is fine: it reuses that instance's last port, else `7357`.

### 2. Register the MCP endpoint (once per project)

```bash
claude mcp add --transport http --scope local \
  hyppovisor-<slug> http://127.0.0.1:<port>/mcp
```

- `--scope local` keeps it to this project. Drop it (or use `--scope user`) to
  share across projects.
- If the panel's **Bearer token** is on, append
  `--header "Authorization: Bearer <token>"`.
- The panel (hippo button, top bar) shows this command pre-filled with the live
  port, server name, and token. Tell the user to **copy it verbatim** rather than
  hand-type — the server name there is already `hyppovisor-<slug>`.

Claude Desktop / other clients: use the panel's **JSON config** block instead —
same `hyppovisor-<slug>` key, same URL and optional `Authorization` header.

### 3. Confirm you reached the right instance

The MCP `initialize` handshake reports `serverInfo.name` as `hyppovisor-<slug>`.
If it doesn't match the project you expect, you're talking to a different
instance — check the port.

## Working flow

1. `open_url` the target page (or `navigate` an existing tab from `list_open_tabs`).
2. If a login wall appears → stop, ask the user to sign in, wait, retry.
3. `read_page` for visible text; `read_form_fields` for a structured control map
   with per-field `fill` / `click` verdicts and selectors.
4. `interact` to fill fields, tick plain checkboxes, choose options, or click to
   reveal sections. `wait_for_selector` when content loads async.
5. `screenshot` to verify what actually rendered.
6. Hand back to the user for anything that submits, sends, or signs in.

## Parallel sessions

Run one HyppoVisor per project or persona — each its own `--instance` / `--port`
/ profile (separate logins, settings, recent URLs, interaction log). They don't
interfere: a form-fill in one instance never blocks a read in another. Register
each with its own `hyppovisor-<slug>` name so the client entries don't clobber
each other.
