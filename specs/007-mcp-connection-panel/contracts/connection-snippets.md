# Contract: Connection snippets, token masking, About text

External-facing text the panel presents for copy. Produced by pure functions in
`src/renderer/snippets.ts`; unit-tested in `tests/unit/connection-snippets.test.ts`.

`s` below is the panel's current `EffectiveConnection`. `url = http://127.0.0.1:${s.port}/mcp`.

## 1. Endpoint line

```
http://127.0.0.1:<port>/mcp
```

Shown only when `s.transport === "http"`. Copy button copies exactly that string.

## 2. `claude mcp add` command — `mcpAddCommand(s)`

No token:

```
claude mcp add --transport http --scope user hyppovisor http://127.0.0.1:7357/mcp
```

Token required — one argument appended, nothing else changes:

```
claude mcp add --transport http --scope user hyppovisor http://127.0.0.1:7357/mcp --header "Authorization: Bearer <token>"
```

- `--scope user` is always present; the panel shows one line: *"Adds it for every project
  under your user. Drop `--scope user` for the current project only."*
- Server name is always `hyppovisor`.
- The command MUST run unedited for the current settings (SC-006).

## 3. HTTP JSON config — `mcpJsonConfig(s)`

`JSON.stringify(obj, null, 2)` where `obj` is:

```json
{
  "mcpServers": {
    "hyppovisor": {
      "type": "http",
      "url": "http://127.0.0.1:7357/mcp"
    }
  }
}
```

Token required — add exactly one key:

```json
      "url": "http://127.0.0.1:7357/mcp",
      "headers": { "Authorization": "Bearer <token>" }
```

MUST be valid JSON as displayed (SC-006).

## 4. stdio JSON config — `stdioJsonConfig(launch)`

Shown only when `s.transport === "stdio"` (§11 of research / FR-008):

```json
{
  "mcpServers": {
    "hyppovisor": {
      "command": "<process.execPath>",
      "args": ["<abs path to dist/main/index.js>"],
      "env": { "HYPPO_MCP_STDIO": "1" }
    }
  }
}
```

Paths come from `stdioLaunch` in the `chrome:get-connection` reply — never hard-coded, never
guessed in the renderer.

## 5. Token masking

- Wherever the token would appear — the standalone token field **and** the `<token>` slots
  in §2 / §3 — the DOM shows a fixed mask run (`••••••••••••`), not the value.
- The real value is held out of the visible DOM (closure / `data-*`).
- **Reveal**: a control that swaps every masked occurrence in the panel to the real value
  for as long as the panel stays open; re-masked on panel close.
- **Copy**: always writes the real, unmasked text (endpoint / command / JSON / token) to the
  clipboard, regardless of reveal state (clarification Q2, FR-007a, FR-018).
- SC-005: on panel open, zero token characters are in the visible DOM until Reveal or Copy.

## 6. Copy feedback

Every copy control confirms visibly (e.g. label → "Copied" for ~1.5 s). If
`navigator.clipboard.writeText` rejects/throws, the block's text stays visible and
user-selectable (FR-009); the control shows "Copy failed — select and ⌘C".

## 7. About text — `ABOUT_TEXT`

A single multi-line string. Content requirements (all test-enforced):

- Names the app ("HyppoVisor").
- States it runs on the local machine and exposes an MCP server at the endpoint shown in the
  panel.
- Lists every tool in `TOOL_NAMES` (exported from `src/main/mcp/tools.ts`):
  `open_url`, `list_open_tabs`, `read_page`, `read_form_fields`, `navigate`, `interact`,
  `wait_for_selector`. (`interact` note: `click` / `fill` / `scroll` / `space` /
  `choose_option`.)
- States the guarantees: never submits forms, sends messages, applies, connects,
  authenticates, or presses Enter; every interaction is logged locally.

Prohibited content (test-enforced):

- No `Bearer`, no token value, no `Authorization`.
- No job-board name; no `HyppoGraph`, `orchestrator`, `queue`, `dashboard`, `pipeline`.

Copyable as one block (FR-024). The panel reads `ABOUT_TEXT` directly from `snippets.ts` —
it is the single source; it is **not** duplicated into the IPC payload.

### About section chrome (FR-024a) — around, not inside, `ABOUT_TEXT`

- **Mascot image**: `<img id="panel-mascot" src="./mascot.png" alt="HyppoVisor">`. Asset
  delivered later; `alt` text is the fallback until then; a missing file never errors.
- **Version**: `chrome:get-connection` → `appVersion` (from `app.getVersion()`, currently
  `0.1.0`).
- **License**: the fixed string `Apache-2.0`, linking to the repo `LICENSE` / `NOTICE`.
- The copied text (the Copy button) is `ABOUT_TEXT` only — never the version, license, or
  mascot alt text.

## 8. Consistency guard

`tests/unit/connection-snippets.test.ts`:

- For every `name` in `TOOL_NAMES`: `expect(ABOUT_TEXT).toContain(name)`.
- `ABOUT_TEXT` contains each of: `submit`, `send`, `apply`, `connect`, `authenticat`,
  `Enter`, `logged`.
- `ABOUT_TEXT` matches none of `/Bearer|Authorization|HyppoGraph|orchestrator|dashboard|queue|pipeline/i`.
- `mcpAddCommand` / `mcpJsonConfig` for `{tokenRequired:false}` contain no `Authorization`;
  for `{tokenRequired:true, token:"abc"}` contain `Bearer abc` and, for the JSON,
  `JSON.parse` succeeds and `obj.mcpServers.hyppovisor.headers.Authorization === "Bearer abc"`.
- `mcpJsonConfig` output `JSON.parse`s for every combination and has exactly one key under
  `mcpServers`.
