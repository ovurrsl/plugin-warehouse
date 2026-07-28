/**
 * Mast tabloları — elimizde olan satırlar, ve olmayanların dürüst kaydı.
 *
 * Bir mast konfigürasyonu bir TABLO SATIRIDIR, bir aralık değil. Üretici
 * h3 = 5.000 ile 5.400 satırlarını basmışsa 5.200 diye bir konfigürasyon
 * YOKTUR; aradan enterpole edilen her satır sipariş edilemeyen bir makine
 * uydurur. Bu yüzden buradaki erişimciler yalnız satır döndürür, hesap değil
 * — satır yoksa `null`, ve panel "kayıtlı mast satırı bu modelde sunulmuyor"
 * der, sessizce düzeltmez.
 *
 * Elimizde satır satır verisi olan tek aile forklift (EFG, grup başına tek
 * 3000 ZT satırı). Reach'in satır tabloları, turret'in tüm satırları ve
 * forklift'in kalan satırları YAYINLANMAMIŞ DEĞİL, ÇIKARILMAMIŞ — hepsi
 * `gaps.ts`'te kayıtlı ve aralıktan satır uydurulmaz.
 *
 * Türetilmiş sabitler (`REACH_H4_OVER_H3_M` vb.) satırlara YAZILMAZ — testle
 * iddia edilir ve gelecekte girilecek satırların hakemi olarak dururlar,
 * `chains.ts`'in taban izi için yaptığı işin mast karşılığı.
 */

import type { TruckModelId } from './models'

const mm = (value: number) => value / 1000

export type MastType = 'ZT' | 'ZZ' | 'DZ'

// Kataloglanan filonun sunduğu tablolar. Diğer aileler/seriler (BR4, reach
// grup C) dokümanda duruyor; modeli eklenmeden tablosu eklenmez.
export type MastTableId = 'efg-a' | 'efg-b' | 'reach-a' | 'reach-b' | 'ekx-br5'

export type MastTable = {
  id: MastTableId
  label: string
  types: readonly MastType[]
  /** Yayınlanmış grup aralığı, metre. `null` = aralık bile çıkarılmamış. */
  h3MinM: number | null
  h3MaxM: number | null
}

export const MAST_TABLES: Record<MastTableId, MastTable> = {
  'efg-a': {
    id: 'efg-a',
    label: 'Forklift gövde grubu A',
    types: ['ZT', 'ZZ', 'DZ'],
    h3MinM: mm(2020),
    h3MaxM: mm(7000),
  },
  'efg-b': {
    id: 'efg-b',
    label: 'Forklift gövde grubu B',
    types: ['ZT', 'ZZ', 'DZ'],
    h3MinM: mm(2020),
    h3MaxM: mm(7000),
  },
  'reach-a': {
    id: 'reach-a',
    label: 'Reach grup A (mast eğimli)',
    types: ['DZ'],
    h3MinM: mm(4250),
    h3MaxM: mm(9110),
  },
  'reach-b': {
    id: 'reach-b',
    label: 'Reach grup B (taşıyıcı eğimli)',
    types: ['DZ'],
    h3MinM: mm(6200),
    h3MaxM: mm(11510),
  },
  'ekx-br5': {
    id: 'ekx-br5',
    label: 'VNA yapı serisi BR5 (80 V)',
    types: ['ZT', 'DZ'],
    h3MinM: null,
    // Tablo düzeyinde tavan yok: BR5'in tavanı modele göre yayınlanmış ve
    // MAST_H3_CAP_M'de durur.
    h3MaxM: null,
  },
}

export type MastRowId = 'efg-a-zt-3000' | 'efg-b-zt-3000'

export type MastRow = {
  id: MastRowId
  table: MastTableId
  type: MastType
  h1: number
  h2: number
  h3: number
  h4: number
}

/**
 * Elimizdeki satırların TAMAMI. İki satırın aynı h3'te farklı h4 vermesi
 * (3.590 / 3.612) tek bir "tepe payı sabiti"nin bile var olmadığının kanıtı —
 * bu yüzden hiçbir satır komşusundan türetilmez.
 */
export const MAST_ROWS: readonly MastRow[] = [
  {
    id: 'efg-a-zt-3000',
    table: 'efg-a',
    type: 'ZT',
    h1: mm(2060),
    h2: mm(150),
    h3: mm(3000),
    h4: mm(3590),
  },
  {
    id: 'efg-b-zt-3000',
    table: 'efg-b',
    type: 'ZT',
    h1: mm(2067),
    h2: mm(150),
    h3: mm(3000),
    h4: mm(3612),
  },
]

/**
 * Model bazlı h3 tavanı — tablo aralığının veremediği yerde.
 *
 * Reach'te tavan sunulan tabloların birleşiminden çıkar (`rt-1800` A+B →
 * 11.510); burada tekrar YAZILMAZ. `tt`'de tablo aralıksız, tavan modele göre
 * yayınlanmış — tek kaynağı burası. `tt-1600`'ün 18.0'ı ⚠: 14.5 üzeri
 * satırlar özel konfigürasyondur (gaps).
 */
export const MAST_H3_CAP_M: Partial<Record<TruckModelId, number>> = {
  'tt-1600': mm(18000),
}

// ── Türetilmiş kimlikler — satır hakemleri ──────────────────────────────────
// chains.ts'in kuralı burada da geçerli: bu sabitler eksik bir satırı
// HESAPLAMAK için değil, girilen bir satırı DOĞRULAMAK içindir.

/** Reach: `h4 = h3 + 0.746` — 39 yayınlanmış satırda doğrulanmış. */
export const REACH_H4_OVER_H3_M = mm(746)

/** Reach: `h2 = h1 − 0.730` — aynı 39 satırda doğrulanmış. */
export const REACH_H1_OVER_H2_M = mm(730)

/** VNA: `h4 = h3 + 2.550` — her zaman (kabin + koruma çerçevesi). */
export const EKX_H4_OVER_H3_M = mm(2550)

/** Forklift ZT: serbest kaldırma `h2 = 0.150` sabit. ZZ/DZ tam serbest. */
export const EFG_ZT_H2_M = mm(150)

// ── Erişimciler — satır döndürür, hesap değil ───────────────────────────────

/** Modelin sunduğu tabloların satırları. Reach/VNA için bugün boş — doğru. */
export function mastRowsFor(model: { mastTables: readonly MastTableId[] }): MastRow[] {
  return MAST_ROWS.filter((row) => model.mastTables.includes(row.table))
}

/** Kayıtlı satır kimliği bu modelde sunuluyorsa satır, yoksa `null`. */
export function mastRowFor(
  model: { mastTables: readonly MastTableId[] },
  id: MastRowId,
): MastRow | null {
  const row = MAST_ROWS.find((r) => r.id === id)
  if (!row || !model.mastTables.includes(row.table)) return null
  return row
}

/**
 * Tam h3 eşleşmesi — yarım milimetre toleransla, `chains.CHAIN_TOLERANCE_M`
 * ile aynı gerekçe. Satırlar ARASINDAKİ bir h3 asla satır döndürmez;
 * enterpolasyonla uydurulmuş konfigürasyon bu fonksiyondan çıkamaz.
 */
export function mastRowMatchingH3(
  model: { mastTables: readonly MastTableId[] },
  h3: number,
): MastRow | null {
  return mastRowsFor(model).find((row) => Math.abs(row.h3 - h3) <= 0.0005) ?? null
}
