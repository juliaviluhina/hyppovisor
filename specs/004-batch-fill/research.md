# Phase 0 Research: Batch Fill Operation for `interact`

No open `NEEDS CLARIFICATION` markers — the spec's `## Clarifications` session locked the
three load-bearing decisions (hybrid pre-write check + best-effort write; cap 50;
`permitted` / `partial` / `refused` outcome vocabulary). The items below record the design
choices the plan depends on.

## R1 — How the batch is expressed on the MCP surface

**Decision**: `interact`'s zod input gains
`fields: z.array(z.object({ selector: z.string(), value: z.string() })).optional()`.
A call is a **batch** when `operation === "fill"` and `fields` is present and non-empty.
`tools.ts` enforces *exactly one of* `{ fields }` XOR `{ selector, value }` for
`operation === "fill"`; supplying both, or neither, is a `BATCH_REJECTED` malformed-call
refusal (FR-001). `operation` stays the four-value enum — no `fill_batch` value.

**Rationale**: Matches the spec's framing ("an alternative to a single target + value")
and FR-016 (operation set unchanged). One dispatch branch in `tools.ts`.

**Alternatives considered**: A 5th operation `fill_batch` — rejected, larger surface, and
the spec treats batch/single as two input forms of one operation. A separate `interact_batch`
tool — rejected, Principle III (tool count fixed).

## R2 — Where the batch logic lives, and the shared per-target check

**Decision**: New export `fillBatch(wc, log, tabId, fields): Promise<BatchFillResult>` in
`src/main/page/interact.ts`. Extract the per-target resolve+verdict logic currently inline in
`interact()`'s `fill` branch into:

```
resolveFillTarget(wc, selector):
  Promise<{ ok: true; descriptor } | { ok: false; offender: { selector; ruleId?; ruleDescription?; reason? } }>
```

- resolves the descriptor via `targetDescriptorScript` (null → offender with
  `reason: "no element matches"`)
- `matchBlocklist(descriptor, "fill")` → offender with `ruleId` + `ruleDescription` on a
  block
- `isSafeFillTarget(descriptor)` → offender with `ruleId: "unsafe-fill-type"` +
  `reason` on `!ok`

Single `fill` calls this too (behaviour identical; just deduplicated). `fillBatch`:

1. cap / empty check (FR-003)
2. `resolveFillTarget` for **every** pair; collect offenders
3. any offender → log one `refused` entry per offender + one `fill_batch` summary entry
   (`outcome: "refused"`), throw `HyppoError("BATCH_REJECTED", …, { targets })` — **zero**
   writes (FR-005)
4. otherwise, for each pair in order: run `fillScript(selector, value)` in a try/catch;
   success → per-field `permitted` + one audit entry; throw → per-field `error` + reason +
   one audit entry; **continue** (FR-008)
5. batch outcome: `permitted` if all written, else `partial`; one `fill_batch` summary
   entry with counts; return `BatchFillResult`

**Rationale**: Keeps the single-`fill` path byte-for-byte equivalent, isolates the new code,
and guarantees the pre-write check uses the *exact* rules a single `fill` uses (SC-003,
FR-004).

**Alternatives considered**: Threading `fields` through the existing `interact()` signature
— rejected, muddies the single-target path and its `logged`-flag control flow. Re-validating
targets during the write pass instead of a separate pre-pass — rejected, that is fail-fast
(Option B), not the clarified hybrid.

## R3 — Whole-batch refusal payload

**Decision**: New `ErrorCode` value `"BATCH_REJECTED"`. `ErrorDetails` gains optional
`targets?: Array<{ selector: string; ruleId?: string; ruleDescription?: string; reason?: string }>`.
`HyppoError.toResult()` already spreads `details`, so the serialised error is
`{ error: { code: "BATCH_REJECTED", message, targets: [...] } }`. Used for: over-cap, empty,
malformed call (no `targets`), and one-or-more forbidden/unresolved targets (with `targets`).

**Rationale**: FR-006 wants "an error code, a human-readable message, and a per-target
breakdown". A single `ruleId` field cannot carry multiple offenders; a distinct code lets a
caller tell "the whole batch bounced" from a single-`fill` `REFUSED_EXTERNAL_ACT`.

