import { describe, it, expect } from "vitest";
import { truncateToBytes } from "../../src/main/page/truncate.js";

describe("truncateToBytes (FR-021)", () => {
  it("returns content unchanged and truncated:false when under the limit", () => {
    const r = truncateToBytes("short text", 1000);
    expect(r.value).toBe("short text");
    expect(r.truncated).toBe(false);
  });

  it("truncates and flags when over the limit, staying within the byte budget", () => {
    const big = "x".repeat(5000);
    const r = truncateToBytes(big, 1000);
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.value, "utf8")).toBeLessThanOrEqual(1000);
    expect(r.value).toContain("truncated");
  });

  it("never splits a multi-byte code point", () => {
    const big = "é".repeat(5000); // 2 bytes each
    const r = truncateToBytes(big, 1001);
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.value, "utf8")).toBeLessThanOrEqual(1001);
    // valid string, no replacement chars introduced by a bad cut
    expect(r.value).not.toContain("�");
  });

  it("handles a zero-ish budget without throwing", () => {
    const r = truncateToBytes("anything at all", 5);
    expect(r.truncated).toBe(true);
    expect(typeof r.value).toBe("string");
  });
});
