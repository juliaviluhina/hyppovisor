// Link-shim / redirect-interstitial URL resolution (feature 002).
//
// Several large sites route outbound links through an interstitial on their own
// domain that carries the real destination in a query parameter (LinkedIn
// `/safety/go/?url=`, Google `/url?q=`, Facebook `/l.php?u=`, Reddit
// `out.reddit.com/?url=`, Outlook Safe Links `*.safelinks…/?url=`). An agent
// following such a link lands on the interstitial and stalls at a "Continue"
// button the external-act blocklist refuses.
//
// This module recognizes those wrappers and returns the stated `http(s)`
// destination — a pure, deterministic string transform: no network request, no
// page content, no app state. Anything not on the table (or a wrapper whose
// destination is not `http(s)`) is returned verbatim. Pure and Electron-free,
// like `url-policy.ts`; the enumerable table mirrors `blocklist.ts`.

/** One recognized redirect interstitial. */
export interface ShimRule {
  /** Stable kebab-case id. */
  id: string;
  /** `true` when this rule owns the given lowercased hostname (no port). */
  hostMatch: (host: string) => boolean;
  /** Path prefix the wrapper lives under. `"/"` matches any path. */
  pathPrefix: string;
  /** Query parameter carrying the destination URL. */
  param: "url" | "q" | "u";
}

/** Max resolution iterations for a shim-wrapping-a-shim chain (FR-007). */
export const MAX_UNWRAP_HOPS = 3;

// Google runs the same `/url?q=` redirect on every regional domain. An explicit
// curated set (research R3) — enumerable and testable, and it does not match
// lookalike hosts the way a `www.google.<tld>` regex would.
const GOOGLE_HOSTS = new Set([
  "www.google.com",
  "google.com",
  "www.google.co.uk",
  "www.google.ca",
  "www.google.com.au",
  "www.google.de",
  "www.google.fr",
  "www.google.es",
  "www.google.it",
  "www.google.nl",
  "www.google.pl",
  "www.google.co.in",
  "www.google.co.jp",
  "www.google.com.br",
  "www.google.com.mx",
  "www.google.ru",
  "www.google.se",
  "www.google.ch",
  "www.google.be",
  "www.google.at",
  "www.google.ie",
  "www.google.co.nz",
  "www.google.com.sg",
]);

/** The recognized shim set (FR-002). Add rows here — no other change needed. */
export const SHIM_RULES: readonly ShimRule[] = [
  {
    id: "linkedin-safety",
    hostMatch: (h) => h === "www.linkedin.com",
    pathPrefix: "/safety/go/",
    param: "url",
  },
  {
    id: "google-redirect",
    hostMatch: (h) => GOOGLE_HOSTS.has(h),
    pathPrefix: "/url",
    param: "q",
  },
  {
    id: "facebook-linkshim",
    hostMatch: (h) => h === "l.facebook.com" || h === "lm.facebook.com",
    pathPrefix: "/l.php",
    param: "u",
  },
  {
    id: "reddit-out",
    hostMatch: (h) => h === "out.reddit.com",
    pathPrefix: "/",
    param: "url",
  },
  {
    id: "outlook-safelinks",
    hostMatch: (h) => h.endsWith(".safelinks.protection.outlook.com"),
    pathPrefix: "/",
    param: "url",
  },
];

/**
 * The recognized shim set as a serialisable list, for inspection and unit tests
 * (analogous to `listBlocklistRules()`). The `hostMatch` predicate is not
 * serialisable; each rule's host behaviour is pinned by a unit test instead.
 */
export function listShimRules(): Array<Pick<ShimRule, "id" | "pathPrefix" | "param">> {
  return SHIM_RULES.map(({ id, pathPrefix, param }) => ({ id, pathPrefix, param }));
}

function pathMatches(pathname: string, prefix: string): boolean {
  if (prefix === "/") return true;
  return pathname === prefix || pathname.startsWith(prefix);
}

/**
 * One resolution step. Returns the decoded `http(s)` destination when `input` is
 * a recognized shim carrying one, or `null` when there is nothing to unwrap (not
 * a shim, path/param miss, or a non-`http(s)` / unparseable destination).
 */
function unwrapOnce(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const rule = SHIM_RULES.find((r) => r.hostMatch(host) && pathMatches(u.pathname, r.pathPrefix));
  if (!rule) return null;

  // `URLSearchParams.get` returns the first occurrence and performs exactly one
  // percent-decode — the shim's single encode (spec Edge Cases).
  const candidate = u.searchParams.get(rule.param);
  if (!candidate) return null;

  let dest: URL;
  try {
    dest = new URL(candidate);
  } catch {
    return null;
  }
  // Unwrap only to a web page (FR-006): a `javascript:` / `data:` / `mailto:` /
  // `tel:` payload in a shim param is never navigated to.
  if (dest.protocol !== "http:" && dest.protocol !== "https:") return null;
  return dest.toString();
}

/** Outcome of resolving an input URL (data-model.md §UnwrapResult). */
export interface UnwrapResult {
  /** The URL to actually open. The verbatim input when no unwrap occurred. */
  url: string;
  /** `0` when opened verbatim; `1`–`MAX_UNWRAP_HOPS` for a resolved chain. */
  hops: number;
  /** The original input, set only when `hops > 0`. */
  wrapper?: string;
}

/**
 * Resolve a link-shim URL to its stated `http(s)` destination, following a
 * shim-wrapping-a-shim up to {@link MAX_UNWRAP_HOPS} (FR-004, FR-007). Never
 * throws: any parse failure, table miss, or non-`http(s)` destination yields the
 * input verbatim with `hops: 0` (FR-006, FR-008). The returned `url` is **not**
 * run through `validateUrl` here — the caller does that next (FR-013).
 */
export function unwrapUrl(raw: string): UnwrapResult {
  let current = raw;
  let hops = 0;
  for (let i = 0; i < MAX_UNWRAP_HOPS; i++) {
    const next = unwrapOnce(current);
    if (next === null || next === current) break;
    current = next;
    hops++;
  }
  return hops > 0 ? { url: current, hops, wrapper: raw } : { url: raw, hops: 0 };
}
