# Feature Specification: Recent-URLs Dropdown

**Feature Branch**: `plan-009-recent-urls-dropdown`

**Created**: 2026-08-30

**Status**: Draft

**Input**: User description: "Recent-URLs dropdown on the Open control. From
specs/issues/003-recent-urls-dropdown.md. The top-bar address input is a plain text field;
once a tab is opened the URL is not remembered anywhere the person can get at it, so
reopening yesterday's page means retyping it in full. Keep a short history of the last ~20
opened URLs and offer them as a dropdown on the address input."

## Context

HyppoVisor's top bar has an address input the person types a URL into to open a tab. It has
no memory: every visit is typed or pasted in full, even for a page opened five minutes ago.
This feature adds a short, local, most-recent-first history of URLs the person opened and
surfaces it as a dropdown on that same input — no new control, no change to the Open button.

The history is convenience data the person authored by the act of opening pages. It stores
no page content, performs no external act, and adds one small human-readable file to the
app's existing local settings area.

## Clarifications

### Session 2026-08-30

- Q: How should the history decide two URLs are the same for dedupe? → A: **Exact string**,
  after the address bar's normal URL validation. No trailing-slash folding, no tracking-
  parameter stripping.
- Q: Does this version ship an in-app way to clear the history? → A: **Yes** — a small
  "clear recent URLs" action on an app settings surface (the connection panel), in addition
  to deleting the file by hand.
- Q: The history cap — fixed at 20? → A: **Yes, fixed at 20** (a hidden override exists for
  tests only; no settings UI for it).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reopen a recent URL without retyping it (Priority: P1)

The person clicks into the address input and sees a dropdown of URLs they opened recently,
most recent first. They pick one (or type a few characters to filter the list) and open it
without typing the whole address.

**Why this priority**: This is the entire point of the feature — it removes the "retype
yesterday's URL from memory" chore. Everything else is a property of the list that makes
this reliable.

**Independent Test**: Open two different URLs from the address input. Click back into the
input: both appear in the dropdown, most-recent first. Select the older one — it opens.
Type a substring of one — the list narrows to matches.

**Acceptance Scenarios**:

1. **Given** the person has opened `https://a.example` then `https://b.example` from the
   address input, **When** they focus the empty address input, **Then** the dropdown shows
   both, with `https://b.example` first.
2. **Given** the dropdown is showing, **When** the person selects an entry and triggers
   Open, **Then** a tab opens at that URL exactly as if they had typed it.
3. **Given** the dropdown is showing, **When** the person types `b.ex`, **Then** only
   entries containing that text remain visible.
4. **Given** no URL has ever been opened, **When** the person focuses the address input,
   **Then** the dropdown is empty (or does not appear) and typing still works normally.

---

### User Story 2 - The list stays short, current, and ordered across sessions (Priority: P2)

The history is capped, deduplicated, ordered most-recent-first, and survives quitting and
reopening the app.

**Why this priority**: Without persistence the feature is nearly worthless (the common case
is "the page I had open yesterday"). Without the cap/dedupe/order rules the list becomes a
long, repetitive scroll that is slower than typing.

**Independent Test**: Open more than the cap's worth of distinct URLs; confirm the list
holds only the most recent cap-many. Re-open one that is already in the list; confirm it
moves to the front and appears once, not twice. Quit and relaunch; confirm the list is
unchanged.

**Acceptance Scenarios**:

1. **Given** the history already holds the maximum number of entries, **When** the person
   opens a new distinct URL, **Then** the oldest entry is dropped and the new one is at the
   front.
2. **Given** `https://a.example` is somewhere in the list, **When** the person opens
   `https://a.example` again, **Then** it appears once, at the front, and the list is not
   longer than before.
3. **Given** a history of several entries, **When** the app is quit and relaunched, **Then**
   the dropdown shows the same entries in the same order.
4. **Given** the history file is absent or unreadable at launch, **When** the app starts,
   **Then** it starts with an empty history and does not error.
