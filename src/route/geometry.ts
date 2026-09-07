import * as THREE from 'three'
import {
  finish,
  getCachedGeometry,
  releaseGeometry,
  retainGeometry,
  type Sink,
} from '../conveyor/geometry-builder'
import {
  ARROW_HALF_WIDTH_M,
  ARROW_LENGTH_M,
  ARROW_SPACING_M,
  ARROWS_PER_LEG_MAX,
  DIVIDER_DASH_M,
  DIVIDER_GAP_M,
  LINE_WIDTHS,
  ROUTE_ELEVATIONS,
} from './constants'
import type { RouteNode } from './schema'
import { offsetCentreline, type Point, stripeCentreOffsetM } from './stripes'

/**
 * The paint, as one merged buffer.
 *
 * Emits stratified floor markings using strict monotonic vertical Y-offsets
 * coupled with WebGL depth biasing to eliminate z-fighting:
 * - Painted corridor floor fill at ROUTE_ELEVATIONS.PAINTED_CORRIDOR (+0.002m)
 * - Edge boundary stripes at ROUTE_ELEVATIONS.EDGE_STRIPES (+0.008m)
 * - Directional flow arrows / dividers at ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS (+0.012m)
 */

/** Which draw group a triangle belongs to, so one buffer serves three colours
 *  without a second draw call per marking. */
export const GROUP_STRIPE = 0
export const GROUP_CONTRAST = 1
export const GROUP_PAINT = 2

type Groups = { stripe: number[]; contrast: number[]; paint: number[] }

function pushVertex(
  sink: Sink,
  x: number,
  y: number,
  z: number,
  u: number,
  v: number,
  color: [number, number, number] = [1, 1, 1],
): number {
  const index = sink.positions.length / 3
  sink.positions.push(x, y, z)
  sink.normals.push(0, 1, 0)
  sink.colors.push(color[0], color[1], color[2])
  sink.uvs.push(u, v)
  return index
}

/** Two triangles, wound counter-clockwise seen from above so the paint faces
 *  the camera a warehouse is looked at from. */
function pushQuad(
  sink: Sink,
  into: number[],
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  y: number = 0,
  color?: [number, number, number],
) {
  const ia = pushVertex(sink, a[0], y, a[1], 0, 0, color)
  const ib = pushVertex(sink, b[0], y, b[1], 1, 0, color)
  const ic = pushVertex(sink, c[0], y, c[1], 1, 1, color)
  const id = pushVertex(sink, d[0], y, d[1], 0, 1, color)
  into.push(ia, ic, ib, ia, id, ic)
}

/** A ribbon of constant width following a polyline, from its two offset edges. */
function emitRibbon(
  sink: Sink,
  into: number[],
  inner: Point[],
  outer: Point[],
  y: number = 0,
  color?: [number, number, number],
) {
  for (let i = 0; i < inner.length - 1; i++) {
    const a = inner[i]
    const b = outer[i]
    const c = outer[i + 1]
    const d = inner[i + 1]
    if (!a || !b || !c || !d) continue
    pushQuad(sink, into, a, b, c, d, y, color)
  }
}

/** Where along a leg the arrows sit, as fractions of its length. */
function arrowFractions(lengthM: number): number[] {
  const count = Math.min(ARROWS_PER_LEG_MAX, 1 + Math.floor(lengthM / ARROW_SPACING_M))
  return Array.from({ length: count }, (_, i) => (i + 0.5) / count)
}

function emitArrows(
  sink: Sink,
  into: number[],
  points: readonly Point[],
  y = ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS,
) {
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    if (!from || !to) continue
    const dx = to[0] - from[0]
    const dz = to[1] - from[1]
    const length = Math.hypot(dx, dz)
    if (length < ARROW_LENGTH_M) continue
    const ux = dx / length
    const uz = dz / length
    // The arrow is drawn about the leg's own direction, so a route that bends
    // has an arrow per leg pointing the way that leg actually runs — not one
    // heading averaged over a corner.
    const nx = -uz
    const nz = ux

    for (const fraction of arrowFractions(length)) {
      const cx = from[0] + dx * fraction
      const cz = from[1] + dz * fraction
      const tipX = cx + ux * (ARROW_LENGTH_M / 2)
      const tipZ = cz + uz * (ARROW_LENGTH_M / 2)
      const backX = cx - ux * (ARROW_LENGTH_M / 2)
      const backZ = cz - uz * (ARROW_LENGTH_M / 2)

      const tip = pushVertex(sink, tipX, y, tipZ, 0.5, 1)
      const left = pushVertex(
        sink,
        backX + nx * ARROW_HALF_WIDTH_M,
        y,
        backZ + nz * ARROW_HALF_WIDTH_M,
        0,
        0,
      )
      const right = pushVertex(
        sink,
        backX - nx * ARROW_HALF_WIDTH_M,
        y,
        backZ - nz * ARROW_HALF_WIDTH_M,
        1,
        0,
      )
      into.push(tip, right, left)
    }
  }
}

