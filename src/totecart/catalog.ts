/**
 * Tote cart — sipariş toplama arabası: tekerlekli çelik çerçeve, katlar
 * hâlinde tepsiler, her tepside bir Euro kasa.
 *
 * ## Önce, bu nesne hakkında öğrenilen en önemli şey
 *
 * **Hiçbir standart bir el arabasının HİÇBİR ölçüsünü belirlemiyor.**
 *
 * Bu nesneyi kapsayan standart EN 1757:2022 ("Safety of industrial trucks —
 * Pedestrian propelled industrial platform trucks", anma kapasitesi ≤ 500 kg)
 * ve madde listesinde tek bir boyut maddesi yok: kuvvetler, yönlendirme,
 * tekerler ve tekerlek takımları, park freni, denge, ezilme/makaslama
 * noktaları, kenarlar, doğrulama, işaretleme. Toplam boy, en, yükseklik,
 * tepsi ölçüsü, kat aralığı, tutamak kotu — hiçbiri geçmiyor.
 *
 * Elenen adaylar: EN ISO 3691-5 (kapsamındaki her şey KALDIRIR), DIN 15155
 * (Gitterbox), EN 12674 (roll konteyner), EN 12195 (karayolu emniyetleme),
 * EN 1929 (market arabası).
 *
 * Sonuç: bu dosyadaki her araba ölçüsü bir ÜRETİCİ tercihidir, bir uyum
 * rakamı değil. KAYNAK etiketi "şu üretici şunu yayımlıyor" demek, "şöyle
 * olmak zorunda" demek değil.
 *
 * ## Ölçülerin kaynağı
 *
 *  - **Kullanıcının kendi spec dosyası** (`tote-cart-spec.md`) — zarf
 *    600 × 1500 × 400 mm. Dosya bir üretici ya da katalog GÖSTERMİYOR;
 *    uygulamanın kendi seçtiği varsayılan. Yine de KAYNAK sayılıyor çünkü
 *    bu paketin taşıması gereken şey o.
 *  - **ISO 3394:2012** — 600 × 400 modülü ve alt katları. Bu nesnedeki TEK
 *    standartlaşmış ölçü. (Kasanın YÜKSEKLİĞİNİ standart belirlemiyor.)
 *  - **AUER Packaging EG serisi** — 600 × 400 kasanın tam yükseklik
 *    merdiveni ve iç ölçüleri, TEK üreticiden.
 *  - **VDA 4500 v3.1** — 400 × 300 KLT'nin yükseklik ızgarası.
 *  - **Topstore / BiGDUG BSECT6BC** — tepsili tote arabası: 470 × 700 ×
 *    1500 mm, altı kat, kat başına bir kasa, 250 kg, Ø100 döner tekerlek,
 *    ikisi frenli.
 *  - **ROLLCART 08-7710** — sweep'te bulunan EN eksiksiz yayımlanmış araba:
 *    en alt kat 170 mm, itme kolu 900 mm, kol borusu Ø26,9 × 1,75.
 *  - **fetra + Wanzl** — raf ayar ızgarası 100 mm (ikisi bağımsız yayımlıyor).
 *  - **Blickle TPA / LE-TPA 127KF-FI** — tekerlek çapına göre yük, ve Ø125
 *    için tek tam boyutlandırılmış tekerlek takımı.
 *
 * ## Karışmaması gereken iki şey
 *
 * **Yükseklik merdivenleri BİRLEŞTİRİLMİYOR.** 600 × 400 ailesinin
 * merdiveni AUER'in, 400 × 300'ünki VDA'nın. Üreticiler arasında yalnız
 * 220 ve 320 ortak; ötekileri karıştırmak var olmayan bir kasa üretir.
 *
 * **İç ölçüler ortalanmıyor.** Aynı 600 × 400 dış ölçü için iç uzunluk
 * üreticiden üreticiye 553–570 mm arasında geziyor (17 mm fark). Ortalama
 * almak, kimsenin yayımlamadığı bir et kalınlığını sessizce uydurmak olurdu.
 * Bu dosya AUER'i modelliyor ve bunu söylüyor.
 */

const mm = (value: number) => value / 1000

// ── Kasalar ─────────────────────────────────────────────────────────────────

