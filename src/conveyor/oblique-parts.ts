import {
  FOOTPLATE_OVERHANG_M,
  FOOTPLATE_THICKNESS_M,
  LEG_SECTION_M,
  ROLLER_DIAMETER_M,
  SIDE_PROFILE_DEPTH_M,
  SIDE_PROFILE_THICKNESS_M,
} from './constants'
import {
  branchCentreLocal,
  branchEndLocal,
  branchHeadingRad,
  branchLengthM,
  branchSign,
  branchWidthM,
  divergeXM,
  frameBottomY,
  legHeightM,
  mainLaneMm,
  mainWidthM,
  moduleLengthM,
  supportOffsetsX,
} from './oblique-metrics'
import type { ConveyorObliqueNode } from './oblique-schema'
import type { ConveyorDetail, ConveyorPart } from './parts'
import { outletPort } from './ports'

/**
 * Every piece of an oblique transfer, as boxes that may be turned about Y.
 *
 * Three beds rather than two, and the third is the machine: between the point
 * the branch leaves and the module's end sits the **merge triangle**, where
 * short rollers stand at the branch angle and push a box across onto the branch.
 * Drawn as a bed of its own at the branch's heading, because that is what it is
 * — a patch of the main line whose rollers point somewhere else.
 *
 * The main line's side profile is interrupted on the branch side over the
 * triangle, for the reason the launcher's is: a rail across the opening a box
 * leaves through is a rail the box has to pass through.
 */

/**
 * A `diverter` where the family has no such role, for the reason the mixed
 * transfer carries its own union: the angled patch is a bed whose rollers point
 * somewhere else, and calling it a deck would paint it as one. Widening the
 * shared role would let a straight declare a diverter it can never emit.
 */
export type ObliquePartRole = ConveyorPart['role'] | 'diverter'

export type ObliquePart = Omit<ConveyorPart, 'role'> & {
  role: ObliquePartRole
  /** Heading in the node's local plan frame. The branch bed and the diverter
   *  patch stand at the branch angle. */
  rotationY: number
}

