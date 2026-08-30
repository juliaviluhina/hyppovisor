# Feature Specification: macOS Packaging & Release

**Feature Branch**: `plan-010-macos-packaging`

**Created**: 2026-08-30

**Status**: Draft

**Input**: User description: "macOS packaging and release. From
specs/issues/002-macos-packaging-and-release.md. Today `npm start` runs the app from source;
there is no packaging step, so `build/icon.icns` is unused, there is no `HyppoVisor.app` /
`.dmg` / `.zip`, no version-stamped release, and nothing generates the `THIRD-PARTY-LICENSES`
inventory the README and constitution already promise. Add a repeatable packaging path that
produces a distributable macOS application."

## Context

HyppoVisor currently only runs from a source checkout (`npm start` → compile → `electron .`).
There is no way to hand someone a HyppoVisor they can double-click. The repo already carries
an app icon that nothing consumes, and both the README and the constitution promise a binary
release will ship a `THIRD-PARTY-LICENSES` inventory — which nothing generates.

This feature adds a repeatable packaging path: one command turns a clean checkout into a
distributable macOS application, correctly licensed, version-stamped, and self-contained. It
adds no runtime capability, no new MCP tool, no persistent app state — it is build and
release tooling only.

## Clarifications

### Session 2026-08-30

- Q: Does this feature include macOS code-signing + notarization? → A: **No — deferred.**
  The first release ships unsigned with documented Gatekeeper steps; signing + notarization
  is its own follow-up issue.
- Q: How is a release cut? → A: **Local `npm run dist` only.** A maintainer runs it on a Mac
  and uploads artifacts by hand. A tagged CI release job is a later follow-up.
- Q: One universal binary or per-architecture artifacts? → A: **Per-architecture.** Separate
  `arm64` and `x64` builds, each with its own `.dmg` and `.zip` (four files per run).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A maintainer produces a distributable macOS app with one command (Priority: P1)

From a clean checkout on a macOS machine, the maintainer runs a single documented command
and gets a distributable macOS application: an app bundle a person can drag to Applications
and launch, packaged into a disk image and an archive, carrying the app's icon and the
version from the project's manifest.

**Why this priority**: This is the feature. Without it there is no artifact to license, sign,
or release.

**Independent Test**: On macOS, from a fresh clone, run `npm install` then the packaging
command. Confirm it produces a `.dmg` and a `.zip` in a predictable output directory, that
mounting the `.dmg` shows `HyppoVisor.app` with the correct icon, that the app's reported
version matches the manifest, and that the app launches and opens a window offline.

**Acceptance Scenarios**:

1. **Given** a clean checkout on macOS with dependencies installed, **When** the maintainer
   runs the packaging command, **Then** an `arm64` `.dmg` + `.zip` and an `x64` `.dmg` +
   `.zip` (four files, each named with the version and architecture) are written to a
   predictable output directory and the command exits success.
2. **Given** a produced `.dmg`, **When** it is mounted, **Then** it contains `HyppoVisor.app`
   showing the project's icon, and dragging it to Applications and launching it (on a
   matching-architecture machine) opens the app window.
3. **Given** a produced app bundle, **When** its version is inspected, **Then** it equals
   the version in the project manifest.
4. **Given** no network connection after dependencies are installed, **When** the packaging
   command runs, **Then** it still completes (no network fetch during packaging).
5. **Given** the packaged app running, **When** it is used offline against a local page,
   **Then** it behaves as the from-source app does (no packaging regression).

---

### User Story 2 - The distributable is license-compliant (Priority: P1)

The packaged artifact carries a generated inventory of every bundled third-party
dependency's license; the project's own `LICENSE` and `NOTICE` ship inside it; the
packaging step fails if any bundled dependency is under a non-permissive license; and the
dynamically-loaded LGPL media library that ships within the runtime remains a separate,
replaceable file with its relink path documented.

**Why this priority**: The constitution's Licensing constraint is binding — a release that
does not satisfy it must not ship. It is exactly as important as producing the artifact at
all.

