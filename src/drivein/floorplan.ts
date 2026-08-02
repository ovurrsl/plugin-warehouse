import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { orientedPalletFootprint, slotZ, storageLevels, totalDepth, totalWidth } from './lanes'
import { type DriveInPart, driveInParts } from './parts'
import type { DriveInRackNode } from './schema'

/**
 * The plan symbol, projected from the same part list the 3D model is built
 * from.
 *
 * That is the point of it: "the plan matches the model" is only a fact if there
 * is one description of where the steel is. `floorplan.test.ts` asserts every
 * rect drawn here sits where its 3D box does.
 *
 * SVG `rotate()` is clockwise with y pointing down while three.js rotates
 * counter-clockwise about +Y, so the plan rotation negates the node's.
 * Invisible at 0° and obvious at 90°.
 */

/**
 * Roles worth drawing in plan.
 *
 * **Rails are in it, and that is the difference from the selective rack.** Two
 * thin galvanised strips running the full depth *are* the plan signature of a
 * drive-in lane — without them the symbol is a row of posts and a rectangle,
 * indistinguishable from a deep selective bay. Guides join them for the same
 * reason: they are floor-level steel a layout has to route around.
 *
 * Braces are diagonals in a vertical plane, so from above they are lines the
 * posts already cover; footplates hide under them; the top beam is six metres
 * up and adds nothing to a floor plan.
 */
export const PLAN_ROLES: ReadonlySet<DriveInPart['role']> = new Set<DriveInPart['role']>([
  'upright',
  'rail',
  'guide',
])

export function buildDriveInFloorplan(
  node: DriveInRackNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const width = totalWidth(node)
  const depth = totalDepth(node)
  const view = ctx.viewState
  const selected = view?.selected ?? false

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#1e40af'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#dbeafe'
  const palletStroke = selected ? stroke : '#b45309'
  const steelFill = selected ? stroke : '#1e3a8a'
  const railFill = selected ? stroke : '#8b9299'

  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -width / 2,
      y: -depth / 2,
      width,
      height: depth,
      fill,
      // 'transparent' rather than 'none' — `none` is not paint, so
      // `pointer-events: visiblePainted` never hit-tests it and the lane
      // becomes unselectable in plan.
      stroke,
      strokeWidth: 0.03,
    },
  ]

  // Steel, straight off the 3D part list. Always full detail: the plan shows
  // the frames whatever tier the 3D viewport happens to be drawing.
  //
  // Deliberately without the neighbour flag. In 3D a shared frame line must be
  // built once or the posts z-fight; in plan the two rects are the same
  // rectangle in the same fill, so a block reads as N+1 lines either way — and
  // asking each lane to consult its neighbours to draw a plan would cost a
  // scene scan per symbol per redraw.
  for (const part of driveInParts(node, 'full')) {
    if (!PLAN_ROLES.has(part.role)) continue
    const partFill = part.role === 'upright' ? steelFill : railFill
    children.push({
      kind: 'rect',
      x: part.center[0] - part.size[0] / 2,
      y: part.center[2] - part.size[2] / 2,
      width: part.size[0],
      height: part.size[2],
      fill: partFill,
      stroke: partFill,
      strokeWidth: 0.004,
    })
  }

  // Pallet positions: one column, `palletsDeep` of them down the lane.
  // Outline-only, because a plan is read for how the depth divides and filling
  // them buries the rails at the zoom a layout is actually worked at.
  if (storageLevels(node).length > 0) {
    const [acrossLane, intoDepth] = orientedPalletFootprint(node)
    for (let depthPosition = 1; depthPosition <= node.palletsDeep; depthPosition++) {
      children.push({
        kind: 'rect',
        x: -acrossLane / 2,
        y: slotZ(node, depthPosition) - intoDepth / 2,
        width: acrossLane,
        height: intoDepth,
        fill: 'transparent',
        stroke: palletStroke,
        strokeWidth: 0.015,
      })
    }
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
