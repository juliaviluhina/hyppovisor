// http/https-only URL validation (FR-004). Pure — no Electron imports, unit-testable.

import { HyppoError } from "../errors.js";

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

export function normalizeHost(raw: string): string | null {
  try {
    const value = raw.trim();
    if (!value || value.includes("/") || value.includes(":") || value.startsWith(".")) return null;
    const host = new URL(`http://${value}`).hostname.toLowerCase().replace(/\.$/, "");
    return host === value.toLowerCase().replace(/\.$/, "") || host.startsWith("xn--") ? host : null;
  } catch { return null; }
}

/**
 * Validate a URL string for opening or navigating.
 * @returns the normalised absolute URL string
 * @throws HyppoError("INVALID_URL") when the string cannot be parsed as an absolute URL
 * @throws HyppoError("SCHEME_NOT_ALLOWED") when the scheme is not http/https
 */
export function validateUrl(raw: string, blockedDomains: readonly string[] = []): string {
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

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (blockedDomains.map(normalizeHost).some((domain) => domain !== null && (host === domain || host.endsWith(`.${domain}`)))) {
    throw new HyppoError("DOMAIN_BLOCKED", `Navigation to "${host}" is blocked by the blocked domains setting.`);
  }

  return parsed.toString();
}

export function isValidUrl(raw: string, blockedDomains: readonly string[] = []): boolean {
  try {
    validateUrl(raw, blockedDomains);
    return true;
  } catch {
    return false;
  }
}
