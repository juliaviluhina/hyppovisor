// Feature 009 (T003) — recent-URL history: the pure list rules plus
// load / save / corrupt-file tolerance. See quickstart.md §1–§2.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RECENT_URLS_FILENAME,
  addRecentUrl,
  loadRecentUrls,
  saveRecentUrls,
} from "../../src/main/recent-urls.js";

let dir: string;
const file = () => join(dir, RECENT_URLS_FILENAME);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hyppo-recent-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("addRecentUrl", () => {
  it("appends a new URL at the front", () => {
    expect(addRecentUrl(["a"], "b", 20)).toEqual(["b", "a"]);
  });

  it("moves an existing URL to the front without duplicating it", () => {
    expect(addRecentUrl(["a", "b", "c"], "c", 20)).toEqual(["c", "a", "b"]);
  });

  it("is idempotent for a URL already at the front", () => {
    expect(addRecentUrl(["a", "b"], "a", 20)).toEqual(["a", "b"]);
  });

  it("evicts the oldest entry past the cap", () => {
    expect(addRecentUrl(["b", "c", "d"], "a", 3)).toEqual(["a", "b", "c"]);
  });

  it("preserves the order of the surviving entries", () => {
    const start = ["e", "d", "c", "b", "a"];
    expect(addRecentUrl(start, "f", 5)).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("does not mutate the input list", () => {
    const start = ["a", "b"];
    addRecentUrl(start, "c", 20);
    expect(start).toEqual(["a", "b"]);
  });
});

describe("loadRecentUrls / saveRecentUrls", () => {
  it("missing file → []", () => {
    expect(loadRecentUrls(dir)).toEqual([]);
  });

  it("round-trips a saved array and leaves no *.tmp", () => {
    const urls = ["https://b.example/", "https://a.example/"];
    saveRecentUrls(dir, urls);
    expect(loadRecentUrls(dir)).toEqual(urls);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("writes pretty JSON with a trailing newline", () => {
    const urls = ["https://a.example/"];
    saveRecentUrls(dir, urls);
    expect(readFileSync(file(), "utf8")).toBe(JSON.stringify(urls, null, 2) + "\n");
  });

  it.each([
    ["not json", "{ not json"],
    ["a wrapper object", JSON.stringify({ urls: ["a"] })],
    ["a number element", JSON.stringify(["a", 3])],
    ["an empty-string element", JSON.stringify(["a", ""])],
    ["a null element", JSON.stringify(["a", null])],
  ])("schema violation (%s) → [] with the file left byte-identical", (_label, bad) => {
    writeFileSync(file(), bad);
    expect(loadRecentUrls(dir)).toEqual([]);
    expect(readFileSync(file(), "utf8")).toBe(bad);
  });

  it("a valid array of non-empty strings passes through", () => {
    writeFileSync(file(), JSON.stringify(["https://x.example/"]));
    expect(loadRecentUrls(dir)).toEqual(["https://x.example/"]);
  });
});