export const TOTE_FOOTPRINTS = ['600x400', '400x300'] as const
export type ToteFootprint = (typeof TOTE_FOOTPRINTS)[number]

export type ToteSize = {
  /** Dış yükseklik, mm — anahtar olarak da kullanılıyor. */
  height: string
  /** Dış yükseklik, metre. */
  heightM: number
  /** İç yükseklik, metre. */
  innerHeightM: number
}

export type ToteFamily = {
  id: ToteFootprint
  label: string
  /** Dış taban, metre — KAYNAK: ISO 3394 modülü. */
  lengthM: number
  widthM: number
  /** İç taban, metre — TEK üreticiden, ortalama değil. */
  innerLengthM: number
  innerWidthM: number
  /** Bu ailenin yükseklik merdiveni. Aileler arası KARIŞTIRILMAZ. */
  heights: readonly ToteSize[]
  /** Merdivenin kaynağı — panelde ve MCP'de görünür. */
  source: string
}

/** AUER EG 64xx merdiveni: dış / iç yükseklik çiftleri, hepsi yayımlanmış. */
const AUER_600x400: ToteSize[] = [
  { height: '75', heightM: mm(75), innerHeightM: mm(70) },
  { height: '120', heightM: mm(120), innerHeightM: mm(115) },
  { height: '170', heightM: mm(170), innerHeightM: mm(165) },
  { height: '220', heightM: mm(220), innerHeightM: mm(215) },
  { height: '270', heightM: mm(270), innerHeightM: mm(265) },
  { height: '320', heightM: mm(320), innerHeightM: mm(315) },
  { height: '420', heightM: mm(420), innerHeightM: mm(415) },
]

/**
 * VDA 4500 R-KLT ızgarası. AUER'inkiyle BİRLEŞMİYOR ve birleşmemeli:
 * VDA kendi ızgarasını yayımlıyor ve o ızgara üretici merdiveniyle
 * kilitlenmiyor.
 *
 * **Kimlik ile ölçü aynı şey değil.** VDA'nın tip numaraları yüksekliği
 * YUVARLIYOR — 4315 / 4322 / 4329 sırasıyla 147,5 / 213,75 / 280 mm'lik
 * ızgara adımlarına karşılık geliyor (§3.1–3.3, 15 mm iç içe geçme payı;
 * 280 − 15 = 265 = 2 × 132,5 ızgarayı doğruluyor). İlk hâlde `heightM` tip
 * numarasının yuvarlanmış hâlini taşıyordu: 213 mm'lik bir kasa VDA'da yok,
 * ve rakam yayımlanmış gibi duruyordu. Kimlik yuvarlak (kullanıcı onu
 * tanıyor), ölçü tam.
 *
 * VDA bu kasaların iç doğrusal ölçülerini HİÇ yayımlamıyor — yalnız dm³ —
 * o yüzden buradaki iç yükseklikler dış eksi 5 mm olarak seçildi (AUER'in
 * kendi ailesinde tuttuğu fark) ve bu bir SEÇİM.
 */
const VDA_400x300: ToteSize[] = [
  { height: '147', heightM: mm(147.5), innerHeightM: mm(142.5) },
  { height: '213', heightM: mm(213.75), innerHeightM: mm(208.75) },
  { height: '280', heightM: mm(280), innerHeightM: mm(275) },
]

export const TOTE_FAMILIES: Record<ToteFootprint, ToteFamily> = {
  '600x400': {
    id: '600x400',
    label: 'Euro 600 × 400',
    lengthM: mm(600),
    widthM: mm(400),
    // KAYNAK: AUER EG 6422 — iç 570 × 370. SSI (553 × 353), BITO (568/559)
    // ve Utz (558 × 358) farklı yazıyor; ortalama ALINMADI.
    innerLengthM: mm(570),
    innerWidthM: mm(370),
    heights: AUER_600x400,
    source: 'AUER Packaging EG 64xx',
  },
  '400x300': {
    id: '400x300',
    label: 'KLT 400 × 300',
    lengthM: mm(400),
    widthM: mm(300),
    // VDA iç doğrusal ölçü yayımlamıyor; AUER'in EG 43xx ailesindeki
    // 30 mm'lik çevre farkı taşındı — SEÇİLMİŞ VARSAYILAN.
    innerLengthM: mm(370),
    innerWidthM: mm(270),
    heights: VDA_400x300,
    source: 'VDA 4500 v3.1 (R-KLT ızgarası)',
  },
}

