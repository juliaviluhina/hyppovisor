# Design notes

Why the app is shaped the way it is. The binding version of each rule lives in
the [constitution](../.specify/memory/constitution.md); this doc is the
reasoning, in one place, for the decisions people ask about most.

- [Why an Electron app](#why-an-electron-app)
- [Why external acts are hard-excluded](#why-external-acts-are-hard-excluded)
- [Test layering](#test-layering)
- [Complexity budget](#complexity-budget)
- [Why these eight MCP tools](#why-these-eight-mcp-tools)

---

## Why an Electron app

The job is: let an agent read pages **on sites you're already logged into**,
without the agent ever holding your credentials. That rules out the obvious
alternatives:

- **A headless browser / scraper.** It would need to log in — i.e. hold or
  replay credentials, and fight bot-detection on every login wall. That breaks
  [Principle IV](../.specify/memory/constitution.md#iv-user-held-credentials-and-sessions)
  (auth is the human's, never the app's) and
  [Principle V](../.specify/memory/constitution.md#v-assistive-pace-not-bulk-collection)
  (human-paced, human-started, not a bot). A flagged account costs more than any
  automation saves.
- **A Chrome extension** reusing your existing Chrome profile. Rejected at the
  constitution level ([business-logic.md §6](../specs/initial/business-logic.md),
  resolved as [Q10]). An extension means store review, a manifest, a permissions
  prompt surface, and sessions + UI + the MCP server living in three different
  places. The cost of the extension route is *reviewability*.
- **Electron.** One installable artifact. The signed-in tabs, the two UI
  surfaces, and the MCP server are all inside one process you can hold in your
  head. The price — logging into each site once inside the app instead of
  reusing your Chrome profile — is a one-time cost per site, paid knowingly.

Mechanism inside Electron: one `WebContentsView` per tab on a single
`BaseWindow`. `WebContentsView` is the current embedding API (`BrowserView` is
deprecated, `<webview>` is discouraged and slower), and each view's
`webContents` is exactly the primitive set every feature reduces to — `loadURL`,
`executeJavaScript` in an isolated world, navigation and load-failure events.
Views share the app's default session, so a login persists across tabs and
restarts. Full rationale: [specs/001 research R1](../specs/001-open-any-url/research.md).

---

## Why external acts are hard-excluded

[Principle I](../.specify/memory/constitution.md#i-human-does-every-external-act-non-negotiable)
is non-negotiable and it is a *code* boundary, not a setting. The app cannot
submit a form, send a message, apply, connect, or authenticate — there is no
flag that turns that on. Reasons:

- **The failure is irreversible and expensive.** An accidental auto-submit can
  burn a recruiter relationship or disqualify a candidacy. There is no undo, so
  the guarantee has to be structural, not "off by default".
- **A settable exception is not a guarantee.** If a config value could permit an
  outward act, then every review, every dependency bump, and every prompt
  injection is one value away from doing one. Hard-exclusion means the reviewer
  checks *one* property — "does this add an external act?" — and a "yes" is a
  release blocker or a
  [constitution amendment](../.specify/memory/constitution.md#governance), never
  a normal PR.
- **"Prepare a draft" is the whole product.** Reading content and filling a
  draft the human then reviews and submits is the entire value proposition. The
  last mile staying human-owned is the point, not a limitation.

How the line is drawn (see [Safety](safety.md) for the exact rules):

| Allowed — preparation | Refused — outward act (`REFUSED_EXTERNAL_ACT`) |
|---|---|
| `fill` a plain, non-credential, non-consent field (incl. inside a `<form>`) | any submit control; any `click` inside a `<form>` except the reveal-button carve-out below |
| `choose_option` in a plain `<select>` / combobox | consent / agreement toggles |
| `click` / `space` to reveal content or toggle a non-outward control | credential + one-time-code fields |
| `click` a non-submit in-form `<button type="button">` (no `formaction`, not the implicit submit, own label not an outward act) to expand a repeatable sub-form — constitution 1.4.0 | file inputs; the Enter key (any operation); autonomous / non-http window spawn |
| `read_page`, `read_form_fields`, `screenshot`, `scroll`, `wait_for_selector` | |

Two design consequences fall out of this:

- **Permit-by-default matching, backed by an audit log.** The blocklist
  (`src/main/safety/blocklist.ts`) is one enumerable module that permits unless a
  rule matches. Permit-by-default means an unanticipated control *can* get
  through — so every interaction, permitted or refused, is appended to
  `interaction-log.jsonl` in `userData`. That log is what turns "an unanticipated
  act slipped through" from an invisible risk into a detectable defect, which is
  why it is not optional. (An allowlist was considered and rejected: safer by
  default, but it blocks legitimate controls nobody enumerated yet.)
- **No Enter key, ever.** Enter can trigger an implicit form submit with no
  button involved, so it is unavailable on every operation rather than
  pattern-matched.

---

## Test layering

Layers split by what each can prove cheaply
([specs/001 research R7](../specs/001-open-any-url/research.md)):

| Layer | Runner | Covers | Why here |
|---|---|---|---|
| **Unit** | Vitest (`npm test`) | URL policy, blocklist matching, action-queue ordering, truncation, form-field projection, selector syntax, settings precedence, the license scripts | These guarantees are pure functions — testable exhaustively and in milliseconds, with no Electron. Per-rule blocklist coverage is asserted at this layer. |
| **Integration — tool behavior** | Playwright `_electron` + a main-process test handle (`npm run test:e2e`) | session persistence across tabs, refusing a *real* submit button, no action overlap under concurrent calls, auth-popup handling, screenshots, the batch fill | Session state, real DOM refusal, and app-wide sequencing only mean something against a real Electron instance driving a real page. Most specs launch with `HYPPO_E2E=1` and call the tool implementations through `globalThis.__hyppo` — one layer below the JSON-RPC framing, so the assertions stay about behavior, not transport. |
| **Integration — MCP transport** | Playwright `_electron` + real HTTP requests (`connection-panel.spec.ts`) | the `initialize` / `ping` handshake, a real `tools/call` over the wire, bearer-token auth (401 vs 200), port rebind + env-var precedence, settings persistence across relaunch, stdio mode | The connection surface *is* the transport, so it has to be exercised over it. This spec launches the built app with no `HYPPO_E2E`, so the real Streamable-HTTP server is live, and POSTs JSON-RPC to `http://127.0.0.1:<port>/mcp`. |

Integration tests run against **local fixture pages served from disk**
(`tests/fixtures/`) — offline, deterministic, and zero live-site traffic, which
is itself the behavior [Principle V](../.specify/memory/constitution.md#v-assistive-pace-not-bulk-collection)
asks for. The suite needs the Electron binary (`npm install` fetches it) and a
display.

Why layered this way: unit-only would leave every constitutional guarantee
unverified end-to-end — unacceptable for Principles I and IV, which the
constitution designates release blockers. Running *every* tool assertion over
real JSON-RPC would be slower and would test the SDK's framing on every case for
no added signal — so tool behavior goes through the test handle and one spec
covers the wire itself. Neither integration layer can exhaustively cover the
matching rules; that stays with the unit layer.

---

## Complexity budget

[Principle III](../.specify/memory/constitution.md#iii-solid-and-comprehensible)
treats "solid and easy to comprehend" as a hard constraint — complexity here is
paid back in operator toil forever. The concrete budget:

- **One installable artifact, one window, one entry point.** Two narrow
  carve-outs, both keeping everything in that one window: a person-triggered
  plain http(s) `window.open` / `target="_blank"` opens as a new tab
  (rate-limited); a person-triggered sign-in popup to an allowlisted identity
  provider opens as a transient modal child of the main window (needed because an
  OAuth `ux_mode=popup` flow requires a real window with `window.opener`).
  Autonomous or non-http window spawning stays denied and reported.
- **One action queue.** A single promise-chained queue in the main process:
  every `open`, `navigate`, `read_page`, and interaction acquires it before
  touching any `webContents`. It is the smallest mechanism that satisfies "at
  most one operation in flight app-wide" and is verifiable by one no-overlap
  test. Queue depth is returned in every tool response so a caller can tell
  *queued* from *stalled*.
- **No database, no background services, no hidden state.** The only persistent
  state is the shared data directory of plain Markdown / CSV, plus an
  operational `interaction-log.jsonl` (JSONL so it reads line-by-line and appends
  by construction). Page content is *never* written to disk — it is held only for
  the life of the request that asked for it.
- **Smallest mechanism that works.** New persistent stores, services, daemons,
  or IPC channels beyond the MCP surface and the shared directory require a
  written justification in the feature plan and must be called out at review.

The two-repo split (`hyppovisor` app, `hyppograph` orchestrator) is the one
deliberate exception to "one repo": they have genuinely different release cycles,
and the split keeps the MCP contract an honest API boundary rather than a folder
boundary. `hyppovisor` never imports `hyppograph`.

---

## Why these eight MCP tools

[`open_url`, `list_open_tabs`, `navigate`, `read_page`, `read_form_fields`,
`interact`, `wait_for_selector`, `screenshot`](tools.md) — and no others. The set
is deliberately closed.

- **It is the constitution's contract, verbatim.** Principles I–II fix the
  surface: navigate, read (page / DOM / visible text), list tabs, scroll,
  wait-for-selector, click-to-reveal, and value entry to prepare a draft. Every
  tool maps to one of those; nothing maps to "act". Adding a ninth tool that
  performs an external act requires a constitution amendment first.
- **One verb per tool, one bounded action per call.** `interact` takes exactly
  one of `click` / `fill` / `scroll` / `space` / `choose_option` / `list_options`
  and returns. No macro language, no "fill and submit", no chained navigation.
  The batch form of `fill` (an ordered `fields` array, max 50) is the one
  concession to ergonomics — and it runs under the identical rules: every target
  is checked first, one bad target refuses the whole batch with nothing written.
- **Reads are inert; drafts are reviewable.** `read_page` returns verbatim
  visible text and stores nothing — the payload is the only copy, so a caller
  that wants to keep it must do so itself
  ([Principle V](../.specify/memory/constitution.md#v-assistive-pace-not-bulk-collection)).
  `read_form_fields` is *derived and read-only*: it reports each control's
  `fill` / `click` / `choose` verdict and an `operation` hint without acting on
  anything and without writing an audit entry, so an agent can plan a form fill
  before touching it.
- **Every call goes through the one action queue, every error returns a named
  code.** `REFUSED_EXTERNAL_ACT` and its siblings are part of the contract: a
  refusal names the rule that fired, and tests assert per-rule coverage. A caller
  never has to parse prose to know why something was refused.
- **Screenshots stay in memory.** `screenshot` returns a JPEG inline, capped at
  256 KB, never written to disk and never audit-logged — it is a supplementary
  visual aid; `read_page` remains the verbatim-text channel.

Transport is orthogonal to the tool set: the same eight tools, the same
blocklist, and the same audit log ship over both **Streamable HTTP on loopback**
(the default — the app is long-lived, you set it up once, an agent connects
later) and **stdio** (`HYPPO_MCP_STDIO=1`, no open socket). See
[Security](security.md) for the loopback threat model and
[specs/001 research R2](../specs/001-open-any-url/research.md) for why the default
flipped from stdio to HTTP.
