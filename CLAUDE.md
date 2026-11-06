# b1print

Turns any photo into black & white label art for the **NIIMBOT B1** thermal label printer.
Two front ends share the same algorithms:
- **Web app (main, root folder):** static PWA, runs fully on the iPhone in Safari, hosted on GitHub Pages. Images never leave the device.
- **Python version (`python/`):** CLI + Streamlit, adds AI background removal (rembg). Used for experiments.

## Printer facts (drive every design decision)
- Direct thermal, 1-bit only, **203 DPI** (~8 px/mm), **48 mm / 384 px printhead**.
- Default label 50x30 mm -> canvas 384x240 px. Width always clamped to 384 px.
- Thermal dots spread: prints come out darker than the screen. Lines under ~2 px may fade; single dots look like dirt.

## Web stack
Plain HTML + ES modules, Canvas API, service worker + manifest (PWA). **No framework, no build step, no runtime dependencies.** Node 20+ only for tests.

```
index.html            UI (Hebrew, RTL, mobile first)
app.js                DOM: load image -> canvas preprocessing -> render cards -> share/save PNG (with 203 DPI pHYs)
effects.js            pure algorithms on typed arrays (no DOM): effects registry, helpers, oneline TSP art
sw.js                 offline cache (bump VERSION on every release)
manifest.webmanifest  home screen app
icons/                180/192/512 icons
tests/*.test.mjs      node:test, synthetic images
python/               Python package mirroring effects.js
```

## Data contract
`img = { w, h, gray: Float32Array 0..255, mask: Float32Array 0..1, hasMask }`
Each effect: `(img, params) -> Uint8Array ink` (1 = black). `hasMask` is true only when the source had transparency
(iOS "Copy Subject" or a PNG cut-out); effects needing the subject (sticker, silhouette) must fall back when false.

## Conventions
- effects.js stays DOM-free so it runs in Node tests and could run in a Web Worker.
- New effect: register with `effect(name, hebrewName, hebrewDesc, fn)`, add it to `ORDER` in app.js, mirror in python/ if useful.
- Use `otsu(gray, mask, hasMask)` (subject-only), `removeSpecks`, `dilate` for thermal-safe output.
- Each effect < 300 ms on 384x400 on a phone. Heavy loops: typed arrays, no per-pixel allocations.
- UI text in Hebrew; code, comments, commits in English.
- After changing any shipped file, bump `VERSION` in sw.js or phones will keep the old cache.

## Commands
- `npm test` (JS) | `cd python && pytest -q`
- `npm run serve` then open http://localhost:8000
- Python: `cd python && pip install -r requirements.txt && python -m b1print photo.jpg`
