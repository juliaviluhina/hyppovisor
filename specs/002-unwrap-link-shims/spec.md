# Feature Specification: Unwrap Link-Shim URLs

**Feature Branch**: `002-unwrap-link-shims`

**Created**: 2026-08-29

**Status**: Draft

**Input**: User description: "Link-shim URL unwrapping for navigation. When open_url or navigate is given a known redirect-interstitial / link-shim URL (LinkedIn safety redirect, Google /url, l.facebook.com/l.php, out.reddit.com, Outlook safelinks), the app extracts the real destination from the wrapper's query parameter and opens that destination directly instead of the interstitial page, so an agent does not have to click a 'Continue' button (which the external-act blocklist would refuse anyway)."

## Overview

Several large sites route outbound links through a **redirect interstitial**: a page on their
own domain that carries the true destination in a query parameter and shows the visitor a
"You're leaving — Continue?" screen before forwarding them. LinkedIn
(`www.linkedin.com/safety/go/?url=…`), Google (`www.google.com/url?q=…`), Facebook
(`l.facebook.com/l.php?u=…`), Reddit (`out.reddit.com/?url=…`), and Outlook Safe Links
(`*.safelinks.protection.outlook.com/?url=…`) all do this.

When an agent follows an "Apply" or outbound link from a job posting, it lands on one of
these interstitials instead of the real page. The only way forward on the interstitial is a
**Continue** button — and HyppoVisor's external-act blocklist refuses that click, because it
looks like every other outward-action button. The agent is stuck one hop short of a page it
is fully permitted to read.

This feature lets the app recognize a known link-shim URL and open its **stated destination**
directly, skipping the interstitial. The destination is extracted from the wrapper's own
query parameter — no network request, no link-following, no guessing.

Boundaries set by the project constitution:

- **No external act (Principle I).** Reaching the destination is a `navigate` / `read`
  action, already permitted. An interstitial is a 1:1 redirect the browser would perform on
  its own for an HTTP 30x; unwrapping the query-param form of the same redirect is not a new
  capability and needs no Principle I amendment. No form is submitted; the Continue button is
  never clicked.
- **No interpretation (Principle II).** Unwrapping is a deterministic string transform on the
  URL. The app does not read or judge the destination page.
- **Comprehensible, enumerable (Principle III).** The set of recognized shims is a single
  table exposed through an accessor, mirroring `blocklist.ts` and `listBlocklistRules()`.
- **Only pages the person opened, no crawl (Principle V).** Unwrapping resolves the *identity*
  of the resource the caller already asked for; it does not discover or visit additional
  pages. Following meta-refresh or JavaScript redirects encountered *after* a page loads is
  explicitly out of scope because that set is not enumerable.

## Clarifications

### Session 2026-09-01

- Q: `open_url` and `navigate` write nothing to the interaction audit log today (only
  `interact` / `choose_option` / `wait_for_selector` do). Where should an unwrap be
  recorded? → A: A **dedicated audit entry with `operation: "unwrap"`**, written **only when
  a hop occurred** — `url` is the wrapper, `target` is the final destination, `outcome` is
  `"permitted"`, and a typed `unwrap: { hops }` field carries the hop count (mirroring the
  `batch` field feature 004 added). Ordinary navigations still write nothing (FR-011). This
  feature does **not** start logging every navigation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reach the destination behind a link shim (Priority: P1)

An agent calls `open_url` (or `navigate`) with a URL that is a known redirect interstitial —
for example a LinkedIn `safety/go` link found on a job posting's "Apply" button. Instead of
opening the interstitial and stalling at a Continue button it cannot click, the app extracts
the real destination from the wrapper's query parameter and opens that page directly. The
agent receives a tab already on the destination, ready to read.

**Why this priority**: This is the whole feature. Without it, every outbound link from
LinkedIn, Google results, Reddit, Facebook, and Outlook-delivered mail dead-ends at an
un-clickable interstitial, blocking the agent from pages it is otherwise allowed to read.

