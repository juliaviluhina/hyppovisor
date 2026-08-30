---

description: "Task list for feature 007 — MCP Connection Panel"
---

# Tasks: MCP Connection Panel

**Input**: Design documents from `specs/007-mcp-connection-panel/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/{ipc-connection,connection-snippets,settings-file}.md, quickstart.md

**Tests**: Included — the spec defines an Independent Test per story and SC-001…SC-010, and
quickstart.md §1–§8 are unit + integration suites. Same convention as features 004 / 005 / 006.

**Branch**: `007-connection-panel` · **Feature dir**: `specs/007-mcp-connection-panel`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: may run in parallel — different file, no dependency on an incomplete task
- **[Story]**: US1 / US2 / US3 / US4 / US5 (Setup, Foundational, Polish carry no story label)
- Every task names an exact file path

## Serial spines (no `[P]` between tasks that touch the same file)

- `src/main/index.ts` — T012 → T013 → T021 → T025 → T034
- `src/main/mcp/server.ts` — T006 → T033
- `src/main/mcp/tools.ts` — T007 → T032
- `src/renderer/panel.ts` — T015 → T018 → T022 → T026 → T029 → T035 → T038
- `src/renderer/snippets.ts` — T008 only
- `src/renderer/index.html` — T014 only
- `src/renderer/app.ts` — T016 only
- `src/main/settings.ts` — T004 only
- `src/main/tabs/tab-manager.ts` — T010 only
- `src/preload/chrome.cjs` — T011 only
- `tests/integration/connection-panel.spec.ts` — T019 → T023 → T027 → T030 → T036 → T039
- `tests/integration/helpers.ts` — T002 only

---

## Phase 1: Setup

**Purpose**: shared constants and the e2e launch/HTTP helpers every later phase needs.

- [X] T001 [P] `src/main/config.ts`: add and export `defaultMcpPort = 7357` and `mcpHost = "127.0.0.1"` constants beside `chromeHeight`, with a one-line comment. Do not change `chromeHeight` or the `numFromEnv` helpers.
- [X] T002 [P] `tests/integration/helpers.ts`: add `launchAppFull(extraEnv?: Record<string,string>)` — `mkdtemp` a temp dir, `electron.launch({ args: [mainEntry], env: { ...process.env, HYPPO_USER_DATA_DIR: tmp, ...extraEnv } })` **without** `HYPPO_E2E`, wait for `app.firstWindow()`, return `{ app, userDataDir: tmp, close() }` (close = `app.close()` + `rm -rf tmp`). Also add `mcpPost(port: number, body: unknown, headers?: Record<string,string>): Promise<{ status: number; json: unknown }>` doing an HTTP POST to `http://127.0.0.1:${port}/mcp` with `content-type: application/json` + `accept: application/json, text/event-stream`. Keep the existing `launchApp` unchanged (it already forwards `extraEnv`).

---

## Phase 2: Foundational (blocks every user story)

**Purpose**: shared types, the settings module, the extended HTTP handle, the pure snippet
module + its unit tests, the one-window overlay hook, the full preload surface, and the
main-process wiring that makes the panel open and show the effective connection state.

