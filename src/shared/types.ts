// Shapes shared between the MCP surface, tab manager, and renderer IPC.
// Mirrors specs/001-open-any-url/data-model.md.

export type LoadState = "loading" | "loaded" | "failed";
export type OpenedBy = "person" | "orchestrator";

export interface TabSummary {
  tabId: string;
  url: string;
  title: string;
  loadState: LoadState;
}

export interface TabDetail extends TabSummary {
  error: string | null;
  openedBy: OpenedBy;
}

export interface PageReadResult {
  tabId: string;
  url: string;
  title: string;
  text: string;
  dom?: string;
  observedAt: string;
  truncated: { text: boolean; dom: boolean };
  queueDepth: number;
}

export type InteractOperation = "click" | "fill" | "scroll" | "space" | "choose_option";

/** Non-rule refusal reasons for `choose_option` (feature 006, data-model.md §4). */
export type ChooseOptionReason =
  | "not-a-dropdown"
  | "no-option-match"
  | "ambiguous-option"
  | "option-disabled"
  | "option-not-appeared"
  | "multi-select";

/** The matched option a permitted `choose_option` returns (feature 006, FR-014). */
export interface ChosenOption {
  label: string;
  value: string;
}

export interface InteractResult {
  tabId: string;
  operation: InteractOperation | "wait_for_selector" | "navigate";
  outcome: "permitted";
  /** Present only for a permitted `choose_option`. */
  chosenOption?: ChosenOption;
  queueDepth: number;
}

// ─── feature 004: batch fill ─────────────────────────────────────────────────

/** One requested pair in a batch `fill` (feature 004). */
export interface BatchFillField {
  selector: string;
  value: string;
}

/** Per-field outcome in a batch that passed the pre-write check (feature 004). */
export interface BatchFieldResult {
  selector: string;
  /** `error` only from a write-time failure; pre-write offenders never reach this array. */
  outcome: "permitted" | "error";
  /** Present iff `outcome === "error"` — the failure reason. */
  message?: string;
}

/** Aggregate result of a batch `fill` (feature 004). Returned only when the pre-write check passed. */
export interface BatchFillResult {
  tabId: string;
  operation: "fill";
  /** `permitted` = every field written; `partial` = ≥1 written and ≥1 errored. */
  outcome: "permitted" | "partial";
  /** One entry per requested pair, in request order (FR-011). */
  fields: BatchFieldResult[];
  summary: { requested: number; written: number; errored: number };
  queueDepth: number;
}

// ─── feature 005: structured form-field reader ───────────────────────────────

/**
 * The verdict `interact` would return for one operation on a target — identical
 * in shape and meaning to what `interact` actually produces (SC-004).
 */
export interface FieldVerdict {
  verdict: "permitted" | "refused";
  /** Present iff `refused` — the blocklist rule id or `"unsafe-fill-type"`. */
  ruleId?: string;
  /** Present iff `refused` — the same human text `interact` puts in its refusal. */
  ruleDescription?: string;
}

/** One `(label, value)` choice for a `<select>` or an in-DOM combobox menu. */
export interface FieldOption {
  /** Verbatim option text (FR-011). */
  label: string;
  /** `<option>.value`, or a combobox option's `data-value` / `value` / `id`, or `""`. */
  value: string;
}

/** One form control on the page (feature 005, data-model.md §3). */
export interface FormFieldRecord {
  /** Usable directly by `interact`; `null` only when no unique selector could be built. */
  selector: string | null;
  /** `true` when a structural `nth-of-type` path was used (not `#id` / `[name]`). */
  selectorSynthesised: boolean;
  /** `true` when the element has an `id` that is not unique on the page (invalid HTML). */
  duplicateId: boolean;
  kind:
    | "text"
    | "textarea"
    | "select"
    | "combobox"
    | "checkbox"
    | "radio"
    | "file"
    | "button"
    | "richtext"
    | "other";
  /** Raw `type` attribute, lowercased, when applicable (so `password` stays visible). */
  type: string | null;
  /** Verbatim accessible name from the shared label sources (R8); `""` when none. */
  label: string;
  /** `required` / `aria-required="true"` / a literal `*` in the label. */
  required: boolean;
  /** Radios only — shared group id (`name`, else `<fieldset>` id, else synthesised). */
  group: string | null;
  inFormAncestor: boolean;
  /** R7a — `false` for `display:none` / `hidden` / zero-size; the record is still returned. */
  visible: boolean;
  /**
   * R7 — text value / `checked` / selected option value(s) / `null`.
   * **Key omitted entirely** for a credential field (never `null`, never a placeholder).
   */
  currentValue?: string | boolean | string[] | null;
  /** `<select>` options, or an in-DOM combobox menu's options; `[]` otherwise. */
  options: FieldOption[];
  /** `true` for `<select>` and a combobox whose option elements are in the DOM. */
  optionsAvailable: boolean;
  /** `true` when `options` was cut to `formFieldOptionCap`. */
  optionsTruncated: boolean;
  /** `fillVerdictFor(descriptor)` — matches `interact`'s `fill` result exactly (SC-004). */
  fillVerdict: FieldVerdict;
  /** `clickVerdictFor(descriptor)` — matches `interact`'s `click` result exactly. */
  clickVerdict: FieldVerdict;
}

/** The result of one `read_form_fields` call (feature 005, data-model.md §4). Not stored. */
export interface FormFieldMap {
  tabId: string;
  url: string;
  /** ISO 8601, set in the collector script. */
  observedAt: string;
  /** `true` when the control list was cut to `formFieldControlCap`. */
  truncated: boolean;
  /** Document order; length ≤ `formFieldControlCap`. */
  records: FormFieldRecord[];
  queueDepth: number;
}

export interface InteractionLogEntry {
  at: string;
  tabId: string;
  url: string;
  operation: string;
  target: string | null;
  outcome: "permitted" | "refused" | "error" | "partial";
  ruleId: string | null;
  error: string | null;
  /** Set only on a batch-summary entry (`operation: "fill_batch"`, feature 004). */
  batch?: { requested: number; written: number; errored: number; refused: number };
  /**
   * Set only on a non-rule `choose_option` refusal (feature 006) — one of
   * `ChooseOptionReason`. `ruleId` stays `null` in that case.
   */
  reason?: string;
}
