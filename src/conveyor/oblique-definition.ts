import type { NodeDefinition } from '@pascal-app/core'
import { buildObliqueFloorplan } from './oblique-floorplan'
import { localBoundsM, mainWidthM, moduleLengthM } from './oblique-metrics'
import { conveyorObliqueParametrics } from './oblique-parametrics'
import { ConveyorObliqueNode } from './oblique-schema'
import { snapToLineEnd } from './port-magnet'
import { conveyorPorts } from './ports'

/** Every 45°, the full turn. Written out rather than derived: a mirrored-and-
 *  filtered list drops 0 as well as -0, which silently removes the one angle a
 *  user most expects to snap back to. */
const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

export const conveyorObliqueDefinition = {
  kind: 'warehouse:conveyor-oblique',
  schemaVersion: 1,
  schema: ConveyorObliqueNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',

  /**
   * A **fitting**, like every other shape of this kind. The body is fixed at
   * 1500 mm, so there is nothing for the host's run arm to stretch even in
   * principle; the fitting arm translates it rigidly instead.
   *
   * Worth stating for a three-ended shape: the host walks *every* port when it
   * snapshots connectivity, so dragging a branch moves all three connected lines
   * as one rigid body, in one undo step.
   */
  distributionRole: 'fitting',
  facingIndicator: true,

  defaults: () => {
    const { id: _id, type: _type, ...rest } = ConveyorObliqueNode.parse({})
    return { ...rest, name: 'Oblique Transfer' }
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    movable: {
      axes: ['x', 'z'],
      gridSnap: true,
      /** The magnet, shared with every shape of the kind. This one's branch port
       *  can be bidirectional, which is what `PortRole`'s `'both'` exists for —
       *  see `./ports`. */
      groupMoveSnap: ({ node, candidatePosition, movingIds, nodes }) => {
        const oblique = node as unknown as ConveyorObliqueNode
        return snapToLineEnd(
          oblique,
          candidatePosition,
          oblique.rotation?.[1] ?? 0,
          movingIds as readonly string[],
          nodes as Readonly<Record<string, unknown>>,
        )
      },
    },
    rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES },
    snappable: {},

    floorPlaced: {
      /**
       * **The main line, not the main line plus the branch.**
       *
       * A footprint is the box a kind *tiles* at, and obliques tile end to end
       * along their main line exactly as straights do. Declaring the branch here
       * would make two obliques standing back to back, branches pointing apart,
       * refuse each other over air.
       *
       * The branch is not unchecked: `../clash` returns both beds as the volume
       * this module occupies, which is what every cross-kind test reads. What is
       * genuinely not compared is one oblique's branch against another's — a
       * same-kind test, and therefore a footprint one. Stated rather than
       * hidden.
       */
      footprint: (node) => {
        const oblique = node as unknown as ConveyorObliqueNode
        return {
          dimensions: [moduleLengthM(oblique), oblique.transportHeight, mainWidthM(oblique)],
          rotation: oblique.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      /**
       * **Off, deliberately, and the placement tool does the test instead.**
       *
       * The host compares plan rectangles with no height, so it cannot tell a
       * conveyor threading a racking run's walkway from one driven through its
       * uprights. `../clash` answers in three dimensions, and for this shape
       * against the two beds the steel actually occupies rather than the
       * rectangle round the Y, most of which is the wedge between them — and in
       * a real layout that wedge is where the line the branch feeds runs.
       */
      collides: false,
    },

    // Stated rather than auto-measured so the box stays put while a dimension is
    // being dragged, instead of re-measuring the rebuilt mesh every frame.
    dragBounds: (node) => {
      const oblique = node as unknown as ConveyorObliqueNode
      const bounds = localBoundsM(oblique)
      const height = bounds.max[1] - bounds.min[1]
      return {
        size: [bounds.max[0] - bounds.min[0], height, bounds.max[2] - bounds.min[2]],
        // Off the origin: the branch leaves one side, so the steel does not
        // straddle the node — see the launcher's, which has the same shape of
        // problem for the same reason.
        center: [
          (bounds.min[0] + bounds.max[0]) / 2,
          height / 2,
          (bounds.min[2] + bounds.max[2]) / 2,
        ],
        centerY: height / 2,
      }
    },
  },

  ports: conveyorPorts,

  parametrics: conveyorObliqueParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./oblique-renderer'),
  },

  floorplan: buildObliqueFloorplan,

  tool: () => import('./oblique-tool'),

  toolHints: [
    { key: 'Left click', label: 'Place branch' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: 'H', label: 'Flip branch side' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Oblique Transfer Conveyor',
    description:
      'Branches a line at an angle without stopping it: a narrower lane leaves the main bed, taken by short angled rollers.',
    icon: { kind: 'iconify', name: 'lucide:split' },
    // Keeps the kind out of the host's auto-derived Build palette so it is
    // reachable only from this plugin's catalog.
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      "One **module** of oblique box transfer (Mecalux CNV-OBQ): a fixed 1500 mm main line with a narrower lane leaving it at an angle, taken by short angled rollers in the merge triangle. Used for entry and exit branches and for inducting boxes onto a high-speed line. Three ends: `a` and `b` on the main line and `c` on the branch. **The branch is a narrower class than the main line** — 467 mm outside against 667 — which is the catalogue's own geometry and is what makes circuit rule R11 (a line's accepted box narrows at its junctions) a fact about this module rather than a warning: a box that has to take the branch cannot be wider than the branch. **It does not change a box's orientation** — a branch changes which line the box is on, not how it faces — so unlike a launcher or a mixed transfer the next section's box-length limits still follow from the last one's. `branchMode` is `divert`, `merge` or `both`; the catalogue ships the port bidirectional, so `both` is the default and the narrower settings exist because a drawing usually knows which it is — the port's role follows it, which is what stops a divert being mated onto another divert. `angle` is 30 or 45 degrees and it is not free: the body is fixed, so the branch has to leave far enough back to clear the main frame by the module's end, and a shallower angle pushes that split earlier — the panel reports where. `branchSide` is a mirror rather than a rotation, since turning the module round would also swap which end is the infeed. Every divert branch needs a decision point behind it (a barcode read, rule R10); there is no node for one yet, so the plan symbol draws a diamond where it has to go. Dimensions are metres.",
  },
} satisfies NodeDefinition<typeof ConveyorObliqueNode>
