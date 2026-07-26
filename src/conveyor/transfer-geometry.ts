import type * as THREE from 'three'
import { PALETTE } from './constants'
import {
  emitPart,
  finish,
  getCachedGeometry,
  retainGeometry,
  type Sink,
  toLinear,
} from './geometry-builder'
import type { ConveyorDetail } from './parts'
import { outletPort } from './ports'
import {
  frameWidthM,
  legHeightM,
  moduleLengthM,
  skirtDepthM,
  stripCentreZM,
  stripOffsetsX,
  stripSpanM,
} from './transfer-metrics'
import { type TransferPartRole, transferParts } from './transfer-parts'
import type { ConveyorTransferNode } from './transfer-schema'

/**
 * One merged BufferGeometry per transfer *shape*, out of the straight's pool.
 *
 * The sink, the emitter, the atlas, the material and the cache are all shared —
 * a transfer is a shape of one kind, not a kind of its own machinery. What is
 * local is the colour map, because this shape has two parts nothing else in the
 * family has and the shared `ROLE_COLORS` should not learn about roles a curve
 * or a straight can never emit.
 */
const FIXED_COLORS: Record<
  Exclude<TransferPartRole, 'frame' | 'end-plate' | 'deck' | 'strip'>,
  string
> = {
  skirt: PALETTE.frameBlue,
  leg: PALETTE.frameBlue,
  footplate: PALETTE.feetGrey,
}

function buildFrom(
  transfer: ConveyorTransferNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour: boolean,
): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  const frameColor = toLinear(transfer.frameColor)
  const rollerColor = toLinear(transfer.rollerColor)
  const stripColor = toLinear(transfer.stripColor)

  for (const part of transferParts(transfer, detail, hasDownstreamNeighbour)) {
    const color =
      part.role === 'frame' || part.role === 'end-plate'
        ? frameColor
        : part.role === 'deck'
          ? rollerColor
          : part.role === 'strip'
            ? stripColor
            : toLinear(FIXED_COLORS[part.role])
    // Each bed segment carries exactly the rollers that are really in it, so
    // the paint and `rollerOffsetsX` cannot drift apart.
    emitPart(sink, part, color, part.stripeSpan ?? 0)
  }

  return finish(sink)
}

/**
 * Identity of a transfer's *shape*.
 *
 * Two entries are the ones a careless key would miss, and both were named by an
 * adversarial read of this kind's earlier shapes:
 *
 * - **`stripCentreZM`, not `dischargeSide`.** The tempting entry is the side,
 *   and it is wrong: strips that span the whole body are centred whichever way
 *   the box leaves, so a *symmetric* machine's mesh is byte-identical mirrored
 *   and keying on the side would give it two buffers. Only the asymmetric build
 *   leans, and the offset says so — zero when there is nothing to say.
 * - **`stripSpanM`**, because asymmetric strips are shorter and that moves
 *   vertices.
 *
 * **`MTR_STRIP_STROKE_M` is deliberately absent**, and will stay absent when the
 * strips are animated: a strip at rest and a strip lifted are the same module,
 * and keying on the stroke would put two buffers behind every transfer in the
 * building for a difference no placement can see.
 */
export function transferGeometryKey(
  transfer: ConveyorTransferNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): string {
  return [
    detail,
    hasDownstreamNeighbour ? `U${outletPort(transfer)}` : 'UD',
    moduleLengthM(transfer).toFixed(5),
    frameWidthM(transfer).toFixed(5),
    stripOffsetsX(transfer)
      .map((offset) => offset.toFixed(5))
      .join(','),
    stripSpanM(transfer).toFixed(5),
    stripCentreZM(transfer).toFixed(5),
    legHeightM(transfer).toFixed(5),
    skirtDepthM(transfer).toFixed(5),
    transfer.frameColor,
    transfer.rollerColor,
    transfer.stripColor,
  ].join('|')
}

export function getTransferGeometry(
  transfer: ConveyorTransferNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): THREE.BufferGeometry {
  return getCachedGeometry(transferGeometryKey(transfer, detail, hasDownstreamNeighbour), () =>
    buildFrom(transfer, detail, hasDownstreamNeighbour),
  )
}

export function retainTransferGeometry(
  transfer: ConveyorTransferNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour: boolean,
): string {
  return retainGeometry(transferGeometryKey(transfer, detail, hasDownstreamNeighbour))
}
