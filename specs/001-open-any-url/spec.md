# Feature Specification: Open Any URL

**Feature Branch**: `001-open-any-url`

**Created**: 2026-08-29

**Status**: Draft

**Input**: User description: "turn §3.9 (from specs/initial/business-logic.md, the open-any-URL stage-1 scope) into a formal spec."

## Overview

The first slice of HyppoVisor's browser surface: the app can open **any URL a person hands it**
in an embedded browser tab that carries that person's existing logged-in session, and a
connected orchestrator (HyppoGraph) can perceive and act on that page through a controlled
interface — read its content, click, fill, scroll, wait for state changes. No job-board logic,
no scoring, no structured extraction. This is the raw page-access primitive every later
capability is built on, proven end-to-end on one arbitrary page.

Boundaries set by the project constitution:

- The app performs **no external act** — no form submission, no application, no message send
  (Principle I).
- The app performs **no interpretation** of page content — it returns raw content only
  (Principle II).
- One window, observable, plain-file state (Principle III).
- The person holds their own credentials — the app never handles passwords (Principle IV).
- Only pages the person opened, at human pace (Principle V). Retrieved content is returned
  to the caller, not archived by the app — storage is the calling agent's decision.

## Clarifications

### Session 2026-08-29

- Q: How should the app decide that a requested click or fill would perform an "external act" and must be refused? (FR-012) → A: Blocklist of dangerous targets — permit by default; refuse clicks on submit buttons, elements inside a form, and targets matching known apply/send text patterns.
- Q: Where in the shared data directory should raw page captures be stored? (FR-019, FR-022) → A: *Superseded by the next answer* — the app stores no page content at all, so no capture location is needed.
- Q: Which component is responsible for storing retrieved page content? (FR-019, FR-020) → A: Neither storage nor provenance for page content belongs to HyppoVisor. It retrieves the page and returns the result through its MCP tool; the calling agent decides whether the content is worth storing and where. HyppoVisor's read payload must therefore be verbatim and self-sufficient.
- Q: What should a read return by default, given the payload lands in an agent's context window? (FR-010, FR-021) → A: Verbatim visible text by default (100 KB limit); DOM structure only when the caller requests it, under its own separate limit.
- Q: May page loads happen in parallel across different tabs? (FR-013) → A: No — sequencing is app-wide. At most one page load or interaction is in flight at a time across all tabs; further requests queue.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open a URL in an authenticated tab (Priority: P1)

A person pastes or types a URL into the app and the app opens it in a new embedded browser
tab. If the person is already logged into that site within the app, the page renders exactly
as they would see it in a normal browser — logged in, with their content visible. An
orchestrator step that already holds a URL (for example, an ATS link found on a job posting)
can request the same open.

**Why this priority**: This is the MVP. Without it there is no page to read or act on. It
alone proves the core promise — "the app can reach any page the person can reach" — and
de-risks every board-specific adapter that comes later.

**Independent Test**: Paste a public URL and a URL behind a login the person has completed in
the app; confirm both render in a new tab, the authenticated one without a re-login prompt,
and the tab shows the expected final URL and title.

**Acceptance Scenarios**:

1. **Given** the app is running, **When** the person submits `https://example.com/page`,
   **Then** a new embedded tab opens, loads that page, and displays its final URL and title.
2. **Given** the person has an active logged-in session for a site in the app, **When** they
   open a URL on that site that requires authentication, **Then** the page renders in its
   logged-in state and the app triggers no login or credential prompt of its own.
3. **Given** a connected orchestrator holds a URL from a prior step, **When** it requests an
   open for that URL, **Then** the app opens it in a new tab the same way as a person-initiated
   open and reports the new tab's identifier.
4. **Given** the person submits a non-web scheme (`file://`, `javascript:`, `data:`), **When**
   the app processes it, **Then** the request is refused with a message naming the reason and
   no tab is opened.
5. **Given** a URL that fails to load (DNS failure, connection refused, HTTP error page),
   **When** the load completes, **Then** the tab reports a clear load-failure state rather
   than appearing to hang.

---

### User Story 2 - Orchestrator reads an open page (Priority: P2)

A connected orchestrator lists the open tabs and asks the app for the content of one of them.
The app returns the current URL, the page title, the verbatim visible text, the DOM structure,
and the observation timestamp — the raw material the orchestrator needs to reason about the
page, with no parsing done by the app. The app returns this content and nothing more: whether
any of it is worth storing, and where, is entirely the calling agent's decision.

