/**
 * Model kataloğu — 21 makine, 22 satır, hepsi yayınlanmış figür.
 *
 * Kaynak: `docs/vehicle-data-vdi.md` (oradaki her satır üretici spec sheet'ine
 * atıflı). Kodda hiçbir ölçü ikinci kez yazılmaz: buradan okunur, ve buradaki
 * her satır `models.test.ts`'te `chains.ts`'in hakemliğinden geçer — zincir
 * kapanmıyorsa sayı yanlış kopyalanmıştır.
 *
 * ## Kimlikler markasızdır ve kalıcıdır
 *
 * Model kimliği kullanıcı verisine girer (kaydedilmiş sahnedeki düğüm hangi
 * makine olduğunu bu dizeyle söyler) ve hukuki bir sebeple sonradan yeniden
 * adlandırılamaz. Bu yüzden kimlik işlevsel addır — `forklift-1600`,
 * `rt-2500-narrow` — üretici kodu değil. Üretici adı ve model kodu yalnız
 * `label` ile `source` atıf dizelerinde durur; kind adına, dosya adına ve
 * panel etiketine girmez. Aile önekleri:
 *
 *   `mpt`      manuel transpalet          (hand-pallet)
 *   `ept`      elektrikli transpalet      (powered-pallet)
 *   `forklift` karşı ağırlıklı forklift   (forklift)
 *   `rt`       reach truck                (reach)
 *   `tt`       üç yönlü VNA istifleyici   (turret)
 *
 * Sayı, kimlikteki taşıma kapasitesidir (kg); `mpt`'de çatal genişlik×boy
 * (mm), çünkü o ailede kapasite dört varyantta da aynı.
 *
 * Birim: metre (mm() sınırda çevirir) · kg · km/h · m/s.
 */

import type { TruckVariant } from './catalog'
import type { MastTableId } from './masts'

/** Tablolar mm basıyor; kaynakla diff'lenebilirlik için sınırda çevrilir. */
const mm = (value: number) => value / 1000

/**
 * VDI 2198 4.34. Alanlar YÜK ÖLÇÜSÜYLE adlandırılır, "boyuna/enlemesine" ile
 * değil — EFG ve ETV tabloları iki sütunu ters sırayla basıyor ve konumsal bir
 * tuple bunu sessizce takas ederdi. Takas 50–200 mm'lik, hiçbir yerde
 * patlamayan bir koridor hatası verir.
 */
export type AstPair = { load1000x1200: number; load800x1200: number }

export type TruckModelId =
  | 'mpt-520x1150'
  | 'mpt-520x950'
  | 'mpt-520x795'
  | 'mpt-680x1150'
  | 'ept-2500'
  | 'ept-2500-compact'
  | 'forklift-1300'
  | 'forklift-1500'
  | 'forklift-1600-short'
  | 'forklift-1600'
  | 'forklift-1800-short'
  | 'forklift-1800'
  | 'forklift-2000'
  | 'rt-1800'
  | 'rt-2000'
  | 'rt-2500-narrow'
  | 'rt-2500'
  | 'tt-1000'
  | 'tt-1200'
  | 'tt-1400'
  | 'tt-1600-short'
  | 'tt-1600'

