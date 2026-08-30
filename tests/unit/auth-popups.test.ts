// Which popup URLs the tab manager lets through — a fixed identity-provider
// allowlist; everything else stays blocked (src/main/tabs/auth-popups.ts).

import { describe, it, expect } from "vitest";
import { isAuthPopupUrl, authPopupLabel } from "../../src/main/tabs/auth-popups.js";

const NO_ENV = {} as NodeJS.ProcessEnv;

describe("isAuthPopupUrl", () => {
  it("allows known identity-provider https popups", () => {
    for (const u of [
      "https://accounts.google.com/gsi/select?client_id=x&ux_mode=popup",
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1",
      "https://appleid.apple.com/auth/authorize?x=1",
      "https://github.com/login/oauth/authorize?client_id=x",
      "https://acme.okta.com/oauth2/v1/authorize",
      "https://dev-123.auth0.com/authorize?x=1",
      "https://tenant.b2clogin.com/tenant.onmicrosoft.com/oauth2/v2.0/authorize",
    ]) {
      expect(isAuthPopupUrl(u, NO_ENV), u).toBe(true);
    }
  });

  it("blocks everything else", () => {
    for (const u of [
      "https://app.jackandjill.ai/dashboard",
      "https://accounts.google.com.evil.example/phish", // suffix trick — host is evil.example
      "https://evil.example/accounts.google.com",
      "http://accounts.google.com/gsi/select", // not https
      "about:blank",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isAuthPopupUrl(u, NO_ENV), u).toBe(false);
    }
  });

  it("honors the HYPPO_AUTH_POPUP_HOSTS test seam (http allowed for those hosts only)", () => {
    const env = { HYPPO_AUTH_POPUP_HOSTS: "127.0.0.1, localhost" } as NodeJS.ProcessEnv;
    expect(isAuthPopupUrl("http://127.0.0.1:8123/popup.html", env)).toBe(true);
    expect(isAuthPopupUrl("http://example.com/popup.html", env)).toBe(false);
  });
});

describe("authPopupLabel", () => {
  it("is the hostname", () => {
    expect(authPopupLabel("https://accounts.google.com/gsi/select?x=1")).toBe("accounts.google.com");
    expect(authPopupLabel("garbage")).toBe("sign-in");
  });
});
