/**
 * Model kataloğu — kullanıcının seçtiği filo: 5 makine, aile başına bir satır.
 *
 * Kaynak: `docs/vehicle-data-vdi.md` (oradaki her satır üretici spec sheet'ine
 * atıflı). Kodda hiçbir ölçü ikinci kez yazılmaz: buradan okunur, ve buradaki
 * her satır `models.test.ts`'te `chains.ts`'in hakemliğinden geçer — zincir
 * kapanmıyorsa sayı yanlış kopyalanmıştır. Ailelerin kataloglanmayan
 * varyantları dokümanda duruyor; gerektiğinde satır olarak eklenir, şema
 * alanı olarak değil.
 *
 * ## Kimlikler markasızdır ve kalıcıdır
 *
 * Model kimliği kullanıcı verisine girer (kaydedilmiş sahnedeki düğüm hangi
 * makine olduğunu bu dizeyle söyler) ve hukuki bir sebeple sonradan yeniden
 * adlandırılamaz. Bu yüzden kimlik işlevsel addır — `forklift-1300`,
 * `rt-1800` — üretici kodu değil. Üretici adı ve model kodu yalnız `label`
 * ile `source` atıf dizelerinde durur; kind adına, dosya adına ve panel
 * etiketine girmez. Aile önekleri:
 *
 *   `mpt`      manuel transpalet          (hand-pallet)
 *   `ept`      elektrikli transpalet      (powered-pallet)
 *   `forklift` karşı ağırlıklı forklift   (forklift)
 *   `rt`       reach truck                (reach)
 *   `tt`       üç yönlü VNA istifleyici   (turret)
 *
 * Sayı, kimlikteki taşıma kapasitesidir (kg); `mpt`'de çatal genişlik×boy
 * (mm), çünkü o ailede kapasite varyantlar arasında değişmez.
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

export type TruckModelId = 'mpt-680x1150' | 'ept-2500' | 'forklift-1300' | 'rt-1800' | 'tt-1600'

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
  /** Ayak iç açıklığı — yalnız reach. 0.94: 800 mm palet ayaklar arasına
   *  girer, yere kadar inebilir (dar gövdeli kardeş modelde 0.79 olsaydı
   *  palet ayakların üzerinden taşınırdı — o satır katalogda değil). */
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
  /** Arka sarkma — forklift zincirinin 0.190'ı (Wa ile teyitli). Reach ve
   *  turret'te farklı kavramlar var (0.210 tahrik aksı, z) ve bu alana
   *  YAZILMAZ — yanlış zincire girerler. */
  rearOverhang: number | null
  /** `tt`'de null — KALICI. Doldurulmaz; gaps.ts'te karşılığı vardır. */
  ast: AstPair | null
  Wa: number | null
  /** Dönüş merkezinin arka yüzden uzaklığı (plan §4.2). null = merkez
   *  yayınlanmamış, daire çizilmez. */
  waPivotFromRear: number | null
  /** Sunulmayan paket `null`dur, asla 0 — kaynakta "0 km/h" yazması sütunun
   *  boş olduğu anlamına gelir, aracın hareketsiz olduğu değil. */
  travelKmh: { laden: number | null; efficiency: number | null; plus: number | null }
  /** Yüklü değerler; yüksüz farklıysa notlarda. */
  liftMs: number | null
  lowerMs: number | null
  reachMs: number | null
  serviceWeightKg: number
  /** KÜME — model hangi mast tablolarını sunuyor. Aralıktan satır uydurulmaz. */
  mastTables: readonly MastTableId[]
  /** Reach'te false — rezidüel kapasite eğrisi yayınlanmamış, yüksek
   *  h3 + c>0.6 kombinasyonlarında nominal Q taahhüt edilemez. */
  residualCapacityPublished: boolean
  notes: readonly string[]
}

