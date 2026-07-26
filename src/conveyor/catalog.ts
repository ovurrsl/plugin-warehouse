/**
 * Conveyor figures, from the catalogue.
 *
 * **Source of record: Mecalux, "Conveyor Systems for Boxes", ref.
 * MK-00200042-09/22.** Every number in this file is published there. Nothing
 * here is estimated — the values that had to be estimated live in
 * `./constants`, separately and by name, so the two can never be confused.
 *
 * That split is the whole point of the file. A dimension a supplier publishes
 * and a dimension somebody eyeballed off a render are different kinds of fact,
 * and a rack that ships a 2.7 m bay because EN 15620 says so is a different
 * object from one that ships 2.7 m because it looked about right. The rack kind
 * makes the same distinction in prose; here it is enforced by which file a
 * number lives in.
 *
 * Millimetres divided by 1000 at the boundary: published specs are millimetres,
 * the host stores metres, and nothing downstream of this file may write a bare
 * length literal above 100 — that is always a unit mistake.
 */

/** Millimetres to metres, applied once at this boundary. */
const mm = (value: number): number => value / 1000

// ── Common to the whole family ──────────────────────────────────────────────

/**
 * Transport height — the top of the rollers, which is the datum a layout
 * drawing and every neighbouring machine are dimensioned to. Not leg length:
 * a leg is whatever it has to be to put the rollers here.
 */
export const STANDARD_TRANSPORT_HEIGHTS_M = [mm(570), mm(750)] as const
export const TRANSPORT_HEIGHT_RANGE_M = [mm(370), mm(3000)] as const

/**
 * The three speeds the catalogue offers. **Three values, not a range** — a
 * conveyor is ordered at a speed, not tuned to one, and an enum keeps the panel
 * honest about that.
 */
export const SPEEDS_M_PER_MIN = [25, 45, 60] as const
export type ConveyorSpeed = (typeof SPEEDS_M_PER_MIN)[number]

/**
 * Useful box width classes. This is the number two conveyors must agree on
 * before they can be joined — circuit rule R1 — so it is the conveyor's
 * equivalent of the rack's bay pitch: the one figure the connection predicate
 * reads.
 */
export const USEFUL_WIDTH_CLASSES_MM = [400, 600, 800] as const
export type UsefulWidthClass = (typeof USEFUL_WIDTH_CLASSES_MM)[number]

/** Box sizes the family carries, along the direction of flow. */
export const BOX_LENGTH_RANGE_M = [mm(150), mm(800)] as const

/**
 * Frame width over the useful width, for the straight roller and belt family.
 *
 * Derived rather than tabulated, and the derivation is exact across every
 * straight type the catalogue publishes both figures for: LRA 800 → 947,
 * CAR 600 → 747, FRE 600 → 747, BLT 600 → 747. The frame takes 73.5 mm a side.
 *
 * Curves are +111 and the booster +67 — different families with different side
 * profiles, so when those kinds land they bring their own constant rather than
 * bending this one.
 */
export const STRAIGHT_FRAME_OVERHANG_M = mm(147)

export function exteriorWidthM(usefulWidthMm: number): number {
  return mm(usefulWidthMm) + STRAIGHT_FRAME_OVERHANG_M
}

// ── The transfer family ─────────────────────────────────────────────────────

/**
 * Unit load for the transfer family — **50 kg per box**, where CAR is 100 kg
 * per *metre* of bed.
 *
 * Two different quantities, and the difference is the machine. A straight
 * carries a distributed load because one motor pulls a continuous run; a
 * transfer lifts, launches or diverts one box at a time, so its limit is per
 * box. Circuit rule R7 is the cross-check, and it cannot be written against the
 * straight's figure.
 */
export const TRANSFER_UNIT_LOAD_KG = 50

/**
 * Frame width over the useful width, for the **booster**: 67 mm, against the
 * straights' 147 and the curves' 111.
 *
 * Derived from the two figures the catalogue publishes for this type — 600
 * useful inside a 667 exterior — and it is by far the tightest in the family.
 * That is the machine: a booster is a short, deep table whose job is to regulate
 * the passage of a load, so it carries its drive underneath rather than in a
 * housing off the side, and the frame has nothing to make room for.
 */
export const BOOSTER_FRAME_OVERHANG_M = mm(67)

/**
 * CNV-BST · Booster.
 *
 * Not a junction: two ends and one short driven bed. It regulates the direction
 * and passage of a load anywhere in an installation and optimises cycle time —
 * a *control* function, which is why what it is on a drawing is a short straight
 * with a drive box under it.
 *
 * It sits in the transfer family for the reason that matters here: the 50 kg
 * limit is per box, not per metre of bed.
 */
export const BST = {
  id: 'CNV-BST',
  nameEn: 'Booster Conveyor',
  loadKg: TRANSFER_UNIT_LOAD_KG,
  usefulWidthsMm: [400, 600] as const,
  exteriorWidthMaxM: mm(667),
  lengthRangeM: [mm(675), mm(1050)] as const,
  boxLengthRangeM: [mm(150), mm(800)] as const,
  speedsMPerMin: [25, 45, 60] as const,
  maxInclinationDeg: 0,
  accumulation: 'none',
} as const

export function boosterExteriorWidthM(usefulWidthMm: number): number {
  return mm(usefulWidthMm) + BOOSTER_FRAME_OVERHANG_M
}

