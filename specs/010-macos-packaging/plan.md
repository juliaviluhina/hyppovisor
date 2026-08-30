# Implementation Plan: macOS Packaging & Release

**Branch**: `plan-010-macos-packaging` (feature dir `specs/010-macos-packaging`) |
**Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-macos-packaging/spec.md`

## Summary

Add `npm run dist`: compile → license gate → generate `THIRD-PARTY-LICENSES` → package with
`electron-builder` into per-architecture (`arm64`, `x64`) `.dmg` + `.zip` in a git-ignored
`release/` directory. The bundle carries the app icon (generated from `build/icon.png`), the
manifest version, `LICENSE`, `NOTICE`, and the generated `THIRD-PARTY-LICENSES`. The license
gate fails the build on any non-permissive or unclassifiable bundled dependency. The
LGPL `libffmpeg.dylib` inside the Electron runtime is already a standalone dynamic library —
the work there is a `PACKAGING.md` note recording the replace/relink path. The first release
is **unsigned**; `README.md` gains a Download/Install section with Gatekeeper steps and
which download matches Apple Silicon vs Intel. The four tracked brand PNGs are losslessly
squeezed and re-committed; the now-redundant hand-built `build/icon.icns` +
`build/icon.iconset/` are deleted once `electron-builder`'s generated icon is verified
equivalent.

No runtime code changes, no MCP tool, no persistent app state, no service. `src/**` is
untouched except the tracked PNG bytes.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node ≥ 22 (unchanged). Packaging is Node scripts +
`electron-builder` config (YAML). Electron 33.

**Primary Dependencies**: NEW devDependencies — `electron-builder` (packaging: `.app`,
`.dmg`, `.zip`, `.icns` generation, per-arch), `license-checker-rseidelsohn` (maintained
license-checker fork, for the gate + inventory). One-time lossless PNG optimization via
`oxipng` (developer tool, documented — not a committed dependency). No new **runtime**
dependencies; `dependencies` stays `@modelcontextprotocol/sdk` + `zod`.

**Storage**: None. `release/` is transient build output (git-ignored), not app state. No
change to `userData` or the shared data directory.

**Testing**: `vitest` unit — `scripts/check-licenses.js` classifier (permissive → pass;
copyleft → fail-with-name; `UNKNOWN` / missing → fail) and `scripts/gen-third-party-licenses.js`
(deterministic ordering; every production dependency represented; license text included),
both driven with a synthetic dependency→license map so they need no real `node_modules`.
Manual / scripted smoke per `quickstart.md` — a real `npm run dist` on macOS, then mount one
`.dmg` and launch. Existing unit + `_electron` e2e suites are unchanged and remain the
guarantee that the packaged app behaves like the from-source app (FR-009).

**Target Platform**: macOS 12+ (arm64 and x64), packaged on a macOS host. Windows/Linux
explicitly out of scope (FR-011).

**Project Type**: Single project — packaging config + `scripts/**` + docs. No `src/**`
logic change.

**Performance Goals**: `npm run dist` from a warm `node_modules` completes both
architectures in under 15 minutes (SC-001). The license gate is seconds. PNG squeeze is a
one-time offline pass.

**Constraints**: No network during packaging beyond the prior `npm install` (FR-004) —
`electron-builder` must use the already-fetched Electron binary (set
`ELECTRON_BUILDER_CACHE` / rely on the local `electron` devDep; `electronDist` points at
`node_modules/electron/dist` if needed). Fail fast on a non-macOS host or missing
prerequisite (FR-013). One installable app per architecture (Principle III — argued below).

**Scale/Scope**: ~4 new scripts, one `electron-builder.yml`, one `PACKAGING.md`, README +
BRANCH­ING.md edits, `.gitignore` + `package.json` edits, 2 files deleted, 4 PNGs shrunk.

## Constitution Check

*GATE: re-checked after Phase 1 design — still passing.*

### I. Human Does Every External Act — PASS

Build/release tooling. Nothing here opens a page, submits, sends, or authenticates.

### II. Zero Business Logic in HyppoVisor — PASS

No judgement added. The license gate is a mechanical allowlist check, not interpretation of
job/career data.

### III. Solid and Comprehensible — PASS (per-arch argued; new build output noted)

- **"One installable artifact"**: a user installs exactly one `HyppoVisor.app`. Building it
  for `arm64` and `x64` (each wrapped in a `.dmg` and a `.zip` of identical content) is a
  delivery detail — there is one product, one window, one entry point. This is the standard
  reading for a cross-architecture desktop app and does not redefine Principle III.
- **New build output** `release/` is transient, git-ignored, and not app state — it is the
  output of a command, deleted freely. No database, no service, no daemon.
- **New devDependencies** (`electron-builder`, `license-checker-rseidelsohn`) are build-time
  only; they never ship in the bundle's runtime code. Justified in Complexity Tracking.
- The packaging path is one documented command (`npm run dist`) plus one config file plus
  small single-purpose scripts — "the smallest mechanism that works" for a
  signed-capable, icon-generating, per-arch dmg pipeline.

### IV. User-Held Credentials and Sessions — PASS

Signing/notarization (which would introduce an Apple Developer credential) is **deferred**
to a follow-up. This feature handles no certificate, no secret, no credential.

### V. Assistive Pace, Not Bulk Collection — PASS

No page content, no reads, no data-directory writes. Irrelevant to this feature except that
it does not violate it.

### Architecture Constraints / Licensing — PASS (this is the feature's core)

- `THIRD-PARTY-LICENSES` is generated for every bundled (production) dependency and ships
  inside the app (FR-005, FR-006).
- The packaging build **fails** on any non-permissive or unclassifiable bundled license
  (FR-007) — enforcing the "permissive dependency tree" constraint at build time.
- The LGPL `libffmpeg.dylib` inside the Electron runtime stays a standalone, dynamically
  loaded library (electron-builder does not relink it); `PACKAGING.md` records how a user
  replaces it (FR-008).
- `hyppovisor` gains no dependency on `hyppograph`. MCP surface untouched.

## Project Structure

### Documentation (this feature)

```text
specs/010-macos-packaging/
├── plan.md
├── research.md          # Phase 0 — decisions R1–R9
├── data-model.md        # Phase 1 — artifacts, config keys, the license allowlist
├── quickstart.md        # Phase 1 — the real dist run + verification checklist
├── contracts/
│   └── dist-command.md  # Phase 1 — `npm run dist` inputs / outputs / exit codes / gate
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Repository (root)

```text
electron-builder.yml            # NEW — appId, productName HyppoVisor, mac dmg+zip,
                                #   arch [arm64, x64], directories.output release/,
                                #   buildResources build/, files globs, extraResources
                                #   (LICENSE, NOTICE, THIRD-PARTY-LICENSES)
PACKAGING.md                    # NEW — the dist runbook, the libffmpeg replace/relink
                                #   path, the unsigned/Gatekeeper posture, per-arch notes
scripts/
├── dist-preflight.js           # NEW — darwin check, electron-binary check, icon master
│                               #   present + 1024² check; fail fast (FR-013)
├── check-licenses.js           # NEW — license-checker over --production deps; classify
│                               #   against the permissive allowlist; exit 1 naming any
│                               #   offender / UNKNOWN (FR-007)
├── gen-third-party-licenses.js # NEW — write ./THIRD-PARTY-LICENSES (deterministic order,
│                               #   name + SPDX id + full license text per dep) (FR-005)
└── smoke-package.js            # NEW (best-effort) — extract the arm64 .zip to a temp dir,
                                #   launch the .app, assert a window / MCP port, kill
package.json                    # + devDeps electron-builder, license-checker-rseidelsohn;
                                #   + scripts: dist, licenses:check, licenses:gen
.gitignore                      # + release/  + THIRD-PARTY-LICENSES (generated)
README.md                       # + Download / Install section (per-arch which-download,
                                #   unsigned notice, Gatekeeper steps); Requirements note
assets/BRANDING.md              # icon master is now build/icon.png only; PNG squeeze note;
                                #   .icns/.iconset regenerated by electron-builder
build/
├── icon.png                    # MODIFIED — losslessly squeezed (stays the master)
├── icon.icns                   # DELETED — electron-builder generates it from icon.png
└── icon.iconset/               # DELETED — intermediate, no longer needed
assets/hyppovisor.png           # MODIFIED — losslessly squeezed
src/renderer/mascot.png         # MODIFIED — losslessly squeezed
src/renderer/hyppo.png          # MODIFIED — losslessly squeezed

tests/unit/
├── check-licenses.test.ts      # NEW — allowlist pass; copyleft fail-with-name; UNKNOWN fail
└── gen-third-party-licenses.test.ts  # NEW — deterministic order; covers all prod deps;
                                      #   includes license text
```

**Structure Decision**: single project; all new files are build config / scripts / docs at
the repo root and under `scripts/`. `src/**` logic is untouched. The two license scripts are
plain Node (no TS build step) so `vitest` drives them directly, matching how
`scripts/postinstall.js` is already structured.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| devDep `electron-builder` (large) | It is the de-facto standard: one config yields `.app` + `.dmg` + `.zip` + generated `.icns`, per-arch, and is the natural place signing/notarization plug in later. | `electron-packager` + hand-rolled `.icns` (`iconutil`), `.dmg` (`hdiutil`/`create-dmg`), and `.zip` scripting: rejected — several hundred lines of shell to maintain, no signing story, more drift. `electron-forge`: comparable size, less direct control of the per-arch + extraResources layout. |
| devDep `license-checker-rseidelsohn` | The constitution requires a `THIRD-PARTY-LICENSES` inventory and a permissive-only tree; a maintained scanner produces both the classification and the license-text dump deterministically. | Hand-walking `node_modules/*/package.json`: rejected — misses `LICENSE` file variance, dual licenses, and SPDX normalization the scanner already handles. |
| New `release/` output dir | `electron-builder`'s default output collides with our `dist/` (TypeScript output). A distinct git-ignored dir keeps them separate. | Reusing `dist/`: rejected — the compile step cleans/writes `dist/`; mixing packaged artifacts there invites accidental commits and clean races. |
| `PACKAGING.md` (new doc) | The libffmpeg relink path and the unsigned-release runbook are too long for the README and are maintainer-facing, not user-facing. | Putting it all in the README: rejected — buries user install steps under build minutiae. |
