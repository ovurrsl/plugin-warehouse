import type { NodeDefinition } from '@pascal-app/core'
import { treeLabel } from '../tree-label'
import { buildDriveInFloorplan } from './floorplan'
import { frameTopY, lanePitch, totalDepth, totalWidth } from './lanes'
import { snapToNeighbourSeam } from './magnet'
import { driveInParametrics } from './parametrics'
import { DriveInRackNode } from './schema'

/** Every 45°, the full turn. Written out rather than derived: a mirrored-and-
 *  filtered list drops 0 as well as -0, which silently removes the one angle a
 *  user most expects to snap back to. */
const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

export const driveInRackDefinition = {
  kind: 'warehouse:drive-in-rack',
  schemaVersion: 1,
  schema: DriveInRackNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',
  // A lane has a front: the aisle face is where the truck drives in.
  facingIndicator: true,

  /**
   * Derived from the schema rather than restated — a second copy of every
   * default is the copy that silently goes stale.
   */
  defaults: () => {
    const { id: _id, type: _type, ...rest } = DriveInRackNode.parse({})
    return rest
  },

  tree: {
    // İki fiş, iki giriş kipi: drive-in tek uçtan, drive-through iki uçtan
    // yüklenir. Aynı ada düşmeleri hangisinin yerleştirildiğini gizliyordu.
    label: treeLabel<DriveInRackNode>((node) =>
      node.entryMode === 'drive-through' ? 'Drive-through Lane' : 'Drive-in Lane',
    ),
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
       * The magnet, and the reason a block can be built by hand at all.
       *
       * Lanes share a frame line only at *exactly* one lane pitch — half a
       * millimetre of tolerance — and nothing the host offers reaches that.
       * Alignment guides pull edge to edge inside an 8 cm window; grid snap
       * actively fights it, because 1.472 m is not a multiple of any grid step;
       * and Duplicate drops its copy one metre along world X and Z, ignoring
       * both the pitch and the node's rotation. See `./magnet`.
       */
      groupMoveSnap: ({ node, candidatePosition, movingIds, nodes }) =>
        snapToNeighbourSeam(
          node as unknown as DriveInRackNode,
          candidatePosition,
          movingIds as readonly string[],
          nodes as Readonly<Record<string, unknown>>,
        ),
    },
    rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES },

    floorPlaced: {
      /**
       * **The pitch, not the outer width.**
       *
       * A lane is `lanePitch` wide as far as the world is concerned, and its
       * steel overhangs that by half an upright each side — the half-post a
       * neighbour shares. Declaring the outer width instead makes two lanes at
       * the sharing pitch overlap by one upright, which `spatialGridManager`
       * reads as a hard conflict: the placement box goes red and the click is
       * swallowed every time a lane is brought flush against another. The one
       * gesture the whole kind is built around would be the one thing it
       * refused to do. The selective rack shipped that bug once; this is the
       * same figure the tool's placement box uses, for the same reason.
       */
      footprint: (node) => {
        const lane = node as unknown as DriveInRackNode
        return {
          dimensions: [lanePitch(lane), frameTopY(lane), totalDepth(lane)],
          rotation: lane.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      collides: true,
    },

    // Stated rather than auto-measured so the box stays put while a dimension
    // is being dragged, instead of re-measuring the rebuilt mesh every frame.
    dragBounds: (node) => {
      const lane = node as unknown as DriveInRackNode
      return {
        size: [totalWidth(lane), frameTopY(lane), totalDepth(lane)],
        centerY: frameTopY(lane) / 2,
      }
    },
  },

  parametrics: driveInParametrics,

  // Custom renderer rather than `def.geometry`: the geometry is cached and
  // shared by every lane of the same shape, and `<GeometrySystem>` disposes the
  // previous build's children on each rebuild. See the note in `renderer.tsx`.
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  /**
   * Baked `/viewer` sözleşmesi — rafla aynı, ve bir blok için farkı daha büyük.
   *
   * Politikasız kind baked sahnede donmuş mesh olarak kalıyor: on şeritlik bir
   * blok on ayrı mesh, hepsi aynı şekli çiziyor. `replace` baked mesh'i
   * gizletip seviyenin şeritlerini canlı statik instancing'le çizdiriyor, yani
   * blok şekil başına tek çizim çağrısına iniyor. Eklenti yüklü değilse
   * politika `static`'e düşer ve baked mesh görünür kalır — veri kaybı yok.
   */
  bake: 'replace',
  bakeReplaceRenderer: { module: () => import('./bake-replace') },

  floorplan: buildDriveInFloorplan,

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place lane' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: '[ / ]', label: 'Pallets deep' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Drive-in Rack',
    description:
      'One lane of drive-in racking — storage by accumulation, one SKU per lane. Lanes standing together share a frame line.',
    icon: { kind: 'iconify', name: 'lucide:rows-4' },
    // Keeps the kind out of the host's auto-derived Build palette so it is
    // reachable only from this plugin's catalog.
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      'One **lane** of drive-in pallet racking — storage by accumulation, one SKU per lane. A block is a line of these nodes, not one node with a lane count: to build ten lanes, create ten nodes exactly `laneClearWidth + uprightWidth` apart along the local +X of their shared rotation; at that spacing adjacent lanes share their upright frame line, so ten lanes stand on eleven frame lines. Pallets accumulate `palletsDeep` positions into local −Z from the aisle face and stack on `levels` rail levels plus the floor — **LIFO** from the single aisle face, so only the frontmost position of each level is directly reachable. `entryMode: "drive-through"` opens both ends for **FIFO** (constructive system 3 is then not allowed, because its braced plane stands across the far entrance). `laneClearWidth` follows the load: load width + 0.150 (1.350 for a flush EPAL 1 long-side-out). `railType: "gp"` self-centres and needs one pallet width throughout; `"c"` takes mixed widths and centres nothing. A second block goes back to back rotated 180°. Dimensions are metres.',
  },
} satisfies NodeDefinition<typeof DriveInRackNode>
