/**
 * Plan sembolü — gövde, mast çizgisi, iki çatal izi, ok başı; seçiliyken
 * Ast bandı ve Wa süpürme yayı.
 *
 * Host kısıtları (plan §4.4, hepsi doğrulanmış):
 *   - `facingIndicator` yalnız ±Z sunuyor, aracın ileri yönü +X — bu yüzden
 *     sembol KENDİ ok başını çizer.
 *   - Tahmin/boşluk ibaresi `text` primitifinde yaşar: annotation filtresi
 *     `dimension`/`dimension-label`'ı düşürür ama `text`'i düşürmez — kullanıcı
 *     ölçüleri kapattığında bant kalksın, gerekçe metni kalsın diye tam tersi
 *     değil.
 *   - Planda LOD yoktur (`viewState`'te zoom yok); seçilmemiş sembol ≤ 14
 *     primitif — bütçe T25'te kilitli.
 *   - Dolgulu hiçbir primitif `fill: 'none'` taşımaz (seçilemez araç), bant
 *     `pointerEvents: 'none'` taşır (altındaki rafların tıklamasını yutmasın).
 */

import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { forkSpreadM, modelOf, visualForkFaceX, waPivotLocalX } from './metrics'
import type { TruckNode } from './schema'

export function buildTruckFloorplan(
  node: TruckNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const model = modelOf(node.model)
  const view = ctx.viewState
  const selected = view?.selected ?? false

  const halfL = model.l1 / 2
  const halfW = Math.max(model.b1, model.b2 ?? 0) / 2
  const faceX = visualForkFaceX(model)

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : '#8a5a13'
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#f5deb0'

  const spread = forkSpreadM(model)
  const e = model.fork.e
  const children: FloorplanGeometry[] = []

  // İki çatal izi — her ailede: makinenin en anlamlı plan bilgisi.
  const pushForks = () => {
    for (const side of [-1, 1] as const) {
      children.push({
        kind: 'rect',
        x: faceX,
        y: side * ((spread - e) / 2) - e / 2,
        width: model.fork.length,
        height: e,
        fill: stroke,
        stroke,
        strokeWidth: 0.01,
      })
    }
  }

  // Ok başı: ileri = +X. Host'un facing göstergesi ±Z'ye kilitli olduğu için
  // yön bilgisini sembol taşır.
  const pushArrow = (x: number, size: number) => {
    children.push({
      kind: 'polygon',
      points: [
        [x, -size],
        [x + size * 0.66, 0],
        [x, size],
      ],
      fill: stroke,
      stroke,
      strokeWidth: 0.01,
    })
  }

  // ── Aile sembolleri: her makine planında da kendisidir ─────────────────
  switch (model.variant) {
    case 'hand-pallet':
    case 'powered-pallet': {
      // Başlık + çatallar + kol izi. Başlık genişliği gerçek: mpt'de dar
      // pompa gövdesi, ept'te tam gövde.
      const headHalfW = model.variant === 'hand-pallet' ? 0.17 : halfW - 0.015
      children.push({
        kind: 'rect',
        x: -halfL,
        y: -headHalfW,
        width: model.l2,
        height: headHalfW * 2,
        fill,
        stroke,
        strokeWidth: 0.02,
      })
      // Kol izi: başlıktan geriye kısa şerit + kulp çizgisi.
      children.push({
        kind: 'rect',
        x: -halfL + 0.04,
        y: -0.03,
        width: 0.22,
        height: 0.06,
        fill: stroke,
        stroke,
        strokeWidth: 0.01,
      })
      children.push({
        kind: 'rect',
        x: -halfL + 0.02,
        y: model.variant === 'hand-pallet' ? -0.21 : -0.25,
        width: 0.05,
        height: model.variant === 'hand-pallet' ? 0.42 : 0.5,
        fill: stroke,
        stroke,
        strokeWidth: 0.01,
      })
      pushForks()
      pushArrow(faceX + 0.15, Math.min(halfW * 0.4, 0.16))
      break
    }

    case 'reach': {
      const bodyFrontX = -halfL + 1.1
      const legTipX = -halfL + 1.842 // l7 — ölçü çizimi satırı, parts-reach ile aynı
      const legInner = (model.b4 ?? 0.94) / 2
      // Gövde.
      children.push({
        kind: 'rect',
        x: -halfL,
        y: -halfW,
        width: bodyFrontX + halfL,
        height: halfW * 2,
        fill,
        stroke,
        strokeWidth: 0.02,
      })
      // Straddle ayaklar: reach'in plan imzası — iç yüzler tam b4 açıklıkta.
      for (const side of [-1, 1] as const) {
        children.push({
          kind: 'rect',
          x: bodyFrontX,
          y: side === 1 ? legInner : -halfW,
          width: legTipX - bodyFrontX,
          height: halfW - legInner,
          fill,
          stroke,
          strokeWidth: 0.02,
        })
      }
      // Mast bandı (geri pozisyonda, ayaklar arasında).
      children.push({
        kind: 'rect',
        x: faceX - 0.16,
        y: -legInner * 0.92,
        width: 0.1,
        height: legInner * 1.84,
        fill: stroke,
        stroke,
        strokeWidth: 0.01,
      })
      pushForks()
      pushArrow(bodyFrontX - 0.55, halfW * 0.4)
      break
    }

    case 'turret': {
      const bodyHalfW = model.b1 / 2
      const cabRearX = 0.35
      // Uzun gövde — b1 genişliğinde.
      children.push({
        kind: 'rect',
        x: -halfL,
        y: -bodyHalfW,
        width: cabRearX + halfL,
        height: bodyHalfW * 2,
        fill,
        stroke,
        strokeWidth: 0.02,
      })
      // Kabin: GÖVDEDEN GENİŞ (b2) — planda da öyle; VNA'yı VNA yapan iz.
      children.push({
        kind: 'rect',
        x: cabRearX,
        y: -halfW,
        width: faceX - 0.24 - cabRearX,
        height: halfW * 2,
        fill,
        stroke,
        strokeWidth: 0.02,
      })
      // Döner başlık.
      children.push({
        kind: 'rect',
        x: faceX - 0.24,
        y: -0.36,
        width: 0.24,
        height: 0.72,
        fill: stroke,
        stroke,
        strokeWidth: 0.01,
      })
      pushForks()
      pushArrow(-0.1, bodyHalfW * 0.4)
      break
    }

    default: {
      // forklift: gövde + yuvarlatılmış karşı ağırlık + ön tekerlek izleri.
      const chamfer = 0.14
      children.push({
        kind: 'polygon',
        points: [
          [-halfL + chamfer, -halfW],
          [faceX, -halfW],
          [faceX, halfW],
          [-halfL + chamfer, halfW],
          [-halfL, halfW - chamfer],
          [-halfL, -halfW + chamfer],
        ],
        fill,
        stroke,
        strokeWidth: 0.02,
      })
      // Mast bandı.
      children.push({
        kind: 'rect',
        x: faceX - 0.16,
        y: -halfW * 0.85,
        width: 0.1,
        height: halfW * 1.7,
        fill: stroke,
        stroke,
        strokeWidth: 0.01,
      })
      // Ön tekerlek izleri — b10 gerçek iz genişliği.
      const trackZ = (model.b10 ?? model.b1 - 0.16) / 2
      const frontAxleX = -halfL + (model.rearOverhang ?? 0.19) + model.y
      for (const side of [-1, 1] as const) {
        children.push({
          kind: 'rect',
          x: frontAxleX - 0.23,
          y: side * trackZ - 0.09,
          width: 0.46,
          height: 0.18,
          fill: stroke,
          stroke,
          strokeWidth: 0.01,
        })
      }
      pushForks()
      pushArrow(faceX - 0.55, halfW * 0.45)
    }
  }

  if (selected) {
    // Ast bandı — yalnız yayınlandığı yerde. `tt`'de Ast yok ve hesaplanmış
    // 1877 çizilmez: EN 15620 bandı (1.7–1.9) zaten kapsıyor, ikinci bir sayı
    // yalnız çelişme imkânı ekler (§4.3); formül ve not PANELDE durur.
    if (model.ast) {
      const astM =
        node.referenceLoad === '1000x1200' ? model.ast.load1000x1200 : model.ast.load800x1200
      children.push({
        kind: 'rect',
        x: -halfL - 0.4,
        y: -astM / 2,
        width: model.l1 + 0.8,
        height: astM,
        fill: stroke,
        fillOpacity: 0.12,
        // Pazarlık dışı: 3+ metrelik dolgulu bir dikdörtgen, altındaki her
        // rafın tıklamasını yutar.
        pointerEvents: 'none',
      })
      children.push({
        kind: 'dimension-label',
        cx: 0,
        cy: astM / 2 + 0.25,
        text: `Ast ${astM.toFixed(3)} m · ${node.referenceLoad === '1000x1200' ? '1000×1200' : '800×1200'}`,
        angle: 0,
        screenUpright: true,
      })
      // Enstrüman atfı `text` olarak: annotation filtresi ölçüyü düşürür,
      // gerekçe kalır.
      children.push({
        kind: 'text',
        x: 0,
        y: astM / 2 + 0.55,
        text: 'VDI 2198 4.34',
        fontSize: 0.16,
        fill: stroke,
        opacity: 0.75,
        textAnchor: 'middle',
        upright: true,
      })
    }

    // Wa: merkez yayınlanmışsa 90°'lik süpürme yayı; değilse yalnız sayı —
    // yayınlanmış bir sayıyı uydurulmuş bir merkeze oturtmak, sayıyı
    // olduğundan fazlasını iddia eden bir şekle çevirir (§4.2).
    const pivotX = waPivotLocalX(model)
    if (model.Wa !== null && pivotX !== null) {
      const r = model.Wa
      // 90° süpürme, pivottan geriye: sweep bayrağı curve-floorplan'ın
      // öğrettiği yönde (artan açı = 1), tahmin edilmez.
      const x0 = pivotX - r
      const y0 = 0
      const x1 = pivotX
      const y1 = -r
      children.push({
        kind: 'path',
        d: `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`,
        fill: 'transparent',
        stroke,
        strokeWidth: 0.025,
        pointerEvents: 'none',
      })
      children.push({
        kind: 'dimension-label',
        cx: pivotX - r * 0.75,
        cy: -r * 0.75,
        text: `Wa ${r.toFixed(3)} m`,
        angle: 0,
        screenUpright: true,
      })
    } else if (model.Wa !== null) {
      children.push({
        kind: 'text',
        x: 0,
        y: -halfW - 0.35,
        text: `Wa ${model.Wa.toFixed(2)} m — dönüş merkezi yayınlanmamış`,
        fontSize: 0.16,
        fill: stroke,
        textAnchor: 'middle',
        upright: true,
      })
    }
  }

  return { kind: 'group', children }
}
