# Packaging & Release (macOS)

`npm run dist` turns a clean, dependency-installed checkout into a distributable
macOS application. macOS host only. No interactive prompts, no network access
during the run itself.

## Prerequisites

- macOS 12+ (Apple Silicon or Intel).
- `npm install` completed — pulls dependencies and the Electron runtime binary.
- For the one-time brand-PNG squeeze: `oxipng` (`brew install oxipng`). Not a
  build step, not a committed dependency.

## Run it

```bash
npm run dist
```

Pipeline (stops on first failure):

1. **`scripts/dist-preflight.js`** — host is `darwin`, `node_modules/electron/dist`
   is present, `build/icon.png` exists and is 1024×1024. Fail → exit non-zero,
   `release/` untouched.
2. **`npm run build`** — `tsc` × 2 + asset copy → `dist/**`.
3. **`npm run licenses:check`** — scans production dependencies; every license
   must be in the permissive allowlist (`scripts/check-licenses.js`). Fail →
   exit 1 naming `package@version — <license>`, no artifact.
4. **`npm run licenses:gen`** — writes `./THIRD-PARTY-LICENSES` (deterministic,
   name-sorted, full text).
5. **`electron-builder --mac`** — per `electron-builder.yml`: `arm64` + `x64`,
   each `dmg` + `zip`, into `release/`.

## Outputs

`release/` holds four artifacts (plus harmless `latest-mac.yml` / `*.blockmap`):

| File | For |
|---|---|
| `HyppoVisor-<version>-arm64.dmg` | Apple Silicon, disk image |
| `HyppoVisor-<version>-arm64.zip` | Apple Silicon, archive |
| `HyppoVisor-<version>-x64.dmg` | Intel, disk image |
| `HyppoVisor-<version>-x64.zip` | Intel, archive |

`<version>` is `package.json`'s `version` verbatim. Each `HyppoVisor.app` carries
the icon at every size, reports that version, and includes
`Contents/Resources/{LICENSE, NOTICE, THIRD-PARTY-LICENSES}`.

> **Cross-arch note:** `electronDist` pins the locally-installed runtime. To
> produce a genuine Intel build on an Apple Silicon host (or vice-versa), unset
> `electronDist` in `electron-builder.yml` for that run so electron-builder
> fetches the matching runtime — that run is not offline.

## Distributing

### Automated (preferred) — tag a release

`.github/workflows/release.yml` builds the artifacts on native runners (`arm64`
on Apple Silicon, `x64` on Intel — so each is a genuine per-arch build) and
attaches them to a GitHub Release:

```bash
npm version patch          # or minor / major — bumps package.json, commits, tags
git push --follow-tags
```

Pushing a `v*` tag runs lint + unit tests, then both `dist` jobs, then publishes
the Release with the four `.dmg` / `.zip` files and an unsigned-build header. A
manual **Run workflow** (workflow_dispatch) builds the artifacts without cutting
a Release. Set `draft: true` in the workflow to stage releases for review first.

### By hand

Run `npm run dist` locally and upload the four `release/` artifacts to a
[GitHub Release](https://github.com/juliaviluhina/hyppovisor/releases).

## Replacing the bundled `libffmpeg.dylib` (LGPL)

The Electron runtime ships FFmpeg as a standalone, dynamically-linked library —
the constitution's explicitly permitted replaceable-system-library carve-out. It
is **not** statically linked into application code, and it is the only non-
permissive license in the bundle (`THIRD-PARTY-LICENSES` lists it as
`LGPL-2.1-or-later`).

To swap in your own build:

1. Build a `libffmpeg.dylib` matching the bundled Chromium's FFmpeg version
   (see the Electron release notes for the Chromium version).
2. Replace the file at:
   ```
   HyppoVisor.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib
   ```
3. If the app is signed, re-sign the bundle (`codesign --force --deep --sign …`).
   This release is unsigned, so no re-sign is needed.

## Signing & notarization — deferred

This release is **unsigned and un-notarized**. End-user Gatekeeper steps are in
[the README's Download / Install section](README.md#download--install).

A future signed build slots into `electron-builder.yml` via `mac.identity` and
`mac.notarize` (needs an Apple Developer ID and CI secrets) — its own follow-up
issue. When it lands, mark the README's unsigned workaround as superseded.
