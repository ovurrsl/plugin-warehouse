/**
 * Karşı ağırlıklı forklift gövdesi (`forklift-1300`).
 *
 * Boyuna yerleşim tamamen yayınlanmış zincirden çıkar:
 *
 *   arka yüz −l1/2 → (+0.190) arka aks → (+y) ön aks → (+x) çatal sırtı
 *   → (+çatal boyu) çatal ucu = +l1/2
 *
 * ve zincir katalog satırında milimetresine kapandığı için (`chains.ts`)
 * buradaki hiçbir X bir tahmin değildir. Tahmin olanlar — lastik çapları,
 * ray kesitleri, koltuk ölçüleri — aşağıda adlandırılmış sabittir ve yalnız
 * görsele girer.
 */

import type { MastRow } from '../handling/masts'
import type { TruckModel } from '../handling/models'
import {
  GROUND_CLEARANCE,
  pushForkPair,
  pushMastStage,
  pushOverheadGuard,
  pushWheel,
  type TruckBody,
  type TruckDetail,
  type TruckPart,
} from './parts'

// Görsel sabitler — spec sheet'in "lastik" satırından (18×7-8 → Ø457×178,
// 140/55-9 → Ø383×140); VDI satırı değil, çizimden başka hiçbir şey okumaz.
const FRONT_TYRE = { diameter: 0.457, width: 0.178 }
const REAR_TYRE = { diameter: 0.383, width: 0.14 }

/** Mast satırı seçilmemişken kapalı mast görseli koruyucu tavana kadar çizilir
 *  — bir boy uydurmaz, aracın yayınlanmış en yüksek gövde satırını ödünç alır;
 *  panel invariant'ı satırın seçilmediğini ayrıca söyler. */
function closedMastHeight(model: TruckModel, row: MastRow | null): number {
  return row?.h1 ?? model.h6 ?? 2.0
}

