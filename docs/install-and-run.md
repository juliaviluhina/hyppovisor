# Install & run

## Get it

**A — packaged build.** Download the `arm64` `.dmg` (Apple Silicon) from
[Releases](https://github.com/juliaviluhina/hyppovisor/releases), open it, drag
HyppoVisor to Applications.

The build is not signed with an Apple Developer ID or notarized, so on first
launch macOS Gatekeeper reports it as **"HyppoVisor is damaged and can't be
opened"** — misleading wording; the app is fine, and right-click → **Open**
does *not* get past it. Strip the download quarantine instead:

```bash
xattr -dr com.apple.quarantine /Applications/HyppoVisor.app
```

If it still won't open, ad-hoc re-sign it:

```bash
codesign --force --deep --sign - /Applications/HyppoVisor.app
```

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
no agent attached. The address bar mirrors the active tab's URL; with a tab open,
Enter and the → button re-point that tab in place, and the **+** button opens a
new tab. With no tab open, all three open a new tab. Log into any site you want
available to later reads — sessions persist in the app's own profile across
restarts.

## Build a packaged app

Produces option A above (`arm64` + `x64`, each `.dmg` + `.zip`, unsigned; the
Release workflow publishes `arm64` only):

```bash
npm run dist
```

Full runbook — the license gate, the LGPL swap, signing — in
[PACKAGING.md](../PACKAGING.md). Output (`release/`) is git-ignored.
