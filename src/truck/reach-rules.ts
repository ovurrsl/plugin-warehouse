/**
 * ETV ↔ ETM kuralı ve yuva okuması — ölçüm, hüküm değil.
 *
 * Yayınlanmış iki olgu (plan §5.7):
 *   - `b4 = 0.940` → 800 mm'lik palet yüzü ayaklar ARASINA girer, yere iner.
 *   - `b4 = 0.790` → palet ayakların ÜZERİNDEN taşınır; bırakma kotu
 *     `h8 (+kapak) + pay`ın altına inemez.
 *
 * Kural yönelime bağlıdır: 1000 mm enlemesine bir yüz HİÇBİR reach'in
 * ayakları arasına girmez. `pay` bizim tahminimizdir ve bu yüzden buradaki
 * hiçbir fonksiyon "reddedildi" demez — panel cümleyi ölçümden kurar
 * (`metrics.ts`'in kendi kuralı: tahmine karşı hüküm, tahmini aklar).
 * Sert olabilen iki olgu yalnız yayınlanmış veriden çıkar: transpaletin
 * 0.12 m'lik stroku raf yuvasına hizmet edemez, ve yuva yüzeyi kaldırma
 * tavanının üstündeyse erişilemez.
 */

import { MAST_H3_CAP_M, MAST_TABLES } from '../handling/masts'
import type { TruckModel } from '../handling/models'
import type { Slot } from '../rack/slots'

export type StrideMode = 'straddle' | 'over-leg'

/** Ayak üstü kapak payı — h8'in üstündeki sac (yayınlanmış çizimden). */
export const LEG_COVER_M = 0.03

/** Bırakma payı — BİZİM tahminimiz; okunduğu her yerde bu notla. */
export const SET_DOWN_MARGIN_M = 0.02
export const SET_DOWN_MARGIN_NOTE =
  'Bırakma payı 20 mm bir çalışma tahminidir, yayınlanmış bir figür değil.'

/**
 * Palet ayakların arasına mı iner, üzerinden mi taşınır.
 *
 * Yalnız reach için anlamlı: forklift ve transpaletler paleti önden alır ve
 * yere kadar inebilir; turret döner başlıkla rafa bırakır — üçü de
 * `straddle` semantiğindedir (kot kısıtı yok).
 */
export function strideModeFor(model: TruckModel, faceWidthM: number): StrideMode {
  if (model.variant !== 'reach' || model.b4 === null) return 'straddle'
  // 5 mm tolerans: 0.940'lık açıklığa 0.938'lik yüz "girer" — milimetrik
  // eşitlik testi gerçek paleti reddederdi.
  return faceWidthM <= model.b4 - 0.005 ? 'straddle' : 'over-leg'
}

/** Çatalın inebileceği en düşük kot, moda göre. */
export function minSetDownY(model: TruckModel, mode: StrideMode): number {
  if (mode === 'straddle') return 0
  return (model.h8 ?? 0) + LEG_COVER_M + SET_DOWN_MARGIN_M
}

/**
 * Modelin kaldırma tavanı, metre — ya da mast verisi yokken `null`.
 *
 * Masted ailelerde sunulan tabloların/tavan haritasının maksimumu;
 * transpaletlerde yayınlanmış strok (mpt 0.120 fiziksel, ept 0.205 çatal
 * üstü). `null` yalnız "veri yok" demektir ve ondan hüküm çıkmaz.
 */
export function liftCeilingM(model: TruckModel): number | null {
  if (model.variant === 'hand-pallet') return 0.12
  if (model.variant === 'powered-pallet') return 0.205
  const capped = MAST_H3_CAP_M[model.id]
  if (capped !== undefined) return capped
  let best: number | null = null
  for (const table of model.mastTables) {
    const max = MAST_TABLES[table].h3MaxM
    if (max !== null && (best === null || max > best)) best = max
  }
  return best
}

export type SlotReading = {
  strideMode: StrideMode
  minSetDownY: number
  slotSurfaceY: number
  /** Yuva yüzeyi tavanın altında mı — yayınlanmış veriden çıkan sert olgu. */
  reachable: boolean
  liftCeilingM: number | null
  /** Reach'te 'unpublished': yüksek h3 + c>0.6'da nominal Q taahhüt edilemez. */
  capacityBasis: 'published' | 'unpublished'
}

/** Bir araç–yuva çifti hakkında panelin cümle kuracağı ölçümler. */
export function truckSlotReading(model: TruckModel, slot: Slot): SlotReading {
  const faceWidthM = slot.footprint[0]
  const strideMode = strideModeFor(model, faceWidthM)
  const surfaceY = slot.localPosition[1]
  const ceiling = liftCeilingM(model)
  return {
    strideMode,
    minSetDownY: minSetDownY(model, strideMode),
    slotSurfaceY: surfaceY,
    reachable: ceiling !== null && surfaceY <= ceiling + 1e-9,
    liftCeilingM: ceiling,
    capacityBasis: model.residualCapacityPublished ? 'published' : 'unpublished',
  }
}
