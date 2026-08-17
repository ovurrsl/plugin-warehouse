import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { lengthLabel, unitOf } from '../units'
import {
  cageRadiusM,
  columnRadiusM,
  frameWidthM,
  helixRadiusM,
  outerDiameterM,
  portSpanM,
  turnCount,
} from './spiral-metrics'
import type { ConveyorSpiralNode } from './spiral-schema'

/**
 * Plan sembolü — iç içe iki daire (kafes izi + merkez kolon), bant halkası,
 * giriş/çıkış tanjant güdükleri ve yön oku.
 *
 * Sarmalın planda söylediği tek önemli şey **ne kadar yer kapladığı** (kafes
 * çapı) ve **kaç tur** yükseldiği; ikincisi seçiliyken etikete yazılıyor.
 *
 * SVG `rotate()` saat yönünde ve y aşağı; three +Y etrafında saat yönünün
 * tersine döner — plan rotasyonu düğümünkinin negatifidir (aile kuralı).
 */
export function buildSpiralFloorplan(
  node: ConveyorSpiralNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const cage = cageRadiusM(node)
  const column = columnRadiusM(node)
  const belt = helixRadiusM(node)
  const frame = frameWidthM(node)
  const span = portSpanM(node)
  const view = ctx.viewState
  const unit = unitOf(view)
  const selected = view?.selected ?? false

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#383e42'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#e6e8ea'
  const detail = selected ? stroke : '#64748b'

  const children: FloorplanGeometry[] = [
    // Kafes izi — makinenin tuttuğu zemin.
    { kind: 'circle', cx: 0, cy: 0, r: cage, fill, stroke, strokeWidth: 0.03 },
    // Bant halkası — kutunun döndüğü yörünge.
    {
      kind: 'circle',
      cx: 0,
      cy: 0,
      r: belt,
      fill: 'transparent',
      stroke: detail,
      strokeWidth: 0.015,
    },
    // Merkez kolon.
    { kind: 'circle', cx: 0, cy: 0, r: column, fill: detail, stroke, strokeWidth: 0.02 },
    // Giriş tanjant güdüğü (−X, alt kot).
    {
      kind: 'rect',
      x: -span,
      y: -frame / 2,
      width: span - cage,
      height: frame,
      fill,
      stroke,
      strokeWidth: 0.02,
    },
    // Çıkış tanjant güdüğü (+X, üst kot).
    {
      kind: 'rect',
      x: cage,
      y: -frame / 2,
      width: span - cage,
      height: frame,
      fill,
      stroke,
      strokeWidth: 0.02,
    },
  ]

  // Yön oku: kiraliteyi (cw/ccw) gösteren teğetsel üçgen, bant halkasının
  // üstünde. `ccw` +Z'ye, `cw` −Z'ye işaret eder.
  const dir = node.handedness === 'ccw' ? 1 : -1
  children.push({
    kind: 'polygon',
    points: [
      [belt - 0.12, dir * -0.16],
      [belt + 0.12, dir * -0.16],
      [belt, dir * 0.18],
    ],
    fill: stroke,
    stroke,
    strokeWidth: 0.01,
  })

  if (selected) {
    children.push({
      kind: 'dimension-label',
      cx: 0,
      cy: -cage - 0.5,
      text: `⌀ ${lengthLabel(outerDiameterM(node), unit, 2)} · ${turnCount(node).toFixed(1)} tur · ${node.flow === 'up' ? '↑' : '↓'}`,
      angle: 0,
      screenUpright: true,
    })
  }

  return { kind: 'group', children }
}
