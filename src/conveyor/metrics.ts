import { CAR, exteriorWidthM, SPEEDS_M_PER_MIN } from './catalog'
import {
  CROSSBAR_CLEARANCE_M,
  MAX_SUPPORT_SPACING_M,
  MIN_ROLLERS_UNDER_A_BOX,
  ROLLER_DIAMETER_M,
  SIDE_PROFILE_DEPTH_M,
} from './constants'
import type { ConveyorRollerNode } from './schema'

/**
 * Every figure derived from a conveyor module, in one place.
 *
 * The same role `rack/slots.ts` plays: pure functions over the node, shared by
 * the parts list, the geometry cache key, the floorplan, the panel and the
 * tests. The cache-key law depends on it — a key must be built from what the
 * builder actually consumes, and that is only checkable when both read the same
 * helper.
 *
 * Metres throughout.
 */

/** Roller pitch as a length. The schema stores the catalogue's millimetres so
 *  that a pitch is an equality rather than a float comparison. */
export function rollerPitchM(conveyor: ConveyorRollerNode): number {
  return conveyor.rollerPitch / 1000
}

/**
 * Bed length: a whole number of pitches, by construction.
 *
 * Never a stored field. A conveyor's length is what its roller count and pitch
 * make it, and storing it separately would let the two disagree — with the mesh
 * following one and the panel the other.
 */
export function moduleLengthM(conveyor: ConveyorRollerNode): number {
  return conveyor.rollers * rollerPitchM(conveyor)
}

/** Useful width — the widest box the lane carries — as a length. */
export function usefulWidthM(conveyor: ConveyorRollerNode): number {
  return conveyor.usefulWidth / 1000
}

/** Outside of one side profile to the outside of the other. Derived from the
 *  useful width, never stored: see `./catalog`. */
export function frameWidthM(conveyor: ConveyorRollerNode): number {
  return exteriorWidthM(conveyor.usefulWidth)
}

/**
 * Local X of each roller centre, measured from the module's own middle.
 *
 * Half a pitch in from each end, so two modules standing end to end continue
 * the pitch across the joint instead of leaving a double gap — which is what
 * decides whether a box crossing the seam is ever unsupported.
 */
export function rollerOffsetsX(conveyor: ConveyorRollerNode): number[] {
  const pitch = rollerPitchM(conveyor)
  const first = (-moduleLengthM(conveyor) + pitch) / 2
  return Array.from({ length: conveyor.rollers }, (_, index) => first + index * pitch)
}

/**
 * Height of the roller axis. The transport height is the *top* of the rollers,
 * so the axis sits one radius below it.
 */
export function rollerAxisY(conveyor: ConveyorRollerNode): number {
  return conveyor.transportHeight - ROLLER_DIAMETER_M / 2
}

/**
 * Underside of the side profile.
 *
 * The profile's top edge is flush with the roller top — that is what lets a box
 * slide from one module to the next without a lip — so its body hangs below.
 */
export function frameBottomY(conveyor: ConveyorRollerNode): number {
  return conveyor.transportHeight - SIDE_PROFILE_DEPTH_M
}

/** Leg length from the floor to the underside of the frame. Derived: a leg is
 *  whatever it takes to put the rollers at the transport height. */
export function legHeightM(conveyor: ConveyorRollerNode): number {
  return Math.max(0, frameBottomY(conveyor))
}

/**
 * Local X of each support station.
 *
 * At most `MAX_SUPPORT_SPACING_M` apart with one at each end, and the count is
 * whatever satisfies that — so a longer module grows supports rather than
 * stretching them. Evenly spread rather than packed from one end, because a
 * conveyor with a lonely support at the far end reads as a modelling error.
 */
export function supportOffsetsX(conveyor: ConveyorRollerNode): number[] {
  const length = moduleLengthM(conveyor)
  const spans = Math.max(1, Math.ceil(length / MAX_SUPPORT_SPACING_M))
  const step = length / spans
  return Array.from({ length: spans + 1 }, (_, index) => -length / 2 + index * step)
}

