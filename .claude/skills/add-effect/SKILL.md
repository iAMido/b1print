---
name: add-effect
description: Use when adding or tuning a black & white effect for the NIIMBOT B1 in effects.js (web) or python/b1print/effects.py.
---
# Adding a thermal-friendly effect
1. Read CLAUDE.md and .claude/rules/thermal-printing.md.
2. In effects.js: `effect("name", "שם בעברית", "תיאור קצר בעברית", (img, p) => Uint8Array)`.
   - Tone: `darkness(gray, p.gamma)`; thresholds: `otsu(gray, mask, hasMask)`; lines: `dogLines()`.
   - Finish with `removeSpecks()`; use `dilate()` if strokes can be 1 px.
3. If it needs the subject, fall back gracefully when `img.hasMask` is false.
4. Add the name to `ORDER` in app.js (position = how useful it is).
5. Tests pick it up automatically (`npm test`); it must be neither blank nor solid.
6. Look at it in the browser on two photos before calling it done. Bump sw.js VERSION.
