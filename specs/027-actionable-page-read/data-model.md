# Data Model: Actionable Page Read

**Feature**: `027-actionable-page-read` | **Date**: 2026-09-21

Entities from spec §Key Entities, with fields, validation rules, and state transitions. All types live in `src/main/shared/types.ts` (additions only).

## 1. ActionableElement

One row of the indexed table. Snapshot-scoped: `index` is meaningless outside its `Snapshot`.

| Field | Type | Rules |
|---|---|---|
| `index` | integer ≥ 1 | Dense `1..N` in table order; stable within one snapshot only |
| `role` | string | Normalized control role (`button`, `link`, `combobox`, `textbox`, `checkbox`, …); first-match-wins mapping per `kindFor` precedent |
| `label` | string | Verbatim accessible name; may be empty only when no name source exists (then role is the fallback) |
| `value` | string \| null | Current value/state (field text, checked state, selected option); **omitted** for credential fields |
| `marker` | `actionable` \| `refused` | `refused` for credential / file-upload / consent / submit / outward-labelled controls (listed but never usable) |
| `operations` | string[] | Which `interact` operations could address it (e.g. `fill`, `click`, `choose_option`); empty when `marker` is `refused` |

Validation: every `actionable` entry MUST have a non-empty label-or-role and a resolvable target at execution time; any `refused` entry MUST have empty `operations`.

## 2. VisibleTextExtract

| Field | Type | Rules |
|---|---|---|
| `text` | string | Verbatim visible text within budget, document order |
| `truncated` | boolean | `true` iff text was cut; then `text` ends at a stated boundary and the cut is counted in `OmissionRecord` |

Validation: `truncated: false` ⟺ full meaningful text fit the budget.

## 3. RelevanceRanking (present only when a goal was supplied AND ranking succeeded)

| Field | Type | Rules |
|---|---|---|
| `order` | integer[] | Permutation of table indices, most-relevant first |
| `confidence` | number | Overall 0–1 confidence from the Jev response |
| `probabilities` | map index → number 0–1 | Per-candidate probabilities; sum ≈ 1 |

Validation: `order` covers exactly the offered indices; the top entry MUST be the response's `choice`. Low-confidence orderings are returned as-is (spec clarify Q3) — never suppressed.

## 4. RankingStatus (present whenever a goal was supplied)

| Value | Meaning |
|---|---|
| `ok` | `RelevanceRanking` present and fresh for this snapshot |
| `unavailable-missing-key` | No `TYPESAFE_API_KEY` in the environment (no request attempted, no retry) |
| `unavailable-request-failure` | Request attempted (incl. bounded retries) and failed, or response failed validation |

Validation: exactly one of `RelevanceRanking` (`ok`) or a reason is present; the tool call itself ALWAYS succeeds (payload-level status, never thrown).

## 5. OmissionRecord

| Field | Type | Rules |
|---|---|---|
| `hiddenNodes` | integer ≥ 0 | Excluded hidden/`aria-hidden`/disabled/offscreen/decorative nodes |
| `overBudgetElements` | integer ≥ 0 | Table entries dropped past the element/payload caps |
| `textTruncated` | boolean | Mirrors `VisibleTextExtract.truncated` |

Validation: all-zero omissions ⟺ nothing was excluded or cut.

## 6. Snapshot (top-level payload)

| Field | Type | Rules |
|---|---|---|
| `generation` | string | Opaque token binding table + text to one atomic capture (URL + DOM fingerprint); consumed by `interact` for stale rejection |
| `url`, `title` | string | Tab identity at capture time |
| `elements` | `ActionableElement[]` | The table; may be empty (pure-article pages) |
| `text` | `VisibleTextExtract` | |
| `ranking` | `RelevanceRanking` \| null | Null unless goal supplied and status is `ok` |
| `rankingStatus` | `RankingStatus` \| null | Null unless goal supplied |
| `omissions` | `OmissionRecord` | |

State transitions: `Snapshot` is immutable after creation. A later page mutation does not update it — consumers holding an old `generation` receive stale rejection on use (no transition, just invalidation).
