import type { NodeDefinition } from '@pascal-app/core'
import { buildPalletRackFloorplan } from './floorplan'
import { palletRackParametrics } from './parametrics'
import { PalletRackNode } from './schema'
import { totalDepth, totalWidth } from './slots'

/** Every 45°, the full turn. Written out rather than derived: a mirrored-and-
 *  filtered list drops 0 as well as -0, which silently removes the one angle a
 *  user most expects to snap back to. */
const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

/**
 * Declaring the full capability set is what makes a plugin node behave like a
 * built-in one, and it is mostly free.
 *
 * `movable` alone buys the entire generic 3D mover: every snapping mode, the
 * alignment guides, R/T rotation, slab-elevation lift, the green/red validity
 * box, Alt to force-place, and one undo step per drag. Shipping a bespoke
 * `affordanceTools.move` instead — which the version this replaces did — is
 * roughly two hundred lines that deliver translation and nothing else.
 */
export const palletRackDefinition = {
  kind: 'warehouse:pallet-rack',
  schemaVersion: 1,
  schema: PalletRackNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',
  // A rack has a front: the aisle face is where the forks go in.
  facingIndicator: true,

  /**
   * Derived from the schema rather than restated.
   *
   * A rack has fifty-odd fields; writing them out here would be a second copy
   * of every default, and the copy that silently goes stale is the one nobody
   * reads. Parsing an empty object gives exactly what the schema declares.
   */
  defaults: () => {
    const { id: _id, type: _type, ...rest } = PalletRackNode.parse({})
    return { ...rest, name: 'Pallet Rack' }
  },

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
        const rack = node as unknown as PalletRackNode
        return {
          dimensions: [totalWidth(rack), rack.uprightHeight, totalDepth(rack)],
          rotation: rack.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      collides: true,
    },

    // Stated rather than auto-measured so the box stays put while a dimension
    // is being dragged, instead of re-measuring the rebuilt mesh every frame.
    dragBounds: (node) => {
      const rack = node as unknown as PalletRackNode
      return {
        size: [totalWidth(rack), rack.uprightHeight, totalDepth(rack)],
        centerY: rack.uprightHeight / 2,
      }
    },
  },

  parametrics: palletRackParametrics,

  // Custom renderer rather than `def.geometry`: the geometry is cached and
  // shared by every rack of the same shape, and `<GeometrySystem>` disposes the
  // previous build's children on each rebuild. See the note in `renderer.tsx`.
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  floorplan: buildPalletRackFloorplan,

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place rack' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: '[ / ]', label: 'Bays' },
    { key: 'Shift+click', label: 'Place a row of racks' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Pallet Rack',
    description:
      'Adjustable pallet racking. Bays share their frames; set the pallet standard and orientation and the capacity follows.',
    icon: { kind: 'iconify', name: 'lucide:rows-3' },
    // Keeps the kind out of the host's auto-derived Build palette so it is
    // reachable only from this plugin's catalog. Also sidesteps a live gap:
    // `build-tab.tsx` enumerates the registry without checking install state,
    // so a palette-visible plugin kind would show even when uninstalled.
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      'Adjustable pallet racking, one continuous run of bays sharing their upright frames. `bayCount`, `levels`, `bayClearWidth` and `uprightHeight` set the frame; `palletPreset` and `palletOrientation` set how many pallets a level holds (a 2.7 m bay takes three EPAL 1 short-side-out, two long-side-out). `backToBack` adds a second run served from its own aisle; `depthPositions: 2` stores a second pallet behind the first on the same aisle. `pickingLevels` converts the lowest levels to hand-picked container shelves. Dimensions are metres.',
  },
} satisfies NodeDefinition<typeof PalletRackNode>