**Independent Test**: Call `open_url` with
`https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fjob-boards.greenhouse.io%2Facme%2Fjobs%2F123`
and confirm the resulting tab's final URL is the decoded Greenhouse URL, not a
`linkedin.com/safety` URL, and that the page content is the job posting.

**Acceptance Scenarios**:

1. **Given** a LinkedIn `safety/go` URL whose `url` parameter is an `https://` address,
   **When** the agent calls `open_url` with it, **Then** the app opens the decoded
   destination and the tab's reported URL is the destination, not the wrapper.
2. **Given** a Google `www.google.com/url?q=<https URL>` wrapper, **When** the agent calls
   `navigate` on an existing tab with it, **Then** that tab ends on the decoded `q` value.
3. **Given** an `l.facebook.com/l.php?u=<https URL>` wrapper, **When** opened, **Then** the
   tab ends on the decoded `u` value.
4. **Given** an `*.safelinks.protection.outlook.com/?url=<https URL>` wrapper, **When**
   opened, **Then** the tab ends on the decoded `url` value.
5. **Given** any successful unwrap, **When** it completes, **Then** the audit log contains one
   entry naming both the wrapper URL and the resolved destination.

---

### User Story 2 - Ordinary URLs are untouched (Priority: P1)

An agent calls `open_url` or `navigate` with a normal URL — including URLs that merely
*contain* a `url=` or `q=` query parameter but are not on a recognized shim host. The app
opens exactly what it was given. Behavior for the overwhelming majority of navigations is
unchanged.

**Why this priority**: A rewrite rule that fires too eagerly would silently send the agent to
the wrong page. The feature is only safe if it is inert for everything not on the known list.

**Independent Test**: Call `open_url` with `https://example.com/search?q=https://evil.test`
and confirm the tab opens `example.com/search?q=…`, unchanged.

**Acceptance Scenarios**:

1. **Given** a URL whose host is not in the shim table, **When** opened, **Then** the app
   opens the URL verbatim, even if it has a `url`/`q`/`u` parameter.
2. **Given** a URL on a shim host but a path that does not match that shim's path prefix
   (e.g. `www.google.com/maps?q=…`), **When** opened, **Then** the app opens it verbatim.
3. **Given** a URL on a shim host and matching path but with the expected parameter absent or
   empty, **When** opened, **Then** the app opens the wrapper URL verbatim (nothing to
   unwrap).
4. **Given** an ordinary navigation with no unwrap, **When** it completes, **Then** no
   unwrap-related audit entry is written.

---

### User Story 3 - Refuse non-web destinations, unwrap nested shims (Priority: P2)

The destination carried by a shim parameter is not always a safe `http(s)` page: it could be
a `javascript:` payload, a `data:` URI, a `mailto:`/`tel:` link, or another shim URL. The app
unwraps only to `http`/`https` destinations, follows a shim that points at another shim up to
a small fixed depth, and otherwise falls back to opening the wrapper as-is.

**Why this priority**: Correctness and safety hardening for the long tail. The P1 stories
cover the common case; this story bounds the dangerous and recursive cases.

**Independent Test**: Call `open_url` with a LinkedIn `safety/go` URL whose `url` parameter
is `javascript:alert(1)` and confirm the app does **not** navigate to a `javascript:` URL —
it opens the wrapper URL unchanged (or reports it cannot resolve), and writes no destination
to the log as if it were a real page.

**Acceptance Scenarios**:

1. **Given** a recognized shim whose extracted destination has a scheme other than `http` or
   `https`, **When** opened, **Then** the app does not navigate to that scheme; it opens the
   wrapper URL verbatim.
2. **Given** a recognized shim whose destination is itself a recognized shim wrapping an
   `https` page, **When** opened, **Then** the app resolves through both layers and opens the
   final `https` page.
3. **Given** a chain of shims deeper than the depth cap (3), **When** opened, **Then** the
   app stops unwrapping at the cap and opens the last URL it resolved, without looping.
