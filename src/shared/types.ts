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

export type InteractOperation =
  | "click"
  | "fill"
  | "scroll"
  | "space"
  | "choose_option"
  | "list_options";

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
  /**
   * Present only for a permitted single `fill` (feature 011): the field's value
   * read back after the write, post-formatting. Omitted for a credential target
   * (a fill on one is refused before this point).
   */
  currentValue?: string;
  queueDepth: number;
}

/** Internal result of the in-page fill+read-back for a single `fill` (feature 011). */
export interface FillResult {
  /** The field's value as read back after the write, post-formatting. */
  currentValue: string;
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
  /**
   * `<select>` options, or an in-DOM combobox menu's options; `[]` otherwise.
   * feature 011: in the default record present only for a dropdown kind
   * (`select` / `combobox` / `listbox`); `includeNonInteractive` restores it for
   * every record.
   */
  options?: FieldOption[];
  /**
   * `true` for `<select>` and a combobox whose option elements are in the DOM.
   * feature 011: default record carries it only for a dropdown kind;
   * `includeNonInteractive` restores it everywhere.
   */
  optionsAvailable?: boolean;
  /**
   * `true` when `options` was cut to `formFieldOptionCap`.
   * feature 011: default record carries it only for a dropdown kind;
   * `includeNonInteractive` restores it everywhere.
   */
  optionsTruncated?: boolean;
  /** `fillVerdictFor(descriptor)` — matches `interact`'s `fill` result exactly (SC-004). */
  fillVerdict: FieldVerdict;
  /** `clickVerdictFor(descriptor)` — matches `interact`'s `click` result exactly. */
  clickVerdict: FieldVerdict;

  // ─── feature 008: form-filling robustness ──────────────────────────────────

  /**
   * Which `interact` operation applies to this control, derived purely from
   * `kind` (data-model.md R8): text/textarea/richtext → `fill`;
   * select/combobox/listbox → `choose`; checkbox/radio/button → `activate`;
   * file/other → `none`.
   */
  operation?: "fill" | "choose" | "activate" | "none";
  /**
   * What `interact` `choose_option` would return for this target. `in-form` does
   * **not** gate it (unlike `clickVerdict`). Same shape as `chooseVerdictFor`.
   */
  chooseVerdict?: { allowed: boolean; ruleId?: string; description?: string };
  /**
   * `false` for plain buttons and hidden value-mirror inputs. Absent (⇒ `true`)
   * for every genuine control. Drives the default-read exclusion.
   */
  interactive?: boolean;
  /**
   * Present only on a value-mirror record: the `selector` of the combobox whose
   * value this hidden input carries.
   */
  mirrors?: string;
  /** `HTMLInputElement.maxLength` when set (≥ 0). Text-like kinds only. */
  maxLength?: number;
  /** `getAttribute("pattern")` when present. Text-like kinds only. */
  pattern?: string;
  /** `getAttribute("inputmode")` when present. Text-like kinds only. */
  inputMode?: string;
}

// ─── feature 008: list_options ──────────────────────────────────────────────

/** One choice `interact` `list_options` returns. */
export interface ListedOption {
  /** Verbatim option text, trimmed of surrounding whitespace only. */
  label: string;
  /** `data-value` / `value` / `id` / `""`, same precedence as `choose_option`. */
  value: string;
  disabled: boolean;
}

/** The result of one `interact` `operation: "list_options"` call. Not stored, not logged. */
export interface ListOptionsResult {
  tabId: string;
  selector: string;
  /** Every choice found, document order. */
  options: ListedOption[];
  /**
   * `false` when a scripted menu did not populate within `chooseOptionWaitMs`
   * (pair with `options: []`). Always `true` for a native `<select>`.
   */
  optionsPresent: boolean;
  /** `true` when the list was cut at `formFieldOptionCap`. */
  optionsTruncated: boolean;
  queueDepth: number;
}

// ─── feature 008: screenshot ───────────────────────────────────────────────

/** The metadata text block a `screenshot` call returns alongside the image block. */
export interface ScreenshotResult {
  tabId: string;
  /** Pixel width of the returned image. */
  width: number;
  /** Pixel height of the returned image. */
  height: number;
  /** `width / naturalWidth`; `1` when not downscaled. */
  scale: number;
  format: "jpeg" | "png";
  /** Whether the capture was beyond-viewport. */
  fullPage: boolean;
  /** Echoed `selector` when an element clip was used. */
  element?: string;
  /** `true` when the image is still over `maxBytes` at the compression floor. */
  limitNotMet: boolean;
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

// ─── feature 007: MCP connection panel ──────────────────────────────────────

export type ConnectionTransport = "http" | "stdio";
/**
 * Where an effective value came from — env var, a `--port` launch flag (feature
 * 012), persisted settings, or the built-in default.
 */
export type ConnectionSource = "env" | "cli" | "persisted" | "default";

/** The persisted shape of `<userData>/settings.json` (feature 007, contracts/settings-file.md). */
export interface ConnectionSettings {
  /** Integer 1–65535. */
  port: number;
  tokenRequired: boolean;
  /** 32 lowercase hex chars when `tokenRequired`; `null` otherwise. */
  token: string | null;
}

/** In-memory record of the most recent inbound MCP request — metadata only, never persisted. */
export interface LastRequestInfo {
  at: number;
  /** Registered tool / method name; `null` for a rejected (401) request. */
  tool: string | null;
  outcome: "ok" | "rejected";
}

/** How to launch HyppoVisor as a stdio MCP subprocess — computed in main, rendered by the panel. */
export interface StdioLaunch {
  command: string;
  args: string[];
  env: { HYPPO_MCP_STDIO: "1" };
}

/** The resolved connection state the panel and status line render (feature 007, data-model §3). */
export interface EffectiveConnection {
  transport: ConnectionTransport;
  /** Meaningful only when `transport === "http"`. */
  port: number;
  /** `http://127.0.0.1:${port}/mcp`; `""` when `transport === "stdio"`. */
  endpointUrl: string;
  tokenRequired: boolean;
  /** The real value (the renderer masks it); `null` when not required. */
  token: string | null;
  portSource: ConnectionSource;
  tokenSource: ConnectionSource;
  lastRequest: LastRequestInfo | null;
  /**
   * HTTP bind outcome (feature 012). `"listening"` on success; `"port-unavailable"`
   * when the port was in use (EADDRINUSE); `"error"` for any other bind failure;
   * `"stdio"` when `transport === "stdio"`.
   */
  serverStatus: "listening" | "port-unavailable" | "error" | "stdio";
  /** Instance display label (feature 012); `""` for the default instance. */
  instanceLabel: string;
  /** MCP server name (feature 012): `"hyppovisor"` or `"hyppovisor-<label>"`. */
  serverName: string;
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
  /** Set only on an `operation: "unwrap"` entry (feature 002 — a link-shim resolution). */
  unwrap?: { hops: number };
  /**
   * Set only on a non-rule `choose_option` refusal (feature 006) — one of
   * `ChooseOptionReason`. `ruleId` stays `null` in that case.
   */
  reason?: string;
}
