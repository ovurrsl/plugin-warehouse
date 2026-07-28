import { describe, expect, test } from 'bun:test'
import {
  CHAIN_EXEMPT,
  chainCloses,
  counterbalancedChainResidualM,
  forkChainApplies,
  forkChainResidualM,
  reachChainResidualM,
} from './chains'

/**
 * Yayınlanmış figürler, **kaynaktaki birimle** yazılıp burada metreye çevrilir.
 *
 * Tablo mm basıyor; `2933` diye yazmak PDF'e karşı diff'lenebilir kalmasını
 * sağlıyor, `2.933` diye yazmak sağlamıyor. Aynı gerekçe `rack/standards.ts`'te
 * de var ve aynı yardımcıyı kullanıyor.
 */
const mm = (value: number) => value / 1000

/** Bu dosyanın tek işi: aşağıdaki sayıların birbirini tutması. Kaynak
 *  `docs/vehicle-data-vdi.md`; oradan kopyalanan her satır burada kilitlenir. */

// ── Manuel transpalet (4 varyant) ──────────────────────────────────────────
const MANUAL_PALLET = [
  { label: '520x1150', l1: 1530, l2: 380, fork: 1150 },
  { label: '520x950', l1: 1330, l2: 380, fork: 950 },
  { label: '520x795', l1: 1175, l2: 380, fork: 795 },
  { label: '680x1150', l1: 1530, l2: 380, fork: 1150 },
]

// ── Elektrikli alçak transpalet ────────────────────────────────────────────
const POWERED_PALLET = [{ label: '2500 kg', l1: 2139, l2: 989, fork: 1150 }]

// ── Karşı ağırlıklı forklift (7 model) ─────────────────────────────────────
/** Arka sarkma VDI'da yayınlanmıyor; yedi modelin hepsinde 190 mm çıkıyor. */
const COUNTERBALANCE_REAR_OVERHANG = 190
const COUNTERBALANCE = [
  { label: '1300', l1: 2933, l2: 1783, y: 1249, x: 344 },
  { label: '1500', l1: 2933, l2: 1783, y: 1249, x: 344 },
  { label: '1600 kısa', l1: 3041, l2: 1891, y: 1357, x: 344 },
  { label: '1600', l1: 3149, l2: 1999, y: 1465, x: 344 },
  { label: '1800 kısa', l1: 3061, l2: 1911, y: 1357, x: 364 },
  { label: '1800', l1: 3169, l2: 2019, y: 1465, x: 364 },
  { label: '2000', l1: 3169, l2: 2019, y: 1465, x: 364 },
]
const COUNTERBALANCE_FORK = 1150

// ── Reach truck (4 model) ──────────────────────────────────────────────────
/** Ölçü çiziminden, yayınlanmış bir VDI satırı değil. Dört modelde de aynı. */
const REACH_REAR_TO_DRIVE_AXLE = 210
const REACH = [
  { label: '1800', l1: 2456, l2: 1306, y: 1460, x: 364 },
  { label: '2000', l1: 2466, l2: 1316, y: 1518, x: 412 },
  { label: '2500 dar', l1: 2644, l2: 1494, y: 1673, x: 389 },
  { label: '2500', l1: 2546, l2: 1396, y: 1673, x: 487 },
]
const REACH_FORK = 1150

// ── Turret / VNA (5 model) ─────────────────────────────────────────────────
const TURRET = [
  { label: '1000', l1: 3665, l2: 3379 },
  { label: '1200', l1: 3665, l2: 3379 },
  { label: '1400', l1: 3665, l2: 3379 },
  { label: '1600 kısa', l1: 3775, l2: 3489 },
  { label: '1600', l1: 4045, l2: 3759 },
]
const TURRET_FORK = 1200