4. **Given** a shim whose extracted destination is not a parseable absolute URL, **When**
   opened, **Then** the app opens the wrapper URL verbatim.

---

### Edge Cases

- **Double-encoded parameter**: the `url` value is percent-encoded once by the shim; a
  destination that itself contains a query string round-trips through one decode. Nested
  shims are handled by re-running the match on the decoded value (up to the depth cap).
- **Fragment on the wrapper** (`…/safety/go/?url=…#section`): the fragment belongs to the
  wrapper, not the destination, and is dropped on unwrap unless it is inside the encoded
  parameter value.
- **Parameter present more than once**: the first occurrence of the expected parameter name
  is used.
- **Shim host with `www.`/no-`www.` or regional variants** (`www.google.de/url`): host
  matching accounts for the documented variants for each shim; undocumented variants are not
  unwrapped (fall through).
- **Wrapper reached mid-load via a real HTTP redirect** rather than passed to a tool: out of
  scope — this feature only inspects the URL handed to `open_url` / `navigate`.
- **Unwrap produces a URL the app would otherwise reject** (non-`http(s)`, malformed): same
  fallback as a normal bad URL passed to the tool.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST maintain a table of recognized link-shim rules, each rule
  identifying a shim by host (including its documented variants), a path prefix, and the name
  of the query parameter that carries the destination.
- **FR-002**: The initial table MUST include: LinkedIn `www.linkedin.com` `/safety/go/`
  `url`; Google `www.google.com` (and documented regional `www.google.<tld>` variants)
  `/url` `q`; Facebook `l.facebook.com` / `lm.facebook.com` `/l.php` `u`; Reddit
  `out.reddit.com` `/` `url`; Outlook Safe Links `*.safelinks.protection.outlook.com` `/`
  `url`.
- **FR-003**: The app MUST expose the full shim table through an enumerable accessor
  analogous to the external-act blocklist's rule accessor, so the recognized set can be
  inspected and unit-tested.
- **FR-004**: Given a URL, the app MUST resolve it to a destination URL via a pure,
  deterministic transform: same input always yields the same output, with no network request
  and no dependency on page content or app state.
- **FR-005**: When the input URL matches a shim rule (host, path prefix) and the named
  parameter is present with a non-empty value, the app MUST decode that value and treat it as
  the candidate destination.
- **FR-006**: The app MUST unwrap only when the candidate destination is an absolute URL with
  an `http` or `https` scheme. For any other scheme (`javascript:`, `data:`, `mailto:`,
  `tel:`, etc.) or an unparseable value, the app MUST NOT navigate to the candidate and MUST
  fall through to opening the original input URL verbatim.
- **FR-007**: The app MUST re-apply the shim match to a resolved destination so that a shim
  wrapping another shim is fully unwrapped, up to a fixed depth cap of 3 iterations. At the
  cap, the app MUST stop and use the last successfully resolved URL, without infinite
  looping.
- **FR-008**: When the input URL does not match any shim rule, or matches the host but not
  the path prefix, or the named parameter is absent/empty, the app MUST open the input URL
  verbatim with no modification.
- **FR-009**: Link-shim unwrapping MUST apply to both the "open a URL in a new tab" operation
  and the "point an existing tab at a new URL" operation, with identical resolution behavior.
- **FR-010**: Whenever an unwrap changes the URL that is actually opened, the app MUST append
  exactly one entry to the interaction audit log with `operation: "unwrap"`, `outcome:
  "permitted"`, `url` set to the original wrapper URL, `target` set to the final resolved
  destination, and a typed `unwrap: { hops }` field carrying the hop count (analogous to the
  `batch` field on a `fill_batch` summary entry). This requires threading the interaction
  log into the "open a URL" and "point a tab at a URL" paths, which do not write to it today.
