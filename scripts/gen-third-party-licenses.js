// Generate ./THIRD-PARTY-LICENSES for the packaged app (feature 010, R3 / FR-005).
//
// One section per *production* dependency, sorted by name, each with
// name@version, SPDX id, repository URL, and the full license text. Plus a
// fixed entry for the Electron runtime's dynamically-linked libffmpeg.dylib
// (LGPL-2.1-or-later — the constitution's replaceable-system-library carve-out;
// see PACKAGING.md).
//
// `renderInventory` is pure and deterministic (same input ⇒ byte-identical
// output, SC-006) and exported for tests; the script gathers the entries.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const HEADER = `# Third-Party Licenses

This file inventories every third-party dependency bundled into the packaged
HyppoVisor application, with its license identifier and full license text. It is
regenerated on every \`npm run dist\`.

`;

/**
 * @param {Array<{ name: string, version: string, spdx: string, repository: string, licenseText: string }>} entries
 * @returns {string}
 */
export function renderInventory(entries) {
  const sorted = [...entries].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
  );
  const sections = sorted.map((e) => {
    const text = (e.licenseText || "").replace(/\r\n/g, "\n").replace(/\s+$/, "");
    return (
      `## ${e.name}@${e.version}\n` +
      `License: ${e.spdx || "UNKNOWN"}\n` +
      `Repository: ${e.repository || "(none)"}\n\n` +
      `${text}\n`
    );
  });
  return HEADER + sections.join("\n---\n\n") + "\n";
}

/** The Electron-runtime ffmpeg entry — fixed, not from npm. */
const FFMPEG_ENTRY = {
  name: "ffmpeg",
  version: "bundled-with-electron",
  spdx: "LGPL-2.1-or-later",
  repository: "https://ffmpeg.org/",
  licenseText:
    "The Electron runtime bundles libffmpeg.dylib, licensed under the GNU Lesser\n" +
    "General Public License v2.1 or later. It ships as a standalone, dynamically\n" +
    "linked library and is replaceable — see PACKAGING.md for the relink steps.\n" +
    "Full text: https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html",
};

function spdxOf(info) {
  return Array.isArray(info.licenses) ? info.licenses.join(" OR ") : info.licenses || "UNKNOWN";
}

function repoOf(info) {
  return typeof info.repository === "string" ? info.repository : "";
}

function textOf(info) {
  if (info.licenseFile) {
    try {
      return readFileSync(info.licenseFile, "utf8");
    } catch {
      /* fall through */
    }
  }
  return `No bundled license file; see the ${spdxOf(info)} license text at https://spdx.org/licenses/.`;
}

function gatherEntries(projectRoot, selfId) {
  const checker = require("license-checker-rseidelsohn");
  return new Promise((resolve, reject) => {
    checker.init(
      { start: projectRoot, production: true, excludePackages: selfId },
      (err, packages) => {
        if (err) return reject(err);
        const entries = Object.entries(packages).map(([pkg, info]) => {
          const at = pkg.lastIndexOf("@");
          return {
            name: pkg.slice(0, at),
            version: pkg.slice(at + 1),
            spdx: spdxOf(info),
            repository: repoOf(info),
            licenseText: textOf(info),
          };
        });
        entries.push(FFMPEG_ENTRY);
        resolve(entries);
      },
    );
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const self = require(fileURLToPath(new URL("../package.json", import.meta.url)));
  const outPath = fileURLToPath(new URL("../THIRD-PARTY-LICENSES", import.meta.url));

  gatherEntries(root, `${self.name}@${self.version}`)
    .then((entries) => {
      writeFileSync(outPath, renderInventory(entries));
      console.error(
        `[gen-third-party-licenses] wrote THIRD-PARTY-LICENSES — ${entries.length} entries.`,
      );
    })
    .catch((err) => {
      console.error(
        `[gen-third-party-licenses] failed: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    });
}