**Alternatives considered**: Reuse `REFUSED_EXTERNAL_ACT` with a `targets` array — rejected,
cap/empty/malformed are not external-act refusals and the code would lie. A `partial`-style
success payload that lists refusals — rejected, contradicts FR-005 (nothing written ⇒ not a
success).

## R4 — Audit log shape

**Decision**: `src/shared/types.ts`:

- `InteractionLogEntry.outcome`: `"permitted" | "refused" | "error"` → add `"partial"`.
- add optional `batch?: { requested: number; written: number; errored: number; refused: number }`.

Per-field write entries: unchanged shape — `operation: "fill"`, `target: selector`,
`outcome: "permitted" | "error"`, `error: reason?`. Batch-summary entry:
`operation: "fill_batch"`, `target: null`, `outcome: "permitted" | "partial" | "refused"`,
`batch: { … }`. On whole-batch refusal: one entry per offender
(`operation: "fill"`, `outcome: "refused"`, `ruleId?` / `error: reason?`) **then** the
`fill_batch` summary; no `permitted` field entries (FR-014).

**Rationale**: Additive and still plain JSONL (Principle III). `operation` is already a free
string in `InteractionLogEntry`, so `"fill_batch"` needs no type change there; only the
`outcome` union and the new optional object.

**Alternatives considered**: Packing counts into `error` as text — rejected, not
machine-inspectable. A second log file for batches — rejected, hidden state, one obligation
split in two.

## R5 — The batch cap

**Decision**: `config.batchFillCap = numFromEnv("HYPPO_BATCH_FILL_CAP", 50)` in
`src/main/config.ts`, alongside the other limits. `fillBatch` checks
`fields.length === 0` → `BATCH_REJECTED` "no fields"; `fields.length > config.batchFillCap`
→ `BATCH_REJECTED` naming the cap and `fields.length`.

**Rationale**: Config is the established home for limits (`maxTextBytes`, `defaultWaitMs`).
Env override lets a test drive the cap boundary cheaply.

**Alternatives considered**: A bare module const in `interact.ts` — works, but inconsistent
with the other tunables and harder to exercise at the boundary in a test.

## R6 — Reusing the write mechanism

**Decision**: Reuse `fillScript(selector, value)` from `003` unchanged — native
`HTMLInputElement`/`HTMLTextAreaElement` value setter, clear-then-set (replace semantics,
FR-007 / `003` FR-017), trailing `blur` except on combobox filter inputs. `fillBatch` calls
it once per pair.

**Rationale**: The write semantics are already correct and tested; batching is purely an
orchestration layer above them.

**Alternatives considered**: A single injected script that writes all fields in one
round-trip — rejected for v1: it complicates per-field error attribution (FR-008) and the
per-field audit entries (FR-012), and the round-trip saving is not what SC-002 needs (the
win is one *orchestrator* round-trip, not one *IPC* round-trip). Noted as a possible later
optimisation.

## R7 — Deterministic mid-write removal for User Story 3

**Decision**: Extend `tests/fixtures/form.html` with a one-line hook: when `#email`
receives an `input` event, remove `#phone` from the DOM. A US3 batch ordered
`[#first_name, #email, #phone, #website, #age]` then passes the pre-write check (all resolve)
but `#phone`'s write finds nothing → per-field `error`, batch `partial`, others `permitted`.

**Rationale**: The batch is one `queue.run` with several `executeJavaScript` hops, so a test
cannot inject a removal between the check and a specific write from outside. An in-page hook
triggered by an earlier field's write is deterministic and needs no timing.

**Alternatives considered**: A selector that resolves at check time but is invalid CSS at
write time — not possible, same string both times. Mocking `wc.executeJavaScript` — rejected,
integration tests drive the real app.

## R8 — e2e test handle

**Decision**: Add `fillBatch: (tabId, fields) => withCode(() => queue.run(() =>
fillBatch(tabs.webContentsFor(tabId), log, tabId, fields)).then(r => r.value))` to
`globalThis.__hyppo` in `src/main/index.ts` (e2e block only). The single `interact` handle
is untouched.

**Rationale**: A dedicated handle keeps the test calls readable and mirrors how `fillBatch`
is a distinct export; the MCP `tools.ts` dispatch is exercised separately by asserting the
schema rejects a malformed call.

**Alternatives considered**: Overloading the `interact` handle with a 5th arg — rejected,
noisier at every existing call site.
