/**
 * Üç yönlü VNA istifleyici gövdesi (`tt-1600`, Man-Up).
 *
 * Aileyi aile yapanlar yayınlanmış satırlardan: KABİN GÖVDEDEN GENİŞTİR
 * (b2 = 1.450 > b1 = 1.210 — zarfı kabin belirler), mast çerçevesi h12 =
 * 3.930'a çıkar (kabin tavanı h6 = 2.550 değil), basamak h7 = 0.430, ve
 * çatallar öndeki döner başlıktadır.
 *
 * Çatal yüzü BURADA `l2`'den türetilmez: bu ailede `l1 − l2 = 0.286` sabittir
 * ve iki ölçü aynı niceliği ölçmez (chains.CHAIN_EXEMPT) — görsel yüz,
 * zarftan geriye çatal boyudur (`visualForkFaceX`), böylece uçlar tam
 * +l1/2'de biter ve taban izi doğru kalır.
 *
 * Kabin `cab` gövdesindedir: dilim 8'de çatalla birlikte h3'e yükselecek;
 * bugün dinlenme kotunda durur. Swivel/traverse de dilim 8'in animasyonu —
 * başlık düz-ileri pozda çizilir.
 */

import type { TruckModel } from '../handling/models'
import { visualForkFaceX } from './metrics'
import {
  pushBeacon,
  pushBodyShell,
  pushForkPair,
  pushMastStage,
  pushWheel,
  type TruckBody,
  type TruckDetail,
  type TruckPart,
} from './parts'

/**
 * YAYINLANMIŞ lastikler (VDI 2198, EKX 516 sütunu — y = 2.220, l1 = 4.045,
 * b10 = 1.258): satır 3.2 ÖN (yük, 2 adet) Ø 380 × 192, satır 3.3 ARKA
 * (tahrik — satır 3.5 onu "1x" ile işaretler) Ø 400 × 160.
 *
 * mm ASIL BİRİMDİR ve bu satırda önemi var. Buradaki sayılar bir kez inç
 * sütunundan çevrilmişti (15.7 × 6.3 → 0.399 × 0.160, 15.0 × 7.6 → 0.381 ×
 * 0.193) çünkü elimizdeki tek nüsha 2017 tarihli ABD sayfasıydı — ve onun 3.3
 * mm sütununda dizgi hatası var: satır 3.2'nin çevrimi olan "381 x 192"
 * tekrarlanmış, kendi inç sütunuyla bile çelişiyor. 2018 ve 2022 ABD
 * sürümleriyle EU EN ve DE sürümlerinin dördü de "Ø 400 x 160" basıyor.
 *
 * Ön lastikteki "1 mm kırpma" gerekçesi de aynı çevrimin artığıydı ve
 * GEREKSİZDİ: 192 doğrudan yayınlanmış. Kendiliğinden kapanan kontrol duruyor
 * — yük tekerleri b10 izinde, dış yüzleri 1.258 + 0.192 = 1.450 = b2, yani
 * yayınlanmış genel genişliği KABİN değil ÖN AKS yapıyor.
 *
 * Eski Ø0.34 yük tekerleği uydurmaydı; tahrik lastiğinin çapı 1 mm şaşıyordu
 * ve asıl yanlış olan X konumuydu, aşağıya bakın.
 */
const DRIVE_WHEEL = { diameter: 0.4, width: 0.16 }
const LOAD_WHEEL = { diameter: 0.38, width: 0.192 }

