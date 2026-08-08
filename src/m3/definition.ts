import type { NodeDefinition } from '@pascal-app/core'
import { bayPitch, totalDepth, totalWidth } from './bays'
import { buildM3Floorplan } from './floorplan'
import { snapToNeighbourSeam } from './magnet'
import { m3Parametrics } from './parametrics'
import { M3ShelvingNode } from './schema'

/** Every 45°, the full turn. Written out rather than derived: a mirrored-and-
 *  filtered list drops 0 as well as -0, which silently removes the one angle a
 *  user most expects to snap back to. */
const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

export const m3ShelvingDefinition = {
  kind: 'warehouse:m3-rack',
  schemaVersion: 1,
  schema: M3ShelvingNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',
  // A picking bay has a front: the face you pick from, and the face the doors
  // hang on. +Z, the convention this package uses throughout.
  facingIndicator: true,

  defaults: () => {
    const { id: _id, type: _type, ...rest } = M3ShelvingNode.parse({})
    return { ...rest, name: 'M3 Bay' }
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
          node as unknown as M3ShelvingNode,
          candidatePosition,
          movingIds as readonly string[],
          nodes as Readonly<Record<string, unknown>>,
        ),
    },
    rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES },

    floorPlaced: {
      /**
       * **The pitch, not the outer width** — the fourth time this package
       * states it, and for the fourth time it is what stops two bays brought
       * flush from reading as a hard conflict and swallowing the click.
       */
      footprint: (node) => {
        const bay = node as unknown as M3ShelvingNode
        return {
          dimensions: [bayPitch(bay), bay.frameHeight, totalDepth(bay)],
          rotation: bay.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      collides: true,
    },

    dragBounds: (node) => {
      const bay = node as unknown as M3ShelvingNode
      return {
        size: [totalWidth(bay), bay.frameHeight, totalDepth(bay)],
        centerY: bay.frameHeight / 2,
      }
    },
  },

  parametrics: m3Parametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  /**
   * Baked `/viewer` sözleşmesi — rafla ve şeritle aynı.
   *
   * Politikasız kind baked sahnede donmuş mesh olarak kalıyor: on baylık bir
   * run on ayrı mesh, hepsi aynı şekli çiziyor. `replace` baked mesh'i
   * gizletip seviyenin bay'lerini canlı statik instancing'le çizdiriyor, yani
   * run şekil başına tek çizim çağrısına iniyor. Eklenti yüklü değilse politika
   * `static`'e düşer ve baked mesh görünür kalır — veri kaybı yok.
   */
  bake: 'replace',
  bakeReplaceRenderer: { module: () => import('./bake-replace') },

  floorplan: buildM3Floorplan,

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
    label: 'M3 Shelving',
    description:
      'One bay of M3 picking shelving. Shelves hang off the uprights on a 25 mm grid — no beams. Levels carry panels or drawers.',
    icon: { kind: 'iconify', name: 'lucide:layout-grid' },
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      "One **bay** of Mecalux M3 picking shelving — light and medium loads, hand picking. A run is a line of these nodes, not one node with a bay count: place them exactly `shelfLength + 0.030` apart along the local +X of their shared rotation and adjacent bays share a frame, so N bays stand on N+1 frames. **There are no beams**: a shelf is a folded panel carried at its four corners by supports hooked into the upright's side slots, so every level in the system snaps to ONE 25 mm grid — unlike M7, which needs two pitches. `levels` is an array; each entry is either a `shelf` (an HL or HM panel, optionally with slotted dividers standing on it) or `drawers` (that same panel carrying a row of polypropylene drawers). **Three figures are derived and have no field**: the cross-brace count (CATALOG — one set to 2.5 m, two above it, none behind a back panel), the drawer count per level (`floor(shelfLength / drawer width)`, which reproduces the catalogue's published 4/8 at 1,000 mm and 5/10 at 1,250 mm) and the divider height (the tallest published divider that fits the opening above). Catalogue series: shelf lengths 750 / 1.000 / 1.250 / 1.400 mm, depths 300 / 400 / 500 / 600 mm, frame heights 1.5 / 2.0 / 2.5 / 2.75 / 3.0 / 4.0 m (the Spanish edition adds 1.0 / 2.25 / 3.5), manufacturable to 8 m before the upright is spliced. A `door` exists **only** on a 1,000 mm bay, in 1,000 or 2,000 mm; asked for on any other length it is drawn and reported as unorderable rather than silently dropped. Load is the one **published** capacity in this plugin: 150 kg per level on an HL panel, 275 kg on an HM one, independent of the bay's size. Dimensions are metres.",
  },
} satisfies NodeDefinition<typeof M3ShelvingNode>
