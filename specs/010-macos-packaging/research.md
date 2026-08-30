# Phase 0 Research: macOS Packaging & Release

Nine decisions, all settled (the clarify session resolved signing / CI / arch). Format:
**Decision / Rationale / Alternatives rejected**.

---

## R1 — `electron-builder`, config in `electron-builder.yml`

**Decision**: add `electron-builder` as a devDependency; configure it in a top-level
`electron-builder.yml` (not the `package.json` `build` key). Key config:

```yaml
appId: com.juliaviluhina.hyppovisor
productName: HyppoVisor
directories:
  output: release
  buildResources: build          # electron-builder reads build/icon.png → generates .icns
files:
  - dist/**
  - package.json
  - "!**/*.map"
mac:
  category: public.app-category.developer-tools
  target:
    - target: dmg
      arch: [arm64, x64]
    - target: zip
      arch: [arm64, x64]
  artifactName: ${productName}-${version}-${arch}.${ext}
extraResources:
  - LICENSE
  - NOTICE
  - THIRD-PARTY-LICENSES
electronDist: node_modules/electron/dist   # no network fetch (FR-004)
```

**Rationale**: one file produces `.app` + `.dmg` + `.zip`, generates the `.icns` from a
single PNG, does per-arch in one invocation, and is where `mac.notarize` / `mac.identity`
slot in for the later signing follow-up. `electronDist` pins the already-installed runtime
so packaging needs no network.

**Alternatives rejected**: `package.json` `build` key → the manifest is already tidy and
`"type": "module"`; a YAML file keeps packaging config out of it. `electron-forge` /
`electron-packager` → see plan Complexity Tracking.

---

## R2 — `npm run dist` pipeline order

**Decision**:

```json
"dist": "node scripts/dist-preflight.js && npm run build && npm run licenses:check && npm run licenses:gen && electron-builder --mac",
"licenses:check": "node scripts/check-licenses.js",
"licenses:gen": "node scripts/gen-third-party-licenses.js"
```

Order matters: **preflight** (fail fast on wrong host / missing prereq) → **compile**
(`dist/**` must exist for `files`) → **license gate** (fail before any artifact) →
**generate `THIRD-PARTY-LICENSES`** (must exist before `electron-builder` copies it via
`extraResources`) → **package**.

**Rationale**: the gate runs before packaging so a bad license never yields an artifact
(FR-007). The inventory is generated fresh every run so it can't drift (SC-006). `--mac`
with both arch targets in the YAML produces all four files.

**Alternatives rejected**: generating the inventory as an `electron-builder` `afterPack`
hook → runs too late to be a pre-artifact gate and complicates `extraResources`.

---

## R3 — license gate + inventory (`license-checker-rseidelsohn`)

**Decision**: `scripts/check-licenses.js` runs the checker over **production** dependencies
only (`--production`), normalizes SPDX ids, and classifies each against a fixed permissive
allowlist:

```
MIT, MIT-0, ISC, 0BSD, BSD-2-Clause, BSD-3-Clause, Apache-2.0, BlueOak-1.0.0,
CC0-1.0, CC-BY-4.0, Unlicense, Python-2.0, WTFPL
```

Anything else, `UNKNOWN`, a missing license field, or an unparseable expression ⇒ **exit 1**
naming the package, version, and detected license (fail closed — spec edge case).
`scripts/gen-third-party-licenses.js` writes `./THIRD-PARTY-LICENSES`: a header, then one
section per production dependency **sorted by name**, each with `name@version`, SPDX id,
repository URL, and the full license text (read from the package's `LICENSE`* file; fall
back to the SPDX template only if absent). Deterministic — same tree ⇒ byte-identical
output (SC-006).

**Rationale**: production-only is the correct bundle scope (devDeps never ship).
`license-checker-rseidelsohn` is the maintained fork and emits both the classification data
and file paths in one pass. Sorting by name is the determinism guarantee.

**Alternatives rejected**: `--summary` only (no text) → FR-005 wants the license *text*, not
just the identifier. Scanning all deps incl. dev → over-broad; would gate on tooling that
never ships.

---

## R4 — LGPL `libffmpeg.dylib` — already compliant, document the swap

