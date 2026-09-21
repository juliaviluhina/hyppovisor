# MCP Contract: `read_actionable` (proposed name)

**Feature**: `027-actionable-page-read` | **Date**: 2026-09-21

Companion to `specs/001-open-any-url/contracts/mcp-tools.md` (to be amended at implementation). Read-only; goes through the app-wide action queue like all tools; errors use named codes; ranking problems are payload status, never errors.

## Tool name

`read_actionable` (proposed; finalized at implementation if a naming conflict emerges).

## Description (MCP annotation)

> Snapshot one tab's actionable elements as an indexed table plus its meaningful visible text, in a single read-only call. Pass `goal` to add Jev relevance ordering over the table. Acts on nothing; indices are valid for this snapshot only and go stale if the page changes. Ranking needs the user's `TYPESAFE_API_KEY`; when ranking is unavailable the snapshot still returns with an explicit ranking status.

## Input schema

| Field | Type | Required | Rules |
|---|---|---|---|
| `tabId` | string | yes | Existing tab id (same identity rules as `read_page`) |
| `goal` | string | no | Natural-language task used only for relevance ordering; absent → unranked snapshot, no Jev call, no `rankingStatus` |
| `budgets` | object | no | Optional per-call caps; each capped above by the server-side maxima from config |

Unknown tab → existing `TAB_NOT_FOUND` named error (same as other tab tools). Invalid input shape → existing validation error path.

## Output (success — always, including ranking failure)

```json
{
  "generation": "opaque-token",
  "url": "https://…",
  "title": "…",
  "elements": [
    { "index": 1, "role": "textbox", "label": "Where to?", "value": "", "marker": "actionable", "operations": ["fill", "click"] },
    { "index": 2, "role": "button", "label": "Search", "value": null, "marker": "refused", "operations": [] }
  ],
  "text": { "text": "…verbatim…", "truncated": false },
  "ranking": { "order": [1], "confidence": 0.91, "probabilities": { "1": 0.91 } },
  "rankingStatus": "ok",
  "omissions": { "hiddenNodes": 12, "overBudgetElements": 0, "textTruncated": false }
}
```

- `ranking` / `rankingStatus` are `null` when no `goal` was supplied.
- `rankingStatus: ok` ⟺ `ranking` present. Otherwise the snapshot is unranked and `rankingStatus` is `unavailable-missing-key` or `unavailable-request-failure`.
- `value` is omitted for credential fields. `operations` is empty exactly when `marker` is `refused`.
- No audit-log entry is written for the read (derivation precedent: `read_form_fields` FR-014). Nothing is persisted.

## Named errors (transport-level only)

| Code | When |
|---|---|
| `TAB_NOT_FOUND` | Unknown/closed tab |
| `TAB_UNAVAILABLE` | Tab exists but content cannot be captured (existing read-path semantics) |
| `INTERNAL` | Unexpected failure (existing `fail()` envelope) |

Ranking failure is NEVER one of these — it is `rankingStatus` inside a success payload (FR-010).

## Using indices with `interact`

Out of scope for this contract's implementation order, but fixed here so both tools agree: an `interact` call addressing a `read_actionable` index resolves it against the snapshot `generation` and re-validates the live target (connected, visible, enabled, same role/label). Mismatch → stale rejection via the existing error path; the position is never reinterpreted.