describe('T1 — çatal zinciri dört ailede kapanır', () => {
  // Transkripsiyon hatası yakalar. Bir rakamı yanlış okumak bu toplamı bozar
  // ve başka hiçbir yerde belirti vermez.
  const rows = [
    ...MANUAL_PALLET.map((r) => ({ ...r, family: 'manuel transpalet' })),
    ...POWERED_PALLET.map((r) => ({ ...r, family: 'elektrikli transpalet' })),
    ...COUNTERBALANCE.map((r) => ({ ...r, fork: COUNTERBALANCE_FORK, family: 'forklift' })),
    ...REACH.map((r) => ({ ...r, fork: REACH_FORK, family: 'reach' })),
  ]

  test.each(rows)('$family $label', (row) => {
    const residual = forkChainResidualM({
      overallLengthL1: mm(row.l1),
      lengthToForkFaceL2: mm(row.l2),
      forkLengthM: mm(row.fork),
    })
    expect(chainCloses(residual)).toBe(true)
  })

  test('on altı satırın hepsi sayıldı', () => {
    expect(rows).toHaveLength(16)
  })
})

describe('T2 — turret jenerik zinciri REDDEDER', () => {
  /**
   * **Bu dosyanın varlık sebebi.**
   *
   * Jenerik zinciri beş aileye birden uygulamak dördünde doğru cevabı verir.
   * Beşincisinde taban izini 914 mm kısaltır — ve bu hata 3B'de görünmez,
   * yalnız çarpışma kutusuna ve koridor okumasına girer, orada da her figür
   * kendi içinde tutarlı kaldığı için makul görünür.
   */
  test.each(TURRET)('$label sapması tam 914 mm', (row) => {
    const residual = forkChainResidualM({
      overallLengthL1: mm(row.l1),
      lengthToForkFaceL2: mm(row.l2),
      forkLengthM: mm(TURRET_FORK),
    })
    expect(chainCloses(residual)).toBe(false)
    expect(residual).toBeCloseTo(mm(-914), 9)
  })

  test('l1 − l2 beş modelde de 286 mm sabit', () => {
    // Sapmanın tesadüf olmadığının kanıtı: fark modele göre değişmiyor, yani
    // eksik olan çatal boyu değil — iki ölçü aynı niceliği ölçmüyor.
    for (const row of TURRET) expect(row.l1 - row.l2).toBe(286)
  })

  test('muafiyet gerekçesiyle birlikte yazılı', () => {
    expect(forkChainApplies('turret')).toBe(false)
    expect(forkChainApplies('forklift')).toBe(true)
    // Boş bir gerekçe, testi geçirmek için eklenmiş bir satırdır.
    const reason = CHAIN_EXEMPT.turret ?? ''
    expect(reason.length).toBeGreaterThan(80)
    expect(reason).toContain('914')
  })
})

describe('T3 — gövde zincirleri', () => {
  test.each(COUNTERBALANCE)('forklift $label: l2 = 190 + y + x', (row) => {
    const residual = counterbalancedChainResidualM({
      lengthToForkFaceL2: mm(row.l2),
      rearOverhangM: mm(COUNTERBALANCE_REAR_OVERHANG),
      wheelbaseY: mm(row.y),
      loadDistanceX: mm(row.x),
    })
    expect(chainCloses(residual)).toBe(true)
  })

  test.each(REACH)('reach $label: x = (210 + y) − l2', (row) => {
    const residual = reachChainResidualM({
      loadDistanceX: mm(row.x),
      rearToDriveAxleM: mm(REACH_REAR_TO_DRIVE_AXLE),
      wheelbaseY: mm(row.y),
      lengthToForkFaceL2: mm(row.l2),
    })
    expect(chainCloses(residual)).toBe(true)
  })

  test('iki sabit de yayınlanmış değil, ve bu yazılı', () => {
    // 190 ve 210 tablodan değil çizimden geliyor. Zincirin kapanması onların
    // doğru olduğunun kanıtı — ama katalogda `basis: 'estimate'` taşımalılar,
    // yoksa buradaki testler totolojiye döner.
    expect(COUNTERBALANCE_REAR_OVERHANG).toBe(190)
    expect(REACH_REAR_TO_DRIVE_AXLE).toBe(210)
  })
})

