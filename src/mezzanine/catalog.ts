/**
 * Mecalux asma kat (mezzanine) domain verisi — Faz 1 iskeleti tüketir
 * (kurucu sistemler, yük sınıfları, döşeme tipleri, profil tabloları); geri
 * kalan tablolar (korkuluk/kapı/merdiven) Faz 2'nin verisi, şimdiden burada
 * — `telescopic-catalog.ts`'in tüm satırı ilk günden yazması gibi.
 *
 * Kaynak: kullanıcının ilettiği iki rapor —
 *   v1.0 "Mecalux Mezzanine Integration Package" (Mecalux MK-049439-11/23,
 *   DirectIndustry 20 sayfa; ayrıca EN 10365, Weland AB, OSHA, EN ISO
 *   14122-3'e dayanan araştırılmış tamamlayıcılar) ve
 *   v1.1 "Addendum" (tiers[] mimari düzeltmesi).
 * Her satırda kaynak etiketi: CATALOG (üreticiden birebir), RESEARCHED (harici
 * standart/tedarikçi), ASSUMPTION (parametreleştirilmiş varsayım). Repo'nun
 * her yerde yaptığı gibi JSON `_assumption` bayrağı değil, yorum satırı.
 *
 * Her ölçü METRE — `mm()` yalnız bu dosyayı yazarken kullanılır, hiçbir
 * tüketici mm görmez (rack/telescopic'in kuralı).
 */

const mm = (value: number): number => value / 1000

// ── Kurucu sistemler ─────────────────────────────────────────────────────

export const CONSTRUCTIVE_SYSTEM_IDS = ['SIGMA', 'GL2000', 'MIXED'] as const
export type ConstructiveSystemId = (typeof CONSTRUCTIVE_SYSTEM_IDS)[number]

export type ConstructiveSystem = {
  id: ConstructiveSystemId
  label: string
  /** Ana kiriş profil ailesi. */
  mainBeamFamily: 'IPE' | 'SIGMA'
  /** İkincil kiriş profil ailesi. */
  secondaryBeamFamily: 'IPE' | 'SIGMA'
  /** Kolon profil ailesi. */
  columnFamily: 'HEA' | 'SIGMA'
  /** İkincil kiriş ana kirişe gömülü mü (yalnız GL2000, CATALOG). */
  secondaryBeamEmbedded: boolean
  /** Korkuluk direk aralığı üst sınırı, metre (CATALOG: "1100–1500 mm
   *  depending on constructive system"; sistem başına dağılım ASSUMPTION). */
  railingPostMaxSpacingM: number
  /** Çok katlı (tiers.length > 1) destekleniyor mu. Katalog yalnız GL2000
   *  için açıkça çok katlı örnek veriyor; SIGMA/MIXED yazılımsal olarak
   *  izinli ama mühendislik incelemesi gerektirir (ASSUMPTION). */
  supportsMultiTier: boolean
  multiTierWarning: string | null
}

export const CONSTRUCTIVE_SYSTEMS: Record<ConstructiveSystemId, ConstructiveSystem> = {
  SIGMA: {
    id: 'SIGMA',
    label: 'Sigma',
    mainBeamFamily: 'SIGMA',
    secondaryBeamFamily: 'SIGMA',
    columnFamily: 'SIGMA',
    secondaryBeamEmbedded: false,
    railingPostMaxSpacingM: mm(1100),
    supportsMultiTier: true,
    multiTierWarning:
      'Katalog çok katlı istifi yalnız GL2000 için açıkça belgeliyor; çok katlı Sigma yazılımsal olarak izinli ama mühendislik incelemesi gerektirir.',
  },
  GL2000: {
    id: 'GL2000',
    label: 'GL 2000',
    mainBeamFamily: 'IPE',
    secondaryBeamFamily: 'IPE',
    columnFamily: 'HEA',
    secondaryBeamEmbedded: true,
    railingPostMaxSpacingM: mm(1500),
    supportsMultiTier: true,
    multiTierWarning: null,
  },
  MIXED: {
    id: 'MIXED',
    label: 'Mixed',
    mainBeamFamily: 'IPE',
    secondaryBeamFamily: 'SIGMA',
    columnFamily: 'HEA',
    secondaryBeamEmbedded: false,
    railingPostMaxSpacingM: mm(1500),
    supportsMultiTier: true,
    multiTierWarning: null,
  },
}

