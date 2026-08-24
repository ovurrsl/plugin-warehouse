import type { NodeDefinition } from '@pascal-app/core'
import { clashGuardedMove } from '../clash'
import { treeLabel } from '../tree-label'
import { unitLoadHeightOf } from './cargo-types'
import { buildPalletFloorplan } from './floorplan'
import { palletParametrics } from './parametrics'
import { PALLET_PRESETS, specOf } from './presets'
import { PalletNode } from './schema'

/** Every 45°, the full turn. Written out rather than derived: a mirrored-and-
 * filtered list drops 0 as well as -0, which silently removed the one angle a
 * user most expects to snap back to. */
const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

/**
 * Declaring the full capability set is what makes a plugin node behave like a
 * built-in one, and it is mostly free.
 *
 * `movable` alone buys the entire generic 3D mover: grid, line and off snapping
 * modes, the alignment guides, R/T rotation, slab-elevation lift, the green/red
 * validity box, Alt to force-place, and a single undo step per drag. The
 * earlier version declared none of these and instead shipped a bespoke
 * `affordanceTools.move` — roughly two hundred lines that delivered translation
 * only, no rotation, no group transform, no magnetic snap, and which depended
 * on a forked copy of the host's `useDraftNode`. Deleting it removed the fork
 * dependency outright.
 */
export const palletDefinition = {
  kind: 'warehouse:pallet',
  schemaVersion: 1,
  schema: PalletNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',
  // A pallet has a front: fork entry is across the 1200 mm faces.
  facingIndicator: true,

  /**
   * Derived from the schema rather than restated, as every other kind in this
   * package does it. Written out by hand, the two drifted the moment a field was
   * added: the list above was a second copy of every default, and it silently
   * stopped matching.
   */
  defaults: () => {
    const { id: _id, type: _type, ...rest } = PalletNode.parse({})
    return rest
  },

  tree: {
    // Standart adı, artı yüklüyse yükü. Boş palet ile yüklü palet katalogda
    // iki ayrı fiş; ağaçta da ayrı okunmaları gerekiyor.
    label: treeLabel<PalletNode>((node) => {
      const preset = PALLET_PRESETS[node.preset].label
      return node.cargo === 'none' ? preset : `${preset} · ${node.cargo}`
    }),
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    movable: { axes: ['x', 'z'], gridSnap: true, ...clashGuardedMove() },
    rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES },
    snappable: {},

    floorPlaced: {
      footprint: (node) => {
        const pallet = node as unknown as PalletNode
        const spec = specOf(pallet.preset)
        return {
          dimensions: [spec.length, unitLoadHeightOf(pallet), spec.width],
          rotation: pallet.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      collides: true,
    },

    // The rendered subtree is exactly the pallet plus its load, so the
    // auto-measured box would be right — but stating it keeps the box stable
    // while a load height is being dragged, instead of re-measuring per frame.
    dragBounds: (node) => {
      const pallet = node as unknown as PalletNode
      const spec = specOf(pallet.preset)
      const height = unitLoadHeightOf(pallet)
      return { size: [spec.length, height, spec.width], centerY: height / 2 }
    },
  },

  parametrics: palletParametrics,

  // Custom renderer rather than `def.geometry`: the geometry is a module-level
  // singleton shared across the scene, and `<GeometrySystem>` disposes the
  // previous build's children on every rebuild. See the note in `renderer.tsx`.
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  /**
   * Baked `/viewer` sözleşmesi — rafın bildirdiğinin aynısı.
   *
   * Politikasız kind baked sahnede donmuş mesh olarak kalıyor; `replace` onu
   * gizletip seviyenin paletlerini canlı statik instancing'le çizdiriyor. Palet
   * paketin en kalabalık kind'ı olduğu için kazanç da en büyük burada. Eklenti
   * yüklü değilse politika `static`'e düşer ve baked mesh görünür kalır —
   * veri kaybı yok.
   */
  bake: 'replace',
  bakeReplaceRenderer: { module: () => import('./bake-replace') },

  floorplan: buildPalletFloorplan,

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place pallet' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Pallet',
    description: 'EPAL, GMA and plastic pallets. Set a load height to fill a rack position.',
    icon: { kind: 'iconify', name: 'lucide:package' },
    // Keeps the kind out of the host's auto-derived Build palette so it is
    // reachable only from this plugin's catalog. Also sidesteps a live gap:
    // `build-tab.tsx` enumerates the registry without checking install state,
    // so a palette-visible plugin kind would show even when uninstalled.
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      'A warehouse pallet. `preset` selects the standard (EPAL 1/2/3/6, quarter, GMA 48x40, plastic euro). `cargo` is `none` for a bare deck, or `carton`/`drum` for modelled goods whose height is derived from `fillRange` — a pallet has no typed load height. Dimensions are metres.',
  },
} satisfies NodeDefinition<typeof PalletNode>