- **FR-011**: When no unwrap occurs, the app MUST NOT write any audit entry for the
  navigation — `open_url` / `navigate` remain unlogged in the no-unwrap case. This feature
  does not introduce general navigation logging.
- **FR-012**: The description of the "open a URL" tool MUST be updated: it currently states
  the tool "does not log in, submit, or follow links on its own"; it MUST now also state that
  it resolves known link-shim / redirect-interstitial URLs to their stated destination before
  opening.
- **FR-013**: Resolution MUST run before any existing URL validation, queueing, or
  navigation the tool already performs, so downstream steps act on the resolved destination.

### Out of Scope

- **Link shorteners** (`t.co`, `bit.ly`, `lnkd.in`, etc.): these do not carry the
  destination in the URL and require a network request to resolve. Not addressed here; such
  URLs open normally and follow their server redirect in the tab.
- **Meta-refresh and JavaScript (`location=`, `window.open`) redirects** encountered after a
  page loads: the set of pages that do this is not enumerable, and auto-following them would
  cross Principle V's no-crawl boundary. Not addressed.
- **Any change to the external-act blocklist**: the Continue button on an interstitial
  remains refused; this feature makes clicking it unnecessary, not permitted.

### Key Entities

- **Shim rule**: one recognized redirect interstitial. Attributes: matching host(s) and
  their variants, path prefix, destination parameter name. The collection is the shim table.
- **Unwrap result**: the outcome of resolving an input URL — the final URL to open, whether
  an unwrap occurred, and the number of hops. Drives both what is navigated to and what is
  logged.
- **Audit log entry**: a new `operation: "unwrap"` record in the existing interaction log —
  `url` = wrapper, `target` = resolved destination, `outcome: "permitted"`, plus a typed
  `unwrap: { hops }` field. It is the only audit line `open_url` / `navigate` ever produce,
  and only when a hop occurred.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For each shim in the initial table, an agent that calls the open/navigate
  operation with a valid wrapper URL lands on the decoded destination page with zero
  additional tool calls (no Continue click, no second navigation).
- **SC-002**: 100% of URLs whose host is not in the shim table are opened byte-for-byte
  unchanged, including URLs that carry a `url`/`q`/`u` query parameter.
- **SC-003**: 100% of shim URLs whose extracted destination is not an `http(s)` URL result
  in no navigation to that destination.
- **SC-004**: No shim chain, however constructed, causes more than 3 resolution iterations or
  a non-terminating loop.
- **SC-005**: Every unwrap that changes the opened URL produces exactly one
  `operation: "unwrap"` audit entry naming both the wrapper (`url`) and the destination
  (`target`) with the hop count; every navigation with no unwrap produces no audit entry at
  all.
- **SC-006**: The recognized shim set can be listed programmatically and every entry is
  covered by a unit test asserting its wrapper→destination transform.
- **SC-007**: The resolution function is pure — a test that runs it offline, with no app or
  browser context, passes for every table entry.

## Assumptions

- The five shims in FR-002 cover the redirect interstitials HyppoVisor's agent realistically
  encounters when following links from job postings and search results; more can be added to
  the table later without design change.
- A depth cap of 3 is sufficient for real nested shims (e.g. an Outlook Safe Link wrapping a
  LinkedIn safety link wrapping the real URL) while still bounding pathological input.
- The existing interaction audit log (`interaction-log.jsonl` in the app's `userData`
  directory) is the correct place to record unwrap events; a new log or store is not needed.
  The `open_url` / `navigate` paths do not currently write to it, so the plan threads the
  logger through and adds one `operation: "unwrap"` entry type (see Clarifications
  2026-09-01).
- Host-variant matching is handled per-rule (explicit variant lists or a documented pattern),
  not by a general public-suffix library.
- The wrapper URL's own fragment and extra parameters are not carried onto the destination;
  only the value of the named parameter defines the destination.
- Callers pass the wrapper URL directly to a tool. Wrappers arrived at through in-page
  redirects are not in scope and are unaffected.