// ── Yük sınıfları ────────────────────────────────────────────────────────

/** kg/m² — RESEARCHED (EN 1991-1-1 / sektör tipiği, ayrık basamaklar). */
export const LOAD_CLASSES = [250, 350, 500, 750, 1000] as const
export type LoadClass = (typeof LOAD_CLASSES)[number]

// ── Döşeme tipleri ───────────────────────────────────────────────────────

export type FloorTypeId =
  | 'WOOD_CHIPBOARD_30'
  | 'WOOD_MELAMINE_MA_ML_30'
  | 'WOOD_GALV_SHEET_1_5'
  | 'METAL_CORRUGATED'
  | 'METAL_SLOTTED'
  | 'METAL_PERFORATED'
  | 'METAL_GRID'

export type FloorType = {
  id: FloorTypeId
  label: string
  /** Panel kalınlığı, metre — tier elevation zincirinin GİRDİSİ
   *  (`resolveTierElevations`). CATALOG kalınlıklar dışındakiler RESEARCHED. */
  structuralDepthM: number
  /** Plan tarama deseni — Faz 3'ün floorplan'ı tüketecek. */
  hatch2D: 'dots' | 'wave' | 'slots' | 'perforation' | 'grid'
}

export const FLOOR_TYPES: Record<FloorTypeId, FloorType> = {
  WOOD_CHIPBOARD_30: {
    id: 'WOOD_CHIPBOARD_30',
    label: 'Wood chipboard 30 mm',
    structuralDepthM: mm(30), // CATALOG
    hatch2D: 'dots',
  },
  WOOD_MELAMINE_MA_ML_30: {
    id: 'WOOD_MELAMINE_MA_ML_30',
    label: 'Wood melamine (antislip) 30 mm',
    structuralDepthM: mm(30), // CATALOG
    hatch2D: 'dots',
  },
  WOOD_GALV_SHEET_1_5: {
    id: 'WOOD_GALV_SHEET_1_5',
    label: 'Wood + galv. sheet 1.5 mm',
    // 30 mm ahşap tahmini (CATALOG kalınlığı yayınlamıyor) + 1.5 mm sac.
    structuralDepthM: mm(30 + 1.5), // ASSUMPTION (ahşap kalınlığı)
    hatch2D: 'dots',
  },
  METAL_CORRUGATED: {
    id: 'METAL_CORRUGATED',
    label: 'Corrugated galvanised steel',
    structuralDepthM: mm(40), // ASSUMPTION — tipik oluklu sac profil derinliği
    hatch2D: 'wave',
  },
  METAL_SLOTTED: {
    id: 'METAL_SLOTTED',
    label: 'Slotted galvanised steel',
    structuralDepthM: mm(40), // ASSUMPTION
    hatch2D: 'slots',
  },
  METAL_PERFORATED: {
    id: 'METAL_PERFORATED',
    label: 'Perforated galvanised steel',
    structuralDepthM: mm(40), // ASSUMPTION
    hatch2D: 'perforation',
  },
  METAL_GRID: {
    id: 'METAL_GRID',
    label: 'Steel grid (sprinkler-permeable)',
    // RESEARCHED — tipik çelik ızgara kanal derinliği; gerçek Mecalux GL2000
    // döşeme detayıyla doğrulanmalı (v1.0 §Notlar).
    structuralDepthM: mm(60),
    hatch2D: 'grid',
  },
}

// ── Profil tabloları — kutu-listesi parçalarının boyut kaynağı ─────────────
//
// ExtrudeGeometry ile gerçek kesit ÇİZİLMİYOR (repo'da hiçbir yapısal çelik
// parçası extrude edilmiyor — rack'ın C-kesit dikmesi bile 3 kutudan kurulu).
// Bu tablolar yalnız kutu-listesinin (parts.ts) yükseklik/genişlik/et
// kalınlığı girdisidir.

