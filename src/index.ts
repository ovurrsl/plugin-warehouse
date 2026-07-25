import type { Plugin } from '@pascal-app/core'
import type { EditorHostPanel } from '@pascal-app/editor'
import { CATALOG_PANEL_ID, PLUGIN_ID } from './plugin-id'

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
  nodes: [],
}

export const warehouseCatalogPanel: EditorHostPanel = {
  id: CATALOG_PANEL_ID,
  // Must string-match `warehousePlugin.id` — this is the key the host stores in
  // the scene graph's `installedPlugins`, and the one the rail filters on.
  pluginId: PLUGIN_ID,
  label: 'Warehouse',
  description: 'Pallets, racking, handling equipment, and a warehouse capacity readout.',
  icon: { kind: 'iconify', name: 'lucide:warehouse' },
  // Kept in sync with the manifest so `panelForKind` can route the host's
  // "find in catalog" action to this panel.
  kinds: [],
  // A stable module-level thunk: the host caches the wrapped component in a
  // WeakMap keyed on this function's identity, so an inline arrow would rebuild
  // the lazy boundary on every render.
  component: () => import('./panels/catalog-panel'),
  defaultInstalled: true,
}

export { CATALOG_PANEL_ID, KIND_PREFIX, PLUGIN_ID } from './plugin-id'
export default warehousePlugin
