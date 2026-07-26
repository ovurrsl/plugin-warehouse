import type { NodeDefinition } from '@pascal-app/core'
import { buildConveyorFloorplan } from './floorplan'
import { frameWidthM, moduleLengthM } from './metrics'
import { conveyorRollerParametrics } from './parametrics'
import { ConveyorRollerNode } from './schema'

/** Every 45°, the full turn. Written out rather than derived: a mirrored-and-
 *  filtered list drops 0 as well as -0, which silently removes the one angle a
 *  user most expects to snap back to. */
const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

export const conveyorRollerDefinition = {
  kind: 'warehouse:conveyor-roller',
  schemaVersion: 1,
  schema: ConveyorRollerNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',
  // A conveyor has a direction, and it is the whole point of one.
  facingIndicator: true,

  /**
   * Derived from the schema rather than restated. Parsing an empty object gives
   * exactly what the schema declares, so there is no second copy of every
   * default to go stale.
   */
  defaults: () => {
    const { id: _id, type: _type, ...rest } = ConveyorRollerNode.parse({})
    return { ...rest, name: 'Roller Conveyor' }
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
      /**
       * The bed, exactly. Modules butt end to end, so the footprint length is
       * the bed length with no overhang to argue about — unlike the rack, whose
       * steel deliberately overhangs its footprint by the half-post a neighbour
       * shares.
       */
      footprint: (node) => {
        const conveyor = node as unknown as ConveyorRollerNode
        return {
          dimensions: [moduleLengthM(conveyor), conveyor.transportHeight, frameWidthM(conveyor)],
          rotation: conveyor.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      /**
       * **Off, deliberately, and the placement tool does the test instead.**
       *
       * The host compares plan rectangles — XZ only, no height — so it cannot
       * tell a conveyor threading the walkway under a racking run from one
       * driven through its uprights. `true` would refuse the pass-through,
       * which is a thing warehouses do constantly, and refuse it with a red box
       * and no explanation.
       *
       * So the height-aware test lives in `./clash`, against the rack's actual
       * steel: a tunnelled level emits no beams at all, so the clearance is
       * real rather than assumed, and what is left to hit is the legs. The
       * placement tool runs it per module of the run; the panel reports a clash
       * on a module that was fine until the rack around it changed.
       *
       * What is lost is host-side rejection while *moving* an existing module,
       * which the plugin cannot reach. Stated rather than hidden.
       */
      collides: false,
    },

    // Stated rather than auto-measured so the box stays put while a dimension
    // is being dragged, instead of re-measuring the rebuilt mesh every frame.
    dragBounds: (node) => {
      const conveyor = node as unknown as ConveyorRollerNode
      const height = conveyor.transportHeight + conveyor.sideGuideHeight
      return {
        size: [moduleLengthM(conveyor), height, frameWidthM(conveyor)],
        centerY: height / 2,
      }
    },
  },

  parametrics: conveyorRollerParametrics,

  // Custom renderer rather than `def.geometry`: the geometry is cached and
  // shared by every module of the same shape, and `<GeometrySystem>` disposes
  // the previous build's children on each rebuild.
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  floorplan: buildConveyorFloorplan,

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place run' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: '[ / ]', label: 'Modules in the run' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Roller Conveyor',
    description:
      'One module of continuously driven roller conveyor. Place a run of them; each module is its own object.',
    icon: { kind: 'iconify', name: 'lucide:move-right' },
    // Keeps the kind out of the host's auto-derived Build palette so it is
    // reachable only from this plugin's catalog.
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      'One **module** of continuously activated roller conveyor (Mecalux CNV-CAR). A line is a row of these nodes, not one node with a length — to build a 60 m run, create modules end to end along the local +X of their shared rotation, each offset by its own bed length. Bed length is `rollers × rollerPitch` and is never stored: `rollers` is an integer and `rollerPitch` is one of 50/75/100 mm, because a roller bed is physically a whole number of pitches. `usefulWidth` is the box width class (400 or 600 mm) and is what two conveyors must match to be joined; the frame is 147 mm wider. `transportHeight` is the top of the rollers — the datum every drawing uses — standard 570 or 750 mm, adjustable 370–3000. `speed` is one of 25/45/60 m/min. One motor drives a whole line, so set `hasDrive` on exactly one module of a run. The catalogue builds this type between 2.025 m and 15 m and allows up to 6° of fall. Dimensions are metres.',
  },
} satisfies NodeDefinition<typeof ConveyorRollerNode>
