import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { frameWidthM, laneWidthM, moduleLengthM, supportOffsetsX } from './booster-metrics'
import type { ConveyorBoosterNode } from './booster-schema'

/**
 * The plan symbol: the straight's, plus the badge that says which machine it is.
 *
 * A booster's outline is a short rectangle and so is a short straight's, so the
 * shape alone cannot tell them apart on a drawing — the **chevron pair ahead of
 * the arrow** is what does. It is the catalogue's own convention for a section
 * that regulates a load's passage rather than merely carrying it.
 *
 * Deliberately **not** projected from the parts list, which is the opposite of
 * what the rack does — and the difference is the roller bed. The rack's steel
 * is a few dozen boxes and projecting them is what makes "the plan matches the
 * model" a fact; a conveyor's rollers are not boxes at all, they are a texture,
 * so there is nothing to project. Drawing eighty roller ticks per module would
 * also put sixteen thousand SVG elements in a six-hundred-metre plan, in the
 * view a layout is actually worked in.
 *
 * So the symbol is what a conveyor is on a drawing: the bed as a rectangle, the
 * lane inside it, a tick at each support, and an arrow saying which way goods
 * travel. Eight primitives a module, whatever its length.
 *
 * SVG `rotate()` is clockwise with y pointing down while three.js rotates
 * counter-clockwise about +Y, so the plan rotation negates the node's.
 */

export function buildBoosterFloorplan(
  node: ConveyorBoosterNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const length = moduleLengthM(node)
  const width = frameWidthM(node)
  const lane = laneWidthM(node)
  const view = ctx.viewState
  const selected = view?.selected ?? false

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#1e56a0'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#dbeafe'
  const detail = selected ? stroke : '#64748b'

  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -length / 2,
      y: -width / 2,
      width: length,
      height: width,
      fill,
      // 'transparent' rather than 'none' for the fill on the outlined shapes
      // below — `none` is not paint, so `pointer-events: visiblePainted` never
      // hit-tests it and the module becomes unselectable in plan.
      stroke,
      strokeWidth: 0.03,
    },
  ]

  // The lane: the useful width, which is what a box actually occupies and the
  // figure another conveyor has to match to be joined to this one.
  children.push({
    kind: 'rect',
    x: -length / 2,
    y: -lane / 2,
    width: length,
    height: lane,
    fill: 'transparent',
    stroke: detail,
    strokeWidth: 0.012,
  })

  // A tick across the bed at every support station — where the line is actually
  // held up, and the thing a layout drawing dimensions to.
  for (const x of supportOffsetsX(node)) {
    children.push({
      kind: 'rect',
      x: x - 0.015,
      y: -width / 2,
      width: 0.03,
      height: width,
      fill: detail,
      stroke: detail,
      strokeWidth: 0.004,
    })
  }

  // Direction of travel. A conveyor without one on the plan is a rectangle.
  const sign = node.flow === 'forward' ? 1 : -1
  const head = Math.min(0.28, length / 4)
  children.push({
    kind: 'rect',
    x: -head,
    y: -0.018,
    width: head * 2,
    height: 0.036,
    fill: detail,
    stroke: detail,
    strokeWidth: 0.004,
  })
  children.push({
    kind: 'polygon',
    points: [
      [sign * head * 1.6, 0],
      [sign * head * 0.8, 0.075],
      [sign * head * 0.8, -0.075],
    ],
    fill: detail,
    stroke: detail,
    strokeWidth: 0.004,
  })

  // The acceleration badge: two chevrons ahead of the arrow head, which is what
  // separates this symbol from a short straight's.
  for (const step of [0, 1]) {
    const root = sign * (head * 1.9 + step * 0.09)
    children.push({
      kind: 'polyline',
      points: [
        [root, 0.07],
        [root + sign * 0.07, 0],
        [root, -0.07],
      ],
      fill: 'transparent',
      stroke: detail,
      strokeWidth: 0.026,
    })
  }

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
