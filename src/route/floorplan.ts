import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { markingGates } from './geometry'
import { routeReading } from './metrics'
import type { RouteNode } from './schema'
import { offsetCentreline, type Point, stripeCentreOffsetM } from './stripes'

/**
 * The plan symbol: the same two stripes, plus the things only a drawing needs.
 *
 * **Plan and 3D are built from one offset function**, so a route that mitres in
 * the model mitres identically on the sheet handed to the marking contractor.
 * The older editor kept three private copies of its offset helper — the
 * renderer's, the floorplan's and the tool's — and they disagreed at corners.
 *
 * Two things appear here that are NOT painted on the floor: the dashed
 * centreline, which is a drawing convention rather than paint, and the clear
 * width dimension. Both are annotations, and neither may leak into the 3D
 * builder.
 */
export function buildRouteFloorplan(
  node: RouteNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  if (node.points.length < 2) return null

  const view = ctx.viewState
  const selected = view?.selected ?? false
  const origin = node.points[0] ?? [0, 0]
  const points: Point[] = node.points.map((p) => [p[0] - origin[0], p[1] - origin[1]])

  const stroke = selected
    ? (view?.palette.selectedStroke ?? '#e69a47')
    : node.role === 'vehicle'
      ? '#a16207'
      : '#166534'
  const paint = node.role === 'vehicle' ? '#f2c31d' : '#2f9e58'

  const centre = stripeCentreOffsetM(node.width, node.lineWidth)
  const children: FloorplanGeometry[] = []

  for (const side of [1, -1]) {
    children.push({
      kind: 'polyline',
      points: offsetCentreline(points, side * centre).map((p) => [p[0], p[1]] as [number, number]),
      stroke: paint,
      strokeWidth: 0.09,
    })
  }

  // The axis, dashed and grey — the drawing's "Aks", never paint.
  children.push({
    kind: 'polyline',
    points: points.map((p) => [p[0], p[1]] as [number, number]),
    stroke: selected ? stroke : '#94a3b8',
    strokeWidth: 0.02,
    strokeDasharray: '0.4 0.3',
  })

  /**
   * A hit target down the corridor.
   *
   * **Table stakes, not polish.** Two stripes with no fill are clickable only
   * on the stripes themselves, and the corridor between them is dead surface —
   * so a route drawn across a hall could not be selected by clicking the thing
   * it obviously is. The `fill: 'transparent'` trick the rack and conveyor both
   * use is unavailable to a kind that has no fill by design.
   */
  children.push({
    kind: 'polyline',
    points: points.map((p) => [p[0], p[1]] as [number, number]),
    stroke: 'transparent',
    strokeWidth: Math.max(node.width, 0.4),
  })

  if (markingGates(node).arrows) {
    for (const arrow of arrowHeads(points)) children.push(arrow)
  }

  if (selected) {
    const reading = routeReading(node)
    const mid = points[Math.floor(points.length / 2)] ?? [0, 0]
    children.push({
      kind: 'text',
      x: mid[0],
      y: mid[1],
      text: `${reading.widthM.toFixed(2)} m`,
      fontSize: 0.32,
      fill: stroke,
      textAnchor: 'middle',
      dominantBaseline: 'middle',
    })
  }

  return {
    kind: 'group',
    transform: {
      translate: [node.position[0], node.position[2]],
      // SVG rotates clockwise with y down while three rotates counter-clockwise
      // about +Y, so the plan angle is the negation. Invisible at 0° and
      // obvious at 90°.
      rotate: -(node.rotation[1] ?? 0),
    },
    children,
  }
}

/** One arrowhead per leg at its midpoint, drawn as a filled triangle. */
function arrowHeads(points: readonly Point[]): FloorplanGeometry[] {
  const heads: FloorplanGeometry[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    if (!from || !to) continue
    const dx = to[0] - from[0]
    const dz = to[1] - from[1]
    const length = Math.hypot(dx, dz)
    if (length < 0.8) continue
    const ux = dx / length
    const uz = dz / length
    const cx = from[0] + dx / 2
    const cz = from[1] + dz / 2
    // Fixed in plan units rather than scaled by width: an arrow that grew with
    // a 6 m aisle would be a shape, not a symbol.
    const size = 0.3
    heads.push({
      kind: 'polygon',
      points: [
        [cx + ux * size, cz + uz * size],
        [cx - ux * size - uz * size * 0.6, cz - uz * size + ux * size * 0.6],
        [cx - ux * size + uz * size * 0.6, cz - uz * size - ux * size * 0.6],
      ],
      fill: '#1e293b',
      stroke: 'transparent',
      strokeWidth: 0,
    })
  }
  return heads
}
