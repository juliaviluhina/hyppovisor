# HyppoVisor Constitution

HyppoVisor is the Electron companion app in a two-component system (paired with HyppoGraph,
the orchestrator). It hosts embedded browser tabs the human logs into, exposes those
authenticated sessions to HyppoGraph over MCP, and renders two UI surfaces: the
onboarding/input-data helper and the review-queue dashboard. Source of these principles:
`specs/initial/business-logic.md` §4 (Principle 1), §6 and §6.1 (system boundary and design
goal), §3.8–§3.9 (intake architecture).

## Core Principles

### I. Human Does Every External Act (NON-NEGOTIABLE)

The human performs every outward action: applying, submitting a form, sending a message,
connecting, authenticating. HyppoVisor and any orchestrator driving it MUST stop at reading,
navigating, and preparing drafts or checklists.

- The app MUST NOT submit forms, click "apply", send messages, or issue outreach on any
  site — in any session, whether human-started or scheduled.
- Permitted browser actions are limited to: navigate, read page / DOM / visible text, list
  open tabs, scroll, wait-for-selector, click used only to reveal more content (pagination,
  "show more" panels), and value entry (fill / the Space key) used to prepare a draft —
  never to complete an external transaction.
- **Value entry is preparation, not an external act.** Typing a value into a plain,
  non-credential, non-consent form field — including one inside a `<form>` — and pressing
  Space to tick a plain checkbox or pick a highlighted option are permitted: they build a
  draft the human reviews. Submitting, sending, applying, connecting, and authenticating
  remain human-only. Submit controls, consent/agreement toggles, credential fields, and
  anything whose label reads as an outward action stay refused for every operation, and no
  operation may press Enter (which can trigger an implicit submit). Choosing an option in a
  plain, non-credential, non-consent `<select>` or combobox — by the option's visible name
  or its value, with the app locating the option only within that one control's own list —
  is preparation on the same footing: it builds a draft and cannot submit.
- **Revealing an in-page repeatable sub-form is preparation.** Clicking a non-submit control
  inside a `<form>` — a `<button type="button">` that declares no `formaction`, is not the
  form's implicit submit control, and whose own accessible name reads as no outward action —
  to expand a repeatable section ("Add Experience", "Add Education") is permitted: it exposes
  fields the human will review and it cannot submit, send, or navigate. Every submit control,
  `formaction` button, implicit submit, consent toggle, and outward-labelled control inside a
  form stays refused for every operation, and no operation may press Enter.
- Any future capability that would perform an external act MUST be added to this document as
  an explicit, separately approved amendment before it is built.

Rationale: the system's value depends on the last mile staying human-owned; an accidental
auto-submit can burn a relationship or disqualify a candidacy irreversibly.

### II. Zero Business Logic in HyppoVisor

HyppoVisor owns authenticated browser sessions and the human-facing UI. It owns no judgment.

- HyppoVisor MUST NOT score, rank, tier, filter, tailor, or otherwise decide anything about
  a job's fit, a career fact, or a connection's usefulness. All of that lives in HyppoGraph.
- The dividing line: if it requires *understanding* a job description, a career fact, or a
  connection, it is HyppoGraph's; if it requires *a logged-in browser* or *a screen the human
  looks at*, it is HyppoVisor's.
- HyppoVisor's dashboard is a read-only rendering of output HyppoGraph already wrote. It MUST
  NOT compute a score or tier for display. The only data HyppoVisor writes back is the
  human's own input: settings, connection annotations, and queue decisions
  (applied / skipped / annotations).
- HyppoVisor exposes sessions and input-data accessors to HyppoGraph solely through its MCP
  server. HyppoVisor MUST NOT depend on HyppoGraph — it is a general authenticated-session
  MCP server that HyppoGraph happens to be the first client of.

Rationale: keeping all judgment in one component keeps each repo a clean, independently
reviewable illustration of one skill and keeps the MCP contract an honest API boundary.

### III. Solid and Comprehensible

The design goal is a system a person can hold in their head and a tool that never needs
babysitting.

- One installable artifact, one window. Within the repo, one entry point. Two narrow
  carve-outs, both keeping everything inside that one window: (a) a plain http(s)
  `window.open` / `target="_blank"` navigation the person triggered opens as a new tab
  (rate-limited); (b) a human-initiated sign-in popup to an allowlisted identity provider
  opens as a transient modal child of the main window (moves with it, no separate taskbar
  entry, closes itself when the OAuth flow ends) — an OAuth `ux_mode=popup` flow needs a
  real window with `window.opener`. Autonomous or non-http window spawning stays denied and
  reported. Running that one artifact more than once at a time is permitted: each process is
  one window with its own profile directory under the app-support root (`instances/<name>/`),
  shares no state with the others, and is identified by its `--instance` label and the OS
  process list. This is N independent single-window instances, not a multi-window app; there
  is no cross-instance registry or shared index. The one window may also start hidden
  (`--background`) and be brought to the foreground by re-launching the instance; while
  hidden it shows no Dock, taskbar, or app-switcher entry. This is presentation of the same
  one window — no second surface, no background service, nothing persisted.
