# Quickstart / Validation: macOS Packaging & Release

Validation runs for feature 010. Steps 1–2 are automated (unit); steps 3+ are a real
packaging run on a macOS host.

## Prerequisites

- macOS 12+ host (arm64 or x64).
- `npm install` completed (pulls deps + the Electron runtime binary).
- `oxipng` available for the one-time PNG pass (`brew install oxipng`).

## 1. Unit — the license gate

```bash
npx vitest run tests/unit/check-licenses.test.ts
```

Expect: a synthetic dependency map with all-permissive licenses → the classifier returns
"pass"; a map containing `GPL-3.0` → returns "fail" naming that package; a map with a
`UNKNOWN` / missing license → "fail" (fail closed).

## 2. Unit — the inventory generator

```bash
npx vitest run tests/unit/gen-third-party-licenses.test.ts
```

Expect: given a synthetic dep map, the generated text lists every dependency, sorted by
name, each with `name@version`, SPDX id, and license text; running it twice on the same
input yields byte-identical output.

## 3. Preflight fails fast where it should

```bash
# On a non-macOS host (or simulate): 
node scripts/dist-preflight.js        # exits non-zero, message "macOS required", release/ untouched

# Temporarily rename build/icon.png:
mv build/icon.png build/icon.png.bak && node scripts/dist-preflight.js   # exits non-zero, "icon master missing"
mv build/icon.png.bak build/icon.png
```

## 4. Full packaging run

```bash
npm run dist
```

Expect (SC-001, ≤ 15 min):

- `release/` contains `HyppoVisor-<version>-arm64.dmg`, `HyppoVisor-<version>-arm64-mac.zip`,
  `HyppoVisor-<version>-x64.dmg`, `HyppoVisor-<version>-x64-mac.zip`.
- `./THIRD-PARTY-LICENSES` was (re)written; run `npm run licenses:gen` again and confirm
  `git diff --stat THIRD-PARTY-LICENSES` shows no change (SC-006).

## 5. Inspect a bundle

```bash
hdiutil attach "release/HyppoVisor-$(node -p "require('./package.json').version")-arm64.dmg"
APP="/Volumes/HyppoVisor "*"/HyppoVisor.app"   # adjust to the mounted volume name
defaults read "$APP/Contents/Info" CFBundleShortVersionString   # == package.json version (SC-003)
ls "$APP/Contents/Resources" | grep -E 'LICENSE|NOTICE|THIRD-PARTY-LICENSES'   # all three (SC-004)
find "$APP" -name 'libffmpeg.dylib'   # present as a standalone file (SC-007)
hdiutil detach "/Volumes/HyppoVisor "*
```

## 6. License gate actually blocks

```bash
# Add a copyleft dep to a scratch branch:
npm i --save some-gpl-package         # any package published under GPL-3.0
npm run dist                          # MUST exit 1, name the package + license, write no artifact
git checkout package.json package-lock.json && npm install
```

## 7. Install as an end user would

On a second macOS machine (matching architecture), download the `.dmg`, then:

```bash
xattr -dr com.apple.quarantine ~/Downloads/HyppoVisor-*.dmg   # or right-click → Open
```

Mount, drag to Applications, launch. Expect a window; the README's Download/Install section
matches these steps and states the build is unsigned (SC-002).

## 8. Icon-master cleanup verified

After step 4 confirms the packaged `.app` shows the icon at every size, remove the redundant
intermediates and re-run:

```bash
git rm -r build/icon.icns build/icon.iconset
npm run dist        # still produces an .app with the correct icon (US4 AS2)
```

## 9. PNG squeeze

```bash
oxipng -o4 --strip safe build/icon.png assets/hyppovisor.png src/renderer/mascot.png src/renderer/hyppo.png
git diff --stat        # each PNG smaller
npm run build && npm run test:e2e     # in-app + README images still render; no regression
```

Confirm total PNG bytes dropped ≥ 40% (SC-008).

## 10. No regression

```bash
npm run build && npm run lint && npm test && npm run test:e2e
```

All existing suites pass unchanged (`test:e2e` needs local port 7357 free).
