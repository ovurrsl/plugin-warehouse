/**
 * Tezgâh ailesi — altı varyant, tek kind.
 *
 * ## Neden tek kind
 *
 * Altısı da aynı makine: dört ayaklı metal çerçeve, üstünde tabla, altında
 * raf, kimisinde üst raf ya da alet panosu. Farkları ölçüler ve birkaç
 * donanım. Konveyör ailesinin yaptığı şeyin aynısı — yedi alt kind tek
 * geometri havuzunu paylaşıyor — ve aynı sebeple: altı ayrı kind altı ayrı
 * `nodeRegistry` girdisi, altı panel, altı araç ve altı ayrı önbellek
 * demekti; şekli belirleyen şey ise tek bir varyant alanı.
 *
 * ## Ölçülerin kaynağı
 *
 * Zarf ölçüleri (genişlik, yükseklik, derinlik) kullanıcının kendi eski
 * uygulamasının spec dosyalarından birebir alındı — `asset://<ad>` ile
 * taşınan mesh'lerin yayınlanmış varsayılanları. Bunlar KAYNAK.
 *
 * `heightM` her varyantta 900–920 mm bandında ve TABLA kotu olarak okundu:
 * yayınlanmış zarf yüksekliği bu, ve üstüne raf koyan varyantın toplam
 * yüksekliği tek başına 920 mm'ye sığmaz. 900–920 mm ayakta çalışılan bir
 * tezgâhın standart çalışma kotudur; üst yapı bu kotun ÜSTÜNE ekleniyor.
 *
 * Zarfın içindeki her şey — ayak profili, tabla kalınlığı, raf sayısı,
 * çekmece yüksekliği, teker çapı — spec'te YOK. Hepsi bu dosyada SEÇİLMİŞ
 * VARSAYILAN olarak işaretli; hiçbiri bir katalogdan gelmiyor ve öyleymiş
 * gibi okunmamalı.
 */

export type BenchVariantId =
  | 'dispatch-packing'
  | 'mail-order-packing'
  | 'processing'
  | 'weighing-scale'
  | 'mobile-workbench'
  | 'eco'

export type BenchVariant = {
  id: BenchVariantId
  label: string
  /** Tabla genişliği, metre — KAYNAK: eski uygulamanın spec dosyası. */
  widthM: number
  /** Tabla üst yüzeyinin kotu, metre — KAYNAK: aynı spec (zarf yüksekliği). */
  heightM: number
  /** Tabla derinliği, metre — KAYNAK: aynı spec. */
  depthM: number
  /** Tablanın üstünde raf/pano taşıyan üst yapı var mı. */
  overhead: 'none' | 'shelf' | 'toolboard'
  /** Alt raf: açık raf, çekmece bloğu, ya da hiç. */
  under: 'shelf' | 'drawers' | 'none'
  /** Tabla yüzeyi: düz ahşap, makaralı, ya da gömme terazi platformu. */
  top: 'timber' | 'rollers' | 'scale'
  /** Tekerlekli mi — tekerler tabla kotunu YÜKSELTMEZ, ayak boyundan düşülür. */
  castors: boolean
  /** Terazi okuma ekranı için ayaklı stand. */
  monitorStand: boolean
}

const mm = (value: number) => value / 1000

/**
 * Altı varyant. Zarf üçlüsü spec'ten, donanım bayrakları spec'in tarif
 * cümlesinden okundu (ör. "caster wheels" → `castors`, "recessed platform
 * scale, monitor stand" → `top: 'scale'` + `monitorStand`).
 */
export const BENCH_VARIANTS: Record<BenchVariantId, BenchVariant> = {
  'dispatch-packing': {
    id: 'dispatch-packing',
    label: 'Dispatch Packing Table',
    widthM: mm(2000),
    heightM: mm(920),
    depthM: mm(900),
    overhead: 'shelf',
    under: 'shelf',
    top: 'rollers',
    castors: false,
    monitorStand: false,
  },
  'mail-order-packing': {
    id: 'mail-order-packing',
    label: 'Mail Order Packing Table',
    widthM: mm(1830),
    heightM: mm(920),
    depthM: mm(915),
    overhead: 'shelf',
    under: 'shelf',
    top: 'timber',
    castors: false,
    monitorStand: false,
  },
  processing: {
    id: 'processing',
    label: 'Processing Bench',
    widthM: mm(1600),
    heightM: mm(900),
    depthM: mm(750),
    overhead: 'toolboard',
    under: 'drawers',
    top: 'timber',
    castors: false,
    monitorStand: false,
  },
  'weighing-scale': {
    id: 'weighing-scale',
    label: 'Weighing Scale Bench',
    widthM: mm(1400),
    heightM: mm(900),
    depthM: mm(750),
    overhead: 'none',
    under: 'shelf',
    top: 'scale',
    castors: false,
    monitorStand: true,
  },
  'mobile-workbench': {
    id: 'mobile-workbench',
    label: 'Mobile Workbench',
    widthM: mm(1220),
    heightM: mm(900),
    depthM: mm(910),
    overhead: 'none',
    under: 'drawers',
    top: 'timber',
    castors: true,
    monitorStand: false,
  },
  eco: {
    id: 'eco',
    label: 'Eco Table',
    widthM: mm(1200),
    heightM: mm(900),
    depthM: mm(600),
    overhead: 'none',
    under: 'none',
    top: 'timber',
    castors: false,
    monitorStand: false,
  },
}

