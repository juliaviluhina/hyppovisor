# Quickstart / Validation: MCP Connection Panel

Runnable checks that prove the feature. Implementation detail lives in `tasks.md`; this is
the run guide. Maps every SC and user story to a check.

Prerequisite: `npm run build`.

- Unit: `npm test` (`vitest`) — `tests/unit/settings.test.ts`,
  `tests/unit/connection-snippets.test.ts`.
- Integration: `npm run test:e2e` (`@playwright/test` `_electron`) —
  `tests/integration/connection-panel.spec.ts`, launched with a fresh temp
  `HYPPO_USER_DATA_DIR` and no `HYPPO_E2E`.

---

## §1 — Unit (settings + snippets)

**settings.test.ts**

1. `loadSettings()` on an empty temp dir → `DEFAULTS`, `existed === false`.
2. `saveSettings({port:8080,tokenRequired:true,token:"a".repeat(32)})` then `loadSettings()`
   → deep-equals; `existed === true`.
3. Corrupt file (`"{ not json"`) → `DEFAULTS`, `existed === false`, file left byte-identical.
4. Schema violations each → `DEFAULTS`: `port: 0`, `port: 70000`, `port: 3.5`,
   `tokenRequired: "yes"`, `{tokenRequired:false, token:"x…"}`, `{tokenRequired:true, token:null}`.
5. `resolveEffective`:
   - no env, file existed `{port:9000,...}` → `port:9000`, `portSource:"persisted"`.
   - no env, no file → `port:7357`, `portSource:"default"`.
   - `env.port:5555` over file `{port:9000}` → `port:5555`, `portSource:"env"`.
   - `env.token:"tok"` over file `{tokenRequired:false}` → `tokenRequired:true`,
     `token:"tok"`, `tokenSource:"env"`.
   - `env.stdio:true` → `transport:"stdio"`, `endpointUrl:""`.

**connection-snippets.test.ts** — see [contracts/connection-snippets.md](./contracts/connection-snippets.md) §8.
Covers SC-006 (command runs / JSON parses for every combination) and the `ABOUT_TEXT`
invariants (SC-009 in part).

---

## §2 — US1: see and copy (P1)

Launch the app fresh (temp `HYPPO_USER_DATA_DIR`, no env overrides).

1. Bottom-edge status line reads `MCP  http://127.0.0.1:7357/mcp` (no token indicator).
2. Click it → the connection panel opens as a full-window overlay; the page area is covered.
3. Panel shows: endpoint `http://127.0.0.1:7357/mcp`; a `claude mcp add --transport http
   --scope user hyppovisor http://127.0.0.1:7357/mcp` command; a JSON block that
   `JSON.parse`s to a single `hyppovisor` entry with that `url` and no `headers`.
4. Click each copy control → clipboard equals the displayed text; control shows "Copied".
5. Press `Esc` → panel closes, tab view visible again, page intact. Re-open, click outside
   the panel card → closes.  → **SC-001** (a fresh agent connects using only copied text).

---

## §3 — US2: set the port (P1)

Panel open, default port.

1. Enter `8080`, click **Apply**.
   - Within a few seconds: an HTTP POST to `http://127.0.0.1:8080/mcp` (valid MCP
     `initialize`) succeeds; a POST to `:7357/mcp` fails to connect. → **SC-002**
   - Endpoint line, command, and JSON all now show `8080`.
   - An inline notice names port `8080` and says to reconnect agents.  → clarification Q4
2. Quit and relaunch (same `HYPPO_USER_DATA_DIR`, still no env) → app listens on `8080`;
   `settings.json` contains `"port": 8080`. → **SC-003**
3. Enter `99999` → Apply → `{ ok:false }`, message about the 1–65535 range; server still on
   `8080` (POST to `:8080/mcp` still works). → **SC-010**
4. Start a second listener on some free port P from the test, then in the panel enter P →
   Apply → `{ ok:false, error: /in use/ }`; server still on `8080`. → **SC-010**
5. Relaunch with `HYPPO_MCP_PORT=7000` → panel port field shows `7000`, is read-only, is
   labelled "set by the environment"; `set-port` returns `{ ok:false }`. → **SC-007**

---

## §4 — US3: require a token (P2)

Panel open, no env token, port `8080` from §3 (or default).

