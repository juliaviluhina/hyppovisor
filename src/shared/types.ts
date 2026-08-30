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

export type InteractOperation = "click" | "fill" | "scroll" | "space";

export interface InteractResult {
  tabId: string;
  operation: InteractOperation | "wait_for_selector" | "navigate";
  outcome: "permitted";
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
}
