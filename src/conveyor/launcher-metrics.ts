import { exteriorWidthM, LNC } from './catalog'
import {
  CROSSBAR_CLEARANCE_M,
  LAUNCHER_LATERAL_REACH_M,
  MAX_SUPPORT_SPACING_M,
  ROLLER_DIAMETER_M,
  SIDE_PROFILE_DEPTH_M,
} from './constants'
import type { ConveyorLauncherNode } from './launcher-schema'

/**
 * Every figure derived from a launcher module.
 *
 * The same role `./metrics` plays for the straight, and the same rule: pure
 * functions over the node, shared by the parts list, the cache key, the
 * floorplan, the ports and the tests, so the mesh and the numbers cannot
 * disagree.
 *
 * Most of this is the straight's arithmetic against a fixed length, and that is
 * deliberate — a launcher **is** a 900 mm straight with an arm, right down to
 * standing on the same 147 mm frame overhang. What is genuinely its own is the
 * lateral bed and which side it is on.
 */

/** The catalogue enums as numbers. The schema holds them as strings because
 *  that is what the host's enum control reads and writes; this is the only
 *  place that is undone. */
export function usefulWidthMm(launcher: ConveyorLauncherNode): number {
  return Number(launcher.usefulWidth)
}

export function rollerPitchMm(launcher: ConveyorLauncherNode): number {
  return Number(launcher.rollerPitch)
}

export function laneWidthM(launcher: ConveyorLauncherNode): number {
  return usefulWidthMm(launcher) / 1000
}

export function rollerPitchM(launcher: ConveyorLauncherNode): number {
  return rollerPitchMm(launcher) / 1000
}

/** Bed length along the main line. Fixed by the catalogue, so it is a constant
 *  read through a function for the same reason every other figure here is: one
 *  place for the mesh and the panel to agree. */
export function moduleLengthM(_launcher: ConveyorLauncherNode): number {
  return LNC.lengthM
}

/** Outside of one side profile to the outside of the other. The straight
 *  family's 147 mm over the lane — 600 → 747, which is the published figure. */
export function frameWidthM(launcher: ConveyorLauncherNode): number {
  return exteriorWidthM(usefulWidthMm(launcher))
}

/**
 * Which way the lateral bed points, as a sign on local Z.
 *
 * Local +Z is the module's left seen from above with goods travelling local +X,
 * which is the same convention the curve's hand uses.
 */
export function launchSign(launcher: ConveyorLauncherNode): number {
  return launcher.launchSide === 'left' ? 1 : -1
}

/** How far the lateral bed's outer face stands from the module's centreline. */
export function lateralOuterZM(launcher: ConveyorLauncherNode): number {
  return frameWidthM(launcher) / 2 + LAUNCHER_LATERAL_REACH_M
}

/**
 * Rollers along the main bed.
 *
 * Rounded so the bed is a whole number of pitches, which is what a roller bed
 * physically is — the length is fixed here, so the rounding lands on the count
 * rather than on the length as it does for a straight.
 */
export function rollerCount(launcher: ConveyorLauncherNode): number {
  return Math.max(2, Math.round(moduleLengthM(launcher) / rollerPitchM(launcher)))
}

/** Local X of each main-bed roller centre, half a pitch in from each end so a
 *  joint continues the pitch instead of leaving a double gap. */
export function rollerOffsetsX(launcher: ConveyorLauncherNode): number[] {
  const count = rollerCount(launcher)
  const pitch = moduleLengthM(launcher) / count
  const first = (-moduleLengthM(launcher) + pitch) / 2
  return Array.from({ length: count }, (_, index) => first + index * pitch)
}

export function rollerAxisY(launcher: ConveyorLauncherNode): number {
  return launcher.transportHeight - ROLLER_DIAMETER_M / 2
}

export function frameBottomY(launcher: ConveyorLauncherNode): number {
  return launcher.transportHeight - SIDE_PROFILE_DEPTH_M
}

export function legHeightM(launcher: ConveyorLauncherNode): number {
  return Math.max(0, frameBottomY(launcher))
}

/**
 * Local X of each main-bed support station.
 *
 * The straight's rule against a 900 mm body, which puts one station at each end
 * — and that is what lets a launcher take part in the shared-support rule
 * exactly like a straight. Legs set inboard would leave a gap at the seam
 * instead, because the neighbour that cedes has already dropped its own.
 */
export function supportOffsetsX(launcher: ConveyorLauncherNode): number[] {
  const length = moduleLengthM(launcher)
  const spans = Math.max(1, Math.ceil(length / MAX_SUPPORT_SPACING_M))
  const step = length / spans
  return Array.from({ length: spans + 1 }, (_, index) => -length / 2 + index * step)
}

export function hasCrossbar(launcher: ConveyorLauncherNode): boolean {
  return legHeightM(launcher) > CROSSBAR_CLEARANCE_M + 0.1
}

// ── What the machine can do ─────────────────────────────────────────────────

export function speedMPerSec(_launcher: ConveyorLauncherNode): number {
  return LNC.speedMPerMin / 60
}

/**
 * Boxes an hour, from the fixed box length rather than from a typed-in one.
 *
 * The launch is one box at a time, so the cycle is the box crossing the module
 * plus the time it takes to be pushed clear — the second half of which the
 * catalogue does not publish. The figure is therefore an upper bound and is
 * named as one.
 */
export function maxThroughputPerHour(launcher: ConveyorLauncherNode): number {
  return Math.floor((speedMPerSec(launcher) * 3600) / LNC.boxLengthM)
}

// ── Placement ───────────────────────────────────────────────────────────────

/**
 * `[width along the run, depth across it]` — the box the node tiles at.
 *
 * The depth is asymmetric about the node, because the lateral bed sticks out one
 * side only. `footprintCentreZM` is how far the footprint's middle sits from the
 * node, which the host's `floorPlaced.footprint` cannot express — it is a box
 * *centred on the node* — so the placement path applies the offset itself, the
 * same problem the curve solved with `arcCentreLocal`.
 */
export function footprintM(launcher: ConveyorLauncherNode): [number, number] {
  const frame = frameWidthM(launcher)
  return [moduleLengthM(launcher), frame / 2 + lateralOuterZM(launcher)]
}

export function footprintCentreZM(launcher: ConveyorLauncherNode): number {
  const frame = frameWidthM(launcher)
  return (launchSign(launcher) * (lateralOuterZM(launcher) - frame / 2)) / 2
}

/** The volume the module occupies, as a box in its own local frame. Floor to
 *  guide top, legs included: what fits under a rack's tunnel has to fit with
 *  its legs. */
export function localBoundsM(launcher: ConveyorLauncherNode): {
  min: [number, number, number]
  max: [number, number, number]
} {
  const [length, depth] = footprintM(launcher)
  const centreZ = footprintCentreZM(launcher)
  const top = launcher.sideGuide
    ? launcher.transportHeight + launcher.sideGuideHeight
    : launcher.transportHeight
  return {
    min: [-length / 2, 0, centreZ - depth / 2],
    max: [length / 2, top, centreZ + depth / 2],
  }
}