- [X] T003 [P] `src/shared/types.ts`: add the connection types from data-model.md §1–§5 — `type ConnectionTransport = "http" | "stdio"`; `type ConnectionSource = "env" | "persisted" | "default"`; `interface ConnectionSettings { port: number; tokenRequired: boolean; token: string | null }`; `interface EffectiveConnection { transport; port; endpointUrl; tokenRequired; token: string | null; portSource: ConnectionSource; tokenSource: ConnectionSource; lastRequest: LastRequestInfo | null }`; `interface LastRequestInfo { at: number; tool: string | null; outcome: "ok" | "rejected" }`; `interface StdioLaunch { command: string; args: string[]; env: { HYPPO_MCP_STDIO: "1" } }`. No change to existing types.
- [X] T004 [P] Create `src/main/settings.ts` (fs only, no Electron import — takes `userDataDir` as an arg): `DEFAULTS: ConnectionSettings = { port: 7357, tokenRequired: false, token: null }`; `SETTINGS_FILENAME = "settings.json"`; `loadSettings(userDataDir): { settings: ConnectionSettings; existed: boolean }` — read `<dir>/settings.json`, `JSON.parse`, validate per contracts/settings-file.md (`port` integer 1–65535; `tokenRequired` boolean; `token` 32-hex-string when required, `null` when not; nothing else asserted); any failure → `{ settings: DEFAULTS, existed: false }`, never throws, never rewrites the file; `saveSettings(userDataDir, settings)` — `JSON.stringify(settings, null, 2) + "\n"`, temp-write + `renameSync`; `readEnvOverrides(): { port?: number; token?: string | null; stdio: boolean }` — `Number(HYPPO_MCP_PORT)` range-checked, `HYPPO_MCP_TOKEN?.trim() || undefined`, `HYPPO_MCP_STDIO === "1"`; `resolveEffective(settings, env, existed): EffectiveConnection` (minus `lastRequest`, caller fills) per data-model.md §3 precedence table, `endpointUrl = env.stdio ? "" : \`http://${mcpHost}:${port}/mcp\``.
- [X] T005 [P] Create `tests/unit/settings.test.ts` (vitest, uses `mkdtemp`): empty dir → `DEFAULTS` + `existed:false`; round-trip save→load deep-equals + `existed:true`; corrupt file (`"{ not json"`) → `DEFAULTS` + `existed:false` + file bytes unchanged; each schema violation → `DEFAULTS` (`port:0`, `port:70000`, `port:3.5`, `tokenRequired:"yes"`, `{tokenRequired:false,token:"x".repeat(32)}`, `{tokenRequired:true,token:null}`); `resolveEffective` matrix from quickstart.md §1.5 (persisted vs default vs env for port and token; `env.stdio` → `transport:"stdio"`, `endpointUrl:""`).
- [X] T006 `src/main/mcp/server.ts`: extend `HttpMcpHandle` to `{ url: string; port: number; requiresToken: boolean; rebind(port: number): Promise<void>; setToken(token: string | null): void; lastRequest(): LastRequestInfo | null; close(): void }`. Refactor `startHttpMcpServer` to hold mutable `let server`, `let currentPort`, `let authToken`, `let last: LastRequestInfo | null = null`; the request `handle` reads `authToken` live, and its 401 branch sets `last = { at: Date.now(), tool: null, outcome: "rejected" }`; `rebind(port)` = create a **new** `http.Server` on the same `handle`, `listen(port, mcpHost)`, on `listening` → `server.close()` (old) + swap refs + recompute `url`/`currentPort`, on `error` → reject leaving the old server serving; `setToken(t)` = `authToken = t`; `lastRequest()` = `last`; `close()` closes whichever server is current. Keep `generateToken()`. Update the file header comment to mention runtime rebind + mutable token. (Do NOT add `onToolInvoked` yet — that is T033.)
- [X] T007 [P] `src/main/mcp/tools.ts`: add `export const TOOL_NAMES = ["open_url", "list_open_tabs", "read_page", "read_form_fields", "navigate", "interact", "wait_for_selector"] as const;` (verify against the actual `server.registerTool` / `server.tool` calls in this file). No behaviour change.
- [X] T008 [P] Create `src/renderer/snippets.ts` (pure — no DOM, no Electron import): `endpointUrl(port: number)` → `http://127.0.0.1:${port}/mcp`; `mcpAddCommand(s: { port; tokenRequired; token })` per contracts/connection-snippets.md §2 (`--transport http --scope user hyppovisor <url>`, append `--header "Authorization: Bearer <token>"` iff `tokenRequired`); `mcpJsonConfig(s)` → object then `JSON.stringify(_, null, 2)` per §3 (add `headers` iff `tokenRequired`); `stdioJsonConfig(launch: StdioLaunch)` per §4; `ABOUT_TEXT` — a multi-line const meeting §7 (names "HyppoVisor"; says local machine + MCP server at the panel's endpoint; lists every `TOOL_NAMES` entry with the `interact` sub-ops; states never submits / sends / applies / connects / authenticates / presses Enter and "every interaction is logged locally"; contains no `Bearer`/`Authorization`, no board name, no `HyppoGraph`/`orchestrator`/`dashboard`/`queue`/`pipeline`).
- [X] T009 [P] Create `tests/unit/connection-snippets.test.ts` (vitest) per contracts/connection-snippets.md §8: import `TOOL_NAMES` from `src/main/mcp/tools.ts` and the functions + `ABOUT_TEXT` from `src/renderer/snippets.ts`; assert every tool name ∈ `ABOUT_TEXT`; `ABOUT_TEXT` contains `submit`/`send`/`apply`/`connect`/`authenticat`/`Enter`/`logged` and matches none of `/Bearer|Authorization|HyppoGraph|orchestrator|dashboard|queue|pipeline/i` and no board name; `mcpAddCommand`/`mcpJsonConfig` with `tokenRequired:false` contain no `Authorization`; with `{tokenRequired:true, token:"abc123…"}` contain `Bearer abc123…`; `JSON.parse(mcpJsonConfig(s))` succeeds for every combination, has exactly one key under `mcpServers`, and `headers.Authorization === "Bearer <token>"` only when required.
- [X] T010 `src/main/tabs/tab-manager.ts`: add `setChromeOverlay(on: boolean)` — set `view.setVisible(!on)` on every managed tab `WebContentsView`, and set an instance `#overlay` flag so `layout()` / the `onChange` path do not re-show views while `on` is true (they resume normally once `setChromeOverlay(false)` is called). Do not change `chromeHeight`, tab bounds math, or `open`/`close`/`setActive`.
- [X] T011 `src/preload/chrome.cjs`: add to the `window.hyppo` bridge — `getConnection: () => ipcRenderer.invoke("chrome:get-connection")`, `setPort: (p) => ipcRenderer.invoke("chrome:set-port", p)`, `setTokenRequired: (b) => ipcRenderer.invoke("chrome:set-token-required", b)`, `regenerateToken: () => ipcRenderer.invoke("chrome:regenerate-token")`, `setPanelOpen: (o) => ipcRenderer.invoke("chrome:set-panel-open", o)`, `onConnectionChanged: (cb) => ipcRenderer.on("connection:changed", (_e, c) => cb(c))`; remove `onMcpReady`.
- [X] T012 `src/main/index.ts` — startup + MCP: before `app.whenReady()`, if `process.env.HYPPO_USER_DATA_DIR` is set call `app.setPath("userData", process.env.HYPPO_USER_DATA_DIR)`. After `log`/`tabs` are created: `const { settings, existed } = loadSettings(app.getPath("userData"))`; `let curSettings = settings`; `const env = readEnvOverrides()`; keep an outer `let httpHandle: HttpMcpHandle | undefined`. Replace the MCP-start block so it runs for BOTH the e2e and normal paths (move it above `if (e2e) return`, keep the `__hyppo` handle where it is): `if (env.stdio) startStdioMcpServer(deps)` else `httpHandle = await startHttpMcpServer(deps, { port: resolveEffective(curSettings, env, existed).port, token: resolveEffective(curSettings, env, existed).token })`. Delete the old `send("mcp:ready", …)`. Import `loadSettings`, `saveSettings`, `readEnvOverrides`, `resolveEffective`, `generateToken`.
- [X] T013 `src/main/index.ts` — read-only IPC + status push: add `const currentEffective = () => ({ ...resolveEffective(curSettings, env, existed), lastRequest: httpHandle?.lastRequest() ?? null })`; `const computeStdioLaunch = () => ({ command: process.execPath, args: [join(here, "index.js")], env: { HYPPO_MCP_STDIO: "1" } })` (the built main entry — same path `dist/main/index.js` resolves to at runtime); `const pushConnection = () => send("connection:changed", currentEffective())`. Register (before `if (e2e) return`): `ipcMain.handle("chrome:get-connection", () => ({ ...currentEffective(), stdioLaunch: computeStdioLaunch(), appVersion: app.getVersion(), license: "Apache-2.0" }))` and `ipcMain.handle("chrome:set-panel-open", (_e, open) => { tabs.setChromeOverlay(!!open); })`. After `win.loadFile(...)`, call `pushConnection()` once.
- [X] T014 `src/renderer/index.html`: in `#bar`, after `#activity`, add `<button id="hyppo" title="Connection & MCP">🦛</button>`. Give `#mcp` `role="button"`, `tabindex="0"`, `cursor: pointer`. Add `<div id="panel" hidden><div id="panel-backdrop"></div><div id="panel-card">…section placeholders…</div></div>` after `#mcp`. Add CSS: `#panel{position:fixed;inset:0;z-index:10;display:flex;…}`, `#panel-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.35)}`, `#panel-card{position:relative;margin:auto;max-width:640px;max-height:90vh;overflow:auto;padding:16px;border-radius:10px;background:Canvas;…}`, plus classes `.section`, `.snippet`(pre, monospace, overflow-x:auto), `.masked`, `.notice`, `.copy-btn`/`.copy-btn.ok`/`.copy-btn.fail`, `#hyppo`. No change to `body{height:104px}` (the panel is `position:fixed`).
- [X] T015 `src/renderer/panel.ts`: create `mountConnectionPanel()` — redeclare `EffectiveConnection`, `StdioLaunch`, `LastRequestInfo`, and a `HyppoConnectionApi` interface (mirroring `app.ts`'s `TabSummary`/`HyppoApi` pattern); resolve `#panel`, `#panel-backdrop`, `#panel-card`, `#hyppo`, `#mcp`. `open()` = `await hyppo.setPanelOpen(true)` → unhide `#panel` → `render(await hyppo.getConnection())`; `close()` = hide `#panel` → `hyppo.setPanelOpen(false)` → clear any revealed-token state. Wire: `#hyppo` click and `#mcp` click/`keydown Enter` → `open()`; `keydown Escape` (document) and `#panel-backdrop` click → `close()`. `hyppo.onConnectionChanged(c => { updateStatusLine(c); if (!#panel.hidden) render(c); })`. `updateStatusLine(c)` sets `#mcp` text to `MCP  ${c.endpointUrl}` (+ `  ·  token` when `c.tokenRequired`) or `MCP  stdio mode` when `c.transport === "stdio"`. `render(c)` skeleton: build the card from sections — HTTP branch renders an endpoint row + a container for command/JSON (filled in T018); stdio branch renders the "stdio mode" message (filled in T038); always append the About section (filled in T029). Call `mountConnectionPanel()` from `app.ts` (T016).
- [X] T016 `src/renderer/app.ts`: `import { mountConnectionPanel } from "./panel.js";` and call it once at startup. Remove the `hyppo.onMcpReady(...)` block (the `#mcp` line is now owned by `panel.ts`). Leave tabs/activity/blocked-action handling untouched.
- [X] T017 Regression checkpoint: `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e` all green. Launch: clicking 🦛 or the bottom MCP line opens a full-window overlay showing the current endpoint; Esc / backdrop click closes it; the active tab's web view hides while the panel is open and reappears on close; `tools/list` over HTTP returns the same tools as before. `settings.json` is created only after a later mutating action (none yet), so none exists.

**Checkpoint**: the panel opens, shows effective state, and closes cleanly. Stories proceed.

---

## Phase 3: User Story 1 — see and copy the connection details (Priority: P1) 🎯 MVP

**Goal**: the open panel shows the endpoint, a `claude mcp add` command, and a JSON
`mcpServers` block, each copyable and valid to paste as-is.

**Independent Test**: on a fresh app, open the panel → endpoint `http://127.0.0.1:7357/mcp`,
a `claude mcp add --transport http --scope user hyppovisor <url>` command, and a JSON block
that `JSON.parse`s to one `hyppovisor` entry with that url and no `headers`; each Copy places
exactly the shown text on the clipboard; Esc and outside-click both close the panel.

- [X] T018 [US1] `src/renderer/panel.ts`: implement the HTTP branch of `render(c)` — an endpoint row (`snippets.endpointUrl(c.port)`), a command row (`snippets.mcpAddCommand(c)`), and a JSON `<pre class="snippet">` (`snippets.mcpJsonConfig(c)`), each with a `.copy-btn` that calls `navigator.clipboard.writeText(realText)` → on resolve set `.ok` + label "Copied" for ~1.5 s; on reject set `.fail` + label "Copy failed — select and ⌘C" and leave the text user-selectable (FR-009). Re-render on every `connection:changed`.
- [X] T019 [US1] Create `tests/integration/connection-panel.spec.ts` (quickstart §2): `launchAppFull()`; assert the status line shows the default endpoint; click it → overlay visible; endpoint / command / JSON text correct; `JSON.parse` of the JSON block → one `mcpServers.hyppovisor` with that `url` and no `headers`; clicking each Copy makes `navigator.clipboard.readText()` (read in the renderer via `page.evaluate`) equal the shown text; press `Escape` → hidden; re-open, click `#panel-backdrop` → hidden. (SC-001.)
- [X] T020 [US1] Checkpoint: `tests/integration/connection-panel.spec.ts` §2 green; `npm run lint` + `npm test` green. **US1 is a shippable MVP: view + copy the connection details.**

---

## Phase 4: User Story 2 — set the listening port (Priority: P1)

**Goal**: change the HTTP port from the panel, applied live (no restart), persisted, with an
inline notice; a bad or in-use port never disturbs the running listener; an env-set port is
read-only.

**Independent Test**: open the panel, enter a free port, Apply → an MCP client reaches the
new port and not the old; snippets update; an inline notice names the new port; relaunch
(same user-data dir, no env) → still on the new port and `settings.json` holds it; an
invalid or in-use port is rejected with the server unchanged; with `HYPPO_MCP_PORT` set the
field is read-only.

- [X] T021 [US2] `src/main/index.ts`: register `ipcMain.handle("chrome:set-port", async (_e, port) => …)` per contracts/ipc-connection.md — guards in order: `env.stdio` → `{ ok:false, error:"stdio mode has no network port" }`; `resolveEffective(...).portSource === "env"` → `{ ok:false, error:"port is set by the HYPPO_MCP_PORT environment variable" }`; not `Number.isInteger` or out of `1..65535` → `{ ok:false, error:"port must be an integer between 1 and 65535" }`; `port === httpHandle.port` → `{ ok:true, port }`; else `try { await httpHandle.rebind(port); curSettings = { ...curSettings, port }; saveSettings(app.getPath("userData"), curSettings); existed = true; pushConnection(); return { ok:true, port }; } catch (e) { return { ok:false, error: /EADDRINUSE|in use/.test(String(e)) ? \`port ${port} is already in use\` : String((e as Error).message) }; }`. Registered before `if (e2e) return`.
- [X] T022 [US2] `src/renderer/panel.ts`: add a Port section to `render(c)` (HTTP branch) — a `type="number"` input pre-filled with `c.port`, an **Apply** button, and a `.notice` slot. If `c.portSource === "env"` → input `disabled`, show "set by the HYPPO_MCP_PORT environment variable". On Apply: `const r = await hyppo.setPort(Number(input.value))`; `r.ok` → notice "Now listening on port {r.port} — reconnect any agents" (snippets refresh via the `connection:changed` push); `!r.ok` → notice `r.error` (non-blocking, field keeps its value). When the entered value `< 1024`, show a "ports below 1024 may need elevated privileges" hint next to Apply.
- [X] T023 [US2] `tests/integration/connection-panel.spec.ts` (quickstart §3): Apply `8080` → `mcpPost(8080, initialize)` status 200, `mcpPost(7357, …)` rejects/refuses; endpoint + command + JSON now show `8080`; inline notice present. Close app, relaunch with the same `userDataDir` (no env) → `mcpPost(8080, initialize)` 200 and `JSON.parse(readFileSync(<dir>/settings.json))` has `port: 8080`. Apply `99999` → `{ ok:false }` + message about the range + `mcpPost(8080, …)` still 200. Bind a sacrificial `http` server on a free port P, Apply P → `{ ok:false, /in use/ }` + still serving on 8080. Relaunch with `HYPPO_MCP_PORT=7000` → port field `disabled`, `hyppo.setPort(...)` → `{ ok:false }`. (SC-002 / SC-003 / SC-007 / SC-010.)
- [X] T024 [US2] Checkpoint: `connection-panel.spec.ts` §2–§3 green; lint + unit green.

---

## Phase 5: User Story 3 — optionally require a bearer token (Priority: P2)

**Goal**: toggle a generated bearer token on/off from the panel; it is masked by default,
revealable, regenerable; the server enforces it; snippets carry it (masked, but a copy is
runnable); an env-set token is read-only; the setting persists.

**Independent Test**: toggle Require token on → a masked token appears, snippets gain a
masked bearer header, an unauthenticated MCP request 401s and an authenticated one succeeds;
Reveal shows the value, Copy always yields working text; Regenerate invalidates the old
token; toggle off discards it; `HYPPO_MCP_TOKEN` makes the controls read-only.

- [X] T025 [US3] `src/main/index.ts`: register `chrome:set-token-required` and `chrome:regenerate-token` per contracts/ipc-connection.md — shared guards: `env.stdio` → `{ ok:false, error:"stdio mode uses no token" }`; `tokenSource === "env"` → `{ ok:false, error:"token is set by the HYPPO_MCP_TOKEN environment variable" }`. `set-token-required(b)`: `const token = b ? generateToken() : null`; `httpHandle.setToken(token)`; `curSettings = { ...curSettings, tokenRequired: b, token }`; `saveSettings(...)`; `existed = true`; `pushConnection()`; `return { ok:true, ...currentEffective() }`. `regenerate-token()`: if `!resolveEffective(...).tokenRequired` → `{ ok:false, error:"no token to regenerate" }`; else `const token = generateToken(); httpHandle.setToken(token); curSettings = { ...curSettings, token }; saveSettings(...); pushConnection(); return { ok:true, ...currentEffective() }`.
- [X] T026 [US3] `src/renderer/panel.ts`: add a Token section to `render(c)` — a "Require token" checkbox reflecting `c.tokenRequired`; when on: a token field, a **Reveal** toggle, a **Regenerate** button. When `c.tokenSource === "env"`: hide the checkbox + Regenerate, show "set by the HYPPO_MCP_TOKEN environment variable". Masking: keep a `revealed` boolean (reset on `close()`); when not `revealed`, render the token field and the `Bearer …` substring inside the command/JSON snippets as a fixed `••••••••••••` run; when `revealed`, render the real value everywhere; **Copy always copies the real text** regardless of `revealed`. Checkbox change → `await hyppo.setTokenRequired(checked)`. Regenerate → `await hyppo.regenerateToken()` then notice "Connected clients must reconnect with the new token." (`connection:changed` re-renders.)
- [X] T027 [US3] `tests/integration/connection-panel.spec.ts` (quickstart §4): toggle on → token field text is all mask glyphs, and `#panel-card` `innerText` contains no `[0-9a-f]{32}`; command/JSON show masked `Bearer`; `mcpPost(port, initialize)` with no auth header → 401, with `Authorization: Bearer <token>` (token read from `hyppo.getConnection()`) → 200. Click Reveal → a 32-hex string is now visible in the field and both snippets. Click the command Copy while masked → `clipboard.readText()` contains the real `Bearer <token>`. Click Regenerate → old token → 401, new token → 200, notice shown. Toggle off → no-auth `mcpPost` → 200 and `settings.json` has `tokenRequired:false, token:null`. Relaunch with `HYPPO_MCP_TOKEN=envtok` → checkbox/Regenerate hidden or disabled, snippets contain `Bearer envtok`, `hyppo.setTokenRequired(true)` → `{ ok:false }`. (SC-004 / SC-005 / SC-006 / SC-007.)
- [X] T028 [US3] Checkpoint: `connection-panel.spec.ts` §2–§4 green; lint + unit green.

---

## Phase 6: User Story 4 — understand what HyppoVisor is (Priority: P2)

**Goal**: the panel carries a static, copyable plain-language description of the app and its
MCP tools, with no secret and no board/orchestrator terms.

**Independent Test**: the panel shows a description naming the app, every MCP tool, and the
never-does guarantees; its Copy yields exactly that text; the text contains no token and no
board/orchestrator wording.

- [X] T029 [US4] `src/renderer/panel.ts` + `src/renderer/index.html` + `scripts/copy-assets.js`: render the About section in `render(c)` for both the HTTP and stdio branches — a mascot `<img id="panel-mascot" src="./mascot.png" alt="HyppoVisor" onerror="this.replaceWith(document.createTextNode('HyppoVisor'))">` (the bundled `src/renderer/mascot.png` already exists — HyppoVisor V10 art, 560px transparent; the `onerror` text fallback satisfies FR-024a); the app name; a line `Version {c.appVersion} · {c.license}` with the license word linking to the repo `LICENSE` (a plain `<a href>` to the file is fine); then a `<pre class="snippet">` whose text is `ABOUT_TEXT` imported from `./snippets.js`, with a `.copy-btn` that copies `ABOUT_TEXT` verbatim (same feedback states as T018 — the version/license/mascot are NOT in the copied text, FR-024a). `appVersion`/`license` come from the `chrome:get-connection` reply (T013); read them once on `open()` and cache. Add `["src/renderer/mascot.png", "dist/renderer/mascot.png"]` to the `pairs` array in `scripts/copy-assets.js`.
- [X] T030 [US4] `tests/integration/connection-panel.spec.ts` (quickstart §5): the About block contains "HyppoVisor", each of the seven tool names, and the never-does verbs; its Copy → `clipboard.readText()` equals the block text and does **not** contain the version number or "Apache-2.0" (FR-024a); the block matches none of `/Bearer|HyppoGraph|orchestrator|dashboard|queue|pipeline/i`. The About section shows `Version <x> · Apache-2.0` (version equal to `hyppo.getConnection().appVersion`) and a mascot element (`#panel-mascot`) is present with `alt="HyppoVisor"` (no assertion on the image loading — asset lands later). (SC-009, with §7.1.)
- [X] T031 [US4] Checkpoint: `connection-panel.spec.ts` §2–§5 green; lint + unit green.

---

## Phase 7: User Story 5 — confirm a client reached the server (Priority: P3)

**Goal**: the panel shows a single last-inbound-request line (time + tool name, or a
rejected marker, or "No requests yet"), metadata only, not persisted.

**Independent Test**: fresh app → "No requests yet"; after one MCP call → the line shows the
tool within ~1 s with no arguments/results; with a token required, an unauthenticated
request shows as rejected, distinct from a successful call.

- [X] T032 [US5] `src/main/mcp/tools.ts`: add `onToolInvoked?: (name: string) => void` to the `ToolDeps` interface; at the first line of each registered tool's handler call `deps.onToolInvoked?.("<that tool's name>")`. No other change; `TOOL_NAMES` (T007) stays the canonical list.
- [X] T033 [US5] `src/main/mcp/server.ts`: accept `deps.onToolInvoked` and wrap it so each invocation also sets `last = { at: Date.now(), tool: name, outcome: "ok" }` (the 401 branch's rejected record from T006 is unchanged); `lastRequest()` returns `last`.
- [X] T034 [US5] `src/main/index.ts`: when building the `deps` passed to `startHttpMcpServer`, include `onToolInvoked: (name) => { lastToolAt = Date.now(); throttledPush(); }` where `throttledPush` calls `pushConnection()` at most once per second (timestamp guard). `currentEffective()` already includes `httpHandle?.lastRequest()`.
- [X] T035 [US5] `src/renderer/panel.ts`: render a "Last request" line in `render(c)` from `c.lastRequest` — `null` → "No requests yet"; `outcome:"ok"` → `Last request: ${ago}s ago — ${tool}`; `outcome:"rejected"` → `Last request: ${ago}s ago — rejected`. Recompute `ago` on each `connection:changed`.
- [X] T036 [US5] `tests/integration/connection-panel.spec.ts` (quickstart §6): fresh `launchAppFull()` → panel line reads "No requests yet"; `mcpPost(port, initialize)` then `mcpPost(port, {method:"tools/list"})` → within ~1 s the line names a tool/method and shows no argument or result text; with a token required, `mcpPost` without the header → the line shows a rejected request distinct from an "ok" call. (FR-026 / FR-027.)
- [X] T037 [US5] Checkpoint: `connection-panel.spec.ts` §2–§6 green; lint + unit green.

---

## Phase 8: Polish & Cross-Cutting

**Purpose**: stdio-mode presentation, the status line's full contract, docs, the bundled
constitution PATCH, the V10 branding wiring (README image, window icon, mascot-spec note),
and the release gate.

- [X] T038 [P] `src/renderer/panel.ts`: implement the stdio branch of `render(c)` — when `c.transport === "stdio"`: show "Running in stdio mode — no network endpoint", omit the endpoint / port / token sections, and render a `<pre class="snippet">` from `snippets.stdioJsonConfig(stdioLaunch)` (the `stdioLaunch` from the `chrome:get-connection` reply) with a Copy button; keep the About section.
- [X] T039 [P] `tests/integration/connection-panel.spec.ts` (quickstart §7): (a) after the §3/§4 changes, the bottom status line text reflects the new port and shows a `token` indicator, clicking it opens the panel, and its text matches none of `/board|HyppoGraph|orchestrator|dashboard|queue|pipeline/i`; (b) `launchAppFull({ HYPPO_MCP_STDIO: "1" })` → panel shows the stdio message, has no port `<input>`, and the stdio JSON's `command` ends with the Electron binary name and `args[0]` ends `dist/main/index.js`. (SC-008 / SC-009.)
- [X] T040 [P] `README.md`: rewrite the "Connect an agent (MCP)" / "Configuration" area so the in-app connection panel (opened via the 🦛 button or the bottom `MCP:` line) is the primary way to see the endpoint, change the port, and enable a bearer token; keep `HYPPO_MCP_PORT` / `HYPPO_MCP_TOKEN` / `HYPPO_MCP_STDIO` documented as the override for headless / scripted launches (FR-031). Note that a port/token set in the panel persists in `settings.json` under the app's user-data directory.
- [X] T041 [P] `.specify/memory/constitution.md`: add to Principle IV the one-line clause from research.md R14 (the loopback MCP bearer token is not a user credential under this principle; the app may generate / store locally outside the shared data directory / display / regenerate it); add an Amendment History entry `**1.3.1** (2026-08-30) — Principle IV: …` explaining PATCH (pure clarification, no principle redefined, the token mechanism already ships via `HYPPO_MCP_TOKEN`); update the footer to `**Version**: 1.3.1 | … | **Last Amended**: 2026-08-30` (FR-032).
- [X] T042 [P] `specs/001-open-any-url/contracts/mcp-tools.md`: add a short note that the HTTP listening port and the bearer token are now runtime-configurable from the in-app connection panel, with `HYPPO_MCP_PORT` / `HYPPO_MCP_TOKEN` remaining the override (doc parity).
- [X] T043 [P] `README.md`: embed the mascot near the top — `<img src="assets/hyppovisor.png" alt="HyppoVisor" width="320" align="right">` (or a centered block), so the vendored branding shows on the repo landing page. The full-res transparent source is `assets/hyppovisor.png`; provenance + regeneration steps are in `assets/BRANDING.md`.
- [X] T044 [P] `src/main/index.ts`: pass `icon: join(here, "../../build/icon.png")` to `new BrowserWindow({...})` (from `dist/main` that resolves to repo-root `build/icon.png`) so the dev/Linux/Windows window + taskbar use the HyppoVisor icon. The macOS packaged icon (`build/icon.icns`) is consumed only once packaging config exists — note this in the commit message; do not add electron-builder here.
- [X] T045 [P] `specs/initial/branding/mascot-spec.md`: **already rewritten during planning** to make HyppoVisor V10 / HyppoGraph V9 canonical (chibi, back-turned, backpacked, rendered-not-flat, no visor band; props beside the figure) and point at `assets/BRANDING.md`. This task is a consistency check: confirm the file still matches the shipped `assets/` + `build/` derivatives and that no other doc (`business-logic.md` §6.0's mascot bullet, README) still asserts the old "visor band + in-hand prop" design; fix any that do. (`specs/initial/` is git-ignored — local hygiene.)
- [X] T046 Full gate: `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e` all green. Confirm `tools/list` over HTTP returns exactly the seven tools `main` returns (FR-033); confirm the panel and status line contain zero board/orchestrator strings (SC-009); confirm `dist/renderer/mascot.png` is produced by the build (T029 copy-assets change) and the About panel shows the mascot; walk quickstart.md §1–§8 and check each item passes.

---

## Dependencies & completion order

- **Setup (T001–T002)** → no dependencies; may run in parallel.
- **Foundational (T003–T017)** → depends on Setup. **Blocks all user stories.** Within it:
  T003/T004/T005/T007/T008/T009 are `[P]`; T006, T010, T011 are `[P]` with each other;
  T012 → T013 are serial (`index.ts`); T014 → T015 → T016 are serial-ish (html before the
  panel module before the app wiring); T017 gates the phase.
- **US1 (T018–T020)** → depends on Foundational only. **MVP.**
- **US2 (T021–T024)** → depends on Foundational; independent of US1 (different concern, same
  `panel.ts`/`spec.ts` spine so ordered after US1's tasks in those files).
- **US3 (T025–T028)** → depends on Foundational; independent of US1/US2 (same file spines).
- **US4 (T029–T031)** → depends on Foundational; independent of US1–US3.
- **US5 (T032–T037)** → depends on Foundational; touches `tools.ts` (after T007) and the
  `index.ts` / `server.ts` / `panel.ts` / `spec.ts` spines.
- **Polish (T038–T046)** → depends on every story it verifies; T040/T041/T042 (docs) and
  T043/T044/T045 (branding: README embed, `BrowserWindow` icon, mascot-spec note) are `[P]`;
  T038/T039 need US1–US4 done; T046 (full gate) is last.

## Parallel execution examples

- **Setup**: T001 ‖ T002.
- **Foundational kick-off**: T003 ‖ T004 ‖ T007 ‖ T008 (then T005 ‖ T009 once their targets
  exist); T006 ‖ T010 ‖ T011 alongside.
- **Docs + branding in Polish**: T040 ‖ T041 ‖ T042 ‖ T043 ‖ T044 ‖ T045.
- **User stories**: US1–US4 are logically independent — if two people split them, coordinate
  edits to `src/renderer/panel.ts` and `tests/integration/connection-panel.spec.ts` along
  the serial spines above (append your story's block; don't reorder).

## Implementation strategy

1. **MVP = Setup + Foundational + US1.** Delivers: open the panel from the 🦛 button or the
   MCP line, see the endpoint, copy a working `claude mcp add` command and JSON block.
2. **+ US2** — live, persisted port configuration (the most common reason to reopen the
   panel).
3. **+ US3** — optional bearer token.
4. **+ US4** — the "what is this" description (static; can land any time after Foundational).
5. **+ US5** — the P3 last-request line (droppable without affecting US1–US4).
6. **Polish** — stdio presentation, status-line contract, README, the 1.3.1 constitution
   PATCH, and the full gate.
