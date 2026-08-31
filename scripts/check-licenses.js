// License gate for `npm run dist` (feature 010, R3 / FR-007).
//
// Scans the *production* dependency closure (what electron-builder bundles into
// app.asar) and fails the build — before any artifact is produced — if any
// dependency is under a non-permissive license, is unclassifiable, or has no
// license field (fail closed). The offending package, version, and detected
// license are named.
//
// `classify` is pure and exported for tests; the script wraps it around a
// `license-checker-rseidelsohn` scan.

import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Fixed permissive SPDX allowlist (data-model.md). LGPL is intentionally absent
 * — the one permitted copyleft artifact, Electron's dynamically-linked
 * libffmpeg.dylib, is carved out by exact identity in the script below, not by
 * broadening this list.
 */
export const PERMISSIVE_ALLOWLIST = [
  "MIT",
  "MIT-0",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "CC-BY-4.0",
  "Unlicense",
  "Python-2.0",
  "WTFPL",
];

function normalizeId(id) {
  return id
    .trim()
    .replace(/^\(|\)$/g, "")
    .replace(/\*$/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

/** Is a single SPDX license *expression* wholly permissive under `set`? */
function isPermissive(raw, set) {
  if (!raw || typeof raw !== "string") return false;
  let expr = raw.trim();
  if (!expr || /^unknown$/i.test(expr) || expr === "UNLICENSED") return false;
  expr = expr.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();

  const hasOr = /\bOR\b/i.test(expr);
  const hasAnd = /\bAND\b/i.test(expr);
  if (hasOr && hasAnd) return false; // mixed expression — treat as unparseable

  const parts = expr
    .split(hasOr ? /\bOR\b/i : hasAnd ? /\bAND\b/i : /\0/)
    .map(normalizeId)
    .filter(Boolean);

  if (parts.length === 0) return false;
  if (parts.length === 1) return set.has(parts[0]);
  return hasOr ? parts.some((p) => set.has(p)) : parts.every((p) => set.has(p));
}

/**
 * @param {Record<string, string>} depLicenseMap  `name@version` → SPDX string
 * @param {string[]} [allowlist]
 * @returns {{ ok: boolean, offenders: string[] }}  offenders as `name@version — <license>`
 */
export function classify(depLicenseMap, allowlist = PERMISSIVE_ALLOWLIST) {
  const set = new Set(allowlist);
  const offenders = [];
  for (const [pkg, raw] of Object.entries(depLicenseMap)) {
    if (!isPermissive(raw, set)) offenders.push(`${pkg} — ${raw || "UNKNOWN"}`);
  }
  return { ok: offenders.length === 0, offenders };
}

/** Run the checker over production deps; returns `name@version` → SPDX string. */
function scanProductionLicenses(projectRoot, selfPkg) {
  const checker = require("license-checker-rseidelsohn");
  return new Promise((resolve, reject) => {
    checker.init(
      { start: projectRoot, production: true, excludePackages: selfPkg },
      (err, packages) => {
        if (err) return reject(err);
        /** @type {Record<string, string>} */
        const map = {};
        for (const [pkg, info] of Object.entries(packages)) {
          map[pkg] = Array.isArray(info.licenses) ? info.licenses.join(" AND ") : info.licenses;
        }
        resolve(map);
      },
    );
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const self = require(fileURLToPath(new URL("../package.json", import.meta.url)));
  const selfId = `${self.name}@${self.version}`;

  scanProductionLicenses(root, selfId)
    .then((map) => {
      const { ok, offenders } = classify(map);
      if (!ok) {
        console.error("[check-licenses] non-permissive / unclassifiable bundled dependencies:");
        for (const o of offenders) console.error(`  ${o}`);
        console.error(
          "\nAdd nothing to the allowlist to get past this — replace the dependency, or " +
            "confirm it is a constitution carve-out and whitelist it by exact identity.",
        );
        process.exit(1);
      }
      const count = Object.keys(map).length;
      console.error(`[check-licenses] ok — ${count} production dependencies, all permissive.`);
    })
    .catch((err) => {
      console.error(`[check-licenses] scan failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    });
}
