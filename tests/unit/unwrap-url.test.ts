// Feature 002 — link-shim URL resolution. Pure, offline (SC-007): no Electron,
// no network. End-to-end behaviour (a real tab landing on the destination) is in
// tests/integration/open-url.spec.ts.

import { describe, it, expect } from "vitest";
import {
  unwrapUrl,
  listShimRules,
  SHIM_RULES,
  MAX_UNWRAP_HOPS,
} from "../../src/main/tabs/unwrap-url.js";

const DEST = "https://example.test/job/123";
const enc = encodeURIComponent;

/** A valid wrapper URL for a given shim id whose destination param is `dest`. */
function wrapperFor(id: string, dest: string): string {
  switch (id) {
    case "linkedin-safety":
      return `https://www.linkedin.com/safety/go/?url=${enc(dest)}`;
    case "google-redirect":
      return `https://www.google.com/url?q=${enc(dest)}&sa=D`;
    case "facebook-linkshim":
      return `https://l.facebook.com/l.php?u=${enc(dest)}&h=abc`;
    case "reddit-out":
      return `https://out.reddit.com/?url=${enc(dest)}&token=xyz`;
    case "outlook-safelinks":
      return `https://acme.na1.safelinks.protection.outlook.com/?url=${enc(dest)}&data=05%7C01`;
    default:
      throw new Error(`no wrapper builder for ${id}`);
  }
}

describe("unwrapUrl — every SHIM_RULES entry (feature 002, SC-006/SC-007)", () => {
  for (const rule of SHIM_RULES) {
    it(`resolves a ${rule.id} wrapper to its destination in one hop`, () => {
      expect(unwrapUrl(wrapperFor(rule.id, DEST))).toEqual({
        url: DEST,
        hops: 1,
        wrapper: wrapperFor(rule.id, DEST),
      });
    });
  }

  it("carries a destination query string through the single decode", () => {
    const dest = "https://boards.greenhouse.io/acme/jobs/9?gh_src=abc&utm=x";
    expect(unwrapUrl(`https://www.linkedin.com/safety/go/?url=${enc(dest)}`).url).toBe(dest);
  });

  it("uses the first occurrence when the param repeats", () => {
    const u = `https://www.google.com/url?q=${enc(DEST)}&q=${enc("https://second.test/")}`;
    expect(unwrapUrl(u).url).toBe(DEST);
  });
});

describe("listShimRules (feature 002)", () => {
  it("returns one serialisable row per rule with id / pathPrefix / param", () => {
    const rows = listShimRules();
    expect(rows).toHaveLength(SHIM_RULES.length);
    expect(rows.map((r) => r.id).sort()).toEqual(
      ["facebook-linkshim", "google-redirect", "linkedin-safety", "outlook-safelinks", "reddit-out"],
    );
    for (const r of rows) {
      expect(r.id.length).toBeGreaterThan(0);
      expect(r.pathPrefix.startsWith("/")).toBe(true);
      expect(["url", "q", "u"]).toContain(r.param);
    }
  });
});

describe("Google regional variants (feature 002, research R3)", () => {
  it("unwraps a curated ccTLD and bare google.com", () => {
    expect(unwrapUrl(`https://www.google.co.uk/url?q=${enc(DEST)}`).url).toBe(DEST);
    expect(unwrapUrl(`https://google.com/url?q=${enc(DEST)}`).url).toBe(DEST);
    expect(unwrapUrl(`https://www.google.de/url?q=${enc(DEST)}`).url).toBe(DEST);
  });

  it("does NOT unwrap a lookalike google host", () => {
    const u = `https://www.google.evil/url?q=${enc(DEST)}`;
    expect(unwrapUrl(u)).toEqual({ url: u, hops: 0 });
  });
});

describe("unwrapUrl — ordinary URLs are untouched (feature 002, US2 / SC-002)", () => {
  it("returns a non-shim host verbatim, even with a url/q/u param", () => {
    for (const u of [
      "https://example.com/search?q=https://evil.test",
      "https://example.com/go?url=https%3A%2F%2Fevil.test",
      "http://localhost:3000/x?u=https://evil.test",
    ]) {
      expect(unwrapUrl(u)).toEqual({ url: u, hops: 0 });
    }
  });

  it("returns a shim host with a non-matching path verbatim", () => {
    const u = `https://www.google.com/maps?q=${enc(DEST)}`;
    expect(unwrapUrl(u)).toEqual({ url: u, hops: 0 });
  });

  it("returns the wrapper verbatim when the named param is absent or empty", () => {
    for (const u of [
      "https://www.linkedin.com/safety/go/?foo=bar",
      "https://www.linkedin.com/safety/go/?url=",
      "https://www.google.com/url?sa=D",
    ]) {
      expect(unwrapUrl(u)).toEqual({ url: u, hops: 0 });
    }
  });

  it("returns a non-parseable input verbatim without throwing", () => {
    expect(unwrapUrl("not a url")).toEqual({ url: "not a url", hops: 0 });
    expect(unwrapUrl("")).toEqual({ url: "", hops: 0 });
  });
});

describe("unwrapUrl — non-web destinations are refused (feature 002, US3 / SC-003)", () => {
  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,<script>x</script>",
    "mailto:a@b.c",
    "tel:+15551234567",
    "/relative/path",
    "ftp://files.test/x",
  ]) {
    it(`does not unwrap to ${JSON.stringify(bad)} — opens the wrapper verbatim`, () => {
      const u = `https://www.linkedin.com/safety/go/?url=${enc(bad)}`;
      expect(unwrapUrl(u)).toEqual({ url: u, hops: 0 });
    });
  }
});

describe("unwrapUrl — nested shims and the depth cap (feature 002, US3 / FR-007 / SC-004)", () => {
  it("resolves a shim wrapping a shim through both layers", () => {
    const inner = `https://www.linkedin.com/safety/go/?url=${enc(DEST)}`;
    const outer = `https://acme.safelinks.protection.outlook.com/?url=${enc(inner)}`;
    expect(unwrapUrl(outer)).toEqual({ url: DEST, hops: 2, wrapper: outer });
  });

  it("stops at MAX_UNWRAP_HOPS on a chain deeper than the cap, without looping", () => {
    // 4 nested LinkedIn wrappers around DEST
    let u = DEST;
    for (let i = 0; i < 4; i++) u = `https://www.linkedin.com/safety/go/?url=${enc(u)}`;
    const r = unwrapUrl(u);
    expect(r.hops).toBe(MAX_UNWRAP_HOPS);
    // after 3 of 4 hops the value is still one LinkedIn wrapper deep
    expect(r.url).toContain("linkedin.com/safety/go");
  });

  it("terminates on a self-referential A→B→A chain at the cap", () => {
    const a = "https://out.reddit.com/?url=";
    const b = "https://www.linkedin.com/safety/go/?url=";
    // a wraps b wraps a wraps b ... (encode by hand, 5 deep)
    let u = DEST;
    for (const w of [a, b, a, b, a]) u = w + enc(u);
    const r = unwrapUrl(u);
    expect(r.hops).toBe(MAX_UNWRAP_HOPS);
    expect(typeof r.url).toBe("string");
  });
});
