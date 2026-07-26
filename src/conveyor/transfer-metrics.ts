import { MTR } from './catalog'
import {
  MIN_ROLLERS_UNDER_A_BOX,
  MTR_ROLLERS_PER_GAP,
  MTR_STRIP_COUNT,
  MTR_STRIP_WIDTH_M,
  ROLLER_DIAMETER_M,
  SIDE_PROFILE_DEPTH_M,
} from './constants'
import type { ConveyorTransferNode } from './transfer-schema'

/**
 * Every figure derived from a mixed transfer.
 *
 * Shorter than the other shapes' because most of this machine is fixed: the body
 * is 708 × 723 and the ports are all one class, so what is left to derive is the
 * strips, the rollers that have to fall between them, and the heights.
 */

export function speedMPerMin(transfer: ConveyorTransferNode): number {
  return Number(transfer.speed)
}

export function speedMPerSec(transfer: ConveyorTransferNode): number {
  return speedMPerMin(transfer) / 60
}

/** The body, along the roller direction. Fixed by the catalogue. */
export function moduleLengthM(_transfer: ConveyorTransferNode): number {
  return MTR.lengthM
}

/** The body, across it. Also fixed — this type has no lane the frame is built
 *  around, so there is no overhang to add. */
export function frameWidthM(_transfer: ConveyorTransferNode): number {
  return MTR.widthM
}

/** The one port class this type is built in, in the catalogue's millimetres. */
export function laneMm(_transfer: ConveyorTransferNode): number {
  return MTR.boxWidthWithRollersMaxM * 1000
}

/** Which way the box is taken off, as a sign on local Z. Local +Z is the
 *  module's left seen from above with goods travelling local +X. */
export function dischargeSign(transfer: ConveyorTransferNode): number {
  return transfer.dischargeSide === 'left' ? 1 : -1
}

// ── The strips, and the rollers that must fall between them ─────────────────

/**
 * How far along the cross direction the strips reach.
 *
 * Symmetric strips span the whole body; asymmetric ones stop short, which hands
 * the box over sooner at the cost of a shorter travel. The catalogue names the
 * pair and not the figure, so the short one is taken at two thirds — enough to
 * read as deliberately shorter rather than as an error.
 */
export function stripSpanM(transfer: ConveyorTransferNode): number {
  const full = frameWidthM(transfer)
  return transfer.travel === 'symmetric' ? full : full * (2 / 3)
}

/**
 * Where the strips sit across the body.
 *
 * Zero on a symmetric build, because strips that span the whole width are
 * centred whichever way the box leaves — **a symmetric transfer really is the
 * same machine mirrored**, and its mesh is byte-identical either way. Only the
 * asymmetric build leans, and only then does the discharge side move a vertex.
 *
 * This is what the cache key reads instead of `dischargeSide`: keying on the
 * side would give two buffers to one mesh on every symmetric machine, which is
 * the over-reporting half of the key law.
 */
export function stripCentreZM(transfer: ConveyorTransferNode): number {
  return (dischargeSign(transfer) * (frameWidthM(transfer) - stripSpanM(transfer))) / 2
}

/** Local X of each belt strip's centre, spread evenly across the roller
 *  direction so the box is picked up along its whole length. */
export function stripOffsetsX(transfer: ConveyorTransferNode): number[] {
  const length = moduleLengthM(transfer)
  const step = length / (MTR_STRIP_COUNT + 1)
  return Array.from({ length: MTR_STRIP_COUNT }, (_, index) => -length / 2 + (index + 1) * step)
}

/**
 * Local X of each roller centre.
 *
 * **Derived from the strips, never from a pitch.** The rollers have to fall in
 * the gaps the strips leave, so the strip layout is the input and the spacing is
 * what comes out — the opposite of every other shape here, and the reason this
 * type carries no `rollerPitch` field. Inventing one and then placing rollers by
 * it would let the two disagree, with rollers drawn through the strips.
 */
