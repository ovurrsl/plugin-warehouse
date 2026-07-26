import type * as THREE from 'three'
import { ROLLER_DIAMETER_M } from './constants'
import {
  angleDeg,
  arcPointLocal,
  channelRadiiM,
  frameWidthM,
  legHeightM,
  outerRadiusM,
  rollerCount,
  rollerStepRad,
  supportAngles,
  zoneCount,
} from './curve-metrics'
import { curveParts } from './curve-parts'
import type { ConveyorCurveNode } from './curve-schema'
import {
  ATLAS_ROLLER_U0,
  ATLAS_ROLLER_U1,
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
 * One merged BufferGeometry per curve *shape*, out of the straight's pool.
 *
 * Everything structural is borrowed — the sink, the box emitter, the atlas
 * columns, the cache and its eviction rule — because a curve is a second shape
 * family of the same kind, not a second kind. Sharing the pool is what keeps the
 * retain counts and the size limit meaning what they say; two caches would each
 * enforce the limit against their own half.
 *
 * Only the deck is written here, and only because an annular sector is not a
 * box. Drawing it as one would either square off the bend or bury it under the
 * kerbs, and drawing it as many small boxes would put a visible staircase on the
 * inside edge of every curve.
 */

/**
 * The bed, as a strip of quads following the arc.
 *
 * **One quad per roller, and that is the whole trick.** V runs from the step
 * index to the next, so each quad shows exactly one period of the atlas's roller
 * column — which puts a painted roller at every angular step, and an angular
 * step is precisely what a tapered roller is. The stripe therefore lands where
 * real hardware would at *every* radius at once, rather than being correct on
 * the centreline and wrong at the edges.
 *
 * Top and bottom faces only. The kerbs close the long edges and the end plates
 * close the ends, so the four sides would never be seen and would cost a third
 * more triangles on the one part a curve has most of.
 */
function emitDeck(
  sink: Sink,
  curve: ConveyorCurveNode,
  color: readonly [number, number, number],
): void {
  const [inner, outer] = channelRadiiM(curve)
  const top = curve.transportHeight
  const bottom = top - ROLLER_DIAMETER_M
  const steps = rollerCount(curve)
  const step = rollerStepRad(curve)

  /**
   * Which way round a quad's corners have to go.
   *
   * A right-hand bend is the left one mirrored about local X, and a mirror
   * reverses winding — so the same corner order that faces up on one faces down
   * on the other, and the bed would be invisible from above on half of all
   * curves. Decided once here rather than guessed per face.
   */
  const mirrored = curve.handed === 'right'

  for (let index = 0; index < steps; index++) {
    const theta0 = index * step
    const theta1 = theta0 + step
    const i0 = arcPointLocal(curve, inner, theta0)
    const i1 = arcPointLocal(curve, inner, theta1)
    const o0 = arcPointLocal(curve, outer, theta0)
    const o1 = arcPointLocal(curve, outer, theta1)

    // U maps the channel once and V tiles along the arc — the same constraint
    // the straight works under, because `wrapS` stays clamped so one atlas
    // column cannot bleed into the next, which leaves only V free to repeat.
    const corners: Array<[[number, number], number, number]> = mirrored
      ? [
          [i0, ATLAS_ROLLER_U0, index],
          [i1, ATLAS_ROLLER_U0, index + 1],
          [o1, ATLAS_ROLLER_U1, index + 1],
          [o0, ATLAS_ROLLER_U1, index],
        ]
      : [
          [i0, ATLAS_ROLLER_U0, index],
          [o0, ATLAS_ROLLER_U1, index],
          [o1, ATLAS_ROLLER_U1, index + 1],
          [i1, ATLAS_ROLLER_U0, index + 1],
        ]

    for (const [y, normalY, order] of [
      [top, 1, corners],
      [bottom, -1, [...corners].reverse()],
    ] as const) {
      const base = sink.positions.length / 3
      for (const [[x, z], u, v] of order) {
        sink.positions.push(x, y, z)
        sink.normals.push(0, normalY, 0)
        sink.colors.push(color[0], color[1], color[2])
        sink.uvs.push(u, v)
      }
      sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }
}

function buildFrom(
  curve: ConveyorCurveNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour: boolean,
): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  const frameColor = toLinear(curve.frameColor)
  const profileColor = toLinear(curve.profileColor)

  emitDeck(sink, curve, toLinear(curve.rollerColor))

  for (const part of curveParts(curve, detail, hasDownstreamNeighbour)) {
    const color =
      part.role === 'frame' || part.role === 'end-plate'
        ? frameColor
        : part.role === 'guide'
          ? profileColor
          : toLinear(ROLE_COLORS[part.role])
    emitPart(sink, part, color, 0, part.rotationY)
  }

  return finish(sink)
}

/**
 * Identity of a curve's *shape*.
 *
 * Same law as the straight's key: built from what the builder consumes, not
 * from the raw fields. Three of the entries are derived rather than copied, and
 * each one is a place where the raw field would have been wrong:
 *
 * - **`rollerCount` + `rollerStepRad`, not `rollerPitch`.** The count is rounded
 *   so the step divides the arc exactly, so two pitches either side of a
 *   rounding boundary produce the *same* bed — and the pitch alone would split
 *   the cache between two byte-identical meshes.
 * - **`supportAngles`, not the arc length.** Stations come from a ceiling
 *   division, so their positions are what the mesh has and their positions are
 *   what the key carries.
 * - **`legHeight`, not `transportHeight`.** The height reaches the mesh through
 *   the leg and the frame's underside; a curve whose legs are already zero is
 *   the same mesh at every height below the frame depth.
 *
 * `speed`, `flow`, `shortestBox`, position, rotation, id, name and
 * `supportSlabId` are absent on purpose — none of them moves a vertex, and a
 * key that listed them would give every curve in a warehouse its own buffer.
 */
export function curveGeometryKey(
  curve: ConveyorCurveNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): string {
  return [
    detail,
    // Which end cedes its support. Named rather than counted: the ceded station
    // follows the flow, and flow reaches a curve's mesh through nothing else.
    hasDownstreamNeighbour ? `U${outletPort(curve)}` : 'UD',
    angleDeg(curve),
    curve.handed,
    curve.innerRadius.toFixed(5),
    frameWidthM(curve).toFixed(5),
    outerRadiusM(curve).toFixed(5),
    rollerCount(curve),
    rollerStepRad(curve).toFixed(7),
    legHeightM(curve).toFixed(5),
    supportAngles(curve)
      .map((theta) => theta.toFixed(5))
      .join(','),
    curve.sideGuide === 'none' ? '-' : `${curve.sideGuide}/${curve.sideGuideHeight.toFixed(4)}`,
    zoneCount(curve),
    curve.frameColor,
    curve.rollerColor,
    curve.profileColor,
  ].join('|')
}

export function getCurveGeometry(
  curve: ConveyorCurveNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): THREE.BufferGeometry {
  return getCachedGeometry(curveGeometryKey(curve, detail, hasDownstreamNeighbour), () =>
    buildFrom(curve, detail, hasDownstreamNeighbour),
  )
}

export function retainCurveGeometry(
  curve: ConveyorCurveNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour: boolean,
): string {
  return retainGeometry(curveGeometryKey(curve, detail, hasDownstreamNeighbour))
}