export const TRUCK_MODELS: Record<TruckModelId, TruckModel> = {
  /**
   * Manuel transpalet, geniş çatal. Sürüş motoru yok: travelKmh tümü null.
   * Kaldırma pompa darbesiyle (m/s değil). Ast/Wa çıkarımda yalnız standart
   * 520×1150 varyantı için yayınlanmış ve dingil mesafesi farklı (1.080 ↔
   * 1.100) olduğu için buraya KOPYALANMAZ — koridor sınıf bandından okunur.
   */
  'mpt-680x1150': {
    id: 'mpt-680x1150',
    variant: 'hand-pallet',
    label: 'AM 15l · 680×1150 C/BN',
    source: 'AM 15l factsheet + specsheet TR 07/2026, VDI 2198',
    l1: mm(1530),
    l2: mm(380),
    b1: mm(680),
    b2: null,
    b4: null,
    b5: mm(680),
    b10: mm(109),
    b11: mm(370),
    y: mm(1080),
    x: null,
    fork: { s: mm(38), e: mm(150), length: mm(1150) },
    c: mm(600),
    Q: 1500,
    h6: null,
    h7: null,
    h8: null,
    h13: mm(51),
    h14: mm(1237),
    rearOverhang: null,
    ast: null,
    Wa: null,
    waPivotFromRear: null,
    travelKmh: { laden: null, efficiency: null, plus: null },
    liftMs: null,
    lowerMs: mm(90), // 0.09 yüklü; yüksüz 0.02
    reachMs: null,
    serviceWeightKg: 65,
    mastTables: [],
    residualCapacityPublished: true,
    notes: [
      'x (VDI 1.8) yayınlanmamış; Ast tablodan okunur, formülden hesaplanmaz.',
      'Ast/Wa çıkarımda yalnız 520×1150 standart varyantı için yayınlanmış — bu varyanta kopyalanmaz, koridor sınıf bandından okunur (gaps).',
      'h13 = 0.051 sınıfının en alçağı. İndirme 0.09 yüklü / 0.02 yüksüz m/s; kaldırma ≤120 kg için 3, tam yükseklik 5 pompa darbesi.',
    ],
  },

  /**
   * Elektrikli alçak transpalet, komfort platform. Kompakt platform varyantı
   * (l1 −0.103, Ast −0.108 — ikisi de yayınlanmış delta) kataloglanmadı;
   * deltaların uyuşmaması Ast'ın l1'den türetilemeyeceğinin kanıtı olarak
   * dokümanda duruyor.
   */
  'ept-2500': {
    id: 'ept-2500',
    variant: 'powered-pallet',
    label: 'ERE 225i · komfort platform',
    source: 'ERE 225i factsheet + specsheet TR 07/2026, VDI 2198',
    l1: mm(2139),
    l2: mm(989),
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
    h14: [mm(1215), mm(1275)],
    rearOverhang: null,
    ast: { load1000x1200: mm(2346), load800x1200: mm(2396) },
    Wa: mm(1894),
    waPivotFromRear: null,
    travelKmh: { laden: 9, efficiency: 12, plus: 14 },
    liftMs: mm(50), // 0.05 yüklü; yüksüz 0.07
    lowerMs: mm(120),
    reachMs: null,
    serviceWeightKg: 810,
    mastTables: [],
    residualCapacityPublished: true,
    notes: [
      'h3 çelişkisi: VDI 4.4 = 0.120, pazarlama 0.122 — fiziksel strok 0.120 esas (çatal üstü 0.085 → 0.205).',
      'Wa dönüş merkezi yayınlanmamış — daire çizilmez, yalnız sayı gösterilir (plan §4.2).',
      'Gövde/kaput dikey ölçüleri yayınlanmamış; 3B gövde ±%5–10 tahminle çizilir ve çarpışma kutusuna girmez (gaps).',
    ],
  },

  /**
   * Elektrikli 3 tekerlekli karşı ağırlıklı forklift, gövde grubu A.
   * Zincir: l2 = 0.190 + y + x ve l1 = l2 + 1.150 — arka sarkma 0.190
   * türetilmiş AMA Wa tarafından bağımsız teyitli (Wa − y = 0.191).
   */
  'forklift-1300': {
    id: 'forklift-1300',
    variant: 'forklift',
    label: 'EFG 213',
    source: 'EFG 213–220 specsheet + factsheet TR 07/2026, VDI 2198',
    l1: mm(2933),
    l2: mm(1783),
    b1: mm(1060),
    b2: null,
    b4: null,
    b5: null,
    b10: mm(904),
    b11: mm(176),
    y: mm(1249),
    x: mm(344),
    fork: { s: mm(40), e: mm(80), length: mm(1150) },
    c: mm(500),
    Q: 1300,
    h6: mm(2040),
    h7: mm(920),
    h8: null,
    h13: null,
    h14: null,
    rearOverhang: mm(190),
    ast: { load1000x1200: mm(3112), load800x1200: mm(3235) },
    Wa: mm(1440),
    waPivotFromRear: mm(1249 + 190),
    travelKmh: { laden: 16, efficiency: null, plus: null },
    liftMs: null, // hız yayınlanmamış (11.5 kW motor gücü hız değildir)
    lowerMs: null,
    reachMs: null,
    serviceWeightKg: 2692,
    mastTables: ['efg-a'],
    residualCapacityPublished: true,
    notes: [
      'Kapasite eğrisi c ≤ 0.5 nominal; 0.6/0.7 grafikten okunmuş yaklaşık değerler — UI "yaklaşık" demek zorunda.',
      'b5 (çatal açıklığı) yayınlanmamış; b3=0.980 ISO 2A taşıyıcı genişliğidir (gaps).',
      'Tilt ileri 7°, geri 4–7°. ZT mast serbest kaldırma h2 = 0.150.',
    ],
  },

  /**
   * Reach truck. Zincir: x = (0.210 + y) − l2; dönüş pivotu yük tekeri aksı
   * (0.210 + y), yayınlanmış Wa ile 7 mm rezidü — daire Wa yarıçapıyla
   * çizilir, pivot kaydırılmaz.
   */
  'rt-1800': {
    id: 'rt-1800',
    variant: 'reach',
    label: 'ETV 318',
    source: 'ETM/ETV 318–325 specsheet + factsheet TR 09/2021, VDI 2198',
    l1: mm(2456),
    l2: mm(1306),
    b1: mm(1270),
    b2: mm(1270),
    b4: mm(940),
    b5: { min: mm(335), max: mm(730) },
    b10: null,
    b11: mm(1136),
    y: mm(1460),
    x: mm(364),
    fork: { s: mm(40), e: mm(120), length: mm(1150) },
    c: mm(600),
    Q: 1800,
    h6: mm(2190),
    h7: mm(1057),
    h8: mm(285),
    h13: null,
    h14: null,
    rearOverhang: null,
    ast: { load1000x1200: mm(2737), load800x1200: mm(2790) },
    Wa: mm(1663),
    waPivotFromRear: mm(210 + 1460),
    travelKmh: { laden: null, efficiency: 11, plus: 14 },
    liftMs: mm(320),
    lowerMs: mm(550),
    reachMs: mm(180),
    serviceWeightKg: 3522,
    mastTables: ['reach-a', 'reach-b'],
    residualCapacityPublished: false,
    notes: [
      'b4 = 0.940: 800 mm palet ayaklar ARASINA girer, yere kadar inebilir.',
      'İtme (l4) 0.569; ayak ucu l7 = 1.842. Mast Triplex DZ; grup A 4.250–9.110, grup B 6.200–11.510.',
      'Pivot (0.210 + y) ile yayınlanmış Wa arasında 7 mm rezidü — daire Wa yarıçapıyla çizilir.',
      'Rezidüel kapasite eğrisi yayınlanmamış — yüksek h3 + c>0.6 için yalnız "doğrulanmadı" uyarısı (R-9).',
    ],
  },

  /**
   * Üç yönlü VNA istifleyici, Man-Up, yapı serisi BR5. Ast YAYINLANMAMIŞ ve
   * kalıcı null; sınıf EN 15620 bandında kalır. l1 − l2 = 0.286: jenerik
   * çatal zinciri bu aileye uygulanmaz (chains.CHAIN_EXEMPT). Beş kardeş
   * model içinde pivotu (z + y) yayınlanmış Wa ile TAM örtüşen tek satır bu.
   */
  'tt-1600': {
    id: 'tt-1600',
    variant: 'turret',
    label: 'EKX 516',
    source: 'EKX 410–516 specsheet + factsheet TR 07/2026, VDI 2198',
    l1: mm(4045),
    l2: mm(3759),
    b1: mm(1210),
    b2: mm(1450),
    b4: null,
    b5: mm(856),
    b10: mm(1258),
    b11: null,
    y: mm(2220),
    x: mm(445),
    fork: { s: mm(50), e: mm(120), length: mm(1200) },
    c: mm(600),
    Q: 1600,
    h6: mm(2550),
    h7: mm(430),
    h8: null,
    h13: null,
    h14: null,
    rearOverhang: null,
    ast: null,
    Wa: mm(2502),
    waPivotFromRear: mm(282 + 2220),
    travelKmh: { laden: 12, efficiency: null, plus: null },
    liftMs: mm(600),
    lowerMs: null,
    reachMs: null,
    serviceWeightKg: 7900,
    mastTables: ['ekx-br5'],
    residualCapacityPublished: true,
    notes: [
      'Ast yayınlanmamış — sınıf EN 15620 trilateral-turret bandında kalır; formül ve pratik aralık gaps.ts girişinde.',
      'Koridora giriş için transfer koridoru ≥ 4.0–4.5 m — çalışma koridorundan ayrı bir kavram, route.width ile karıştırılmaz.',
      'Kabin gövdeden geniş: zarf l1 × 1.45 (b2), gövde 1.21 (b1) değil.',
      'z (arka sarkma) = 0.282 — forklift zincirinin 0.190 kavramı değil, rearOverhang alanına yazılmaz. Pivot z + y = 2.502, yayınlanmış Wa ile tam örtüşür.',
      'Yardımcı kaldırma h9 = 1.780; yana itme ±0.650 (sideshiftPLUS +0.100); ray kılavuz mil dayanağı 1.103; referans palet 1200×1200.',
      'Maks h3 = 18.0, ama 14.5 üzeri satır satır yayınlanmamış — özel konfigürasyon (gaps).',
    ],
  },
}