- The only persistent state is a single configured local data directory of plain
  Markdown / CSV. No database, no background services, no hidden state.
- All state a human or HyppoGraph needs to inspect MUST be human-readable files in that
  directory. Every pipeline-facing operation MUST be observable from the app while it runs.
- Prefer the smallest mechanism that works. New persistent stores, services, daemons, or
  IPC channels beyond the MCP surface and the shared data directory require justification
  recorded in the plan and MUST be called out at review.

Rationale: §6's "solid and easy to comprehend" is a hard constraint, not an aspiration —
complexity here is paid back in operator toil forever.

### IV. User-Held Credentials and Sessions

Authentication is the human's, always, and never touches the app's storage.

- The human logs into each board, LinkedIn, and ATS themselves, inside the embedded tab —
  one tab per source.
- HyppoVisor MUST NOT capture, store, type, or transmit passwords, and MUST NOT run headless
  automation against login walls.
- Authenticated sessions are live browser state only. They are read on demand via MCP; they
  are never serialized into the data directory as data.
- The loopback MCP bearer token — an app-to-local-client authorization secret for the MCP
  port, generated by the app and never sent to or accepted from any website — is **not** a
  user credential under this principle. The app MAY generate it, store it locally (outside
  the shared data directory), display it, and regenerate it.

Rationale: "auth without credential handling" is what makes the legitimacy posture defensible
and keeps a leak of the data directory from being a leak of accounts.

### V. Assistive Pace, Not Bulk Collection

Activity comes from the human's own logged-in session, at human pace, reviewed by the human —
the Claude-in-Chrome / Playwright-MCP model, not a scraper.

- The browser acts only in sessions the human starts or on a schedule they set. It reads
  only pages the human (or an orchestrator step already holding a URL) opened; it MUST NOT
  crawl to pages the human did not open.
- Pace like a human: sequential page loads, no parallel hammering, per-site request budgets.
  Sequencing is app-wide, not per-tab: at most one page load or interaction may be in flight
  at a time across all tabs. A flagged account costs more than any automation saves.
- Every ingested page MUST be preserved as a raw capture (visible text snapshot + URL +
  timestamp) so parsing can be re-run when adapters improve, without re-fetching. **This
  obligation belongs to the consuming orchestrator, not to HyppoVisor.** HyppoVisor retrieves
  page content and returns it; whether that content is worth keeping, and where, is the
  calling agent's decision.
- HyppoVisor's corresponding obligation is to make preservation possible: every read payload
  MUST be verbatim (never summarized, reformatted, or reordered) and self-sufficient — a
  caller that stores the payload can reconstruct the page's visible text later without
  re-fetching. Truncation, when a size limit applies, MUST be explicitly indicated.
- HyppoVisor MUST NOT write page content to the shared data directory. Holding retrieved
  content only as long as the request that asked for it keeps the app's persistent footprint
  to what the human authored, and keeps the largest body of sensitive text out of it.
- Systematic extraction of a third party's private data (e.g. paging through and storing a
  contact's connections list or a company's full roster) is prohibited regardless of whether
  the page is technically viewable. Bounded, need-driven, on-screen reads tied to a real
  Job Record are the only pattern allowed.

Rationale: the detectable, litigated behavior is bulk unattended traversal; reading-pace
capture of a page the human opened is both defensible and sufficient for the pipeline.

## Architecture Constraints

- **Two repos, independent.** `hyppovisor` (this repo, Electron app + MCP server) and
  `hyppograph` (orchestrator) ship as separately versioned projects. `hyppovisor` MUST NOT
  import or depend on `hyppograph`.
- **MCP is the only bridge for sessions.** The contract HyppoVisor exposes is `read_page`,
  `navigate`, `list_open_tabs`, the click/fill/scroll/wait interaction primitives (§3.9),
  and input-data accessors. Both components additionally read/write the shared data directory
  directly; MCP is not the general data channel.
- **Shared data directory.** Path configured once (onboarding or `HYPPO_DATA_DIR`-style env /
  config), read on startup by both apps. Structure is `inputs/` + `outputs/` + a root
  `provenance-log.md`, per business-logic.md §6. HyppoVisor writes only `inputs/` items that
  are human-entered and the human's queue decisions.
