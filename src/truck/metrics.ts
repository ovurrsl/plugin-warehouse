/**
 * Bir aracın plandaki ve hacimdeki zarfı — katalogdan OKUNUR, türetilmez.
 *
 * Yerel çerçeve (plan §4.2): origin zarfın ortası, ileri = +X. Arka yüz
 * `x = −l1/2`, çatal uçları `x = +l1/2` — çünkü `l1` çatal dahil toplam
 * uzunluktur ve zincirler bunu her katalog satırında doğruluyor.
 */

import type { MastRow } from '../handling/masts'
import { MAST_ROWS } from '../handling/masts'
import {
  envelopeWidthM,
  TRUCK_MODELS,
  type TruckModel,
  type TruckModelId,
} from '../handling/models'

export function modelOf(id: TruckModelId): TruckModel {
  return TRUCK_MODELS[id]
}

export function mastRowOf(rowId: string | null): MastRow | null {
  if (!rowId) return null
  return MAST_ROWS.find((row) => row.id === rowId) ?? null
}

/** Plan uzunluğu = l1. Çatallar dahil — plan sembolü ve çarpışma kutusu
 *  çatal ucuna kadar uzanır, gövdeye kadar değil. */
export function planLengthM(model: TruckModel): number {
  return model.l1
}

/** Plan genişliği = yayınlanmış en geniş kesit (`envelopeWidthM`):
 *  `tt`'de kabin (1.45), gerisinde b1. `b10 + lastik` ASLA girmez —
 *  forklift'te 0.904 + 0.178 = 1.082 > b1 1.060, yani ⚠-tahminden
 *  yayınlanmışı aşan bir zarf üretirdi. */
export function planWidthM(model: TruckModel): number {
  return envelopeWidthM(model)
}

/**
 * Zarf yüksekliği: yayınlanmış dikey satırların maksimumu, artı seçilmiş
 * mastın kapalı boyu. `tt`'de bu h12 = 3.930'dur (koruma çerçevesi), kabin
 * tavanı h6 = 2.550 değil. Mast satırı seçilmemişse mast yüksekliği bilinmez
 * ve zarf yayınlanmış gövde satırlarından okunur — uydurulmaz.
 */
export function overallHeightM(model: TruckModel, mastRow: MastRow | null): number {
  const h14Max = typeof model.h14 === 'number' ? model.h14 : (model.h14?.[1] ?? 0)
  return Math.max(model.h6 ?? 0, model.h12 ?? 0, model.h13 ?? 0, h14Max, mastRow?.h1 ?? 0)
}

/** Çatal ucunun yerel X'i. `l1` çatal dahil olduğu için tam +l1/2. */
export function forkTipX(model: TruckModel): number {
  return model.l1 / 2
}

/** Çatal sırtının (yük yüzü) yerel X'i: arka yüz + l2. */
export function forkFaceX(model: TruckModel): number {
  return -model.l1 / 2 + model.l2
}

/**
 * Dönüş merkezinin yerel X'i, ya da merkez yayınlanmamışsa `null`.
 *
 * forklift'te ön aks (y + 0.190, Wa ile 7/7 teyitli) — ve zarfın ortasının
 * 27.5 mm ARKASINDA kalır; işaret testi T23 tam bunu kilitler, çünkü ters
 * işaret 0°'de görünmez ve yayı 55 mm yanlış yere oturtur.
 */
export function waPivotLocalX(model: TruckModel): number | null {
  if (model.waPivotFromRear === null) return null
  return model.waPivotFromRear - model.l1 / 2
}

/**
 * Çatal açıklığı (dış yüzler), metre.
 *
 * Yayınlanmış b5 varsa o; reach'te ayarlanabilir aralığın ORTASI (tabloda
 * teslim ayarı yok); forklift'te b5 yayınlanmamış → 0.68 — ISO 2A taşıyıcıda
 * 1150 çatal için alışılmış açıklık, TAHMİN, yalnız görsele girer: çarpışma
 * kutusu ve plan zarfı bunu hiç okumaz.
 */
export function forkSpreadM(model: TruckModel): number {
  if (typeof model.b5 === 'number') return model.b5
  if (model.b5) return (model.b5.min + model.b5.max) / 2
  return 0.68
}
