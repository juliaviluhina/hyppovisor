// Copies static renderer assets (HTML) into dist/ after tsc runs.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pairs = [
  ["src/renderer/index.html", "dist/renderer/index.html"],
  ["src/preload/chrome.cjs", "dist/preload/chrome.cjs"],
];

for (const [from, to] of pairs) {
  mkdirSync(dirname(resolve(root, to)), { recursive: true });
  copyFileSync(resolve(root, from), resolve(root, to));
  console.error(`copied ${from} -> ${to}`);
}
