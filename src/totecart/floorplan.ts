import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { lengthLabel, unitOf } from '../units'
import { FRAME_M, PALETTE } from './catalog'
import { cartLengthM, cartWidthM, deckM, handleXM, loadedTiersOf, toteSizeOf } from './metrics'
import type { ToteCartNode } from './schema'

/**
 * Plan sembolü.
 *
 * Planda bir toplama arabası küçük bir dikdörtgen — ve o dikdörtgenin
 * paletten ayırt edilmesi gerekiyor, çünkü ikisi de yaklaşık aynı ölçüde
 * ve ikisi de zeminde duruyor. Ayrımı üç şey taşıyor:
 *
 *   1. **İç kasa dikdörtgeni** — arabanın üstündeki kasa. Palet dolu bir
 *      yük, araba ÜSTÜNDE bir kap taşıyan bir çerçeve.
 *   2. **Kol çizgisi** — arka kenardan dışarı taşan çizgi. Arabanın hangi
 *      ucundan itildiğini ve operatörün nerede duracağını söyleyen tek şey,
 *      ve bir koridor genişliği tartışmasında istenen bilgi bu.
 *   3. **Kat sayısı** — seçiliyken yazılan `n×`. Plandan bakan biri iki
 *      katlı bir arabayla altı katlıyı ayırt edemez, oysa ikisi aynı yeri
 *      kaplayıp çok farklı iş yapar.
 */
export function buildToteCartFloorplan(
  node: ToteCartNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const length = cartLengthM(node)
  const width = cartWidthM(node)
  const [deckLength, deckWidth] = deckM(node)
  const view = ctx.viewState
  const selected = view?.selected ?? false
  const unit = unitOf(view)

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : PALETTE.joint
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#eceff2'
  const ink = selected ? stroke : '#7c8792'

  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -length / 2,
      y: -width / 2,
      width: length,
      height: width,
      fill,
      stroke,
      strokeWidth: 0.02,
    },
  ]

  // Üstteki kasa — yalnız yüklüyse. Boş bir araba planda boş görünmeli.
  if (loadedTiersOf(node) > 0) {
    children.push({
      kind: 'rect',
      x: -deckLength / 2,
      y: -deckWidth / 2,
      width: deckLength,
      height: deckWidth,
      fill: 'none',
      stroke: ink,
      strokeWidth: 0.015,
    })
  }

  // İtme kolu, arka kenarda (−X): operatörün durduğu taraf. Yer 3B ile TEK
  // kaynaktan — çizgi izin dışına taşıyordu, oysa kol dikmenin üstünde ve
  // izin içinde. Plandan koridor ölçen biri arabaya olmayan bir pay ayırırdı.
  if (node.hasHandle) {
    const handleX = handleXM(node)
    children.push({
      kind: 'line',
      x1: handleX,
      y1: -width / 2 + FRAME_M,
      x2: handleX,
      y2: width / 2 - FRAME_M,
      stroke: ink,
      strokeWidth: 0.03,
    })
  }

  if (selected) {
    children.push({
      kind: 'text',
      x: 0,
      y: 0,
      text: `${node.tiers}× ${lengthLabel(toteSizeOf(node).heightM, unit, 3)}`,
      fill: stroke,
      fontSize: Math.min(0.14, width * 0.3),
      textAnchor: 'middle',
    })
  }

  return { kind: 'group', children }
}