**Independent Test**: Inspect the packaged artifact for a `THIRD-PARTY-LICENSES` file
listing bundled dependencies with their licenses, and for `LICENSE` and `NOTICE`. Confirm
the LGPL media library is present as its own file (not statically linked into app code) and
that the packaging docs state how to replace it. Introduce a fake dependency under a
copyleft license and confirm the packaging command fails with a message naming it.

**Acceptance Scenarios**:

1. **Given** a successful packaging run, **When** the artifact is inspected, **Then** it
   contains a `THIRD-PARTY-LICENSES` inventory covering every bundled dependency, plus the
   project's `LICENSE` and `NOTICE`.
2. **Given** the dependency tree is all permissive (MIT / Apache-2.0 / ISC / BSD), **When**
   the packaging command's license gate runs, **Then** it passes.
3. **Given** a bundled dependency under a non-permissive (copyleft) license, **When** the
   packaging command runs, **Then** it fails before producing an artifact and its output
   names the offending dependency and license.
4. **Given** the packaged app, **When** the bundled LGPL media library is located, **Then**
   it is a standalone dynamic library file, and the packaging documentation records the
   steps to swap it for a user-supplied build.
5. **Given** the `THIRD-PARTY-LICENSES` inventory, **When** it is regenerated on an
   unchanged tree, **Then** its contents are stable (deterministic ordering).

---

### User Story 3 - An end user can install and run the unsigned build (Priority: P2)

The first release is not code-signed or notarized. A person who downloads it gets clear,
correct instructions for getting past macOS Gatekeeper, and following them yields a running
app.

**Why this priority**: Without usable install instructions the artifact is not actually
distributable, but this is a documentation + posture decision layered on US1, not a
blocker for producing the artifact.

**Independent Test**: On a macOS machine that did not build the app, download the artifact,
follow the documented Gatekeeper steps, and confirm the app launches. Confirm the docs state
plainly that the build is unsigned and why.

**Acceptance Scenarios**:

1. **Given** the released `.dmg` / `.zip` for the machine's architecture on a machine that
   did not build it, **When** the user follows the documented steps (e.g. removing the
   quarantine attribute or the right-click-Open path), **Then** the app launches.
2. **Given** the release notes / README, **When** the user reads the install section,
   **Then** it states the build is unsigned, which download matches Apple Silicon vs Intel,
   what the user will see from Gatekeeper, and the exact steps to proceed.
3. **Given** a future signed build, **When** the docs are revisited, **Then** the unsigned
   workaround is clearly marked as superseded (the spec leaves a hook for the follow-up).

---

### User Story 4 - Brand image assets are optimized and de-duplicated (Priority: P3)

The tracked brand PNGs are losslessly compressed (or regenerated by the icon pipeline), and
redundant hand-built icon intermediates are removed once the pipeline generates equivalents.

**Why this priority**: Repo hygiene and bundle size, worth doing while the icon pipeline is
being set up, but it changes nothing a user sees.

**Independent Test**: Confirm each tracked brand PNG is byte-for-byte smaller after the pass
with no visible quality change, that the app and README still render their images, and that
any removed icon intermediates are genuinely regenerated by the packaging pipeline.

**Acceptance Scenarios**:

1. **Given** the tracked brand PNGs, **When** the optimization pass runs, **Then** each file
   is smaller and visually unchanged, and the in-app and README images still display.
2. **Given** the packaging pipeline generates the platform icon from a single master image,
   **When** the redundant hand-built icon files are removed, **Then** the packaged app still
   shows the correct icon at every size.
3. **Given** the regeneration steps, **When** they are documented, **Then** a maintainer can
   reproduce every tracked image from the master source.

---

### Edge Cases

- **Packaging run on a non-macOS host** — fails fast with a clear "macOS required for this
  target" message; does not produce a half-built artifact.
- **`npm install` skipped / runtime binary missing** — the packaging command reports the
  missing prerequisite rather than producing a broken bundle.
- **License scanner cannot classify a dependency** (unknown / missing license field) —
  treated as a gate failure (fail closed), naming the dependency, not silently passed.
- **A dependency is permissively licensed but requires attribution** (BSD/MIT) — its text is
  included in the inventory, not just its name.
- **Output directory already contains a previous build** — the command overwrites or
  versions the outputs predictably; it never silently merges old and new artifacts.