1. Toggle **Require token** on.
   - A token appears, masked (`••••…`); no token characters are in the visible DOM. → **SC-005**
   - Command and JSON snippets now include `--header "Authorization: Bearer …"` /
     `"headers": { "Authorization": "Bearer …" }`, also masked.
   - MCP POST with no `Authorization` header → `401`; with `Authorization: Bearer <token>`
     → success. → **SC-004**
2. Click **Reveal** → the real 32-hex token shows in the field and in both snippets.
   Click **Copy** on the command while masked → clipboard has the real `Bearer <token>`
   string. → **SC-006**, clarification Q2
3. Click **Regenerate** → new token; old token now `401`s, new one succeeds; a notice says
   connected clients must reconnect.
4. Toggle **Require token** off → MCP POST with no header succeeds again;
   `settings.json` shows `"tokenRequired": false, "token": null` (token discarded, not
   hidden).
5. Relaunch with `HYPPO_MCP_TOKEN=envtok` → token controls hidden/disabled, state shown as
   environment-controlled; snippets carry `Bearer envtok`; `set-token-required` /
   `regenerate-token` return `{ ok:false }`. → **SC-007**

---

## §5 — US4: understand what this is (P2)

1. Panel shows a description block that contains "HyppoVisor", every tool name
   (`open_url`, `list_open_tabs`, `read_page`, `read_form_fields`, `navigate`, `interact`,
   `wait_for_selector`), and the never-does guarantees.
2. Copy control → clipboard equals the block text; it does **not** contain the version
   number or "Apache-2.0" (FR-024a).
3. Block text matches none of `/Bearer|HyppoGraph|orchestrator|dashboard|queue|pipeline/i`
   and contains no board name. → **SC-009** (with §3.3 / §7)
4. The section also shows `Version <appVersion> · Apache-2.0` (matching
   `hyppo.getConnection().appVersion`) and a `#panel-mascot` element with `alt="HyppoVisor"`
   — no error when `mascot.png` is not yet bundled (FR-024a).

---

## §6 — US5: last request (P3)

1. Panel open, no client has called → line reads "No requests yet".
2. From the test, issue one MCP `initialize` + `tools/list` → within ~1 s the line shows
   "Last request: Ns ago — tools/list" (or the tool name for a `tools/call`); no arguments
   or results shown.
3. With a token required, POST without the header → line shows a rejected request, distinct
   from a successful call. → **FR-027**

---

## §7 — Status line + stdio mode

1. **Status line** (FR-001a): after §3's port change and §4's token toggle, the bottom line
   reflects the new port and shows a token indicator; clicking it opens the panel; it
   contains no board/orchestrator text.
2. **stdio mode**: relaunch with `HYPPO_MCP_STDIO=1`. Panel shows "Running in stdio mode —
   no network endpoint", no port field, no token controls, and a stdio JSON snippet whose
   `command` is the Electron binary path and `args[0]` ends `dist/main/index.js`. → **SC-008**

---

## §8 — Docs, constitution, full gate

- **README** (FR-031): the connection section presents the in-app panel as the primary way
  to view the endpoint / set the port / enable a token; `HYPPO_MCP_PORT` /
  `HYPPO_MCP_TOKEN` / `HYPPO_MCP_STDIO` are documented as the override for headless/scripted
  launches.
- **Constitution** (FR-032): Principle IV has the one-line loopback-token clause; Amendment
  History has the `1.3.1 (2026-08-30)` PATCH entry; the version header reads
  `1.3.1` / `Last Amended: 2026-08-30`.
- **Doc parity**: `specs/001-open-any-url/contracts/mcp-tools.md` notes that port and token
  are now runtime-configurable from the panel (env vars remain the override).
- `npm run lint` and `npm test` and `npm run test:e2e` all green.
- MCP surface unchanged: `tools/list` returns the same tool set as `main` (FR-033).

## SC coverage map

| SC | Checked in |
|---|---|
| SC-001 | §2 |
| SC-002 | §3.1 |
| SC-003 | §3.2 |
| SC-004 | §4.1 |
| SC-005 | §4.1 |
| SC-006 | §1 (snippets), §4.2 |
| SC-007 | §3.5, §4.5 |
| SC-008 | §7.2 |
| SC-009 | §5, §7.1 |
| SC-010 | §3.3, §3.4 |