export type TruckModel = {
  id: TruckModelId
  variant: TruckVariant
  /** Atıf — kind adına, dosya adına, panel etiketine girmez. */
  label: string
  source: string
  // Taban izi ve zarf
  l1: number
  l2: number
  b1: number
  /** Kabin genişliği — `tt`'de 1.45 > b1 1.21; zarf bunu kaybedemez. */
  b2: number | null
  /** Ayak iç açıklığı — yalnız reach. 0.79 ile 0.94 arasındaki fark palet
   *  alma mantığını değiştirir (`rt-2500-narrow` paleti ayakların üzerinden
   *  taşır, diğerleri arasına indirir). */
  b4: number | null
  /** Çatal açıklığı. Reach'te AYARLANABİLİR (aralık), forklift'te
   *  yayınlanmamış (b3=0.980 ISO taşıyıcıdır, çatal açıklığı değil). */
  b5: number | { min: number; max: number } | null
  /** Ön iz genişliği. Reach'te yayınlanmamış → null, gaps.ts'te kayıtlı. */
  b10: number | null
  b11: number | null
  y: number
  /** Yük mesafesi. `mpt`'de yayınlanmamış → null; Ast tablodan okunur,
   *  formülden değil. */
  x: number | null
  fork: { s: number; e: number; length: number }
  /** Yük merkezi mesafesi. */
  c: number
  /** Nominal kapasite, kg. */
  Q: number
  h6: number | null
  h7: number | null
  h8: number | null
  h13: number | null
  /** `ept`'te min/maks ÇİFT (1.215/1.275) — tek sayı seçmek uydurmak olur. */
  h14: number | readonly [number, number] | null
  /** Arka sarkma — forklift zincirinin 0.190'ı (Wa ile 7/7 teyitli).
   *  Reach/turret'te farklı kavramlar var (0.210 tahrik aksı, z) ve bu alana
   *  YAZILMAZ — yanlış zincire girerler. */
  rearOverhang: number | null
  /** `tt`'de null — KALICI. Doldurulmaz; gaps.ts'te karşılığı vardır. */
  ast: AstPair | null
  Wa: number | null
  /** Dönüş merkezinin arka yüzden uzaklığı (plan §4.2). null = merkez
   *  yayınlanmamış, daire çizilmez. */
  waPivotFromRear: number | null
  /** Sunulmayan paket `null`dır, asla 0 — kaynakta "0 km/h" yazması sütunun
   *  boş olduğu anlamına gelir, aracın hareketsiz olduğu değil. */
  travelKmh: { laden: number | null; efficiency: number | null; plus: number | null }
  /** Yüklü değerler; yüksüz farklıysa notlarda. */
  liftMs: number | null
  lowerMs: number | null
  reachMs: number | null
  serviceWeightKg: number
  /** KÜME: `rt-2500-narrow` yalnız A, `rt-1800` A+B, `rt-2000`/`rt-2500`
   *  A+B+C. Aralıktan satır uydurulmaz. */
  mastTables: readonly MastTableId[]
  /** Reach'te false — rezidüel kapasite eğrisi yayınlanmamış, yüksek
   *  h3 + c>0.6 kombinasyonlarında nominal Q taahhüt edilemez. */
  residualCapacityPublished: boolean
  notes: readonly string[]
}

// ── Manuel transpalet (4 varyant) ───────────────────────────────────────────
// Ortak: l2=380 · h13=51 (sınıfının en alçağı) · h14=1237 · b10=109 · b11=370.
// Sürüş motoru yok: travelKmh tümü null. Kaldırma pompa darbesiyle (m/s değil).
// Ast/Wa çıkarımımızda yalnız standart 520×1150 için yayınlanmış — kısa çatal
// varyantlarına kopyalanmaz (Wa=1274 dört varyantta sabit olamaz, y farklı).

const MPT_SOURCE = 'AM 15l factsheet + specsheet TR 07/2026, VDI 2198'

const mptCommon = {
  variant: 'hand-pallet' as TruckVariant,
  source: MPT_SOURCE,
  l2: mm(380),
  b2: null,
  b4: null,
  b10: mm(109),
  b11: mm(370),
  x: null,
  Q: 1500,
  h6: null,
  h7: null,
  h8: null,
  h13: mm(51),
  h14: mm(1237),
  rearOverhang: null,
  waPivotFromRear: null,
  travelKmh: { laden: null, efficiency: null, plus: null },
  liftMs: null,
  lowerMs: mm(90), // 0.09 yüklü; yüksüz 0.02 notta
  reachMs: null,
  mastTables: [] as const,
  residualCapacityPublished: true,
}

// ── Elektrikli transpalet (1 makine, 2 platform satırı) ─────────────────────
// Kompakt platformda l1 −103, l2 −103, Ast −108 — üçü YAYINLANMIŞ delta.
// −103 ile −108'in uyuşmaması Ast'ın l1'den türetilemeyeceğinin kanıtıdır ve
// models.test.ts bunu kilitler.

const EPT_SOURCE = 'ERE 225i factsheet + specsheet TR 07/2026, VDI 2198'

