# MCP Tools — feature 011 delta

Exact changes to the tool surface. Baseline is the feature-008 contract
(`specs/001-open-any-url/contracts/mcp-tools.md`). No tool is added or removed; no
`interact` operation is added.

---

## `interact` — `operation: "fill"`

### Response (single `fill`)

Previously: a success carried the queue depth and no field data. Now a success also carries
the value read back after the write:

```jsonc
{
  "currentValue": "09/1992",   // el.value / el.innerText after the write, post-formatting.
                               // Omitted for a credential-field target.
  "queueDepth": 0
}
```

### New error — `WRITE_NOT_APPLIED`

Raised when, after typing the value with real key events, a read-back shows the field did
not accept it (empty, unchanged, or a truncated prefix — see research R2).

```jsonc
{
  "error": {
    "code": "WRITE_NOT_APPLIED",
    "message": "fill on \"[name=start_date]\": typed \"09/1992\" but the field still reads \"\" — the page did not accept the value (an input mask may require a different format). This field was not filled.",
    "currentValue": ""         // what the field reads now. Omitted for a credential target.
  }
}
```

- It is **not** a refusal — no blocklist rule fired, `ruleId` is absent.
- The single-`fill` path throws it; nothing was left half-written beyond what the page
  itself kept.
- The interaction-log entry for this attempt has `outcome: "error"` (not `"refused"`,
  not `"permitted"`).

### Batch `fill` (`fields`)

Unchanged response shape. Per-entry `outcome` values are still `written` / `error` /
`refused`. A masked-input no-op on one entry is now reported as that entry's
`outcome: "error"` with a `WRITE_NOT_APPLIED`-style reason; the entries before and after it
are still written and confirmed. Pre-check atomicity is unchanged — one blocklist refusal
on any target still refuses the whole batch (`BATCH_REJECTED`) with nothing written.

### Behaviour note (no shape change)

`fill` now enters the value with a per-character key-event sequence, not a single
programmatic assignment, so client-side input masks and formatters receive it. A plain
unmasked field is filled and confirmed exactly as before; `currentValue` in the response is
the only addition for that case.

---

## `interact` — `operation: "click"`

### `in-form` refusal narrowed

A `click` on a `<button type="button">` **inside a `<form>`** that declares no `formaction`
and whose own accessible name reads as no outward action is now **permitted** — it reveals
in-page content (e.g. a repeatable "Add Experience" sub-form) and cannot submit. It is
audit-logged like any permitted click.

Still refused inside a `<form>`, unchanged:

- any `<button>` with no `type` or `type="submit"`, any `<input type="submit">` /
  `type="image"` — `submit-control`;
- any control with `formaction` — `submit-control` / `in-form`;
- any control whose own label reads as an outward act ("Save", "Apply", "Send",
  "Continue", …) — `external-act-label`;
- any non-`<button>` clickable element inside the form — `in-form`.

This carve-out is gated on constitution amendment **1.4.0** (Principle I). It does not ship
before that amendment merges.

---

## `read_form_fields`

### Default record is leaner

An unscoped read (no `fields`, no `includeNonInteractive`) now omits, per record:

- `selectorSynthesised`, `duplicateId`, `optionsTruncated`, `optionsAvailable`;
- `options` for any non-dropdown control (it was an empty array).

Every record still carries `selector`, `kind`, `type`, `label`, `required`, `group`,
`inFormAncestor`, `visible`, `currentValue` (credential omitted), `operation`,
`fillVerdict`, `clickVerdict`, `chooseVerdict`, and `maxLength` / `pattern` / `inputMode`
when declared.

### `includeNonInteractive: true` — second effect

In addition to including plain buttons and hidden value-mirror inputs, it now also restores
the four diagnostic fields and the empty `options` arrays to every record. Use it when a
suggested selector misbehaves and you need the synthesised / duplicate-id signal.

### Verdict timing

`read_form_fields` now polls for `document.readyState === "complete"` (bounded by
`domReadyTimeoutMs`, default 1000 ms, then proceeds regardless) before it collects, so a
`fillVerdict` / `clickVerdict` / `chooseVerdict` is not computed against a still-parsing
DOM. Two reads of the same selector with no page change return the identical verdict.
`read_page` timing is unchanged.

---

## Error inventory

| Code | Feature | Meaning |
|---|---|---|
| `WRITE_NOT_APPLIED` | 011 (new) | `fill` typed a well-formed value but a read-back shows the field did not accept it. Not a refusal. Carries `currentValue`. |

No other error code changes.
