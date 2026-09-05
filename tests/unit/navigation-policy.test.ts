import { describe, expect, it } from "vitest";
import { blockedNavigationDetail, decideNavigation } from "../../src/main/tabs/navigation-policy.js";

describe("post-entry navigation policy", () => {
  it("accepts and normalizes allowed http(s) destinations", () => {
    expect(decideNavigation("https://example.com/jobs")).toEqual({
      allowed: true,
      url: "https://example.com/jobs",
    });
  });

  it("rejects unsupported and malformed destinations", () => {
    expect(decideNavigation("file:///etc/hosts").allowed).toBe(false);
    expect(decideNavigation("not a URL").allowed).toBe(false);
  });

  it("formats feedback without adding page or session data", () => {
    const detail = blockedNavigationDetail("file:///etc/hosts", "scheme is not allowed");
    expect(detail).toBe("file:///etc/hosts (scheme is not allowed)");
    expect(detail).not.toMatch(/cookie|password|token|credential|<html/i);
  });
});
