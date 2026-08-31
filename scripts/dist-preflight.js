// Fail-fast guard for `npm run dist` (feature 010, R9 / FR-013).
//
// Runs before anything touches `release/`: wrong host, a missing Electron
// runtime, or a missing / wrong-size icon master each exit non-zero within
// seconds with a specific message and write nothing.
//
// The verdict logic is a pure function so `tests/unit/dist-preflight.test.ts`
// can drive every branch; the script below only reads the real environment and
// prints / exits.

import { existsSync, readFileSync, readSync, openSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @param {{ platform: string, electronDistExists: boolean, iconWidth: number, iconHeight: number }} env
 * @returns {{ ok: boolean, message: string }}
 */
export function preflightVerdict({ platform, electronDistExists, iconWidth, iconHeight }) {
  if (platform !== "darwin") {
    return { ok: false, message: "macOS required for this packaging target." };
  }
  if (!electronDistExists) {
    return { ok: false, message: "Electron runtime not found — run npm install." };
  }
  if (iconWidth !== 1024 || iconHeight !== 1024) {
    return {
      ok: false,
      message: `icon master missing or wrong size — build/icon.png must be 1024×1024 (got ${iconWidth}×${iconHeight}).`,
    };
  }
  return { ok: true, message: "preflight ok" };
}

/** Read a PNG's pixel dimensions from its IHDR chunk. Returns {0,0} if unreadable. */
function pngSize(path) {
  if (!existsSync(path)) return { width: 0, height: 0 };
  let fd;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(24);
    readSync(fd, buf, 0, 24, 0);
    // 8-byte signature, then a 4-byte length + "IHDR", then width/height (BE u32).
    if (buf.toString("latin1", 12, 16) !== "IHDR") return { width: 0, height: 0 };
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    return { width: 0, height: 0 };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function electronDistExists() {
  // Mirrors scripts/postinstall.js: the runtime is ready when the marker exists
  // and the dist directory is present.
  const dir = fileURLToPath(new URL("../node_modules/electron/", import.meta.url));
  if (existsSync(`${dir}path.txt`)) {
    try {
      const rel = readFileSync(`${dir}path.txt`, "utf8").trim();
      if (rel && existsSync(`${dir}dist/${rel}`)) return true;
    } catch {
      /* fall through */
    }
  }
  return existsSync(`${dir}dist`);
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const iconPath = fileURLToPath(new URL("../build/icon.png", import.meta.url));
  const { width, height } = pngSize(iconPath);
  const verdict = preflightVerdict({
    platform: process.platform,
    electronDistExists: electronDistExists(),
    iconWidth: width,
    iconHeight: height,
  });
  if (!verdict.ok) {
    console.error(`[dist-preflight] ${verdict.message}`);
    process.exit(1);
  }
  console.error("[dist-preflight] ok — macOS host, Electron runtime present, icon master 1024×1024.");
}