const eptCommon = {
  variant: 'powered-pallet' as TruckVariant,
  source: EPT_SOURCE,
  b1: mm(770),
  b2: null,
  b4: null,
  b5: mm(535),
  b10: mm(512),
  b11: mm(363),
  y: mm(1255),
  x: mm(898),
  fork: { s: mm(56), e: mm(172), length: mm(1150) },
  c: mm(600),
  Q: 2500,
  h6: null,
  h7: null,
  h8: null,
  h13: mm(85),
  h14: [mm(1215), mm(1275)] as const,
  rearOverhang: null,
  waPivotFromRear: null,
  travelKmh: { laden: 9, efficiency: 12, plus: 14 },
  liftMs: mm(50), // 0.05 yüklü; yüksüz 0.07 notta
  lowerMs: mm(120),
  reachMs: null,
  serviceWeightKg: 810,
  mastTables: [] as const,
  residualCapacityPublished: true,
}

// ── Karşı ağırlıklı forklift (7 model, iki gövde grubu) ─────────────────────
// Ortak: c=500 · çatal boyu 1150 · h6=2040 · h7=920 · hız 16 km/h.
// Arka sarkma 190 türetilmiş AMA Wa tarafından bağımsız teyitli: Wa − y =
// 190/191, 7 modelde de (plan §4.2). Zincir: l2 = 190 + y + x, l1 = l2 + 1150.
// b5 YAYINLANMAMIŞ (b3=980 ISO 2A taşıyıcı genişliğidir) → null, gaps'te.

const FORKLIFT_SOURCE = 'EFG 213–220 specsheet + factsheet TR 07/2026, VDI 2198'

const forkliftCommon = {
  variant: 'forklift' as TruckVariant,
  source: FORKLIFT_SOURCE,
  b2: null,
  b4: null,
  b5: null,
  c: mm(500),
  h6: mm(2040),
  h7: mm(920),
  h8: null,
  h13: null,
  h14: null,
  rearOverhang: mm(190),
  travelKmh: { laden: 16, efficiency: null, plus: null },
  liftMs: null, // hız yayınlanmamış (11.5 kW motor gücü hız değildir)
  lowerMs: null,
  reachMs: null,
  residualCapacityPublished: true,
}

/** Gövde grubu A (213/215/216k/216): b1=1060, b10=904, çatal 40/80. */
const forkliftGroupA = {
  ...forkliftCommon,
  b1: mm(1060),
  b10: mm(904),
  b11: mm(176),
  fork: { s: mm(40), e: mm(80), length: mm(1150) },
  mastTables: ['efg-a'] as const,
}

/** Gövde grubu B (218k/218/220): b1=1120, b10=914, çatal 40/100. */
const forkliftGroupB = {
  ...forkliftCommon,
  b1: mm(1120),
  b10: mm(914),
  b11: mm(176),
  fork: { s: mm(40), e: mm(100), length: mm(1150) },
  mastTables: ['efg-b'] as const,
}

// ── Reach truck (4 model) ───────────────────────────────────────────────────
// Ortak: arka kenar → tahrik aksı 0.210 (constants.ts, Estimate) · çatal boyu
// 1150 · c=600 · h6=2190 · h7=1057 · a=200. Zincir: x = (0.210 + y) − l2.
// b10 çıkarımda yayınlanmamış → null, gaps'te. Dönüş pivotu yük tekeri aksı
// (0.210 + y); Wa ile 7–18 mm rezidü var, daire yayınlanmış Wa ile çizilir.
// Rezidüel kapasite eğrisi YAYINLANMAMIŞ → residualCapacityPublished: false.

const RT_SOURCE = 'ETM/ETV 318–325 specsheet + factsheet TR 09/2021, VDI 2198'

const rtCommon = {
  variant: 'reach' as TruckVariant,
  source: RT_SOURCE,
  b10: null,
  c: mm(600),
  h6: mm(2190),
  h7: mm(1057),
  h13: null,
  h14: null,
  rearOverhang: null,
  lowerMs: mm(550),
  residualCapacityPublished: false,
}

// ── Üç yönlü VNA istifleyici, Man-Up (5 model, iki yapı serisi) ─────────────
// Ortak: c=600 · b1=1210 gövde ama b2=1450 KABİN (zarf l1 × 1.45) · b5=856 ·
// h6=2550 · h7=430 · yardımcı kaldırma h9=1780 · yana itme ±650.
// Ast YAYINLANMAMIŞ ve KALICI null — sınıf EN 15620 bandında kalır (gaps).
// l1 − l2 = 286 sabit; jenerik çatal zinciri BU AİLEYE UYGULANMAZ (chains).
// Dönüş pivotu z + y — tahmin; daire yayınlanmış Wa yarıçapıyla çizilir.