- **Personal data stays out of the repo.** No candidate profile, priorities, salary figures,
  applications, or connections are committed. The data directory is local config pointing at
  a private folder.
- **Provenance logging.** Any data HyppoVisor adds to the data directory (a connection
  import, a manual contact, a human-entered setting) is appended to `provenance-log.md` with
  what was added, how it was obtained, and which Job Record or human action justified it.
  Page reads add nothing, so they produce no provenance entry here — provenance for stored
  page content belongs to whichever component chooses to store it.
- **Licensing.** Apache License 2.0 (a permissive OSI-approved license). `LICENSE` and
  `NOTICE` ship at the repo root; contributions are inbound under the same license
  (Apache-2.0 §5). The distributable bundle carries a generated `THIRD-PARTY-LICENSES`
  inventory for bundled dependencies (Electron/Chromium permissive licenses plus the
  dynamically-loaded LGPL ffmpeg library).
- **Stack.** Electron shell; MCP server embedded in the app; Claude Agent SDK is the client
  runtime on HyppoGraph's side (not a HyppoVisor dependency).

## Development Workflow

- **Spec Kit flow.** Features move through `/speckit-specify` → `/speckit-plan` →
  `/speckit-tasks` → `/speckit-implement`. Plans MUST include a Constitution Check section
  and cite which principles constrain the design.
- **Build order.** Ship the §3.9 primitive first — open any URL in an embedded tab + the
  injected MCP server proven end-to-end on one arbitrary page — before any board-specific
  adapter, scoring, or Job Record logic. Adapters and pipeline logic layer on top of the
  proven primitive, never the reverse.
- **Idempotent steps.** Every operation that writes to the data directory MUST be rerunnable
  without corrupting state. Reads are naturally idempotent here, since HyppoVisor persists no
  page content.
- **Review gates.** Every PR is checked against the five principles. A change that adds an
  external action, moves judgment into HyppoVisor, introduces a database/service, or handles
  credentials MUST be rejected or escalated to a constitution amendment.
- **Human-readable state.** No change may introduce state that a person cannot inspect by
  opening a file in the data directory.

## Governance

- This constitution supersedes other process conventions in the `hyppovisor` repo. Where a
  plan, spec, or task conflicts with it, the constitution wins and the artifact is revised.
- **Amendments** require: a written rationale, an explicit version bump per the policy below,
  a new entry in Amendment History, and a review of dependent Spec Kit templates for wording
  that now conflicts.
- **Change history convention.** This document deliberately does **not** carry a Sync Impact
  Report block. Git is the authoritative record of what changed; the Amendment History section
  below keeps only what git cannot supply — the reasoning behind each bump type, as precedent
  for judging future ones. Keep entries to one or two lines. `/speckit-constitution` will
  offer to prepend a Sync Impact Report comment; decline it and add an Amendment History entry
  instead. Rationale: an unverified changelog drifts, and this file is loaded into context on
  every planning run, so its length is a recurring cost (Principle III).
- **Versioning policy** (semantic):
  - MAJOR — a principle is removed or redefined in a backward-incompatible way, or a new
    binding constraint invalidates existing designs.
  - MINOR — a new principle or section is added, or existing guidance is materially expanded.
  - PATCH — clarifications, wording, and non-semantic refinements.
- **Compliance review.** Principle I (no external act) and Principle IV (no credential
  handling) are non-negotiable: a violation is a release blocker, not a tracked debt. The
  other principles may be knowingly deviated from only with a justification recorded in the
  feature's plan and referenced in the PR.
- Runtime development guidance for agents lives in repo-level guidance files (e.g.
  `CLAUDE.md`) and MUST stay consistent with this document.

## Amendment History

One or two lines per version. Records why a bump type was judged as it was — git holds the
diffs.

- **1.4.2** (2026-09-01) — Principle III: the one window may start hidden (`--background`)
  and be summoned by re-launching the instance; its Dock / taskbar / ⌘-Tab presence follows
  its visibility. PATCH: a scoped clarification of "one window" — redefines no principle,
  adds no persistent store (the flag persists nothing), adds no MCP tool, adds no external
  act, adds no UI surface (the summon gesture is the existing relaunch; quit is the existing
  menu / Ctrl-C). Precedent: 1.3.2 / 1.4.1 (scoped clarifications of the same sentence).
  Recorded in feature `013-background-window`.
