# Contract: Per-Instance Settings Copy

**Feature**: `028-copy-instance-settings` | **Date**: 2026-09-21

UI contract for the instance-list row copy actions (renderer surface, not MCP). Companions: `specs/007-mcp-connection-panel/contracts/connection-snippets.md` (block formats — reused verbatim), `specs/014-instance-management/contracts/` (list rows, liveness).

## Per-row copy actions

Each instance-list row offers the same copy actions the Connection & MCP panel offers locally: **copy command** and **copy JSON**. Output formats are byte-identical in structure to the panel's `mcpAddCommand` / `mcpJsonConfig` (HTTP rows) or the stdio launch command / `stdioJsonConfig` (stdio rows), parameterized per row:

| Input (row) | command block | JSON block |
|---|---|---|
| HTTP + auth | `claude mcp add --transport http --scope user <serverName> http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"` | `{ mcpServers: { <serverName>: { type: "http", url, headers: { Authorization } } } }` |
| HTTP, auth off | Same minus `--header`, plus a visible auth-off note | Same minus `headers`, plus the note |
| stdio | stdio launch command for that instance | `stdioJsonConfig` output keyed by that instance's server name |
| Unreachable | Last-known blocks, each carrying an unreachable marker | Same |
| Unavailable (unreadable files) | No copy action; settings-unavailable note | Same |

## Rules

- The current instance's own row produces blocks identical to its Connection & MCP panel (FR-007) — same builder functions, no parallel format code.
- Copying writes nothing: no settings rewrite, no focus change, no relaunch, no audit/log entries beyond the list view's own behavior (FR-006, SC-004).
- Blocks MUST connect verbatim (SC-001/SC-002) and MUST name the row's own server (never a sibling's).
- Env-override caveat (research.md R4): blocks assume non-overridden launches; a sibling under `HYPPO_MCP_TOKEN` override will 401 — fails closed, never misconnects.
