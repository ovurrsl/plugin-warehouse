import type * as THREE from 'three'
import {
  frameWidthM,
  hasCrossbar,
  legHeightM,
  moduleLengthM,
  rollerPitchM,
  rollerPitchMm,
  supportOffsetsX,
  usefulWidthMm,
} from './booster-metrics'
import { boosterParts } from './booster-parts'
import type { ConveyorBoosterNode } from './booster-schema'
import {
  emitPart,
  finish,
  getCachedGeometry,
  ROLE_COLORS,
  retainGeometry,
  type Sink,
  toLinear,
} from './geometry-builder'
import type { ConveyorDetail } from './parts'
import { outletPort } from './ports'

/**
 * One merged BufferGeometry per booster *shape*, out of the straight's pool.
 *
 * Nothing structural is new: the sink, the emitter, the atlas, the material and
 * the cache are all shared, because a booster is a shape of one kind rather than
 * a kind of its own machinery.
 */
function buildFrom(
  booster: ConveyorBoosterNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour: boolean,
): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  const frameColor = toLinear(booster.frameColor)
  const rollerColor = toLinear(booster.rollerColor)
  const profileColor = toLinear(booster.profileColor)
  // One tile per roller pitch, so the painted rollers land where real ones would
  // however long the bed is.
  const stripeSpan = moduleLengthM(booster) / rollerPitchM(booster)

  for (const part of boosterParts(booster, detail, hasDownstreamNeighbour)) {
    const color =
      part.role === 'frame' || part.role === 'end-plate'
        ? frameColor
        : part.role === 'deck'
          ? rollerColor
          : part.role === 'guide'
            ? profileColor
            : toLinear(ROLE_COLORS[part.role])
    emitPart(sink, part, color, stripeSpan)
  }

  return finish(sink)
}

/**
 * Identity of a booster's *shape*.
 *
 * Same law as everywhere else in the kind. Two entries are derived rather than
 * raw and both matter here:
 *
 * - **`moduleLength` and `rollerPitch` separately, never the roller count.**
 *   Twelve rollers at 75 mm and nine at 100 mm are both 900 mm beds — but the
 *   stripe repeat differs, so they are not the same mesh. Listing the count as
 *   well would split the cache on a number the builder never reads directly.
 * - **The end that cedes its support**, rather than an abutted/not bit. Which
 *   station goes follows the flow, so the end has to be named.
 *
 * `speed`, `shortestBox`, position, rotation, id, name and `supportSlabId` are
 * absent on purpose: none of them moves a vertex.
 */
export function boosterGeometryKey(
  booster: ConveyorBoosterNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): string {
  return [
    detail,
    hasDownstreamNeighbour ? `U${outletPort(booster)}` : 'UD',
    usefulWidthMm(booster),
    frameWidthM(booster).toFixed(5),
    moduleLengthM(booster).toFixed(5),
    rollerPitchMm(booster),
    legHeightM(booster).toFixed(5),
    hasCrossbar(booster) ? 1 : 0,
    supportOffsetsX(booster)
      .map((offset) => offset.toFixed(5))
      .join(','),
    booster.sideGuide === 'none'
      ? '-'
      : `${booster.sideGuide}/${booster.sideGuideHeight.toFixed(4)}`,
    booster.frameColor,
    booster.rollerColor,
    booster.profileColor,
  ].join('|')
}

export function getBoosterGeometry(
  booster: ConveyorBoosterNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): THREE.BufferGeometry {
  return getCachedGeometry(boosterGeometryKey(booster, detail, hasDownstreamNeighbour), () =>
    buildFrom(booster, detail, hasDownstreamNeighbour),
  )
}

export function retainBoosterGeometry(
  booster: ConveyorBoosterNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour: boolean,
): string {
  return retainGeometry(boosterGeometryKey(booster, detail, hasDownstreamNeighbour))
}
