import type { ConveyorBoosterNode } from './booster-schema'
import { BST, boosterExteriorWidthM } from './catalog'
import {
  CROSSBAR_CLEARANCE_M,
  MAX_SUPPORT_SPACING_M,
  MIN_ROLLERS_UNDER_A_BOX,
  ROLLER_DIAMETER_M,
  SIDE_PROFILE_DEPTH_M,
} from './constants'

/**
 * Every figure derived from a booster module.
 *
 * The straight's arithmetic against the booster's own frame, and the difference
 * is exactly one constant: 67 mm over the lane rather than 147. Everything else
 * here reads the same because a booster's bed *is* a short straight's — which is
 * why the two are separate kinds but not separate ideas.
 */

/** The catalogue enums as numbers. The schema holds them as strings because
 *  that is what the host's enum control reads and writes; this is the only
 *  place that is undone. */
export function usefulWidthMm(booster: ConveyorBoosterNode): number {
  return Number(booster.usefulWidth)
}

export function rollerPitchMm(booster: ConveyorBoosterNode): number {
  return Number(booster.rollerPitch)
}

export function speedMPerMin(booster: ConveyorBoosterNode): number {
  return Number(booster.speed)
}

export function rollerPitchM(booster: ConveyorBoosterNode): number {
  return rollerPitchMm(booster) / 1000
}

export function laneWidthM(booster: ConveyorBoosterNode): number {
  return usefulWidthMm(booster) / 1000
}

/** Bed length: a whole number of pitches, by construction. Never a stored
 *  field — storing it would let the count and the length disagree, with the
 *  mesh following one and the panel the other. */
export function moduleLengthM(booster: ConveyorBoosterNode): number {
  return booster.rollers * rollerPitchM(booster)
}

/** Outside of one side profile to the outside of the other. **67 mm over the
 *  lane**, the tightest section in the family: the drive lives under the bed, so
 *  the frame has nothing to make room for. */
export function frameWidthM(booster: ConveyorBoosterNode): number {
  return boosterExteriorWidthM(usefulWidthMm(booster))
}

/** Local X of each roller centre, half a pitch in from each end so a joint
 *  continues the pitch instead of leaving a double gap. */
export function rollerOffsetsX(booster: ConveyorBoosterNode): number[] {
  const pitch = rollerPitchM(booster)
  const first = (-moduleLengthM(booster) + pitch) / 2
  return Array.from({ length: booster.rollers }, (_, index) => first + index * pitch)
}

export function rollerAxisY(booster: ConveyorBoosterNode): number {
  return booster.transportHeight - ROLLER_DIAMETER_M / 2
}

export function frameBottomY(booster: ConveyorBoosterNode): number {
  return booster.transportHeight - SIDE_PROFILE_DEPTH_M
}

export function legHeightM(booster: ConveyorBoosterNode): number {
  return Math.max(0, frameBottomY(booster))
}

/**
 * Local X of each support station.
 *
 * One at each end, and on a body this short that is all there is: the whole
 * catalogue range sits inside the 1.5 m spacing, so the ceiling division is
 * always one span. Written as the division anyway rather than as a literal pair,
 * because the rule is the family's and a body that outgrew it would then still
 * be held up.
 */
export function supportOffsetsX(booster: ConveyorBoosterNode): number[] {
  const length = moduleLengthM(booster)
  const spans = Math.max(1, Math.ceil(length / MAX_SUPPORT_SPACING_M))
  const step = length / spans
  return Array.from({ length: spans + 1 }, (_, index) => -length / 2 + index * step)
}

export function hasCrossbar(booster: ConveyorBoosterNode): boolean {
  return legHeightM(booster) > CROSSBAR_CLEARANCE_M + 0.1
}

// ── What the machine can do ─────────────────────────────────────────────────

export function speedMPerSec(booster: ConveyorBoosterNode): number {
  return speedMPerMin(booster) / 60
}

/** Rollers under the shortest box. The catalogue's rule is three; fewer and the
 *  box drops between them. */
export function rollersUnderShortestBox(booster: ConveyorBoosterNode): number {
  return Math.floor(booster.shortestBox / rollerPitchM(booster)) + 1
}

export function carriesShortestBox(booster: ConveyorBoosterNode): boolean {
  return rollersUnderShortestBox(booster) >= MIN_ROLLERS_UNDER_A_BOX
}

/**
 * Whether the bed length is one the catalogue actually ships.
 *
 * The reason `rollers` has generous bounds and this exists: seven rollers at
 * 100 mm is 700 mm and inside the range, but seven at 50 mm is 350 and is not a
 * booster at all. The count alone cannot express that; the product can.
 */
export function withinCatalogueLength(booster: ConveyorBoosterNode): boolean {
  const length = moduleLengthM(booster)
  return length >= BST.lengthRangeM[0] - 1e-9 && length <= BST.lengthRangeM[1] + 1e-9
}

/** Whether the box this section is specified for is one the type carries. */
export function carriesCatalogueBox(booster: ConveyorBoosterNode): boolean {
  return (
    booster.shortestBox >= BST.boxLengthRangeM[0] - 1e-9 &&
    booster.shortestBox <= BST.boxLengthRangeM[1] + 1e-9
  )
}

// ── Placement ───────────────────────────────────────────────────────────────

/** `[width along the run, depth across it]` — the box the node tiles at. Modules
 *  meet end to end, so the length is the bed length with no overhang. */
export function footprintM(booster: ConveyorBoosterNode): [number, number] {
  return [moduleLengthM(booster), frameWidthM(booster)]
}

/** The volume the module occupies, floor to guide top: what fits under a rack's
 *  tunnel has to fit with its legs. */
export function localBoundsM(booster: ConveyorBoosterNode): {
  min: [number, number, number]
  max: [number, number, number]
} {
  const [length, width] = footprintM(booster)
  const top =
    booster.sideGuide === 'none'
      ? booster.transportHeight
      : booster.transportHeight + booster.sideGuideHeight
  return {
    min: [-length / 2, 0, -width / 2],
    max: [length / 2, top, width / 2],
  }
}
