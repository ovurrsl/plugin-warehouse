import type { NodeDefinition } from '@pascal-app/core'
import { buildBoosterFloorplan } from './booster-floorplan'
import { frameWidthM, localBoundsM, moduleLengthM } from './booster-metrics'
import { conveyorBoosterParametrics } from './booster-parametrics'
import { ConveyorBoosterNode } from './booster-schema'
import { snapToLineEnd } from './port-magnet'
import { conveyorPorts } from './ports'

/** Every 45°, the full turn. Written out rather than derived: a mirrored-and-
 *  filtered list drops 0 as well as -0, which silently removes the one angle a
 *  user most expects to snap back to. */
const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

export const conveyorBoosterDefinition = {
  kind: 'warehouse:conveyor-booster',
  schemaVersion: 1,
  schema: ConveyorBoosterNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',

  /**
   * A **fitting**, like every other shape of this kind. A booster's bed is
   * whatever its roller count makes it, so there is nothing for the host's run
   * arm to stretch even in principle; the fitting arm translates it rigidly and
   * the whole connected line follows in one undo step.
   */
  distributionRole: 'fitting',
  facingIndicator: true,

  defaults: () => {
    const { id: _id, type: _type, ...rest } = ConveyorBoosterNode.parse({})
    return { ...rest, name: 'Booster Conveyor' }
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      /** The magnet, shared with every shape of the kind — see `./ports`. */
      groupMoveSnap: ({ node, candidatePosition, movingIds, nodes }) => {
        const booster = node as unknown as ConveyorBoosterNode
        return snapToLineEnd(
          booster,
          candidatePosition,
          booster.rotation?.[1] ?? 0,
          movingIds as readonly string[],
          nodes as Readonly<Record<string, unknown>>,
        )
      },
    },
    rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES },
    snappable: {},

    floorPlaced: {
      /** The bed, exactly. Boosters butt end to end like straights, so the
       *  footprint length is the bed length with no overhang to argue about. */
      footprint: (node) => {
        const booster = node as unknown as ConveyorBoosterNode
        return {
          dimensions: [moduleLengthM(booster), booster.transportHeight, frameWidthM(booster)],
          rotation: booster.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      /**
       * **Off, deliberately, and the placement tool does the test instead.**
       *
       * The host compares plan rectangles with no height, so it cannot tell a
       * conveyor threading a racking run's walkway from one driven through its
       * uprights. `../clash` answers in three dimensions, against what this
       * machine occupies from the floor to the top of its guides — legs
       * included, because what fits under a tunnel has to fit with them.
       */
      collides: false,
    },

    // Stated rather than auto-measured so the box stays put while a dimension is
    // being dragged, instead of re-measuring the rebuilt mesh every frame.
    dragBounds: (node) => {
      const booster = node as unknown as ConveyorBoosterNode
      const bounds = localBoundsM(booster)
      const height = bounds.max[1] - bounds.min[1]
      return {
        size: [bounds.max[0] - bounds.min[0], height, bounds.max[2] - bounds.min[2]],
        centerY: height / 2,
      }
    },
  },

  ports: conveyorPorts,

  parametrics: conveyorBoosterParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./booster-renderer'),
  },

  floorplan: buildBoosterFloorplan,

  tool: () => import('./booster-tool'),

  toolHints: [
    { key: 'Left click', label: 'Place booster' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Booster Conveyor',
    description:
      'A short driven section that regulates a load’s passage and tightens the cycle. The tightest frame in the family.',
    icon: { kind: 'iconify', name: 'lucide:chevrons-right' },
    // Keeps the kind out of the host's auto-derived Build palette so it is
    // reachable only from this plugin's catalog.
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      'One **module** of booster conveyor (Mecalux CNV-BST): a short driven roller table that regulates the direction and passage of a load anywhere in an installation and optimises cycle time. Two ends. It is a separate type from the continuous straight rather than a short one — **the frame is 67 mm over the lane, not 147**, because the drive sits under the bed rather than in a housing beside it, which makes this the tightest section in the family. The catalogue builds it between 675 and 1050 mm and it carries 50 kg per box, not 100 kg per metre. Bed length is `rollers × rollerPitch` and is never stored: `rollers` is an integer and `rollerPitch` is one of 50/75/100 mm, because a roller bed is physically a whole number of pitches — which means a count inside its bounds can still land outside the catalogue length range, and the panel says so when it does. `usefulWidth` is the box width class (400 or 600 mm) and is what two conveyors must match to be joined. `transportHeight` is the top of the rollers, standard 570 or 750 mm. `speed` is one of 25/45/60 m/min. No inclination and no accumulation on this type. Dimensions are metres.',
  },
} satisfies NodeDefinition<typeof ConveyorBoosterNode>
