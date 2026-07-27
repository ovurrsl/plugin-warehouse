import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import type { EditorHostPanel } from '@pascal-app/editor'
import { conveyorBoosterDefinition } from './conveyor/booster-definition'
import { conveyorCurveDefinition } from './conveyor/curve-definition'
import { conveyorRollerDefinition } from './conveyor/definition'
import { conveyorLauncherDefinition } from './conveyor/launcher-definition'
import { conveyorObliqueDefinition } from './conveyor/oblique-definition'
import { conveyorTransferDefinition } from './conveyor/transfer-definition'
import { palletDefinition } from './pallet/definition'
import { CATALOG_PANEL_ID, PLUGIN_ID } from './plugin-id'
import { palletRackDefinition } from './rack/definition'
import { routeDefinition } from './route/definition'

/**
 * The manifest barrel — the entire public surface of this package.
 *
 * A host bootstrap imports this **eagerly**, during server prerender, so
 * everything reachable from here must be SSR-safe: no `document`, no `window`,
 * no Three.js at module scope. Node definitions qualify because they are plain
 * data plus lazy module references; renderers, geometry builders, and the panel
 * are reached only through those lazy thunks.
 *
 * `import type { EditorHostPanel }` is erased at compile time and emits no
 * runtime import, so typing the panel against the real host type costs nothing
 * on the SSR path — and unlike a hand-rolled structural copy, it will not drift.
 */
export const warehousePlugin: Plugin = {
  id: PLUGIN_ID,
  // Literal 1. `loadPlugin` throws on any other value, which is the intended
  // behaviour: a host that has moved on should refuse this plugin loudly
  // rather than load it against a contract it no longer honours.
  apiVersion: 1,
  // The cast mirrors the built-in bundle's. `AnyNode` is a hand-maintained
  // discriminated union of host kinds, so it cannot by construction know about
  // a plugin's — the registry validates against `def.schema` at runtime.
  nodes: [
    palletDefinition as unknown as AnyNodeDefinition,
    palletRackDefinition as unknown as AnyNodeDefinition,
    conveyorRollerDefinition as unknown as AnyNodeDefinition,
    conveyorCurveDefinition as unknown as AnyNodeDefinition,
    conveyorLauncherDefinition as unknown as AnyNodeDefinition,
    conveyorBoosterDefinition as unknown as AnyNodeDefinition,
    conveyorTransferDefinition as unknown as AnyNodeDefinition,
    conveyorObliqueDefinition as unknown as AnyNodeDefinition,
    routeDefinition as unknown as AnyNodeDefinition,
  ],
}

export const warehouseCatalogPanel: EditorHostPanel = {
  id: CATALOG_PANEL_ID,
  // Must string-match `warehousePlugin.id` — this is the key the host stores in
  // the scene graph's `installedPlugins`, and the one the rail filters on.
  pluginId: PLUGIN_ID,
  label: 'Warehouse',
  description: 'Pallet racking, pallets, and warehouse layout tools.',
  icon: { kind: 'iconify', name: 'lucide:warehouse' },
  // Fills the host's plugin detail card — `plugins-panel.tsx` renders Creator
  // and a "View plugin" link from these, and omits each row when its field is
  // absent. They live on the panel rather than the `Plugin` manifest because
  // the card is host UI reading `EditorHostPanel`, not the registry.
  creator: { name: 'ovurrsl', url: 'https://github.com/ovurrsl' },
  pluginUrl: 'https://github.com/ovurrsl/plugin-warehouse',
  // Kept in sync with the manifest so `panelForKind` can route the host's
  // "find in catalog" action to this panel.
  kinds: [
    'warehouse:pallet',
    'warehouse:pallet-rack',
    'warehouse:conveyor-roller',
    'warehouse:conveyor-curve',
    'warehouse:conveyor-launcher',
    'warehouse:conveyor-booster',
    'warehouse:conveyor-transfer',
    'warehouse:conveyor-oblique',
  ],
  // A stable module-level thunk: the host caches the wrapped component in a
  // WeakMap keyed on this function's identity, so an inline arrow would rebuild
  // the lazy boundary on every render.
  component: () => import('./panels/catalog-panel'),
  defaultInstalled: true,
}

// No re-export of `./pallet/geometry-builder` or `./pallet/epal-textures`:
// the atlas touches `document`, and this barrel is imported eagerly during
// server prerender. The lazy renderer/tool modules import them directly.
export { palletDefinition } from './pallet/definition'
export { PALLET_PRESETS, type PalletPreset } from './pallet/presets'
export { PalletNode } from './pallet/schema'
export { CATALOG_PANEL_ID, KIND_PREFIX, PLUGIN_ID } from './plugin-id'
export { palletRackDefinition } from './rack/definition'
export { PalletRackNode } from './rack/schema'
export default warehousePlugin