**Why this priority**: Reading is the first useful thing an orchestrator does with a page.
It is independently valuable — a person could open a page and have the orchestrator summarize
or inspect it — and it establishes the read contract every later capability inherits.

**Independent Test**: With one tab open on a known page, issue a single read call from an
orchestrator client; confirm the returned URL, title, and text match what the person sees, and
that the returned payload alone is sufficient to reconstruct the page's visible text offline.

**Acceptance Scenarios**:

1. **Given** one open tab, **When** the orchestrator calls "list open tabs", **Then** it
   receives each tab's identifier, current URL, and title.
2. **Given** an open tab on a rendered page, **When** the orchestrator requests that tab's
   content without asking for DOM structure, **Then** it receives the current URL, title,
   verbatim visible text, and an ISO 8601 observation timestamp — and no DOM structure.
3. **Given** the same tab, **When** the orchestrator requests the content *with* DOM
   structure, **Then** the DOM structure is returned alongside the default fields.
4. **Given** a completed read delivered to the orchestrator, **When** the read finishes,
   **Then** the app has written no page content to the data directory — the returned payload
   is the only copy, and storing it is the calling agent's decision.
5. **Given** the orchestrator requests content for a tab identifier that does not exist (never
   opened, or already closed), **When** the app processes it, **Then** it returns a distinct
   "no such tab" error.
6. **Given** a page whose visible text exceeds the 100 KB default limit, **When** it is read,
   **Then** the payload carries the truncated text plus an explicit truncation indicator
   naming which part was truncated.

---

### User Story 3 - Orchestrator drives bounded interaction (Priority: P3)

A connected orchestrator performs limited actions on an open tab to reveal more content:
navigate the tab to a new URL, click an element, fill a non-credential field, scroll, and
wait for a selector to appear. This is enough to page through a results list or expand a
"show more" panel. It is deliberately **not** enough to submit an application — any action
that would submit a form, send a message, or complete an external transaction is refused.

**Why this priority**: Interaction extends the primitive from "read what loaded" to "reach
content that needs a click", which most real pages require. It is lower priority than reading
because a meaningful slice ships with open + read alone, and interaction carries the tightest
guardrails, so it benefits from landing on a proven base.

**Independent Test**: On a dynamic page with a "show more" control, have the orchestrator wait
for the control, click it, and read the newly revealed content; separately, have the
orchestrator attempt a form submission and confirm it is refused.

**Acceptance Scenarios**:

1. **Given** an open tab, **When** the orchestrator requests navigation to another http(s)
   URL, **Then** the tab loads that URL and reports its new URL and title.
2. **Given** an open tab with a "show more" control, **When** the orchestrator waits for that
   control's selector and clicks it, **Then** the newly revealed content is present on the
   next read of that tab.
3. **Given** an open tab with a non-credential text field, **When** the orchestrator fills
   that field, **Then** the field holds the supplied value and no submission occurs.
4. **Given** an open tab, **When** the orchestrator issues an action whose target matches the
   external-act blocklist (a submit control; an element inside a form; a button/link labelled
   save / confirm / submit / delete / sign in / sign up / …; or a consent checkbox labelled
   accept / agree / terms / …), **Then** the app refuses the action and returns an explanation
   naming the matched rule and referencing the no-external-act rule.
5. **Given** any orchestrator interaction request, permitted or refused, **When** the app
   handles it, **Then** an entry recording the tab, operation, target, URL, timestamp, and
   permit/refuse outcome is appended to the interaction log.
6. **Given** a wait-for-selector call whose selector never appears, **When** the configured
   timeout elapses, **Then** the app returns a distinct timeout error and leaves the tab
   unchanged.
7. **Given** a click or fill whose target element is not found, **When** the app processes it,
   **Then** it returns a distinct "target not found" error.

---

### Edge Cases

- **Login wall encountered**: the person is not logged into a site and the opened page shows
  a login screen. The app surfaces the page as-is and takes no automated authentication
  action — it does not fill or submit credentials.
- **Page opens a popup or starts a file download**: the app surfaces it to the person and
  does not auto-accept; no download proceeds without the person's action.
- **Tab closed mid-operation**: the person closes a tab while an orchestrator call against it
  is in flight; the call returns a "no such tab" / "tab closed" error and orchestrator access
  to that tab ends.
- **Dynamic content not yet present**: a read runs before client-side rendering finishes;
  the orchestrator uses wait-for-selector to gate the read, and a read that still finds
  nothing returns whatever is present without inventing content.
