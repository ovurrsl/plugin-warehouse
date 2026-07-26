import { LNC } from './catalog'
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
  laneWidthM,
  lateralOuterZM,
  launchSign,
  legHeightM,
  moduleLengthM,
  supportOffsetsX,
} from './launcher-metrics'
import type { ConveyorLauncherNode } from './launcher-schema'
import type { ConveyorDetail, ConveyorPart } from './parts'
import { outletPort } from './ports'

/**
 * Every piece of a launcher, as boxes that may be turned about Y.
 *
 * A launcher is a 900 mm straight with an arm, and this list says so: the main
 * bed is built exactly as `./parts` builds one, and everything after the first
 * section is the arm and what the arm takes away.
 *
 * **The launch side's profile is interrupted, not omitted.** A box leaves
 * through that gap, so the rail cannot run past it — but the frame either side
 * of the gap is what the machine is bolted together with, so it is two segments
 * rather than nothing. Drawing it whole would put a rail across the one opening
 * the machine exists for; dropping it would leave the bed unsupported along
 * half its length.
 */

export type LauncherPart = ConveyorPart & {
  /** Heading in the node's local plan frame. The lateral bed and its profiles
   *  stand across the main line. */
  rotationY: number
}

const QUARTER_TURN = Math.PI / 2

export function launcherParts(
  launcher: ConveyorLauncherNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): LauncherPart[] {
  const parts: LauncherPart[] = []
  const full = detail === 'full'
  const length = moduleLengthM(launcher)
  const frame = frameWidthM(launcher)
  const lane = laneWidthM(launcher)
  const bottom = frameBottomY(launcher)
  const top = launcher.transportHeight
  const side = launchSign(launcher)
  const outerZ = lateralOuterZM(launcher)
  /** The opening the box leaves through, one box long plus a little clearance. */
  const gap = LNC.boxLengthM * 1.05

  const box = (
    role: LauncherPart['role'],
    center: [number, number, number],
    size: [number, number, number],
    rotationY = 0,
    pattern?: 'rollers',
  ): LauncherPart => ({ role, center, size, rotationY, ...(pattern ? { pattern } : {}) })

  // ── Main side profiles ────────────────────────────────────────────────────
  for (const sign of [1, -1]) {
    const z = (sign * (frame - SIDE_PROFILE_THICKNESS_M)) / 2
    const centreY = bottom + SIDE_PROFILE_DEPTH_M / 2

    if (sign === side) {
      // Interrupted for the launch opening: one segment each side of the gap.
      const run = (length - gap) / 2
      if (run > 0) {
        for (const end of [1, -1]) {
          parts.push(
            box(
              'frame',
              [(end * (length - run)) / 2, centreY, z],
              [run, SIDE_PROFILE_DEPTH_M, SIDE_PROFILE_THICKNESS_M],
            ),
          )
        }
      }
      continue
    }

    parts.push(
      box('frame', [0, centreY, z], [length, SIDE_PROFILE_DEPTH_M, SIDE_PROFILE_THICKNESS_M]),
    )
    if (full) {
      // The formed flanges that stiffen the web, top and bottom.
      for (const edge of [1, -1]) {
        parts.push(
          box(
            'frame',
            [
              0,
              centreY + (edge * (SIDE_PROFILE_DEPTH_M - SIDE_PROFILE_THICKNESS_M)) / 2,
              z - sign * SIDE_PROFILE_THICKNESS_M,
            ],
            [length, SIDE_PROFILE_THICKNESS_M, SIDE_PROFILE_THICKNESS_M * 3],
          ),
        )
      }
    }
  }

  // ── The main bed ──────────────────────────────────────────────────────────
  // One box carrying the roller stripe, top at the transport height and one
  // roller diameter thick, so what the stripe paints sits where a roller is.
  parts.push(
    box(
      'deck',
      [0, top - ROLLER_DIAMETER_M / 2, 0],
      [length, ROLLER_DIAMETER_M, lane],
      0,
      'rollers',
    ),
  )

  // ── The lateral bed ───────────────────────────────────────────────────────
  // Turned a quarter, so its own local X runs across the main line — which is
  // what puts the painted rollers across the direction the box is launched, the
  // way the real ones lie.
  const lateralDepth = outerZ - frame / 2
  const lateralCentreZ = side * (frame / 2 + lateralDepth / 2)
  parts.push(
    box(
      'deck',
      [0, top - ROLLER_DIAMETER_M / 2, lateralCentreZ],
      [lateralDepth, ROLLER_DIAMETER_M, LNC.boxLengthM],
      QUARTER_TURN,
      'rollers',
    ),
  )

  for (const end of [1, -1]) {
    parts.push(
      box(
        'frame',
        [(end * LNC.boxLengthM) / 2, bottom + SIDE_PROFILE_DEPTH_M / 2, lateralCentreZ],
        [lateralDepth, SIDE_PROFILE_DEPTH_M, SIDE_PROFILE_THICKNESS_M],
        QUARTER_TURN,
      ),
    )
  }

  // ── End plates ────────────────────────────────────────────────────────────
  if (full) {
    for (const end of [1, -1]) {
      parts.push(
        box(
          'end-plate',
          [(end * (length - SIDE_PROFILE_THICKNESS_M)) / 2, bottom + SIDE_PROFILE_DEPTH_M / 2, 0],
          [SIDE_PROFILE_THICKNESS_M, SIDE_PROFILE_DEPTH_M * 0.8, frame * 0.9],
        ),
      )
    }
  }

  // ── Supports ──────────────────────────────────────────────────────────────
  const legHeight = legHeightM(launcher)
  const stations = supportOffsetsX(launcher)
  /** The station at the discharge end, as on a straight — see `./parts`. */
  const cededStation = outletPort(launcher) === 'b' ? stations.length - 1 : 0

  stations.forEach((x, index) => {
    if (hasDownstreamNeighbour && index === cededStation) return
    if (legHeight <= 0) return

    for (const sign of [1, -1]) {
      const z = sign * (frame / 2 - LEG_SECTION_M / 2)
      parts.push(box('leg', [x, legHeight / 2, z], [LEG_SECTION_M, legHeight, LEG_SECTION_M]))
      if (full) {
        parts.push(
          box(
            'footplate',
            [x, FOOTPLATE_THICKNESS_M / 2, z],
            [
              LEG_SECTION_M + FOOTPLATE_OVERHANG_M * 2,
              FOOTPLATE_THICKNESS_M,
              LEG_SECTION_M + FOOTPLATE_OVERHANG_M * 2,
            ],
          ),
        )
      }
    }

    if (hasCrossbar(launcher)) {
      parts.push(
        box(
          'crossbar',
          [x, CROSSBAR_CLEARANCE_M, 0],
          [CROSSBAR_SECTION_M, CROSSBAR_SECTION_M, frame - LEG_SECTION_M * 2],
        ),
      )
    }
  })

  // The arm carries its own weight at its outer edge; it is cantilevered off the
  // main frame at the inner one.
  if (legHeight > 0) {
    const z = side * (outerZ - LEG_SECTION_M / 2)
    for (const end of [1, -1]) {
      const x = (end * (LNC.boxLengthM - LEG_SECTION_M)) / 2
      parts.push(box('leg', [x, legHeight / 2, z], [LEG_SECTION_M, legHeight, LEG_SECTION_M]))
      if (full) {
        parts.push(
          box(
            'footplate',
            [x, FOOTPLATE_THICKNESS_M / 2, z],
            [
              LEG_SECTION_M + FOOTPLATE_OVERHANG_M * 2,
              FOOTPLATE_THICKNESS_M,
              LEG_SECTION_M + FOOTPLATE_OVERHANG_M * 2,
            ],
          ),
        )
      }
    }
  }

  // ── Side guide ────────────────────────────────────────────────────────────
  // On the side the box is not launched to, because there is only one side it
  // can go on: a rail across the opening is a rail the box has to pass through.
  if (full && launcher.sideGuide) {
    const z = -side * (frame / 2 - SIDE_GUIDE_THICKNESS_M / 2)
    const guideY = top + launcher.sideGuideHeight - SIDE_GUIDE_SECTION_M / 2
    parts.push(box('guide', [0, guideY, z], [length, SIDE_GUIDE_SECTION_M, SIDE_GUIDE_THICKNESS_M]))
    for (const x of stations) {
      parts.push(
        box(
          'guide-bracket',
          [x, top + launcher.sideGuideHeight / 2 - SIDE_GUIDE_SECTION_M / 4, z],
          [SIDE_GUIDE_THICKNESS_M, launcher.sideGuideHeight, SIDE_GUIDE_THICKNESS_M],
        ),
      )
    }
  }

  // ── Drive ─────────────────────────────────────────────────────────────────
  // The launcher's own motor, under the arm: what actually throws the box is the
  // lateral bed, so that is where the machine's drive hangs.
  if (full) {
    const [mx, my, mz] = MOTOR_BLOCK_M
    parts.push(
      box(
        'motor',
        [0, bottom - my / 2 + SIDE_PROFILE_DEPTH_M / 2, side * (outerZ + mz / 2)],
        [mx, my, mz],
      ),
    )
  }

  return parts
}
