# Phase 1 Data Model: Batch Fill Operation for `interact`

No persistent data. In-memory structures, one config value, and additive audit-log fields.

## 1. `BatchFillField` (input)

`src/shared/types.ts` — one requested pair.

| Field | Type | Notes |
|-------|------|-------|
| `selector` | `string` | CSS selector, same acceptance as a single `fill` |
| `value` | `string` | full replacement value (clear-then-set) |

The batch input is `BatchFillField[]`, length **1..50** (`config.batchFillCap`), order
significant.

## 2. `BatchFieldResult` (per-field output)

| Field | Type | Notes |
|-------|------|-------|
| `selector` | `string` | echoes the requested selector |
| `outcome` | `"permitted" \| "error"` | `error` only from a write-time failure (pre-write offenders never reach this array) |
| `message` | `string?` | present iff `outcome === "error"` — the failure reason |

## 3. `BatchFillResult` (success / partial output)

Returned only when the pre-write check passed (batch outcome `permitted` or `partial`).

| Field | Type | Notes |
|-------|------|-------|
| `tabId` | `string` | |
| `operation` | `"fill"` | |
| `outcome` | `"permitted" \| "partial"` | `permitted` = every field written; `partial` = ≥1 written **and** ≥1 errored |
| `fields` | `BatchFieldResult[]` | one entry per requested pair, request order (FR-011) |
| `summary` | `{ requested: number; written: number; errored: number }` | `requested === fields.length`; `written + errored === requested` |
| `queueDepth` | `number` | as other `interact` results |

## 4. `BatchRejection` (whole-batch refusal — error payload)

`src/main/errors.ts`. Serialised via `HyppoError.toResult()` as
`{ error: { code, message, targets? } }`.

| Field | Type | Notes |
|-------|------|-------|
| `code` | `"BATCH_REJECTED"` | new `ErrorCode` value |
| `message` | `string` | human-readable; states the cap + count for over-cap, "no fields" for empty, the malformed-call reason, or "N target(s) refused" |
| `targets` | `Array<{ selector; ruleId?; ruleDescription?; reason? }>?` | present when the cause is one-or-more forbidden/unresolved targets; **absent** for cap / empty / malformed-call |

Per offender in `targets`:

| Field | Type | When |
|-------|------|------|
| `selector` | `string` | always |
| `ruleId` | `string?` | blocklist match (`submit-control` / `consent-toggle` / `external-act-label` / `credential-field` / `unsafe-fill-type`) |
| `ruleDescription` | `string?` | with `ruleId` |
| `reason` | `string?` | non-rule cause — `"no element matches"`, or the `unsafe-fill-type` detail |

`ErrorDetails` (in `errors.ts`) gains: `targets?: Array<{ selector: string; ruleId?: string; ruleDescription?: string; reason?: string }>`.

## 5. `ErrorCode` (extended)

`src/main/errors.ts`

```
"INVALID_URL" | "SCHEME_NOT_ALLOWED" | "LOAD_FAILED" | "TAB_NOT_FOUND"
| "TARGET_NOT_FOUND" | "WAIT_TIMEOUT" | "REFUSED_EXTERNAL_ACT"
| "BATCH_REJECTED"        // + new
```

## 6. `InteractionLogEntry` (extended)

`src/shared/types.ts`

| Field | Before | After |
|-------|--------|-------|
| `outcome` | `"permitted" \| "refused" \| "error"` | `+ "partial"` |
| `batch` | — | `+ optional { requested: number; written: number; errored: number; refused: number }` |

`operation` stays `string` — the batch-summary entry uses `"fill_batch"`; per-field entries
use `"fill"`.

### Entries a batch produces

| Situation | Entries appended, in order |
|-----------|---------------------------|
| `permitted` (all written) | one `{ operation:"fill", target:selector, outcome:"permitted" }` per field, then one `{ operation:"fill_batch", target:null, outcome:"permitted", batch:{requested,written,errored:0,refused:0} }` |
| `partial` | per field: `outcome:"permitted"` or `{ outcome:"error", error:reason }`; then `{ operation:"fill_batch", outcome:"partial", batch:{…} }` |
| `refused` (pre-write) | one `{ operation:"fill", target:selector, outcome:"refused", ruleId?, error:reason? }` per offender; then `{ operation:"fill_batch", target:null, outcome:"refused", batch:{requested, written:0, errored:0, refused:offenders} }`. No `permitted` field entry (FR-014). |
| `refused` (cap / empty / malformed) | just `{ operation:"fill_batch", target:null, outcome:"refused", batch:{requested, written:0, errored:0, refused:0} }` |

## 7. `config.batchFillCap`

`src/main/config.ts`

```
batchFillCap: numFromEnv("HYPPO_BATCH_FILL_CAP", 50)
```

## 8. MCP `interact` tool input (extended)

`src/main/mcp/tools.ts`

| Field | Change |
|-------|--------|
| `fields` | **new** — `z.array(z.object({ selector: z.string(), value: z.string() })).optional()` |
| dispatch | `operation === "fill" && fields?.length` → `fillBatch`; else single `interact` |
| validation | for `operation === "fill"`: exactly one of `fields` XOR (`selector` + `value`); violation → `BATCH_REJECTED` malformed-call |
| description | updated per FR-015 |

## 9. `resolveFillTarget` (new internal helper)

`src/main/page/interact.ts` — pure orchestration over existing pieces, shared by single
`fill` and `fillBatch`.

```
resolveFillTarget(wc, selector):
  Promise<
    | { ok: true;  descriptor: TargetDescriptor }
    | { ok: false; offender: { selector; ruleId?; ruleDescription?; reason? } }
  >
```

Order: `targetDescriptorScript` (null → `reason:"no element matches"`) →
`matchBlocklist(d, "fill")` (block → `ruleId` + `ruleDescription`) →
`isSafeFillTarget(d)` (`!ok` → `ruleId:"unsafe-fill-type"` + `reason`).
