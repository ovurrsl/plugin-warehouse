import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { frameWidthM, moduleLengthM, supportOffsetsX, usefulWidthM } from './metrics'
import type { ConveyorRollerNode } from './schema'

/**
 * The plan symbol.
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

export function buildConveyorFloorplan(
  node: ConveyorRollerNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const length = moduleLengthM(node)
  const width = frameWidthM(node)
  const lane = usefulWidthM(node)
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
