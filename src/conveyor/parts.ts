import {
  CROSSBAR_CLEARANCE_M,
  CROSSBAR_SECTION_M,
  FOOTPLATE_OVERHANG_M,
  FOOTPLATE_THICKNESS_M,
  LEG_SECTION_M,
  MOTOR_BLOCK_M,
  ROLLER_DIAMETER_M,
  SIDE_GUIDE_SECTION_M,
  SIDE_GUIDE_THICKNESS_M,
  SIDE_PROFILE_DEPTH_M,
  SIDE_PROFILE_THICKNESS_M,
} from './constants'
import {
  frameBottomY,
  frameWidthM,
  hasCrossbar,
  legHeightM,
  moduleLengthM,
  supportOffsetsX,
  usefulWidthM,
} from './metrics'
import { outletPort } from './ports'
import type { ConveyorRollerNode } from './schema'

/**
 * Every piece of a conveyor module, as a list of boxes.
 *
 * One list, three consumers: the 3D builder extrudes it, the floorplan projects
 * it, and the tests measure it. The rack file this mirrors explains why that is
 * the only arrangement in which "the plan matches the model" is a fact rather
 * than a hope — two files computing the same frame positions from the same
 * inputs agree right up until one of them is edited.
 *
 * **The rollers are not in this list, and that is the central decision.** Six
 * hundred metres of bed at 75 mm pitch is eight thousand rollers; drawn as
 * twelve-sided prisms that is nearly four hundred thousand triangles for one
 * kind, against a whole-warehouse budget of four hundred thousand for two
 * thousand rack bays. The bed is one box carrying a roller stripe in the
 * material's atlas — exactly the trade the rack made for its punched uprights,
 * where a thousand slot boxes per rack cost more than everything else combined.
 */

export type ConveyorPartRole =
  | 'frame'
  | 'end-plate'
  | 'deck'
  | 'guide'
  | 'guide-bracket'
  | 'leg'
  | 'footplate'
  | 'crossbar'
  | 'motor'

export type ConveyorPart = {
  role: ConveyorPartRole
  center: [number, number, number]
  size: [number, number, number]
  /** Which atlas column the part reads. `rollers` is the striped bed; absent is
   *  the blank column, which multiplies out to the part's own colour. */
  pattern?: 'rollers'
}

export type ConveyorDetail = 'full' | 'simple'

/**
 * `simple` keeps the frame, the bed and the legs, and drops everything a few
 * tens of metres away stops resolving: guides, brackets, footplates, the motor.
 * In a warehouse almost every conveyor is always at that distance.
 */
