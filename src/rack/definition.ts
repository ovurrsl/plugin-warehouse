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
  /**
   * 2 — a node is one bay, where version 1 was a whole block.
   *
   * Old scenes still load: `BaseNode` is a plain `z.object()`, so the removed
   * block fields are dropped on parse and every surviving field keeps its value.
   * What is honestly lost is the *count*: a saved twenty-bay block reopens as
   * one bay. There is no migration that would not be a lie in the other
   * direction — turning one node into twenty on load would invent nineteen
   * objects the user never placed and could not undo.
   */
  schemaVersion: 2,
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
    { key: 'Left click', label: 'Place run' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: '[ / ]', label: 'Bays in the run' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Pallet Rack',
    description:
      'One bay of adjustable pallet racking. Multiply it into a run — each bay is its own object, and bays standing together share a post.',
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
      'One **bay** of adjustable pallet racking. A run is a line of these nodes, not one node with a bay count — to build twenty bays, create twenty nodes one bay pitch apart along the local +X of their shared rotation, where the pitch is `bayClearWidth + uprightWidth`. Placed at exactly that spacing they share their upright frames automatically, so twenty bays stand on twenty-one frames; anywhere else each bay closes itself off. A second run goes behind the first at `rowDepth + aisle` along local −Z, turned 180° if the two are meant to stand back to back on separate aisles. `levels`, `bayClearWidth` and `uprightHeight` set the frame; `palletPreset` and `palletOrientation` set how many pallets a level holds (a 2.7 m bay takes three EPAL 1 short-side-out, two long-side-out). `depthPositions: 2` stores a second pallet behind the first on the same aisle. `pickingLevels` converts the lowest levels to hand-picked container shelves. `tunnelLevels` opens a walkway through this bay, which is how a fire route crosses a run — set it on the bays it passes through. Dimensions are metres.',
  },
} satisfies NodeDefinition<typeof PalletRackNode>
