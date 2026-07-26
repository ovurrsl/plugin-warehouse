import type { NodeDefinition } from '@pascal-app/core'
import { buildLauncherFloorplan } from './launcher-floorplan'
import { frameWidthM, localBoundsM, moduleLengthM } from './launcher-metrics'
import { conveyorLauncherParametrics } from './launcher-parametrics'
import { ConveyorLauncherNode } from './launcher-schema'
import { snapToLineEnd } from './port-magnet'
import { conveyorPorts } from './ports'

/** Every 45°, the full turn. Written out rather than derived: a mirrored-and-
 *  filtered list drops 0 as well as -0, which silently removes the one angle a
 *  user most expects to snap back to. */
const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

export const conveyorLauncherDefinition = {
  kind: 'warehouse:conveyor-launcher',
  schemaVersion: 1,
  schema: ConveyorLauncherNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',

  /**
   * A **fitting**, like every other shape of this kind. The host's run arm
   * rewrites a node's `path` to reach a moved neighbour, which is meaningless
   * for a body the catalogue builds at one fixed length; the fitting arm
   * translates it rigidly instead.
   *
   * Worth stating for this shape in particular: the host walks *every* port when
   * it snapshots connectivity, so dragging a launcher moves all three connected
   * lines as one rigid body, in one undo step.
   */
  distributionRole: 'fitting',
  facingIndicator: true,

  defaults: () => {
    const { id: _id, type: _type, ...rest } = ConveyorLauncherNode.parse({})
    return { ...rest, name: 'Launcher Conveyor' }
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      /** The magnet, shared with every shape of the kind. A launcher's three
       *  ends come from the same `localPorts` list — see `./ports`. */
      groupMoveSnap: ({ node, candidatePosition, movingIds, nodes }) => {
        const launcher = node as unknown as ConveyorLauncherNode
        return snapToLineEnd(
          launcher,
          candidatePosition,
          launcher.rotation?.[1] ?? 0,
          movingIds as readonly string[],
          nodes as Readonly<Record<string, unknown>>,
        )
      },
    },
    rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES },
    snappable: {},

    floorPlaced: {
      /**
       * **The main body, not the body plus the arm.**
       *
       * A footprint is the box a kind *tiles* at — that is what the shared clash
       * module compares two modules of one kind by — and launchers tile end to
       * end along their main line exactly as straights do. Declaring the arm
       * here would make two launchers standing back to back, arms pointing
       * apart, refuse each other over air.
       *
       * The arm is not unchecked: `../clash` returns both boxes as the volume
       * this module occupies, which is what every cross-kind test reads. What is
       * genuinely not compared is one launcher's arm against another launcher's
       * arm — a same-kind test, and therefore a footprint one. Stated rather
       * than hidden.
       */
      footprint: (node) => {
        const launcher = node as unknown as ConveyorLauncherNode
        return {
          dimensions: [moduleLengthM(launcher), launcher.transportHeight, frameWidthM(launcher)],
          rotation: launcher.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      /**
       * **Off, deliberately, and the placement tool does the test instead.**
       *
       * The host compares plan rectangles with no height, so it cannot tell a
       * conveyor threading a racking run's walkway from one driven through its
       * uprights. `../clash` answers in three dimensions, and for this shape
       * against the two boxes the steel actually occupies rather than the
       * rectangle round the L, a third of which is empty.
       */
      collides: false,
    },

    // Stated rather than auto-measured so the box stays put while a dimension is
    // being dragged, instead of re-measuring the rebuilt mesh every frame.
    dragBounds: (node) => {
      const launcher = node as unknown as ConveyorLauncherNode
      const bounds = localBoundsM(launcher)
      const height = bounds.max[1] - bounds.min[1]
      return {
        size: [bounds.max[0] - bounds.min[0], height, bounds.max[2] - bounds.min[2]],
        centerY: height / 2,
      }
    },
  },

  ports: conveyorPorts,

  parametrics: conveyorLauncherParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./launcher-renderer'),
  },

  floorplan: buildLauncherFloorplan,

  tool: () => import('./launcher-tool'),

  toolHints: [
    { key: 'Left click', label: 'Place launcher' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: 'H', label: 'Flip launch side' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Launcher Conveyor',
    description:
      'One launcher module. The main line runs through and a short arm throws the box off it at ninety degrees.',
    icon: { kind: 'iconify', name: 'lucide:git-fork' },
    // Keeps the kind out of the host's auto-derived Build palette so it is
    // reachable only from this plugin's catalog.
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      "One **module** of launcher roller conveyor (Mecalux CNV-LNC): a 900 mm body whose main line runs straight through, with a short lateral arm that throws the box off it at ninety degrees with a motorised roller. Use it where a line has to branch at speed and a curve would take too much floor. It has **three ends** — `a` and `b` on the main line, `c` on the arm — and `c` is always a discharge: this machine throws a box off the line, it never accepts one from the side. **A box leaves facing ninety degrees from how it arrived** (circuit rule R8), which is the difference between this and a curve: a curve preserves orientation, so the next section's box-length limits still follow from the last one's after a curve and do not after this. `launchSide` is which side the arm is on seen from above as goods travel, and it is a mirror rather than a rotation — turning the machine round would also swap which end is the infeed. `usefulWidth` is the box width class (400 or 600 mm) and is what two conveyors must match to be joined; the frame is 147 mm wider, the same as the straights. `transportHeight` is the top of the rollers, standard 570 or 750 mm. The body length, the 60 m/min speed, the 400 mm box and the 50 kg limit are all fixed by the type and are not fields. Dimensions are metres.",
  },
} satisfies NodeDefinition<typeof ConveyorLauncherNode>
