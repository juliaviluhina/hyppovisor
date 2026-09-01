# Implementation Plan: Unwrap Link-Shim URLs

**Branch**: `002-unwrap-link-shims` (feature dir `specs/002-unwrap-link-shims`) |
**Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-unwrap-link-shims/spec.md`

## Summary

When `open_url` or `navigate` is given a known redirect-interstitial URL (LinkedIn
`/safety/go/`, Google `/url`, Facebook `/l.php`, Reddit `out.reddit.com`, Outlook Safe
Links), resolve it to the `http(s)` destination carried in the wrapper's query parameter
and open that instead — so an agent never dead-ends at a "Continue" button the blocklist
refuses.

Approach: one **pure module** `src/main/tabs/unwrap-url.ts` — an enumerable `SHIM_RULES`
table, `listShimRules()` accessor, and `unwrapUrl(raw): UnwrapResult` doing a deterministic
string transform (parse, match host + path prefix, read the named param, decode, re-match up
to a depth cap of 3, accept only `http`/`https`, else fall through to the input verbatim).
`TabManager.open()` and `TabManager.navigate()` call `unwrapUrl` as their **first** step —
before `validateUrl`, before `load()` — so every path (`open_url`, `navigate`, the person's
address bar, the e2e handle) resolves identically. When a hop occurred, `TabManager` writes
one `operation: "unwrap"` entry to the interaction log (`url` = wrapper, `target` =
destination, `unwrap: { hops }`); it writes nothing otherwise — this feature does **not**
start logging ordinary navigations. `TabManager` gains an `InteractionLog` constructor
dependency (the instance already exists in `index.ts`).

No new MCP tool, no new error code, no change to the external-act blocklist. `open_url`'s
description and the tool contract gain one sentence about link-shim resolution.

## Technical Context

**Language/Version**: TypeScript 5.7, Node ≥ 22, ESM for `src/main` / `src/shared`;
Electron 33.

**Primary Dependencies**: the platform `URL` / `URLSearchParams` (no parser library);
`node:fs` `appendFileSync` via the existing `InteractionLog`. **No new runtime
dependencies.** No public-suffix library (spec Assumptions — host variants are per-rule).

**Storage**: none new. One new entry *type* (`operation: "unwrap"`) in the existing
`interaction-log.jsonl` under `userData`. No page content, no shared-data-directory write
(Principle V).

**Testing**: `vitest` unit — `unwrap-url.test.ts`: every `SHIM_RULES` entry
wrapper→destination offline (SC-006, SC-007); non-shim host untouched incl. a `?url=` param
(SC-002); path-prefix mismatch and absent/empty param → verbatim (FR-008); non-`http(s)`
destination → verbatim, no navigation (SC-003); nested shim resolves through; a chain past
depth 3 stops without looping (SC-004); `listShimRules()` enumerable. `@playwright/test`
`_electron` integration — `open-url.spec.ts` (or a new `unwrap.spec.ts`): `open_url` with a
LinkedIn wrapper whose `url=` points at a local fixture → tab lands on the fixture, reported
`url` is the fixture; `navigate` likewise; the interaction log has exactly one
`operation: "unwrap"` entry on a hop and **none** on an ordinary open.

**Target Platform**: Electron desktop app (macOS primary; Windows/Linux build) + embedded
MCP HTTP/stdio server.

**Project Type**: Single project — existing `src/main/**` + `src/shared/**` + `tests/**`.

**Performance Goals**: `unwrapUrl` is ≤ 3 iterations of `new URL()` + `searchParams.get` +
`decodeURIComponent` — sub-microsecond, synchronous, offline. It runs once per
`open`/`navigate` before the existing work.

**Constraints**: pure and deterministic — same input → same output, no network, no page
content, no app state (FR-004). Runs before `validateUrl` (FR-013); the resolved
destination still passes through `validateUrl`, so `SCHEME_NOT_ALLOWED` / `INVALID_URL`
still guard as a second line behind FR-006's own `http`/`https` check.

**Scale/Scope**: 5 shim families in the initial table (LinkedIn, Google + a curated set of
`www.google.<tld>` variants, Facebook `l.` / `lm.`, Reddit, Outlook `*.safelinks…`). Depth
cap 3.

## Constitution Check

*GATE: passes before Phase 0; re-checked after Phase 1 — unchanged.*

### I. Human Does Every External Act (NON-NEGOTIABLE) — PASS

- Reaching the destination is a `navigate` / `read`, already permitted. Unwrapping the
  query-param form of a redirect is the same 1:1 hop the browser performs for an HTTP 30x —
  **no new capability**, so no Principle I amendment (unlike feature 011). The spec argues
  this in Overview; nothing since (1.3.x / 1.4.0 are form-interaction clauses) changes it.
- The interstitial's "Continue" button stays refused by the blocklist — untouched. This
  feature makes clicking it unnecessary, not permitted.
- `unwrapUrl` accepts only `http`/`https` destinations (FR-006); a `javascript:` / `data:` /
  `mailto:` payload in a shim param is never navigated to.

### II. Zero Business Logic in HyppoVisor — PASS

`unwrapUrl` is a string transform: parse, match a table row, read a named param, decode.
It does not fetch, read, score, or interpret the destination page.

### III. Solid and Comprehensible — PASS

- The recognized set is **one enumerable table** (`SHIM_RULES`) with a `listShimRules()`
  accessor, mirroring `blocklist.ts` / `listBlocklistRules()`. Nothing hidden.
- One new module, pure, no Electron import. No new store, service, daemon, or IPC channel.
- `TabManager` gains an `InteractionLog` constructor param — threading an **existing**
  instance one level, not a new mechanism. Called out here and at review.
- The only new persistent artefact is one entry *type* in a log that already exists; JSONL,
  append-only by construction.

### IV. User-Held Credentials and Sessions — PASS

No auth, no credential handling. The destination opens in the same session the tab already
uses. Nothing serialised.

### V. Assistive Pace, Not Bulk Collection — PASS

- Unwrapping resolves the **identity** of the resource the caller already asked for; it
  visits no additional page and follows no post-load redirect (meta-refresh / JS redirects
  are explicit non-goals — that set is not enumerable).
- No crawl: one caller request → one resolved URL → one tab load, exactly as today.
- No page content is read or written. The audit entry names two URLs and a hop count —
  operational data about the app's behaviour, the same class as every other log line.

### Architecture Constraints — PASS

`hyppovisor` gains no dependency on `hyppograph`. MCP contract unchanged (same tools, same
params). Shared data directory and provenance log untouched (a navigation produces no
provenance entry; an unwrap produces none either — only the interaction log).

## Project Structure

### Documentation (this feature)

```text
specs/002-unwrap-link-shims/
├── plan.md              # This file
├── research.md          # Phase 0 — R1–R5
├── data-model.md        # Phase 1 — SHIM_RULES row, UnwrapResult, the log entry delta
├── quickstart.md        # Phase 1 — the LinkedIn-wrapper walkthrough as acceptance
├── contracts/
│   └── mcp-tools-002-delta.md   # Phase 1 — open_url / navigate description + behaviour delta
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/main/tabs/
├── unwrap-url.ts          # NEW — SHIM_RULES table, listShimRules(), unwrapUrl(raw):
│                          #   UnwrapResult. Pure, no Electron import (like url-policy.ts).
├── tab-manager.ts         # open() / navigate(): call unwrapUrl(rawUrl) FIRST, before
│                          #   validateUrl; on hops > 0 write one { operation: "unwrap" }
│                          #   log entry. Constructor gains an InteractionLog param.
└── url-policy.ts          # unchanged — validateUrl still runs on the resolved URL

src/main/
└── index.ts               # pass the existing `log` into `new TabManager(win, events, log)`

src/main/mcp/
└── tools.ts               # open_url description: + "resolves known link-shim / redirect-
                           #   interstitial URLs to their stated destination before opening."

src/shared/
└── types.ts               # InteractionLogEntry: + `unwrap?: { hops: number }` (like `batch`)

tests/
├── unit/
│   └── unwrap-url.test.ts # NEW — every table entry; non-shim untouched; path/param misses;
│                          #   non-http destination; nested; depth cap; listShimRules()
├── integration/
│   └── open-url.spec.ts   # + open_url / navigate with a shim wrapper → lands on the
│                          #   destination; one "unwrap" log entry on a hop, none otherwise
└── fixtures/
    └── static.html        # reused as the unwrap destination (no new fixture needed)

specs/001-open-any-url/contracts/mcp-tools.md   # open_url description + a "Link-shim
                                                #   resolution" note; new log entry type
docs/tools.md                                   # open_url line + the shim list
README.md                                       # "what it does" / open_url mention if present
```

**Structure Decision**: Single project, existing layout. `unwrap-url.ts` sits beside
`url-policy.ts` — both are pure, Electron-free, unit-tested transforms that
`tab-manager.ts` composes. The one-file-per-guarantee convention holds: the shim set lives
in exactly one module with one accessor.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| `TabManager` gains an `InteractionLog` constructor dependency | The clarified design (2026-09-01) records an unwrap as a dedicated `operation: "unwrap"` audit entry, and `open` / `navigate` are the single choke point that covers every caller (MCP tools, the address bar, the e2e handle). | Logging in each caller (`tools.ts` handlers + the `chrome:open-url` IPC + the `__hyppo` handle): rejected — three call sites, easy to miss one, and the person's address-bar open would silently skip the audit. Returning the `UnwrapResult` up and logging in `index.ts`: rejected — same fan-out, and `TabManager` is where the URL is actually swapped. |
