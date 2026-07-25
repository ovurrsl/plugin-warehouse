import type { NodeDefinition } from '@pascal-app/core'
import { buildPalletFloorplan } from './floorplan'
import { palletParametrics } from './parametrics'
import { specOf, unitLoadHeight } from './presets'
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

  defaults: () => ({
    object: 'node' as const,
    name: 'Pallet',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    preset: 'epal-1' as const,
    loadHeight: 0,
    slotAddress: null,
    slotRackId: null,
    supportSlabId: null,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES },
    snappable: {},

    floorPlaced: {
      footprint: (node) => {
        const pallet = node as unknown as PalletNode
        const spec = specOf(pallet.preset)
        return {
          dimensions: [spec.length, unitLoadHeight(pallet.preset, pallet.loadHeight), spec.width],
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
      const height = unitLoadHeight(pallet.preset, pallet.loadHeight)
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
      'A warehouse pallet. `preset` selects the standard (EPAL 1/2/3/6, quarter, GMA 48x40, plastic euro); `loadHeight` in metres is 0 for an empty pallet or the height of the goods carried. Dimensions are metres.',
  },
} satisfies NodeDefinition<typeof PalletNode>
