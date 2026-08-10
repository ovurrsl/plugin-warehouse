import type { NodeDefinition } from '@pascal-app/core'
import { snapToLineEnd } from './port-magnet'
import { conveyorPorts } from './ports'
import { buildTransferFloorplan } from './transfer-floorplan'
import { frameWidthM, localBoundsM, moduleLengthM } from './transfer-metrics'
import { conveyorTransferParametrics } from './transfer-parametrics'
import { ConveyorTransferNode } from './transfer-schema'

/** Every 45°, the full turn. Written out rather than derived: a mirrored-and-
 *  filtered list drops 0 as well as -0, which silently removes the one angle a
 *  user most expects to snap back to. */
const SNAP_ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)

export const conveyorTransferDefinition = {
  kind: 'warehouse:conveyor-transfer',
  schemaVersion: 1,
  schema: ConveyorTransferNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',

  /**
   * A **fitting**, like every other shape of this kind. A transfer's body is
   * fixed at 708 by 723 in the catalogue, so there is nothing for the host's run
   * arm to stretch even in principle; the fitting arm translates it rigidly and
   * the whole connected line follows in one undo step.
   *
   * Not "whatever its roller count makes it", which is the booster's reason and
   * was carried here by a scripted copy: this type has no roller count and no
   * pitch at all, and derives its roller positions from the strips.
   */
  distributionRole: 'fitting',
  facingIndicator: true,

  defaults: () => {
    const { id: _id, type: _type, ...rest } = ConveyorTransferNode.parse({})
    return rest
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
        const transfer = node as unknown as ConveyorTransferNode
        return snapToLineEnd(
          transfer,
          candidatePosition,
          transfer.rotation?.[1] ?? 0,
          movingIds as readonly string[],
          nodes as Readonly<Record<string, unknown>>,
        )
      },
    },
    rotatable: { axes: ['y'], snapAngles: SNAP_ANGLES },
    snappable: {},

    floorPlaced: {
      /** The body, exactly, and centred on the node — a transfer is square and
       *  symmetric about both axes, so unlike the launcher there is no arm
       *  sticking out for the footprint to misdescribe. */
      footprint: (node) => {
        const transfer = node as unknown as ConveyorTransferNode
        return {
          dimensions: [moduleLengthM(transfer), transfer.transportHeight, frameWidthM(transfer)],
          rotation: transfer.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      /**
       * **Off, deliberately, and the placement tool does the test instead.**
       *
       * The host compares plan rectangles with no height, so it cannot tell a
       * conveyor threading a racking run's walkway from one driven through its
       * uprights. `../clash` answers in three dimensions, against what this
       * machine occupies from the floor to the roller top — skirt and legs
       * included, because what fits under a tunnel has to fit with them.
       */
      collides: false,
    },

    // Stated rather than auto-measured so the box stays put while a dimension is
    // being dragged, instead of re-measuring the rebuilt mesh every frame.
    dragBounds: (node) => {
      const transfer = node as unknown as ConveyorTransferNode
      const bounds = localBoundsM(transfer)
      const height = bounds.max[1] - bounds.min[1]
      return {
        size: [bounds.max[0] - bounds.min[0], height, bounds.max[2] - bounds.min[2]],
        centerY: height / 2,
      }
    },
  },

  ports: conveyorPorts,

  parametrics: conveyorTransferParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./transfer-renderer'),
  },

  floorplan: buildTransferFloorplan,

  tool: () => import('./transfer-tool'),

  toolHints: [
    { key: 'Left click', label: 'Place transfer' },
    { key: 'H', label: 'Flip discharge side' },
    { key: 'R / T', label: 'Rotate 45°' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Mixed Transfer Conveyor',
    description:
      'Turns a line through ninety degrees without turning the box: belt strips rise between the rollers and carry it off sideways.',
    icon: { kind: 'iconify', name: 'lucide:move-diagonal' },
    // Keeps the kind out of the host's auto-derived Build palette so it is
    // reachable only from this plugin's catalog.
    hidden: true,
    paletteSection: 'furnish',
  },

  mcp: {
    description:
      "One **module** of mixed transfer roller & belt conveyor (Mecalux CNV-MTR): a fixed 708 × 723 mm body whose roller bed carries the box one way while belt strips rise *between* the rollers to take it off at ninety degrees, with a collapsible limit buffer positioning it during the transfer. **A box leaves facing ninety degrees from how it arrived** (circuit rule R8) — that is what separates a transfer from a curve, which preserves orientation, and it means the next section's box-length limits no longer follow from the last one's. Three ends: `a` and `b` on the roller line, `c` on the cross discharge, and `c` is always an outlet because the strips lift a box off the line and never set one onto it. **Every port is the 400 mm class** — the only one this type is built in — so anything joined to it must be that class. `dischargeSide` is which side the box is taken off to seen from above, and it is a mirror rather than a rotation: turning the machine round would also swap which end is the infeed. `travel` is the catalogue's symmetric (longer) or asymmetric (shorter) strip build; asymmetric sets the box down short of the cross centreline, so whatever receives it must be placed to meet the strips. `transportHeight` is the top of the rollers, standard 570 or 750 mm — **the floor is 500 mm here, not the family's 370**, because the lift mechanism lives under the bed. `speed` is 25 or 45 m/min; this type does not reach the family's 60. The body size, the roller spacing and the 50 kg limit are fixed by the type and are not fields. Dimensions are metres.",
  },
} satisfies NodeDefinition<typeof ConveyorTransferNode>
