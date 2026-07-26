import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

/**
 * A launcher roller conveyor — **one module**, and the first piece in this kind
 * with three ends.
 *
 * Catalogue: Mecalux "Conveyor Systems for Boxes" (MK-00200042-09/22), type
 * CNV-LNC. The main bed runs straight through; a short lateral bed launches the
 * box off it at ninety degrees with a motorised roller. It is what a line uses
 * where a branch has to be taken at speed and a curve would take too much floor.
 *
 * **A box leaves facing ninety degrees from how it arrived** (circuit rule R8),
 * which is the difference between this and a bend: a curve preserves
 * orientation, so the next section's box-length limits still apply after one and
 * do not after this.
 *
 * Three fields the straight has are missing on purpose, and each absence is the
 * catalogue speaking rather than an omission:
 *
 * - **No `speed`.** The type is built at 60 m/min and nothing else. An enum of
 *   one is a control that cannot be used; the figure is a property of the type
 *   and the panel reports it.
 * - **No `shortestBox`.** The launch is dimensioned around a 400 mm box, fixed.
 *   There is no support rule to check against a pitch here because the box the
 *   machine carries is not a choice.
 * - **No `inclination`.** Zero on every transfer.
 *
 * Every dimension is metres.
 */
export const ConveyorLauncherNode = BaseNode.extend({
  id: objectId('conveyor_launcher'),
  type: nodeType('warehouse:conveyor-launcher'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  // ── The bed ───────────────────────────────────────────────────────────────

  /**
   * Useful width — the widest box the lane carries, and what this must share
   * with whatever it is joined to (R1). The frame is 147 mm wider, the straight
   * family's own figure, so this type brings no overhang of its own.
   */
  usefulWidth: z.enum(['400', '600']).default('600'),

  /** Roller pitch. The bed length is fixed at 900 mm, so unlike a straight this
   *  sets the roller count rather than the length. */
  rollerPitch: z.enum(['50', '75', '100']).default('75'),

  /** Top of roller: the datum every drawing and neighbouring machine uses. */
  transportHeight: z.number().min(0.37).max(3).default(0.75),

  // ── The launch ────────────────────────────────────────────────────────────

  /**
   * Which side the box is launched to, seen from above as goods travel the main
   * line.
   *
   * **A field rather than a rotation.** Turning the module 180° would put the
   * lateral bed on the other side, but it would also swap which end is the
   * infeed — so a left-launching machine is genuinely not a right-launching one
   * turned round, and the two are different meshes.
   */
  launchSide: z.enum(['left', 'right']).default('left'),

  /** Which way boxes travel along the main bed, in the module's own local +X. */
  flow: z.enum(['forward', 'reverse']).default('forward'),

  // ── Guides ────────────────────────────────────────────────────────────────

  /**
   * A rail on the side the box is **not** launched to.
   *
   * There is exactly one side it can go on, which is why this is a switch rather
   * than the straight's four-way enum: a guide across the launch opening is a
   * guide the box has to pass through.
   */
  sideGuide: z.boolean().default(true),
  sideGuideHeight: z.number().min(0.035).max(0.12).default(0.068),

  // ── Finish ────────────────────────────────────────────────────────────────

  frameColor: z.string().default('#1e56a0'),
  rollerColor: z.string().default('#c9ced3'),
  profileColor: z.string().default('#e8eaec'),

  supportSlabId: z.string().nullable().default(null),
})

export type ConveyorLauncherNode = z.infer<typeof ConveyorLauncherNode>
