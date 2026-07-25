# @ovurrsl/plugin-warehouse

Warehouse & logistics equipment for the [Pascal editor](https://editor.pascal.app) — pallets, racking, handling equipment, and a capacity readout.

Built against **plugin API v1** ([contract](https://editor.pascal.app/docs/developers/plugins)).

## Design constraint: survive a host upgrade

This plugin is meant to keep working when it is dropped into a newer editor. That shapes what it is allowed to depend on:

| Layer | Examples | Treatment |
|---|---|---|
| **Contract** | `Plugin`, `NodeDefinition`, `EditorHostPanel`, `apiVersion` | Depend freely. Version-guarded — `loadPlugin` throws on a mismatch, so a break is loud. |
| **Non-contract exports** | `useScene`, `useEditor`, host UI controls | Import from package barrels only, never deep paths. |
| **Host node schemas** | `slab.polygon`, `level.children` | **Never read directly.** Everything goes through [`src/host-adapter.ts`](src/host-adapter.ts) behind runtime guards. |
| **Owned outright** | node schemas, geometry, capacity maths | Plugin-local. No host coupling. |

The split that matters: **capacity figures come entirely from this plugin's own node schemas**, so they cannot be broken by a host change. Only the *area* figures read host slabs, and those degrade to "no data" rather than throwing if the slab schema moves.

`src/compat.ts` prints one console block at panel mount naming which optional reads are live — so a host change reads as `❌ slab polygon — 0/7 readable` instead of an unexplained zero.

## Layout

```
src/
  index.ts          manifest barrel — SSR-eager, keep it thin
  plugin-id.ts      identity constants (PLUGIN_ID is persisted user data)
  host-adapter.ts   every host-schema read, behind runtime guards
  compat.ts         boot-time probe + console report
  catalog.ts        catalog data table (sections + items)
  store.ts          plugin-owned zustand: panel tab, stats scope
  panels/
    catalog-panel.tsx   the rail panel — Catalog / Stats tabs
```

## Conventions

- **Every dimension is metres.** Published warehouse specs are millimetres — divide by 1000. Never write a bare dimension literal greater than 100.
- `@pascal-app/*` are **peer** dependencies. A pinned copy creates a second `nodeRegistry` singleton and the kinds silently never resolve.
- Node kinds are namespaced `warehouse:`. Duplicate kinds warn in dev but **throw in production**.

## Installing into a Pascal host

The package is **self-contained** — its `tsconfig.json` extends nothing, its dependencies pin real versions, and it bundles no assets (panel icons are Iconify names the host resolves). It works identically as a monorepo workspace and as a git dependency, which is what lets it be developed here and shipped from its own repository without a rewrite.

Four edits in the host app:

**1. Depend on it**

```jsonc
// package.json
"@ovurrsl/plugin-warehouse": "github:ovurrsl/plugin-warehouse#<commit-sha>"
// …or, inside the editor monorepo: "*"
```

**2. Transpile it** — the package ships TypeScript source, not built JS:

```ts
// next.config.ts
transpilePackages: ['@ovurrsl/plugin-warehouse', /* … */]
```

**3. Let Tailwind see the panel's classes** — omit this and the panel renders completely unstyled, with no error:

```css
/* globals.css */
@source "../../../node_modules/@ovurrsl/plugin-warehouse/src";
```

**4. Register it, before the bootstrap kicks off discovery**

```ts
import { warehouseCatalogPanel, warehousePlugin } from '@ovurrsl/plugin-warehouse'

extendPluginDiscovery(async () => [warehousePlugin])
registerEditorHostPanel(warehouseCatalogPanel)
```

Use `extendPluginDiscovery`, never `setPluginDiscovery` — the latter replaces the whole chain and silently drops every other plugin.

> **This requires a host you can edit.** Plugin API v1 has no URL-manifest loader: discovery is a function somebody has to call, and the bootstrap module is the only call site. So the plugin drops into your own build or fork of the editor, but not into a hosted editor whose source you do not control.

## Known host limitation: duplicating plugin nodes

`packages/editor/src/lib/scene-clipboard.ts` validates clipboard nodes with `AnyNode.parse`. `AnyNode` is the host's hand-maintained union of built-in kinds, so a plugin-contributed kind can never be a member of it — the registry validates those against `def.schema` at runtime instead. The result: **`capabilities.duplicable` cannot be honoured for any plugin**, including the first-party `pascal:trees` pack, which declares it and fails identically.

Nothing in the plugin API works around it. `DuplicableConfig` exposes only `subtree` and `prepareSubtreeClone`, and both run *after* the parse that throws.

The host needs a fallback to the registry schema, at both call sites (the `remapNodeReferences` return, and the system-clipboard parse in `readClipboardPayload`):

```ts
function parseClipboardNode(candidate: unknown): AnyNode {
  const builtin = AnyNode.safeParse(candidate)
  if (builtin.success) return builtin.data
  const type = (candidate as { type?: unknown } | null)?.type
  const definition = typeof type === 'string' ? nodeRegistry.get(type) : undefined
  if (definition) return definition.schema.parse(candidate) as AnyNode
  throw builtin.error
}
```

Built-in behaviour is unchanged — `AnyNode` is tried first — and an unknown type still raises the original error.

> **Currently applied as a local patch to the host checkout.** It is not part of this package and does not travel with it: pulling a newer editor reverts it and duplicate silently starts failing again. Sending it upstream is what makes it durable.

## Extracting to a standalone repository

The package is written to make this a copy, not a port:

```sh
cp -r packages/plugin-warehouse ../plugin-warehouse
cd ../plugin-warehouse && git init && bun install
bun run check-types && bun test
```

Nothing needs editing. `.github/workflows/ci.yml` is inert inside the monorepo (GitHub only reads workflows from a repo root) and starts running on the first push.

Then point the host at the new repo by swapping the dependency to `github:ovurrsl/plugin-warehouse#<sha>` and the `@source` path to `node_modules/@ovurrsl/plugin-warehouse/src`.

To keep it extractable, three rules hold for anything added here:

- **Import from package barrels only** — `@pascal-app/core`, never `@pascal-app/core/src/...`. Deep paths are outside the `exports` map and break on the first release.
- **No workspace-only dependencies** — nothing resolved by `"*"` or by a path inside the editor monorepo.
- **No host assets.** `/icons/shelf.webp` exists in the editor app's `public/`, not in a consumer's. Icons are Iconify names; anything else must be bundled or inlined.

## Verifying

In dev the console prints:

```
[pascal:registry] + N discovered plugin(s)
[ovurrsl:warehouse] host compatibility ✅
```

That is the anchor. If those lines are missing, fix the wiring before debugging anything else.

## Scripts

```sh
bun run check-types
bun test
```