5. **Given** two windows / a re-render, **When** a URL is added, **Then** the dropdown
   reflects the new entry without needing a manual refresh.
6. **Given** a non-empty history, **When** the person triggers "clear recent URLs" on the
   settings surface, **Then** the dropdown is empty immediately, the history file is left
   valid and empty, and no other setting changes.

---

### User Story 3 - The list is the person's own intentional history (Priority: P3)

Only URLs the person themselves opened, and only ones that actually loaded, enter the
history. Agent-driven opens and failed loads do not.

**Why this priority**: A dropdown the person uses to navigate should reflect their own
intent. Filling it with every page an orchestrator touched, or with mistyped URLs that
404'd, makes it noise. Lower priority because the feature is still useful without this
filter — it just gets cluttered.

**Independent Test**: Have the agent open a URL via its tools; confirm it does **not** enter
the history. Type a URL that fails to load; confirm it does **not** enter the history. Open
a good URL yourself; confirm it does.

**Acceptance Scenarios**:

1. **Given** the agent opens `https://agent-only.example` through its own tools, **When**
   the person focuses the address input, **Then** that URL is not in the dropdown.
2. **Given** the person opens a URL that fails to load, **When** they focus the address
   input, **Then** that URL is not in the dropdown.
3. **Given** the person opens a URL that loads successfully, **When** they focus the address
   input, **Then** that URL is in the dropdown.
4. **Given** the person clicks a link in a page that opens as a new tab, **When** that tab
   loads, **Then** that URL enters the history (the person initiated it).

---

### Edge Cases

- **The same URL differing only by a trailing slash / fragment / query order** — treated per
  the dedupe key (see Assumptions); the spec's default is exact-string match after the
  address bar's normal URL normalization, so `https://x.example` and `https://x.example/`
  may both appear. `/speckit-clarify` may tighten this.
- **A very long URL** — stored and shown; the dropdown row may be visually truncated by the
  platform but the full value is what gets opened.
- **A URL the person opened, then the page redirected** — the history records the address
  the person entered, not the post-redirect landing URL (that is what they would retype).
- **History file hand-edited to malformed JSON while the app runs** — the next write
  overwrites it cleanly; a read at launch that fails falls back to empty.
- **History file present but holds a non-array / entries that are not strings** — treated as
  unreadable → empty history, not a crash.
- **Rapidly opening many tabs** — each successful person-open updates the history; the cap
  and dedupe keep it bounded regardless of rate.
- **Private / sensitive URL in history** — it persists in a plain local file until evicted
  by the cap, cleared via the connection-panel action (FR-013), or the file is deleted by
  hand.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The address input MUST offer a dropdown of previously-opened URLs, shown when
  the input is focused and filtered as the person types, using the platform's native
  input-suggestion behavior (no custom popup).
- **FR-002**: Selecting a dropdown entry MUST populate the input with that URL so the
  existing Open action opens it unchanged. The feature MUST NOT itself open, navigate, or
  submit anything.
- **FR-003**: A URL MUST be added to the history when a tab **the person opened** reaches a
  successfully-loaded state. A tab opened by the agent, and a tab whose load failed, MUST
  NOT add to the history.
- **FR-004**: A person-initiated open includes: entering a URL in the address input, and a
  link in a page that the person clicked which opens as a new tab. It excludes the agent's
  open / navigate tools.
- **FR-005**: The history MUST be ordered most-recent-first. Re-opening a URL already in the
  history MUST move it to the front and MUST NOT create a duplicate entry.
- **FR-006**: The history MUST be capped at a fixed maximum of 20 entries; adding a new
  distinct URL beyond the cap MUST evict the oldest.
- **FR-007**: The history MUST persist across app restarts in a single human-readable local
  file in the app's user-data area, written so an interrupted write cannot corrupt it, and
  safe for the person to delete by hand.
- **FR-008**: At launch, a missing, unreadable, or schema-invalid history file MUST yield an
  empty history without error and without rewriting the file until the next legitimate
  update.
