import {
  BENCH_VARIANTS,
  type BenchVariant,
  CASTOR_DIAMETER_M,
  OVERHEAD_CLEAR_M,
  OVERHEAD_SHELF_DEPTH_RATIO,
  SHELF_THICKNESS_M,
  TOP_THICKNESS_M,
} from './catalog'
import type { BenchNode } from './schema'

/**
 * Türetilmiş ölçüler — düğümün ne dediğinin TEK yorumu.
 *
 * Her okuma buradan geçiyor, çünkü üç ölçü alanı da opsiyonel: "boşsa
 * varyantın değeri" kuralı bir yerde yazılıp başka yerde tekrarlanırsa,
 * kullanıcının girdiği genişlik bazı parçalara işler bazılarına işlemez ve
 * masa kendi içinde ayrışır — ekranda hata yok, yalnız tabla ayakları
 * tutmuyor.
 */

export function variantOf(node: BenchNode): BenchVariant {
  return BENCH_VARIANTS[node.variant]
}

export function widthM(node: BenchNode): number {
  return node.width ?? variantOf(node).widthM
}

/** Tabla ÜST yüzeyinin kotu — toplam yükseklik değil. */
export function worktopYM(node: BenchNode): number {
  return node.height ?? variantOf(node).heightM
}

export function depthM(node: BenchNode): number {
  return node.depth ?? variantOf(node).depthM
}

export function overheadOf(node: BenchNode): BenchVariant['overhead'] {
  return node.overhead ?? variantOf(node).overhead
}

export function underOf(node: BenchNode): BenchVariant['under'] {
  return node.under ?? variantOf(node).under
}

export function hasCastors(node: BenchNode): boolean {
  return variantOf(node).castors
}

export function topKindOf(node: BenchNode): BenchVariant['top'] {
  return variantOf(node).top
}

export function hasMonitorStand(node: BenchNode): boolean {
  return variantOf(node).monitorStand
}

/**
 * Ayak boyu — tabla kotundan tablanın kendi kalınlığı ve (varsa) teker çapı
 * düşülerek.
 *
 * Teker tabla kotunu YÜKSELTMEZ: tekerlekli bir tezgâh da aynı çalışma
 * kotunda durur, ayakları o kadar kısalır. Tersini yapmak — tekeri ayağın
 * altına eklemek — mobil masayı sabitinden 100 mm yüksek çizerdi ve iki
 * masa yan yana konduğunda tablalar hizalanmazdı.
 */
export function legHeightM(node: BenchNode): number {
  const castor = hasCastors(node) ? CASTOR_DIAMETER_M : 0
  return Math.max(0.05, worktopYM(node) - TOP_THICKNESS_M - castor)
}

/** Üst rafın (ya da panonun) tabla üstündeki kotu. */
export function overheadShelfYM(node: BenchNode): number {
  return worktopYM(node) + OVERHEAD_CLEAR_M
}

/** Üst raf derinliği — tabla derinliğinin bir oranı, çünkü tam derinlikte bir
 *  raf çalışma alanını tamamen gölgeler. */
export function overheadShelfDepthM(node: BenchNode): number {
  return depthM(node) * OVERHEAD_SHELF_DEPTH_RATIO
}

/**
 * Toplam yükseklik — yerleştirme zarfının ve sürükleme sınırlarının okuduğu.
 *
 * Üst yapı varsa tepe orası; yoksa tabla üstü. Bunu `worktopYM` ile
 * karıştırmak, raflı bir masanın zarfını raf yokmuş gibi bildirmek olurdu ve
 * çarpışma denetimi masanın üstünden geçen her şeyi serbest sayardı.
 */
export function overallHeightM(node: BenchNode): number {
  const overhead = overheadOf(node)
  if (overhead === 'none') return worktopYM(node)
  return overheadShelfYM(node) + SHELF_THICKNESS_M
}

/** Zemindeki taban izi — genişlik × derinlik. */
export function footprintM(node: BenchNode): [number, number] {
  return [widthM(node), depthM(node)]
}
