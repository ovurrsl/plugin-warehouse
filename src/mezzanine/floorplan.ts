import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import {
  footprintDepthM,
  footprintWidthM,
  gridColumnPositions,
  resolveColumnProfile,
} from './metrics'
import type { MezzanineNode } from './schema'

/**
 * Plan sembolü — rack'ın deseni: taban dikdörtgeni + kolon kareleri.
 * Merdiven/kapı/korkuluk sembolleri (`'polygon'`/`'dimension-label'`) Faz 3'ün
 * konusu; şimdilik yalnız `'rect'`+`'group'`.
 */
export function buildMezzanineFloorplan(
  node: MezzanineNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const width = footprintWidthM(node)
  const depth = footprintDepthM(node)
  const view = ctx.viewState
  const selected = view?.selected ?? false

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#004f7c'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#dbeafe'
  const columnFill = selected ? stroke : '#003a5c'

  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -width / 2,
      y: -depth / 2,
      width,
      height: depth,
      // 'transparent' değil 'none': `none` boya değil, pointer-events onu
      // hiç görmez — rack'ın kaydettiği ders.
      fill,
      stroke,
      strokeWidth: 0.03,
    },
  ]

  const profile = resolveColumnProfile(node)
  const columnSide = Math.max(profile.h, profile.b)
  for (const point of gridColumnPositions(node)) {
    children.push({
      kind: 'rect',
      x: point.x - columnSide / 2,
      y: point.z - columnSide / 2,
      width: columnSide,
      height: columnSide,
      fill: columnFill,
      stroke: columnFill,
      strokeWidth: 0.004,
    })
    if (node.columnType === 'double') {
      children.push({
        kind: 'rect',
        x: point.x - columnSide / 2,
        y: point.z + profile.b - columnSide / 2,
        width: columnSide,
        height: columnSide,
        fill: columnFill,
        stroke: columnFill,
        strokeWidth: 0.004,
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