const TT_SOURCE = 'EKX 410–516 specsheet + factsheet TR 07/2026, VDI 2198'

const ttCommon = {
  variant: 'turret' as TruckVariant,
  source: TT_SOURCE,
  b1: mm(1210),
  b2: mm(1450),
  b4: null,
  b5: mm(856),
  b11: null,
  h6: mm(2550),
  h7: mm(430),
  h8: null,
  h13: null,
  h14: null,
  rearOverhang: null,
  ast: null,
  lowerMs: null,
  reachMs: null,
  residualCapacityPublished: true,
}

const TT_COMMON_NOTES = [
  'Ast yayınlanmamış — sınıf EN 15620 trilateral-turret bandında kalır; formül ve pratik aralık gaps.ts girişinde.',
  'Koridora giriş için transfer koridoru ≥ 4.0–4.5 m — çalışma koridorundan ayrı bir kavram, route.width ile karıştırılmaz.',
  'Kabin gövdeden geniş: zarf l1 × 1.45 (b2), gövde 1.21 (b1) değil.',
  'Yardımcı kaldırma h9 = 1.780; yana itme ±0.650 (sideshiftPLUS +0.100); ray kılavuz mil dayanağı 1.103; referans palet 1200×1200.',
] as const

export const TRUCK_MODELS: Record<TruckModelId, TruckModel> = {
  // Manuel transpalet ──────────────────────────────────────────────────────
  'mpt-520x1150': {
    ...mptCommon,
    id: 'mpt-520x1150',
    label: 'AM 15l · 520×1150',
    l1: mm(1530),
    b1: mm(520),
    b5: mm(520),
    y: mm(1100),
    fork: { s: mm(38), e: mm(150), length: mm(1150) },
    c: mm(600),
    ast: { load1000x1200: mm(1584), load800x1200: mm(1784) },
    Wa: mm(1274),
    serviceWeightKg: 74,
    notes: [
      'x (VDI 1.8) yayınlanmamış; Ast tablodan okunur, formülden hesaplanmaz.',
      'İndirme 0.09 yüklü / 0.02 yüksüz m/s. Kaldırma pompa darbesiyle: ≤120 kg için 3, tam yükseklik 5 darbe.',
      'Wa dönüş merkezi yayınlanmamış — daire çizilmez, yalnız sayı gösterilir (plan §4.2).',
    ],
  },
  'mpt-520x950': {
    ...mptCommon,
    id: 'mpt-520x950',
    label: 'AM 15l · 520×950',
    l1: mm(1330),
    b1: mm(520),
    b5: mm(520),
    y: mm(900),
    fork: { s: mm(38), e: mm(150), length: mm(950) },
    c: mm(500),
    ast: null,
    Wa: null,
    serviceWeightKg: 72,
    notes: ['Ast/Wa çıkarımda yalnız 520×1150 için yayınlanmış — bu varyanta kopyalanmaz (gaps).'],
  },
  'mpt-520x795': {
    ...mptCommon,
    id: 'mpt-520x795',
    label: 'AM 15l · 520×795',
    l1: mm(1175),
    b1: mm(520),
    b5: mm(520),
    y: mm(745),
    fork: { s: mm(38), e: mm(150), length: mm(795) },
    c: mm(400),
    ast: null,
    Wa: null,
    serviceWeightKg: 71,
    notes: ['Ast/Wa çıkarımda yalnız 520×1150 için yayınlanmış — bu varyanta kopyalanmaz (gaps).'],
  },
  'mpt-680x1150': {
    ...mptCommon,
    id: 'mpt-680x1150',
    label: 'AM 15l · 680×1150',
    l1: mm(1530),
    b1: mm(680),
    b5: mm(680),
    y: mm(1080),
    fork: { s: mm(38), e: mm(150), length: mm(1150) },
    c: mm(600),
    ast: null,
    Wa: null,
    serviceWeightKg: 65,
    notes: ['Ast/Wa çıkarımda yalnız 520×1150 için yayınlanmış — bu varyanta kopyalanmaz (gaps).'],
  },

  // Elektrikli transpalet ──────────────────────────────────────────────────
  'ept-2500': {
    ...eptCommon,
    id: 'ept-2500',
    label: 'ERE 225i · komfort platform',
    l1: mm(2139),
    l2: mm(989),
    ast: { load1000x1200: mm(2346), load800x1200: mm(2396) },
    Wa: mm(1894),
    notes: [
      'Kaldırma 0.05 yüklü / 0.07 yüksüz; indirme 0.12 yüklü / 0.05 yüksüz m/s.',
      'h3 çelişkisi: VDI 4.4 = 0.120, pazarlama 0.122 — fiziksel strok 0.120 esas (çatal üstü 0.085 → 0.205).',
      'Wa dönüş merkezi yayınlanmamış — daire çizilmez (plan §4.2).',
    ],
  },
  'ept-2500-compact': {
    ...eptCommon,
    id: 'ept-2500-compact',
    label: 'ERE 225i · kompakt platform',
    l1: mm(2139 - 103),
    l2: mm(989 - 103),
    ast: { load1000x1200: mm(2346 - 108), load800x1200: mm(2396 - 108) },
    Wa: null,
    notes: [
      'Yayınlanmış deltalar: l1 −0.103, l2 −0.103, Ast −0.108. 103 ≠ 108: Ast, l1 üzerinden türetilemez — test bunu kilitler.',
      'y/x kompakt için yeniden yayınlanmamış, ana satırdan taşındı (platform tahrik aksının gerisinde kısalıyor).',
      'Wa kompakt için yayınlanmamış → null (gaps).',
    ],
  },

  // Karşı ağırlıklı forklift ───────────────────────────────────────────────
  'forklift-1300': {
    ...forkliftGroupA,
    id: 'forklift-1300',
    label: 'EFG 213',
    Q: 1300,
    l1: mm(2933),
    l2: mm(1783),
    y: mm(1249),
    x: mm(344),
    ast: { load1000x1200: mm(3112), load800x1200: mm(3235) },
    Wa: mm(1440),
    waPivotFromRear: mm(1249 + 190),
    serviceWeightKg: 2692,
    notes: ['Kapasite eğrisi c ≤ 0.5 nominal; 0.6/0.7 grafikten okunmuş yaklaşık değerler.'],
  },
  'forklift-1500': {
    ...forkliftGroupA,
    id: 'forklift-1500',
    label: 'EFG 215',
    Q: 1500,
    l1: mm(2933),
    l2: mm(1783),
    y: mm(1249),
    x: mm(344),
    ast: { load1000x1200: mm(3112), load800x1200: mm(3235) },
    Wa: mm(1440),
    waPivotFromRear: mm(1249 + 190),
    serviceWeightKg: 2937,
    notes: ['Kapasite eğrisi c ≤ 0.5 nominal; 0.6/0.7 grafikten okunmuş yaklaşık değerler.'],
  },
  'forklift-1600-short': {
    ...forkliftGroupA,
    id: 'forklift-1600-short',
    label: 'EFG 216k',
    Q: 1600,
    l1: mm(3041),
    l2: mm(1891),
    y: mm(1357),
    x: mm(344),
    ast: { load1000x1200: mm(3220), load800x1200: mm(3343) },
    Wa: mm(1548),
    waPivotFromRear: mm(1357 + 190),
    serviceWeightKg: 2959,
    notes: ['Kısa dingil (y=1.357); performans satırlarının bir kısmı PDF birleşik hücresinden.'],
  },
  'forklift-1600': {
    ...forkliftGroupA,
    id: 'forklift-1600',
    label: 'EFG 216',
    Q: 1600,
    l1: mm(3149),
    l2: mm(1999),
    y: mm(1465),
    x: mm(344),
    ast: { load1000x1200: mm(3327), load800x1200: mm(3450) },
    Wa: mm(1655),
    waPivotFromRear: mm(1465 + 190),
    serviceWeightKg: 3018,
    notes: ['Kapasite eğrisi c ≤ 0.5 nominal; 0.6/0.7 grafikten okunmuş yaklaşık değerler.'],
  },
  'forklift-1800-short': {
    ...forkliftGroupB,
    id: 'forklift-1800-short',
    label: 'EFG 218k',
    Q: 1800,
    l1: mm(3061),
    l2: mm(1911),
    y: mm(1357),
    x: mm(364),
    ast: { load1000x1200: mm(3238), load800x1200: mm(3362) },
    Wa: mm(1548),
    waPivotFromRear: mm(1357 + 190),
    serviceWeightKg: 3240,
    notes: ['Kısa dingil (y=1.357); drawbar pull satırı 218 ile birleşik hücreden.'],
  },
  'forklift-1800': {
    ...forkliftGroupB,
    id: 'forklift-1800',
    label: 'EFG 218',
    Q: 1800,
    l1: mm(3169),
    l2: mm(2019),
    y: mm(1465),
    x: mm(364),
    ast: { load1000x1200: mm(3345), load800x1200: mm(3469) },
    Wa: mm(1655),
    waPivotFromRear: mm(1465 + 190),
    serviceWeightKg: 3191,
    notes: ['Kapasite eğrisi c ≤ 0.5 nominal; 0.6/0.7 grafikten okunmuş yaklaşık değerler.'],
  },
  'forklift-2000': {
    ...forkliftGroupB,
    id: 'forklift-2000',
    label: 'EFG 220',
    Q: 2000,
    l1: mm(3169),
    l2: mm(2019),
    y: mm(1465),
    x: mm(364),
    ast: { load1000x1200: mm(3345), load800x1200: mm(3469) },
    Wa: mm(1655),
    waPivotFromRear: mm(1465 + 190),
    serviceWeightKg: 3366,
    notes: ['Kapasite eğrisi c ≤ 0.5 nominal; 0.6/0.7 grafikten okunmuş yaklaşık değerler.'],
  },

  // Reach truck ────────────────────────────────────────────────────────────
  'rt-1800': {
    ...rtCommon,
    id: 'rt-1800',
    label: 'ETV 318',
    Q: 1800,
    l1: mm(2456),
    l2: mm(1306),
    b1: mm(1270),
    b2: mm(1270),
    b4: mm(940),
    b5: { min: mm(335), max: mm(730) },
    b11: mm(1136),
    y: mm(1460),
    x: mm(364),
    fork: { s: mm(40), e: mm(120), length: mm(1150) },
    h8: mm(285),
    ast: { load1000x1200: mm(2737), load800x1200: mm(2790) },
    Wa: mm(1663),
    waPivotFromRear: mm(210 + 1460),
    travelKmh: { laden: null, efficiency: 11, plus: 14 },
    liftMs: mm(320),
    reachMs: mm(180),
    serviceWeightKg: 3522,
    mastTables: ['reach-a', 'reach-b'],
    notes: [
      'b4=0.940: 800 mm palet ayaklar ARASINA girer, yere kadar inebilir.',
      'İtme (l4) 0.569; ayak ucu l7 = 1.842.',
      'Pivot (0.210 + y) ile yayınlanmış Wa arasında 7 mm rezidü — daire Wa yarıçapıyla çizilir, pivot kaydırılmaz.',
      'Rezidüel kapasite eğrisi yayınlanmamış — yüksek h3 + c>0.6 için yalnız "doğrulanmadı" uyarısı (R-9).',
    ],
  },
  'rt-2000': {
    ...rtCommon,
    id: 'rt-2000',
    label: 'ETV 320',
    Q: 2000,
    l1: mm(2466),
    l2: mm(1316),
    b1: mm(1290),
    b2: mm(1270),
    b4: mm(940),
    b5: { min: mm(356), max: mm(750) },
    b11: mm(1155),
    y: mm(1518),
    x: mm(412),
    fork: { s: mm(40), e: mm(120), length: mm(1150) },
    h8: mm(355),
    ast: { load1000x1200: mm(2750), load800x1200: mm(2794) },
    Wa: mm(1710),
    waPivotFromRear: mm(210 + 1518),
    travelKmh: { laden: null, efficiency: 11, plus: 14 },
    liftMs: mm(320),
    reachMs: mm(180),
    serviceWeightKg: 3650,
    mastTables: ['reach-a', 'reach-b', 'reach-c'],
    notes: [
      'b4=0.940: 800 mm palet ayaklar ARASINA girer.',
      'İtme (l4) 0.624; ayak ucu l7 = 1.920. b2/b4/lastik/m2/h8 birleşik hücreden eşlenmiş (⚠).',
      'Pivot ile Wa arasında 18 mm rezidü — daire Wa yarıçapıyla çizilir.',
      'Rezidüel kapasite eğrisi yayınlanmamış (R-9).',
    ],
  },
  'rt-2500-narrow': {
    ...rtCommon,
    id: 'rt-2500-narrow',
    label: 'ETM 325',
    Q: 2500,
    l1: mm(2644),
    l2: mm(1494),
    b1: mm(1198),
    b2: mm(1120),
    b4: mm(790),
    b5: { min: mm(356), max: mm(580) },
    b11: mm(1034),
    y: mm(1673),
    x: mm(389),
    fork: { s: mm(50), e: mm(140), length: mm(1150) },
    h8: mm(355),
    ast: { load1000x1200: mm(2921), load800x1200: mm(2969) },
    Wa: mm(1865),
    waPivotFromRear: mm(210 + 1673),
    travelKmh: { laden: null, efficiency: null, plus: 14 },
    liftMs: mm(380),
    reachMs: mm(200),
    serviceWeightKg: 3895,
    mastTables: ['reach-a'],
    notes: [
      'b4=0.790: palet ayakların ÜZERİNDEN taşınır; bırakma kotu ≥ h8 + 0.030 kapak + pay. Palet alma mantığını ve çarpışma kuralını değiştirir.',
      'Efficiency paketi SUNULMUYOR — null, 0 değil; "0 km/h" boş sütun demektir.',
      'Yalnız mast grubu A → maks h3 = 9.110.',
      'İtme (l4) 0.703; ayak ucu l7 = 2.075. Rezidüel kapasite eğrisi yayınlanmamış (R-9).',
    ],
  },
  'rt-2500': {
    ...rtCommon,
    id: 'rt-2500',
    label: 'ETV 325',
    Q: 2500,
    l1: mm(2546),
    l2: mm(1396),
    b1: mm(1348),
    b2: mm(1270),
    b4: mm(940),
    b5: { min: mm(356), max: mm(750) },
    b11: mm(1184),
    y: mm(1673),
    x: mm(487),
    fork: { s: mm(50), e: mm(140), length: mm(1150) },
    h8: mm(355),
    ast: { load1000x1200: mm(2854), load800x1200: mm(2883) },
    Wa: mm(1865),
    waPivotFromRear: mm(210 + 1673),
    travelKmh: { laden: null, efficiency: null, plus: 14 },
    liftMs: mm(380),
    reachMs: mm(200),
    serviceWeightKg: 3700,
    mastTables: ['reach-a', 'reach-b', 'reach-c'],
    notes: [
      'b4=0.940: 800 mm palet ayaklar ARASINA girer.',
      'Efficiency paketi SUNULMUYOR — null, 0 değil.',
      'y/Wa/l7 birleşik hücreden eşlenmiş (⚠). İtme (l4) 0.736; ayak ucu l7 = 2.075.',
      'Rezidüel kapasite eğrisi yayınlanmamış (R-9).',
    ],
  },

  // Üç yönlü VNA istifleyici ───────────────────────────────────────────────
  'tt-1000': {
    ...ttCommon,
    id: 'tt-1000',
    label: 'EKX 410',
    Q: 1000,
    l1: mm(3665),
    l2: mm(3379),
    b10: mm(1306),
    y: mm(1807),
    x: mm(450),
    fork: { s: mm(40), e: mm(120), length: mm(1200) },
    c: mm(600),
    Wa: mm(2122),
    waPivotFromRear: mm(320 + 1807),
    travelKmh: { laden: 10.5, efficiency: null, plus: null },
    liftMs: mm(400),
    serviceWeightKg: 5515,
    mastTables: ['ekx-br4'],
    notes: [
      ...TT_COMMON_NOTES,
      'z (arka sarkma) = 0.320 — forklift zincirinin 0.190 kavramı değil, rearOverhang alanına yazılmaz.',
      'Pivot (z + y) tahmin; yayınlanmış Wa ile 5 mm rezidü.',
      'Maks h3 = 11.5 (BR4).',
    ],
  },
  'tt-1200': {
    ...ttCommon,
    id: 'tt-1200',
    label: 'EKX 412',
    Q: 1200,
    l1: mm(3665),
    l2: mm(3379),
    b10: mm(1306),
    y: mm(1840),
    x: mm(450),
    fork: { s: mm(40), e: mm(120), length: mm(1200) },
    c: mm(600),
    Wa: mm(2122),
    waPivotFromRear: mm(320 + 1840),
    travelKmh: { laden: 10.5, efficiency: null, plus: null },
    liftMs: mm(400),
    serviceWeightKg: 5895,
    mastTables: ['ekx-br4'],
    notes: [
      ...TT_COMMON_NOTES,
      'z (arka sarkma) = 0.320.',
      'Pivot (z + y) tahmin; yayınlanmış Wa ile 38 mm rezidü.',
      'Maks h3 = 11.5 (BR4).',
    ],
  },
  'tt-1400': {
    ...ttCommon,
    id: 'tt-1400',
    label: 'EKX 514',
    Q: 1400,
    l1: mm(3665),
    l2: mm(3379),
    b10: mm(1258),
    y: mm(1950),
    x: mm(445),
    fork: { s: mm(50), e: mm(120), length: mm(1200) },
    c: mm(600),
    Wa: mm(2122),
    waPivotFromRear: mm(282 + 1950),
    travelKmh: { laden: 10.5, efficiency: null, plus: null },
    liftMs: mm(450),
    serviceWeightKg: 6350,
    mastTables: ['ekx-br5'],
    notes: [
      ...TT_COMMON_NOTES,
      'z (arka sarkma) = 0.282.',
      'ÇELİŞKİ: y=1.950 birleşik sütundan atandı; yayınlanmış Wa=2.122, y=1.840 gerektiriyor (tam olarak tt-1200 değeri). 1.950 saklandı, daire yayınlanmış Wa ile çizilir (plan §10 soru 6a).',
      'Maks h3 = 13.0 (BR5).',
    ],
  },
  'tt-1600-short': {
    ...ttCommon,
    id: 'tt-1600-short',
    label: 'EKX 516k',
    Q: 1600,
    l1: mm(3775),
    l2: mm(3489),
    b10: mm(1258),
    y: mm(1950),
    x: mm(445),
    fork: { s: mm(50), e: mm(120), length: mm(1200) },
    c: mm(600),
    Wa: mm(2232),
    waPivotFromRear: mm(282 + 1950),
    travelKmh: { laden: 12, efficiency: null, plus: null },
    liftMs: mm(600),
    serviceWeightKg: 6750,
    mastTables: ['ekx-br5'],
    notes: [
      ...TT_COMMON_NOTES,
      'z (arka sarkma) = 0.282. y=1.950 birleşik sütundan (⚠); Wa=2.232 sütun dizilişinden eşlendi (⚠).',
      'Maks h3 = 14.0 (BR5).',
    ],
  },
  'tt-1600': {
    ...ttCommon,
    id: 'tt-1600',
    label: 'EKX 516',
    Q: 1600,
    l1: mm(4045),
    l2: mm(3759),
    b10: mm(1258),
    y: mm(2220),
    x: mm(445),
    fork: { s: mm(50), e: mm(120), length: mm(1200) },
    c: mm(600),
    Wa: mm(2502),
    waPivotFromRear: mm(282 + 2220),
    travelKmh: { laden: 12, efficiency: null, plus: null },
    liftMs: mm(600),
    serviceWeightKg: 7900,
    mastTables: ['ekx-br5'],
    notes: [
      ...TT_COMMON_NOTES,
      'z (arka sarkma) = 0.282. Pivot z + y = 2.502 — yayınlanmış Wa ile TAM örtüşen tek model.',
      'Maks h3 = 18.0, ama 14.5 üzeri satır satır yayınlanmamış — özel konfigürasyon (gaps).',
    ],
  },
}

export const TRUCK_MODEL_IDS = Object.keys(TRUCK_MODELS) as readonly TruckModelId[]

/** Bir sınıfın satırları, katalog sırasıyla. */
export function modelsOf(variant: TruckVariant): TruckModel[] {
  return TRUCK_MODEL_IDS.map((id) => TRUCK_MODELS[id]).filter((m) => m.variant === variant)
}

/**
 * Plan zarfının ve çarpışma kutusunun genişliği: yayınlanmış en geniş kesit.
 *
 * `b2 ?? b1` DEĞİL, `max` — iki aile iki yöne ayrışıyor: `tt`'de kabin
 * gövdeden 240 mm geniş (b2 kazanır), `rt-2500-narrow`'da kabin şasiden 78 mm
 * dar (b1 kazanır). `??` biçimi ikincisinde zarfı 78 mm tıraşlar ve bunu
 * hiçbir görsel yakalamaz — dar koridor çarpışması sessizce yanlışlanır.
 */
export function envelopeWidthM(model: TruckModel): number {
  return Math.max(model.b1, model.b2 ?? 0)
}
