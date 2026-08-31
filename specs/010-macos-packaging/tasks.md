---

description: "Task list for feature 010 — macOS packaging & release"
---

# Tasks: macOS Packaging & Release

**Input**: Design documents in `specs/010-macos-packaging/` (`plan.md`, `spec.md`,
`research.md`, `data-model.md`, `contracts/dist-command.md`, `quickstart.md`)

**Tests**: included for the two pure scripts (license classifier, inventory generator) and
the preflight verdict. The rest of the feature is verified by real `npm run dist` runs on a
macOS host — those are explicit verification tasks, not automated tests.

**Organization**: by user story (spec priority): US1 one-command distributable (P1), US2
license-compliant (P1), US3 unsigned-install docs (P2), US4 PNG optimize + icon de-dup (P3).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: different file, no incomplete-task dependency
- **[Story]**: US1–US4; Setup / Foundational / Polish carry no label
- **⚙ macOS**: task requires a real packaging run on a macOS host

## Path Conventions

Repo root — `electron-builder.yml`, `PACKAGING.md`, `scripts/**`, `tests/unit/**`, docs.
No `src/**` logic change (only tracked-PNG bytes).

---

## Phase 1: Setup

- [x] T001 Add devDependencies to `package.json`: `electron-builder`,
  `license-checker-rseidelsohn`; run `npm install`; confirm no change to `dependencies`.
- [x] T002 [P] `.gitignore`: add `release/` and `THIRD-PARTY-LICENSES` (generated).

---

## Phase 2: Foundational (blocking)

