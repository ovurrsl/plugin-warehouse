import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { lengthLabel, unitOf } from '../units'
import {
  BUMPER_FACE_M,
  BUMPER_PROJECTION_M,
  BUMPER_SPREAD_RATIO,
  BUMPER_Y_M,
  CONTROL_OFFSET_M,
  PALETTE,
} from './catalog'
import { isStored, lipReachM, platformLengthM, riseM, widthM } from './metrics'
import type { DockLevellerNode } from './schema'

/**
 * Plan sembolü.
 *
 * Planda bir yükleme rampası, bir kapı boşluğunun içine çizilmiş bir
 * dikdörtgen — ve o dikdörtgenin RAFTAN, tezgâhtan, konveyörden ayırt
 * edilmesi gerekiyor. Ayrımı üç şey taşıyor:
 *
 *   1. **Menteşe hattı** — arka kenarda kalın çizgi. Rampanın hangi ucundan
 *      döndüğünü söyleyen tek şey, ve yerleşimi okuyan kişinin bilmesi
 *      gereken ilk şey (çukur o tarafa göre dökülüyor).
 *   2. **Dudak** — ön kenarın ÖTESİNE taşan ayrı bir şerit. Binanın dışına
 *      taşması bilinçli: dudak dorsenin üstünde duruyor ve planda da orada
 *      görünmeli. Kapalı rampada hiç çizilmiyor.
 *   3. **Ok** — tabla yukarıda mı aşağıda mı. Kapalıyken yok; bu üç durum
 *      (yukarı / kapalı / aşağı) planda tek bakışta okunmalı çünkü hiçbiri
 *      ötekinden farklı bir dikdörtgen değil.
 *
 * Ölçüler 3B ile AYNI fonksiyonlardan — ikinci bir hesap sessizce ayrışırdı.
 */
export function buildDockLevellerFloorplan(
  node: DockLevellerNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const length = platformLengthM(node)
  const width = widthM(node)
  const view = ctx.viewState
  const selected = view?.selected ?? false
  const unit = unitOf(view)

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : PALETTE.frame
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#dfe4e9'
  const ink = selected ? stroke : '#7c8792'

  const halfLength = length / 2
  const halfWidth = width / 2

  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -halfLength,
      y: -halfWidth,
      width: length,
      height: width,
      fill,
      stroke,
      strokeWidth: 0.03,
    },
    // Menteşe hattı — arka kenar.
    {
      kind: 'line',
      x1: -halfLength,
      y1: -halfWidth,
      x2: -halfLength,
      y2: halfWidth,
      stroke,
      strokeWidth: 0.07,
    },
  ]

  // Dudak, ön kenarın ötesinde. Kapalı rampada uzanım sıfır ve şerit hiç
  // çizilmiyor — planda "kapalı" tam olarak bu demek.
  const reach = lipReachM(node)
  if (reach > 0) {
    children.push({
      kind: 'rect',
      x: halfLength,
      y: -halfWidth,
      width: reach,
      height: width,
      fill: 'none',
      stroke: ink,
      strokeWidth: 0.02,
    })
  }

  if (node.hasBumpers) {
    for (const side of [-1, 1] as const) {
      children.push({
        kind: 'rect',
        x: halfLength,
        y: side * width * BUMPER_SPREAD_RATIO - BUMPER_FACE_M[1] / 2,
        width: BUMPER_PROJECTION_M,
        height: BUMPER_FACE_M[1],
        fill: ink,
        stroke: 'none',
        strokeWidth: 0,
      })
    }
  }

  if (node.hasControlPost) {
    // Kumanda direği: operatörün durduğu yer, ve yerleşimde önünün boş
    // kalması gereken nokta.
    children.push({
      kind: 'circle',
      cx: halfLength - BUMPER_Y_M,
      cy: halfWidth + CONTROL_OFFSET_M,
      r: 0.09,
      fill: 'none',
      stroke: ink,
      strokeWidth: 0.02,
    })
  }

  // Yön oku: tablanın burnu yukarıda mı aşağıda mı. Üçgen değil iki çizgi —
  // plan mürekkebi ince tutuluyor ve dolu bir üçgen bu ölçekte lekeye
  // dönüşüyor.
  if (!isStored(node)) {
    const up = riseM(node) > 0
    const tipX = up ? halfLength - 0.18 : -halfLength + 0.18
    const tailX = up ? halfLength - 0.55 : -halfLength + 0.55
    for (const side of [-1, 1] as const) {
      children.push({
        kind: 'line',
        x1: tipX,
        y1: 0,
        x2: tailX,
        y2: side * 0.16,
        stroke: ink,
        strokeWidth: 0.025,
      })
    }
  }

  if (selected) {
    children.push({
      kind: 'text',
      x: 0,
      y: 0,
      text: `${lengthLabel(length, unit, 2)} × ${lengthLabel(width, unit, 2)}`,
      fill: stroke,
      fontSize: Math.min(0.2, width * 0.22),
      textAnchor: 'middle',
    })
  }

  return { kind: 'group', children }
}