**Decision**: no build change. The Electron runtime ships
`Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib` as a **standalone,
dynamically-loaded** library; `electron-builder` copies the framework verbatim and does not
relink it. `PACKAGING.md` documents the replace path: build a compatible `libffmpeg.dylib`
(matching the bundled Chromium's version), replace the file at that path inside
`HyppoVisor.app/Contents/Frameworks/...`, re-sign if the app is signed. `THIRD-PARTY-LICENSES`
lists ffmpeg as `LGPL-2.1-or-later` with a note pointing at that section (the allowlist does
**not** include LGPL for app code, but the dynamically-linked-and-replaceable system library
is the constitution's explicitly permitted carve-out — the gate script whitelists this one
known path by name, not by adding LGPL to the general allowlist).

**Rationale**: FR-008 is satisfied by Electron's own packaging; the deliverable is the
documented relink path and the honest inventory entry. Special-casing ffmpeg by exact
identity (not by broadening the allowlist) keeps the gate strict for everything else.

**Alternatives rejected**: stripping/rebuilding ffmpeg → out of scope, and the constitution
explicitly wants it shipped-but-replaceable, not removed.

---

## R5 — icon: `build/icon.png` is the sole master

**Decision**: `electron-builder` generates the `.icns` at package time from
`build/icon.png` (1024²) via `directories.buildResources: build`. Delete the tracked
`build/icon.icns` and `build/icon.iconset/` **after** a real `npm run dist` confirms the
packaged `.app` shows the icon at every size (US4 AS2 / FR-012). Runtime
`BrowserWindow({ icon })` keeps using `build/icon.png` (bundled via `files`), unchanged.
`assets/BRANDING.md` is updated: master = `build/icon.png`; `.icns`/`.iconset` are
build-time artifacts, not tracked.

**Rationale**: one master, no hand-run `iconutil` step to keep in sync. The `.icns` is fully
derivable.

**Alternatives rejected**: keeping the hand-built `.icns` and pointing `electron-builder` at
it → two icon sources to keep consistent, exactly the redundancy the issue calls out.

---

## R6 — lossless PNG optimization, one-time

**Decision**: run `oxipng -o4 --strip safe` once over `build/icon.png`,
`assets/hyppovisor.png`, `src/renderer/mascot.png`, `src/renderer/hyppo.png`; verify each is
byte-smaller and visually identical; re-commit. `oxipng` is a **developer tool** (install
via `brew install oxipng` / `cargo install oxipng`), not a committed dependency and not a
build step. `assets/BRANDING.md` gains the command and a note that the pipeline can also
regenerate them from the master.

**Rationale**: lossless (as the spec requires), one-time repo hygiene, no new dependency in
`package.json`, no per-build cost. `-o4 --strip safe` typically reclaims 40–60% on
flat-colour PNGs (SC-008 target ≥ 40%).

**Alternatives rejected**: a committed `sharp` / `imagemin` devDep + a build step → adds a
heavy native dep and per-build work for a one-time cleanup. `pngquant` → lossy; spec says
lossless.

---

## R7 — packaging smoke check

**Decision**: `scripts/smoke-package.js` (best-effort, not in the `dist` gate): unzip
`release/HyppoVisor-<version>-arm64-mac.zip` to a temp dir, spawn
`HyppoVisor.app/Contents/MacOS/HyppoVisor` with an isolated `HYPPO_USER_DATA_DIR` and a test
MCP port, poll the port for readiness, then terminate. Run it manually per `quickstart.md`
on the build host. The authoritative behavioural guarantee stays the from-source
`_electron` e2e suite (FR-009: packaging changes no behaviour).

**Rationale**: a full automated post-package launch test is environment-heavy and slow;
a scripted smoke plus the unchanged e2e suite is proportionate for a local-only release
flow.

**Alternatives rejected**: a Playwright test that drives the packaged `.app` → duplicates
the from-source e2e against a much slower target for little extra assurance.

---

## R8 — version stamping

**Decision**: nothing to build. `electron-builder` reads `version` from `package.json` into
`CFBundleShortVersionString` / `CFBundleVersion`. `scripts/smoke-package.js` (and a
`quickstart.md` step) asserts `defaults read .../Contents/Info CFBundleShortVersionString`
equals `package.json`'s `version` (SC-003).

**Rationale**: use the tool's built-in behaviour; just verify it.

---

## R9 — fail-fast preflight

**Decision**: `scripts/dist-preflight.js` checks, in order: `process.platform === "darwin"`
(else exit 1 "macOS required"); `node_modules/electron/dist` present (reuse
`scripts/postinstall.js`'s detection; else "run npm install"); `build/icon.png` exists and
is 1024×1024 (else "icon master missing/wrong size"). Any failure exits non-zero within
seconds and writes nothing to `release/` (SC-010, FR-013).

**Rationale**: `electron-builder` does eventually error on a non-mac target, but late and
cryptically; a two-second preflight with specific messages is the comprehensible path
(Principle III).

---

## Config / data (see `data-model.md`)

- `electron-builder.yml` keys (R1).
- The permissive-license allowlist (R3) — a fixed array in `scripts/check-licenses.js`.
- `.gitignore` additions: `release/`, `THIRD-PARTY-LICENSES`.
- `package.json`: devDeps + `dist` / `licenses:*` scripts.
