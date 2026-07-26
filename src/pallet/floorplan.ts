import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { loadHeightOf } from './cargo-types'
import { specOf } from './presets'
import type { PalletNode } from './schema'

const CHAMFER = 0.015

/**
 * The plan symbol: a chamfered octagon matching the 3D silhouette, with the
 * deck boards drawn across it.
 *
 * Two things the earlier version got wrong are fixed here. It hard-coded hex
 * colours, so the symbol ignored the host's theme and stayed light-mode orange
 * on a dark plan; selection chrome now comes from `ctx.viewState.palette`. And
 * its board bands were full-length rectangles over a chamfered outline, so four
 * little square nubs poked past the bevelled corners — the bands are inset now.
 *
 * SVG `rotate()` is clockwise with y pointing down while three.js rotates
 * counter-clockwise about +Y, so the plan rotation is the negation of the
 * node's. Getting this wrong is invisible at 0° and obvious at 90°.
 */
export function buildPalletFloorplan(
  node: PalletNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const spec = specOf(node.preset)
  const halfL = spec.length / 2
  const halfW = spec.width / 2
  const view = ctx.viewState
  const selected = view?.selected ?? false

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#b45309'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#fde8c8'
  const boardStroke = selected ? stroke : '#8c4a18'

  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points: chamferedOutline(halfL, halfW),
      fill,
      // 'transparent' rather than 'none': `none` is not paint, so
      // `pointer-events: visiblePainted` never hit-tests it and the pallet
      // becomes unselectable in plan.
      stroke,
      strokeWidth: 0.02,
      strokeLinejoin: 'round',
    },
  ]

  // Top deck boards, at the same Z centres the 3D builder uses. The earlier
  // version placed the inner pair at ±0.165 against the model's ±0.16375 —
  // 1.25 mm, invisible, but there is no reason for the two to disagree.
  for (const board of deckBands(spec.length, spec.width)) {
    children.push({
      kind: 'rect',
      x: -halfL + CHAMFER,
      y: board.z - board.width / 2,
      width: spec.length - CHAMFER * 2,
      height: board.width,
      fill: 'transparent',
      stroke: boardStroke,
      strokeWidth: 0.012,
    })
  }

  if (loadHeightOf(node) > 0) {
    // Stretch-wrap outline, so a loaded position reads differently from an
    // empty one at a glance.
    children.push({
      kind: 'rect',
      x: -halfL - 0.005,
      y: -halfW - 0.005,
      width: spec.length + 0.01,
      height: spec.width + 0.01,
      fill: 'transparent',
      stroke: '#94a3b8',
      strokeWidth: 0.01,
      strokeDasharray: '0.04,0.02',
    })
  }

  if (selected) {
    children.push({ kind: 'move-handle', point: [0, 0] })
  }

  const [x, , z] = node.position ?? [0, 0, 0]
  return {
    kind: 'group',
    children,
    transform: { translate: [x, z], rotate: -(node.rotation?.[1] ?? 0) },
  }
}

/** A rectangle with all four corners cut at 45°, matching the 3D chamfer. */
function chamferedOutline(halfL: number, halfW: number): [number, number][] {
  const c = CHAMFER
  return [
    [-halfL + c, -halfW],
    [halfL - c, -halfW],
    [halfL, -halfW + c],
    [halfL, halfW - c],
    [halfL - c, halfW],
    [-halfL + c, halfW],
    [-halfL, halfW - c],
    [-halfL, -halfW + c],
  ]
}

/**
 * Deck board centres and widths, scaled from the EPAL 1 layout so a preset with
 * a different footprint still reads as the same construction.
 */
function deckBands(length: number, width: number): { z: number; width: number }[] {
  const scale = width / 0.8
  void length
  return [
    { z: -0.3275 * scale, width: 0.145 * scale },
    { z: -0.16375 * scale, width: 0.1 * scale },
    { z: 0, width: 0.145 * scale },
    { z: 0.16375 * scale, width: 0.1 * scale },
    { z: 0.3275 * scale, width: 0.145 * scale },
  ]
}