export function toteHeightIds(footprint: ToteFootprint): readonly string[] {
  return TOTE_FAMILIES[footprint].heights.map((size) => size.height)
}

/** Bütün ailelerin yükseklik kimlikleri — şema enum'u için, tekilleştirilmiş. */
export const ALL_TOTE_HEIGHTS = [
  ...new Set(TOTE_FOOTPRINTS.flatMap((id) => toteHeightIds(id))),
] as [string, ...string[]]

// ── Araba ───────────────────────────────────────────────────────────────────

/**
 * KAYNAK: kullanıcının kendi `tote-cart-spec.md` dosyası — 600 × 1500 × 400.
 * Bu paket 600'ü arabanın BOYU (itme yönü, +X), 400'ü ENİ (koridora bakan
 * yüz, Z) olarak okuyor: koridora bakan yüzün dar olanı olması gereken şey,
 * ve tepsiye yatan Euro kasanın 600'lük kenarı arabanın boyunca gidiyor.
 * Spec hangisinin hangisi olduğunu söylemiyor; bu okuma söylüyor.
 */
export const SPEC_CART_LENGTH_M = mm(600)
export const SPEC_CART_WIDTH_M = mm(400)
/** KAYNAK: aynı spec — ve bağımsız olarak Topstore/BiGDUG BSECT6BC de 1500. */
export const SPEC_CART_HEIGHT_M = mm(1500)

/** KAYNAK: Topstore / BiGDUG BSECT6BC — tepsili tote arabası toplam yükü. */
export const CART_CAPACITY_KG = 250

/** KAYNAK: ROLLCART 08-7710 ve 08-7720 — en alt katın zeminden kotu. */
export const BOTTOM_TIER_M = mm(170)

/** KAYNAK: fetra ve Wanzl, bağımsız — raf ayar ızgarası. */
export const TIER_GRID_M = mm(100)

/** KAYNAK: EN 1757:2022 anma kapasitesi tavanı. Boyut maddesi YOK. */
export const EN1757_MAX_CAPACITY_KG = 500

export const CASTOR_DIAMETERS = ['100', '125', '160'] as const
export type CastorDiameter = (typeof CASTOR_DIAMETERS)[number]

export type CastorSpec = {
  id: CastorDiameter
  diameterM: number
  /** Tek tekerlek yük kapasitesi, kg — KAYNAK: Blickle TPA serisi, 4 km/h. */
  capacityKg: number
  /** Toplam yapı yüksekliği, metre. */
  buildHeightM: number
  /** Tekerlek genişliği, metre. */
  treadM: number
  /** Yapı yüksekliği ve genişlik yayımlanmış mı, yoksa seçilmiş mi. */
  buildHeightSourced: boolean
}

/**
 * Tekerlek takımları.
 *
 * Yük kapasiteleri KAYNAK (Blickle TPA serisi tablosu). Ø125'in yapı
 * yüksekliği ve genişliği de KAYNAK (Blickle LE-TPA 127KF-FI: 150 mm yapı,
 * Ø125 × 32). Ötekilerin yapı yüksekliği ve genişliği SEÇİLMİŞ: hiçbir
 * üretici çap→yapı yüksekliği tablosu yayımlamıyor, Blickle bile yalnız
 * 33–510 mm'lik bir aralık zarfı veriyor. `buildHeightSourced` bu ayrımı
 * makine-okunur tutuyor ve panel onu gösteriyor.
 */
export const CASTORS: Record<CastorDiameter, CastorSpec> = {
  '100': {
    id: '100',
    diameterM: mm(100),
    capacityKg: 110,
    buildHeightM: mm(128),
    treadM: mm(30),
    buildHeightSourced: false,
  },
  '125': {
    id: '125',
    diameterM: mm(125),
    capacityKg: 125,
    buildHeightM: mm(150),
    treadM: mm(32),
    buildHeightSourced: true,
  },
  '160': {
    id: '160',
    diameterM: mm(160),
    capacityKg: 200,
    buildHeightM: mm(195),
    treadM: mm(40),
    buildHeightSourced: false,
  },
}

// ── Zarfın içindekiler: HİÇBİRİ katalogdan gelmiyor ──────────────────────────

