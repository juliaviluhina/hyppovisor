# Quickstart: Validate "Batch Fill Operation for `interact`"

Proves: one call drafts a whole form, a forbidden target bounces the whole batch with
nothing written, a mid-write failure is per-field and non-fatal, the cap and empty batch are
refused, and every path produces the right audit lines.

## Prerequisites

- `npm install`; Node ≥ 22.
- `npm run build` clean after the type + config changes.
- `tests/fixtures/form.html` extended with the US3 hook: on `#email` receiving `input`,
  `#phone` is removed from the DOM.

## 1. Unit — cap, empty, exactly-one-of, offender collection (`tests/unit/batch-fill.test.ts`)

```
npm run test -- batch-fill
```

Expected:

- `fillBatch` with `[]` → `BATCH_REJECTED`, message mentions "at least one".
- `fillBatch` with 51 synthetic pairs → `BATCH_REJECTED`, message names `50` and `51`.
- `resolveFillTarget` returns an `offender` for a `credential-field` / `unsafe-fill-type` /
  unresolved descriptor and `ok` for a plain text descriptor — same verdicts
  `matchBlocklist` + `isSafeFillTarget` give a single `fill`.
- The `interact` zod dispatch rejects `operation:"fill"` with **both** `fields` and
  `selector`/`value`, and with **neither**.

Ref: [data-model.md](./data-model.md) §1–§5, [contracts/batch-fill.md](./contracts/batch-fill.md).

## 2. Integration — US1: draft a whole form in one call (`tests/integration/batch-fill.spec.ts`)

Load `form.html`, then one call:

```
fillBatch(tabId, [
  ["#first_name", "Iuliia"], ["#last_name", "Iliukhina"],
  ["#email", "iuliia@example.com"], ["#website", "https://example.com"],
  ["#age", "12"],
])
```

- result `outcome: "permitted"`, `summary: { requested: 5, written: 5, errored: 0 }`,
  `fields` has 5 `permitted` entries in order.
- `probe` each field → holds its value; `window.__submitted` is `false`; tab URL unchanged.
- interaction log grew by 6 lines: 5 `fill` (`permitted`) + 1 `fill_batch` (`permitted`,
  `batch.written === 5`).
- Re-run with a duplicate: `[["#first_name","A"], ["#first_name","B"]]` → `#first_name`
  reads `"B"` (SC-007).

## 3. Integration — US2: a forbidden target refuses the whole batch

```
fillBatch(tabId, [
  ["#first_name", "Iuliia"], ["#password", "hunter2"],
  ["#email", "x@y.co"], ["#resume", "cv"],
])
```

- rejected with `code: "BATCH_REJECTED"`; `targets` lists **both** `#password`
  (`credential-field`) and `#resume` (`unsafe-fill-type`).
- `probe` `#first_name` and `#email` → still empty (zero writes).
- log grew by 3 lines: 2 `fill` (`refused`, with `ruleId`) + 1 `fill_batch` (`refused`);
  no `permitted` line.
- A batch containing `#submitBtn` → `targets` names it with `submit-control`; a batch
  containing `#agree` (in-form consent) → `consent-toggle`.

## 4. Integration — US3: a mid-write failure is per-field, not fatal

```
fillBatch(tabId, [
  ["#first_name", "A"], ["#email", "a@b.co"], ["#phone", "555"],
  ["#website", "https://z.co"], ["#age", "9"],
])
```

The fixture removes `#phone` when `#email` gets input, so `#phone` passes the pre-write
check but its write finds nothing.

- result `outcome: "partial"`, `summary: { requested: 5, written: 4, errored: 1 }`.
- `fields`: `#phone` is `{ outcome: "error", message: … }`; the other four `permitted`.
- `probe` the four → filled; `window.__submitted` false.
- log: 4 `fill` `permitted` + 1 `fill` `error` + 1 `fill_batch` (`partial`, `batch.errored === 1`).

## 5. Integration — US4: cap and empty

- `fillBatch(tabId, [])` → `BATCH_REJECTED` "at least one"; log grew by 1 `fill_batch`
  (`refused`); no field changed.
- `fillBatch(tabId, <51 pairs>)` → `BATCH_REJECTED` naming `50`/`51`; nothing written.
  (Set `HYPPO_BATCH_FILL_CAP=3` in the test env to exercise the boundary without building a
  51-element fixture.)

## 6. MCP surface

- `interact` tool schema accepts `fields`; `operation:"fill"` + `fields` routes to the batch
  path; `operation:"fill"` + both forms (or neither) → `BATCH_REJECTED`.
- The `interact` tool description mentions the batch form, whole-batch refusal, best-effort
  completion, and the 50-pair cap (FR-015).

## 7. Docs / final gate

- `README.md` "What the app will not do" / interaction section still accurate (batch adds no
  new permission; note the batch form of `fill` if the section enumerates operations).
- `npm run build`, `npm run lint`, `npm run test`, `npm run test:e2e` all clean.
- Diff a sample of new `interaction-log.jsonl` lines: `target` is a selector or `null`, never
  page text; every batch has exactly one `fill_batch` line.

## Done when

§1–§5 pass, §6 verified, `build` + `lint` + `test` + `test:e2e` clean.
