/**
 * Mast kinematiği — uçları yayınlanmış figürlere birebir oturan tek doğru.
 *
 * `mainY = 0` → mast tepesi tam `h1` (kapalı boy), `mainY = h3` → tam `h4`
 * (açık boy). Stroğu "eşit dağıtmak" reach'te `h3 + 0.730` verirdi,
 * yayınlanmış `h4 = h3 + 0.746`'ya karşı 16 mm hata — ve o 16 mm mast
 * başında sonsuza kadar yaşardı. Uçları çivileyip arayı doğrusal almak,
 * yayınlanmamış bir ara değeri uydurmadan iki yayınlanmış ucu da doğru
 * çizen tek seçenektir.
 */

import type { MastRow } from '../handling/masts'

/** Mast tepesinin Y'si, çatal `mainY`'deyken. */
export function mastTopY(row: MastRow, mainY: number): number {
  if (mainY <= row.h2) return row.h1
  return row.h1 + ((row.h4 - row.h1) * (mainY - row.h2)) / (row.h3 - row.h2)
}

export type MastPose = {
  /** İç kademenin (stage1) Y ötelenmesi. */
  stage1Y: number
  /** Taşıyıcının stage1 İÇİNDEKİ yerel Y'si. `stage1Y + carriageY = forkHeight`. */
  carriageY: number
}

/**
 * Park pozu: çatal kotundan gövde ötelemeleri.
 *
 * Serbest kaldırma bölgesinde (`mainY ≤ h2`) yalnız taşıyıcı yükselir ve
 * mast tepesi kımıldamaz — ZT'nin tanımı budur ve `mastTopY`'nin ilk dalı
 * aynı eşiği okur, iki fonksiyon ayrışamaz. Üstünde kademe, tepeyi `h4`'e
 * taşıyan aynı oranla çıkar.
 *
 * Satır yoksa kademe hareket edemez (stroğu bilinmiyor); taşıyıcı yine
 * çizilir ki `forkHeight` alanı ölü görünmesin, ve panel invariant'ı mast
 * satırının seçilmediğini söyler.
 */
export function mastPose(row: MastRow | null, forkHeight: number): MastPose {
  if (!row) return { stage1Y: 0, carriageY: forkHeight }
  const clamped = Math.min(Math.max(forkHeight, 0), row.h3)
  const stage1Y = mastTopY(row, clamped) - row.h1
  return { stage1Y, carriageY: clamped - stage1Y }
}