- [x] T003 Create `scripts/dist-preflight.js`: export a pure
  `preflightVerdict({ platform, electronDistExists, iconWidth, iconHeight })` →
  `{ ok, message }` (non-`darwin` → fail "macOS required"; no electron dist → fail "run npm
  install"; icon not 1024×1024 → fail "icon master missing/wrong size"); the script reads the
  real environment (reuse `scripts/postinstall.js`'s electron-dist detection, `sips`/`file`
  or a PNG header read for the icon size), calls the pure fn, prints `message`, and
  `process.exit(1)` on failure — writing nothing.
- [x] T004 [P] `tests/unit/dist-preflight.test.ts`: drive `preflightVerdict` — each failure
  branch returns `ok:false` with the right message; all-good returns `ok:true`.

**Checkpoint**: fail-fast guard exists and is unit-proven.

---

## Phase 3: User Story 1 — one-command distributable (Priority: P1) 🎯 MVP

**Goal**: `npm run dist` on macOS produces `arm64` + `x64` `.dmg` + `.zip` in `release/`,
each a launchable `HyppoVisor.app` with the icon and the manifest version.

**Independent Test**: from a fresh clone on macOS, `npm install` then `npm run dist` → four
artifacts; a `.dmg` mounts to `HyppoVisor.app` (correct icon), version matches the manifest,
the app launches offline.

### Implementation for User Story 1

- [x] T005 [US1] Create `electron-builder.yml` per `data-model.md`: `appId`,
  `productName: HyppoVisor`, `directories.output: release`, `directories.buildResources: build`,
  `files` (`dist/**`, `package.json`, `!**/*.map`), `mac.target` = `dmg` + `zip` each
  `arch: [arm64, x64]`, `mac.artifactName: ${productName}-${version}-${arch}.${ext}`,
  `extraResources: [LICENSE, NOTICE]` (THIRD-PARTY-LICENSES added in US2),
  `electronDist: node_modules/electron/dist`.
- [x] T006 [US1] `package.json` scripts: add
  `"dist": "node scripts/dist-preflight.js && npm run build && electron-builder --mac"`
  (license steps spliced in by US2).
- [x] T007 [US1] ⚙ macOS — run `npm run dist`; verify `release/` holds the four artifacts
  named with version + arch; a `.dmg` mounts to `HyppoVisor.app`;
  `defaults read .../Contents/Info CFBundleShortVersionString` == `package.json` `version`;
  the app launches offline and opens a window (quickstart §4–§5).
- [x] T008 [US1] ⚙ macOS — confirm `electron-builder` generated `.icns` from
  `build/icon.png` and the packaged `.app` shows the icon at every size in Finder / the Dock
  (prerequisite for US4's deletion of the hand-built `.icns`).

**Checkpoint**: a distributable macOS app exists (license compliance layered next).

---

## Phase 4: User Story 2 — license-compliant distributable (Priority: P1)

**Goal**: the artifact carries `THIRD-PARTY-LICENSES` + `LICENSE` + `NOTICE`; `npm run dist`
fails on a non-permissive bundled license; the LGPL ffmpeg dylib stays standalone with a
documented replace path.

**Independent Test**: inspect a bundle for the three license files and a standalone
`libffmpeg.dylib`; add a GPL dependency → `npm run dist` fails naming it, no artifact.

### Tests for User Story 2

- [x] T009 [P] [US2] `tests/unit/check-licenses.test.ts`: the pure
  `classify(depLicenseMap, allowlist)` — all-permissive → `pass`; contains `GPL-3.0` →
  `fail` listing that `name@version — GPL-3.0`; `UNKNOWN` / missing field → `fail` (fail
  closed); `(MIT OR Apache-2.0)` → `pass`; unparseable expression → `fail`.
- [x] T010 [P] [US2] `tests/unit/gen-third-party-licenses.test.ts`: the pure
  `renderInventory(entries)` — output has one section per entry, **sorted by name**, each
  with `name@version`, SPDX id, repository, and license text; calling it twice on the same
  input is byte-identical.

### Implementation for User Story 2

- [x] T011 [US2] `scripts/check-licenses.js`: run `license-checker-rseidelsohn` over
  `--production`, normalize SPDX ids, call `classify(...)` against the fixed permissive
  allowlist (`data-model.md`) plus the ffmpeg-by-exact-identity carve-out; on failure print
  each `name@version — <license>` and `process.exit(1)` before any artifact; export
  `classify`.
- [x] T012 [US2] `scripts/gen-third-party-licenses.js`: scan production deps, build entries
  (name, version, SPDX, repo, license text from each package's `LICENSE*` file, SPDX
  template fallback), call `renderInventory`, write `./THIRD-PARTY-LICENSES`; add the fixed
  ffmpeg `LGPL-2.1-or-later` entry with a pointer to `PACKAGING.md`; export `renderInventory`.
- [x] T013 [US2] `package.json`: add
  `"licenses:check": "node scripts/check-licenses.js"` and
  `"licenses:gen": "node scripts/gen-third-party-licenses.js"`; update `dist` to
  `... && npm run build && npm run licenses:check && npm run licenses:gen && electron-builder --mac`.
- [x] T014 [US2] `electron-builder.yml`: add `THIRD-PARTY-LICENSES` to `extraResources`.
- [x] T015 [US2] Create `PACKAGING.md`: the `libffmpeg.dylib` location inside the bundle and
  the build-compatible-replace + re-sign steps; note it is the constitution's
  dynamically-linked-replaceable carve-out (LGPL is **not** in the general allowlist).
- [x] T016 [US2] ⚙ macOS — real run: `./THIRD-PARTY-LICENSES` covers every production dep +
  ffmpeg; `.app/Contents/Resources` has `LICENSE`, `NOTICE`, `THIRD-PARTY-LICENSES`;
  `find .app -name libffmpeg.dylib` returns a standalone file; `npm run licenses:gen` twice
  is `git`-clean; on a scratch branch `npm i --save <a GPL-3.0 package>` makes `npm run dist`
  exit 1 naming it with no artifact (quickstart §5–§6).

**Checkpoint**: the distributable is license-compliant and the gate is enforced.

---

## Phase 5: User Story 3 — the unsigned build installs with clear instructions (Priority: P2)

**Goal**: `README.md` tells a downloader which file matches their Mac, that the build is
unsigned, and the exact Gatekeeper steps; following them launches the app.

### Implementation for User Story 3

- [x] T017 [US3] `README.md` — add a "Download / Install" section: Apple Silicon vs Intel
  download guidance, an explicit "this build is unsigned / un-notarized" notice with what
  Gatekeeper shows, the exact steps (`xattr -dr com.apple.quarantine ~/Downloads/HyppoVisor-*.dmg`
  or right-click → Open), and a clearly-marked placeholder for the future signed-build path;
  add a one-line note under Requirements.
- [x] T018 [US3] `PACKAGING.md` — add the maintainer runbook for `npm run dist` (prereqs,
  the four outputs, where to upload) and a "signing & notarization — deferred" placeholder
  cross-referencing the README section.
- [ ] T019 [US3] ⚙ macOS — on a second machine / fresh user account that did not build the
  app, follow **only** the README steps for the matching architecture; the app installs and
  launches (quickstart §7).

**Checkpoint**: US1–US3 — a compliant, installable unsigned release.

---

## Phase 6: User Story 4 — brand PNGs optimized, icon intermediates removed (Priority: P3)

**Goal**: the four tracked PNGs are losslessly smaller; `build/icon.icns` +
`build/icon.iconset/` are deleted now that `electron-builder` regenerates the icon.

### Implementation for User Story 4

- [ ] T020 [US4] Run `oxipng -o4 --strip safe build/icon.png assets/hyppovisor.png
  src/renderer/mascot.png src/renderer/hyppo.png`; confirm each file is byte-smaller and
  visually identical; re-commit the shrunk PNGs.
- [x] T021 [US4] ⚙ macOS — after T008 confirmed the generated icon, `git rm -r
  build/icon.icns build/icon.iconset`; re-run `npm run dist`; confirm the packaged `.app`
  still shows the correct icon at every size.
- [x] T022 [US4] `assets/BRANDING.md` — state that `build/icon.png` is the sole icon master
  and `.icns` / `.iconset` are generated by `electron-builder` at package time; add the
  one-time `oxipng` command; update the file/purpose table (drop the removed rows).
- [ ] T023 [US4] `npm run build && npm run test:e2e` — the in-app About mascot, the top-bar
  button icon, and the README figure still render; confirm total tracked-PNG bytes dropped
  ≥ 40% (SC-008).

**Checkpoint**: all four stories complete.

---

## Phase 7: Polish

- [x] T024 ⚙ macOS — run `specs/010-macos-packaging/quickstart.md` §1–§10 end to end on a
  build host; fix any doc/behaviour drift.
- [x] T025 Full gate: `npm run build && npm run lint && npm test && npm run test:e2e`
  (local port 7357 free); confirm `git diff` touches no `src/**` logic — only tracked PNG
  bytes, config, scripts, and docs.

---

## Dependencies & Execution Order

### Phase order

- **Setup (T001–T002)** → **Foundational (T003–T004)** → stories.
- **US1 (T005–T008)**: needs Foundational. T005 (config) → T006 (script) → T007 (⚙ run) →
  T008 (⚙ icon check). T007/T008 need a macOS host.
- **US2 (T009–T016)**: needs US1's `electron-builder.yml` + `dist` script. Tests
  (T009/T010) run first / in parallel; T011/T012 implement the pure fns they exercise;
  T013/T014 wire them into `dist` and the bundle; T015 doc; T016 ⚙ verify.
- **US3 (T017–T019)**: needs US1 artifacts to describe accurately. T017/T018 docs; T019 ⚙.
- **US4 (T020–T023)**: T021 depends on US1 T008 (icon must be proven generated before the
  `.icns` is deleted). T020/T022/T023 otherwise independent.
- **Polish (T024–T025)**: after all desired stories.

### Story independence

- US1 delivers artifacts; US2 makes them compliant; US3 documents install; US4 is repo
  hygiene. Each has its own checkpoint and can be demonstrated alone (US2 without US1's
  `dist` still unit-tests the classifier + generator).

### Parallel opportunities

- T002 ‖ T001's install.
- T004 ‖ T003.
- T009 ‖ T010; both ‖ their implementations being drafted.
- T020, T022 ‖ most of US2/US3.

### Verification tasks (⚙ macOS)

T007, T008, T016, T019, T021, T024 require a real `npm run dist` on macOS and cannot be run
in a non-macOS CI. Batch them into one or two hands-on sessions on a build host.

---

## Implementation Strategy

### MVP (US1)

Setup → Foundational → US1 → one `npm run dist` yields four launchable artifacts. That alone
is a hand-out-able (if not yet compliant) build.

### Incremental delivery

US1 (artifacts) → US2 (compliant + gated) → US3 (install docs) → US4 (PNG/icon hygiene) →
Polish (quickstart + gate). US2 is the constitution-binding increment; do not cut a real
release before it lands.

---

## Notes

- `[P]` = different file, no incomplete-task dependency.
- Keep every classification/rendering rule in the pure `classify` / `renderInventory`
  functions; the scripts only do I/O around them (mirrors `scripts/postinstall.js`).
- No `src/**` logic changes — packaging is config, scripts, docs, and PNG bytes only
  (Constitution Check, FR-014).
- Signing / notarization, a CI release job, and Windows/Linux targets are **out of scope** —
  each is its own future issue (see `contracts/dist-command.md`).

### Deferred to a hands-on session (not done in the implementation PR)

- **T019** — install on a *second* macOS machine following only the README steps. Needs a
  separate machine.
- **T020 / T023** — the one-time `oxipng` lossless PNG squeeze (SC-008 ≥ 40%). Needs
  `oxipng` (`brew install oxipng`); it is a developer tool, not a build step. `assets/
  BRANDING.md` documents the command.

A real `npm run dist` was run on an Apple-Silicon host during implementation: all four
artifacts produced, bundle version == manifest, `LICENSE` + `NOTICE` +
`THIRD-PARTY-LICENSES` in `Contents/Resources`, `libffmpeg.dylib` standalone, generated
`.icns` present and referenced by `Info.plist`, and the packaged app launches offline and
serves an MCP request. The `x64` artifacts are packaged from the arm64-pinned
`electronDist` — see the cross-arch note in `PACKAGING.md` for a genuine Intel build.
