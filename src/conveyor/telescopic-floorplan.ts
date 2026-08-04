import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { lengthLabel, unitOf } from '../units'
import { TELESCOPIC_MODELS } from './telescopic-catalog'
import { beltWidthM, boomSections, boomTipX, frameWidthM } from './telescopic-metrics'
import type { ConveyorTelescopicNode } from './telescopic-schema'

/**
 * Plan sembolü — sabit gövde + kademeli bom + tam açılım zarfı.
 *
 * Bu makinenin planda söylediği tek önemli şey **ne kadar yer kaplayacağı**:
 * kapalıyken A, tam açıkken C. Bu yüzden seçiliyken tam açılım kesikli bir
 * dikdörtgen olarak çizilir — rampanın önünde ne kadar zemin isteyeceği
 * yerleşim kararının kendisidir ve o kararı planda görmek gerekir.
 *
 * Kademeler daralarak çizilir: iç içe geçen bir bomun planda tek düz
 * dikdörtgen olması, makineyi sıradan bir bant konveyöre çevirirdi.
 *
 * SVG `rotate()` saat yönünde ve y aşağı; three +Y etrafında saat yönünün
 * tersine döner — plan rotasyonu düğümünkinin negatifidir (aile kuralı).
 */
export function buildTelescopicFloorplan(
  node: ConveyorTelescopicNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const model = TELESCOPIC_MODELS[node.model]
  const width = frameWidthM(node)
  const belt = beltWidthM(node)
  const halfA = model.fixedM / 2
  const view = ctx.viewState
  const unit = unitOf(view)
  const selected = view?.selected ?? false

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#1e56a0'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#dbeafe'
  const detail = selected ? stroke : '#64748b'

  const children: FloorplanGeometry[] = [
    // Sabit gövde A — kapalı hâlde makinenin tuttuğu zemin.
    {
      kind: 'rect',
      x: -halfA,
      y: -width / 2,
      width: model.fixedM,
      height: width,
      fill,
      // 'transparent' değil gerçek dolgu: `none` boya değildir ve
      // `pointer-events: visiblePainted` onu hiç hit-test etmez.
      stroke,
      strokeWidth: 0.03,
    },
    // Bant şeridi — kutunun gerçekten oturduğu genişlik.
    {
      kind: 'rect',
      x: -halfA + 0.05,
      y: -belt / 2,
      width: model.fixedM - 0.1,
      height: belt,
      fill: 'transparent',
      stroke: detail,
      strokeWidth: 0.015,
    },
  ]

  // Kademeler: her biri bir öncekinden dar, uzamış konumunda.
  for (const section of boomSections(node)) {
    children.push({
      kind: 'rect',
      x: section.centerX - section.lengthM / 2,
      y: -section.widthM / 2,
      width: section.lengthM,
      height: section.widthM,
      fill,
      stroke,
      strokeWidth: 0.025,
    })
  }

  // Boşaltma oku: ileri = +X, bom ucunda.
  const tipX = boomTipX(node)
  children.push({
    kind: 'polygon',
    points: [
      [tipX - 0.45, -width * 0.18],
      [tipX - 0.05, 0],
      [tipX - 0.45, width * 0.18],
    ],
    fill: stroke,
    stroke,
    strokeWidth: 0.01,
  })

  if (selected) {
    // Tam açılım zarfı — makinenin isteyebileceği en uzun zemin.
    // `pointerEvents: none`: 25 m'lik bir dikdörtgen altındaki her rafın
    // tıklamasını yutardı (araç Ast bandının aynı gerekçesi).
    children.push({
      kind: 'rect',
      x: -halfA,
      y: -width / 2,
      width: model.totalM,
      height: width,
      fill: 'transparent',
      stroke: detail,
      strokeWidth: 0.03,
      strokeDasharray: '0.4 0.3',
      pointerEvents: 'none',
    })
    children.push({
      kind: 'dimension-label',
      cx: -halfA + model.totalM / 2,
      cy: -width / 2 - 0.5,
      text: `Tam açık ${lengthLabel(model.totalM, unit, 1)} · sabit ${lengthLabel(model.fixedM, unit, 1)}`,
      angle: 0,
      screenUpright: true,
    })
  }

  return { kind: 'group', children }
}
