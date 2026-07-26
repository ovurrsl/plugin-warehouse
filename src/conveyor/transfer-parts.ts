import {
  FOOTPLATE_OVERHANG_M,
  FOOTPLATE_THICKNESS_M,
  LEG_SECTION_M,
  MTR_ROLLERS_PER_GAP,
  MTR_STRIP_WIDTH_M,
  ROLLER_DIAMETER_M,
  SIDE_PROFILE_DEPTH_M,
  SIDE_PROFILE_THICKNESS_M,
} from './constants'
import type { ConveyorDetail } from './parts'
import { outletPort } from './ports'
import {
  frameBottomY,
  frameWidthM,
  legHeightM,
  moduleLengthM,
  skirtDepthM,
  stripCentreZM,
  stripOffsetsX,
  stripSpanM,
  supportOffsetsX,
} from './transfer-metrics'
import type { ConveyorTransferNode } from './transfer-schema'

/**
 * Every piece of a mixed transfer.
 *
 * **This shape has its own role union rather than the family's**, and that is
 * deliberate. A transfer has two parts nothing else in the kind has — the belt
 * strips and the closed lower body — and no guides at all, because a box leaves
 * by the side and a rail would be in the way of the one thing the machine does.
 * Widening the shared `ConveyorPartRole` to fit would let a curve or a straight
 * declare a strip it can never emit; narrowing here costs one local colour map.
 *
 * **The bed is four striped segments, not one.** Every other shape paints a
 * uniform stripe across a uniform bed, but a transfer's rollers have to fall in
 * the gaps the strips leave, so one stripe over the whole body would draw
 * rollers straight through them. Four segments, each carrying exactly the
 * rollers that are really in it, is what keeps the paint and the numbers
 * agreeing — the discipline the rest of this kind rests on, applied to the one
 * shape where a uniform bed is not true.
 */

export type TransferPartRole =
  | 'frame'
  | 'end-plate'
  | 'deck'
  | 'strip'
  | 'skirt'
  | 'leg'
  | 'footplate'

export type TransferPart = {
  role: TransferPartRole
  center: [number, number, number]
  size: [number, number, number]
  /** Which atlas column the part reads. Absent is the blank one, which
   *  multiplies out to the part's own colour. */
  pattern?: 'rollers'
  /** Tiles of the roller column along this part's own local X. Only the bed
   *  segments carry it, and each carries the rollers it actually holds. */
  stripeSpan?: number
}

export function transferParts(
  transfer: ConveyorTransferNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): TransferPart[] {
  const parts: TransferPart[] = []
  const full = detail === 'full'
  const length = moduleLengthM(transfer)
  const width = frameWidthM(transfer)
  const bottom = frameBottomY(transfer)
  const top = transfer.transportHeight

  // ── The frame, all four sides ─────────────────────────────────────────────
  // A square body rather than two side members: goods cross this machine both
  // ways, so every edge is an edge something travels over.
  for (const sign of [1, -1]) {
    parts.push({
      role: 'frame',
      center: [
        0,
        bottom + SIDE_PROFILE_DEPTH_M / 2,
        (sign * (width - SIDE_PROFILE_THICKNESS_M)) / 2,
      ],
      size: [length, SIDE_PROFILE_DEPTH_M, SIDE_PROFILE_THICKNESS_M],
    })
    parts.push({
      role: 'frame',
      center: [
        (sign * (length - SIDE_PROFILE_THICKNESS_M)) / 2,
        bottom + SIDE_PROFILE_DEPTH_M / 2,
        0,
      ],
      size: [SIDE_PROFILE_THICKNESS_M, SIDE_PROFILE_DEPTH_M, width],
    })
  }

  // ── The bed, one segment per gap ──────────────────────────────────────────
  const half = MTR_STRIP_WIDTH_M / 2
  const boundaries = [-length / 2, ...stripOffsetsX(transfer), length / 2]
  for (let index = 0; index < boundaries.length - 1; index++) {
    const first = index === 0
    const last = index === boundaries.length - 2
    const from = (boundaries[index] ?? 0) + (first ? 0 : half)
    const to = (boundaries[index + 1] ?? 0) - (last ? 0 : half)
    parts.push({
      role: 'deck',
      pattern: 'rollers',
      stripeSpan: MTR_ROLLERS_PER_GAP,
      center: [(from + to) / 2, top - ROLLER_DIAMETER_M / 2, 0],
      size: [to - from, ROLLER_DIAMETER_M, width - SIDE_PROFILE_THICKNESS_M * 2],
    })
  }

  // ── The belt strips ───────────────────────────────────────────────────────
  // Between the rollers and flush with them at rest, so the bed reads as one
  // surface until they lift. Boxes rather than paint: a painted line cannot
  // rise, and rising is the whole machine.
  const span = stripSpanM(transfer)
  const stripZ = stripCentreZM(transfer)
  for (const x of stripOffsetsX(transfer)) {
    parts.push({
      role: 'strip',
      center: [x, top - ROLLER_DIAMETER_M / 2, stripZ],
      size: [MTR_STRIP_WIDTH_M, ROLLER_DIAMETER_M, span],
    })
  }

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
        size: [SIDE_PROFILE_THICKNESS_M, SIDE_PROFILE_DEPTH_M * 0.8, width * 0.9],
      })
    }
  }

  // ── The closed lower body ─────────────────────────────────────────────────
  // Where every other shape in the family shows its legs, this one shows a
  // skirt: the lift mechanism is inside it, which is also why this type's
  // height floor is 500 mm and the rest of the family's is 370.
  const skirt = skirtDepthM(transfer)
  const legHeight = legHeightM(transfer)
  if (skirt > 0) {
    parts.push({
      role: 'skirt',
      center: [0, legHeight + skirt / 2, 0],
      size: [length * 0.94, skirt, width * 0.94],
    })
  }

  // ── Supports ──────────────────────────────────────────────────────────────
  const stations = supportOffsetsX(transfer)
  /** The station at the discharge end of the roller line — see `./parts`. */
  const cededStation = outletPort(transfer) === 'b' ? stations.length - 1 : 0

  stations.forEach((x, index) => {
    if (hasDownstreamNeighbour && index === cededStation) return
    if (legHeight <= 0) return

    for (const sign of [1, -1]) {
      const z = sign * (width / 2 - LEG_SECTION_M / 2)
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
  })

  return parts
}
