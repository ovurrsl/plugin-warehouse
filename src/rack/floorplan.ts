import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import type { PalletRackNode } from './schema'
import {
  bayCenterX,
  depthPositionZ,
  frameCentersX,
  orientedPalletFootprint,
  rowCount,
  slotOffsetsX,
  totalDepth,
  totalWidth,
} from './slots'

/**
 * The plan symbol: the run outline, every upright frame, and the pallet
 * positions inside each bay.
 *
 * A rack in plan is read for two things — where the steel is and how many
 * positions it holds — so both are drawn rather than a filled rectangle. The
 * positions come from the same `slotOffsetsX` the 3D geometry and the capacity
 * count use, so a bay that reports three pallets always shows three.
 *
 * SVG `rotate()` is clockwise with y pointing down while three.js rotates
 * counter-clockwise about +Y, so the plan rotation negates the node's. Invisible
 * at 0° and obvious at 90°.
 */
export function buildPalletRackFloorplan(
  node: PalletRackNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const width = totalWidth(node)
  const depth = totalDepth(node)
  const view = ctx.viewState
  const selected = view?.selected ?? false

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#1e40af'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#dbeafe'
  const steelStroke = selected ? stroke : '#1e3a8a'
  const palletStroke = selected ? stroke : '#b45309'

  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -width / 2,
      y: -depth / 2,
      width,
      height: depth,
      fill,
      // 'transparent' rather than 'none' — `none` is not paint, so
      // `pointer-events: visiblePainted` never hit-tests it and the rack
      // becomes unselectable in plan.
      stroke,
      strokeWidth: 0.03,
    },
  ]

  const halfPost = node.depth / 2 - node.uprightDepth / 2

  for (let row = 1; row <= rowCount(node); row++) {
    for (let position = 1; position <= node.depthPositions; position++) {
      const centerZ = depthPositionZ(node, row, position)

      // Upright frames, at the same X the 3D builder puts them.
      for (const x of frameCentersX(node)) {
        for (const z of [centerZ + halfPost, centerZ - halfPost]) {
          children.push({
            kind: 'rect',
            x: x - node.uprightWidth / 2,
            y: z - node.uprightDepth / 2,
            width: node.uprightWidth,
            height: node.uprightDepth,
            fill: steelStroke,
            stroke: steelStroke,
            strokeWidth: 0.005,
          })
        }
      }

      // Pallet positions. Drawn outline-only: a plan is read for how the
      // positions divide the bay, and filling them buries the frames under
      // them at the zoom a layout is actually worked at.
      const offsets = slotOffsetsX(node)
      const [alongRun, intoDepth] = orientedPalletFootprint(node)
      for (let bay = 1; bay <= node.bayCount; bay++) {
        const centerX = bayCenterX(node, bay)
        for (const offset of offsets) {
          children.push({
            kind: 'rect',
            x: centerX + offset - alongRun / 2,
            y: centerZ - intoDepth / 2,
            width: alongRun,
            height: intoDepth,
            fill: 'transparent',
            stroke: palletStroke,
            strokeWidth: 0.015,
          })
        }
      }
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