/**
 * Dinlenmedeki mast tepesi — YAYINLANMIŞ figür, seçilmiş varsayılan DEĞİL:
 * VDI 2198 satır 4.2 "katlanmış mast yüksekliği" h1 = 2.955, EKX 516 sütunu,
 * sayfanın referans mastı için (satır 4.4 h3 = 3.500). Beş ayrı nüsha aynı
 * sayıyı basıyor: 2017 / 2018 / 2022 ABD, EU EN, DE.
 *
 * Bir süre burada "seçilmiş varsayılan" yazıyordu ve `gaps.ts` aynı figürü
 * "yayınlanmamış" diye kaydediyordu. İkisi de yanlıştı ve birbiriyle de
 * çelişiyordu — satır sayfada duruyor.
 *
 * Ne DEĞİL: bir MAST SATIRI. Standart mast tablosunda h3 = 3.500 satırı yok
 * (BR5 ZT: 3.000 → h1 2.705, 4.000 → h1 3.205). 2.955 o bandın tam ortasına
 * düşer — tabloyu DOĞRULAR ama ondan OKUNMAZ, ve enterpolasyonla üretilmiş
 * değildir. BR5 satırları `MAST_ROWS`'a girildiği gün burası `mastRow.h1`
 * olur.
 */
const RESTING_MAST_TOP_M = 2.955

