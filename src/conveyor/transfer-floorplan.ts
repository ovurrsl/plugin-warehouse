import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { PALETTE } from './constants'
import {
  dischargeSign,
  frameWidthM,
  moduleLengthM,
  stripOffsetsX,
  stripSpanM,
} from './transfer-metrics'
import type { ConveyorTransferNode } from './transfer-schema'

/**
 * The plan symbol: a square body with **two arrows that cross**.
 *
 * The catalogue's own convention for a transfer, and it has to be two: the whole
 * machine is a box arriving one way and leaving another, so a single arrow would
 * describe a straight of an odd size. The cross arrow is drawn in the transfer
 * accent and stops at the discharge edge, which is the one thing a person laying
 * out a circuit needs to read off this symbol.
 *
 * The strips are drawn too, because they are what a fitter recognises the
 * machine by on a drawing — and because their span is the difference between
 * the symmetric and the asymmetric build, which is otherwise invisible in plan.
 *
 * SVG `rotate()` is clockwise with y pointing down while three.js rotates
 * counter-clockwise about +Y, so the plan rotation negates the node's.
 */
export function buildTransferFloorplan(
  node: ConveyorTransferNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const view = ctx.viewState
  const selected = view?.selected ?? false

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#1e56a0'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#dbeafe'
  const detail = selected ? stroke : '#64748b'
  const accent = selected ? stroke : PALETTE.accentOrange

  const length = moduleLengthM(node)
  const width = frameWidthM(node)
  const side = dischargeSign(node)
  const span = stripSpanM(node)

  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -length / 2,
      y: -width / 2,
      width: length,
      height: width,
      fill,
      // 'transparent' rather than 'none' on the outlined shapes below — `none`
      // is not paint, so `pointer-events: visiblePainted` never hit-tests it and
      // the module becomes unselectable in plan.
      stroke,
      strokeWidth: 0.03,
    },
  ]

  // The strips, in the accent. Their span is what separates the symmetric build
  // from the asymmetric one, and nothing else in plan shows it.
  for (const x of stripOffsetsX(node)) {
    children.push({
      kind: 'rect',
      x: x - 0.02,
      y: side > 0 ? width / 2 - span : -width / 2,
      width: 0.04,
      height: span,
      fill: accent,
      stroke: accent,
      strokeWidth: 0.004,
    })
  }

  // The roller line, straight through.
  const along = node.flow === 'forward' ? 1 : -1
  const head = Math.min(0.24, length / 4)
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
      [along * head * 1.7, 0],
      [along * head * 0.9, 0.07],
      [along * head * 0.9, -0.07],
    ],
    fill: detail,
    stroke: detail,
    strokeWidth: 0.004,
  })

  // The cross discharge, in the accent, stopping at the edge it leaves by.
  const tip = side * (width / 2 - 0.04)
  children.push({
    kind: 'line',
    x1: 0,
    y1: -tip * 0.55,
    x2: 0,
    y2: tip * 0.55,
    stroke: accent,
    strokeWidth: 0.036,
  })
  children.push({
    kind: 'polygon',
    points: [
      [0, tip],
      [0.07, tip - side * 0.08],
      [-0.07, tip - side * 0.08],
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
