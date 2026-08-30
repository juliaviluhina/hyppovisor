# Phase 0 Research: MCP Connection Panel

No open `NEEDS CLARIFICATION`. Each decision below is `Decision / Rationale / Alternatives`.
Inputs: the spec + its four clarifications, the constitution (1.3.0), and the current code
(`src/main/index.ts`, `src/main/mcp/server.ts`, `src/main/config.ts`, `src/preload/chrome.cjs`,
`src/renderer/{index.html,app.ts}`, `tests/integration/helpers.ts`).

## R1 — Settings file shape and location

**Decision**: One file, `<app.getPath("userData")>/settings.json`, containing exactly
`{ "port": number, "tokenRequired": boolean, "token": string | null }`. Written pretty
(2-space) so it is hand-editable. `token` is `null` whenever `tokenRequired` is `false`.

**Rationale**: `userData` is already the home of `interaction-log.jsonl` (`InteractionLog`
uses the same path), so this adds no new location concept. Plain JSON is human-readable and
safe to delete (FR-030). One flat object is the whole configurable surface (FR-034 forbids
more auth; other limits stay env-only — Out of Scope).

**Alternatives**: `electron-store` dependency — rejected, a whole package for one 3-key file.
INI / dotenv format — rejected, JSON is already the project's data idiom. A file in the
shared data directory — rejected outright (FR-028, Principle II).

## R2 — Precedence resolver and source tracking

**Decision**: `resolveEffective(settings, env, settingsFileExisted)` →
`EffectiveConnection`. Order for each field: environment override → persisted setting →
built-in default (`port` 7357, no token). `portSource` ∈ `"env" | "persisted" | "default"`
(`"default"` only when no `settings.json` existed and no env var). `tokenSource` likewise.
`transport` is `"stdio"` when `HYPPO_MCP_STDIO === "1"`, else `"http"`.

**Rationale**: FR-029 mandates one precedence order everywhere. Exposing the *source* lets
the panel show a control read-only and labelled "set by environment" (FR-014/FR-021) without
the renderer re-deriving precedence.

**Alternatives**: Resolve in the renderer — rejected, duplicates the rule and needs the raw
env in the renderer. Silently let the panel overwrite an env-set value — rejected, the env
var must win and the write must be refused (FR-014).

## R3 — Corrupt / missing settings file

**Decision**: `loadSettings()` returns `DEFAULTS` (and reports `existed: false`) when the
file is absent, unreadable, not valid JSON, or fails a shape check (port not an integer in
1–65535; `tokenRequired` not boolean; `token` not string/null; `token` non-null while
`tokenRequired` false). A malformed file is left on disk untouched (not clobbered on read);
the next successful `saveSettings()` overwrites it. Startup never blocks on it.

**Rationale**: FR-030 — "a missing or unparseable file MUST fall back to defaults without
blocking startup." Not clobbering on read preserves a user's hand-edit mistake for them to
fix.

**Alternatives**: Throw / show a modal on corrupt file — rejected, blocks startup. Rewrite
the file with defaults on read — rejected, destroys a recoverable typo.

## R4 — Live port rebind

**Decision**: `HttpMcpHandle` gains `rebind(port: number): Promise<void>`. It creates a new
`http.Server` bound to the same `handle`, `listen(port, "127.0.0.1")`; on `listening` it
closes the previous server (`close()`, which lets in-flight responses finish) and swaps the
internal refs, updating `port` and `url`. On `error` (e.g. `EADDRINUSE`) it rejects and
leaves the old server serving. Callers (the IPC handler) treat a resolved promise as success
and a rejection as "keep the old port, show the message".

**Rationale**: FR-010 (apply without restart), FR-013 / SC-010 (a failed Apply never
disturbs the running listener). Binding the new socket *before* closing the old one
guarantees the failure path is side-effect-free.

**Alternatives**: `server.close()` then `listen()` on the same object — rejected, a bind
failure then leaves the app with no listener at all. Node has no in-place re-bind.

## R5 — Mutable per-request token

**Decision**: The handle holds `let authToken: string | null`. The request handler compares
`req.headers.authorization === \`Bearer ${authToken}\`` only when `authToken` is non-null,
exactly as today. `setToken(t)` assigns `authToken`. No rebind.

**Rationale**: A token change only affects a string comparison; the socket is unaffected
(Complexity Tracking). Matches the existing `HYPPO_MCP_TOKEN` behaviour (`server.ts:63`).

**Alternatives**: Recreate the server on token change — rejected, needless churn and dropped
connections.

## R6 — One-window overlay

**Decision**: The panel is a `position: fixed; inset: 0` overlay inside the existing
renderer document. On open, the renderer calls `hyppo.setPanelOpen(true)`; `index.ts` calls
`tabs.setChromeOverlay(true)`, which sets every tab `WebContentsView` to
`setVisible(false)`. On close, `setVisible(true)` restores them. `config.chromeHeight` and
tab bounds are unchanged.

