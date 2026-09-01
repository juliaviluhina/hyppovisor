# Quickstart / Acceptance: Form-Fill Fidelity

The acceptance run is a re-play of the session behind
`specs/issues/005-form-fill-second-workable-session.md` against the live A2Z Sync Workable
form, plus deterministic fixture checks. All SC references are from
[spec.md](./spec.md#measurable-outcomes).

## Prerequisites

- `npm install` (fetches the Electron binary) and a display.
- Build: `npm run build`
- Constitution amendment **1.4.0** merged (US4 tasks are blocked until then — check
  `.specify/memory/constitution.md` reads `Version: 1.4.0` and Principle I carries the
  in-form-reveal clause).

## Automated checks

```sh
npm run lint
npm test                 # vitest unit
npm run test:e2e         # playwright _electron integration
```

Unit coverage that must be green:

- `tests/unit/blocklist.test.ts` — descriptor `name` excludes a `<textarea>` /
  `contentEditable` / text-`<input>` own value; keeps `<button>` / submit `value`;
  `external-act-label` verdict identical before and after a drafted value containing
  "apply" (SC-003, SC-004); narrowed `in-form` — `<button type="button">` no `formaction`
  → permitted; `type="submit"`, `formaction` present, outward label → still refused (SC-009).
- `tests/unit/interact.test.ts` — read-back comparator: `091992` vs `09/1992` → match;
  `""` → not applied; `09/19` vs `09/1992` → truncated; the per-character script emits
  `keydown`/`beforeinput`/`input`/`keyup` per char.
- `tests/unit/form-fields.test.ts` — default record omits the four diagnostic fields and
  empty `options`; `includeNonInteractive` restores them; collection waits for
  `readyState`.

Integration coverage that must be green:

- `tests/integration/interaction.spec.ts`
  - `masked.html`: `fill` the `MM/YYYY` field with `09/1992` → response `currentValue`
    is `09/1992`, an independent `read_form_fields` shows the same (SC-001); `fill` a
    format the mask rejects → `WRITE_NOT_APPLIED` with `currentValue` on the same call
    (SC-002).
  - `form.html`: `fill` a `<textarea>` with text containing "apply", then `fill` it again
    with revised text → both permitted (SC-003); read the field's `fillVerdict` 10×
    with no page change → identical every time (SC-005); `fill` then immediately `fill`
    again on the same selector → second call not refused (SC-006).
  - `expander.html`: `click` the in-form `<button type="button">Add Experience</button>`
    → permitted, the hidden `<fieldset>` becomes readable, URL unchanged, an
    interaction-log `permitted` entry exists (SC-007); `click` the sibling
    `<button type="submit">` → `REFUSED_EXTERNAL_ACT` / `submit-control` (SC-007);
    same on a copy of the fixture with no submit button in the form → the `type="button"`
    click is still permitted (SC-007, B1).
- `tests/integration/batch-fill.spec.ts` — a batch of 4 where entry 2 targets the masked
  field with a bad format → entry 2 `outcome: "error"`, entries 1/3/4 `written` and
  confirmed (SC-002).
- `tests/integration/read-form-fields.spec.ts` — unscoped read of a ~60-control fixture
  form → response within the 64 KB budget, `truncated` false, every control present
  (SC-008); `includeNonInteractive` superset carries the diagnostic fields.
- Consistency guard (existing `tests/unit/connection-snippets.test.ts` / About-text guard)
  — the `fill` read-back / `WRITE_NOT_APPLIED` note and the in-form carve-out wording
  appear in the contract, `docs/safety.md`, and the README, or the guard fails (SC-010).

## Manual acceptance — the live Workable form

Open the form recorded in memory (`feature-011-test-form`):
`https://jobs.workable.com/view/3wwPqWr4G8nzLWnxfEAKur/...` in HyppoVisor, log in as
yourself, then drive it over MCP:

1. **Masked dates (SC-001/SC-002).** In the Education / Experience sub-forms, `fill`
   `start_date` / `end_date` with `MM/YYYY` values. Every response either shows the value
   in `currentValue` and a follow-up `read_form_fields` confirms it, or returns
   `WRITE_NOT_APPLIED` — never a bare success on an empty field.
2. **The refused free-text question (SC-003/SC-004).** `fill` `#CA_42882` ("Do you have
   startup experience?") with a first draft, then `fill` it again with a revised answer
   containing everyday words. Both are permitted.
3. **Verdict stability (SC-005/SC-006).** `read_form_fields` scoped to `#CA_42882` twice
   with nothing else done → identical `fillVerdict`. `fill` it, then `fill` again → the
   second call is not refused.
4. **Add a row (SC-007).** `click` "Add Experience" → the sub-form appears and its inputs
   are readable and fillable. `click` the page's "Submit application" → refused.
5. **Payload (SC-008).** An unscoped `read_form_fields` on the whole form returns in one
   MCP response the client does not have to spill to a file; `truncated` is false.

Record the run in `tasks.md` T0xx as the SC evidence, noting that the live markup drifts
between sessions so an exact replay of issue 005's DOM is not guaranteed — the deterministic
proof is the fixture suite.
