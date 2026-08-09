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
  pushBeacon,
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

/**
 * Gövde siluetinin oranları — ÜRÜN FOTOĞRAFINDAN ÖLÇÜLDÜ.
 *
 * Kaynak: üreticinin EFG 213–220 ürün sayfasındaki stüdyo çekimleri (arka ve
 * yan görünüş). Ölçüm piksel üzerinden yapıldı ve arka görünüşte yayımlanmış
 * `b1` genişliğiyle ölçeklendi — genişlik bir doğrultuda perspektif taşımayan
 * tek ölçü olduğu için çapa olarak o seçildi. Ham okumalar:
 *
 *   sarı gövde tepesi    b1'in 0.996'sı      alt kenarı  b1'in 0.109'u
 *   arka teker arkı      0.453·b1 açıklık,   tepesi      0.396·b1
 *   gri kaporta bandı    b1 − 55 mm
 *
 * Dikey kotlar burada YAYIMLANMIŞ satırlara bağlanıyor, orana değil: fotoğraf
 * bir EFG 216k'nın ve o makine bizimkinden büyük, yani mutlak yükseklikleri
 * taşımak sessizce yanlış bir araç çizerdi. Oran taşınıyor, kot `h7`
 * (koltuk) ve `h6` (tavan) üzerinden kuruluyor.
 */
