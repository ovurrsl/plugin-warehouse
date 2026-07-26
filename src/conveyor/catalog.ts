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

/**
 * Circuit rules that bear on a straight run, from the catalogue's own list.
 * The rest arrive with the kinds they constrain — a rule about lifts is not
 * worth writing before there is a lift.
 *
 * These are the conveyor's `parametrics.invariants`: a plausible set of numbers
 * can describe a conveyor nobody would ship, and every one of these failures is
 * quiet.
 */
export const CIRCUIT_RULES = {
  /** R1 — joined ports must carry the same useful width class. */
  matchingWidthClass: 'R1',
  /** R2 — joined ports must sit at the same transport height, no tolerance. */
  matchingTransportHeight: 'R2',
  /** R3 — inclination is per type; CAR tops out at 6°. */
  inclinationByType: 'R3',
  /** R6 — above 60 m/min the catalogue moves you to a belt. */
  speedCeiling: 'R6',
  /** R11 — the shortest box a line accepts is set by its tightest section. */
  boxLengthNarrowing: 'R11',
} as const