**Rationale**: The tab `WebContentsView` is composited above the renderer's content area
below `chromeHeight` (`tab-manager.ts:172-177`), so an in-document overlay is otherwise
clipped to the ~104 px strip. Hiding the views reveals the full-size renderer underneath.
Principle III forbids a second window; a transient popup `BrowserWindow` would be one.

**Alternatives**: Child `BrowserWindow` popover — rejected (one-window rule). Grow
`chromeHeight` while open and shrink on close — rejected, more moving parts (tab bounds
recalculation, race with resize) than a visibility toggle. Render the panel *inside* a tab
view — rejected, it is app chrome, not web content.

## R7 — IPC channels

**Decision**: Five `ipcMain.handle` channels + one `webContents.send` event.

| Channel | Direction | Payload in | Payload out |
|---|---|---|---|
| `chrome:get-connection` | invoke | — | `EffectiveConnection` + `aboutText` + `stdioLaunch` |
| `chrome:set-port` | invoke | `number` | `{ ok: true, port } \| { ok: false, error }` |
| `chrome:set-token-required` | invoke | `boolean` | `{ ok: true } & EffectiveConnection \| { ok: false, error }` |
| `chrome:regenerate-token` | invoke | — | `{ ok: true } & EffectiveConnection \| { ok: false, error }` |
| `chrome:set-panel-open` | invoke | `boolean` | `void` |
| `connection:changed` | event → renderer | — | `EffectiveConnection` (+ `lastRequest`) |

`connection:changed` is sent once after `loadFile`, then on every applied port/token change
and on each last-request update. It replaces `mcp:ready`.

**Rationale**: FR-002 (panel shows effective state), FR-010/FR-016/FR-019 (three mutations),
FR-001 (panel open toggles tab-view visibility), FR-001a (status line updates live). Each
mutation has distinct validation and result, so distinct channels read better than one
dispatcher.

**Alternatives**: One `chrome:connection` channel with `{ action, arg }` — rejected, weaker
typing, a `switch` in the handler. Polling from the renderer instead of a push — rejected,
the status line and panel must reflect a change immediately.

## R8 — Snippet templates and `claude mcp add` scope

**Decision**: Pure functions in `src/renderer/snippets.ts`:

- `endpointUrl(port)` → `http://127.0.0.1:${port}/mcp`
- `mcpAddCommand(s)` → `claude mcp add --transport http --scope user hyppovisor <url>`
  and, when `s.tokenRequired`, ` --header "Authorization: Bearer <token>"` appended.
- `mcpJsonConfig(s)` → `{ "mcpServers": { "hyppovisor": { "type": "http", "url": <url>,
  ["headers": { "Authorization": "Bearer <token>" }] } } }`, `JSON.stringify(_, null, 2)`.
- `stdioJsonConfig(launch)` → `{ "mcpServers": { "hyppovisor": { "command": <execPath>,
  "args": [<mainEntry>], "env": { "HYPPO_MCP_STDIO": "1" } } } }`.

The command emits `--scope user` (available in every project for the user) and the panel
states that in one line; no scope selector (spec Out of Scope).

**Rationale**: FR-005/FR-006/FR-008. Pure string functions are trivially unit-tested for
every port/token combination (SC-006). `--scope user` fits an always-on app.

**Alternatives**: Build snippets in main — rejected, string formatting is renderer work; the
only main-side facts are `stdioLaunch` (exec path + entry), which is passed in
`chrome:get-connection`. A `<token>` placeholder in snippets — rejected by clarification Q2
(must be runnable as copied).

## R9 — Token masking that still yields runnable copy

**Decision**: The standalone token field and any snippet that contains the token render
with the token replaced by a mask glyph run (`••••••••`) in the DOM. The real value is held
in a data attribute / closure. A "Reveal" toggle swaps the displayed text to the real value;
"Copy" always writes the real, unmasked text to the clipboard. Revealing one block reveals
all token occurrences in the panel for that session-open; closing the panel re-masks.

**Rationale**: Clarification Q2 + FR-007a/FR-018 + SC-005 — nothing secret on screen until
an explicit reveal/copy, but a copied snippet must work with no edit.

**Alternatives**: Show the token only in the standalone field, `<token>` placeholder in
snippets — rejected by Q2. Never reveal, copy-only — rejected, FR-018 allows an explicit
reveal and users expect to eyeball it.

## R10 — Static About text and its consistency guard

**Decision**: `ABOUT_TEXT` is a multi-line string constant in `src/renderer/snippets.ts`.
`src/main/mcp/tools.ts` exports `TOOL_NAMES: readonly string[]` (the names it registers).
`tests/unit/connection-snippets.test.ts` asserts every `TOOL_NAMES` entry appears in
`ABOUT_TEXT`, that `ABOUT_TEXT` contains the never-does verbs (submit / send / apply /
connect / authenticate / Enter) and "logged", and that it contains no `Bearer`, no board
name, and no "HyppoGraph"/"orchestrator".

