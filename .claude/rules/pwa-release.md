# PWA release checklist
- Bump `VERSION` in sw.js whenever index.html, app.js, effects.js, manifest or icons change.
- Any new shipped file must be added to `SHELL` in sw.js.
- Keep everything relative-path (`./`), the site lives under /b1print/ on GitHub Pages.
- iOS: `navigator.share` must be called directly from a tap; prepare blobs before the click.
