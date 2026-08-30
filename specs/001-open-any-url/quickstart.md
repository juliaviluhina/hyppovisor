# Quickstart: Open Any URL

**Feature**: 001-open-any-url | **Date**: 2026-08-29

How to run the app and prove the feature works end to end. Tool shapes are in
[contracts/mcp-tools.md](./contracts/mcp-tools.md).

## Prerequisites

- Node 22+, npm
- macOS (primary target; other platforms build but are unverified here)
- Claude Code, for driving the MCP surface by hand

## Setup

```bash
npm install
npm run build
```

## Run the app standalone

```bash
npm start
```

The window opens with a tab strip and an address bar. Type a URL to confirm US1 without any
orchestrator attached. Log into any site you want available to later reads — sessions persist
in the app's own profile.

## Connect an orchestrator

The app is launched *by* the MCP client over stdio (see research.md R2), so register it:

```bash
claude mcp add hyppovisor -- node /absolute/path/to/dist/main/index.js
```

Then in a Claude Code session, ask it to call the tools. Starting the client starts the app.

## Validation scenarios

Each maps to a user story and its acceptance scenarios in [spec.md](./spec.md).

### 1. Open and read (US1, US2)

1. `open_url` with `https://example.com` → returns a `tabId`, final URL, and title; the page is
   visible in the window.
2. `read_page` with that `tabId` → returns visible text matching what you see, no `dom` field.
3. `read_page` again with `includeDom: true` → `dom` now present.

**Expected**: text is verbatim. Check the shared data directory — it must contain **no page
content** (SC-004).

### 2. Authenticated session (US1 scenario 2)

1. Log into a site manually in the app.
2. `open_url` to a page on that site requiring auth.

**Expected**: page renders logged in; the app raises no login prompt of its own.

### 3. Bounded interaction (US3)

1. Open a page with a "show more" control.
2. `wait_for_selector` for it, then `interact` with `click`.
3. `read_page` → revealed content is present.

**Expected**: click permitted, new content readable.

### 4. External act refused (US3 scenario 4, SC-005)

1. Open a page containing a form with a submit button.
2. `interact` with `click` on the submit button.

**Expected**: `REFUSED_EXTERNAL_ACT` naming the matched `ruleId`. Nothing is submitted.
Repeat for a `fill` on a password field → refused (FR-018).

### 5. Audit trail (FR-024a)

After scenarios 3 and 4, open `interaction-log.jsonl` in the app's `userData` directory.

**Expected**: one line per interaction, permitted and refused alike, each with tab, operation,
target, URL, timestamp, and outcome. Refusals carry `ruleId`. No page text anywhere in the log.

### 6. App-wide sequencing (SC-008a)

Open several tabs, then issue reads/opens for all of them at once.

**Expected**: timestamps show no overlap — one in flight at a time. Every request completes;
none is dropped. `queueDepth` shows requests were queued, not stalled (FR-013a).

### 7. Errors are distinct (FR-014, SC-009)

| Call | Expected code |
|---|---|
| `open_url` with `file:///etc/hosts` | `SCHEME_NOT_ALLOWED` |
| `open_url` with `not-a-url` | `INVALID_URL` |
| `read_page` with an unknown `tabId` | `TAB_NOT_FOUND` |
| `read_page` after the person closes that tab | `TAB_NOT_FOUND` |
| `wait_for_selector` for a selector that never appears | `WAIT_TIMEOUT` |
| `interact` click on a missing selector | `TARGET_NOT_FOUND` |

### 8. Truncation is visible (FR-021)

`read_page` on a page whose visible text exceeds 100 KB.

**Expected**: `truncated.text === true`; the payload says so rather than silently clipping.

## Automated tests

```bash
npm test              # Vitest: url-policy, blocklist, queue, truncation
npm run test:e2e      # Playwright _electron: scenarios 1, 3, 4, 6, 7 against local fixtures
```

Integration tests run against fixture pages served from disk — offline, deterministic, and no
live-site traffic, consistent with Principle V.
