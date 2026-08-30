// Recent-URLs history for the address-bar dropdown (feature 009).
//
// One small plaintext file, `<userData>/recent-urls.json`, holding a JSON array
// of URL strings, most-recent-first. Human-readable, safe to delete by hand.
// This module touches the filesystem only — it takes `userDataDir` as an
// argument and never imports Electron — so `tests/unit` can drive it directly.
//
// Load tolerance (FR-008): a missing, unreadable, non-JSON, non-array file, or
// one whose elements are not all non-empty strings, is treated as an empty
// history and is NOT rewritten until the next legitimate update (mirrors
// `loadSettings`).

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RECENT_URLS_FILENAME = "recent-urls.json";

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

/**
 * Read `<userDataDir>/recent-urls.json`. Any failure — absent, unreadable, not
 * JSON, not an array, or any element not a non-empty string — yields `[]` and
 * leaves the file untouched.
 */
export function loadRecentUrls(userDataDir: string): string[] {
  let text: string;
  try {
    text = readFileSync(join(userDataDir, RECENT_URLS_FILENAME), "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || !parsed.every(isNonEmptyString)) return [];
  return parsed;
}

/** Overwrite `<userDataDir>/recent-urls.json` atomically (temp write + rename). */
export function saveRecentUrls(userDataDir: string, urls: string[]): void {
  const target = join(userDataDir, RECENT_URLS_FILENAME);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(urls, null, 2) + "\n");
  renameSync(tmp, target);
}

/**
 * Pure history update: drop any exact-string duplicate, put `url` at the front,
 * cap the length. Idempotent for a URL already at the front; moves it to the
 * front otherwise; never grows past `cap`.
 */
export function addRecentUrl(list: string[], url: string, cap: number): string[] {
  const next = list.filter((u) => u !== url);
  next.unshift(url);
  return next.slice(0, Math.max(0, cap));
}
