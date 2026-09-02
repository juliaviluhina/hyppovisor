// Distinct, actionable error codes. No generic catch-all (FR-014, SC-009).

export type ErrorCode =
  | "INVALID_URL"
  | "SCHEME_NOT_ALLOWED"
  | "LOAD_FAILED"
  | "TAB_NOT_FOUND"
  | "NO_ACTIVE_TAB"
  | "TARGET_NOT_FOUND"
  | "WAIT_TIMEOUT"
  | "REFUSED_EXTERNAL_ACT"
  | "BATCH_REJECTED"
  | "CHOOSE_OPTION_FAILED"
  | "INVALID_SELECTOR"
  | "SCREENSHOT_FAILED"
  | "WRITE_NOT_APPLIED";

export interface ErrorDetails {
  /** Blocklist rule id, set only for REFUSED_EXTERNAL_ACT. */
  ruleId?: string;
  /** Human-readable rule description, set only for REFUSED_EXTERNAL_ACT. */
  ruleDescription?: string;
  /** Underlying cause string, e.g. for LOAD_FAILED. */
  cause?: string;
  /**
   * Per-target breakdown for a whole-batch refusal (BATCH_REJECTED, feature 004).
   * Present only when the cause is one-or-more forbidden/unresolved targets;
   * absent for cap / empty / malformed-call refusals.
   */
  targets?: Array<{
    selector: string;
    ruleId?: string;
    ruleDescription?: string;
    reason?: string;
  }>;
  /** Non-rule refusal reason for CHOOSE_OPTION_FAILED (feature 006) — a ChooseOptionReason. */
  reason?: string;
  /** Colliding option labels for CHOOSE_OPTION_FAILED / "ambiguous-option" (feature 006). */
  candidates?: string[];
  /**
   * The value read back from the field after a failed write (feature 011,
   * WRITE_NOT_APPLIED only). Empty string when the field is empty; omitted for a
   * credential-adjacent target, where the value is never surfaced.
   */
  currentValue?: string;
}

export class HyppoError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = "HyppoError";
    this.code = code;
    this.details = details;
  }

  /** Serialised shape returned through the MCP surface. */
  toResult(): { error: { code: ErrorCode; message: string } & ErrorDetails } {
    return { error: { code: this.code, message: this.message, ...this.details } };
  }
}

export function isHyppoError(e: unknown): e is HyppoError {
  return e instanceof HyppoError;
}
