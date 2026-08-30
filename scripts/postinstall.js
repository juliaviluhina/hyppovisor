// Ensure the Electron binary is actually present after `npm install`.
//
// Three failure modes this works around, all of which leave `npm start`
// crashing with "Electron failed to install correctly" and no useful hint:
//
//   1. npm (>= 11.5) gates *dependency* lifecycle scripts, so Electron's own
//      postinstall (the ~170 MB download) is skipped with an "allowScripts"
//      warning. A root-package postinstall like this one always runs.
//   2. Electron's install.js early-returns when node_modules/electron/dist
//      merely exists — including a broken partial from an interrupted run.
//   3. `extract-zip` (used by Electron's installer) can silently no-op on very
//      new Node versions: the zip downloads and is cached, but never unpacks.
//      We detect that and unpack the cached zip ourselves with `tar`.
//
// No-ops cleanly when Electron isn't present (e.g. `npm install --omit=dev`).

import { existsSync, rmSync, mkdirSync, readFileSync, globSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";

const strict = process.argv.includes("--strict");
const electronDir = fileURLToPath(new URL("../node_modules/electron/", import.meta.url));
const installer = `${electronDir}install.js`;
const marker = `${electronDir}path.txt`;
const distDir = `${electronDir}dist`;

if (!existsSync(installer)) {
  console.error("[postinstall] electron package not present — skipping binary download");
  process.exit(0);
}
if (existsSync(marker)) process.exit(0); // already installed

const { version } = JSON.parse(readFileSync(`${electronDir}package.json`, "utf8"));
const platform = process.platform === "darwin" ? "darwin" : process.platform;
const arch = process.arch;
const binRelPath =
  process.platform === "darwin"
    ? "Electron.app/Contents/MacOS/Electron"
    : process.platform === "win32"
      ? "electron.exe"
      : "electron";

// Clear any half-written download output so install.js does real work.
for (const stale of ["dist", "path.txt"]) rmSync(`${electronDir}${stale}`, { recursive: true, force: true });

// install.js exits early and silently if this is set anywhere in the env
// (dotfiles, corporate setup, CI). Strip every variant for the child.
const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) {
  if (/electron.*skip.*binary.*download/i.test(key)) delete childEnv[key];
}

console.error(`[postinstall] fetching the Electron ${version} runtime…`);
try {
  execFileSync(process.execPath, [installer], { stdio: "inherit", env: childEnv });
} catch (err) {
  console.error(`[postinstall] installer error: ${err instanceof Error ? err.message : String(err)}`);
}

// Fallback: installer "succeeded" but produced no binary (extract-zip no-op).
// Find the zip it cached and unpack it with tar (bsdtar handles zip on
// macOS/Linux/Windows-10+).
if (!existsSync(marker)) {
  const cacheRoots = [
    process.env.electron_config_cache,
    process.env.ELECTRON_CACHE,
    process.platform === "darwin" && join(homedir(), "Library", "Caches", "electron"),
    process.platform === "linux" && join(homedir(), ".cache", "electron"),
    process.platform === "win32" && join(homedir(), "AppData", "Local", "electron", "Cache"),
  ].filter((v) => typeof v === "string");

  const zipName = `electron-v${version}-${platform}-${arch}.zip`;
  let zip;
  for (const root of cacheRoots) {
    if (!existsSync(root)) continue;
    const hit = globSync(`**/${zipName}`, { cwd: root }).map((p) => join(root, p));
    zip = hit.find((p) => statSync(p).size > 40 * 1024 * 1024);
    if (zip) break;
  }

  if (zip) {
    console.error(`[postinstall] extract-zip produced nothing; unpacking ${zipName} with tar`);
    mkdirSync(distDir, { recursive: true });
    try {
      execFileSync("tar", ["-xf", zip, "-C", distDir], { stdio: "inherit" });
      if (existsSync(join(distDir, binRelPath))) {
        execFileSync("node", ["-e", `require('fs').writeFileSync(${JSON.stringify(marker)}, ${JSON.stringify(binRelPath)})`]);
      }
    } catch (err) {
      console.error(`[postinstall] tar fallback failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

if (!existsSync(marker)) {
  console.error(
    "\n[postinstall] Electron runtime not installed. With network available, run:\n" +
      "  rm -rf ~/Library/Caches/electron node_modules/electron/dist node_modules/electron/path.txt\n" +
      "  node node_modules/electron/install.js\n" +
      "and if that leaves no node_modules/electron/dist, unpack the cached zip by hand:\n" +
      `  ZIP=$(ls ~/Library/Caches/electron/*/${`electron-v${version}-${platform}-${arch}.zip`})\n` +
      "  mkdir -p node_modules/electron/dist && tar -xf \"$ZIP\" -C node_modules/electron/dist\n" +
      `  printf '${binRelPath}' > node_modules/electron/path.txt\n`,
  );
  process.exit(strict ? 1 : 0);
}

console.error("[postinstall] Electron runtime ready.");