const ARCH_GAP_RATIO = 0.453 // arka teker arkının b1'e oranı
const ARCH_TOP_RATIO = 0.396 // ark tepesinin b1'e oranı
const BODY_FLOOR_RATIO = 0.109 // gövde alt kenarının b1'e oranı
const SHROUD_NARROW_M = 0.055 // gri kaportanın gövdeden daralması
/** Ön tekerin üstündeki çamurluk kotu — altında gövde belden içeri çekiliyor. */
const FENDER_Y = 0.55
const FENDER_WAIST_M = 0.15

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
      /**
       * ## Gövde: TEK sarı kütle, arkasında teker arkı, önünde çamurluk
       *
       * Önceki hâl bir taban plakası + koyu gri bir karşı ağırlık + ayrı bir
       * kaputtu. Ürün fotoğrafına bakıldığında üçü de yanlış:
       *
       *   - Karşı ağırlık gövdeyle AYNI sarı; koyu gri bir kütle makinede yok.
       *   - Gövde arkadan öne kesintisiz tek bir kabuk; plaka diye ayrı bir
       *     eleman görünmüyor.
       *   - Makinenin arkadan en tanınır iki hattı çizilmiyordu: ikiz dümen
       *     tekerini saran ORTA ARK ve arka alt köşedeki PAH.
       *
       * Ölçüler yukarıdaki oranlardan; kotlar yayımlanmış `h7`den.
       */
      const bodyFrontX = mastX - 0.05
      const bodyFloorY = BODY_FLOOR_RATIO * model.b1
      const archHalfZ = (ARCH_GAP_RATIO * model.b1) / 2
      const archTopY = ARCH_TOP_RATIO * model.b1
      const seatY = model.h7 ?? 0.92
      // Karşı ağırlığın tepesi koltuk kotunun hemen üstünde — fotoğrafta
      // sürücü, sırtı karşı ağırlığa gelecek biçimde oturuyor.
      const counterTopY = seatY + 0.08
      // Batarya kapağı koltuğun ALTINDA kalmak zorunda: minder onun üstüne
      // oturuyor ve `h7` yayımlanmış bir satır.
      const deckTopY = seatY - 0.14
      const counterFrontX = rearX + 0.62

      // ── Arka kütle: ikiz tekeri saran ark iki bacak bırakıyor ────────────
      for (const side of [-1, 1] as const) {
        parts.push({
          role: 'chassis',
          center: [
            (rearX + counterFrontX) / 2,
            (bodyFloorY + archTopY) / 2,
            (side * (archHalfZ + halfB)) / 2,
          ],
          size: [counterFrontX - rearX, archTopY - bodyFloorY, halfB - archHalfZ],
        })
      }
      // Arka alt köşe pahı: bacakların arasını kapatan, altı arkaya doğru
      // yukarı kaçan blok. `edge: 'bottom'` tam bunun için var.
      parts.push({
        kind: 'sloped',
        role: 'chassis',
        center: [(rearX + counterFrontX) / 2, (archTopY + counterTopY) / 2, 0],
        size: [counterFrontX - rearX, counterTopY - archTopY, model.b1],
        face: 'back',
        drop: 0.12,
        edge: 'bottom',
      })

      /**
       * ── Ayak boşluğu: gövdenin BELİ ───────────────────────────────────────
       *
       * Yan görünüşte makineyi makine yapan hat bu. Sarı, karşı ağırlığın
       * önünde bir basamakla İNİYOR, sürücünün ayaklarının durduğu alçak bir
       * teknede devam ediyor ve tahrik tekerinin üstünde çamurluk olarak
       * yeniden yükseliyor. Düz bir üst hat çizmek — ilk hâlde olduğu gibi —
       * makineyi tek bir sandığa çeviriyordu.
       */
      const deckRearX = counterFrontX - 0.02
      const deckFrontX = frontAxleX - 0.34
      const footwellY = archTopY + 0.06
      parts.push({
        role: 'chassis',
        center: [(deckRearX + deckFrontX) / 2, (bodyFloorY + footwellY) / 2, 0],
        size: [deckFrontX - deckRearX, footwellY - bodyFloorY, model.b1 - 0.03],
      })
      // Tekne tabanı — sürücünün bastığı gri sac.
      parts.push({
        role: 'shroud',
        center: [(deckRearX + deckFrontX) / 2, footwellY + 0.015, 0],
        size: [deckFrontX - deckRearX, 0.03, model.b1 - 0.2],
      })

      // ── Ön kütle: tahrik tekerinin üstündeki çamurluk ────────────────────
      // Çamurluk kotunun ALTINDA gövde belden içeri çekiliyor; lastik o
      // boşluktan çıkıyor ve makine yere basıyor. Üstü tam genişlik.
      parts.push({
        role: 'cowl',
        center: [(deckFrontX + bodyFrontX) / 2, (bodyFloorY + FENDER_Y) / 2, 0],
        size: [bodyFrontX - deckFrontX, FENDER_Y - bodyFloorY, model.b1 - 2 * FENDER_WAIST_M],
      })
      parts.push({
        kind: 'sloped',
        role: 'cowl',
        center: [(deckFrontX + bodyFrontX) / 2, (FENDER_Y + deckTopY) / 2, 0],
        size: [bodyFrontX - deckFrontX, deckTopY - FENDER_Y, model.b1],
        face: 'front',
        drop: 0.12,
      })

      // ── Gri kaporta: koltuğun oturduğu sac, YALNIZ arkada ────────────────
      // Gerçek makinede sarı karşı ağırlığın tepesinde bitiyor ve koltuk onun
      // önündeki gri kaportanın üstünde duruyor. Kaporta öne kadar uzatılırsa
      // ayak boşluğunu kapatır ve makine yine tek sandık olur. Fotoğraftan
      // ölçülen daralma 55 mm.
      const shroudFrontX = counterFrontX + 0.34
      parts.push({
        role: 'shroud',
        center: [(rearX + 0.14 + shroudFrontX) / 2, (deckTopY + counterTopY) / 2, 0],
        size: [shroudFrontX - rearX - 0.14, counterTopY - deckTopY, model.b1 - SHROUD_NARROW_M],
      })

      if (detail === 'full') {
        // Arka stop grubu: karşı ağırlığın üst köşelerinde iki koyu şerit —
        // arkadan bakıldığında makineyi tanıtan ilk şey.
        for (const side of [-1, 1] as const) {
          parts.push({
            role: 'tail-light',
            center: [rearX + 0.02, counterTopY - 0.13, side * (model.b1 / 2 - 0.19)],
            size: [0.05, 0.09, 0.22],
          })
        }
        // Yan havalandırma paneli — kaputun önünde koyu dörtgen.
        for (const side of [-1, 1] as const) {
          parts.push({
            role: 'tail-light',
            center: [deckFrontX - 0.1, footwellY - 0.1, side * (model.b1 / 2 - 0.015)],
            size: [0.26, 0.14, 0.03],
          })
        }
        // Koltuk: minder + YATIK sırt (h7 = yayınlanmış koltuk kotu).
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
      const guardTopY = model.h6 ?? 2.04
      const guardFrontX = frontAxleX + 0.22
      pushOverheadGuard(parts, {
        xFront: guardFrontX,
        xRear: rearX + 0.5,
        z: halfB - 0.08,
        yBottom: 0.95,
        yTop: guardTopY,
        detail,
      })
      /**
       * Çakar ve çalışma lambaları koruyucu tavanın ÖN kirişinde — gerçek
       * makinede tam orada duruyorlar.
       *
       * Tepeleri tavan düzlemiyle bitiyor, üstüne ÇIKMIYOR: tavanın kotu
       * `h6`, yani yayımlanmış zarfın kendisi. Lambayı zarfın üstüne koymak
       * makineyi kataloğun söylediğinden yüksek çizmek olurdu.
       */
      pushBeacon(parts, { x: guardFrontX - 0.06, yBase: guardTopY - 0.15, z: 0, detail })
      if (detail === 'full') {
        for (const side of [-1, 1] as const) {
          parts.push({
            role: 'lamp',
            center: [guardFrontX - 0.06, guardTopY - 0.07, side * 0.19],
            size: [0.07, 0.09, 0.11],
          })
        }
      }
      // Tahrik tekerleri — b10 yayınlanmış ön iz genişliği. Çamurluk gövdenin
      // kendi ön kütlesi; ayrı bir parça olarak çizilmiyor artık.
      const trackZ = (model.b10 ?? model.b1 - 0.16) / 2
      pushWheel(parts, { x: frontAxleX, z: trackZ, ...FRONT_TYRE, detail })
      pushWheel(parts, { x: frontAxleX, z: -trackZ, ...FRONT_TYRE, detail })
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
