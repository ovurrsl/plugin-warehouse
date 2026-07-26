## What changed

<!-- One or two sentences. What the change is, not how it was made. -->

## Why

<!-- The behaviour that was wrong, or the thing that could not be expressed
     before. If this fixes something that failed silently, say what the silent
     failure looked like — that is the part a reviewer cannot reconstruct. -->

## Checks

- [ ] `bun run check-types`
- [ ] `bunx biome check .`
- [ ] `bun test`

## Dimensions

- [ ] Every new dimension is in **metres**. (Published warehouse specs are
      millimetres — divide by 1000. No bare literal above 100.)
- [ ] Any real-world figure has a source, or is marked as a chosen default.

## Host coupling

- [ ] No new read of a host node's shape outside `src/host-adapter.ts`.
- [ ] No deep imports — package barrels only.
- [ ] No Tailwind classes in panel markup.
