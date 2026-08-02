import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import { doorHeight, fittedLevels, levelElevation, totalDepth, totalWidth } from './bays'
import { type M3Part, m3Parts } from './parts'
import type { M3ShelvingNode } from './schema'
import { DOOR_LEAVES } from './standards'

/**
 * The plan symbol, projected from the same part list the 3D model is built
 * from — so "the plan matches the model" is an assertion rather than a hope.
 *
 * Plan coordinates are (local X, local Z), so **+y in the plan is the picking
 * face** and the back panel draws at the bottom of the symbol.
 */

/**
 * Roles worth drawing in plan.
 *
 * Shelves and drawers are in it: a shelving bay's payload *is* the shelf, and
 * from above a picking bay is a rectangle of panel between two frames — or, on
 * a drawer level, a row of cells, which is the one thing a picking layout is
 * read for. Braces are diagonals in vertical planes, footplates hide under the
 * posts, dividers are millimetres across. None add information at the zoom a
 * layout is worked at.
 */
export const PLAN_ROLES: ReadonlySet<M3Part['role']> = new Set<M3Part['role']>([
  'upright',
  'shelf',
  'drawer',
  'back-panel',
])

/** Points along a quarter turn, written out rather than left to an SVG arc
 *  flag: the plan's y axis is the model's Z and the panel applies its own
 *  transform, so which sweep flag reads as "outwards" is not knowable here. */
const SWING_STEPS = 6

export function buildM3Floorplan(
  node: M3ShelvingNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const width = totalWidth(node)
  const depth = totalDepth(node)
  const view = ctx.viewState
  const selected = view?.selected ?? false

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#4b6b8a'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#e2e8ef'
  const steelFill = selected ? stroke : '#3d5a75'
  const shelfFill = selected ? stroke : '#c5c7c4'
  const drawerFill = selected ? stroke : '#2a6fb0'
  const panelFill = selected ? stroke : '#9aa3ab'

  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -width / 2,
      y: -depth / 2,
      width,
      height: depth,
      fill,
      // 'transparent' rather than 'none' — `none` is not paint, so
      // `pointer-events: visiblePainted` never hit-tests it and the bay
      // becomes unselectable in plan.
      stroke,
      strokeWidth: 0.03,
    },
  ]

  /**
   * Only the **topmost** level's surface is drawn.
   *
   * A plan is a view from above, and a four-level bay stacks four identical
   * rectangles in exactly the same place: three are invisible and all four cost
   * a rect. Drawing the top one is both what you would actually see and the
   * cheapest way to say it. Matching on the surface height rather than on "the
   * last shelf part" is what makes a ten-drawer level draw ten cells instead of
   * one.
   */
  const levels = fittedLevels(node)
  const top = levels[levels.length - 1]
  const topSurface = top ? levelElevation(top) : null
  const topIsDrawers = top?.structure === 'drawers'

  for (const part of m3Parts(node, 'full')) {
    if (!PLAN_ROLES.has(part.role)) continue

    if (part.role === 'shelf') {
      if (topSurface === null) continue
      // A drawer level's own panel is under the drawers; drawing both would
      // hide the cells that are the point of the symbol.
      if (topIsDrawers) continue
      const surface = part.center[1] + part.size[1] / 2
      if (Math.abs(surface - topSurface) > 1e-6) continue
    }

    if (part.role === 'drawer') {
      if (topSurface === null || !topIsDrawers) continue
      const seat = part.center[1] - part.size[1] / 2
      if (Math.abs(seat - topSurface) > 1e-6) continue
    }

    const partFill =
      part.role === 'upright'
        ? steelFill
        : part.role === 'drawer'
          ? drawerFill
          : part.role === 'back-panel'
            ? panelFill
            : shelfFill

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

  // CATALOG: the door is two leaves. The swing is what a layout needs from a
  // plan — it is the clearance a picker has to stand outside.
  if (doorHeight(node) !== null) {
    const leafWidth = node.shelfLength / DOOR_LEAVES
    const face = depth / 2
    for (let leaf = 0; leaf < DOOR_LEAVES; leaf++) {
      // Each leaf hinges on the outer end of its own half and opens outwards,
      // which is how a two-leaf cabinet door actually swings.
      const outward = leaf === 0 ? -1 : 1
      const hingeX = outward * (node.shelfLength / 2)
      const points: FloorplanPoint[] = []
      for (let step = 0; step <= SWING_STEPS; step++) {
        const angle = (Math.PI / 2) * (step / SWING_STEPS)
        points.push([
          hingeX - outward * leafWidth * Math.cos(angle),
          face + leafWidth * Math.sin(angle),
        ])
      }
      children.push({
        kind: 'polyline',
        points,
        fill: 'transparent',
        stroke,
        strokeWidth: 0.012,
        strokeDasharray: '0.06 0.04',
      })
      // The leaf itself, fully open — the arc alone reads as a stray curve.
      children.push({
        kind: 'polyline',
        points: [
          [hingeX, face],
          [hingeX, face + leafWidth],
        ],
        fill: 'transparent',
        stroke,
        strokeWidth: 0.02,
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
