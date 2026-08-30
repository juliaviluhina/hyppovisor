import { describe, it, expect } from "vitest";
import { validateUrl, isValidUrl } from "../../src/main/tabs/url-policy.js";
import { isHyppoError } from "../../src/main/errors.js";

describe("url-policy (FR-004)", () => {
  it("accepts http and https URLs and returns a normalised string", () => {
    expect(validateUrl("https://example.com")).toBe("https://example.com/");
    expect(validateUrl("http://example.com/jobs?id=1")).toBe("http://example.com/jobs?id=1");
  });

  it("rejects malformed input with INVALID_URL", () => {
    for (const bad of ["not-a-url", "example.com", "", "   ", "//no-scheme"]) {
      try {
        validateUrl(bad);
        throw new Error(`expected ${JSON.stringify(bad)} to be rejected`);
      } catch (e) {
        expect(isHyppoError(e) && e.code).toBe("INVALID_URL");
      }
    }
  });

  it("rejects non-http(s) schemes with SCHEME_NOT_ALLOWED", () => {
    for (const bad of [
      "file:///etc/hosts",
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "ftp://example.com/file",
      "chrome://settings",
    ]) {
      try {
        validateUrl(bad);
        throw new Error(`expected ${JSON.stringify(bad)} to be rejected`);
      } catch (e) {
        expect(isHyppoError(e) && e.code).toBe("SCHEME_NOT_ALLOWED");
      }
    }
  });

  it("isValidUrl mirrors validateUrl without throwing", () => {
    expect(isValidUrl("https://ok.test")).toBe(true);
    expect(isValidUrl("file:///x")).toBe(false);
    expect(isValidUrl("garbage")).toBe(false);
  });
});
