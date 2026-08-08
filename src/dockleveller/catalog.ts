/**
 * Yükleme rampası (dock leveller) — kapanınca zeminle aynı seviyede olan,
 * çukura gömülü hidrolik köprü.
 *
 * ## Neyi modelliyor
 *
 * Depo kapısının önündeki çukura oturur. Dinlenmede tablası bitmiş zeminle
 * AYNI kotta durur ve üstünden forklift geçer ("cross-traffic" konumu); dorse
 * yanaştığında tabla kalkar ya da iner, ucundaki dudak dorsenin zeminine
 * uzanır ve arada sürekli bir yüzey oluşur. Rampanın tamamı — silindir, pompa,
 * çerçeve — çukurun içinde; yerleşimde görünen tek şey tabla ve dudaktır.
 *
 * ## Sayıların kaynağı
 *
 * KAYNAK olarak işaretli her değer yayımlanmış bir üretici tablosundan ya da
 * standarttan geliyor:
 *
 *  - **Stertil Dock Products, S-Series (menteşeli dudak)** — dinamik kapasite
 *    6 t / 8 t; tabla genişlikleri 1750 / 1830 / 2000 / 2110 / 2250 mm; tabla
 *    boyu (dudak hariç) 2000–4500 mm; standart dudak 350 / 400 / 405 / 500 mm,
 *    azami 1000 mm; dudak ucunda 75 mm pah; çerçeve yüksekliği standart
 *    585 mm, azami 700 mm; çalışma aralığı tablosu (aşağıda).
 *  - **Stertil Dock Products, X-Series (teleskopik dudak)** — kapasite 6 / 8 /
 *    10 t; tabla boyları 2000 / 2200 / 2500 / 2800 / 3000 / 3500 / 4000 /
 *    4500 mm; teleskopik dudak azami uzanımı 1000 mm, 2000–2200 mm boyundaki
 *    tablalarda 785 mm; dudak açısı 5,5°.
 *  - **EN 1398 (Dock levellers — Safety requirements)** — azami eğim %12,5
 *    (1:8), yaklaşık 7°.
 *  - **Loading Systems** — dudak sacı 14 mm kaymaz + nervür yüksekliği.
 *
 * Bunların DIŞINDA kalan her ölçü — tabla sacı kalınlığı, ayak koruma
 * eteğinin boyu, kumanda direği, çukur duvar kalınlığı — SEÇİLMİŞ VARSAYILAN
 * olarak işaretli. Hiçbiri bir katalogdan gelmiyor ve öyleymiş gibi
 * okunmamalı.
 */

const mm = (value: number) => value / 1000

/** KAYNAK: Stertil S/X serisi tabla genişlikleri. */
export const PLATFORM_WIDTHS = ['1750', '1830', '2000', '2110', '2250'] as const
export type PlatformWidth = (typeof PLATFORM_WIDTHS)[number]

/** KAYNAK: Stertil X serisi tabla boyları (dudak hariç). */
export const PLATFORM_LENGTHS = [
  '2000',
  '2200',
  '2500',
  '2800',
  '3000',
  '3500',
  '4000',
  '4500',
] as const
export type PlatformLength = (typeof PLATFORM_LENGTHS)[number]

/** KAYNAK: Stertil S serisi standart menteşeli dudak boyları. */
export const HINGED_LIPS = ['350', '400', '405', '500'] as const
export type HingedLip = (typeof HINGED_LIPS)[number]

/** KAYNAK: Stertil — 6 / 8 / 10 t dinamik kapasite, kN cinsinden. */
export const CAPACITIES = ['60', '80', '100'] as const
export type Capacity = (typeof CAPACITIES)[number]

/** KAYNAK: Stertil — standart 585 mm, azami 700 mm çerçeve yüksekliği. */
export const FRAME_HEIGHTS = ['585', '700'] as const
export type FrameHeight = (typeof FRAME_HEIGHTS)[number]

/**
 * KAYNAK: Stertil X serisi — teleskopik dudağın azami uzanımı 1000 mm, ama
 * 2000–2200 mm boyundaki tablalarda 785 mm. Kısa tablada dudağın çekili hâlde
 * saklanacağı cebi yok.
 */
export const TELESCOPIC_LIP_MAX_M = mm(1000)
export const TELESCOPIC_LIP_MAX_SHORT_M = mm(785)
/** Kısa tabla sınırı: bu boya kadar (dahil) kısaltılmış uzanım geçerli. */
export const TELESCOPIC_SHORT_PLATFORM_M = mm(2200)

/** KAYNAK: Stertil X serisi — teleskopik dudağın kendi açısı. */
export const TELESCOPIC_LIP_ANGLE_RAD = (5.5 * Math.PI) / 180

/** KAYNAK: Stertil — dudak ucundaki pah. */
export const LIP_CHAMFER_M = mm(75)

/** KAYNAK: Loading Systems — dudak sacı 14 mm kaymaz. */
export const LIP_PLATE_M = mm(14)

/** KAYNAK: EN 1398 — azami eğim %12,5 (1:8). */
export const EN1398_MAX_GRADIENT = 0.125

