# Data Model: Copy Instance Settings

**Feature**: `028-copy-instance-settings` | **Date**: 2026-09-21

Entities from spec §Key Entities, with fields, validation rules, and state transitions. Additions to `src/shared/types.ts` only.

## 1. RowSettings (per-list-row settings assembly)

| Field | Type | Rules |
|---|---|---|
| `serverName` | string | `hyppovisor` for empty label, else `hyppovisor-<label>` (research.md R3) |
| `transport` | `"http"` \| `"stdio"` | From the row's effective port (`null` ⇒ stdio) |
| `port` | number \| null | Effective port from runtime file; `null` for stdio rows |
| `tokenRequired` | boolean | From the profile's settings; `false` ⇒ no token involved |
| `token` | string \| null | The profile's persisted token; `null` when auth off |
| `state` | `"live"` \| `"unreachable"` \| `"unavailable"` | `live` = responding now; `unreachable` = last-known (FR-005); `unavailable` = files unreadable, no copy offered (clarify Q2) |
| `authNote` | string \| null | Human note when auth is off (clarify Q1); `null` otherwise |

Validation: `transport === "http"` ⟺ `port` is a valid port; `tokenRequired === true` and `state === "live"` with `token === null` is invalid (auth on without a token ⇒ `unavailable`); `state === "unavailable"` ⟺ no copy blocks are produced.

## 2. SettingsBlocks (copyable output per row)

| Field | Type | Rules |
|---|---|---|
| `command` | string | `claude mcp add …` verbatim-runnable; stdio rows carry the stdio launch command |
| `json` | string | Valid `mcpServers` JSON block; parses without edits |
| `authNote` | string \| null | Mirrors `RowSettings.authNote` so the pasted context explains a missing header |

Validation: `json` MUST parse as JSON; `command` for an HTTP row MUST contain the endpoint URL and — when auth is on — the `Authorization` header; neither block may name a different instance (server-name match).

## 3. Liveness State (extends the existing row state)

Existing `InstanceSummary.state` (`responding` / `not-responding` / `stdio`) maps to `RowSettings.state`: `responding` ⇒ `live`; `not-responding` ⇒ `unreachable` (last-known settings, marked); unreadable files ⇒ `unavailable` regardless of probe outcome. No transition beyond display-time derivation — states are computed per render, never stored.
