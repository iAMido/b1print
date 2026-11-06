# Code style
- Web: vanilla ES modules, no dependencies, no bundler. `const`/`let`, typed arrays for pixel data.
- effects.js functions are pure: no DOM, no globals, deterministic (seeded PRNG for oneline).
- Every effect accepts a params object and uses sensible defaults; at most 3 user-facing params per effect.
- Python mirrors the same names and defaults; when you change a default in one, change the other.
- Comments explain why (thermal behaviour), not what.
