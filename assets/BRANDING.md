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
| `assets/hyppovisor.png` | Full figure — README / social / docs; sized to 3× its 200 px README render | V10 | 600×703 |
| `src/renderer/mascot.png` | Full figure, downscaled — in-app About panel; 3× its 72 px render | V10 | 240×281 |
| `src/renderer/hyppo.png` | Square head, 96 — the top-bar connection-panel button | Ivon v2 | 96×96 |
| `build/icon.png` | **Sole icon master**, 1024 — `BrowserWindow` at runtime; `electron-builder` generates the macOS `.icns` from it at package time | Ivon v2 | 1024×1024 |

`build/icon.icns` and `build/icon.iconset/` are no longer tracked —
`electron-builder` regenerates the `.icns` from `build/icon.png` on every
`npm run dist` (see [PACKAGING.md](../PACKAGING.md)).

## Regeneration

### Full-figure assets — from V10 (macOS `sips`)

```sh
SRC=specs/initial/branding/HyppoVisorV10.png

# README / social / docs — 3x the 200px README render
sips --resampleWidth 600 "$SRC" --out assets/hyppovisor.png

# In-app About panel — 3x the 72px render
sips --resampleWidth 240 "$SRC" --out src/renderer/mascot.png
```

### App icon master + top-bar button — from Ivon v2 (Python)

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
```

`npm run dist` turns `build/icon.png` into the packaged `.icns` at every macOS
size — no hand-run `iconutil` step to keep in sync.

### One-time lossless PNG squeeze

`oxipng` is a developer tool (`brew install oxipng`), not a build step:

```sh
oxipng -o4 --strip safe build/icon.png assets/hyppovisor.png \
  src/renderer/mascot.png src/renderer/hyppo.png
```

Each file gets smaller with no visible change; re-commit the shrunk PNGs.
