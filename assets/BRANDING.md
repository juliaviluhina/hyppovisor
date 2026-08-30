# Branding assets

Canonical mascot art: **HyppoVisor V10** — a chibi violet hippo (gold dot markings,
grey tee, blue jeans, backpack) beside a stack of three browser-window cards with a
globe favicon and a mouse cursor. Flat colour, one bold outline weight, transparent
background (RGBA, ~41% alpha-0).

> The design source lives at `specs/initial/branding/HyppoVisorV10.png`, which is
> **git-ignored** (`specs/initial/`). The files in this directory and in `build/` are the
> vendored, tracked copies the app and README actually use.

| File | Purpose | Size |
|---|---|---|
| `assets/hyppovisor.png` | Full figure, full resolution — README / social / docs | 1159×1358 |
| `src/renderer/mascot.png` | Full figure, downscaled — in-app About panel | 560px wide |
| `src/renderer/hyppo.png` | Square head crop, 96 — the top-bar connection-panel button | 96×96 |
| `build/icon.png` | Square head crop, 1024 — Linux / electron-builder generic / `BrowserWindow` | 1024×1024 |
| `build/icon.icns` | macOS app icon (16–1024, @1x/@2x) | — |
| `build/icon.iconset/` | Intermediate PNGs for `iconutil` | — |

## Regeneration (macOS `sips` + `iconutil`)

```sh
SRC=specs/initial/branding/HyppoVisorV10.png

# README / docs
cp "$SRC" assets/hyppovisor.png

# In-app About panel
sips -Z 560 "$SRC" --out src/renderer/mascot.png

# Square head crop → 1024 master (crop box tuned by eye: 1010×1010 at offset y=6 x=70)
sips -c 1010 1010 --cropOffset 6 70 "$SRC" --out /tmp/head.png
sips -Z 1024 /tmp/head.png --out build/icon.png

# Top-bar button icon (derived from the head crop, not the full figure)
sips -s format png -Z 96 build/icon.png --out src/renderer/hyppo.png

# icon.iconset (from build/icon.png) then icns
mkdir -p build/icon.iconset
for pair in "16 icon_16x16" "32 icon_16x16@2x" "32 icon_32x32" "64 icon_32x32@2x" \
            "128 icon_128x128" "256 icon_128x128@2x" "256 icon_256x256" \
            "512 icon_256x256@2x" "512 icon_512x512" "1024 icon_512x512@2x"; do
  set -- $pair; sips -Z "$1" build/icon.png --out "build/icon.iconset/$2.png"
done
iconutil -c icns build/icon.iconset -o build/icon.icns
```
