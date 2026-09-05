import { validateUrl } from "./url-policy.js";

export type NavigationPolicyDecision =
  | { allowed: true; url: string }
  | { allowed: false; reason: string };

/** Evaluate a browser-supplied top-level destination using the one URL policy. */
export function decideNavigation(url: string): NavigationPolicyDecision {
  try {
    return { allowed: true, url: validateUrl(url) };
  } catch (e) {
    return { allowed: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Safe transient detail for a blocked navigation notice. */
export function blockedNavigationDetail(url: string, reason: string): string {
  return `${url} (${reason})`;
}
