import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { PALETTE } from './constants'
import {
  branchCentreLocal,
  branchEndLocal,
  branchHeadingRad,
  branchLengthM,
  branchSign,
  branchWidthM,
  divergeXM,
  mainWidthM,
  moduleLengthM,
} from './oblique-metrics'
import type { ConveyorObliqueNode } from './oblique-schema'

/**
 * The plan symbol: a Y, with a diamond at the decision.
 *
 * The branch is drawn as a rotated rectangle inside a nested group, which is
 * what the host's recursive `group.transform` is for — `rect` itself carries no
 * rotation, and a polygon would lose the outline's crispness at zoom.
 *
 * **The diamond is not decoration.** Circuit rule R10 says every divert branch
 * needs a decision point behind it — a barcode read that chooses which way the
 * box goes — and there is no such node in this package yet. Drawing the symbol
 * is what a layout drawing does with a rule its model cannot enforce: it says
 * where the thing has to be, so the omission is visible rather than silent.
 */
export function buildObliqueFloorplan(
  node: ConveyorObliqueNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const view = ctx.viewState
  const selected = view?.selected ?? false

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#1e56a0'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#dbeafe'
  const detail = selected ? stroke : '#64748b'
  const accent = selected ? stroke : PALETTE.accentOrange

  const length = moduleLengthM(node)
  const mainWidth = mainWidthM(node)
  const branchWidth = branchWidthM(node)
  const branchLength = branchLengthM(node)
  const [branchX, branchZ] = branchCentreLocal(node)
  const diverge = divergeXM(node)
  const side = branchSign(node)

  const children: FloorplanGeometry[] = [
    // The branch first, so the main line's outline draws over the seam.
    {
      kind: 'group',
      // A nested transform, because `rect` has no rotation of its own — and the
      // registry layer maps `group` recursively in both the static and the
      // interactive renderer.
      //
      // **Radians**, like the group above it and like every other `rotate` in
      // this package: the host multiplies by 180/PI itself when it emits the SVG
      // (`floorplan-pdfkit-renderer.ts:169`). Handing it degrees turned the
      // branch through fifty-seven times its own angle and drew it on the wrong
      // side of the main line.
      transform: { translate: [branchX, branchZ], rotate: -branchHeadingRad(node) },
      children: [
        {
          kind: 'rect',
          x: -branchLength / 2,
          y: -branchWidth / 2,
          width: branchLength,
          height: branchWidth,
          fill,
          stroke,
          strokeWidth: 0.03,
        },
      ],
    },
    {
      kind: 'rect',
      x: -length / 2,
      y: -mainWidth / 2,
      width: length,
      height: mainWidth,
      fill,
      // 'transparent' rather than 'none' on the outlined shapes below — `none`
      // is not paint, so `pointer-events: visiblePainted` never hit-tests it and
      // the module becomes unselectable in plan.
      stroke,
      strokeWidth: 0.03,
    },
  ]

  // The main line's direction of travel.
  const along = node.flow === 'forward' ? 1 : -1
  const head = 0.26
  children.push({
    kind: 'line',
    x1: -length / 2 + 0.15,
    y1: 0,
    x2: -length / 2 + 0.15 + along * head,
    y2: 0,
    stroke: detail,
    strokeWidth: 0.036,
  })
  children.push({
    kind: 'polygon',
    points: [
      [-length / 2 + 0.15 + along * head * 1.6, 0],
      [-length / 2 + 0.15 + along * head * 0.8, 0.07],
      [-length / 2 + 0.15 + along * head * 0.8, -0.07],
    ],
    fill: detail,
    stroke: detail,
    strokeWidth: 0.004,
  })

  // The branch, in the transfer accent, from the divergence to its own end.
  const [endX, endZ] = branchEndLocal(node)
  children.push({
    kind: 'line',
    x1: diverge,
    y1: 0,
    x2: endX,
    y2: endZ,
    stroke: accent,
    strokeWidth: 0.036,
  })
  children.push({
    kind: 'polygon',
    points: [
      [endX, endZ],
      [endX - 0.11, endZ - side * 0.02],
      [endX - 0.06, endZ - side * 0.12],
    ],
    fill: accent,
    stroke: accent,
    strokeWidth: 0.004,
  })

  // The decision point, at the divergence. R10: a divert branch needs a barcode
  // read behind it, and there is no node for one yet — so the drawing says where
  // it has to go.
  if (node.branchMode !== 'merge') {
    const size = 0.09
    children.push({
      kind: 'polygon',
      points: [
        [diverge, size],
        [diverge + size, 0],
        [diverge, -size],
        [diverge - size, 0],
      ],
      fill: 'transparent',
      stroke: accent,
      strokeWidth: 0.024,
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