export function forkliftParts(
  model: TruckModel,
  mastRow: MastRow | null,
  body: TruckBody,
  detail: TruckDetail,
): TruckPart[] {
  const halfL = model.l1 / 2
  const rearX = -halfL
  const rearAxleX = rearX + (model.rearOverhang ?? 0.19)
  const frontAxleX = rearAxleX + model.y
  const faceX = -halfL + model.l2
  const halfB = model.b1 / 2
  const h1 = closedMastHeight(model, mastRow)
  const mastX = faceX - 0.14
  const parts: TruckPart[] = []

  switch (body) {
    case 'chassis': {
      // Taban plakası — iki aks arasını kapatır.
      parts.push({
        role: 'chassis',
        center: [(rearAxleX + frontAxleX) / 2, 0.3, 0],
        size: [frontAxleX - rearAxleX + 0.55, 0.24, model.b1 - 0.06],
      })
      // Karşı ağırlık: alt blok tam b1, üstü arkaya YUVARLANIR (eğimli
      // kapak + daralan tepe) — dik kesilmiş kutu, "kutu kutu" görünümünün
      // gövdedeki kaynağıydı.
      parts.push({
        role: 'counterweight',
        center: [rearX + 0.275, 0.5, 0],
        size: [0.55, 0.6, model.b1],
      })
      parts.push({
        kind: 'sloped',
        role: 'counterweight',
        center: [rearX + 0.25, 0.97, 0],
        size: [0.5, 0.34, model.b1 - 0.08],
        face: 'back',
        drop: 0.22,
      })
      // Ön gövde/kaput: buruna doğru eğimli iner — forklift profili.
      parts.push({
        role: 'cowl',
        center: [frontAxleX - 0.05, 0.58, 0],
        size: [0.62, 0.32, model.b1 - 0.1],
      })
      parts.push({
        kind: 'sloped',
        role: 'cowl',
        center: [frontAxleX - 0.05, 0.87, 0],
        size: [0.62, 0.26, model.b1 - 0.14],
        face: 'front',
        drop: 0.18,
      })
      if (detail === 'full') {
        // Orta kaput (batarya bölmesi) — koltuğa doğru hafif eğimli.
        parts.push({
          kind: 'sloped',
          role: 'chassis',
          center: [(rearX + 0.55 + frontAxleX - 0.36) / 2, 0.62, 0],
          size: [frontAxleX - 0.36 - (rearX + 0.55), 0.4, model.b1 - 0.12],
          face: 'front',
          drop: 0.08,
        })
        // Koltuk: minder + YATIK sırt (h7 = yayınlanmış koltuk kotu).
        const seatY = model.h7 ?? 0.92
        parts.push({
          role: 'cab',
          center: [rearX + 0.84, seatY - 0.03, 0],
          size: [0.42, 0.06, 0.46],
        })
        parts.push({
          kind: 'sloped',
          role: 'cab',
          center: [rearX + 0.6, seatY + 0.24, 0],
          size: [0.14, 0.48, 0.44],
          face: 'back',
          drop: 0.1,
        })
        // Direksiyon: eğik kolon + tekerlek (silindir — kutu direksiyon
        // olmaz).
        parts.push({
          kind: 'sloped',
          role: 'cab',
          center: [frontAxleX - 0.34, 1.02, 0],
          size: [0.1, 0.24, 0.3],
          face: 'back',
          drop: 0.1,
        })
        parts.push({
          kind: 'cyl',
          role: 'cab',
          center: [frontAxleX - 0.33, 1.17, 0],
          radius: 0.14,
          length: 0.03,
          axis: 'y',
          segments: 10,
        })
      }
      pushOverheadGuard(parts, {
        xFront: frontAxleX + 0.22,
        xRear: rearX + 0.5,
        z: halfB - 0.08,
        yBottom: 0.95,
        yTop: model.h6 ?? 2.04,
        detail,
      })
      // Tahrik tekerleri — b10 yayınlanmış ön iz genişliği.
      const trackZ = (model.b10 ?? model.b1 - 0.16) / 2
      pushWheel(parts, { x: frontAxleX, z: trackZ, ...FRONT_TYRE, detail })
      pushWheel(parts, { x: frontAxleX, z: -trackZ, ...FRONT_TYRE, detail })
      if (detail === 'full') {
        // Çamurluklar tekerleğin üstüne kıvrılır — lastikten DAR (T20).
        for (const side of [-1, 1] as const) {
          parts.push({
            kind: 'sloped',
            role: 'cowl',
            center: [frontAxleX, FRONT_TYRE.diameter + 0.09, side * trackZ],
            size: [FRONT_TYRE.diameter + 0.12, 0.1, 0.17],
            face: 'front',
            drop: 0.06,
          })
        }
      }
      return parts
    }

    case 'steer': {
      // İkiz arka lastik: b11 = 0.176 yayınlanmış arka iz — iki dar lastik
      // merkeze yakın durur, üç tekerlekli şasinin tanımı.
      const twinZ = ((model.b11 ?? 0.176) + REAR_TYRE.width) / 2
      pushWheel(parts, { x: rearAxleX, z: twinZ, ...REAR_TYRE, detail })
      pushWheel(parts, { x: rearAxleX, z: -twinZ, ...REAR_TYRE, detail })
      if (detail === 'full') {
        parts.push({
          role: 'chassis',
          center: [rearAxleX, 0.38, 0],
          size: [0.2, 0.16, 0.42],
        })
      }
      return parts
    }

    case 'mast': {
      pushMastStage(parts, {
        centerX: mastX,
        railZ: 0.44,
        railSize: [0.1, h1 - 0.06, 0.08],
        yBottom: 0.03,
        crossbarYs: [0.3, h1 - 0.1],
        detail,
      })
      if (detail === 'full') {
        // Eğim silindirleri: şasiden mast ortasına yatık çift — forklifti
        // önden tanıtan hat.
        for (const side of [-1, 1] as const) {
          parts.push({
            kind: 'beam',
            role: 'mast-rail',
            from: [mastX - 0.45, 0.42],
            to: [mastX - 0.05, 0.95],
            z: side * 0.42,
            thickness: 0.06,
            width: 0.06,
          })
        }
      }
      return parts
    }

    case 'stage1': {
      // İç kademe, dinlenmede dış rayların içinde. Grubu kinematik öteler.
      pushMastStage(parts, {
        centerX: mastX + 0.06,
        railZ: 0.36,
        railSize: [0.08, h1 - 0.24, 0.07],
        yBottom: 0.12,
        crossbarYs: [h1 - 0.28],
        detail,
      })
      if (detail === 'full') {
        // Kaldırma zincirleri: kademe önünde iki ince koyu şerit.
        for (const side of [-1, 1] as const) {
          parts.push({
            role: 'mast-rail',
            center: [mastX + 0.11, (h1 - 0.1) / 2 + 0.1, side * 0.14],
            size: [0.015, h1 - 0.4, 0.03],
          })
        }
      }
      return parts
    }

    case 'carriage': {
      // Taşıyıcı plakası — yük yüzünün hemen gerisi.
      parts.push({
        role: 'carriage',
        center: [faceX - 0.075, 0.42, 0],
        size: [0.05, 0.68, 0.9],
      })
      if (detail === 'full') {
        // Yük sırtlığı: 5 dikey çubuk + 2 yatay kiriş.
        for (const t of [-0.4, -0.2, 0, 0.2, 0.4]) {
          parts.push({
            role: 'backrest',
            center: [faceX - 0.06, 1.02, t * 0.9],
            size: [0.03, 0.62, 0.05],
          })
        }
        for (const y of [0.82, 1.28]) {
          parts.push({
            role: 'backrest',
            center: [faceX - 0.06, y, 0],
            size: [0.03, 0.05, 0.86],
          })
        }
      } else {
        parts.push({
          role: 'backrest',
          center: [faceX - 0.06, 1.02, 0],
          size: [0.03, 0.62, 0.9],
        })
      }
      pushForkPair(parts, { faceX, model, detail })
      return parts
    }

    default:
      return parts
  }
}

/** Testin okuduğu taban payı — tekerlek altları tam burada durur. */
export { GROUND_CLEARANCE }
