import type * as THREE from 'three'
import { memoiseGeometryKey } from '../geometry-key-memo'
import {
  emitPart,
  finish,
  getCachedGeometry,
  ROLE_COLORS,
  retainGeometry,
  type Sink,
  toLinear,
} from './geometry-builder'
import {
  frameWidthM,
  hasCrossbar,
  lateralOuterZM,
  legHeightM,
  moduleLengthM,
  rollerCount,
  rollerPitchM,
  supportOffsetsX,
  usefulWidthMm,
} from './launcher-metrics'
import { launcherParts } from './launcher-parts'
import type { ConveyorLauncherNode } from './launcher-schema'
import type { ConveyorDetail } from './parts'
import { outletPort } from './ports'

/**
 * One merged BufferGeometry per launcher *shape*, out of the straight's pool.
 *
 * Nothing new is invented here: the sink, the box emitter, the atlas columns,
 * the material and the cache are all the straight's, because a launcher is a
 * shape of the same kind rather than a kind of its own. Sharing the pool is what
 * keeps the retain counts and the size limit meaning what they say.
 *
 * The one thing worth its own line is the stripe span, which is read off each
 * part rather than off the node: the lateral bed is a second patterned deck at
 * a different length and a right angle, so a single node-level figure would
 * paint its rollers at the main bed's spacing.
 */
function buildFrom(
  launcher: ConveyorLauncherNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour: boolean,
): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  const frameColor = toLinear(launcher.frameColor)
  const rollerColor = toLinear(launcher.rollerColor)
  const profileColor = toLinear(launcher.profileColor)
  const pitch = rollerPitchM(launcher)

  for (const part of launcherParts(launcher, detail, hasDownstreamNeighbour)) {
    const color =
      part.role === 'frame' || part.role === 'end-plate'
        ? frameColor
        : part.role === 'deck'
          ? rollerColor
          : part.role === 'guide'
            ? profileColor
            : toLinear(ROLE_COLORS[part.role])
    // One tile per roller pitch **of this part**, so both beds paint their own
    // rollers where their own rollers are.
    emitPart(sink, part, color, part.size[0] / pitch, part.rotationY)
  }

  return finish(sink)
}

/**
 * Identity of a launcher's *shape*.
 *
 * Same law as everywhere else in the kind: built from what the builder consumes,
 * never from raw fields. Two entries earn their place by being the ones a
 * careless key would miss:
 *
 * - **`launchSide`.** A left-launching machine is not a right-launching one
 *   turned round — turning it also swaps which end is the infeed — so the two
 *   are different meshes, and a key without it hands one the other's buffer.
 *   That is the under-report the cache-key law names, and it is invisible: the
 *   arm simply appears on the wrong side.
 * - **The end that cedes its support**, rather than an abutted/not bit. Which
 *   station goes follows the flow, so the end has to be named.
 *
 * `sideGuide` is a boolean here rather than the straight's four-way enum,
 * because a launcher has exactly one side a rail can go on.
 */
function buildLauncherGeometryKey(
  launcher: ConveyorLauncherNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): string {
  return [
    detail,
    hasDownstreamNeighbour ? `U${outletPort(launcher)}` : 'UD',
    usefulWidthMm(launcher),
    frameWidthM(launcher).toFixed(5),
    moduleLengthM(launcher).toFixed(5),
    rollerCount(launcher),
    lateralOuterZM(launcher).toFixed(5),
    launcher.launchSide,
    legHeightM(launcher).toFixed(5),
    hasCrossbar(launcher) ? 1 : 0,
    supportOffsetsX(launcher)
      .map((offset) => offset.toFixed(5))
      .join(','),
    // Full-tier parts only — see `./geometry-builder`.
    detail === 'full' && launcher.sideGuide ? launcher.sideGuideHeight.toFixed(4) : '-',
    launcher.frameColor,
    launcher.rollerColor,
    launcher.profileColor,
  ].join('|')
}

export function getLauncherGeometry(
  launcher: ConveyorLauncherNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): THREE.BufferGeometry {
  return getCachedGeometry(launcherGeometryKey(launcher, detail, hasDownstreamNeighbour), () =>
    buildFrom(launcher, detail, hasDownstreamNeighbour),
  )
}

export function retainLauncherGeometry(
  launcher: ConveyorLauncherNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour: boolean,
): string {
  return retainGeometry(launcherGeometryKey(launcher, detail, hasDownstreamNeighbour))
}

/** Düğüm-nesnesine memoize — bkz. `geometry-key-memo.ts`; çıplak üretici: `buildLauncherGeometryKey`. */
export const launcherGeometryKey = memoiseGeometryKey(
  buildLauncherGeometryKey,
  (detail, hasDownstreamNeighbour) => `${detail}:${hasDownstreamNeighbour ? 'U' : 'UD'}`,
)
