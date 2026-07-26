import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

/**
 * A booster conveyor — **one module**, two ends, and the shortest driven bed in
 * the family.
 *
 * Catalogue: Mecalux "Conveyor Systems for Boxes" (MK-00200042-09/22), type
 * CNV-BST. It regulates the direction and passage of a load anywhere in an
 * installation and optimises cycle time, which is a *control* function — so
 * what it is on a drawing is a short straight with its drive underneath.
 *
 * It is a separate kind from CNV-CAR rather than a short one, and every
 * difference is the catalogue's:
 *
 * - **The frame is 67 mm over the lane, not 147.** 600 inside 667 is published.
 *   The drive sits under the bed rather than in a housing off the side, so the
 *   frame has nothing to make room for — this is the tightest section in the
 *   family and it is why the two cannot share a constant.
 * - **675 to 1050 mm, where a straight starts at 2.025 m.** Outside that range
 *   it is not a booster, it is a straight or nothing.
 * - **50 kg per box, not 100 kg per metre.** A booster handles one load at a
 *   time; a straight carries a distributed one.
 * - **No inclination and no accumulation.** Both zero on this type.
 *
 * Length is not a field. `rollers × rollerPitch` is, for the reason a straight
 * gives: a roller bed physically is a whole number of pitches, and a metres
 * slider would both produce lengths no supplier cuts and mint a geometry at
 * every step it passed through.
 *
 * Every dimension is metres.
 */
export const ConveyorBoosterNode = BaseNode.extend({
  id: objectId('conveyor_booster'),
  type: nodeType('warehouse:conveyor-booster'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  // ── The bed ───────────────────────────────────────────────────────────────

  /** Useful width — what two conveyors must agree on to be joined (R1). */
  usefulWidth: z.enum(['400', '600']).default('600'),

  /**
   * Rollers along the bed. **Length is this times the pitch and is never
   * stored.**
   *
   * The bounds are what the catalogue's 675–1050 mm range works out to across
   * the three pitches: seven at 100 mm reaches 700, twenty-one at 50 mm reaches
   * 1050. A count inside the bounds can still land outside the range at some
   * pitches, which is what the panel's invariant is for.
   */
  rollers: z.number().int().min(7).max(21).default(12),

  rollerPitch: z.enum(['50', '75', '100']).default('75'),

  /** Top of roller: the datum every drawing and neighbouring machine uses. */
  transportHeight: z.number().min(0.37).max(3).default(0.75),

  // ── Drive ─────────────────────────────────────────────────────────────────

  speed: z.enum(['25', '45', '60']).default('45'),

  /** Which way boxes travel, along the module's own local +X. */
  flow: z.enum(['forward', 'reverse']).default('forward'),

  // ── Guides ────────────────────────────────────────────────────────────────

  sideGuide: z.enum(['none', 'left', 'right', 'both']).default('both'),
  sideGuideHeight: z.number().min(0.035).max(0.12).default(0.068),

  // ── Load ──────────────────────────────────────────────────────────────────

  /** The shortest box this section is expected to carry. With the pitch it
   *  decides whether a box always sits on at least three rollers. */
  shortestBox: z.number().min(0.15).max(0.8).default(0.3),

  // ── Finish ────────────────────────────────────────────────────────────────

  frameColor: z.string().default('#1e56a0'),
  rollerColor: z.string().default('#c9ced3'),
  profileColor: z.string().default('#e8eaec'),

  supportSlabId: z.string().nullable().default(null),
})

export type ConveyorBoosterNode = z.infer<typeof ConveyorBoosterNode>
