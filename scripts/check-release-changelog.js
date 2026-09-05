import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const VERSION_HEADING = /^## \[([^\]]+)\](?: - \d{4}-\d{2}-\d{2})?\s*$/;

export function parseChangelog(markdown) {
  const lines = markdown.split(/\r?\n/);
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(VERSION_HEADING);
    if (!match || match[1].toLowerCase() === "unreleased") continue;
    const start = index;
    let end = index + 1;
    while (end < lines.length && !VERSION_HEADING.test(lines[end])) end += 1;
    entries.push({ version: match[1], text: lines.slice(start, end).join("\n").trim() });
    index = end - 1;
  }
  return entries;
}

export function extractReleaseEntry(markdown, version) {
  const matches = parseChangelog(markdown).filter((entry) => entry.version === version);
  if (matches.length !== 1 || !matches[0].text.replace(/^## [^\n]+\n?/, "").trim()) return null;
  return matches[0].text;
}

export function validateReleaseEntry(markdown, version) {
  if (!markdown.trim()) return { ok: false, error: "CHANGELOG.md is missing or empty" };
  const entries = parseChangelog(markdown).filter((entry) => entry.version === version);
  if (entries.length === 0) return { ok: false, error: `CHANGELOG.md has no entry for version ${version}` };
  if (entries.length > 1) return { ok: false, error: `CHANGELOG.md has duplicate entries for version ${version}` };
  if (!extractReleaseEntry(markdown, version)) return { ok: false, error: `CHANGELOG.md entry for version ${version} is empty` };
  return { ok: true };
}

async function main() {
  const [, , version, ...args] = process.argv;
  const outputFlag = args.indexOf("--output");
  const outputEquals = args.find((arg) => arg.startsWith("--output="));
  const output = outputEquals?.slice("--output=".length) ?? (outputFlag >= 0 ? args[outputFlag + 1] : undefined);
  const validArgs = outputFlag >= 0 ? args.length === outputFlag + 2 : args.every((arg) => arg.startsWith("--output="));
  if (!version || !validArgs || (outputFlag >= 0 && !output)) {
    console.error("Usage: node scripts/check-release-changelog.js <version> [--output <path>]");
    process.exitCode = 2;
    return;
  }
  const markdown = await readFile("CHANGELOG.md", "utf8");
  const result = validateReleaseEntry(markdown, version);
  if (!result.ok) {
    console.error(`[release-changelog] ${result.error}`);
    process.exitCode = 1;
    return;
  }
  if (output) await writeFile(output, `${extractReleaseEntry(markdown, version)}\n`, "utf8");
  else console.log(`[release-changelog] verified ${version}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
