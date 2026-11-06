Add a new effect called "$ARGUMENTS".
1. Follow .claude/skills/add-effect/SKILL.md.
2. Implement in effects.js, add to ORDER in app.js, mirror in python/b1print/effects.py if it is worth having there.
3. `npm test`, then `npm run serve` and check it on a portrait and a pet photo at 393px wide.
4. Bump VERSION in sw.js.
5. Ask the print-reviewer agent to check the output, then summarise.
