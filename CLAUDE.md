# Agent instructions — `@ovurrsl/plugin-warehouse`

Warehouse & logistics equipment for the [Pascal editor](https://editor.pascal.app),
built against **plugin API v1**. Node kinds are namespaced `warehouse:`.

## Commands

```sh
bun run check-types      # tsc --noEmit
bunx biome check .       # lint + format; --write to fix
bun test
```

Run all three after any change. They are fast — the whole suite is under a
second — so there is no reason to guess.

## The four rules that fail silently

Everything else here is preference. These four produce **no error** when
broken, which is why they are worth stating.

**Every dimension is metres.** Published warehouse specs are millimetres.
Divide by 1000. Never write a bare dimension literal above 100 — a stray `1200`
is a pallet 1.2 km long and nothing objects.

**`@pascal-app/*` are peer dependencies.** Never pin them. A second copy is a
second `nodeRegistry` singleton: the kinds register into the one the host is not
reading and simply never appear.

**Host node shapes are read only in `src/host-adapter.ts`,** behind runtime
guards. The plugin *contract* is version-guarded and breaks loudly; host
*schemas* are not and can change shape in any release. Add a narrowing function
there rather than reaching into a host node anywhere else.

**No Tailwind classes in panel markup.** Tailwind v4 does not scan symlinked
directories and a git dependency is always a symlink into bun's store, so a
class written here is never compiled and the panel renders unstyled with no
error. Use inline styles resolving host CSS variables (`src/panels/styles.ts`),
or compose a host component — those carry classes from the host's own
stylesheet and work anywhere.

Two more, less dramatic: **import from package barrels only** (`@pascal-app/core`,
never a deep path — deep paths are outside the `exports` map), and **keep
`src/index.ts` SSR-safe** (it is imported eagerly during the host's server
prerender, so nothing reachable from it may touch `document`, `window` or
Three.js at module scope; renderers and tools are behind lazy thunks).

## Where things are

```
src/
  index.ts          manifest barrel — SSR-eager, keep it thin
  plugin-id.ts      identity constants (PLUGIN_ID is persisted user data)
  host-adapter.ts   every host-schema read, behind runtime guards
  compat.ts         boot-time probe + console report
  catalog.ts        catalog data table
  placement.ts      shared placement plumbing for the tools
  store.ts          plugin-owned zustand
  overlay.tsx       DOM overlay from inside the R3F tree (second React root)
  panels/           rail panel + style tokens
  pallet/           warehouse:pallet
  rack/             warehouse:pallet-rack
```

## Geometry, and why it is shaped this way

A rack is **one merged BufferGeometry per shape**, cached and shared by every
rack of that shape, with part colours in the vertex colour attribute so the
whole scene draws from one material. That is the entire performance story: a
15 000 m² warehouse is ~95 blocks and ~95 draw calls. Drawing parts as separate
meshes would be a quarter of a million.

Two consequences worth internalising before editing `geometry-builder.ts`:

- **The cache key must describe what the builder emits, not what the schema
  says.** A field that changes the mesh but not the key makes two visibly
  different racks share one geometry. A field in the key that moves no vertex
  splits the cache for nothing. The coverage test asserts both directions and
  has caught five real defects — trust it over your reading of the code.
- **Geometry is never disposed.** It belongs to the shape, not to any node, so
  disposing it when one rack is deleted would blank every rack sharing it.

## Numbers need a source

This models real equipment. A plausible invented figure is worse than a missing
one — it survives review because it looks right. Cite a catalogue, or say
plainly that a value is a chosen default. When a standard does not cover
something, say so rather than extending it by analogy.

## Tests guard silent failures

The valuable tests here are not the ones asserting that correct code is correct.
They assert that a specific wrong answer — one that looks plausible — is not
produced. Interpenetrating steel, a cache key that over- or under-reports, a
click read in the wrong coordinate frame. When adding a test, ask what the
failure would look like if nobody noticed.

## Commits

Conventional commits (`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `test:`,
`ci:`, `chore:`). The subject is what the changelog lists; the body is where the
reasoning goes, and it is the part that is worth writing.
