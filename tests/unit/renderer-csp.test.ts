// Renderer CSP integrity (feature 028 lesson): the inline <style> block in
// src/renderer/index.html is allowlisted by a sha256 hash in the Content-
// Security-Policy meta tag. Editing the CSS without updating the hash silently
// disables ALL panel styling (blank unstyled panel, broken geometry). This
// test fails the build the moment the two drift apart.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const htmlPath = fileURLToPath(new URL("../../src/renderer/index.html", import.meta.url));

function styleBlocks(html: string): string[] {
  const out: string[] = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1] as string);
  return out;
}

describe("renderer CSP style hash", () => {
  const html = readFileSync(htmlPath, "utf8");
  const blocks = styleBlocks(html);
  const meta = html.match(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/)?.[0] ?? "";

  it("has exactly one inline style block", () => {
    expect(blocks.length).toBe(1);
  });

  it("allowlists every inline style block hash in the CSP meta", () => {
    for (const block of blocks) {
      const digest = createHash("sha256").update(block, "utf8").digest("base64");
      expect(meta).toContain(`'sha256-${digest}'`);
    }
  });
});