function emitDivider(
  sink: Sink,
  into: number[],
  points: readonly Point[],
  halfWidth: number,
  y = ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS,
) {
  const period = DIVIDER_DASH_M + DIVIDER_GAP_M
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    if (!from || !to) continue
    const dx = to[0] - from[0]
    const dz = to[1] - from[1]
    const length = Math.hypot(dx, dz)
    if (length < 1e-9) continue
    const ux = dx / length
    const uz = dz / length
    const nx = -uz * halfWidth
    const nz = ux * halfWidth

    for (let start = 0; start < length; start += period) {
      const end = Math.min(start + DIVIDER_DASH_M, length)
      if (end - start < 1e-6) continue
      const ax = from[0] + ux * start
      const az = from[1] + uz * start
      const bx = from[0] + ux * end
      const bz = from[1] + uz * end
      pushQuad(
        sink,
        into,
        [ax + nx, az + nz],
        [ax - nx, az - nz],
        [bx - nx, bz - nz],
        [bx + nx, bz + nz],
        y,
      )
    }
  }
}

/**
 * Whether this route draws arrows, and whether it draws a lane divider.
 *
 * **Derived, and the key names these rather than `role` and `traffic`.** The
 * raw fields reach the mesh only through these two gates, so listing them raw
 * would split the cache on a change that moves no vertex.
 * Directional arrows are gated by `directionalArrows !== false`.
 */
export function markingGates(route: RouteNode): { arrows: boolean; divider: boolean } {
  return {
    arrows: route.traffic === 'one-way' && route.directionalArrows !== false,
    divider: route.role === 'vehicle' && route.traffic === 'two-way',
  }
}

/** Vertices relative to the first, so the same shape drawn anywhere is one
 *  buffer. Translation must never mint a mesh. */
function relativePoints(route: RouteNode): Point[] {
  const origin = route.points[0] ?? [0, 0]
  return route.points.map((p) => [p[0] - origin[0], p[1] - origin[1]] as Point)
}