/**
 * CNV-OBQ · Oblique Box Transfer.
 *
 * A branch rather than a corner: the main line runs through and a narrower lane
 * leaves it at an angle, for entry and exit branches and for inducting boxes
 * onto a high-speed line.
 *
 * **The branch is a narrower class than the main**, 467 mm outside against 667.
 * That is the catalogue's own geometry, and it is what makes circuit rule R11 —
 * the box length a line accepts narrows at its junctions — a fact about this
 * module rather than a general warning. It is also the reason a port carries its
 * own lane in this package: read off the node, this machine would report its
 * branch as a mismatch against itself.
 *
 * Unlike the launcher and the mixed transfer, **it does not change a box's
 * orientation**: a box leaving on the branch keeps its heading relative to the
 * branch it is now on.
 */
export const OBQ = {
  id: 'CNV-OBQ',
  nameEn: 'Oblique Box Transfer',
  loadKg: TRANSFER_UNIT_LOAD_KG,
  lengthM: mm(1500),
  mainExteriorWidthM: mm(667),
  branchExteriorWidthM: mm(467),
  speedsMPerMin: [25, 45, 60] as const,
  maxInclinationDeg: 0,
  /** R8 does not apply here. A curve preserves orientation and so does this;
   *  what a branch changes is which line the box is on, not how it faces. */
  changesBoxOrientation: false,
} as const

/**
 * CNV-MTR · Mixed Transfer Roller & Belt.
 *
 * A fixed square body: a roller bed with belt strips that rise *between* the
 * rollers to carry the box the other way, and a collapsible limit buffer that
 * positions it during the transfer.
 *
 * **This type has no frame overhang, because it has no lane.** The body is
 * 708 × 723 whatever it carries; the 400 mm figure is the widest box the rollers
 * take in their own direction, not a channel the frame is built around. Every
 * other shape in the family is lane-plus-something; this one is a machine of a
 * size.
 *
 * Two figures are unlike anything else here and both are real constraints. The
 * **variable height floor is 500 mm, not 370** — the lift mechanism lives under
 * the bed and needs the room. And the **speeds stop at 45**, where the rest of
 * the family reaches 60: the box is being lifted and set down, not carried past.
 */
export const MTR = {
  id: 'CNV-MTR',
  nameEn: 'Mixed Transfer Roller & Belt Conveyor',
  loadKg: TRANSFER_UNIT_LOAD_KG,
  /** The body, fixed in both directions. */
  lengthM: mm(708),
  widthM: mm(723),
  /** The widest box the rollers carry, in their own direction. The one class
   *  this type is built in, so anything it joins must be that class too. */
  boxWidthWithRollersMaxM: mm(400),
  boxLengthRollerDirRangeM: [mm(250), mm(600)] as const,
  /** The family's floor is 370; the lift mechanism under the bed raises it. */
  transportHeightRangeM: [mm(500), mm(3000)] as const,
  speedsMPerMin: [25, 45] as const,
  maxInclinationDeg: 0,
  /** R8 — a box leaves a mixed transfer facing ninety degrees from how it
   *  arrived. A curve preserves orientation; this does not. */
  changesBoxOrientation: true,
} as const

/**
 * CNV-LNC · Launcher Roller.
 *
 * A T: the main bed runs through and a short lateral bed launches the box off
 * it at ninety degrees with a motorised roller.
 *
 * **One speed and one box length, both fixed.** The launch is a timed impulse
 * rather than a setting, so neither is a field — the panel reports them and the
 * schema does not carry them. The frame is the straight family's 147 mm over
 * the lane, which is why this type does not bring its own overhang.
 */
export const LNC = {
  id: 'CNV-LNC',
  nameEn: 'Launcher Roller Conveyor',
  loadKg: TRANSFER_UNIT_LOAD_KG,
  usefulWidthsMm: [400, 600] as const,
  exteriorWidthMaxM: mm(747),
  lengthM: mm(900),
  /** Fixed, not a range: the launcher is dimensioned around one box. */
  boxLengthM: mm(400),
  speedMPerMin: 60,
  maxInclinationDeg: 0,
  /** R8 — a box leaves a launcher facing ninety degrees from how it arrived. */
  changesBoxOrientation: true,
} as const

// ── CNV-CAR · Continuous Activated Roller ───────────────────────────────────

/**
 * The first type, and the plainest straight in the family: one motor drives the
 * whole line, boxes accumulate by touching each other, and it runs the longest
 * uninterrupted sections. Everything else in the roller family is this plus a
 * difference — zones and a control box for the accumulator, no motor for the
 * gravity one — so it is the body the others are built on.
 */
export const CAR = {
  id: 'CNV-CAR',
  nameEn: 'Continuous Activated Roller Conveyor',
  /** Load is per metre of bed, not per box: one motor pulls the whole run. */
  loadKgPerMetre: 100,
  usefulWidthsMm: [400, 600] as const,
  exteriorWidthMaxM: mm(747),
  lengthRangeM: [mm(2025), mm(15000)] as const,
  /**
   * A slight fall is allowed, which is what separates this from the accumulator
   * (0°) and puts it one rule short of a proper incline conveyor.
   */
  maxInclinationDeg: 6,
  accumulation: 'contact',
} as const
