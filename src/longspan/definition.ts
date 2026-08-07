import type { NodeDefinition } from '@pascal-app/core'
import { buildLongspanFloorplan } from './floorplan'
import { bayPitch, totalDepth, totalWidth } from './levels'
import { snapToNeighbourSeam } from './magnet'
import { longspanParametrics } from './parametrics'
import { LongspanNode } from './schema'

/** Every 45°, the full turn. Written out rather than derived: a mirrored-and-
 *  filtered list drops 0 as well as -0, which silently removes the one angle a
 *  user most expects to snap back to. */
const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

export const longspanDefinition = {
  kind: 'warehouse:longspan-rack',
  schemaVersion: 1,
  schema: LongspanNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',
  // A shelving bay has a front: the picking face.
  facingIndicator: true,

  defaults: () => {
    const { id: _id, type: _type, ...rest } = LongspanNode.parse({})
    return { ...rest, name: 'Longspan Bay' }
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      /**
       * Bays share a frame only at exactly one bay pitch — half a millimetre —
       * and nothing the host offers reaches that. See `./magnet`.
       */
      groupMoveSnap: ({ node, candidatePosition, movingIds, nodes }) =>
        snapToNeighbourSeam(
          node as unknown as LongspanNode,
          candidatePosition,
          movingIds as readonly string[],
          nodes as Readonly<Record<string, unknown>>,
        ),
    },
    rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES },

    floorPlaced: {
      /**
       * **The pitch, not the outer width** — the third time this package states
       * it, and for the third time it is what stops two bays brought flush from
       * reading as a hard conflict and swallowing the click.
       */
      footprint: (node) => {
        const bay = node as unknown as LongspanNode
        return {
          dimensions: [bayPitch(bay), bay.frameHeight, totalDepth(bay)],
          rotation: bay.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      collides: true,
    },

    dragBounds: (node) => {
      const bay = node as unknown as LongspanNode
      return {
        size: [totalWidth(bay), bay.frameHeight, totalDepth(bay)],
        centerY: bay.frameHeight / 2,
      }
    },
  },

  parametrics: longspanParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  floorplan: buildLongspanFloorplan,

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place bay' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: '[ / ]', label: 'Levels' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'M7 Longspan',
    description:
      'One bay of M7 longspan shelving. Levels mix freely: beam-and-board, beamless HM, bare beams for long goods, or a garment rail.',
    icon: { kind: 'iconify', name: 'lucide:library' },
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      "One **bay** of Mecalux M7 longspan shelving. A run is a line of these nodes, not one node with a bay count: place them exactly `bayLength + upright width` apart along the local +X of their shared rotation and adjacent bays share a frame, so N bays stand on N+1 frames. Unlike pallet racking, **levels do not have to match**: `levels` is an array, and each entry picks its own `structure` — `beam-shelf` (beams plus a chipboard, mesh or galvanised panel), `reinforced-hm` (a one-piece HM shelf on four supports in the upright SIDE slots, no beams at all), `beam-only` (bare beams for long goods) or `hanging` (a garment rail). A level's elevation snaps to the face that carries it: 50 mm on the front slots for beams, 25 mm on the side slots for HM — so the same typed number can land at two different heights on two different structures, and that is correct. Catalogue series: frame heights 1.0–8.0 m in half-metre steps, bay lengths 1.0 / 1.2 / 1.4 / 1.9 / 2.3 / 2.7 m, depths 0.5–1.2 m; a bay cut to another length is reported, not corrected. A chipboard level 1.9 m or longer grows Z-TAM clamps automatically, and a double-depth chipboard level grows an MS-65 centre beam. Dimensions are metres.",
  },
} satisfies NodeDefinition<typeof LongspanNode>
