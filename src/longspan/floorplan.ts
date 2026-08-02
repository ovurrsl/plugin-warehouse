import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { fittedLevels, levelElevation, totalDepth, totalWidth } from './levels'
import { type LongspanPart, longspanParts } from './parts'
import type { LongspanNode } from './schema'

/**
 * The plan symbol, projected from the same part list the 3D model is built
 * from — so "the plan matches the model" is an assertion rather than a hope.
 */

/**
 * Roles worth drawing in plan.
 *
 * **Shelves are in it**, and that is the difference from every other racking
 * kind here. A pallet rack's plan shows frames and beams because the pallets
 * are the payload and are drawn separately; a shelving bay's payload *is* the
 * shelf, and from above a longspan bay is a rectangle of board between two
 * frames. Leaving it out would draw an empty box.
 *
 * Braces are diagonals in vertical planes; footplates hide under the posts;
 * pins and clamps are centimetres across. None add information at the zoom a
 * layout is worked at.
 */
export const PLAN_ROLES: ReadonlySet<LongspanPart['role']> = new Set<LongspanPart['role']>([
  'upright',
  'shelf',
])

export function buildLongspanFloorplan(
  node: LongspanNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const width = totalWidth(node)
  const depth = totalDepth(node)
  const view = ctx.viewState
  const selected = view?.selected ?? false

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#1e40af'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#dbeafe'
  const steelFill = selected ? stroke : '#1e3a8a'
  const shelfFill = selected ? stroke : '#b08a55'

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
   * Only the **topmost** level's panels are drawn.
   *
   * A plan is a view from above, and a four-level bay stacks four identical
   * rectangles in exactly the same place: three are invisible and all four cost
   * a rect. Drawing the top one is both what you would actually see and the
   * cheapest way to say it.
   *
   * A level can carry several panels side by side, so this matches on the
   * surface height rather than taking "the last shelf part" — a picking level
   * of six modules would otherwise draw one of them.
   */
  const levels = fittedLevels(node)
  const top = levels[levels.length - 1]
  const topSurface = top ? levelElevation(top) : null

  // Always full detail, and deliberately without the neighbour flag: in 3D a
  // shared frame must be built once or the posts z-fight, but in plan the two
  // rects are the same rectangle in the same fill — and asking each bay to
  // consult its neighbours to draw a plan would cost a scene scan per symbol
  // per redraw.
  for (const part of longspanParts(node, 'full')) {
    if (!PLAN_ROLES.has(part.role)) continue
    if (part.role === 'shelf') {
      if (topSurface === null) continue
      const surface = part.center[1] + part.size[1] / 2
      if (Math.abs(surface - topSurface) > 1e-6) continue
    }
    const partFill = part.role === 'shelf' ? shelfFill : steelFill
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