export function rollerOffsetsX(transfer: ConveyorTransferNode): number[] {
  const length = moduleLengthM(transfer)
  const half = MTR_STRIP_WIDTH_M / 2
  const boundaries = [-length / 2, ...stripOffsetsX(transfer), length / 2]
  const rollers: number[] = []

  for (let index = 0; index < boundaries.length - 1; index++) {
    const first = index === 0
    const last = index === boundaries.length - 2
    const from = (boundaries[index] ?? 0) + (first ? 0 : half)
    const to = (boundaries[index + 1] ?? 0) - (last ? 0 : half)
    const step = (to - from) / (MTR_ROLLERS_PER_GAP + 1)
    for (let roller = 1; roller <= MTR_ROLLERS_PER_GAP; roller++) {
      rollers.push(from + roller * step)
    }
  }
  return rollers
}

/**
 * The widest gap between consecutive rollers.
 *
 * What the catalogue's three-roller rule actually binds on, and it has to be
 * measured rather than assumed here: the spacing is not uniform, because a
 * strip sits between every pair of groups.
 */
export function widestRollerGapM(transfer: ConveyorTransferNode): number {
  const offsets = rollerOffsetsX(transfer)
  let widest = 0
  for (let index = 1; index < offsets.length; index++) {
    widest = Math.max(widest, (offsets[index] ?? 0) - (offsets[index - 1] ?? 0))
  }
  return widest
}

export function rollersUnderShortestBox(transfer: ConveyorTransferNode): number {
  const gap = widestRollerGapM(transfer)
  return gap <= 0 ? 0 : Math.floor(transfer.shortestBox / gap) + 1
}

export function carriesShortestBox(transfer: ConveyorTransferNode): boolean {
  return rollersUnderShortestBox(transfer) >= MIN_ROLLERS_UNDER_A_BOX
}

export function carriesCatalogueBox(transfer: ConveyorTransferNode): boolean {
  return (
    transfer.shortestBox >= MTR.boxLengthRollerDirRangeM[0] - 1e-9 &&
    transfer.shortestBox <= MTR.boxLengthRollerDirRangeM[1] + 1e-9
  )
}

// ── Heights ─────────────────────────────────────────────────────────────────

export function rollerAxisY(transfer: ConveyorTransferNode): number {
  return transfer.transportHeight - ROLLER_DIAMETER_M / 2
}

export function frameBottomY(transfer: ConveyorTransferNode): number {
  return transfer.transportHeight - SIDE_PROFILE_DEPTH_M
}

/**
 * The closed lower body, and where it stops.
 *
 * This machine shows a skirt where the others show their legs, because the lift
 * mechanism lives inside it — which is also why the catalogue's height floor is
 * 500 mm here and 370 everywhere else. The skirt takes the top third of the leg
 * run and the legs carry the rest.
 */
export function skirtDepthM(transfer: ConveyorTransferNode): number {
  return Math.max(0, frameBottomY(transfer)) / 3
}

export function legHeightM(transfer: ConveyorTransferNode): number {
  return Math.max(0, frameBottomY(transfer) - skirtDepthM(transfer))
}

/** Local X of each support station: one at each end. The body is well inside
 *  the family's 1.5 m spacing, and ends are what let it share a support at a
 *  seam like a straight. */
export function supportOffsetsX(transfer: ConveyorTransferNode): number[] {
  const length = moduleLengthM(transfer)
  return [-length / 2, length / 2]
}

// ── Placement ───────────────────────────────────────────────────────────────

/** `[width along the roller direction, depth across it]`. Square-ish and
 *  centred on the node, unlike the launcher's L. */
export function footprintM(transfer: ConveyorTransferNode): [number, number] {
  return [moduleLengthM(transfer), frameWidthM(transfer)]
}

/** The volume the module occupies, floor to roller top. There are no side
 *  guides on this type — a box leaves by the side, so a rail would be in the
 *  way of the one thing the machine does. */
export function localBoundsM(transfer: ConveyorTransferNode): {
  min: [number, number, number]
  max: [number, number, number]
} {
  const [length, width] = footprintM(transfer)
  return {
    min: [-length / 2, 0, -width / 2],
    max: [length / 2, transfer.transportHeight, width / 2],
  }
}
