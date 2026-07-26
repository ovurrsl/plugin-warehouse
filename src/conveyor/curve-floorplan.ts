import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import {
  angleRad,
  arcPointLocal,
  channelRadiiM,
  outerRadiusM,
  supportAngles,
} from './curve-metrics'
import type { ConveyorCurveNode } from './curve-schema'

/**
 * The plan symbol for a bend.
 *
 * An **SVG arc, not a polygon fan.** The host's `FloorplanGeometry` has a `path`
 * variant taking a `d` string, so an annular sector is five commands and is
 * exact at every zoom — where an approximation would show its facets the moment
 * a user zoomed in on the corner they are laying out, which is precisely when
 * they are looking at it.
 *
 * Same budget as a straight's symbol: the sector, the lane inside it, a tick at
 * each support, and an arrow saying which way goods travel.
 *
 * SVG `rotate()` is clockwise with y pointing down while three.js rotates
 * counter-clockwise about +Y, so the plan rotation negates the node's — and the
 * sweep flag follows the hand of the bend for the same reason.
 */

/** Plan point from a local one. Plan y *is* local z; the group transform
 *  handles the rest. */
const point = (curve: ConveyorCurveNode, radius: number, theta: number): [number, number] =>
  arcPointLocal(curve, radius, theta)

/**
 * An annular sector: out along the arc at the outer radius, in, back at the
 * inner radius, close.
 *
 * The sweep flag is the hand. A left bend's plan angle *decreases* as the arc is
 * traced, a right bend's increases, and SVG's flag names the increasing
 * direction — so getting it from `handed` rather than guessing is what stops
 * half of all bends drawing as the complementary sector.
 */
function sectorPath(curve: ConveyorCurveNode, inner: number, outer: number): string {
  const sweep = angleRad(curve)
  const large = sweep > Math.PI ? 1 : 0
  const forward = curve.handed === 'left' ? 0 : 1
  const [ox0, oy0] = point(curve, outer, 0)
  const [ox1, oy1] = point(curve, outer, sweep)
  const [ix1, iy1] = point(curve, inner, sweep)
  const [ix0, iy0] = point(curve, inner, 0)

  return [
    `M ${ox0} ${oy0}`,
    `A ${outer} ${outer} 0 ${large} ${forward} ${ox1} ${oy1}`,
    `L ${ix1} ${iy1}`,
    `A ${inner} ${inner} 0 ${large} ${1 - forward} ${ix0} ${iy0}`,
    'Z',
  ].join(' ')
}

export function buildCurveFloorplan(
  node: ConveyorCurveNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const view = ctx.viewState
  const selected = view?.selected ?? false

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#1e56a0'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#dbeafe'
  const detail = selected ? stroke : '#64748b'

  const outer = outerRadiusM(node)
  const [laneInner, laneOuter] = channelRadiiM(node)

  const children: FloorplanGeometry[] = [
    {
      kind: 'path',
      d: sectorPath(node, node.innerRadius, outer),
      fill,
      // 'transparent' rather than 'none' on the outlined shapes below — `none`
      // is not paint, so `pointer-events: visiblePainted` never hit-tests it and
      // the module becomes unselectable in plan.
      stroke,
      strokeWidth: 0.03,
    },
    {
      kind: 'path',
      d: sectorPath(node, laneInner, laneOuter),
      fill: 'transparent',
      stroke: detail,
      strokeWidth: 0.012,
    },
  ]

  // A radial tick at every support station — where the bend is actually held
  // up, and the thing a layout drawing dimensions to.
  for (const theta of supportAngles(node)) {
    const [x1, y1] = point(node, node.innerRadius, theta)
    const [x2, y2] = point(node, outer, theta)
    children.push({ kind: 'line', x1, y1, x2, y2, stroke: detail, strokeWidth: 0.03 })
  }

  // Direction of travel, tangent at the middle of the bend. A conveyor without
  // one on the plan is a shape.
  const sweep = angleRad(node)
  const mid = sweep / 2
  const centre = (laneInner + laneOuter) / 2
  const reach = Math.min(0.3, (sweep * centre) / 4)
  const along = node.flow === 'forward' ? 1 : -1
  const [tipX, tipY] = point(node, centre, mid + (along * reach) / centre)
  const [tailX, tailY] = point(node, centre, mid - (along * reach) / centre)
  const [wingInnerX, wingInnerY] = point(node, centre - 0.075, mid + (along * reach * 0.4) / centre)
  const [wingOuterX, wingOuterY] = point(node, centre + 0.075, mid + (along * reach * 0.4) / centre)

  children.push({
    kind: 'line',
    x1: tailX,
    y1: tailY,
    x2: tipX,
    y2: tipY,
    stroke: detail,
    strokeWidth: 0.036,
  })
  children.push({
    kind: 'polygon',
    points: [
      [tipX, tipY],
      [wingInnerX, wingInnerY],
      [wingOuterX, wingOuterY],
    ],
    fill: detail,
    stroke: detail,
    strokeWidth: 0.004,
  })

  const rotation = Array.isArray(node.rotation) ? (node.rotation[1] ?? 0) : 0

  return {
    kind: 'group',
    children,
    transform: {
      translate: [node.position?.[0] ?? 0, node.position?.[2] ?? 0],
      rotate: -rotation,
    },
  }
}
