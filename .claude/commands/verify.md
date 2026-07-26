---
description: Types, lint and tests — the same three checks CI runs
---

Run all three, in this order, and report each as PASS or FAIL with the actual
output on failure:

1. `bun run check-types`
2. `bunx biome check .`
3. `bun test`

Types first on purpose: a type error explains a test failure, where the other
order spends time working out that the test was never the problem.

Then `git status --short` so the working tree is visible alongside the result.

If Biome fails only on formatting, run `bunx biome check --write .` and say what
it changed. If it fails on a lint rule, do **not** auto-fix — report the rule and
the location, because a lint failure is usually saying something.

Finish with one line: green, or the first thing to fix.
