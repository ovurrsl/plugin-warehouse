import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

/**
 * A mixed transfer roller & belt conveyor — **one module**, and the piece that
 * turns a line through ninety degrees without turning the box.
 *
 * Catalogue: Mecalux "Conveyor Systems for Boxes" (MK-00200042-09/22), type
 * CNV-MTR. A fixed square body carries a roller bed; belt strips rise *between*
 * the rollers to take the box the other way, and a collapsible limit buffer
 * positions it while they do.
 *
 * **A box leaves facing ninety degrees from how it arrived** (circuit rule R8).
 * That is what separates a transfer from a curve — a curve preserves
 * orientation, so the next section's box-length limits still follow from the
 * last one's after a bend and do not after this.
 *
 * Four fields the rest of the family has are missing, and each absence is the
 * catalogue speaking:
 *
 * - **No `usefulWidth`.** Every port on this type is the 400 mm class. An enum
 *   of one is a control that cannot be used; anything joined to it must be that
 *   class, which the joint checker reports.
 * - **No `rollers` or length.** The body is 708 × 723 whatever it carries. This
 *   type has no lane the frame is built around — it is a machine of a size.
 * - **No `rollerPitch`.** The pitch follows the strip layout rather than the
 *   other way round: the rollers have to fall between the strips.
 * - **No `inclination`.** Zero on every transfer.
 *
 * Every dimension is metres.
 */
export const ConveyorTransferNode = BaseNode.extend({
  id: objectId('conveyor_transfer'),
  type: nodeType('warehouse:conveyor-transfer'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  // ── The transfer ──────────────────────────────────────────────────────────

  /**
   * Which side the box is taken off to, seen from above as goods travel the
   * roller direction.
   *
   * **A field rather than a rotation.** Turning the module 180° would put the
   * discharge on the other side, but it would also swap which end is the
   * infeed — so a left-discharging machine is genuinely not a right-discharging
   * one turned round, and the two are different meshes.
   */
  dischargeSide: z.enum(['left', 'right']).default('left'),

  /**
   * How far the belt strips carry the box.
   *
   * The catalogue's two options. Symmetric strips span the whole body and set
   * the box down centred on the cross line; asymmetric ones are shorter and
   * hand it over sooner, which is what a tight installation buys at the cost of
   * a shorter travel.
   */
  travel: z.enum(['symmetric', 'asymmetric']).default('symmetric'),

  /** Which way boxes travel along the roller bed, in the module's own local +X. */
  flow: z.enum(['forward', 'reverse']).default('forward'),

  /**
   * Top of roller: the datum every drawing and neighbouring machine uses.
   *
   * **The floor is 500 mm, not the family's 370.** The lift mechanism lives
   * under the bed and needs the room — which is also why this machine has a
   * closed lower body where the others show their legs.
   */
  transportHeight: z.number().min(0.5).max(3).default(0.75),

  // ── Drive ─────────────────────────────────────────────────────────────────

  /** Two speeds, not the family's three: the box is lifted and set down rather
   *  than carried past, and 60 m/min is not offered on this type. */
  speed: z.enum(['25', '45']).default('45'),

  // ── Load ──────────────────────────────────────────────────────────────────

  /** The shortest box this transfer is expected to handle, along the roller
   *  direction. The catalogue's floor here is 250 mm, not the family's 150. */
  shortestBox: z.number().min(0.25).max(0.6).default(0.3),

  // ── Finish ────────────────────────────────────────────────────────────────

  frameColor: z.string().default('#1e56a0'),
  rollerColor: z.string().default('#c9ced3'),
  /** The belt strips. Orange in every catalogue render, and the one part of this
   *  machine a person recognises it by. */
  stripColor: z.string().default('#e87722'),

  supportSlabId: z.string().nullable().default(null),
})

export type ConveyorTransferNode = z.infer<typeof ConveyorTransferNode>