export type IBeamProfile = { h: number; b: number; tw: number; tf: number }

/** EN 10365 — RESEARCHED. h/b/tw/tf, metre. */
export const IPE_PROFILES: Record<string, IBeamProfile> = {
  IPE160: { h: mm(160), b: mm(82), tw: mm(5.0), tf: mm(7.4) },
  IPE180: { h: mm(180), b: mm(91), tw: mm(5.3), tf: mm(8.0) },
  IPE200: { h: mm(200), b: mm(100), tw: mm(5.6), tf: mm(8.5) },
  IPE220: { h: mm(220), b: mm(110), tw: mm(5.9), tf: mm(9.2) },
  IPE240: { h: mm(240), b: mm(120), tw: mm(6.2), tf: mm(9.8) },
  IPE270: { h: mm(270), b: mm(135), tw: mm(6.6), tf: mm(10.2) },
  IPE300: { h: mm(300), b: mm(150), tw: mm(7.1), tf: mm(10.7) },
  IPE360: { h: mm(360), b: mm(170), tw: mm(8.0), tf: mm(12.7) },
}

/** EN 10365 — RESEARCHED. */
export const HEA_PROFILES: Record<string, IBeamProfile> = {
  HEA140: { h: mm(133), b: mm(140), tw: mm(5.5), tf: mm(8.5) },
  HEA160: { h: mm(152), b: mm(160), tw: mm(6.0), tf: mm(9.0) },
  HEA180: { h: mm(171), b: mm(180), tw: mm(6.0), tf: mm(9.5) },
  HEA200: { h: mm(190), b: mm(200), tw: mm(6.5), tf: mm(10.0) },
  HEA220: { h: mm(210), b: mm(220), tw: mm(7.0), tf: mm(11.0) },
  HEA240: { h: mm(230), b: mm(240), tw: mm(7.5), tf: mm(12.0) },
  HEA300: { h: mm(290), b: mm(300), tw: mm(8.5), tf: mm(14.0) },
}

/** Sigma Σ profili — uzunluk/yükseklik/genişlik aralığı CATALOG, kesit
 *  detayı (gövde/flanş/dudak) RESEARCHED (Albion ASB240 referansı). Kutu
 *  yaklaşıklığı `parts.ts`'te bu değerlerden kurulur. */
export const SIGMA_PROFILE = {
  /**
   * Yükseklik/genişlik aralığı CATALOG — tüketicisi geometri değil TEST:
   * `SIGMA_DEFAULT_*` varsayılanlarının katalog aralığının içinde kaldığını
   * kilitliyor. Boy aralığı (1000–12000/250), gövde düzlüğü ve dudak ölçüsü
   * SİLİNDİ: eleman boyunu ifade eden bir alan yok ve kutu yaklaşıklığı
   * kesit detayını zaten çizemez — okunmayan sabit, kural gibi görünen
   * süs olurdu.
   */
  heightRangeM: { min: mm(240), max: mm(400) }, // CATALOG
  widthRangeM: { min: mm(100), max: mm(120) }, // CATALOG
  thicknessM: mm(2.0), // RESEARCHED, aralık 1.5–2.8 mm'nin ortası
}

/** Sigma kolonu/kirişi için tek bir temsili boy — kutu-listesi kesitini
 *  ölçeklerken kullanılan varsayılan yükseklik/genişlik (ASSUMPTION, aralığın
 *  ortasına yakın, katalog satırlarıyla aynı büyüklük mertebesinde). */
export const SIGMA_DEFAULT_HEIGHT_M = mm(300)
export const SIGMA_DEFAULT_WIDTH_M = mm(110)

// ── İkincil kiriş varsayılan aralığı ────────────────────────────────────

/** ASSUMPTION — katalog yayınlamıyor. */
export const SECONDARY_BEAM_SPACING_M = mm(1250)

