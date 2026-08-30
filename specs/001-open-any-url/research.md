# Phase 0 Research: Open Any URL

**Feature**: 001-open-any-url | **Date**: 2026-08-29

The spec left no `[NEEDS CLARIFICATION]` markers — five were resolved in the clarification
session. What remained were technology choices implied but not named by the constitution. Each is
resolved below.

---

## R1. Embedded browser view mechanism

**Decision**: Electron `WebContentsView` (one per tab), attached to a single `BaseWindow`.

**Rationale**: `WebContentsView` is Electron's current API for embedding independent web contents
with its own session — `BrowserView` is deprecated and `<webview>` is discouraged and slower.
Each view gets a real `webContents`, which is what supplies `loadURL`, `executeJavaScript`,
navigation events, and load-failure events — the primitives every functional requirement in this
feature reduces to. Views share the app's default session by default, so a login the person
completes in one tab persists across tabs and restarts (FR-002).

**Alternatives considered**: `<webview>` tag — extra process indirection, discouraged by Electron
docs, harder to test. `BrowserView` — deprecated. A Chrome extension instead of an app — rejected
at the constitution level ([Q10] in business-logic.md §6): one installable artifact was chosen
over reusing the Chrome profile.

---

## R2. MCP server transport

**Decision (revised during implementation)**: support **both** transports; default to
**Streamable HTTP** on loopback.

- **HTTP (default).** The person runs `npm start`; the app listens on
  `http://127.0.0.1:7357/mcp` (`HYPPO_MCP_PORT` to change). Claude Code connects with
  `claude mcp add --transport http hyppovisor <url>`. Optional bearer token via
  `HYPPO_MCP_TOKEN`. Fresh `McpServer` + stateless transport per request; the tools close over
  one shared `deps` (queue, tabs, log) so app state persists.
- **stdio (`HYPPO_MCP_STDIO=1`).** The client spawns the app; no open port.

**Why the change from stdio-only**: the intended workflow is "start HyppoVisor, log into your
sites, *then* connect an agent". stdio forces the reverse — the client owns the process
lifecycle and the window only exists while a session is attached. HTTP lets the app be a
long-lived thing you set up once.

**Security tradeoff, accepted**: an HTTP listener is a local port that can drive whatever the
person is logged into. Mitigations: bound to `127.0.0.1` only (never `0.0.0.0`), optional
`Authorization: Bearer` token, and it is opt-in — the person chose to run the app. This is a
weaker posture than stdio's no-socket model; stdio remains available for anyone who wants it.
The constitution's Principle I/IV guarantees are unaffected — the transport carries the same
six tools with the same blocklist and audit log regardless.

**Alternatives considered**: stdio-only (the original decision) — no socket to defend, but the
lifecycle is backwards for this workflow. SSE transport — superseded by Streamable HTTP in the
current MCP spec and SDK.

---

## R3. Verbatim visible-text extraction

**Decision**: `webContents.executeJavaScript` running an extraction script in an isolated world,
returning `document.body.innerText` plus `document.title` and `location.href`. DOM structure, when
requested, is `document.documentElement.outerHTML`.

**Rationale**: `innerText` is the closest available approximation to "what the person sees" — it
respects CSS visibility and layout-driven line breaks, unlike `textContent`, which returns hidden
content and collapses structure. Returning it unmodified satisfies the verbatim requirement
(FR-010b) with no transformation step where drift could enter.

**Alternatives considered**: `textContent` — includes `<script>`/`<style>` bodies and hidden nodes;
not "visible". A readability/extraction library — would be interpretation, forbidden by
Principle II. Chrome DevTools Protocol `DOM.getDocument` — more machinery for no gain here.

**Note**: truncation is applied *after* extraction and flagged per part (FR-021), so a caller can
always distinguish a complete read from a clipped one.

---

## R4. External-act blocklist matching

**Decision**: Evaluate the target element in-page before acting. Refuse when any rule matches:
(a) the element is a submit control (`<button>` without `type="button"`, `input[type=submit|image]`),
(b) the element has a `<form>` ancestor, or (c) its visible text or accessible label matches a
case-insensitive pattern list (`apply`, `submit`, `send`, `connect`, `message`, `sign up`, `save`,
`post`). `fill` additionally refuses `input[type=password]` and autocomplete-tagged credential
fields (FR-018).

**Rationale**: All three signals are cheap to evaluate in the page and are enumerable, which
FR-012a requires. Rules live in one module returning a rule id, so a refusal can name what matched
and tests can assert per-rule coverage.

**Alternatives considered**: An allowlist (recommended during clarification, not chosen) — safe by
default but blocks unanticipated legitimate controls. Intercepting form submission at the
`webContents` level as the sole defense — reactive rather than preventive, and wouldn't catch
JS-driven sends that never fire a form submit.

**Consequence, stated plainly**: permit-by-default means an unanticipated control can get through.
The interaction log (FR-024a, FR-012b) is what converts that from an invisible risk into a
detectable defect, and is therefore not optional.

---

## R5. App-wide action sequencing

**Decision**: A single promise-chained queue in the main process. Every `open`, `navigate`,
`read_page`, and interaction acquires the queue before touching any `webContents`. Queue depth is
reported in the tool response so a caller can distinguish queued from stalled (FR-013a).

**Rationale**: One queue is the smallest thing that satisfies "at most one in flight app-wide" and
is verifiable by a single test asserting no overlap under concurrent calls (SC-008a). Per-site
queues would be more permissive but need a site-identity notion the spec deliberately defers.

**Alternatives considered**: Per-tab locks — leaves cross-tab bursts open, which is the gap Q5
closed. A rate limiter with inter-request delays — deferred to the adapter stage per the spec's
Assumptions.

---

## R6. Interaction log location and format

**Decision**: JSONL, append-only, at `app.getPath('userData')/interaction-log.jsonl`.

**Rationale**: The constitution bars the app from writing page content to the *shared data
directory*; this log is operational data about the app's own behavior, not page content or
business data, so `userData` is the correct home and keeps the shared directory clean. JSONL is
human-readable line-by-line (Principle III) and append-only by construction. Rotation is out of
scope — the log records interactions, not content, so it grows slowly.

**Alternatives considered**: The shared data directory — muddies the boundary the constitution
just clarified. A structured database — forbidden by Principle III.

---

## R7. Testing approach

**Decision**: Vitest for pure logic (URL policy, blocklist matching, queue ordering, truncation);
Playwright's `_electron` fixture for integration, driving a real app instance against local
fixture pages served from disk.

**Rationale**: The constitutional guarantees are mostly pure functions and can be tested cheaply
and exhaustively. The ones that aren't — session persistence, refusal of a real submit button,
no-overlap under concurrency — need a real Electron instance and a real page, which `_electron`
provides. Local fixture pages keep tests offline, deterministic, and free of live-site traffic,
which is itself the behavior Principle V asks for.

**Alternatives considered**: Spectron — unmaintained. Unit tests only — would leave every
constitutional guarantee unverified end-to-end, unacceptable for Principles I and IV, which the
constitution designates release blockers.
