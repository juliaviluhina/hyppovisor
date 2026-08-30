# Branding assets

Two mascot renders are in play:

- **HyppoVisor V10** — a chibi violet hippo (gold dot markings, grey tee, blue jeans,
  backpack) beside a stack of three browser-window cards with a globe favicon and a
  mouse cursor. Full-figure art. Still the source for the README / social figure and
  the in-app About panel.
- **Hyppo Ivon (simpler v2)** — a head-only mascot: same violet hippo with the
  call-centre headset and gold freckles, flatter shading, one bold outline weight,
  transparent background. Now the source for the app icon and the top-bar button,
  where a head crop reads better small and the busier full figure did not.

> The design sources live under `specs/initial/branding/` (git-ignored,
> `specs/initial/`): `HyppoVisorV10.png` and `Hyppo_Ivon_simpler_v2.png`. The files in
> this directory and in `build/` are the vendored, tracked copies the app and README
> actually use.

| File | Purpose | Source | Size |
|---|---|---|---|
| `assets/hyppovisor.png` | Full figure, full resolution — README / social / docs | V10 | 1159×1358 |
| `src/renderer/mascot.png` | Full figure, downscaled — in-app About panel | V10 | 560px wide |
| `src/renderer/hyppo.png` | Square head, 96 — the top-bar connection-panel button | Ivon v2 | 96×96 |
| `build/icon.png` | Square head, 1024 — Linux / electron-builder generic / `BrowserWindow` | Ivon v2 | 1024×1024 |
| `build/icon.icns` | macOS app icon (16–1024, @1x/@2x) | Ivon v2 | — |
| `build/icon.iconset/` | Intermediate PNGs for `iconutil` | Ivon v2 | — |

## Regeneration

### Full-figure assets — from V10 (macOS `sips`)

```sh
SRC=specs/initial/branding/HyppoVisorV10.png

# README / docs
cp "$SRC" assets/hyppovisor.png

# In-app About panel
sips -Z 560 "$SRC" --out src/renderer/mascot.png
```

### App icon + top-bar button — from Ivon v2 (Python + `iconutil`)

The head render bleeds to its left and bottom edges, so it is trimmed to the opaque
bounds and re-centred on a square canvas with 8% padding before scaling. `sips` cannot
do the alpha trim / transparent pad, hence Pillow:

```python
from PIL import Image
im = Image.open("specs/initial/branding/Hyppo_Ivon_simpler_v2.png").convert("RGBA")
c = im.crop(im.getbbox())
w, h = c.size
pad = round(max(w, h) * 0.08)
side = max(w, h) + pad * 2
master = Image.new("RGBA", (side, side), (0, 0, 0, 0))
master.paste(c, ((side - w) // 2, (side - h) // 2), c)

master.resize((1024, 1024), Image.LANCZOS).save("build/icon.png")
master.resize((96, 96), Image.LANCZOS).save("src/renderer/hyppo.png")
for name, px in [
    ("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32),
    ("icon_32x32@2x", 64), ("icon_128x128", 128), ("icon_128x128@2x", 256),
    ("icon_256x256", 256), ("icon_256x256@2x", 512), ("icon_512x512", 512),
    ("icon_512x512@2x", 1024),
]:
    master.resize((px, px), Image.LANCZOS).save(f"build/icon.iconset/{name}.png")
```

```sh
iconutil -c icns build/icon.iconset -o build/icon.icns
```
