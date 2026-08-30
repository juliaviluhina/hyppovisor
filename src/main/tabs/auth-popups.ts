// Which popup windows a page is allowed to open.
//
// HyppoVisor denies every `window.open()` by default (FR-006/FR-017): a page must
// not spawn windows on its own. The one exception is a sign-in popup the human
// summoned — several identity providers (Google Identity Services, Microsoft,
// Apple…) only offer a `ux_mode=popup` flow, and Principle IV wants the human to
// log in themselves. Those popups are allowed, as a transient child window that
// shares the tab's session and closes itself when the flow ends.
//
// The gate is the popup's target host, matched against a fixed allowlist of
// identity-provider origins. Everything else stays blocked.

/** Exact hosts that host an OAuth / OpenID sign-in popup. */
const AUTH_HOSTS = new Set<string>([
  "accounts.google.com",
  "accounts.youtube.com",
  "login.microsoftonline.com",
  "login.microsoft.com",
  "login.live.com",
  "appleid.apple.com",
  "github.com",
  "gitlab.com",
  "www.facebook.com",
  "facebook.com",
  "www.linkedin.com",
  "linkedin.com",
  "www.dropbox.com",
  "login.okta.com",
  "auth.atlassian.com",
  "id.atlassian.com",
  "slack.com",
  "discord.com",
  "login.yahoo.com",
  "www.amazon.com",
]);

/** Host suffixes for provider families that use per-tenant subdomains. */
const AUTH_HOST_SUFFIXES = [
  ".auth0.com",
  ".okta.com",
  ".okta-emea.com",
  ".oktapreview.com",
  ".onelogin.com",
  ".b2clogin.com",
  ".firebaseapp.com",
  ".accounts.dev", // Clerk-hosted
];

/**
 * Extra hosts from `HYPPO_AUTH_POPUP_HOSTS` (comma-separated) — a test seam so an
 * integration test can allow a local fixture host without touching the real list.
 */
function extraHosts(env: NodeJS.ProcessEnv): string[] {
  return (env.HYPPO_AUTH_POPUP_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** `true` when `rawUrl` is an https popup to a known identity provider. */
export function isAuthPopupUrl(rawUrl: string, env: NodeJS.ProcessEnv = process.env): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  // Test seam: HYPPO_AUTH_POPUP_HOSTS bypasses the https requirement so a local
  // (http) fixture host can exercise the allow path.
  if (extraHosts(env).includes(host)) return true;
  if (url.protocol !== "https:") return false;
  if (AUTH_HOSTS.has(host)) return true;
  if (AUTH_HOST_SUFFIXES.some((s) => host.endsWith(s))) return true;
  return false;
}

/** A short label for the activity line when a sign-in popup is allowed through. */
export function authPopupLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "sign-in";
  }
}
