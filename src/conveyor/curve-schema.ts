import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

/**
 * A curved roller conveyor — **one module**, and the piece that lets a line turn
 * a corner.
 *
 * Catalogue: Mecalux "Conveyor Systems for Boxes" (MK-00200042-09/22), type
 * CNV-CRA — *Curved Roller Accumulation*. Used where an architectural
 * obstruction stops a straight run, and it **preserves the box's orientation**,
 * which is what distinguishes it from a crossover: a box leaves a curve facing
 * the way it entered, and leaves a transfer facing differently. That difference
 * decides whether the next section's box-length limits still apply, so it is a
 * property of the kind rather than a note.
 *
 * Three things differ from the straight and each is a catalogue figure rather
 * than a convenience:
 *
 * - **The frame is 111 mm wider than the lane, not 147.** Curves are their own
 *   family: 600 → 711 where a straight is 600 → 747. The inner and outer kerbs
 *   are formed differently from a straight's side profiles.
 * - **The shortest box is 250 mm, not 150.** A box on a curve is carried by
 *   tapered rollers whose inner ends run slower than their outer, and a short
 *   box does not span enough of them to hold its line.
 * - **The useful width tops out at 600 mm**, where the accumulator reaches 800.
 *
 * Every dimension is metres; angles are degrees, because that is how a curve is
 * ordered.
 */
export const ConveyorCurveNode = BaseNode.extend({
  id: objectId('conveyor_curve'),
  type: nodeType('warehouse:conveyor-curve'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  // ── The arc ───────────────────────────────────────────────────────────────

  /**
   * How far the line turns. The three the catalogue builds, so an enum: a
   * curve is ordered at an angle, and an arbitrary one would mint a geometry
   * per degree while describing a module nobody ships.
   */
  angle: z.enum(['45', '90', '180']).default('90'),

  /**
   * Inner radius — the tight side of the bend.
   *
   * **Not a catalogue figure.** Mecalux does not publish it; 800 mm is read off
   * the renders (assumption A3) and left adjustable because it is the number
   * that decides whether a curve fits an aisle. A field rather than a constant,
   * and the panel says which it is.
   */
  innerRadius: z.number().min(0.4).max(2.5).default(0.8),

  /** Which way the bend goes, seen from above, as goods travel. */
  handed: z.enum(['left', 'right']).default('left'),

  /**
   * Useful width — the widest box the lane carries, and what two conveyors must
   * agree on to be joined. The curve family stops at 600 mm.
   */
  usefulWidth: z.enum(['400', '600']).default('600'),

  /**
   * Roller pitch **at the inner radius**, which is where they are closest and
   * therefore where the support rule binds.
   *
   * The roller count is derived from it and the angle, then the angular step is
   * recomputed to divide the arc exactly — so the rollers always reach both
   * ends of the bend instead of leaving a wedge at one. A tapered roller *is* a
   * constant angular step, so getting that right makes the outer pitch correct
   * by construction.
   */
  rollerPitch: z.enum(['50', '75', '100']).default('75'),

  /** Top of roller: the datum every drawing and neighbouring machine uses. A
   *  curve runs level — the catalogue allows no inclination on this type. */
  transportHeight: z.number().min(0.37).max(3).default(0.75),

  // ── Drive ─────────────────────────────────────────────────────────────────

  speed: z.enum(['25', '45', '60']).default('45'),

  /** Which end goods enter by, along the arc. */
  flow: z.enum(['forward', 'reverse']).default('forward'),

  /**
   * Accumulation zones along the bend. The catalogue offers none, one or two —
   * a curve is short, and a zone needs length to hold a box in.
   */
  zones: z.enum(['0', '1', '2']).default('0'),

  // ── Guides ────────────────────────────────────────────────────────────────

  /**
   * A curve throws a box outward, so the outer guide is not optional in the way
   * a straight's is. Both by default; `inner` alone is a deliberate choice for a
   * bend served from outside.
   */
  sideGuide: z.enum(['none', 'inner', 'outer', 'both']).default('both'),
  sideGuideHeight: z.number().min(0.035).max(0.12).default(0.068),

  // ── Load ──────────────────────────────────────────────────────────────────

  /** The shortest box the bend is expected to carry. The catalogue's floor for
   *  this type is 250 mm, not the family's 150. */
  shortestBox: z.number().min(0.25).max(0.8).default(0.3),

  // ── Finish ────────────────────────────────────────────────────────────────

  frameColor: z.string().default('#1e56a0'),
  rollerColor: z.string().default('#c9ced3'),
  profileColor: z.string().default('#e8eaec'),

  supportSlabId: z.string().nullable().default(null),
})

export type ConveyorCurveNode = z.infer<typeof ConveyorCurveNode>
