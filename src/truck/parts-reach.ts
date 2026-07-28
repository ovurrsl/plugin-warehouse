/**
 * Reach truck gövdesi (`rt-1800`).
 *
 * Aileyi aile yapan iki şey yayınlanmış satırlardan çizilir: straddle
 * ayaklar (dış yüzler b1 = 1.270, iç açıklık b4 = 0.940 → ayak kalınlığı
 * tam (b1−b4)/2 = 0.165 — palet alma mantığının okuyacağı iç yüzler bunlar)
 * ve yana oturan operatör kabini (h6 = 2.190 koruyucu tavan, h7 = 1.057
 * koltuk). Ayak ucu l7 = 1.842 (nota taşınmış ölçü çizimi satırı), ayak
 * yüksekliği h8 = 0.285.
 *
 * Mast dinlenmede GERİDE durur (reach'in tanımı); l4 itme stroku dilim 8'in
 * animasyonudur, burada mast geri pozisyonda sabittir.
 */

import type { TruckModel } from '../handling/models'
import {
  pushForkPair,
  pushMastStage,
  pushOverheadGuard,
  pushWheel,
  type TruckBody,
  type TruckDetail,
  type TruckPart,
} from './parts'

// Görsel lastikler: tahrik Ø0.31 (gövde altı), yük tekerleri Ø0.23 (ayak ucu).
const DRIVE_WHEEL = { diameter: 0.31, width: 0.14 }
const LEG_WHEEL = { diameter: 0.23, width: 0.09 }

/** Ayak ucu, arka yüzden l7 = 1.842 — dokümandan; model alanı değil,
 *  aile emsalinde tek satır olduğu için burada adlandırılmış sabit. */
const LEG_TIP_FROM_REAR = 1.842

