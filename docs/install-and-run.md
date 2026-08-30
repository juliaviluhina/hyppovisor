# Install & run

## Get it

**A — packaged build.** Download the `.dmg` for your Mac's architecture from
[Releases](https://github.com/juliaviluhina/hyppovisor/releases), open it, drag
HyppoVisor to Applications. First launch: right-click the app → **Open** to get
past Gatekeeper (the build is unsigned).

**B — from source.**

```bash
npm install    # postinstall also downloads the Electron runtime binary
npm start      # builds, then launches
```

A fresh clone needs nothing more. `npm start` re-checks the Electron binary
before each launch. If it's missing (npm skipped install scripts):

```bash
node node_modules/electron/install.js
```

## Requirements (source)

- Node 22+ (`.nvmrc` pins 22)
- macOS — primary target. Windows/Linux build but are unverified.

## Standalone use

The window opens with a tab strip and an address bar. Type a URL to try it with
no agent attached. Log into any site you want available to later reads — sessions
persist in the app's own profile across restarts.

## Build a packaged app

Produces option A above. No signing yet.

```bash
npx @electron/packager . HyppoVisor \
  --platform=darwin --arch=arm64 \
  --icon=build/icon.icns --overwrite
open HyppoVisor-darwin-arm64/HyppoVisor.app
```

Output (`HyppoVisor-*/`) is git-ignored.
