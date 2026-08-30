// http/https-only URL validation (FR-004). Pure — no Electron imports, unit-testable.

import { HyppoError } from "../errors.js";

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/**
 * Validate a URL string for opening or navigating.
 * @returns the normalised absolute URL string
 * @throws HyppoError("INVALID_URL") when the string cannot be parsed as an absolute URL
 * @throws HyppoError("SCHEME_NOT_ALLOWED") when the scheme is not http/https
 */
export function validateUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HyppoError(
      "INVALID_URL",
      `Not a valid absolute URL: ${JSON.stringify(raw)}. Provide a full http(s) URL.`,
    );
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new HyppoError(
      "SCHEME_NOT_ALLOWED",
      `Scheme "${parsed.protocol}" is not allowed. Only http and https URLs can be opened.`,
    );
  }

  return parsed.toString();
}

export function isValidUrl(raw: string): boolean {
  try {
    validateUrl(raw);
    return true;
  } catch {
    return false;
  }
}