/**
 * Çerçeve profili. ROLLCART (30/30/3 köşebent) ve Hupfer (30 × 30 kutu) —
 * sweep'te kesit yayımlayan tek iki üretici — ikisi de 30 mm diyor, ama
 * kesitin kendisi (kare kutu, 2 mm et) SEÇİLMİŞ VARSAYILAN.
 */
export const FRAME_M = mm(30)
/** Tepsi sacı. Hiçbir üretici yayımlamıyor. */
export const DECK_PLATE_M = mm(1.5)
/** KAYNAK: BITO — tepsi çerçevesinde 12 mm'lik bordür. */
export const DECK_LIP_M = mm(12)
/**
 * Tepsinin kasadan her yandan fazlası — kasanın tepsiye DÜŞEBİLMESİ için.
 *
 * Tepsi tam kasa ölçüsünde olsaydı bordür kasanın duvarının içinde kalırdı:
 * 588 × 7 × 3 mm'lik bir çelik parçası plastiğin içinden geçiyor, ve
 * dışardan bakınca hiçbir şey görünmüyor. Hiçbir üretici bu payı
 * yayımlamıyor — SEÇİLMİŞ VARSAYILAN, ve bordür kalınlığına eşit tutuldu ki
 * bordürün iç yüzü tam kasanın dış yüzüne değsin.
 */
export const TOTE_FIT_CLEAR_M = mm(3)
/**
 * Kasanın üstündeki serbest yükseklik. Bir bayi ailesinin (506CT)
 * yükseklik/adet merdiveninden çıkarılan aritmetik; yayımlanmış bir kural
 * DEĞİL ve o ailenin kendisi de 118 mm'lik kasada bozuluyor (34,5 mm).
 */
export const TOTE_CLEARANCE_M = mm(30)
/**
 * İtme kolunun kotu. Sweep'te iki yayımlanmış değer var ve uyuşmuyorlar:
 * ROLLCART 900, Manutan 1035. Ortası seçildi.
 */
export const HANDLE_HEIGHT_M = mm(1000)
/** KAYNAK: ROLLCART 08-7710 — kol borusu Ø26,9. */
export const HANDLE_TUBE_M = mm(27)
/** Tekerleğin köşeden içeri kaçıklığı. Hiçbir üretici yayımlamıyor; alt
 *  sınırı tekerlek plakasının yarısı (Blickle 100 × 85). */
export const CASTOR_INSET_M = mm(70)
/**
 * Eğimli tepsi açısı, radyan.
 *
 * Eğimli katlı arabalar gerçek (506CT06 "1 fixed and 2 tilting tiers",
 * LKE SE3 "3 inclined levels") ama HİÇBİRİ açıyı yayımlamıyor. 15°
 * kullanıcının kendi eski uygulamasından geliyor — orada
 * `// 15 degrees tilt for stable loading` diye yazılı — yani bir katalog
 * değeri değil, önceki yazarın tercihi. Öyle taşınıyor.
 */
export const TILT_RAD = (15 * Math.PI) / 180

/** Kasanın et kalınlığı. Hiçbir üretici yayımlamıyor — Utz, SSI, AUER,
 *  BITO, Schoeller Allibert, bekuplast, hiçbiri; VDA 4500 de değil. */
export const TOTE_WALL_M = mm(6)
/** Kasa kenarındaki takviye bileziği. Seçilmiş. */
export const TOTE_RIM_M = mm(10)

/** Aile paleti — parça rolü başına tek renk, vertex attribute'una yazılıyor. */
export const PALETTE = {
  /** Galvaniz/boyalı çelik çerçeve. */
  frame: '#c2c8ce',
  /** Tepsi sacı — çerçeveden bir ton koyu ki katlar okunsun. */
  deck: '#9aa3ab',
  /** Kasa gövdesi. Kullanıcının eski uygulamasının yeşili. */
  tote: '#2e7d32',
  /** Kasanın iç tabanı — gövdeden koyu, derinlik okunsun. */
  toteInner: '#1b5e20',
  /** Lastik. */
  tyre: '#1a1a1a',
  /** Jant ve mafsal. */
  hub: '#8b9299',
  /** Fren pedalı ve bilezikler. */
  joint: '#444444',
} as const