- **Version in the manifest is a pre-1.0 / pre-release string** — the artifact still builds
  and stamps that exact string; no assumption of a `1.x` format.
- **The `.zip` and `.dmg` for one architecture disagree** (different contents) — must not
  happen; both wrap that architecture's app bundle from the same run. The `arm64` and `x64`
  bundles differ only by architecture, not by app version or content set.
- **Icon master image missing or wrong dimensions** — packaging fails with a clear message
  rather than shipping a default/blank icon.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A single documented command MUST turn a clean, dependency-installed checkout
  into a distributable macOS application bundle, with no interactive prompts.
- **FR-002**: The command MUST produce, for **each** target architecture (`arm64` and
  `x64`), a disk-image (`.dmg`) and an archive (`.zip`) of that architecture's app bundle —
  four files per run — in a predictable, git-ignored output directory, each filename
  carrying the version and the architecture.
- **FR-003**: Each packaged app (per architecture) MUST carry the project's icon at all
  standard macOS icon sizes and MUST report the version string from the project manifest,
  and MUST run on its target architecture.
- **FR-004**: Packaging MUST NOT require network access beyond the prior dependency install;
  a run with networking disabled afterward MUST still succeed.
- **FR-005**: The packaged artifact MUST contain a generated `THIRD-PARTY-LICENSES` inventory
  listing every bundled third-party dependency with its license identifier and license text,
  in a deterministic order.
- **FR-006**: The packaged artifact MUST contain the project's own `LICENSE` and `NOTICE`
  files.
- **FR-007**: Packaging MUST run a license gate that fails the build — before any artifact
  is produced — if any bundled dependency is under a non-permissive license or has an
  unclassifiable / missing license, and the failure message MUST name the dependency and the
  detected license.
- **FR-008**: The dynamically-loaded LGPL media library shipped within the runtime MUST
  remain a standalone dynamic library file in the bundle (not statically linked into
  application code), and the packaging documentation MUST record the steps to replace it
  with a user-supplied build.
- **FR-009**: The packaged app MUST behave identically to the from-source app for existing
  functionality (opening URLs, the MCP server, the connection panel) — packaging introduces
  no behavioral change.
- **FR-010**: The release documentation MUST state that the build is unsigned and
  un-notarized, describe what macOS Gatekeeper will show, and give the exact steps a user
  runs to launch it, with a clearly marked place for the future signed-build path.
- **FR-011**: The packaging path MUST be macOS-only for this feature; producing Windows or
  Linux artifacts is out of scope and the existing "unverified" posture for those platforms
  is unchanged.
- **FR-012**: The tracked brand image assets MUST be losslessly optimized or pipeline-
  regenerated so each is smaller with no visible quality change; redundant hand-built icon
  intermediates MUST be removed only once the packaging pipeline demonstrably regenerates an
  equivalent, and the regeneration steps for every tracked image MUST be documented.
- **FR-013**: A run on an unsupported host or with a missing prerequisite (runtime binary,
  icon master) MUST fail fast with a specific message and produce no partial artifact.
- **FR-014**: This feature MUST NOT add a runtime capability, an MCP tool, a persistent app-
  state file, or a network service; it changes build/release tooling and documentation only.

### Key Entities

- **Distributable**: the four files produced by one packaging run — an `arm64` `.dmg` +
  `.zip` and an `x64` `.dmg` + `.zip` — each wrapping that architecture's `HyppoVisor.app`,
  all version-stamped identically from the manifest.
- **THIRD-PARTY-LICENSES inventory**: a generated document listing every bundled dependency,
  its license identifier, and its license text, in deterministic order; ships inside the
  distributable.
- **License gate result**: pass, or fail-with-named-offender; a fail blocks artifact
  production.
- **Brand asset set**: the tracked PNGs (README figure, in-app mascot, top-bar head crop,
  icon master) plus generated platform icon files, all reproducible from one master source
  per the documented steps.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a fresh clone on macOS, a maintainer produces the four working artifacts
  (`arm64` + `x64`, each `.dmg` + `.zip`) in one command and under 15 minutes, with no
  manual steps beyond `npm install`.