export function obliqueParts(
  oblique: ConveyorObliqueNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): ObliquePart[] {
  const parts: ObliquePart[] = []
  const full = detail === 'full'
  const length = moduleLengthM(oblique)
  const mainWidth = mainWidthM(oblique)
  const mainLane = mainLaneMm(oblique) / 1000
  const bottom = frameBottomY(oblique)
  const top = oblique.transportHeight
  const side = branchSign(oblique)
  const diverge = divergeXM(oblique)
  const heading = branchHeadingRad(oblique)

  const box = (
    role: ObliquePart['role'],
    center: [number, number, number],
    size: [number, number, number],
    rotationY = 0,
    pattern?: 'rollers',
  ): ObliquePart => ({ role, center, size, rotationY, ...(pattern ? { pattern } : {}) })

  const profileY = bottom + SIDE_PROFILE_DEPTH_M / 2

  // ── The main line's side profiles ─────────────────────────────────────────
  for (const sign of [1, -1]) {
    const z = (sign * (mainWidth - SIDE_PROFILE_THICKNESS_M)) / 2

    if (sign === side) {
      // Interrupted from the divergence to the end: that stretch is the opening
      // the box leaves through.
      const run = diverge + length / 2
      if (run > 0) {
        parts.push(
          box(
            'frame',
            [-length / 2 + run / 2, profileY, z],
            [run, SIDE_PROFILE_DEPTH_M, SIDE_PROFILE_THICKNESS_M],
          ),
        )
      }
      continue
    }

    parts.push(
      box('frame', [0, profileY, z], [length, SIDE_PROFILE_DEPTH_M, SIDE_PROFILE_THICKNESS_M]),
    )
  }

  // ── The main bed ──────────────────────────────────────────────────────────
  parts.push(
    box(
      'deck',
      [0, top - ROLLER_DIAMETER_M / 2, 0],
      [length, ROLLER_DIAMETER_M, mainLane],
      0,
      'rollers',
    ),
  )

  // ── The merge triangle ────────────────────────────────────────────────────
  // Short rollers at the branch angle, sitting on the main line between the
  // divergence and the end. What actually does the diverting, and what a fitter
  // recognises the machine by.
  const triangleLength = length / 2 - diverge
  if (triangleLength > 0) {
    parts.push(
      box(
        'diverter',
        [diverge + triangleLength / 2, top - ROLLER_DIAMETER_M / 2, (side * mainLane) / 6],
        [triangleLength * 0.9, ROLLER_DIAMETER_M * 0.9, mainLane * 0.6],
        heading,
        'rollers',
      ),
    )
  }

  // ── The branch bed ────────────────────────────────────────────────────────
  const branchLength = branchLengthM(oblique)
  const branchWidth = branchWidthM(oblique)
  const [bx, bz] = branchCentreLocal(oblique)
  parts.push(
    box(
      'deck',
      [bx, top - ROLLER_DIAMETER_M / 2, bz],
      [branchLength, ROLLER_DIAMETER_M, branchWidth - SIDE_PROFILE_THICKNESS_M * 2],
      heading,
      'rollers',
    ),
  )

  for (const sign of [1, -1]) {
    const cos = Math.cos(heading)
    const sin = Math.sin(heading)
    const offset = (sign * (branchWidth - SIDE_PROFILE_THICKNESS_M)) / 2
    parts.push(
      box(
        'frame',
        [bx + offset * sin, profileY, bz + offset * cos],
        [branchLength, SIDE_PROFILE_DEPTH_M, SIDE_PROFILE_THICKNESS_M],
        heading,
      ),
    )
  }

  // ── End plates ────────────────────────────────────────────────────────────
  if (full) {
    for (const end of [1, -1]) {
      parts.push(
        box(
          'end-plate',
          [(end * (length - SIDE_PROFILE_THICKNESS_M)) / 2, profileY, 0],
          [SIDE_PROFILE_THICKNESS_M, SIDE_PROFILE_DEPTH_M * 0.8, mainWidth * 0.9],
        ),
      )
    }
  }

  // ── Supports ──────────────────────────────────────────────────────────────
  const legHeight = legHeightM(oblique)
  const stations = supportOffsetsX(oblique)
  /** The station at the discharge end of the main line — see `./parts`. */
  const cededStation = outletPort(oblique) === 'b' ? stations.length - 1 : 0

  stations.forEach((x, index) => {
    if (hasDownstreamNeighbour && index === cededStation) return
    if (legHeight <= 0) return

    for (const sign of [1, -1]) {
      const z = sign * (mainWidth / 2 - LEG_SECTION_M / 2)
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
  })

  // The branch carries its own pair at its far end, where its weight is.
  if (legHeight > 0) {
    const [endX, endZ] = branchEndLocal(oblique)
    const cos = Math.cos(heading)
    const sin = Math.sin(heading)
    for (const sign of [1, -1]) {
      const offset = sign * (branchWidth / 2 - LEG_SECTION_M / 2)
      const lx = endX - LEG_SECTION_M * cos + offset * sin
      const lz = endZ + LEG_SECTION_M * sin + offset * cos
      parts.push(
        box('leg', [lx, legHeight / 2, lz], [LEG_SECTION_M, legHeight, LEG_SECTION_M], heading),
      )
      if (full) {
        parts.push(
          box(
            'footplate',
            [lx, FOOTPLATE_THICKNESS_M / 2, lz],
            [
              LEG_SECTION_M + FOOTPLATE_OVERHANG_M * 2,
              FOOTPLATE_THICKNESS_M,
              LEG_SECTION_M + FOOTPLATE_OVERHANG_M * 2,
            ],
            heading,
          ),
        )
      }
    }
  }

  return parts
}