export const BENCH_VARIANT_IDS = Object.keys(BENCH_VARIANTS) as [
  BenchVariantId,
  ...BenchVariantId[],
]

/**
 * Tezgâhın ÖN yüzü: **+Z**. Operatör orada durur.
 *
 * Bir tezgâhın ön yüzü tanımlanmadan donanımı yerleştirilemez, çünkü donanımın
 * yarısı operatöre bakmak zorunda (çekmece ona açılır, ekran ona döner) ve öteki
 * yarısı ondan uzağa (üst raf ve alet panosu görüşünü kesmemeli, duvara
 * dayanmalı). Yön yazılmadığı sürece her parça kendi işaretini seçiyordu ve
 * ikisi aynı masada zıt yüzlere düşebiliyordu — ekranda hata yok, yalnız
 * çekmecesi duvara açılan bir masa.
 *
 * +Z seçildi çünkü host'un yön göstergesi ±Z'ye kilitli (`facingIndicator`) ve
 * kamyonda olduğu gibi ileri yönü +X olan bir kind göstergeyi kullanamıyor.
 * Tezgâhın ön yüzünü +Z yapmak göstergeyi bedava veriyor.
 *
 * Kural: operatöre bakan her parça `FRONT_Z * ...`, arkaya bakan her parça
 * `-FRONT_Z * ...` yazar. Çıplak işaret yazan bir parça bu kuralın dışında
 * kalır ve sessizce ters dönebilir.
 */
export const FRONT_Z = 1

/**
 * Zarfın içindeki ölçüler — HİÇBİRİ katalogdan gelmiyor.
 *
 * Spec dosyaları yalnız dış üçlüyü yayınlıyor. Aşağıdakiler o zarfa oturan,
 * gerçek mobilyaya bakarak seçilmiş değerler; bir üreticinin tablosu
 * değiller ve öyle sunulmamalılar. Değiştirilmeleri serbest — hiçbir
 * kapasite hesabına girmiyorlar, yalnız görünüşü sürüyorlar.
 */
export const LEG_M = mm(60) // kare kutu profil kenarı — SEÇİLMİŞ VARSAYILAN
export const TOP_THICKNESS_M = mm(38) // ahşap tabla kalınlığı — SEÇİLMİŞ VARSAYILAN
export const APRON_HEIGHT_M = mm(80) // tabla altı çevre kirişi — SEÇİLMİŞ VARSAYILAN
export const APRON_THICKNESS_M = mm(25)
export const UNDER_SHELF_Y_M = mm(200) // alt rafın zeminden kotu — SEÇİLMİŞ VARSAYILAN
export const SHELF_THICKNESS_M = mm(22)
export const DRAWER_HEIGHT_M = mm(140) // tek çekmece yüzü — SEÇİLMİŞ VARSAYILAN
export const DRAWER_GAP_M = mm(6)
export const DRAWER_COUNT = 4
export const OVERHEAD_POST_M = mm(40) // üst yapı dikmesi — SEÇİLMİŞ VARSAYILAN
export const OVERHEAD_CLEAR_M = mm(520) // tablanın üstündeki serbest yükseklik
export const OVERHEAD_SHELF_DEPTH_RATIO = 0.45 // üst raf, tabla derinliğinin oranı
export const TOOLBOARD_THICKNESS_M = mm(18)
export const CASTOR_DIAMETER_M = mm(100) // teker çapı — SEÇİLMİŞ VARSAYILAN
export const CASTOR_INSET_M = mm(90)
export const ROLLER_DIAMETER_M = mm(50) // sevkiyat masasının tabla makarası
export const ROLLER_PITCH_M = mm(90)
export const SCALE_PLATFORM_M = mm(500) // gömme terazi platformu kenarı
export const SCALE_RECESS_M = mm(12)
/** Terazi platformunun tabla kenarına bırakması gereken pay — platform dar bir
 *  tezgâhta bu payla birlikte küçülüyor, tablanın dışına taşmıyor. */
export const SCALE_EDGE_CLEAR_M = mm(120)
export const MONITOR_POST_M = mm(35)
export const MONITOR_HEIGHT_M = mm(450) // tabladan ekranın altına
export const MONITOR_SCREEN_M: readonly [number, number, number] = [mm(320), mm(220), mm(30)]
/** Ekran standının tablanın sağ kenarından içeri kaçıklığı. */
export const MONITOR_SIDE_INSET_M = mm(200)
/** Ekran standının ARKA kenardan içeri kaçıklığı — stand arka kenarda durur,
 *  ekran operatöre bakar. */
export const MONITOR_BACK_INSET_M = mm(100)

/** Aile paleti — parça rolü başına tek renk, vertex attribute'una yazılıyor. */
export const PALETTE = {
  /** Boyalı çelik çerçeve. */
  frame: '#3f4a56',
  /** Ahşap tabla ve raf. */
  timber: '#b98a52',
  /** Galvaniz makara ve teker göbeği. */
  steel: '#9aa3ab',
  /** Çekmece yüzü — çerçeveden bir ton açık, yüzler okunabilsin. */
  drawer: '#55616e',
  /** Terazi platformu: paslanmaz. */
  scale: '#c9ced3',
  /** Ekran yüzü. */
  screen: '#1c2126',
  /** Teker lastiği. */
  tyre: '#2b2f33',
} as const