export function routeGeometryKey(route: RouteNode): string {
  const gates = markingGates(route)
  const digest = relativePoints(route)
    .map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`)
    .join(';')
  return [
    'route',
    route.width.toFixed(4),
    route.lineWidth,
    gates.arrows ? 'a' : '-',
    gates.divider ? 'd' : '-',
    route.laneColor ? `c:${route.laneColor}` : '-',
    route.directionalArrows !== false ? 'da' : '-',
    route.points.length,
    digest,
  ].join('|')
}

/**
 * Trims a polyline by cutback distances from the start and/or end.
 * Used to set back corridor ribbons arriving at intersections so they don't overlap zebra meshes.
 *
 * @param points Array of 2D points [x, z]
 * @param startCut Distance to trim from start of polyline (metres)
 * @param endCut Distance to trim from end of polyline (metres)
 * @returns Trimmed polyline points
 */
export function trimPolylineByCuts(
  points: Point[],
  startCut: number = 0,
  endCut: number = 0,
): Point[] {
  if (points.length < 2) return [...points]
  if (startCut <= 0 && endCut <= 0) return [...points]

  const segLengths: number[] = []
  let totalLength = 0
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(points[i + 1]![0] - points[i]![0], points[i + 1]![1] - points[i]![1])
    segLengths.push(d)
    totalLength += d
  }

  if (totalLength <= startCut + endCut) {
    const midX = (points[0]![0] + points[points.length - 1]![0]) / 2
    const midZ = (points[0]![1] + points[points.length - 1]![1]) / 2
    return [
      [midX, midZ],
      [midX, midZ],
    ]
  }

  let remainingStartCut = Math.max(0, startCut)
  let startIndex = 0
  let newStartPoint: Point = points[0]!

  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i]!
    if (remainingStartCut >= segLen) {
      remainingStartCut -= segLen
      startIndex = i + 1
      newStartPoint = points[startIndex]!
    } else if (remainingStartCut > 1e-6) {
      const t = remainingStartCut / segLen
      const pA = points[i]!
      const pB = points[i + 1]!
      newStartPoint = [pA[0] + (pB[0] - pA[0]) * t, pA[1] + (pB[1] - pA[1]) * t]
      startIndex = i
      break
    } else {
      break
    }
  }

  let remainingEndCut = Math.max(0, endCut)
  let endIndex = points.length - 1
  let newEndPoint: Point = points[endIndex]!

  for (let i = segLengths.length - 1; i >= 0; i--) {
    const segLen = segLengths[i]!
    if (remainingEndCut >= segLen) {
      remainingEndCut -= segLen
      endIndex = i
      newEndPoint = points[endIndex]!
    } else if (remainingEndCut > 1e-6) {
      const t = 1 - remainingEndCut / segLen
      const pA = points[i]!
      const pB = points[i + 1]!
      newEndPoint = [pA[0] + (pB[0] - pA[0]) * t, pA[1] + (pB[1] - pA[1]) * t]
      endIndex = i + 1
      break
    } else {
      break
    }
  }

  const result: Point[] = [newStartPoint]
  for (let i = startIndex + 1; i < endIndex; i++) {
    result.push(points[i]!)
  }
  result.push(newEndPoint)

  return result
}

export interface RouteGeometryOptions {
  startCut?: number
  endCut?: number
}

export function buildRouteGeometry(
  route: RouteNode,
  options?: RouteGeometryOptions,
): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  const groups: Groups = { stripe: [], contrast: [], paint: [] }

  let rawPoints = relativePoints(route)
  if (options?.startCut || options?.endCut) {
    rawPoints = trimPolylineByCuts(rawPoints, options.startCut ?? 0, options.endCut ?? 0)
  }
  const points = rawPoints
  const centre = stripeCentreOffsetM(route.width, route.lineWidth)
  const half = LINE_WIDTHS[route.lineWidth] / 2

  // 1. If laneColor is defined, emit filled planar corridor ribbon geometry at ROUTE_ELEVATIONS.PAINTED_CORRIDOR (+0.002m)
  if (route.laneColor) {
    const leftBoundary = offsetCentreline(points, -(centre + half))
    const rightBoundary = offsetCentreline(points, centre + half)
    let parsedColor: [number, number, number] | undefined
    try {
      const c = new THREE.Color(route.laneColor)
      parsedColor = [c.r, c.g, c.b]
    } catch {
      parsedColor = undefined
    }
    // Winding order: rightBoundary as inner, leftBoundary as outer so face normal is positive Y (+1)
    emitRibbon(
      sink,
      groups.paint,
      rightBoundary,
      leftBoundary,
      ROUTE_ELEVATIONS.PAINTED_CORRIDOR,
      parsedColor,
    )
  }

  // 2. Stratify outer boundary edge stripes at ROUTE_ELEVATIONS.EDGE_STRIPES (+0.008m)
  for (const side of [1, -1]) {
    const near = offsetCentreline(points, side * (centre - half))
    const far = offsetCentreline(points, side * (centre + half))
    /**
     * Aynalanan tarafta kenarlar TAKAS EDİLİR.
     *
     * `pushQuad` sabit bir sarım yazar ve o sarımın yukarı bakması, iki
     * kenarın hangi elle sıralandığına bağlıdır. `side` işareti ofseti
     * aynaladığı için elleri de aynalar: takas olmadan sol şerit saat
     * yönünde sarılır, `side: FrontSide` onu arka yüz sayar ve **her
     * rotanın iki şeridinden biri hiç görünmez.**
     */
    emitRibbon(
      sink,
      groups.stripe,
      side === 1 ? far : near,
      side === 1 ? near : far,
      ROUTE_ELEVATIONS.EDGE_STRIPES,
    )
  }

  // 3. Stratify directional flow arrows and dividers at ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS (+0.012m)
  const gates = markingGates(route)
  if (gates.arrows) emitArrows(sink, groups.contrast, points, ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS)
  if (gates.divider)
    emitDivider(sink, groups.contrast, points, half, ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS)

  sink.indices = [...groups.stripe, ...groups.contrast, ...groups.paint]
  const geometry = finish(sink)
  geometry.clearGroups()
  geometry.addGroup(0, groups.stripe.length, GROUP_STRIPE)
  let offset = groups.stripe.length
  if (groups.contrast.length > 0) {
    geometry.addGroup(offset, groups.contrast.length, GROUP_CONTRAST)
    offset += groups.contrast.length
  }
  if (groups.paint.length > 0) {
    geometry.addGroup(offset, groups.paint.length, GROUP_PAINT)
  }
  return geometry
}

/** Shared pool, not a fourth one. `conveyor/geometry-builder` says why: two
 *  caches would each hold their own copy of the eviction rule and the limit
 *  would mean half what it says. */
export function getRouteGeometry(route: RouteNode): THREE.BufferGeometry {
  return getCachedGeometry(routeGeometryKey(route), () => buildRouteGeometry(route))
}

export function retainRouteGeometry(route: RouteNode): string {
  return retainGeometry(routeGeometryKey(route))
}

export { releaseGeometry as releaseRouteGeometry }