describe('T4 — koridor genişliği uzunluktan türetilemez', () => {
  /**
   * Elektrikli transpaletin kompakt platformu `l1`'i ve `l2`'yi 103 mm
   * kısaltıyor, ama çalışma koridorunu **108 mm** kısaltıyor.
   *
   * Beş milimetrelik bu fark, `Ast`'ın araç uzunluğunun bir fonksiyonu
   * olmadığının kanıtı. Bir formülle üretmek — "koridor = uzunluk + pay" —
   * her modelde makul, her modelde yanlış bir sayı verir.
   */
  const COMPACT_PLATFORM = { deltaL1: -103, deltaL2: -103, deltaAisle: -108 } as const

  test('uzunluk ve koridor farkı aynı değil', () => {
    expect(COMPACT_PLATFORM.deltaL1).toBe(COMPACT_PLATFORM.deltaL2)
    expect(COMPACT_PLATFORM.deltaAisle).not.toBe(COMPACT_PLATFORM.deltaL1)
  })
})

describe('T5 — palet yönelimi karışmaz', () => {
  /**
   * Yayınlanmış her `Ast` çiftinde 1000×1200 (enlemesine) değeri 800×1200
   * (boylamasına) değerinden küçüktür — palet uzun kenarıyla koridora dik
   * durduğunda daha az yer ister.
   *
   * Bu, iki sütunun takas edildiğini yakalayan tek testtir, ve takas edilebilir
   * olmasının sebebi kaynak tabloların onları **ters sırayla** basması: forklift
   * sayfası 1000×1200'ü önce, reach sayfası 800×1200'ü önce veriyor.
   */
  const PUBLISHED_AISLE_PAIRS = [
    { label: 'manuel transpalet', load1000x1200: 1584, load800x1200: 1784 },
    { label: 'elektrikli transpalet', load1000x1200: 2346, load800x1200: 2396 },
    { label: 'forklift 1300', load1000x1200: 3112, load800x1200: 3235 },
    { label: 'forklift 1500', load1000x1200: 3112, load800x1200: 3235 },
    { label: 'forklift 1600 kısa', load1000x1200: 3220, load800x1200: 3343 },
    { label: 'forklift 1600', load1000x1200: 3327, load800x1200: 3450 },
    { label: 'forklift 1800 kısa', load1000x1200: 3238, load800x1200: 3362 },
    { label: 'forklift 1800', load1000x1200: 3345, load800x1200: 3469 },
    { label: 'forklift 2000', load1000x1200: 3345, load800x1200: 3469 },
    { label: 'reach 1800', load1000x1200: 2737, load800x1200: 2790 },
    { label: 'reach 2000', load1000x1200: 2750, load800x1200: 2794 },
    { label: 'reach 2500 dar', load1000x1200: 2921, load800x1200: 2969 },
    { label: 'reach 2500', load1000x1200: 2854, load800x1200: 2883 },
  ]

  test.each(PUBLISHED_AISLE_PAIRS)('$label', (row) => {
    expect(row.load1000x1200).toBeLessThan(row.load800x1200)
  })

  test('on üç yayınlanmış çiftin hepsi sayıldı', () => {
    expect(PUBLISHED_AISLE_PAIRS).toHaveLength(13)
  })

  test('turret çifti YOK, ve bu kasıtlı', () => {
    // VNA makinesinin Ast'ı üretici tarafından yayınlanmıyor. Listede olmaması
    // bir eksiklik değil, kaydedilmiş bir bulgu: uydurulacak yer burasıydı.
    expect(PUBLISHED_AISLE_PAIRS.some((r) => r.label.includes('turret'))).toBe(false)
  })
})
