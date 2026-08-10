import type * as THREE from 'three'
import { memoiseGeometryKey } from '../geometry-key-memo'
import { PALETTE } from './constants'
import {
  beltStripeSpan,
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
import { stripParts, type TransferPartRole, transferParts } from './transfer-parts'
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
    emitPart(sink, part, color, beltStripeSpan(transfer, part.stripeSpan ?? 0))
  }

  return finish(sink)
}

/**
 * Identity of a transfer's *shape*.
 *
 * Two entries are the ones a careless key would miss, and both were named by an
 * adversarial read of this kind's earlier shapes:
 *
 * **`stripOffsetsX` stays and the strips' own figures leave.** The offsets
 * bound the four bed segments, so the body genuinely depends on them; the strip
 * centre, the span and the strip colour describe only the strips, which are no
 * longer in this buffer. A key listing them would split the body's cache on a
 * difference the body does not contain — the over-reporting half of the key
 * law, and the same one the sweep caught on `dischargeSide` before this split.
 */
function buildTransferGeometryKey(
  transfer: ConveyorTransferNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): string {
  return [
    detail,
    hasDownstreamNeighbour ? `U${outletPort(transfer)}` : 'UD',
    // Akış yönü KOŞULSUZ: ters akışta yatağın V'si negatif dokunuyor
    // (`beltStripeSpan`), yani mesh gerçekten farklı ve iki yön tek buffer'ı
    // paylaşamaz — paylaşsalardı bandın biri ters yöne akardı.
    transfer.flow === 'reverse' ? 'r' : 'f',
    moduleLengthM(transfer).toFixed(5),
    frameWidthM(transfer).toFixed(5),
    stripOffsetsX(transfer)
      .map((offset) => offset.toFixed(5))
      .join(','),
    legHeightM(transfer).toFixed(5),
    skirtDepthM(transfer).toFixed(5),
    transfer.frameColor,
    transfer.rollerColor,
  ].join('|')
}

/**
 * Identity of the strip set, which is a different question from the body's.
 *
 * **`MTR_STRIP_STROKE_M` is deliberately absent**, and stays absent now that the
 * strips animate: a strip at rest and a strip lifted are the same three boxes
 * at a different height, and the height is a transform rather than a vertex.
 * Keying on the stroke would put two buffers behind every transfer in the
 * building for a difference the mesh does not have.
 */
export function transferStripsKey(transfer: ConveyorTransferNode): string {
  return [
    stripOffsetsX(transfer)
      .map((offset) => offset.toFixed(5))
      .join(','),
    stripSpanM(transfer).toFixed(5),
    stripCentreZM(transfer).toFixed(5),
    transfer.transportHeight.toFixed(5),
    transfer.stripColor,
  ].join('|')
}

export function getTransferStripsGeometry(transfer: ConveyorTransferNode): THREE.BufferGeometry {
  return getCachedGeometry(`mtr-strips|${transferStripsKey(transfer)}`, () => {
    const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
    const color = toLinear(transfer.stripColor)
    for (const part of stripParts(transfer)) emitPart(sink, part, color, 0)
    return finish(sink)
  })
}

export function retainTransferStripsGeometry(transfer: ConveyorTransferNode): string {
  return retainGeometry(`mtr-strips|${transferStripsKey(transfer)}`)
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

/** Düğüm-nesnesine memoize — bkz. `geometry-key-memo.ts`; çıplak üretici: `buildTransferGeometryKey`. */
export const transferGeometryKey = memoiseGeometryKey(
  buildTransferGeometryKey,
  (detail, hasDownstreamNeighbour) => `${detail}:${hasDownstreamNeighbour ? 'U' : 'UD'}`,
)
