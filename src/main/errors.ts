// Distinct, actionable error codes. No generic catch-all (FR-014, SC-009).

export type ErrorCode =
  | "INVALID_URL"
  | "SCHEME_NOT_ALLOWED"
  | "LOAD_FAILED"
  | "TAB_NOT_FOUND"
  | "TARGET_NOT_FOUND"
  | "WAIT_TIMEOUT"
  | "REFUSED_EXTERNAL_ACT";

export interface ErrorDetails {
  /** Blocklist rule id, set only for REFUSED_EXTERNAL_ACT. */
  ruleId?: string;
  /** Human-readable rule description, set only for REFUSED_EXTERNAL_ACT. */
  ruleDescription?: string;
  /** Underlying cause string, e.g. for LOAD_FAILED. */
  cause?: string;
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
