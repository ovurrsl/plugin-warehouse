import type { AnyNode, AnyNodeId, FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { lengthLabel, unitOf } from '../units'
import { resolveLift } from './levels'
import {
  doorFaceZ,
  doorWidthM,
  mastPositionsXZ,
  mastSectionM,
  platformDepthM,
  platformWidthM,
} from './metrics'
import type { PalletLiftNode } from './schema'

/**
 * Plan sembolü — platform ayak izi dikdörtgeni, mast noktaları, ön (kapı)
 * kenarında bir açıklık işareti, ve seçiliyken mast yüksekliği + durak sayısını
 * yazan bir etiket.
 *
 * Duraklar 2D üstten görünümde AYNI XZ'ye düşer (kotları görünmez), o yüzden
 * "durak başına kapı işareti" plan üzerinde tek bir ön-kenar açıklığıdır;
 * sayıları etikete yazılır. Kot çözümü için katları `ctx.resolve` üzerinden
 * kısmi bir düğüm haritasında topluyoruz — floorplan tam sahne haritası almıyor.
 */
export function buildPalletLiftFloorplan(
  node: PalletLiftNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const pw = platformWidthM(node)
  const pd = platformDepthM(node)
  const view = ctx.viewState
  const selected = view?.selected ?? false
  const unit = unitOf(view)

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#383e42'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#dfe4e9'

  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -pw / 2,
      y: -pd / 2,
      width: pw,
      height: pd,
      fill,
      stroke,
      strokeWidth: 0.03,
    },
  ]

  // Mast noktaları — kolonların ayak izi.
  const s = mastSectionM(node)
  for (const [x, z] of mastPositionsXZ(node)) {
    children.push({
      kind: 'rect',
      x: x - s / 2,
      y: z - s / 2,
      width: s,
      height: s,
      fill: stroke,
      stroke: 'none',
      strokeWidth: 0,
    })
  }

  // Kapı açıklığı — ön (−Z) kenarda kalın bir çizgi.
  if (node.hasDoors) {
    const faceZ = doorFaceZ(node)
    const width = doorWidthM(node)
    children.push({
      kind: 'line',
      x1: -width / 2,
      y1: faceZ,
      x2: width / 2,
      y2: faceZ,
      stroke: node.doorColor,
      strokeWidth: 0.06,
    })
  }

  if (selected) {
    const resolved = resolveStops(node, ctx)
    children.push({
      kind: 'text',
      x: 0,
      y: 0,
      text: `${resolved.stops.length} durak · mast ${lengthLabel(resolved.mastHeight, unit, 2)}`,
      fill: stroke,
      fontSize: Math.min(0.2, pd * 0.22),
      textAnchor: 'middle',
    })
  }

  return { kind: 'group', children }
}

/**
 * Kotları çözmek için kısmi bir düğüm haritası kurar: asansörün oturduğu kat
 * (`ctx.parent`), o katın binası ve binanın bütün katları. `resolveLift`
 * `Object.values(nodes)` taradığı için bu alt küme ona yeter.
 */
function resolveStops(node: PalletLiftNode, ctx: GeometryContext) {
  const nodes: Record<string, unknown> = { [node.id]: node }
  const level = ctx.parent as (AnyNode & { id: string; parentId?: string }) | null
  if (level && typeof level.id === 'string') {
    nodes[level.id] = level
    const buildingId = typeof level.parentId === 'string' ? level.parentId : null
    const building = buildingId
      ? (ctx.resolve(buildingId as AnyNodeId) as (AnyNode & { children?: unknown }) | undefined)
      : undefined
    if (building && typeof (building as { id?: unknown }).id === 'string') {
      nodes[(building as { id: string }).id] = building
      const childIds = Array.isArray(building.children) ? building.children : []
      for (const childId of childIds) {
        if (typeof childId !== 'string') continue
        const child = ctx.resolve(childId as AnyNodeId)
        if (child && typeof (child as { id?: unknown }).id === 'string') {
          nodes[(child as { id: string }).id] = child
        }
      }
    }
  }
  return resolveLift(nodes, node)
}
