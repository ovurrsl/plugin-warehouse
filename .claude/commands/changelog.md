---
description: Regenerate CHANGELOG.md and the README's generated blocks
---

1. `bunx git-cliff --output CHANGELOG.md`
2. `bun run scripts/update-readme.mjs`
3. `git diff --stat`

This is the same pair the README workflow runs on every push to `main`, so
running it locally should normally produce **no diff**. If it does produce one,
that is worth reading rather than committing blindly — it means either the last
push did not reach the workflow, or `cliff.toml` has changed how existing
commits are grouped.

The script rewrites only the marked blocks (`BADGES`, `ARCH`, `CHANGELOG`).
Everything else in the README is hand-written. If it errors about a missing
marker, the README and the script have drifted — fix the markers, do not weaken
the script into skipping silently.