export const TRUCK_MODEL_IDS = Object.keys(TRUCK_MODELS) as readonly TruckModelId[]

/**
 * Kullanıcıya görünen aile adları — kullanıcının seçtiği İngilizce terimler.
 *
 * Kimlik DEĞİL: kimlik kalıcı sahne verisidir ve kısa kalır (`rt-1800`);
 * bu harita panelin, kataloğun ve araç ipuçlarının okuduğu addır. Üretici
 * adı ve ürün kodu buraya giremez — o yalnız `label`/`source` atıflarında.
 */
export const TRUCK_VARIANT_LABEL: Record<TruckVariant, string> = {
  'hand-pallet': 'Hand pallet truck',
  'powered-pallet': 'Electric pallet truck',
  forklift: 'Electric forklift',
  reach: 'Reach truck',
  turret: 'Turret truck',
  // Modellenmedi (gaps): sözlükte kalır, katalogda yerleştirilebilir değil.
  agv: 'AGV',
}

/** Panel başlığı: aile adı + kapasite — `Electric forklift · 1.3 t`. */
export function displayNameOf(model: TruckModel): string {
  return `${TRUCK_VARIANT_LABEL[model.variant]} · ${(model.Q / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} t`
}

/** Bir sınıfın satırları, katalog sırasıyla. */
export function modelsOf(variant: TruckVariant): TruckModel[] {
  return TRUCK_MODEL_IDS.map((id) => TRUCK_MODELS[id]).filter((m) => m.variant === variant)
}

/**
 * Plan zarfının ve çarpışma kutusunun genişliği: yayınlanmış en geniş kesit.
 *
 * `b2 ?? b1` DEĞİL, `max` — `tt`'de kabin gövdeden 240 mm geniş (b2 kazanır);
 * dar gövdeli reach modellerinde kabin şasiden dar olabiliyor (b1 kazanmalı).
 * `??` biçimi ikincisinde zarfı tıraşlar ve bunu hiçbir görsel yakalamaz —
 * dar koridor çarpışması sessizce yanlışlanır.
 */
export function envelopeWidthM(model: TruckModel): number {
  return Math.max(model.b1, model.b2 ?? 0)
}
