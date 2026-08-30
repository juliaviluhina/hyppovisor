# Contract: `interact` fill batch (feature 004)

The only interface change is to the existing `interact` tool. No new tool, no new
operation value. Tool count stays at six.

## Input schema

```
interact({
  tabId:     string,                                  // required
  operation: "click" | "fill" | "scroll" | "space",   // unchanged
  selector?: string,                                  // single fill / click
  value?:    string,                                  // single fill / scroll
  fields?:   Array<{ selector: string, value: string }>,   // NEW — batch fill
})
```

For `operation: "fill"`, the caller supplies **exactly one** of:

- `selector` + `value` — single fill (unchanged behaviour), or
- `fields` — batch fill (this contract).

Supplying both, or neither, → `BATCH_REJECTED` (malformed call). `fields` is ignored for
`click` / `scroll` / `space`.

`fields` length: **1 .. 50** (`config.batchFillCap`, env `HYPPO_BATCH_FILL_CAP`). Order is
significant — pairs are applied front to back; a repeated selector ends holding the last
value.

## Output — batch `permitted` / `partial`

```
{
  "tabId": "...",
  "operation": "fill",
  "outcome": "permitted" | "partial",
  "fields": [
    { "selector": "#first_name", "outcome": "permitted" },
    { "selector": "#phone", "outcome": "error", "message": "target element is gone" },
    ...
  ],
  "summary": { "requested": 5, "written": 4, "errored": 1 },
  "queueDepth": 0
}
```

- `outcome: "permitted"` ⇔ every field written (`errored === 0`).
- `outcome: "partial"` ⇔ `written >= 1 && errored >= 1`.
- `fields` has one entry per requested pair, in request order.
- `written + errored === requested === fields.length`.

## Output — batch `refused` (whole-batch, nothing written)

```
{ "error": {
    "code": "BATCH_REJECTED",
    "message": "2 target(s) refused; no fields were written.",
    "targets": [
      { "selector": "#password", "ruleId": "credential-field",
        "ruleDescription": "Target is a credential input; the app never fills credentials." },
      { "selector": "#resume", "ruleId": "unsafe-fill-type",
        "reason": "an <input type=\"file\">" }
    ]
} }
```

Plus `isError: true` on the tool result.

`targets` is present when the cause is one-or-more forbidden or unresolved targets.
It is **absent** when the cause is:

| Cause | `message` |
|-------|-----------|
| `fields.length === 0` | `"Batch fill requires at least one field."` |
| `fields.length > 50` | `"Batch fill accepts at most 50 fields; 63 supplied. Nothing was written."` |
| both `fields` and `selector`/`value` given, or neither | `"fill requires either (selector, value) or fields, not both."` |

## Behavioural contract

### Pre-write check (all-or-nothing)

Every target is resolved and evaluated with the **same** logic a single `fill` uses:

| Target | Result |
|--------|--------|
| resolves; plain value field / textarea / contenteditable / combobox filter input; matches no rule | eligible to write |
| does not resolve | offender, `reason: "no element matches"` → whole batch refused |
| matches `submit-control` / `consent-toggle` / `external-act-label` / `credential-field` | offender with that `ruleId` → whole batch refused |
| `<select>` / `role="listbox"` / combobox container / `<input type="file">` / checkbox / radio / button | offender, `ruleId: "unsafe-fill-type"` → whole batch refused |
| `in-form` | **never** an offender — `in-form` does not gate `fill` (inherited from 003) |

If **any** target is an offender: **zero** fields are written; the refusal lists **every**
offender (not just the first).

### Write phase (best-effort, only after the check passes)

- Each field is written in order: focus → clear → set via the native value setter → dispatch
  `input` + `change` → `blur` (skipped for a combobox filter input).
- A repeated selector is written again; last value wins.
- A field whose element was removed after the check → per-field `outcome: "error"` with a
  reason; the batch **continues** with the remaining fields.
- The batch never triggers navigation or form submission by the app.

### Audit (`interaction-log.jsonl`)

| Batch outcome | Log lines appended (in order) |
|---------------|-------------------------------|
| `permitted` | one `fill` line per field (`outcome: "permitted"`), then one `fill_batch` line (`outcome: "permitted"`, `batch` counts) |
| `partial` | one `fill` line per field (`permitted` or `error` + reason), then one `fill_batch` line (`outcome: "partial"`, `batch` counts) |
| `refused` (targets) | one `fill` line per offender (`outcome: "refused"`, `ruleId?` / `error: reason?`), then one `fill_batch` line (`outcome: "refused"`) — **no** `permitted` field line |
| `refused` (cap / empty / malformed) | one `fill_batch` line (`outcome: "refused"`) |

No page text ever appears in a log line — `target` is a selector or `null`.

## Non-goals (unchanged by this contract)

- No batch `click`, batch `space`, or mixed-operation batch.
- No rollback of already-written fields.
- No parallel writes; no retry of a stale selector.
- No `<select>` / react-select option selection (feature 006).
- No change to submit / consent / credential / file-input handling, or to `in-form`.
