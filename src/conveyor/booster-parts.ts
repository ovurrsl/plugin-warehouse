import {
  frameBottomY,
  frameWidthM,
  hasCrossbar,
  laneWidthM,
  legHeightM,
  moduleLengthM,
  supportOffsetsX,
} from './booster-metrics'
import type { ConveyorBoosterNode } from './booster-schema'
import {
  CONTROL_BOX_M,
  CROSSBAR_CLEARANCE_M,
  CROSSBAR_SECTION_M,
  FOOTPLATE_OVERHANG_M,
  FOOTPLATE_THICKNESS_M,
  LEG_SECTION_M,
  ROLLER_DIAMETER_M,
  SIDE_GUIDE_SECTION_M,
  SIDE_GUIDE_THICKNESS_M,
  SIDE_PROFILE_DEPTH_M,
  SIDE_PROFILE_THICKNESS_M,
} from './constants'
import type { ConveyorDetail, ConveyorPart } from './parts'
import { outletPort } from './ports'

/**
 * Every piece of a booster, as a list of boxes.
 *
 * The straight's bed against this type's own frame, with one thing genuinely
 * moved: **the drive hangs under the bed rather than off the side**, and that is
 * not decoration. It is why a booster's frame is 67 mm over the lane where a
 * straight's is 147 — there is nothing beside the bed to make room for, so the
 * section can be as tight as the rollers allow.
 *
 * As everywhere else in this kind, the rollers are not in this list: the bed is
 * one box carrying a roller stripe in the material's atlas.
 */
export function boosterParts(
  booster: ConveyorBoosterNode,
  detail: ConveyorDetail,
  /**
   * Leave the downstream support to the module standing against it. The
   * catalogue puts one support at every joint, not two — see `./parts` for the
   * asymmetry this rule turns on.
   */
  hasDownstreamNeighbour = false,
): ConveyorPart[] {
  const parts: ConveyorPart[] = []
  const full = detail === 'full'
  const length = moduleLengthM(booster)
  const frame = frameWidthM(booster)
  const lane = laneWidthM(booster)
  const bottom = frameBottomY(booster)
  const top = booster.transportHeight

  // ── Side profiles ─────────────────────────────────────────────────────────
  // Top edge flush with the roller top, body hanging below, so a box crosses
  // from one module to the next without meeting a lip.
  for (const sign of [1, -1]) {
    const z = (sign * (frame - SIDE_PROFILE_THICKNESS_M)) / 2
    parts.push({
      role: 'frame',
      center: [0, bottom + SIDE_PROFILE_DEPTH_M / 2, z],
      size: [length, SIDE_PROFILE_DEPTH_M, SIDE_PROFILE_THICKNESS_M],
    })

    if (full) {
      for (const edge of [1, -1]) {
        parts.push({
          role: 'frame',
          center: [
            0,
            bottom +
              SIDE_PROFILE_DEPTH_M / 2 +
              (edge * (SIDE_PROFILE_DEPTH_M - SIDE_PROFILE_THICKNESS_M)) / 2,
            z - sign * SIDE_PROFILE_THICKNESS_M,
          ],
          size: [length, SIDE_PROFILE_THICKNESS_M, SIDE_PROFILE_THICKNESS_M * 3],
        })
      }
    }
  }

  // ── The bed ───────────────────────────────────────────────────────────────
  parts.push({
    role: 'deck',
    pattern: 'rollers',
    center: [0, top - ROLLER_DIAMETER_M / 2, 0],
    size: [length, ROLLER_DIAMETER_M, lane],
  })

  // ── End plates ────────────────────────────────────────────────────────────
  if (full) {
    for (const end of [1, -1]) {
      parts.push({
        role: 'end-plate',
        center: [
          (end * (length - SIDE_PROFILE_THICKNESS_M)) / 2,
          bottom + SIDE_PROFILE_DEPTH_M / 2,
          0,
        ],
        size: [SIDE_PROFILE_THICKNESS_M, SIDE_PROFILE_DEPTH_M * 0.8, frame * 0.9],
      })
    }
  }

  // ── Supports ──────────────────────────────────────────────────────────────
  const legHeight = legHeightM(booster)
  const stations = supportOffsetsX(booster)
  /** The station at the discharge end — see `./parts`. Naming the last one
   *  regardless drops the free end's legs on a reverse-flow module. */
  const cededStation = outletPort(booster) === 'b' ? stations.length - 1 : 0

  stations.forEach((x, index) => {
    if (hasDownstreamNeighbour && index === cededStation) return
    if (legHeight <= 0) return

    for (const sign of [1, -1]) {
      const z = sign * (frame / 2 - LEG_SECTION_M / 2)
      parts.push({
        role: 'leg',
        center: [x, legHeight / 2, z],
        size: [LEG_SECTION_M, legHeight, LEG_SECTION_M],
      })

      if (full) {
        parts.push({
          role: 'footplate',
          center: [x, FOOTPLATE_THICKNESS_M / 2, z],
          size: [
            LEG_SECTION_M + FOOTPLATE_OVERHANG_M * 2,
            FOOTPLATE_THICKNESS_M,
            LEG_SECTION_M + FOOTPLATE_OVERHANG_M * 2,
          ],
        })
      }
    }

    if (hasCrossbar(booster)) {
      parts.push({
        role: 'crossbar',
        center: [x, CROSSBAR_CLEARANCE_M, 0],
        size: [CROSSBAR_SECTION_M, CROSSBAR_SECTION_M, frame - LEG_SECTION_M * 2],
      })
    }
  })

  // ── Side guides ───────────────────────────────────────────────────────────
  if (full && booster.sideGuide !== 'none') {
    const sides = booster.sideGuide === 'both' ? [1, -1] : booster.sideGuide === 'left' ? [1] : [-1]

    for (const sign of sides) {
      const z = sign * (frame / 2 - SIDE_GUIDE_THICKNESS_M / 2)
      parts.push({
        role: 'guide',
        center: [0, top + booster.sideGuideHeight - SIDE_GUIDE_SECTION_M / 2, z],
        size: [length, SIDE_GUIDE_SECTION_M, SIDE_GUIDE_THICKNESS_M],
      })

      for (const x of stations) {
        parts.push({
          role: 'guide-bracket',
          center: [x, top + booster.sideGuideHeight / 2 - SIDE_GUIDE_SECTION_M / 4, z],
          size: [SIDE_GUIDE_THICKNESS_M, booster.sideGuideHeight, SIDE_GUIDE_THICKNESS_M],
        })
      }
    }
  }

  // ── Drive ─────────────────────────────────────────────────────────────────
  // Under the bed, between the two support stations, and always present: a
  // booster with no drive is a length of free roller, which is a different type
  // in the same catalogue. This is the part that buys the tight frame.
  if (full) {
    const [bx, by, bz] = CONTROL_BOX_M
    parts.push({
      role: 'motor',
      center: [0, Math.max(by / 2, bottom - by / 2), 0],
      size: [Math.min(bx, length * 0.7), by, Math.min(bz, frame * 0.8)],
    })
  }

  return parts
}
