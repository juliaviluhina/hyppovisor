# Phase 1 Data Model: Form-Filling Robustness

No persisted entities — every shape below is request-scoped and returned once. Types live in
`src/shared/types.ts`.

---

## 1. `FormFieldRecord` (extended)

Existing fields unchanged: `selector`, `selectorSynthesised`, `duplicateId`, `kind`, `type`,
`label`, `required`, `group`, `inFormAncestor`, `visible`, `options`, `optionsAvailable`,
`optionsTruncated`, `fillVerdict`, `clickVerdict`, `currentValue` (omitted for credentials).

**Added:**

| Field | Type | Meaning | Source |
|---|---|---|---|
| `operation` | `"fill" \| "choose" \| "activate" \| "none"` | Which `interact` operation applies to this control. Derived from `kind` (R8). | main process, pure |
| `chooseVerdict` | `{ allowed: boolean; ruleId?: string; description?: string }` | What `interact` `choose_option` would return for this target. `in-form` does **not** gate it. | `chooseVerdictFor(descriptor)` in `blocklist.ts` |
| `interactive` | `boolean` | `false` for plain buttons and hidden value-mirror inputs. Absent (⇒ `true`) for every genuine control. Drives default exclusion. | main process, R7 |
| `mirrors` | `string?` | Present only on a value-mirror record: the `selector` of the combobox whose value this hidden input carries. | collector cluster pass, R7 |
| `maxLength` | `number?` | `HTMLInputElement.maxLength` when ≥ 0 and set. Text-like kinds only. | collector |
| `pattern` | `string?` | `getAttribute("pattern")` when present. Text-like kinds only. | collector |
| `inputMode` | `string?` | `getAttribute("inputmode")` when present. Text-like kinds only. | collector |

**Exclusion rule (default read):** a record is omitted when `interactive === false` **or**
`kind === "button"`, UNLESS its selector was named explicitly in `fields`, OR
`includeNonInteractive: true` was passed.

**`operation` derivation:** `text`/`textarea`/`richtext` → `fill`;
`select`/`combobox`/`listbox` → `choose`; `checkbox`/`radio`/`button` → `activate`;
`file` → `none`; `other` → `none`.

---

## 2. `FormFieldMap` (response, extended)

Existing: `tabId`, `url`, `observedAt`, `records`, `queueDepth`, `truncated`.

**`truncated`** now also becomes `true` when the 64 KB byte budget dropped one or more
tail records (R5) — it remains a single boolean covering count-cap, option-cap, and
byte-budget trimming together (FR-011).

No new top-level fields. The request gains params (see contract): `fields?`,
`includeNonInteractive?`, `only?`.

---

## 3. `ListOptionsResult` (new)

Returned by `interact` `operation: "list_options"`.

| Field | Type | Meaning |
|---|---|---|
| `tabId` | `string` | echoed |
| `selector` | `string` | echoed |
| `options` | `Array<{ label: string; value: string; disabled: boolean }>` | Every choice found, document order. `label` verbatim (trimmed of surrounding whitespace only). `value` is `data-value` / `value` / `id` / `""` in that precedence (same as `choose_option`). |
| `optionsPresent` | `boolean` | `false` when a scripted menu did not populate within `chooseOptionWaitMs` — pair with `options: []` (FR-007). Always `true` for a native `<select>`. |
| `optionsTruncated` | `boolean` | `true` when the list was cut at `formFieldOptionCap` (FR-008). |
| `queueDepth` | `number` | echoed, as other `interact` results |

**No** `outcome` / audit fields — `list_options` writes no `InteractionLog` entry.

**Refusals** (thrown `HyppoError`, not a result):
- selector not valid CSS → `INVALID_SELECTOR`
- selector matches nothing → `TARGET_NOT_FOUND`
- target is not a dropdown (incl. `<select multiple>`) → `CHOOSE_OPTION_FAILED`,
  `reason: "not-a-dropdown"`
- target hits `submit-control` / `consent-toggle` / `credential-field` /
  `external-act-label` → `REFUSED_EXTERNAL_ACT` with the rule id (same as `choose_option`)

---

## 4. `ScreenshotResult` (new)

`screenshot` returns an MCP **image content block** plus a **text content block** carrying:

| Field | Type | Meaning |
|---|---|---|
| `tabId` | `string` | echoed |
| `width` | `number` | pixel width of the returned image |
| `height` | `number` | pixel height of the returned image |
| `scale` | `number` | `width / naturalWidth`; `1` when not downscaled (FR-021, FR-023) |
| `format` | `"jpeg" \| "png"` | encoding of the returned bytes |
| `fullPage` | `boolean` | whether the capture was beyond-viewport |
| `element` | `string?` | echoed `selector` when an element clip was used |
| `limitNotMet` | `boolean` | `true` when the image is still over `maxBytes` at the compression floor (FR-023) |

The image bytes are **not** persisted; the content block is the only copy.

**Refusals** (thrown `HyppoError`):
- `selector` not valid CSS → `INVALID_SELECTOR`
- `selector` resolves but the element is zero-size or fully off-viewport →
  `SCREENSHOT_FAILED` ("element is not renderable")
- `tabId` unknown → `TAB_NOT_FOUND` (existing)
- capture pipeline failure (CDP attach error, encoder error) → `SCREENSHOT_FAILED` with
  `cause`

---

## 5. `INVALID_SELECTOR` (new `ErrorCode`)

Carries only `code` + the fixed `message` (R9). No extra `details`. Raised before any
element lookup, at every caller-supplied-selector entry point:
`interact` (all ops incl. `list_options`), `wait_for_selector`, `read_form_fields`
(`containerSelector`, each `fields` entry).

---

## 6. `config` additions (`src/main/config.ts`)

| Key | Env | Default |
|---|---|---|
| `formFieldReadMaxBytes` | `HYPPO_FORM_FIELD_READ_MAX_BYTES` | `65536` (64 KB) |
| `screenshotMaxBytes` | `HYPPO_SCREENSHOT_MAX_BYTES` | `262144` (256 KB) |
| `screenshotJpegQualityStart` | `HYPPO_SCREENSHOT_JPEG_QUALITY_START` | `80` |
| `screenshotJpegQualityFloor` | `HYPPO_SCREENSHOT_JPEG_QUALITY_FLOOR` | `30` |

`chooseOptionWaitMs` (existing) is reused by `list_options` — no new wait knob.
