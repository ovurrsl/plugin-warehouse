import type * as THREE from 'three'
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
} from './constants'
import type { RouteNode } from './schema'
import { offsetCentreline, type Point, stripeCentreOffsetM } from './stripes'

/**
 * The paint, as one merged buffer.
 *
 * **Two stripes and no fill.** That is what 92/58/EEC Annex V describes, and it
 * is also what the fill-rate arithmetic demands: two thousand lined routes are
 * about one screen of opaque fragments, two thousand filled ones about eight
 * screens of overdraw — and the floor is the largest surface in the building.
 * Opaque with depth writing keeps markings out of the sorted transparent queue
 * the older editor put them in.
 *
 * Everything is emitted flat at local y = 0. The mesh's height comes from the
 * host's floor-placed lift and nothing else, and the paint is kept off the slab
 * by `polygonOffset` rather than by a metric rise — see `./constants`.
 */

/** Which draw group a triangle belongs to, so one buffer serves two colours
 *  without a second draw call per marking. */
const GROUP_STRIPE = 0
const GROUP_CONTRAST = 1

type Groups = { stripe: number[]; contrast: number[] }

function pushVertex(sink: Sink, x: number, z: number, u: number, v: number): number {
  const index = sink.positions.length / 3
  sink.positions.push(x, 0, z)
  sink.normals.push(0, 1, 0)
  // Colour lives in the material, not the buffer: a route's colours are a
  // consequence of its role and are not user-editable, so nothing about them
  // belongs in a geometry key. The conveyor keys its colours because they ARE
  // user fields; this one must not.
  sink.colors.push(1, 1, 1)
  sink.uvs.push(u, v)
  return index
}

/** Two triangles, wound counter-clockwise seen from above so the paint faces
 *  the camera a warehouse is looked at from. */
function pushQuad(sink: Sink, into: number[], a: Point, b: Point, c: Point, d: Point) {
  const ia = pushVertex(sink, a[0], a[1], 0, 0)
  const ib = pushVertex(sink, b[0], b[1], 1, 0)
  const ic = pushVertex(sink, c[0], c[1], 1, 1)
  const id = pushVertex(sink, d[0], d[1], 0, 1)
  into.push(ia, ic, ib, ia, id, ic)
}

/** A ribbon of constant width following a polyline, from its two offset edges. */
function emitRibbon(sink: Sink, into: number[], inner: Point[], outer: Point[]) {
  for (let i = 0; i < inner.length - 1; i++) {
    const a = inner[i]
    const b = outer[i]
    const c = outer[i + 1]
    const d = inner[i + 1]
    if (!a || !b || !c || !d) continue
    pushQuad(sink, into, a, b, c, d)
  }
}

/** Where along a leg the arrows sit, as fractions of its length. */
function arrowFractions(lengthM: number): number[] {
  const count = Math.min(ARROWS_PER_LEG_MAX, 1 + Math.floor(lengthM / ARROW_SPACING_M))
  return Array.from({ length: count }, (_, i) => (i + 0.5) / count)
}

function emitArrows(sink: Sink, into: number[], points: readonly Point[]) {
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

      const tip = pushVertex(sink, tipX, tipZ, 0.5, 1)
      const left = pushVertex(
        sink,
        backX + nx * ARROW_HALF_WIDTH_M,
        backZ + nz * ARROW_HALF_WIDTH_M,
        0,
        0,
      )
      const right = pushVertex(
        sink,
        backX - nx * ARROW_HALF_WIDTH_M,
        backZ - nz * ARROW_HALF_WIDTH_M,
        1,
        0,
      )
      into.push(tip, right, left)
    }
  }
}

function emitDivider(sink: Sink, into: number[], points: readonly Point[], halfWidth: number) {
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
      )
    }
  }
}

/**
 * Whether this route draws arrows, and whether it draws a lane divider.
 *
 * **Derived, and the key names these rather than `role` and `traffic`.** The
 * raw fields reach the mesh only through these two gates, so listing them raw
 * would split the cache on a change that moves no vertex — the conveyor's own
 * `legHeight + hasCrossbar, not raw transportHeight` reasoning. The good
 * consequence: a 12 m walkway and a 12 m one-way vehicle aisle of the same
 * width are byte-identical and share one buffer.
 */
export function markingGates(route: RouteNode): { arrows: boolean; divider: boolean } {
  return {
    arrows: route.traffic === 'one-way',
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
    route.points.length,
    digest,
  ].join('|')
}

export function buildRouteGeometry(route: RouteNode): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  const groups: Groups = { stripe: [], contrast: [] }

  const points = relativePoints(route)
  const centre = stripeCentreOffsetM(route.width, route.lineWidth)
  const half = LINE_WIDTHS[route.lineWidth] / 2

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
     *
     * Normal attribute'u bunu yakalayamaz — o elle `(0,1,0)` yazılıyor ve
     * culling kararı sarımdan verilir, normalden değil. `geometry.test.ts`
     * artık sarımı ayrıca ölçüyor.
     */
    emitRibbon(sink, groups.stripe, side === 1 ? far : near, side === 1 ? near : far)
  }

  const gates = markingGates(route)
  if (gates.arrows) emitArrows(sink, groups.contrast, points)
  if (gates.divider) emitDivider(sink, groups.contrast, points, half)

  sink.indices = [...groups.stripe, ...groups.contrast]
  const geometry = finish(sink)
  geometry.clearGroups()
  geometry.addGroup(0, groups.stripe.length, GROUP_STRIPE)
  if (groups.contrast.length > 0) {
    geometry.addGroup(groups.stripe.length, groups.contrast.length, GROUP_CONTRAST)
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
