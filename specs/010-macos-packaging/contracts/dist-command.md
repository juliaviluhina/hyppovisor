# Contract — `npm run dist` (Feature 010)

## Invocation

```bash
npm install       # once — fetches deps + the Electron runtime binary
npm run dist       # macOS host only
```

No arguments, no interactive prompts, no network access during the run itself.

## Pipeline (stop on first failure)

1. `scripts/dist-preflight.js` — host is `darwin`; `node_modules/electron/dist` present;
   `build/icon.png` exists and is 1024×1024. Fail → exit non-zero, `release/` untouched.
2. `npm run build` — `tsc` + renderer `tsc` + asset copy → `dist/**`.
3. `npm run licenses:check` — scan production deps; every license in the permissive
   allowlist (plus the ffmpeg carve-out). Fail → exit 1 naming `package@version — <license>`,
   no artifact.
4. `npm run licenses:gen` — write `./THIRD-PARTY-LICENSES` (deterministic, name-sorted,
   full text).
5. `electron-builder --mac` — per config: `arm64` + `x64`, each `dmg` + `zip`, into
   `release/`.

## Outputs (on success)

`release/` contains:

| File | Notes |
|---|---|
| `HyppoVisor-<version>-arm64.dmg` | drag-to-Applications image, Apple Silicon |
| `HyppoVisor-<version>-arm64-mac.zip` | same bundle, archived |
| `HyppoVisor-<version>-x64.dmg` | Intel |
| `HyppoVisor-<version>-x64-mac.zip` | Intel |

Each `HyppoVisor.app`:

- `Contents/Info.plist` `CFBundleShortVersionString` == `package.json` `version`.
- Icon shown at all sizes (generated from `build/icon.png`).
- `Contents/Resources/{LICENSE, NOTICE, THIRD-PARTY-LICENSES}` present.
- `Contents/Frameworks/Electron Framework.framework/.../libffmpeg.dylib` present as a
  standalone dylib.
- Launches offline and behaves identically to the from-source app.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | four artifacts written to `release/` |
| non-zero from step 1 | wrong host / missing prerequisite — nothing written |
| `1` from step 3 | a bundled dependency is non-permissive / unclassifiable — named, nothing written |
| non-zero from step 2 or 5 | compile or packaging failure — surfaced verbatim |

## Not in this contract (deferred follow-ups)

- Code signing / notarization (`mac.identity`, `mac.notarize`) — unset; the release is
  unsigned and `README.md` + `PACKAGING.md` carry the Gatekeeper steps.
- A tagged CI release job — `npm run dist` is run by a maintainer locally; artifacts are
  uploaded by hand.
- Windows / Linux targets.
- Auto-update (`latest-mac.yml` is emitted but unused).

## Documentation deliverables

- `README.md` — "Download / Install": which file for Apple Silicon vs Intel, the unsigned
  notice, and the exact Gatekeeper steps (`xattr -dr com.apple.quarantine` /
  right-click → Open).
- `PACKAGING.md` — the `npm run dist` runbook, the `libffmpeg.dylib` replace/relink path,
  and the signing-follow-up placeholder.
- `assets/BRANDING.md` — `build/icon.png` is the sole icon master; `.icns` / `.iconset` are
  generated; the one-time `oxipng` command.
