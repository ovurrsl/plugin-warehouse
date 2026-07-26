import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { LNC } from './catalog'
import { PALETTE } from './constants'
import {
  frameWidthM,
  laneWidthM,
  lateralOuterZM,
  launchSign,
  moduleLengthM,
  supportOffsetsX,
} from './launcher-metrics'
import type { ConveyorLauncherNode } from './launcher-schema'

/**
 * The plan symbol: a body, an arm, and two arrows that cross.
 *
 * **The second arrow is the whole symbol.** A launcher drawn as a rectangle with
 * one arrow is a straight, and the thing a person is reading a layout for at
 * this spot is precisely where the line branches — so the lateral discharge gets
 * its own arrow, in the transfer accent rather than the frame blue, pointing out
 * of the side the box actually leaves by.
 *
 * SVG `rotate()` is clockwise with y pointing down while three.js rotates
 * counter-clockwise about +Y, so the plan rotation negates the node's.
 */
export function buildLauncherFloorplan(
  node: ConveyorLauncherNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const view = ctx.viewState
  const selected = view?.selected ?? false

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#1e56a0'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#dbeafe'
  const detail = selected ? stroke : '#64748b'
  const accent = selected ? stroke : PALETTE.accentOrange

  const length = moduleLengthM(node)
  const frame = frameWidthM(node)
  const lane = laneWidthM(node)
  const side = launchSign(node)
  const outerZ = lateralOuterZM(node)

  const children: FloorplanGeometry[] = [
    // The arm first, so the body's outline draws over the seam between them.
    {
      kind: 'rect',
      x: -LNC.boxLengthM / 2,
      y: side > 0 ? frame / 2 : -outerZ,
      width: LNC.boxLengthM,
      height: outerZ - frame / 2,
      fill,
      stroke,
      strokeWidth: 0.03,
    },
    {
      kind: 'rect',
      x: -length / 2,
      y: -frame / 2,
      width: length,
      height: frame,
      fill,
      // 'transparent' rather than 'none' on the outlined shapes below — `none`
      // is not paint, so `pointer-events: visiblePainted` never hit-tests it and
      // the module becomes unselectable in plan.
      stroke,
      strokeWidth: 0.03,
    },
    {
      kind: 'rect',
      x: -length / 2,
      y: -lane / 2,
      width: length,
      height: lane,
      fill: 'transparent',
      stroke: detail,
      strokeWidth: 0.012,
    },
  ]

  // A tick across the bed at every support station.
  for (const x of supportOffsetsX(node)) {
    children.push({
      kind: 'line',
      x1: x,
      y1: -frame / 2,
      x2: x,
      y2: frame / 2,
      stroke: detail,
      strokeWidth: 0.03,
    })
  }

  // The main line's direction of travel.
  const along = node.flow === 'forward' ? 1 : -1
  const head = Math.min(0.28, length / 4)
  children.push({
    kind: 'line',
    x1: -along * head,
    y1: 0,
    x2: along * head,
    y2: 0,
    stroke: detail,
    strokeWidth: 0.036,
  })
  children.push({
    kind: 'polygon',
    points: [
      [along * head * 1.6, 0],
      [along * head * 0.8, 0.075],
      [along * head * 0.8, -0.075],
    ],
    fill: detail,
    stroke: detail,
    strokeWidth: 0.004,
  })

  // The launch, in the transfer accent so it reads as a branch rather than as a
  // second run.
  const tip = side * (outerZ - 0.05)
  children.push({
    kind: 'line',
    x1: 0,
    y1: 0,
    x2: 0,
    y2: tip,
    stroke: accent,
    strokeWidth: 0.036,
  })
  children.push({
    kind: 'polygon',
    points: [
      [0, side * outerZ],
      [0.075, tip],
      [-0.075, tip],
    ],
    fill: accent,
    stroke: accent,
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