/**
 * İkiz kolonun iki gövdesi arasındaki NET boşluk.
 *
 * ASSUMPTION — katalog ikiz kolon aks aralığı yayınlamıyor. Öteleme,
 * kolonların ayrıldığı eksendeki kesit ölçüsünden (`h`) türetiliyor;
 * bu sabit yalnız aradaki montaj boşluğu. Tek yerde durmasının sebebi
 * 2B ile 3B'nin aynı sayıyı okuması: önceki hâlde 3B `b` kadar (yani
 * ÖTEKİ eksenin ölçüsü kadar) öteliyordu ve varsayılan SIGMA'da iki
 * kolon 190 mm iç içe geçiyordu.
 */
export const DOUBLE_COLUMN_GAP_M = mm(20)

// ── Malzeme ───────────────────────────────────────────────────────────────

/** RAL 5010-benzeri yapısal mavi — ASSUMPTION, v1.0'ın renk kararı. */
export const STEEL_FRAME_COLOR = '#004F7C'

// ── Faz 2'nin verisi — burada yazılı, Faz 1'de tüketilmiyor ────────────────

export const RAILING_RULES = {
  handrailHeightM: mm(1100), // RESEARCHED — EN ISO 14122-3 tipik
  kickboardHeightM: mm(150), // ASSUMPTION
  /** OSHA (Wikipedia "Mezzanine" üzerinden): 48 in (1.2 m) ve üzeri açıklık
   *  düşme koruması gerektirir. RESEARCHED. */
  openingProtectionM: mm(1200),
}

/**
 * `+ Güvenlik bölgesi` düğmesinin yazdığı genişlik.
 *
 * Eşiğin KENDİSİ, ve buradan okunuyor — düğme 1.5 m yazıyordu, invariant
 * 1.2 m'yi aşanı uyarıyordu, ve `widthM`'in hiçbir kontrolü yoktu: yeni konan
 * her güvenlik bölgesi, kullanıcının kapatamayacağı sarı bir uyarıyla
 * doğuyordu. Sabit burada durduğu için eşik değişirse düğme onu kendiliğinden
 * izliyor, ve `merge.test.ts` ikisinin ayrışmadığını invariant üzerinden
 * sınıyor.
 */
export const NEW_SAFETY_ZONE_WIDTH_M = RAILING_RULES.openingProtectionM

export const GATE_SPECS = {
  swing: { singleWidthM: mm(750), doubleWidthM: mm(1500) }, // CATALOG
  upAndOver: {
    // RESEARCHED — tedarikçi LC/HP tipik minimum açıklık.
    clearHeightAbovePalletM: mm(300),
  },
}

/**
 * Katalogun hazır (ön-montajlı) merdiven serisi — CATALOG.
 *
 * Kullanıcı bunlardan birini seçebilir ama seçim AYNI doğrulamadan geçer:
 * kot farkı tutmuyorsa `step-count-mismatch` çıkar. Listenin son elemanı
 * ayrıca kol başına üst sınırı belirliyor (`MAX_STEPS_PER_FLIGHT`) — iki
 * yerde ayrı yaşamasınlar.
 */
export const STAIRCASE_STEP_COUNTS = [8, 10, 12, 15] as const

/** EN ISO 14122-3:2016 §5.1–5.4 — RESEARCHED. */
export const STAIRCASE_GEOMETRY = {
  goingRangeM: { min: mm(210), max: mm(310) },
  riserMaxM: mm(220),
  treadDepthMinM: mm(245),
  overlapMinM: mm(10),
  flightClimbHeightMaxM: mm(3000),
  singleFlightClimbHeightMaxM: mm(4000),
  landingLengthMinM: mm(800),
  /**
   * Serbest genişlikler: tek kullanıcı / çok kullanıcı. Tüketicisi TEST:
   * şemanın `widthM` literalleri (0.8 | 1) bu iki sayının ta kendisi olmak
   * zorunda — literal şemada, kaynak burada; test ikisini birbirine
   * kilitliyor, yoksa biri sessizce öbüründen koparır.
   *
   * 600 mm "kısaltılmış kısa kol" genişliği SİLİNDİ: şema onu ifade
   * edemiyor (widthM 0.8|1) ve 1.5 m altı kol vakası modellenmedi —
   * okunmayan sabit kural gibi görünen süs olurdu.
   */
  clearWidthMinM: mm(800),
  clearWidthMultiUserM: mm(1000),
}
