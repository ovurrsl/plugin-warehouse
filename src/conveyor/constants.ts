/**
 * The figures the catalogue does **not** publish.
 *
 * Every value here was read off a render or inferred from a rule of thumb, and
 * every one is a place this model could be wrong. They live in their own file
 * for exactly that reason: `./catalog` is what Mecalux says, this is what we
 * had to decide, and a reviewer can tell which is which without reading either
 * carefully. Changing one of these is a modelling decision; changing one of
 * those is a typo.
 *
 * The ids match the assumption table in the research document
 * (`Konveyor_Sistemi_Plani_v1.md` §8) so the two can be checked against each
 * other by hand.
 *
 * Metres, like everything downstream of `./catalog`.
 */

const mm = (value: number): number => value / 1000

/**
 * **A1 — roller diameter, 50 mm.**
 *
 * The standard for box conveyors and consistent with every catalogue render.
 * Not a field: no layout decision turns on it, and a slider walking it would
 * mint a geometry per step for a difference nobody can see past two metres.
 */
export const ROLLER_DIAMETER_M = mm(50)

/**
 * **A2 — roller pitch, 75 mm default, from a fixed set.**
 *
 * The catalogue gives no pitch, only the rule that a box must always be
 * supported by at least three rollers — so `pitch ≤ shortestBox / 3`. Against
 * the family's 150–800 mm box range that admits 50 (for 150 mm boxes), 75 (for
 * 250 mm and up, the ordinary case) and 100 (for 300 mm and up).
 *
 * **A fixed set rather than a number field, and that is a cache decision as
 * much as a modelling one.** Pitch sets the roller stripe's repeat, so it is in
 * the geometry key; a free slider dragged from 50 to 100 mm mints a buffer at
 * every step it passes through, and MCP or a typed entry could produce 83 mm,
 * which no supplier ships. The rack learned the same lesson the expensive way
 * with `decking`.
 */
export const ROLLER_PITCHES_MM = [50, 75, 100] as const
export type RollerPitch = (typeof ROLLER_PITCHES_MM)[number]
export const DEFAULT_ROLLER_PITCH: RollerPitch = 75

/** The catalogue's own support rule, and the reason the pitch set is what it
 *  is: three rollers under the shortest box, always. */
export const MIN_ROLLERS_UNDER_A_BOX = 3

/**
 * **A4 — support spacing, 1.5 m, plus one at every module joint.**
 *
 * From the renders. The joint rule is the load-bearing half: two abutting
 * modules must share one support rather than each building its own, which is
 * the same doubled-steel problem the rack solved for upright frames.
 */
export const MAX_SUPPORT_SPACING_M = mm(1500)

/**
 * **A5 — side profile depth, 100 mm, top edge flush with the roller top.**
 *
 * From the renders. "Flush with the roller top" is the part that matters: it
 * makes the transport height the top of the profile as well, so a box slides
 * from one module to the next without a lip, and the panel's TOR figure is the
 * one you would measure with a tape.
 */
export const SIDE_PROFILE_DEPTH_M = mm(100)
/** Wall thickness of the formed side profile. */
export const SIDE_PROFILE_THICKNESS_M = mm(3)

/**
 * **A9 — the palette, approximated from catalogue photography.**
 *
 * Colours ride in the vertex-colour attribute, so these cost nothing: the whole
 * conveyor family draws from one material whatever the palette says. They are
 * defaults on the node rather than constants, except the ones no user would
 * ever set.
 */
export const PALETTE = {
  /** Frames and legs. Mecalux blue. */
  frameBlue: '#1e56a0',
  /** Rollers and drums — bright zinc, which is why the material wants a lower
   *  roughness than the rack's powder-coated steel. */
  rollerZinc: '#c9ced3',
  /** Side profiles and curve kerbs. */
  profileGrey: '#e8eaec',
  /** Motor housings and control boxes. */
  boxWhite: '#f4f5f6',
  /** Adjustable feet and base plates. */
  feetGrey: '#70767c',
  /** Drive rollers and lifting frames. */
  accentOrange: '#e87722',
} as const

/** Leg section, from the renders. Square tube. */
export const LEG_SECTION_M = mm(60)
/** Base plate under each leg, and how far it overhangs the tube. */
export const FOOTPLATE_THICKNESS_M = mm(8)
export const FOOTPLATE_OVERHANG_M = mm(25)
/** Crossbar tying the two legs of a support station together. */
export const CROSSBAR_SECTION_M = mm(40)
/** Height of the crossbar above the floor, so a pallet truck can pass under a
 *  line standing at the 750 mm transport height. */
export const CROSSBAR_CLEARANCE_M = mm(200)

/** Side guide rail: the profile that stops a box walking off the edge. */
export const SIDE_GUIDE_SECTION_M = mm(40)
export const SIDE_GUIDE_THICKNESS_M = mm(15)
/** Standard guide height above the roller top. */
export const DEFAULT_SIDE_GUIDE_HEIGHT_M = mm(68)

/** Motor block at the head of a driven line — one per line, not per module,
 *  which is what distinguishes CAR from the zoned accumulator. */
export const MOTOR_BLOCK_M: readonly [number, number, number] = [mm(300), mm(220), mm(180)]