/**
 * KAYNAK: Stertil S serisi "working range" tablosu — 350 mm dudak, 7,5° ve
 * 100 mm tampon ile ölçülmüş teorik aralıklar.
 *
 * Tablo iki BANT hâlinde yayımlanıyor, boy başına tek tek değil:
 *
 * | tabla boyu    | zemin üstü | zemin altı |
 * |---------------|------------|------------|
 * | 2000–3000 mm  | 240–350 mm | 295–315 mm |
 * | 3500–4500 mm  | 405–445 mm | 330–355 mm |
 *
 * Banttaki ara boyların değeri yayımlanmıyor. Aradaki değerler bu dosyada
 * DOĞRUSAL ARA DEĞER ile bulunuyor ve bu benim seçimim, üreticinin tablosu
 * değil: 2500 mm'lik bir tablanın zemin üstü aralığı Stertil'in kendi boyut
 * tablosundan okunmalı, buradaki 295 mm ondan birkaç santim sapabilir.
 * Rakamlar yerleşimin doğru okunması için var; bir teklif için üreticiye
 * sorulmalı.
 */
export type WorkingRangeBand = {
  /** Bandın alt ve üst tabla boyu, metre. */
  fromM: number
  toM: number
  /** Bandın uçlarındaki zemin ÜSTÜ aralık, metre. */
  aboveFromM: number
  aboveToM: number
  /** Bandın uçlarındaki zemin ALTI aralık, metre. */
  belowFromM: number
  belowToM: number
}

export const WORKING_RANGE_BANDS: readonly WorkingRangeBand[] = [
  {
    fromM: mm(2000),
    toM: mm(3000),
    aboveFromM: mm(240),
    aboveToM: mm(350),
    belowFromM: mm(295),
    belowToM: mm(315),
  },
  {
    fromM: mm(3500),
    toM: mm(4500),
    aboveFromM: mm(405),
    aboveToM: mm(445),
    belowFromM: mm(330),
    belowToM: mm(355),
  },
]

/**
 * KAYNAK: Stertil'in çalışma aralığı tablosu bu tamponla ölçülmüş — yani
 * 100 mm, aralık rakamlarının parçası, bizim seçimimiz değil.
 */
export const BUMPER_PROJECTION_M = mm(100)

// ── Zarfın içindekiler: HİÇBİRİ katalogdan gelmiyor ──────────────────────────

/** Tabla sacı — gözyaşı desenli sac. SEÇİLMİŞ VARSAYILAN. */
export const PLATFORM_PLATE_M = mm(12)
/** Tablanın altındaki boyuna nervürler. SEÇİLMİŞ VARSAYILAN. */
export const RIB_DEPTH_M = mm(90)
export const RIB_THICKNESS_M = mm(8)
export const RIB_COUNT = 4
/**
 * Ayak koruma eteği (toe guard) — tabla kalkınca yanda açılan makas
 * boşluğunu kapatan sarı-siyah etek. EN 1398 yandaki ezilme tehlikesine karşı
 * koruma İSTİYOR; eteğin BOYU standartta yok, buradaki değer seçilmiş.
 */
export const TOE_GUARD_HEIGHT_M = mm(200)
export const TOE_GUARD_THICKNESS_M = mm(6)
/** Çukur duvarı ve taban sacı. SEÇİLMİŞ VARSAYILAN. */
export const PIT_WALL_M = mm(60)
export const PIT_FLOOR_M = mm(40)
/** Arka menteşe borusu. SEÇİLMİŞ VARSAYILAN. */
export const HINGE_TUBE_M = mm(70)
/** Hidrolik silindir gövdesi — çukurun içinde, yalnız yakın katmanda. */
export const CYLINDER_M: readonly [number, number, number] = [mm(520), mm(120), mm(120)]
/**
 * Tampon yüzü `[yükseklik, genişlik]`. İLERİ ÇIKINTI burada değil
 * `BUMPER_PROJECTION_M`'de, ve o KAYNAK: çalışma aralığı tablosu 100 mm
 * tamponla ölçülmüş. Yüzün 250 × 250 mm'si seçilmiş varsayılan.
 */
export const BUMPER_FACE_M: readonly [number, number] = [mm(250), mm(250)]
/** Tampon merkezinin zeminden kotu. SEÇİLMİŞ VARSAYILAN. */
export const BUMPER_Y_M = mm(400)
/** İki tamponun kapı ekseninden yana açıklığı. SEÇİLMİŞ VARSAYILAN. */
export const BUMPER_SPREAD_RATIO = 0.34
/** Kumanda direği: iki elle-tut butonu taşıyan kutu. SEÇİLMİŞ VARSAYILAN. */
export const CONTROL_POST_M = mm(80)
export const CONTROL_HEIGHT_M = mm(1200)
export const CONTROL_BOX_M: readonly [number, number, number] = [mm(140), mm(220), mm(180)]
/** Direğin tabla kenarından yana açıklığı. */
export const CONTROL_OFFSET_M = mm(350)

/** Aile paleti — parça rolü başına tek renk, vertex attribute'una yazılıyor. */
export const PALETTE = {
  /** Boyalı çelik çerçeve ve çukur astarı. */
  frame: '#3d4753',
  /** Tabla ve dudak sacı — galvaniz gözyaşı sac. */
  deck: '#7d8894',
  /** Ayak koruma eteği: endüstriyel sarı. Renk keyfî değil, uyarı rengi. */
  guard: '#f2c200',
  /** Tampon kauçuğu. */
  bumper: '#22262a',
  /** Kumanda kutusu gövdesi. */
  control: '#c9ced3',
  /** Acil stop mantarı. */
  estop: '#c62828',
} as const