/** Whether a support station is tall enough to be worth tying together. A
 *  module at the 0.37 m minimum has almost no leg to brace. */
export function hasCrossbar(conveyor: ConveyorRollerNode): boolean {
  return legHeightM(conveyor) > CROSSBAR_CLEARANCE_M + 0.1
}

// ── What the line can actually do ───────────────────────────────────────────

/** Speed in metres per second, for anything that has to move. */
export function speedMPerSec(conveyor: ConveyorRollerNode): number {
  return conveyor.speed / 60
}

/**
 * Boxes an hour, from geometry rather than from a typed-in number.
 *
 * A box occupies its own length plus the gap the line keeps behind it; at
 * contact accumulation that gap is nominally nothing, so the honest figure uses
 * the box length alone and is therefore an upper bound. Named as one.
 */
export function maxThroughputPerHour(conveyor: ConveyorRollerNode): number {
  const box = conveyor.shortestBox
  if (box <= 0) return 0
  return Math.floor((speedMPerSec(conveyor) * 3600) / box)
}

/** Rollers under the shortest box the line is specified for. The catalogue's
 *  rule is three; fewer and the box drops between them. */
export function rollersUnderShortestBox(conveyor: ConveyorRollerNode): number {
  return Math.floor(conveyor.shortestBox / rollerPitchM(conveyor)) + 1
}

export function carriesShortestBox(conveyor: ConveyorRollerNode): boolean {
  return rollersUnderShortestBox(conveyor) >= MIN_ROLLERS_UNDER_A_BOX
}

/** Rated load of the whole module: the catalogue figure is per metre of bed. */
export function ratedLoadKg(conveyor: ConveyorRollerNode): number {
  return CAR.loadKgPerMetre * moduleLengthM(conveyor)
}

/** Whether the module's length is one the catalogue actually ships. */
export function withinCatalogueLength(conveyor: ConveyorRollerNode): boolean {
  const length = moduleLengthM(conveyor)
  return length >= CAR.lengthRangeM[0] - 1e-9 && length <= CAR.lengthRangeM[1] + 1e-9
}

/** Whether the speed is one of the three the catalogue offers. Guards a value
 *  arriving from MCP or a hand-edited scene rather than the panel. */
export function isCatalogueSpeed(conveyor: ConveyorRollerNode): boolean {
  return (SPEEDS_M_PER_MIN as readonly number[]).includes(conveyor.speed)
}

// ── Placement ───────────────────────────────────────────────────────────────

/**
 * The footprint the world sees: the frame, not the rollers.
 *
 * `[width along the run, depth across it]` in the module's own frame. The rack
 * learned that this figure has to be the one abutting units tile at, or the
 * editor refuses the one gesture the kind exists for — here modules meet end to
 * end, so the length is exactly the bed length with no overhang to argue about.
 */
export function footprintM(conveyor: ConveyorRollerNode): [number, number] {
  return [moduleLengthM(conveyor), frameWidthM(conveyor)]
}

/**
 * The volume a module occupies, as a box in its own local frame:
 * `[min, max]` on each axis.
 *
 * Used by the clash test against rack steel. Deliberately the *whole* machine
 * from the floor to the top of the guides — a conveyor that fits under a rack's
 * tunnel has to fit with its legs, not just its bed.
 */
export function localBoundsM(conveyor: ConveyorRollerNode): {
  min: [number, number, number]
  max: [number, number, number]
} {
  const [length, width] = footprintM(conveyor)
  const top =
    conveyor.sideGuide === 'none'
      ? conveyor.transportHeight
      : conveyor.transportHeight + conveyor.sideGuideHeight
  return {
    min: [-length / 2, 0, -width / 2],
    max: [length / 2, top, width / 2],
  }
}