- **Redirect chains**: the submitted URL redirects; the tab and every read payload report the
  final landed URL, not the one originally submitted.
- **Very large or infinite-scroll page**: returned content is bounded by the size limit and
  truncated with an indicator; the app does not scroll indefinitely on its own.
- **Multiple tabs open on the same site**: each tab has its own identifier; orchestrator
  calls address exactly one tab and never fan out across tabs.
- **Burst of requests across many tabs**: an agent issues opens or reads for several tabs at
  once. They queue and execute one at a time app-wide (FR-013); none is dropped, and each
  caller can tell its request is queued rather than stalled.
- **Malformed URL**: rejected with a clear message; no tab opened.
- **Orchestrator not connected**: person-initiated opens and reads in the UI still work; the
  control surface simply has no client.
- **Attempt to open a page that was not requested** (e.g., following an in-page link
  automatically): the app does not do this — it acts only on explicitly requested URLs.
- **Blocklist miss**: a target the blocklist does not anticipate (a custom scripted control,
  an element styled as a button outside any form) is permitted by default. The interaction log
  records it, and if it turns out to have caused an external act, that is a defect and the
  blocklist is extended.
- **Over-blocking**: a harmless expander sits inside a form element and is refused. The
  refusal names the matched rule so the person can see why, and the orchestrator receives a
  refusal rather than a silent no-op.

## Requirements *(mandatory)*

### Functional Requirements

**Opening pages**

- **FR-001**: Users MUST be able to open an arbitrary `http`/`https` URL in a new embedded
  browser tab within the app, by typing or pasting it.
- **FR-002**: An opened tab MUST use the person's existing in-app browser session state
  (cookies, logged-in status) so authenticated pages render as the person would see them.
- **FR-003**: The app MUST accept an open-URL request from either the person (typed/pasted)
  or a connected orchestrator step that supplies a URL, and MUST treat both identically once
  the URL is received.
- **FR-004**: The app MUST reject any URL whose scheme is not `http` or `https` (e.g.
  `file:`, `javascript:`, `data:`) with a message naming the reason, and MUST NOT open a tab
  for it.
- **FR-005**: The app MUST report a clear load-failure state for a tab when the URL fails to
  resolve or returns an error, rather than leaving the tab in an indefinite loading state.
- **FR-006**: The app MUST act only on URLs explicitly requested per FR-003; it MUST NOT
  automatically follow in-page links or open pages that were not requested (Principle V).

**Orchestrator control surface**

- **FR-007**: The app MUST expose a control surface to a connected orchestrator client
  offering exactly these operation families: list open tabs, read a tab's content, navigate
  a tab, and bounded interaction (click, fill, scroll, wait-for-selector).
- **FR-008**: The app MUST assign each open tab a stable identifier for the life of that tab,
  so every orchestrator call addresses one unambiguous tab.
- **FR-009**: A "list open tabs" call MUST return, per tab, its identifier, current URL, and
  page title.
- **FR-010**: A "read tab content" call MUST return, by default, the addressed tab's current
  URL, page title, verbatim visible text, and an ISO 8601 observation timestamp. DOM structure
  MUST NOT be included by default.
- **FR-010a**: The caller MUST be able to request DOM structure explicitly, via a parameter on
  the read call. When requested, it is returned alongside the default fields.
- **FR-010b**: The returned visible text MUST be verbatim — the app MUST NOT summarize,
  reformat, reorder, or otherwise alter page content. The payload MUST be self-sufficient:
  a caller that stores it can reconstruct the page's visible text later without re-fetching.
- **FR-011**: The app MUST perform no parsing, scoring, classification, or structured
  extraction of page content; it returns raw content only (Principle II).
- **FR-012**: Interaction operations MUST be limited to navigation and content-revealing
  actions. The app MUST NOT offer any operation that submits a form, sends a message, or
  completes an application, and MUST refuse any orchestrator request to perform such an
  action, returning an explanation that references the no-external-act rule (Principle I).