**Rationale**: FR-023/FR-024/FR-025. A source-level test is the smallest thing that makes
"kept consistent with the tool contract" real, matching the repo's doc-parity habit.

**Alternatives**: Generate the tool list into the text at runtime — rejected, the text is
prose with per-tool phrasing, not a bullet list; a presence check is enough. Keep the text
in `src/shared` — rejected, the renderer's isolated tsconfig cannot import it; passing it
over IPC from main is possible but adds a payload for a constant. Chosen: renderer-local
constant, test-guarded. (`chrome:get-connection` still carries it so the panel needs no
build-time coupling — the constant is the single source, the IPC copy is a convenience. Final
call: keep `ABOUT_TEXT` in `snippets.ts` and let the panel read it directly; drop it from the
IPC payload to avoid two sources.)

## R11 — stdio-mode presentation

**Decision**: When `transport === "stdio"`: the panel hides the endpoint line, the port
control, and the token control; shows "Running in stdio mode — no network endpoint"; and
renders only the stdio JSON snippet from `stdioLaunch` (`process.execPath` +
`app.getAppPath()`-derived main entry). All `chrome:set-*` handlers return
`{ ok: false, error: "stdio mode" }` defensively.

**Rationale**: FR-008. Transport is fixed at launch (Out of Scope: runtime switch), so the
panel is purely informational there.

**Alternatives**: Show disabled HTTP controls — rejected, misleading; there is no listener.

## R12 — Last-request indicator (P3)

**Decision**: The handle keeps `lastRequest: { at: number; tool: string | null; outcome:
"ok" | "rejected" } | null`, in memory only. `ToolDeps` gains
`onToolInvoked?: (name: string) => void`; each registered tool calls it first-thing, setting
`{ at: Date.now(), tool: name, outcome: "ok" }`. The 401 branch of the HTTP handler sets
`{ at: Date.now(), tool: null, outcome: "rejected" }`. `index.ts` pushes `connection:changed`
(throttled to ~1/s) with the current `lastRequest`. The panel renders "Last request: Ns ago
— <tool>" / "… — rejected" / "No requests yet".

**Rationale**: FR-026/FR-027. Single-in-flight (the `ActionQueue`) means "last tool invoked"
is unambiguous. Metadata only, never content, never persisted.

**Alternatives**: Parse the JSON-RPC body in the HTTP handler for the method name — rejected,
the transport consumes the stream; wrapping tool handlers is cleaner and already where the
name is known. Drop the feature — acceptable (it is P3 / MAY); implemented because the hook
is one optional callback.

## R13 — Test isolation and MCP under `HYPPO_E2E`

**Decision**: (a) `index.ts` reads `HYPPO_USER_DATA_DIR` before `app.whenReady()` and, when
set, calls `app.setPath("userData", dir)` — isolating `settings.json` and the interaction
log for tests. (b) The HTTP MCP server now starts in `HYPPO_E2E=1` runs too (today it is
skipped); the connection IPC handlers are registered before the `if (e2e) return`.
`helpers.ts` gains `launchAppFull(env)` that launches with a fresh temp `HYPPO_USER_DATA_DIR`
and without `HYPPO_E2E` for the panel spec, plus lets the existing `launchApp` pass
`HYPPO_USER_DATA_DIR` too.

**Rationale**: FR-011/FR-020 persistence and FR-010/FR-017 rebind/token need a real listener
and a deterministic settings file. `playwright.config.ts` is `workers: 1`,
`fullyParallel: false` — no port contention from starting MCP in e2e.

**Alternatives**: Mock the filesystem in e2e — not possible across the Playwright/Electron
boundary. Assert only via unit tests — misses the renderer↔main↔socket path the feature is.

## R14 — Constitution amendment wording (PATCH 1.3.0 → 1.3.1)

**Decision**: Add to Principle IV a single clause: *"The loopback MCP bearer token — an
app-to-local-client authorization secret for the MCP port, generated by the app and never
sent to or accepted from any website — is not a user credential under this principle; the
app may generate, store (locally, outside the shared data directory), display, and
regenerate it."* Add an Amendment History entry: **1.3.1 (2026-08-30)** — PATCH: pure
clarification, no principle redefined; the token mechanism already ships via
`HYPPO_MCP_TOKEN`. Bump the version header to 1.3.1 and "Last Amended".

**Rationale**: FR-032. The review gate ("a change that … handles credentials MUST be
rejected or escalated to a constitution amendment") will otherwise flag the stored token;
pre-empting it with a clarification is the pattern feature 003/006 used. PATCH, not MINOR,
because no capability is added — 006's MINOR expanded a *permitted-action list*; this only
disambiguates a term.

**Alternatives**: MINOR bump — rejected, nothing new is permitted. No amendment, rely on a
PR comment — rejected, the constitution is the review gate's source of truth and the file is
loaded every planning run.
