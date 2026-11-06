#!/usr/bin/env bash
# After Claude edits a file: syntax-check the web modules and run the fast JS tests.
set -e
cd "$(dirname "$0")/../.."
for f in app.js effects.js sw.js; do node --check "$f"; done
node --test tests/*.test.mjs >/dev/null 2>&1 || { echo "JS tests failed after edit" >&2; exit 2; }
if command -v python3 >/dev/null && [ -d python ]; then python3 -m compileall -q python/b1print >/dev/null; fi
