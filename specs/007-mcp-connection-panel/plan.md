# Implementation Plan: MCP Connection Panel

**Branch**: `007-connection-panel` (feature dir `specs/007-mcp-connection-panel`) |
**Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-mcp-connection-panel/spec.md`

## Summary

Add one renderer surface — a **connection panel** reached from a mascot button in the top
chrome (and by clicking the existing bottom-edge MCP line, which becomes a live status
line). The panel shows the effective MCP endpoint with copy-ready snippets (`claude mcp add`
command, JSON `mcpServers` block), lets the user set the HTTP listening port (applied live,
no restart) and optionally require a generated bearer token (masked, revealable,
regenerable), and carries a static, copyable description of what HyppoVisor is and what it
never does.

Technical approach: a new `src/main/settings.ts` owns a small plaintext
`<userData>/settings.json` (`{ port, tokenRequired, token }`) and the
env → persisted → default precedence resolver. `src/main/mcp/server.ts`'s `HttpMcpHandle`
grows `rebind(port)` (re-`listen` on a fresh `http.Server`; old server kept on bind failure)
and `setToken(token | null)` (live, read per-request). `src/main/index.ts` loads settings,
keeps the handle, and adds five renderer→main IPC channels plus one `connection:changed`
push. The panel itself is `src/renderer/panel.ts` (DOM + wiring) with pure formatters and
the About text in `src/renderer/snippets.ts` (unit-tested). While the panel is open the tab
`WebContentsView`s are hidden so the renderer's full-window overlay is unobstructed — still
one window. A bundled PATCH constitution amendment (1.3.0 → 1.3.1) records that the loopback
MCP bearer token is not a site credential (FR-032).

No change to the MCP tool contract, the blocklist, the interaction audit log, tab/browser
behaviour, or the transport chosen at launch (FR-033/FR-034).

## Technical Context

**Language/Version**: TypeScript 5.7, Node ≥ 22 (ESM for `src/main`/`src/shared`; a separate
`tsconfig.renderer.json` compiles `src/renderer` in isolation), Electron 33.

**Primary Dependencies**: Electron (`BrowserWindow`, `ipcMain`, `WebContentsView`,
`app.getPath("userData")`); `node:http` `createServer` / `Server.listen`; `node:crypto`
`randomUUID` (existing `generateToken()`); `@modelcontextprotocol/sdk`; `zod`. No new
runtime dependencies.

**Storage**: NEW — one plaintext JSON file, `<userData>/settings.json`
(`{ port: number, tokenRequired: boolean, token: string | null }`), same directory family as
the existing `interaction-log.jsonl`. Human-readable, safe to delete, never written to the
shared data directory, never read by any orchestrator (FR-028/FR-030). Justified in the
Constitution Check + Complexity Tracking below.

**Testing**: `vitest` unit — `settings.ts` (load / save / corrupt-file fallback / precedence
resolver) and `src/renderer/snippets.ts` (command + JSON formatting for every port/token
combination; About text contains every `TOOL_NAMES` entry and no token / board /
orchestrator term). `@playwright/test` `_electron` integration —
`tests/integration/connection-panel.spec.ts` drives the real renderer and makes real HTTP
requests to `127.0.0.1:<port>/mcp`, with `HYPPO_USER_DATA_DIR` isolating `settings.json`.

**Target Platform**: Electron desktop app (macOS primary; Windows/Linux build) + embedded
MCP HTTP/stdio server.

**Project Type**: Single project — `src/main/**` + `src/preload/**` + `src/shared/**` +
`src/renderer/**` + `tests/**`. Existing layout.

**Performance Goals**: Port rebind completes within a few seconds (SC-002) — one
`Server.close()` + one `Server.listen()`, no polling. Panel open/close is local DOM plus one
IPC round-trip. `connection:changed` fires only on an actual state change or a last-request
update.

**Constraints**: Loopback only — the server binds `127.0.0.1` on any port (FR-015/FR-034).
No auth scheme beyond one static bearer token (FR-034). No external act, no page access
(Principle I/V — untouched). One window (Principle III) — overlay, not a child window.
Env vars keep their current meaning and win (FR-014/FR-021/FR-029). A rejected Apply never
disturbs the running listener (FR-013/SC-010).

**Scale/Scope**: One panel, five IPC channels, one new settings file, ~4 copy snippets, one
static description. ~2 new renderer modules, 1 new main module, edits to 8 existing files,
3 new test files, README + constitution + one contract-doc parity edit.

**Unknowns**: none. The four `/speckit-clarify` answers (token stored plaintext in
`settings.json`; snippets embed the real token but render masked; the bottom MCP line stays
as a clickable live status line; port Apply rebinds immediately with an inline notice) plus
the spec's Assumptions resolve every open decision.

## Constitution Check

*GATE: evaluated before Phase 0 and re-checked after Phase 1 design.*

| Principle | Verdict | Notes |
|-----------|---------|-------|
| **I — Human Does Every External Act (NON-NEGOTIABLE)** | **PASS** | No page interaction, no new `interact` operation, no browser capability. The panel configures and presents the MCP endpoint that already exists. The static About text restates the boundary verbatim (never submits / sends / applies / connects / authenticates / presses Enter — FR-023). Nothing added here can perform an external act. |
| **II — Zero Business Logic** | **PASS** | Panel content is limited to the endpoint, the port control, the token control, copy snippets, the static description, and an optional last-request line (FR-003). No board list, no orchestrator name or link, no queue, no score, no judgement (SC-009). It reinforces HyppoVisor's "general authenticated-session MCP server" framing. |
| **III — Solid and Comprehensible** | **PASS (complexity recorded below)** | One window preserved — the panel is a renderer overlay; tab `WebContentsView`s are hidden while it is open and restored on close (no child window, `config.chromeHeight` unchanged). Introduces one small plaintext store (`settings.json` in `userData`) and five app-internal IPC channels + one event — each justified in Complexity Tracking as the smallest mechanism that removes "re-set the env vars every launch" toil. No database, no service, no daemon. No new MCP tool. |
| **IV — User-Held Credentials and Sessions** | **PASS with bundled PATCH amendment** | The bearer token is an app-to-local-client authorization secret for the loopback MCP port — generated by the app, never a website password, never typed into a site, never part of any site's auth. Principle IV governs site credentials/sessions, which are untouched. FR-032 adds a one-line Principle IV clause + Amendment History entry, **1.3.0 → 1.3.1 (PATCH)** — pure clarification; the token mechanism already ships via `HYPPO_MCP_TOKEN` and predates the constitution, so nothing new is blessed. Storing it plaintext in `userData` matches the threat model: the token only guards a loopback port any local process can already reach. |
| **V — Assistive Pace, Not Bulk Collection** | **PASS** | No page reads, no navigation, no crawling, no pacing surface touched. |

**Architecture Constraints**: The MCP surface stays the same tool set — `server.ts` gains
`rebind` / `setToken` on its handle and an in-memory last-request record; no tool is added,
removed, or changed. No `hyppograph` dependency. The new persistent store and the new IPC
channels are called out here per Principle III's "IPC channels beyond the MCP surface and
the shared data directory require justification recorded in the plan." The shared data
directory is untouched — settings live in `userData`, explicitly not the data dir (FR-028).

### Complexity Tracking

| Choice | Why needed | Simpler alternative rejected because |
|--------|------------|-------------------------------------|
| New persistent store `<userData>/settings.json` | FR-011/FR-020 require the port and token to survive an app restart with no env var set; that is the core value of the feature. | **Session-only settings** — the user re-configures every launch, which is the toil the feature exists to remove. **Shared data directory** — violates FR-028 and Principle II's boundary (HyppoVisor writes only human-entered `inputs/` items + queue decisions there). Plaintext JSON in `userData` is the same file family as `interaction-log.jsonl` and is human-readable and safe to delete (FR-030). |
| `HttpMcpHandle.rebind(port)` — live re-`listen` on a fresh `http.Server` | FR-010 requires applying a new port **without an app restart**; the spec explicitly forbids a restart prompt. | **Require an app restart** — worse UX and spec-forbidden. **Run a second listener** — two ports bound at once is confusing and leaves the old one reachable. On bind failure the old server is kept untouched (FR-013). |
| `HttpMcpHandle.setToken(token \| null)` — mutable token read per request | FR-016/FR-019 toggle and regenerate the token while the app runs; a token change needs no socket change. | **Rebind for a token change** — needless listener churn and dropped connections for something that only changes an `Authorization` comparison. |
| Five renderer→main IPC channels + one `connection:changed` event | The panel must read the effective state and perform three distinct settings mutations plus toggle panel-open; each is a separate user action with its own validation and result. | **One omnibus channel with a `kind` discriminator** — same effective surface area, less legible handlers, weaker per-action typing. |
| `tabs.setChromeOverlay(on)` — hide tab `WebContentsView`s while the panel is open | The tab view is painted over the content area below `chromeHeight`; a renderer overlay would be clipped to the ~104 px strip. | **Child popup `BrowserWindow`** — violates Principle III's "one window". **Permanently taller chrome** — wastes vertical space whenever the panel is closed. |
| `HYPPO_USER_DATA_DIR` env hook → `app.setPath("userData", …)` before `whenReady` | The e2e panel tests must isolate `settings.json` (and get a clean interaction log) so persistence assertions are deterministic. | **Write to the real `userData` during tests** — pollutes dev state and makes "survives restart" non-deterministic across runs. |
| Start the HTTP MCP server even under `HYPPO_E2E=1` (today it is skipped) | The panel e2e proves "reachable on the new port / unreachable on the old" and token rejection against a real listener. | **Keep skipping MCP in e2e** — then FR-010/FR-017 have no integration coverage; unit tests cannot exercise a real socket rebind. `workers: 1` + `fullyParallel: false` mean no port contention. |

**Post-Phase-1 re-check**: still PASS. Design added no service, no schema store, no MCP-tool
change; every Complexity row is the smallest mechanism that satisfies its FR, and the
constitution amendment is a tracked deliverable (FR-032), not scope creep.

## Project Structure

### Documentation (this feature)

```text
specs/007-mcp-connection-panel/
├── plan.md                    # This file
├── research.md                # Phase 0 — decisions R1–R14
├── data-model.md              # Phase 1 — settings, effective state, last-request, IPC payloads
├── quickstart.md              # Phase 1 — runnable validation (§1 unit … §8 gate), SC-001…SC-010
├── contracts/
│   ├── ipc-connection.md      # Phase 1 — the 5 channels + connection:changed payloads
│   ├── connection-snippets.md # Phase 1 — endpoint / claude mcp add / JSON / stdio JSON text + masking + About text
│   └── settings-file.md       # Phase 1 — settings.json schema, location, precedence, corruption fallback
├── checklists/
│   └── requirements.md        # /speckit-specify output
└── tasks.md                   # Phase 2 (/speckit-tasks — NOT created here)
```

### Source code (repository root)

```text
src/
├── main/
│   ├── config.ts                 # + defaultMcpPort, mcpHost constants (replace scattered `|| 7357` / `127.0.0.1`)
│   ├── index.ts                  # settings load + effective resolve; keep HttpMcpHandle; 5 new IPC handlers;
│   │                             #   connection:changed push; HYPPO_USER_DATA_DIR → app.setPath; start HTTP in e2e too
│   ├── settings.ts               # NEW — ConnectionSettings; loadSettings/saveSettings; readEnvOverrides;
│   │                             #   resolveEffective(); DEFAULTS; corrupt-file fallback
│   └── mcp/
│       ├── server.ts             # HttpMcpHandle + rebind(port) / setToken() / port / lastRequest(); mutable token;
│       │                         #   in-memory last-request; reuse generateToken()
│       └── tools.ts              # export TOOL_NAMES; ToolDeps + onToolInvoked?; call it per tool (P3 last-request)
├── preload/
│   └── chrome.cjs               # + getConnection/setPort/setTokenRequired/regenerateToken/setPanelOpen/
│                                 #   onConnectionChanged; drop onMcpReady
├── renderer/
│   ├── index.html               # mascot button in #bar; #mcp becomes clickable status line; panel container + styles;
│   │                             #   load panel.js
│   ├── app.ts                   # mount panel; #mcp + mascot → open panel; onMcpReady → onConnectionChanged
│   ├── panel.ts                 # NEW — mountConnectionPanel(): overlay DOM, open/close (Esc + outside click),
│   │                             #   port field + Apply + inline notice, token toggle/reveal/regenerate, copy buttons
│   └── snippets.ts              # NEW — pure: mcpAddCommand(), mcpJsonConfig(), stdioJsonConfig(), ABOUT_TEXT
tests/
├── integration/
│   ├── helpers.ts               # + launchAppFull() (no HYPPO_E2E) with a temp HYPPO_USER_DATA_DIR
│   └── connection-panel.spec.ts # NEW — US1–US5 against the real renderer + real 127.0.0.1:<port>/mcp
└── unit/
    ├── settings.test.ts          # NEW — load/save/corrupt/precedence
    └── connection-snippets.test.ts # NEW — command + JSON per combination; About text invariants

README.md                         # connection panel as the primary path; env vars documented as the override (FR-031)
.specify/memory/constitution.md   # Principle IV clause + Amendment History 1.3.1 + version header (FR-032)
specs/001-open-any-url/contracts/mcp-tools.md  # note: port/token now runtime-configurable via the panel (doc parity)
```

**Structure Decision**: Single project, existing layout. `settings.ts` mirrors the flat
`src/main/*.ts` module pattern (`config.ts`, `errors.ts`). The renderer keeps its isolated
`tsconfig.renderer.json` compile — `panel.ts` and `snippets.ts` are renderer-local and
redeclare the small connection interface the way `app.ts` already redeclares `TabSummary`;
`snippets.ts` holds only pure functions so `tests/unit` can import it directly under vitest.
No `hyppograph` coupling.

## Phase 0 — Research

See [research.md](./research.md). No open `NEEDS CLARIFICATION`. Decisions R1–R14 cover:
settings file shape and location (R1); precedence resolver and source tracking (R2);
corrupt-file fallback (R3); live `rebind()` semantics and bind-failure handling (R4);
mutable per-request token (R5); one-window overlay via hidden tab views (R6); the five IPC
channels and the push event (R7); snippet text templates and the `claude mcp add` scope
choice (R8); token masking that still yields runnable copy (R9); the static About text and
its `TOOL_NAMES` consistency guard (R10); stdio-mode presentation (R11); the last-request
indicator and `onToolInvoked` (R12); `HYPPO_USER_DATA_DIR` for test isolation and starting
MCP under `HYPPO_E2E` (R13); the PATCH constitution amendment wording (R14).

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — `ConnectionSettings`, `EnvOverrides`,
  `EffectiveConnection` (with `portSource` / `tokenSource`), `LastRequestInfo`,
  `StdioLaunch`; the precedence table; validation rules (port range, token generation);
  `settings.json` lifecycle and fallback.
- [contracts/ipc-connection.md](./contracts/ipc-connection.md) — `chrome:get-connection`,
  `chrome:set-port`, `chrome:set-token-required`, `chrome:regenerate-token`,
  `chrome:set-panel-open`, and the `connection:changed` event; request/response shapes,
  error results, env-controlled rejections.
- [contracts/connection-snippets.md](./contracts/connection-snippets.md) — exact text for
  the endpoint line, the `claude mcp add --transport http --scope user` command, the HTTP
  JSON `mcpServers` block, and the stdio JSON block; the masking rule (real token embedded,
  rendered masked, copy yields working text); the About text contract (contains every
  `TOOL_NAMES` entry and the never-does guarantees; no token, no board/orchestrator term).
- [contracts/settings-file.md](./contracts/settings-file.md) — `settings.json` location,
  schema, precedence with the environment, and the missing/unparseable → defaults rule.
- [quickstart.md](./quickstart.md) — §1 unit, §2 US1 (see + copy), §3 US2 (set port), §4
  US3 (token), §5 US4 (About text), §6 US5 (last request), §7 status line + stdio mode, §8
  docs + constitution + full gate; SC-001…SC-010 mapped to checks.

## Post-Design Constitution Re-Check

PASS — unchanged from the pre-Phase-0 gate. No new violation surfaced during design. The
Complexity Tracking table is complete; each row is the smallest mechanism that works, and
the bundled 1.3.1 PATCH amendment is a tracked deliverable.