export function turretParts(model: TruckModel, body: TruckBody, detail: TruckDetail): TruckPart[] {
  const halfL = model.l1 / 2
  const rearX = -halfL
  const faceX = visualForkFaceX(model)
  const bodyHalfZ = model.b1 / 2
  const cabHalfZ = (model.b2 ?? model.b1) / 2
  /**
   * **`h12` DEĞİL.** h12 VDI 2198 satır 4.14 "maksimum platform yüksekliği" —
   * kabin tabanının çıkabildiği kot — ve mast satırına bağlıdır:
   * h12 = h3 + h7 = 3.500 + 0.430 = 3.930, tam. 18 m mastta 18.430 olurdu.
   * Mast ona çizilince kabin tavanının (h6 = 2.550) 1,34 m üstünde çıplak bir
   * direk kalıyordu; gerçek makinede mast kabin tavanının ~0,4 m üstünde biter
   * ve kabinle tek parça okunur — "man-up" hissini veren şey o bütünlük.
   *
   * Katlanmış mast yüksekliği ayrı ve YAYINLANMIŞ bir satırdır (4.2 h1 =
   * 2.955, sayfanın h3 = 3.500 referans mastı için). Satırdan okunamamasının
   * sebebi verinin olmaması değil, ÇIKARILMAMIŞ olması: `MAST_ROWS`'ta
   * `ekx-br5` için tek satır bulunmuyor, `mastRowsFor` sıfır döndürüyor.
   * Satırlar girildiğinde bu, forklift'teki gibi mast satırının h1'i olmalı.
   */
  const mastTopY = RESTING_MAST_TOP_M
  const cabFloorY = model.h7 ?? 0.43
  const cabTopY = model.h6 ?? 2.55
  const bodyFrontX = -0.35
  const mastX = 0.05
  const cabRearX = 0.35
  const cabFrontX = faceX - 0.24
  const parts: TruckPart[] = []

  switch (body) {
    case 'chassis': {
      // Uzun gövde: batarya bölmesi + şasi, arka yüzden mast'a. Tek prizma
      // DEĞİL — 1,3 m'lik kesintisiz bir yüz düz bir renk lekesi olarak
      // okunuyordu ve lastikler tamamen içinde kalıyordu (bkz. `pushBodyShell`).
      // Arka blok KOYU: gerçek makinede orası karşı ağırlık ve batarya kapağı,
      // gövde saclarıyla aynı rengi taşımıyor. İki tonu iki katmanda da
      // tutmak, 1,6 m'lik gövdeyi iki kütleye bölen şey.
      const ballastFrontX = rearX + 0.42
      pushBodyShell(parts, {
        role: 'counterweight',
        xRear: rearX,
        xFront: ballastFrontX,
        halfWidth: bodyHalfZ - 0.01,
        yBottom: 0.1,
        yTop: 1.4,
        // Kuşak gövdeninkiyle AYNI kotta: iki kütlenin çıtası hizalanmazsa
        // makine iki ayrı parçadan yapıştırılmış gibi okunur.
        beltY: 0.78,
        skirtInset: 0.075,
      })
      pushBodyShell(parts, {
        role: 'chassis',
        xRear: ballastFrontX,
        xFront: bodyFrontX,
        halfWidth: bodyHalfZ - 0.01,
        yBottom: 0.1,
        yTop: 1.4,
        beltY: 0.78,
        skirtInset: 0.075,
      })
      // Çakar gövdenin tepesinde — kabin tavanı h6 zarfın kendisi, oraya
      // konsaydı makine kataloğun söylediğinden yüksek olurdu.
      pushBeacon(parts, { x: rearX + 0.3, yBase: 1.4, z: 0, detail })
      if (detail === 'full') {
        // Batarya kapağı + arka tampon + kılavuz makaraları (ray kılavuzlu
        // koridorun donanımı — dört köşede).
        parts.push({
          role: 'chassis',
          center: [rearX + 0.5, 1.47, 0],
          size: [0.9, 0.06, model.b1 - 0.2],
        })
        for (const sx of [rearX + 0.25, bodyFrontX - 0.15]) {
          for (const side of [-1, 1] as const) {
            parts.push({
              role: 'guide-roller',
              center: [sx, 0.18, side * (bodyHalfZ + 0.03)],
              size: [0.12, 0.12, 0.06],
            })
          }
        }
      }
      /**
       * **Aks aralığı yayınlanmış `y`'den gelir, sabit sayıdan değil.**
       *
       * Buradaki iki teker `rearX + 0.45` ve `bodyFrontX − 0.05` sabitleriyle
       * konulmuştu: aralarında 1.17 m vardı, oysa yayınlanmış aks aralığı
       * y = 2.220. Dört metrelik bir makinenin bütün tekerlekleri arka üçte
       * birine toplanınca uzun bir VNA istifleyicisi değil, altına tekerlek
       * sıkıştırılmış kısa bir kutu okunuyordu.
       *
       * Arka sarkma z de sabit yazılmıyor, satırın kendisinden türüyor:
       * `waPivotFromRear − y = 2.502 − 2.220 = 0.282`. Bu paketin kendi testi
       * (`truck.test.ts`, "tt pivotu öndedir") zaten z + y = Wa eşitliğini
       * iddia ediyor — yani doğru konumlar tek satır aritmetikle çıkıyor ve
       * `parts-forklift.ts:75` aynısını `rearAxleX + model.y` ile yapıyor.
       */
      const rearOverhangM = (model.waPivotFromRear ?? 0) - model.y
      const driveAxleX = rearX + rearOverhangM
      const loadAxleX = driveAxleX + model.y
      pushWheel(parts, { x: driveAxleX, z: 0, ...DRIVE_WHEEL, detail })
      for (const side of [-1, 1] as const) {
        pushWheel(parts, {
          x: loadAxleX,
          z: side * ((model.b10 ?? 1.258) / 2),
          ...LOAD_WHEEL,
          detail,
        })
      }
      return parts
    }

    case 'mast': {
      // VNA mast çerçevesi: h12'ye kadar — makinenin en yüksek sabit noktası.
      pushMastStage(parts, {
        centerX: mastX,
        railZ: 0.5,
        railSize: [0.14, mastTopY - 0.08, 0.1],
        yBottom: 0.04,
        crossbarYs: [0.4, mastTopY / 2, mastTopY - 0.2],
        detail,
      })
      if (detail === 'simple') {
        // Uzak katman iskelet değil: tek kabuklu masta bir orta kuşak —
        // banda (%30+) tam bu kutu döndürüyor.
        parts.push({
          role: 'mast-rail',
          center: [mastX, mastTopY / 2, 0],
          size: [0.16, 0.12, 1.06],
        })
      }
      if (detail === 'full') {
        // Çapraz kafes bağları — ağır VNA mastını kutu raydan ayıran doku.
        for (let y = 0.9; y < mastTopY - 0.9; y += 1.1) {
          for (const side of [-1, 1] as const) {
            parts.push({
              kind: 'beam',
              role: 'mast-rail',
              from: [mastX - 0.05, y],
              to: [mastX + 0.05, y + 0.9],
              z: side * 0.5,
              thickness: 0.05,
              width: 0.05,
            })
          }
        }
      }
      return parts
    }

    case 'stage1': {
      pushMastStage(parts, {
        centerX: mastX + 0.09,
        railZ: 0.4,
        railSize: [0.1, mastTopY - 0.5, 0.08],
        yBottom: 0.2,
        crossbarYs: [mastTopY - 0.6],
        detail,
      })
      return parts
    }

    case 'cab': {
      // Man-up kabin — GÖVDEDEN GENİŞ (b2), zarfın sahibi. Dinlenmede
      // basamak h7'de; dilim 8'de çatalla birlikte yükselir.
      parts.push({
        role: 'cab',
        center: [(cabRearX + cabFrontX) / 2, cabFloorY + 0.06, 0],
        size: [cabFrontX - cabRearX, 0.12, (model.b2 ?? model.b1) - 0.02],
      })
      if (detail === 'full') {
        // Yan korkuluklar + kontrol konsolu + tavan.
        for (const side of [-1, 1] as const) {
          parts.push({
            role: 'cab',
            center: [(cabRearX + cabFrontX) / 2, cabFloorY + 0.65, side * (cabHalfZ - 0.04)],
            size: [cabFrontX - cabRearX - 0.05, 1.1, 0.05],
          })
        }
        parts.push({
          role: 'cab',
          center: [cabFrontX - 0.1, cabFloorY + 1.0, 0],
          size: [0.16, 0.24, 0.8],
        })
        parts.push({
          role: 'overhead-guard',
          center: [(cabRearX + cabFrontX) / 2, cabTopY - 0.03, 0],
          size: [cabFrontX - cabRearX, 0.06, (model.b2 ?? model.b1) - 0.06],
        })
        // Korkuluk üst kuşağı — kabini açık platform yapan çizgi.
        for (const side of [-1, 1] as const) {
          parts.push({
            role: 'cab',
            center: [(cabRearX + cabFrontX) / 2, cabFloorY + 1.25, side * (cabHalfZ - 0.045)],
            size: [cabFrontX - cabRearX - 0.06, 0.05, 0.04],
          })
        }
        for (const side of [-1, 1] as const) {
          parts.push({
            role: 'overhead-guard',
            center: [cabRearX + 0.05, cabFloorY + 1.1, side * (cabHalfZ - 0.06)],
            size: [0.06, cabTopY - cabFloorY - 1.15, 0.06],
          })
        }
      } else {
        // Tek kabuk, aynı zarf: taban→tavan.
        parts.push({
          role: 'cab',
          center: [(cabRearX + cabFrontX) / 2, (cabFloorY + cabTopY) / 2, 0],
          size: [cabFrontX - cabRearX, cabTopY - cabFloorY, (model.b2 ?? model.b1) - 0.02],
        })
      }
      return parts
    }

    case 'carriage': {
      // Döner başlık (turret) — çatal yüzünün hemen gerisi.
      parts.push({
        role: 'carriage',
        center: [faceX - 0.12, 0.55, 0],
        size: [0.22, 0.8, 0.72],
      })
      // Yana itme kızağı: başlığın en geniş parçası — zarfı o belirlediği
      // için İKİ katmanda da durur (T20: zarf genişliği katmanla değişmez).
      parts.push({
        role: 'carriage',
        center: [faceX - 0.04, 0.32, 0],
        size: [0.06, 0.18, 1.1],
      })
      // Döndürme gövdesi — başlığın tanımlayıcı hacmi, iki katmanda da.
      parts.push({
        role: 'carriage',
        center: [faceX - 0.12, 1.05, 0],
        size: [0.18, 0.16, 0.5],
      })
      pushForkPair(parts, { faceX, model, detail })
      return parts
    }

    default:
      return parts
  }
}