- **FR-009**: The dropdown MUST reflect a newly-added URL without the person manually
  reloading or re-focusing — a live update.
- **FR-010**: The history MUST contain only URLs (strings). It MUST NOT store page titles,
  page content, timestamps of visits beyond what ordering needs, or any data the person did
  not cause by opening a page.
- **FR-011**: The history file MUST be added to the app's documented inventory of what it
  writes to the user-data area, alongside the existing settings and interaction-log files.
- **FR-012**: The feature MUST NOT alter the Open control, the address input's typing/paste
  behavior, tab opening, or any agent-facing behavior.
- **FR-013**: An app settings surface (the connection panel) MUST offer a "clear recent
  URLs" action that empties the history immediately, updates the dropdown live (FR-009), and
  leaves the now-empty history file in a valid state. It MUST NOT require an app restart and
  MUST NOT affect any other setting.

### Key Entities

- **Recent-URL history**: an ordered list of URL strings, most-recent-first, length ≤ 20,
  no duplicates. Persisted as one local file. The only writer is a successful person-open;
  the only readers are the address-input dropdown and anyone inspecting the file.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After opening a URL from the address input, the person can re-open that exact
  URL on a later day in at most two interactions (focus the input, pick the entry) with zero
  characters typed.
- **SC-002**: The dropdown never shows more than 20 entries and never shows the same URL
  twice.
- **SC-003**: A URL opened by the person and successfully loaded appears in the dropdown
  within one second of the page loading, in the same session, with no manual refresh.
- **SC-004**: A URL opened only by the agent, and a URL whose load failed, never appear in
  the dropdown.
- **SC-005**: History entries and their order are identical before and after an app restart.
- **SC-006**: Deleting the history file returns the dropdown to empty on next launch with no
  other effect on the app.
- **SC-007**: With the feature present, opening a URL, opening a tab via the agent, and all
  existing top-bar behaviors are unchanged from before (no regression).

## Assumptions

- **Scope of recording** (issue decision 1): **person-initiated opens only**, keyed off the
  existing per-tab "who opened this" marker (`person` vs `orchestrator`). Rationale: the
  dropdown is a navigation aid for the person; agent traffic would swamp it. `/speckit-clarify`
  may revisit.
- **Cap** (decision 2): **fixed at 20**, not user-configurable. A hidden override exists for
  tests but there is no settings UI for it. Rationale: keeps the feature tiny; 20 covers
  "recently" without a scroll.
- **Dedupe key** (decision 3): **exact URL string** after the address bar's existing URL
  validation. Tracking-parameter stripping and trailing-slash folding are **not** done —
  they are a judgment call that can surprise (Principle II keeps interpretation out of
  HyppoVisor). Confirmed in the clarify session.
- **Privacy / clear affordance** (decision 4): **an in-app "clear recent URLs" action** ships
  on the connection panel (FR-013), in addition to deleting the history file by hand.
- **Failed loads** (decision 5): **excluded** — only a tab reaching the loaded state
  records. Rationale: a 404 from a typo is not something the person wants to re-pick.
- **Ordering on re-open** (decision 6): **move to front**. Rationale: most-recently-used is
  the useful order for a navigation shortlist.
- **Redirects**: the history stores the URL the person entered, not the redirected landing
  URL — that is what they would type again.
- **Constitution**: none of Principles I–V is affected. The history is local convenience
  data the person authored, involves no external act, keeps everything in the one window,
  and stores no page content. The plan's Constitution Check states this and lists the new
  history file in the user-data-writes inventory (Architecture Constraints / "shared data
  directory" note: this file is in the app's own user-data area, not the shared data
  directory, matching `settings.json` and `interaction-log.jsonl`).

## Dependencies

- Builds on the existing top-bar address input and Open action, the per-tab
  person-vs-agent open marker, the tab load-state lifecycle, and the preload bridge / IPC
  pattern used by the connection panel (feature 007).
- Reuses the atomic-write persistence pattern of the existing settings file.
- Full background: `specs/issues/003-recent-urls-dropdown.md`.
