import type { NodeDefinition } from '@pascal-app/core'
import { buildCurveFloorplan } from './curve-floorplan'
import { footprintM, localBoundsM } from './curve-metrics'
import { conveyorCurveParametrics } from './curve-parametrics'
import { ConveyorCurveNode } from './curve-schema'
import { snapToLineEnd } from './port-magnet'
import { conveyorPorts } from './ports'

/** Every 45°, the full turn. Written out rather than derived: a mirrored-and-
 *  filtered list drops 0 as well as -0, which silently removes the one angle a
 *  user most expects to snap back to. */
const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

export const conveyorCurveDefinition = {
  kind: 'warehouse:conveyor-curve',
  schemaVersion: 1,
  schema: ConveyorCurveNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',

  /**
   * A bend is a **fitting**, for the same reason a straight is: the host's run
   * arm rewrites a node's `path` to reach a moved neighbour, which has no
   * meaning at all for a shape whose length is set by its radius and its angle.
   * The fitting arm translates it rigidly instead — so drag any module of a line
   * and the whole line follows, in one undo step.
   */
  distributionRole: 'fitting',
  facingIndicator: true,

  /** Derived from the schema rather than restated. Parsing an empty object gives
   *  exactly what the schema declares, so there is no second copy of every
   *  default to go stale. */
  defaults: () => {
    const { id: _id, type: _type, ...rest } = ConveyorCurveNode.parse({})
    return { ...rest, name: 'Curved Conveyor' }
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      /** The magnet, shared with the straight. A bend's ends are on its arc, and
       *  `localPorts` is the one place that differs — see `./ports`. */
      groupMoveSnap: ({ node, candidatePosition, movingIds, nodes }) => {
        const curve = node as unknown as ConveyorCurveNode
        return snapToLineEnd(
          curve,
          candidatePosition,
          curve.rotation?.[1] ?? 0,
          movingIds as readonly string[],
          nodes as Readonly<Record<string, unknown>>,
        )
      },
    },
    rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES },
    snappable: {},

    floorPlaced: {
      /**
       * The sector's bounding box, centred on the node — which is *why* the node
       * sits there rather than at the arc centre. The host's footprint is a box
       * centred on the node, and a sector's arc centre is at a corner of its
       * box, so a footprint centred there would be twice too big and half empty.
       */
      footprint: (node) => {
        const curve = node as unknown as ConveyorCurveNode
        const [width, depth] = footprintM(curve)
        return {
          dimensions: [width, curve.transportHeight, depth],
          rotation: curve.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      /**
       * **Off, deliberately, and the placement tool does the test instead.**
       *
       * Two reasons here where the straight has one. The host compares plan
       * rectangles with no height, so it cannot tell a conveyor threading a
       * racking run's walkway from one driven through its uprights. And a bend's
       * plan rectangle is mostly air: a quarter annulus fills under a third of
       * its own bounding square, so a plan test would refuse anything standing
       * in the corner the bend curls around — which in a real layout is exactly
       * where the racking goes.
       *
       * `../clash` answers both, in three dimensions and against the arc.
       */
      collides: false,
    },

    // Stated rather than auto-measured so the box stays put while the radius is
    // being dragged, instead of re-measuring the rebuilt mesh every frame.
    dragBounds: (node) => {
      const curve = node as unknown as ConveyorCurveNode
      const bounds = localBoundsM(curve)
      const height = bounds.max[1] - bounds.min[1]
      const [width, depth] = footprintM(curve)
      return { size: [width, height, depth], centerY: height / 2 }
    },
  },

  ports: conveyorPorts,

  parametrics: conveyorCurveParametrics,

  // Custom renderer rather than `def.geometry`: the geometry is cached and
  // shared by every bend of the same shape, and `<GeometrySystem>` disposes the
  // previous build's children on each rebuild.
  renderer: {
    kind: 'parametric',
    module: () => import('./curve-renderer'),
  },

  floorplan: buildCurveFloorplan,

  tool: () => import('./curve-tool'),

  toolHints: [
    { key: 'Left click', label: 'Place bend' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: '[ / ]', label: 'Angle 45 / 90 / 180' },
    { key: 'H', label: 'Flip hand' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Curved Conveyor',
    description:
      'One curved module. Turns a line through 45, 90 or 180° while keeping each box facing the way it entered.',
    icon: { kind: 'iconify', name: 'lucide:corner-up-left' },
    // Keeps the kind out of the host's auto-derived Build palette so it is
    // reachable only from this plugin's catalog.
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      "One **module** of curved roller conveyor (Mecalux CNV-CRA), the piece that turns a line through a corner. A line is a row of conveyor nodes, not one node with a path — join a bend to a straight by placing it so their ends coincide. It **preserves box orientation**: a box leaves facing the way it entered, which is what distinguishes a curve from a transfer and means the next section's box-length limits still apply. `angle` is 45, 90 or 180 degrees and `handed` is which way it turns seen from above as goods travel. `innerRadius` is the tight side in metres (0.4–2.5, default 0.8) and it is the number that decides whether a bend fits an aisle — the frame is 111 mm wider than the lane on this family, not the straights' 147. `usefulWidth` is the box width class (400 or 600 mm; the curve family stops at 600) and is what two conveyors must match to be joined. `transportHeight` is the top of the rollers, standard 570 or 750 mm; a curve runs level, the catalogue allows no inclination on this type. `shortestBox` bottoms out at 250 mm rather than the family's 150, because tapered rollers need more of a box to hold its line. **A bend has a maximum box length** set by the radius: a rigid box's outer corners swing wider than its centre, so at 800 mm inner radius a full-width 600 mm box tops out around 690 mm long. `zones` is 0, 1 or 2 accumulation zones. Dimensions are metres.",
  },
} satisfies NodeDefinition<typeof ConveyorCurveNode>
