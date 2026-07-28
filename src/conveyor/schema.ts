import { BaseNode, nodeType } from '@pascal-app/core'
import { z } from 'zod'
import { migratedObjectId } from '../ids'

/**
 * A continuously driven roller conveyor — **one module**.
 *
 * **The catalogue enums are stored as strings, and that is the host's contract
 * rather than a preference.** `ParamField`'s enum control declares
 * `options: readonly string[]`, renders a value only when `typeof value ===
 * 'string'`, and writes back `e.target.value`. Held as numbers, a pitch
 * therefore displayed as the *first* option whatever it really was, and the
 * first edit wrote `'75'` over `75` — which the schema then refused on the next
 * re-parse, so **Duplicate threw**. The numbers live one conversion away, in
 * `./metrics`, and nothing else reads the raw field.
 *
 * A module is the unit a supplier ships and a drawing schedules: a length of
 * bed on its own supports, with two ends that meet other modules. A line is not
 * a node; it is what you get when modules stand end to end, computed from their
 * ports rather than stored. That is the same decision the rack made about bays,
 * and for the same reason: a module is then an ordinary object, so selecting,
 * moving, copying, deleting and multi-selecting one all come from the host and
 * none of them need a sub-selection system.
 *
 * Catalogue: Mecalux "Conveyor Systems for Boxes" (MK-00200042-09/22), type
 * CNV-CAR. Figures live in `./catalog`; the ones the catalogue does not publish
 * live in `./constants`, marked.
 *
 * Every dimension is metres.
 */
export const ConveyorRollerNode = BaseNode.extend({
  id: migratedObjectId('conveyor-roller', 'conveyor_roller'),
  type: nodeType('warehouse:conveyor-roller'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  // ── The bed ───────────────────────────────────────────────────────────────

  /**
   * Useful width — the widest box the lane carries.
   *
   * The single most consequential field, because it is what two conveyors must
   * agree on before they can be joined (circuit rule R1). Stored as the
   * catalogue's class in millimetres rather than a metre float, so a joint is
   * decided by an equality rather than by a tolerance.
   *
   * The frame is 147 mm wider; that figure is derived in `./catalog` from every
   * straight the catalogue publishes both numbers for, never stored.
   */
  usefulWidth: z.enum(['400', '600']).default('600'),

  /**
   * Rollers along the bed. **Length is this times the pitch, and is never
   * stored.**
   *
   * A roller bed's length is a whole number of pitches — that is what it
   * physically is — so making the count the field means the length can never be
   * a value no supplier would cut. It also keeps the geometry cache flat: a
   * metres slider dragged from 2 m to 15 m mints a buffer at every step it
   * passes through, where a count steps in whole rollers.
   *
   * The panel still asks for a length in metres and converts, because that is
   * how a person specifies a conveyor. 27 rollers at 75 mm is the catalogue
   * minimum of 2.025 m; 200 is the 15 m maximum.
   */
  rollers: z.number().int().min(27).max(200).default(80),

  /** Roller pitch. A fixed set, not a slider — see `./constants` A2. */
  rollerPitch: z.enum(['50', '75', '100']).default('75'),

  /**
   * Top of roller: the height goods travel at, and the datum every drawing and
   * every neighbouring machine is dimensioned to.
   *
   * Not leg height — a leg is whatever it must be to put the rollers here, and
   * `./metrics` derives it. The catalogue's two standards are 0.57 and 0.75;
   * the range is what the adjustable supports reach.
   */
  transportHeight: z.number().min(0.37).max(3).default(0.75),

  // ── Drive ─────────────────────────────────────────────────────────────────

  /**
   * Line speed. Three catalogue values, so an enum: a conveyor is ordered at a
   * speed rather than tuned to one, and the middle one is the ordinary choice.
   */
  speed: z.enum(['25', '45', '60']).default('45'),

  /**
   * Which way boxes travel, along the module's own local +X.
   *
   * A property of the installation rather than the hardware — the same module
   * runs either way — but it decides which end is the discharge, so it is what
   * the magnet reads when it refuses to mate two outfeeds nose to nose.
   */
  flow: z.enum(['forward', 'reverse']).default('forward'),

  /**
   * Fall along the run. The catalogue allows a slight one on this type and
   * nothing on the accumulator, which is one of the two things that separate
   * them.
   */
  inclination: z.number().min(-6).max(6).default(0),

  /**
   * Whether this module carries the line's motor.
   *
   * One motor drives a whole continuously-activated line, so exactly one module
   * of a run should have this — which is a thing the panel can check and the
   * geometry has to reflect, since the housing is real steel hanging off the
   * side.
   */
  hasDrive: z.boolean().default(true),

  // ── Side guides ───────────────────────────────────────────────────────────

  /** Rails that stop a box walking off the edge. Both sides on a straight run;
   *  one side where the line is served from the other. */
  sideGuide: z.enum(['none', 'left', 'right', 'both']).default('both'),
  /** Guide height above the roller top. */
  sideGuideHeight: z.number().min(0.035).max(0.12).default(0.068),

  // ── Load ──────────────────────────────────────────────────────────────────

  /**
   * The shortest box this line is expected to carry.
   *
   * Not decoration: the catalogue's rule is that a box must always sit on at
   * least three rollers, so this and `rollerPitch` together decide whether the
   * line actually works. The panel checks it.
   */
  shortestBox: z.number().min(0.15).max(0.8).default(0.3),

  // ── Finish ────────────────────────────────────────────────────────────────

  frameColor: z.string().default('#1e56a0'),
  rollerColor: z.string().default('#c9ced3'),
  profileColor: z.string().default('#e8eaec'),

  /** Slab the module stands on, elected at placement time. */
  supportSlabId: z.string().nullable().default(null),
})

export type ConveyorRollerNode = z.infer<typeof ConveyorRollerNode>