- **FR-012a**: The app MUST decide refusals by **blocklist**: an interaction is permitted by
  default and refused when its target matches a blocked pattern. The blocklist MUST cover at
  minimum: (a) submit controls (a button or input whose behavior submits a form); (b) any
  element inside a form element; (c) targets whose visible text or accessible name (including a
  checkbox's associated `<label>`) matches known external-act wording — at least *save,
  confirm, submit, apply, send, delete, remove, connect, message, post, publish, subscribe,
  pay, checkout,* and *log in / sign in / sign up / register*; and (d) a checkbox, radio, or
  switch whose label reads as consent — at least *accept, agree, consent, terms, privacy,
  policy, opt in, subscribe*. The blocklist MUST be defined in one place, human-readable, and
  enumerable for test.
- **FR-012b**: Because a blocklist permits by default, every refusal AND every permitted
  interaction MUST be recorded (FR-024a) so an unanticipated external act is detectable after
  the fact. Any interaction target the blocklist does not cover but that is later found to
  have caused an external act MUST be treated as a defect requiring a blocklist extension.
- **FR-013**: Page loads and interaction calls MUST be sequenced **app-wide**: at most one
  page load or interaction may be in flight at a time across all tabs, regardless of which tab
  or site it targets. Concurrent requests MUST queue and execute in order rather than being
  refused or run in parallel (Principle V).
- **FR-013a**: A caller MUST be able to tell that its request was queued rather than executed
  immediately, so a slow response is distinguishable from a stalled one.
- **FR-014**: The app MUST return a distinct, actionable error for each of: URL failed to
  load, addressed tab does not exist, wait-for-selector timed out, interaction target not
  found. No failure may be silent.
- **FR-015**: Closing a tab (by the person) MUST immediately end orchestrator access to that
  tab; subsequent calls addressing it return a "tab closed" / "no such tab" error.

**Credentials and safety**

- **FR-016**: The app MUST NOT capture, store, autofill, or transmit credentials. When a page
  presents a login wall, the app surfaces the page unchanged and takes no automated
  authentication action (Principle IV).
- **FR-017**: When a page initiates a file download or opens a popup/new window, the app MUST
  surface it to the person and MUST NOT auto-accept it.
- **FR-018**: A "fill" operation MUST be refused when its target is a credential input (e.g.
  a password field).

**Page content: retrieved, not stored**

- **FR-019**: The app MUST NOT write page content to the shared data directory. It retrieves
  page content and returns it through the control surface; deciding whether that content is
  worth storing, and where, belongs entirely to the calling agent.
- **FR-019a**: Because the app stores no page content, the read payload MUST carry everything
  a caller needs to store a faithful record on its own: verbatim visible text, DOM structure,
  full final URL, page title, and ISO 8601 observation timestamp (FR-010, FR-010a).
- **FR-020**: The app MUST append a provenance-log entry only for data it itself adds to the
  shared data directory (constitution Architecture Constraints). Since page reads add none,
  a read produces no provenance entry — provenance for stored page content is the
  responsibility of whichever component chooses to store it.
- **FR-021**: The app MUST enforce separate configurable size limits for returned visible text
  and returned DOM structure. The visible-text limit defaults to 100 KB. When either exceeds
  its limit, the app returns that part truncated with an explicit per-part truncation
  indicator, so a caller can tell a truncated read from a complete one and can tell which part
  was truncated.
- **FR-022**: Every file the app does write (its interaction log, and any human-entered input
  it persists) MUST be human-readable; append-only logs MUST remain append-only
  (Principle III).

**App shape**

- **FR-023**: The app MUST run as a single window that presents the tab strip, an
  address/open control, and the content of the active tab.
- **FR-024**: All orchestrator activity against a tab (navigation, clicks, fills, scrolls)
  MUST be visible to the person in that window as it happens (Principle III).
- **FR-024a**: The app MUST keep a human-readable, append-only interaction log recording every
  orchestrator-requested interaction — the tab, the operation, the target, the page URL, an
  ISO 8601 timestamp, and whether it was permitted or refused (with the matched blocklist rule
  for refusals). This log is what makes the permit-by-default posture auditable.
- **FR-025**: The person MUST be able to see every open tab and close any of them at any
  time.

### Key Entities

- **Embedded Tab**: one browser view for one page. Attributes: tab identifier, current
  (final) URL, page title, load state (loading / loaded / failed), origin of the open request
  (person or orchestrator).
- **Page Read**: a point-in-time observation of a tab, returned to the caller and not
  persisted by the app. Attributes: tab identifier, URL, title, verbatim visible text, ISO
  8601 observation timestamp, per-part truncation flags, and DOM structure only when the
  caller requested it. Self-sufficient — a caller can store it as a faithful record without
  further calls.
- **Provenance Entry**: an append-only record in the data directory's provenance log, written
  only for data the app itself adds. Attributes: what was added, how it was obtained,
  triggering request / justification, timestamp. Page reads produce none (FR-020).
- **Orchestrator Control Session**: a connected client's link to the app's control surface.
  Attributes: connection state, the fixed set of operations it may invoke.
- **Interaction Log Entry**: an append-only record of one orchestrator interaction request.
  Attributes: tab identifier, page URL, operation, target description, ISO 8601 timestamp,
  outcome (permitted / refused), matched blocklist rule when refused.
- **External-Act Blocklist**: the single, human-readable, enumerable definition of which
  interaction targets are refused. Attributes: rule identifier, matching condition, refusal
  explanation shown to the orchestrator.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can open an arbitrary URL and see the page fully rendered within 5
  seconds of submitting it, network permitting.
- **SC-002**: For a site the person is logged into within the app, 100% of opens preserve
  the authenticated view — the app itself never causes a re-login prompt.
- **SC-003**: A connected orchestrator can retrieve an open tab's visible text in a single
  call, and the returned URL and title match what the person sees in that tab.
- **SC-003a**: A default read of a typical job-posting page returns a payload small enough to
  be practical for repeated use in an agent session — visible text only, within the 100 KB
  limit — with DOM structure returned only when explicitly requested.
- **SC-004**: The app writes zero page content to the shared data directory — after a session
  of opening and reading pages, the data directory contains no page text, verified by test.
- **SC-005**: Every blocklisted target category (submit control, in-form element, action-word
  labelled button/link, consent checkbox) is refused in 100% of test attempts, and the
  interaction log accounts for 100% of interaction requests with a permit/refuse outcome — so
  any external act that slipped through is detectable from the log alone.
- **SC-006**: The app issues zero automated authentication actions and never populates a
  credential field, verified by test.
- **SC-007**: A person unfamiliar with the code can watch the single window and correctly
  describe what the orchestrator did to a tab (navigate / click / fill / scroll), because
  each action is visible.
- **SC-008**: Bounded interactions (click, fill non-credential field, scroll,
  wait-for-selector) succeed on a standard dynamic page in at least 95% of attempts where the
  target element exists.
- **SC-008a**: Under a burst of simultaneous requests across multiple tabs, no more than one
  page load or interaction is ever in flight at once, and every queued request completes —
  verified by observing request timing across a multi-tab test.
- **SC-009**: Every defined error condition returns a distinct, actionable message; a review
  of error paths finds no silent failure and no generic catch-all message.
- **SC-010**: A read payload is self-sufficient — a caller that saves the payload and then
  disconnects from the network can reconstruct the page's visible text from it alone, matching
  what the person saw in the tab.

## Assumptions

- The shared data-directory path is already configured and known to the app (constitution
  Architecture Constraints). This feature reads that configuration; it does not define or
  prompt for it.
- Page content is retrieved and returned, never stored by this app. The calling agent decides
  what to keep. Constitution v1.1.0 reflects this: Principle V now assigns raw-capture
  preservation to the consuming orchestrator and requires HyppoVisor's read payloads to be
  verbatim and self-sufficient instead. business-logic.md §3.8 still carries the older
  unattributed wording; it is design-phase reference material, not a governed artifact.
- The app's own interaction log (FR-024a) is operational data about the app's behavior, not
  page content, and is unaffected by the above.
- The person logs into any site requiring authentication themselves, inside the app's
  embedded browser views. This feature does not implement a login flow; it relies on the
  in-app session persisting across the person's use.
- Exactly one orchestrator client connects to the control surface at a time. Multi-client
  arbitration is out of scope for this stage.
- "Any URL" means any `http`/`https` web page. Non-web schemes are rejected (FR-004).
- Per-site request budgets and inter-request delays are deferred to the later adapter stage
  (business-logic.md §3.8). This stage guarantees app-wide sequencing (FR-013) but sets no
  minimum pause between consecutive requests.
- Scheduling ("check my boards now", scheduled runs) is out of scope. This stage opens URLs
  only on explicit request.
- Job Record extraction, board adapters (list/fetch/parse), scoring, tiering, and the
  review-queue dashboard are explicitly out of scope for this stage — they layer on this
  primitive later.
- The app is a desktop application on the person's primary operating system. Mobile is out
  of scope.
- Tabs are live session state; there is no requirement to restore open tabs across app
  restarts in this stage.
- The orchestrator connecting to the control surface is HyppoGraph in normal use, but the
  surface is generic and does not depend on HyppoGraph (constitution Architecture
  Constraints).