export function reachParts(model: TruckModel, body: TruckBody, detail: TruckDetail): TruckPart[] {
  const halfL = model.l1 / 2
  const rearX = -halfL
  const faceX = rearX + model.l2
  const legTipX = rearX + LEG_TIP_FROM_REAR
  const legInnerZ = (model.b4 ?? 0.94) / 2
  const legOuterZ = model.b1 / 2
  const legThickness = legOuterZ - legInnerZ
  const legCenterZ = (legInnerZ + legOuterZ) / 2
  const legTopY = model.h8 ?? 0.285
  const guardTopY = model.h6 ?? 2.19
  const bodyFrontX = rearX + 1.1
  const mastX = faceX - 0.18
  const mastH = guardTopY // kapalı mast satırları katalogda yok (gaps) — tavan hizası
  const parts: TruckPart[] = []

  switch (body) {
    case 'chassis': {
      // Gövde bloğu: batarya + sürüş ünitesi, ayakların gerisi.
      parts.push({
        role: 'chassis',
        center: [(rearX + bodyFrontX) / 2, 0.62, 0],
        size: [bodyFrontX - rearX, 1.05, model.b1 - 0.04],
      })
      if (detail === 'full') {
        // Yana oturan operatör bölmesi: koltuk h7'de, konsol karşısında.
        parts.push({
          role: 'cab',
          center: [rearX + 0.55, (model.h7 ?? 1.057) - 0.03, 0.18],
          size: [0.42, 0.06, 0.44],
        })
        parts.push({
          role: 'cab',
          center: [rearX + 0.3, (model.h7 ?? 1.057) + 0.22, 0.18],
          size: [0.1, 0.5, 0.4],
        })
        parts.push({
          role: 'cab',
          center: [rearX + 0.85, 1.35, -0.35],
          size: [0.3, 0.12, 0.3],
        })
      }
      pushOverheadGuard(parts, {
        xFront: bodyFrontX - 0.12,
        xRear: rearX + 0.12,
        z: model.b1 / 2 - 0.08,
        yBottom: 1.15,
        yTop: guardTopY,
        detail,
      })
      if (detail === 'full') {
        // Reach rayları: mastın üzerinde kaydığı çift kızak — ailenin adı
        // bu mekanizmadan geliyor, gövdede görünür olmalı.
        for (const side of [-1, 1] as const) {
          parts.push({
            role: 'chassis',
            center: [(bodyFrontX + faceX - 0.1) / 2, 0.32, side * (legInnerZ - 0.06)],
            size: [faceX - 0.1 - bodyFrontX, 0.09, 0.07],
          })
        }
        // Gövde üst kapağı arkaya eğimli.
        parts.push({
          kind: 'sloped',
          role: 'chassis',
          center: [(rearX + bodyFrontX) / 2, 1.2, 0],
          size: [bodyFrontX - rearX - 0.08, 0.12, model.b1 - 0.1],
          face: 'back',
          drop: 0.08,
        })
      }
      // Straddle ayaklar: taban izinin ta kendisi — iki katmanda da, gerçek
      // kalınlıkta ve gerçek iç açıklıkta.
      for (const side of [-1, 1] as const) {
        parts.push({
          role: 'straddle-leg',
          center: [(bodyFrontX + legTipX) / 2, 0.03 + legTopY / 2, side * legCenterZ],
          size: [legTipX - bodyFrontX, legTopY, legThickness],
        })
        if (detail === 'full') {
          // Ayak burnu pahı.
          parts.push({
            role: 'straddle-leg',
            center: [legTipX + 0.06, 0.03 + legTopY / 4, side * legCenterZ],
            size: [0.12, legTopY / 2, legThickness],
          })
        }
        // Yük tekeri ayak ucunda — b11 = 1.136 yayınlanmış iz.
        pushWheel(parts, {
          x: legTipX - 0.08,
          z: side * ((model.b11 ?? 1.136) / 2),
          ...LEG_WHEEL,
          detail,
        })
      }
      return parts
    }

    case 'steer': {
      // Tahrik/dümen tekeri gövdenin altında, operatörün karşı yanında.
      pushWheel(parts, { x: rearX + 0.45, z: -0.25, ...DRIVE_WHEEL, detail })
      if (detail === 'full') {
        // Aks braketi tekerlek genişliğinde kalır (T20).
        parts.push({
          role: 'chassis',
          center: [rearX + 0.45, 0.4, -0.25],
          size: [0.36, 0.14, 0.14],
        })
      }
      return parts
    }

    case 'mast': {
      pushMastStage(parts, {
        centerX: mastX,
        railZ: 0.42,
        railSize: [0.1, mastH - 0.1, 0.08],
        yBottom: 0.05,
        crossbarYs: [0.35, mastH - 0.15],
        detail,
      })
      return parts
    }

    case 'stage1': {
      pushMastStage(parts, {
        centerX: mastX + 0.06,
        railZ: 0.34,
        railSize: [0.08, mastH - 0.3, 0.07],
        yBottom: 0.15,
        crossbarYs: [mastH - 0.35],
        detail,
      })
      return parts
    }

    case 'carriage': {
      parts.push({
        role: 'carriage',
        center: [faceX - 0.07, 0.45, 0],
        size: [0.05, 0.7, 0.86],
      })
      if (detail === 'full') {
        for (const t of [-0.36, -0.18, 0, 0.18, 0.36]) {
          parts.push({
            role: 'backrest',
            center: [faceX - 0.055, 1.05, t],
            size: [0.03, 0.55, 0.05],
          })
        }
        for (const y of [0.88, 1.28]) {
          parts.push({
            role: 'backrest',
            center: [faceX - 0.055, y, 0],
            size: [0.03, 0.05, 0.8],
          })
        }
      } else {
        parts.push({
          role: 'backrest',
          center: [faceX - 0.055, 1.05, 0],
          size: [0.03, 0.55, 0.8],
        })
      }
      pushForkPair(parts, { faceX, model, detail })
      return parts
    }

    default:
      return parts
  }
}
