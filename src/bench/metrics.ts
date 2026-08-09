import {
  BENCH_VARIANTS,
  type BenchVariant,
  CASTOR_DIAMETER_M,
  FRONT_Z,
  MONITOR_BACK_INSET_M,
  MONITOR_HEIGHT_M,
  MONITOR_SCREEN_M,
  MONITOR_SIDE_INSET_M,
  OVERHEAD_CLEAR_M,
  OVERHEAD_SHELF_DEPTH_RATIO,
  ROLLER_DIAMETER_M,
  SCALE_EDGE_CLEAR_M,
  SCALE_PLATFORM_M,
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
 * Taşıyıcı güvertenin ÜST kotu — üstüne çalışılan yüzeyin kotu değil.
 *
 * Düz tablada ikisi aynı. Makaralı tezgâhta değil: orada çalışma yüzeyi
 * makaranın SIRTI, güverte ise makara yatağı ve bir makara çapı aşağıda durur.
 *
 * Bu ayrım olmadan makaralar düz tablanın üstüne oturuyordu; masanın çalışma
 * kotu 50 mm yükseliyor, yayımlanmış 920 mm zarfı aşıyor ve yan yana konan
 * makaralı-düz iki masanın yüzeyi basamaklanıyordu. Spec'in kendi cümlesi de
 * bunu söylüyor: "built-in rollers **or** smooth countertops" — makara yatağı
 * tablanın YERİNE geçen bir seçenek, üstüne konan bir donanım değil.
 */
export function deckTopYM(node: BenchNode): number {
  const worktop = worktopYM(node)
  return topKindOf(node) === 'rollers' ? worktop - ROLLER_DIAMETER_M : worktop
}

/**
 * Ayak boyu — güverte kotundan güvertenin kendi kalınlığı ve (varsa) teker
 * çapı düşülerek.
 *
 * Teker tabla kotunu YÜKSELTMEZ: tekerlekli bir tezgâh da aynı çalışma
 * kotunda durur, ayakları o kadar kısalır. Tersini yapmak — tekeri ayağın
 * altına eklemek — mobil masayı sabitinden 100 mm yüksek çizerdi ve iki
 * masa yan yana konduğunda tablalar hizalanmazdı.
 */
export function legHeightM(node: BenchNode): number {
  const castor = hasCastors(node) ? CASTOR_DIAMETER_M : 0
  return Math.max(0.05, deckTopYM(node) - TOP_THICKNESS_M - castor)
}

/**
 * Gömme terazi platformunun kenarı — tablaya SIĞDIRILMIŞ.
 *
 * Katalog değeri 500 mm sabit, ama derinlik 400 mm'ye kadar ayarlanabiliyor:
 * sabit platform dar bir tezgâhta tablanın 50 mm önünden ve arkasından dışarı
 * taşıyordu. Plan sembolü kendi kırpmasını zaten yapıyordu, 3B yapmıyordu —
 * yani iki görünüm aynı masayı farklı çiziyordu. Tek fonksiyon, iki okuyucu.
 */
export function scalePlatformM(node: BenchNode): number {
  const room = Math.min(widthM(node), depthM(node)) - SCALE_EDGE_CLEAR_M
  return Math.max(0.1, Math.min(SCALE_PLATFORM_M, room))
}

/**
 * Ekran standının X kotu — sağ kenardan içeri, ama ekranı tabladan
 * taşırmayacak kadar.
 *
 * Çıplak `width / 2 - 0.2` yazılıydı ve dar bir tezgâhta ekranın yarısı
 * kenarın dışına düşüyordu. Kırpma zarfa göre: stand ekranın yarısından daha
 * kenara gidemiyor.
 */
export function monitorStandXM(node: BenchNode): number {
  const half = widthM(node) / 2
  return Math.max(0, Math.min(half - MONITOR_SIDE_INSET_M, half - MONITOR_SCREEN_M[0] / 2))
}

/**
 * Ekran standının Z kotu — ARKA kenarda (`-FRONT_Z`), ekran operatöre baksın.
 *
 * Aynı kırpma: sığmayan bir kaçıklık işareti çevirip standı operatörün önüne
 * atardı.
 */
export function monitorStandZM(node: BenchNode): number {
  const half = depthM(node) / 2
  const inset = Math.min(half - MONITOR_SCREEN_M[2] / 2, Math.max(0, half - MONITOR_BACK_INSET_M))
  return -FRONT_Z * inset
}

/** Ekran standının tepesi — tabla kotundan ekranın üst kenarına. */
export function monitorTopYM(node: BenchNode): number {
  return worktopYM(node) + MONITOR_HEIGHT_M + MONITOR_SCREEN_M[1]
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
 * Toplam yükseklik — yerleştirme zarfının, çarpışmanın, seçim kolliderinin ve
 * sürükleme sınırlarının okuduğu TEK sayı.
 *
 * Tablanın üstüne çıkan HER ŞEY buraya girmek zorunda ve girmeyen bir parça
 * sessiz bir hata üretiyor: zarf eksik bildirildiğinde masanın üstünden geçen
 * şey serbest sayılır, tıklama ekrandaki parçaya isabet etmez.
 *
 * Daha önce yalnız üst yapı sayılıyordu. Sayılmayan ikisi:
 *
 *   - **Ekran standı** — terazi tezgâhında tablanın 670 mm üstüne çıkıyor ve o
 *     varyantın üst yapısı `none`, yani zarf tam tabla kotu bildiriliyordu.
 *   - **Alet panosu** — tersi yönde: pano dikmelerle aynı kotta bitiyor ama
 *     zarf raf kalınlığı kadar FAZLA bildiriliyordu.
 *
 * Makaralar artık taşmıyor (bkz. `deckTopYM`) — makara sırtı tam tabla kotu.
 *
 * `bench.test.ts` bu fonksiyonun sonucunu parça listesinin gerçek tepesiyle
 * BİREBİR karşılaştırıyor; eksik de fazla da kırmızı yanıyor.
 */
export function overallHeightM(node: BenchNode): number {
  let top = worktopYM(node)

  const overhead = overheadOf(node)
  if (overhead === 'shelf') top = Math.max(top, overheadShelfYM(node) + SHELF_THICKNESS_M)
  // Pano dikmelerin arasını dolduruyor, üstlerine çıkmıyor.
  else if (overhead === 'toolboard') top = Math.max(top, overheadShelfYM(node))

  if (hasMonitorStand(node)) top = Math.max(top, monitorTopYM(node))

  return top
}

/** Zemindeki taban izi — genişlik × derinlik. */
export function footprintM(node: BenchNode): [number, number] {
  return [widthM(node), depthM(node)]
}
