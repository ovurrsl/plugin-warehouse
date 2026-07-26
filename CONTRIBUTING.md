# Contributing

```sh
bun install
bun run check-types && bunx biome check . && bun test
```

That is the whole setup. The package extends no shared config and resolves no
workspace-only dependency, so it builds the same here as it does inside the
editor monorepo.

## The rules that are not style

Four constraints exist because breaking them fails **silently** — no error, no
warning, just a plugin that does not work and points somewhere else when you
debug it.

**Every dimension is metres.** Published warehouse specs are millimetres.
Divide by 1000. Never write a bare dimension literal above 100: a stray `1200`
is a pallet that is 1.2 kilometres long, and nothing in the type system objects.

**`@pascal-app/*` are peer dependencies.** A pinned copy creates a second
`nodeRegistry` singleton. The kinds register into the copy the host is not
reading, so they never appear — with no error anywhere.

**Host node shapes are read only in `src/host-adapter.ts`,** behind runtime
guards. The plugin contract is version-guarded and a break there is loud; host
*schemas* carry no such guarantee and can change shape in any release. Reads
behind guards degrade to "no data"; reads scattered through twenty files throw.

**No Tailwind classes in panel markup.** Tailwind v4 does not scan symlinked
directories, and a git dependency is always a symlink into bun's store — so a
utility class written in this package is never compiled. There is no error; the
panel simply renders unstyled. Style with inline styles resolving the host's own
CSS variables (`src/panels/styles.ts`), or compose a host component.

## Numbers need a source

This models real equipment, and a plausible invented figure is worse than an
obviously missing one — it survives review precisely because it looks right.
A new dimension, clearance or capacity gets either a catalogue reference or an
explicit note that it is a chosen default.

The same goes for the reverse: when a standard does not cover something, say so
rather than extending it by analogy. EN 15620's handling classes cover forklifts
and turret trucks; a crane is not one of them, and `handlingClass` is nullable
for that reason.

## Tests

Tests here mostly guard **silent** failures, so the useful ones assert what
would not be noticed:

- Geometry that interpenetrates. The part-pair check allows only named joints
  and rejects everything else — it caught a beam endplate sitting three
  millimetres inside an upright's flange, which on screen read as the beam.
- The geometry cache key. A field that changes the mesh but not the key makes
  two different racks share one geometry; a field in the key that changes no
  vertex splits the cache for nothing. The coverage test asserts both directions
  and has caught five defects.
- Arithmetic whose wrong answer is plausible. Reading a click's local point as
  metres puts every click in bay 1 — a believable enough result that nothing
  looks wrong.

## Commits

Conventional commits — `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `test:`,
`ci:`, `chore:`. `cliff.toml` groups them into the changelog.

Put the reasoning in the commit body. The changelog is an index to the history,
not a replacement for it, so the subject line is what gets listed and the body
is where a future reader finds out why.
