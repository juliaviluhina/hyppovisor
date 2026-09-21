# Quickstart: Actionable Page Read

**Feature**: `027-actionable-page-read` | **Date**: 2026-09-21

Validation guide proving the feature works end-to-end. No implementation code here — see [contract](contracts/read-actionable.md) and [data model](data-model.md) for shapes.

## Prerequisites

- HyppoVisor built from branch `027-actionable-page-read` (`npm run build`), running with a per-project instance.
- MCP registered (`hyppovisor-<slug>`), `list_open_tabs` answering.
- For ranked scenarios: `TYPESAFE_API_KEY` set in the app's environment (user's own TypeSafe account).

## Scenario 1 — Unranked snapshot replaces two reads (P1)

1. `open_url` a content-heavy signed-in page with 30+ controls.
2. Call `read_actionable` with `{ "tabId": "<id>" }` (no `goal`).
3. Expect: one payload with an indexed element table + visible text; every visible enabled control present; hidden/disabled/offscreen controls absent; `omissions` accounting for them; `ranking`/`rankingStatus` null.
4. Compare byte size against `read_page` + `read_form_fields` on the same tab — expect roughly half or less (SC-002).

## Scenario 2 — Goal-ranked targets (P2)

1. Same page; call `read_actionable` with `{ "tabId": "<id>", "goal": "fill the destination field" }`.
2. Expect: same snapshot plus `rankingStatus: ok` and the destination field ranked first with confidence (SC-001 sample: repeat across 10 varied pages/goals, ≥ 9 first-rank hits).
3. Repeat with an unsatisfiable goal — expect the ordering returned with low confidence (never suppressed), letting the caller judge.
4. Unset `TYPESAFE_API_KEY`, restart the instance, repeat — expect the unranked snapshot with `rankingStatus: unavailable-missing-key` and NO error.
5. With the key set but the network blocked — expect `rankingStatus: unavailable-request-failure` after bounded retries, still NO error/throw.

## Scenario 3 — Draft-safe boundaries (P3)

1. `open_url` a form containing plain fields plus a submit control and a credential field.
2. Snapshot shows the submit control with `marker: refused` / empty `operations`, and the credential field with no value.
3. `interact` against the submit index → existing refusal, unchanged.
4. Navigate the tab elsewhere, then `interact` against an old index → stale rejection, nothing applied to the new page (SC-004: zero refusal bypasses).

## Scenario 4 — Determinism and edge pages

1. Call twice on an unchanged page — expect identical indices and ordering (SC-003: 10/10).
2. Pure-article page (no controls) — expect empty `elements`, full text, zero omissions.
3. Oversized page — expect explicit `overBudgetElements` / `textTruncated: true`, never silent drops.

## Commands

```bash
npm test          # unit incl. new actionable tests — $0, offline
npm run harness   # model-backed checks where applicable — $0
npx playwright test # e2e fixture scenarios (where added)
```