- **SC-002**: A person who did not build the app can, following only the written
  instructions (which name which download matches Apple Silicon vs Intel), install from the
  `.dmg` and launch the app on a different macOS machine.
- **SC-003**: The packaged app's version equals the manifest version, verified
  automatically.
- **SC-004**: The distributable contains `THIRD-PARTY-LICENSES`, `LICENSE`, and `NOTICE`;
  the inventory covers 100% of bundled dependencies.
- **SC-005**: Introducing a copyleft-licensed dependency causes the packaging command to
  fail, naming that dependency, with no artifact written.
- **SC-006**: Regenerating the `THIRD-PARTY-LICENSES` inventory twice on an unchanged tree
  yields byte-identical files.
- **SC-007**: The bundled LGPL media library is present as its own file and the documented
  replacement steps, when followed, yield an app that still launches.
- **SC-008**: Total size of the tracked brand PNGs is reduced by a meaningful margin
  (target ≥ 40%) with no visible quality change and no broken images in the app or README.
- **SC-009**: The existing from-source test suites (unit, integration/e2e) are unaffected
  and still pass; the packaged app passes a smoke check of opening a local page and serving
  one MCP request.
- **SC-010**: A packaging attempt on a non-macOS host or with a missing prerequisite exits
  non-zero within seconds and leaves the output directory empty.

## Assumptions

- **Packaging tool** (issue decision 1): **`electron-builder`** — the de-facto standard,
  generates platform icons from one PNG master, and produces `.dmg` + `.zip` from one
  config. `/speckit-plan` confirms.
- **Output targets** (decision 2): **per-architecture** — separate `arm64` and `x64` builds,
  each packaged as `.dmg` and `.zip` (four files per run). No universal binary, no
  auto-update channel. Confirmed in the clarify session.
- **Signing & notarization** (decision 3): **deferred** — the first release ships
  **unsigned**, with documented Gatekeeper steps (FR-010). Signing + notarization is its own
  follow-up issue (needs an Apple Developer ID and CI secrets). Confirmed in the clarify
  session.
- **License inventory** (decision 4): generated by a **license-checker-style scan** wired
  into the packaging script as a hard gate (FR-007), classifying against an allowlist of
  permissive licenses.
- **Icon inputs** (decision 5): **`build/icon.png` (1024²) becomes the single master**; the
  packaging pipeline regenerates the platform icon from it, and the hand-built
  `build/icon.icns` + `build/icon.iconset/` are removed once the pipeline output is verified
  equivalent (FR-012).
- **Windows / Linux** (decision 6): **out of scope** for this feature (FR-011).
- **Release workflow** (decision 7): a **local `npm run dist`** run by a maintainer on a Mac;
  artifacts uploaded by hand. A tagged GitHub Actions release job is a deferred follow-up.
  Confirmed in the clarify session.
- **PNG optimization** (decision 8): a lossless squeeze (or icon-pipeline regeneration) of
  the four tracked brand PNGs, re-committed (FR-012, US4).
- **Constitution**: Principle III's "one installable artifact" means one thing a given user
  installs and runs — one `HyppoVisor.app`. Building it for two architectures (each in a
  `.dmg` and a `.zip` of identical content) is a delivery detail, not two products: a user
  installs exactly one. The plan's Constitution Check must make this argument explicitly.
  The Architecture Constraints / Licensing clause (`THIRD-PARTY-LICENSES`, LGPL media
  library shipped separately and replaceably) is the binding constraint and is met by
  FR-005…FR-008. No principle is redefined; nothing runtime, no MCP tool, no persistent
  state, no service (FR-014).
- **Environment**: packaging is performed on macOS with the project's pinned Node version
  and the runtime binary already fetched by `npm install`.

## Dependencies

- The existing compile step (`npm run build`) and the copied renderer/preload assets it
  produces.
- The runtime binary already fetched during dependency install.
- The tracked icon master and brand PNGs (`build/`, `assets/`, `src/renderer/`), and the
  documented regeneration steps in `assets/BRANDING.md`.
- The project's `LICENSE` and `NOTICE` at the repo root.
- Full background and the eight open decisions: `specs/issues/002-macos-packaging-and-release.md`.