export function conveyorParts(
  conveyor: ConveyorRollerNode,
  detail: ConveyorDetail,
  /**
   * Leave the downstream support to the module standing against it.
   *
   * Modules meet end to end and the catalogue puts one support at every joint,
   * not two — so a run of them must not each build one, or every seam carries
   * doubled steel, a doubled shadow and z-fighting on every coincident face.
   * Building the upstream support always and the downstream one only when
   * nothing abuts gives a run of N modules N+1 supports, which is how a line is
   * really stood up. Same rule as the rack's shared upright frames.
   */
  hasDownstreamNeighbour = false,
): ConveyorPart[] {
  const parts: ConveyorPart[] = []
  const full = detail === 'full'
  const length = moduleLengthM(conveyor)
  const frameWidth = frameWidthM(conveyor)
  const useful = usefulWidthM(conveyor)
  const bottom = frameBottomY(conveyor)
  const top = conveyor.transportHeight

  // ── Side profiles ─────────────────────────────────────────────────────────
  // Top edge flush with the roller top, body hanging below, so a box crosses
  // from one module to the next without meeting a lip.
  for (const sign of [1, -1]) {
    const z = (sign * (frameWidth - SIDE_PROFILE_THICKNESS_M)) / 2
    parts.push({
      role: 'frame',
      center: [0, bottom + SIDE_PROFILE_DEPTH_M / 2, z],
      size: [length, SIDE_PROFILE_DEPTH_M, SIDE_PROFILE_THICKNESS_M],
    })

    if (full) {
      // The formed flanges that stiffen the web, top and bottom.
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
  // One box between the profiles, carrying the roller stripe. Its top is the
  // transport height and its thickness is one roller diameter, so what the
  // stripe paints sits exactly where a roller would be.
  parts.push({
    role: 'deck',
    pattern: 'rollers',
    center: [0, top - ROLLER_DIAMETER_M / 2, 0],
    size: [length, ROLLER_DIAMETER_M, useful],
  })

  // ── End plates ────────────────────────────────────────────────────────────
  // The profile connectors a module is joined to its neighbour through. Drawn
  // at both ends whatever abuts: unlike the support, there really are two.
  if (full) {
    for (const end of [1, -1]) {
      parts.push({
        role: 'end-plate',
        center: [
          (end * (length - SIDE_PROFILE_THICKNESS_M)) / 2,
          bottom + SIDE_PROFILE_DEPTH_M / 2,
          0,
        ],
        size: [SIDE_PROFILE_THICKNESS_M, SIDE_PROFILE_DEPTH_M * 0.8, frameWidth * 0.9],
      })
    }
  }

  // ── Supports ──────────────────────────────────────────────────────────────
  const legHeight = legHeightM(conveyor)
  const stations = supportOffsetsX(conveyor)
  /**
   * The station at the **discharge** end, not simply the last one.
   *
   * `hasDownstreamNeighbour` asks whether the *outlet* is mated, and under
   * reverse flow the outlet is the −X end. Naming the last station regardless
   * therefore deleted the leg pair at the *free* end of a reverse-flow module
   * and left doubled steel at the seam — the exact failure this rule exists to
   * prevent, inverted.
   */
  const cededStation = outletPort(conveyor) === 'b' ? stations.length - 1 : 0

  stations.forEach((x, index) => {
    // The downstream station belongs to the neighbour when there is one.
    if (hasDownstreamNeighbour && index === cededStation) return
    if (legHeight <= 0) return

    for (const sign of [1, -1]) {
      const z = sign * (frameWidth / 2 - LEG_SECTION_M / 2)
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

    if (hasCrossbar(conveyor)) {
      parts.push({
        role: 'crossbar',
        center: [x, CROSSBAR_CLEARANCE_M, 0],
        size: [CROSSBAR_SECTION_M, CROSSBAR_SECTION_M, frameWidth - LEG_SECTION_M * 2],
      })
    }
  })

  // ── Side guides ───────────────────────────────────────────────────────────
  if (full && conveyor.sideGuide !== 'none') {
    const sides =
      conveyor.sideGuide === 'both' ? [1, -1] : conveyor.sideGuide === 'left' ? [1] : [-1]

    for (const sign of sides) {
      const z = sign * (frameWidth / 2 - SIDE_GUIDE_THICKNESS_M / 2)
      parts.push({
        role: 'guide',
        center: [0, top + conveyor.sideGuideHeight - SIDE_GUIDE_SECTION_M / 2, z],
        size: [length, SIDE_GUIDE_SECTION_M, SIDE_GUIDE_THICKNESS_M],
      })

      // A bracket at every support station, which is where a guide is really
      // bolted — to the frame, not to thin air between them.
      for (const x of stations) {
        parts.push({
          role: 'guide-bracket',
          center: [x, top + conveyor.sideGuideHeight / 2 - SIDE_GUIDE_SECTION_M / 4, z],
          size: [SIDE_GUIDE_THICKNESS_M, conveyor.sideGuideHeight, SIDE_GUIDE_THICKNESS_M],
        })
      }
    }
  }

  // ── Drive ─────────────────────────────────────────────────────────────────
  // One motor for the whole line rather than one per module — that is what
  // makes this type continuous rather than zoned — so it hangs off the module
  // that carries it, at the upstream end, outboard of the frame.
  if (full && conveyor.hasDrive) {
    const [mx, my, mz] = MOTOR_BLOCK_M
    const upstream = conveyor.flow === 'forward' ? -1 : 1
    parts.push({
      role: 'motor',
      center: [
        upstream * (length / 2 - mx / 2 - SIDE_PROFILE_THICKNESS_M),
        bottom - my / 2 + SIDE_PROFILE_DEPTH_M / 2,
        -(frameWidth / 2 + mz / 2),
      ],
      size: [mx, my, mz],
    })
  }

  return parts
}