- **1.4.1** (2026-09-01) — Principle III: added a sentence permitting several concurrent
  instances of the one artifact, each one window with its own `instances/<name>/` profile
  directory and no shared state, identified by an `--instance` label. PATCH: a scoped
  clarification of "one window" — redefines no principle, adds no persistent store *kind*
  (the per-instance dir holds the existing per-profile files), adds no MCP tool, adds no
  external act. Precedent: 1.3.1 / 1.3.2 (scoped clarifications of the same principle).
  Recorded in feature `012-multi-instance` and `specs/issues/006-multiple-instances-per-machine.md`.
- **1.4.0** (2026-08-31) — Principle I: added the "revealing an in-page repeatable sub-form
  is preparation" clause — a `click` on a non-submit in-form `<button type="button">` (no
  `formaction`, not the implicit submit, own label not an outward act) to expand a repeatable
  section is permitted. MINOR: same reasoning as 1.2.0 / 1.3.0 — a binding clarification that
  materially expands existing "preparing drafts" guidance, redefines no principle, and
  invalidates no conforming artifact; every submit / consent / outward-labelled control and
  the Enter key stay refused. Recorded in feature `011-form-fill-fidelity` and
  `specs/issues/005-form-fill-second-workable-session.md`.
- **1.3.2** (2026-08-30) — Principle III: clarified how page-opened windows are handled,
  driven by real blockers (a site offering only "Continue with Google" whose `ux_mode=popup`
  flow the universal popup-deny killed; job links opening via `target="_blank"`). A plain
  http(s) `window.open` / `_blank` navigation the person triggered now opens as a **new tab
  in the one window** (rate-limited), and a sign-in popup to an allowlisted identity provider
  opens as a **modal child of the main window** that closes itself when the flow ends —
  because an OAuth popup needs a real window with `window.opener`. Truly autonomous /
  non-http window spawning stays denied and reported. PATCH: a scoped clarification of
  FR-006/"one window"; redefines no principle, adds no persistent state, adds no MCP tool.
- **1.3.1** (2026-08-30) — Principle IV: added a clause stating the loopback MCP bearer
  token is not a user credential under this principle — the app may generate, store locally
  (outside the shared data directory), display, and regenerate it. PATCH: a pure
  clarification. It redefines no principle and blesses no new capability — the token
  mechanism already ships via `HYPPO_MCP_TOKEN` and predates the constitution; this only
  disambiguates "credential" so the review gate does not flag a stored loopback token.
  Recorded in feature `007-mcp-connection-panel`.
- **1.3.0** (2026-08-30) — Principle I: added the "choosing an option is preparation" clause
  for `<select>` / combobox selection via the `choose_option` operation. MINOR: same
  reasoning as 1.2.0 — a binding clarification that expands existing guidance (Principle I
  already blessed "pick a highlighted option" via Space), redefines no principle, and
  invalidates no conforming artifact. Recorded in feature `006-select-dropdown-option`.
- **1.2.0** (2026-08-29) — Principle I: added the "value entry is preparation" clause —
  `fill` on a plain non-credential/non-consent field inside a `<form>`, and a new `space`
  operation for plain checkboxes / listbox options, are permitted; submit/consent/credential
  targets and the Enter key stay refused for every operation. MINOR: a new binding
  clarification that materially expands existing guidance (Principle I already listed `fill`
  among permitted actions and contemplated preparing drafts); it redefines no principle and
  invalidates no conforming artifact. Recorded in
  `specs/issues/001-in-form-rule-blocks-all-field-fills.md` and feature `003-in-form-fill`.
- **1.1.1** (2026-08-29) — Architecture Constraints / Licensing: PolyForm Noncommercial 1.0.0
  → Apache-2.0. PATCH: updates a single constraint's content, changes no principle, and
  invalidates nothing (the repo is a portfolio piece with no external users; a permissive
  license only widens what is allowed). Reasoning: the commercial-reservation was theoretical
  and the "not OSI open source" caveat suppressed the adoption the repo exists to demonstrate.
- **1.1.0** (2026-08-29) — Principle V: raw-capture preservation reassigned from HyppoVisor
  to the consuming orchestrator, with HyppoVisor given a verbatim/self-sufficient payload duty
  and barred from writing page content; pacing tightened to app-wide sequencing. Judged MINOR
  because the obligation changed bearer, not existence, and no conforming artifact was
  invalidated — a scope reassignment is not a redefinition.
- **1.0.0** (2026-08-29) — Initial ratification. Five principles drawn from
  `specs/initial/business-logic.md`, plus Architecture Constraints, Development Workflow, and
  Governance.

**Version**: 1.4.2 | **Ratified**: 2026-08-29 | **Last Amended**: 2026-09-01
