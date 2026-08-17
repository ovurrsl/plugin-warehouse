/**
 * Palet asansörü katalog verisi — kapasite kademeleri, yayınlanmış dikey
 * hızlar, mast kesitleri ve bileşen kutu ölçüleri.
 *
 * Kaynaklar: Mecalux, SSI Schäfer, PFlow (uluslararası) · Ekol Lojistik,
 * Avemak, İdas Otomasyon (Türkiye). Standart: EN 1570-1 (≤2 kat) /
 * EN 1570-2 (>2 kat) + Makine Direktifi/CE.
 *
 * Bu dosya `dockleveller/catalog.ts`'in yaptığını yapıyor: neyin YAYINLANMIŞ
 * neyin SEÇİLMİŞ VARSAYILAN olduğunu adıyla ayırmak. Bir kademeyi değiştirmek
 * bir modelleme kararıdır, yazım hatası değil.
 */

const mm = (value: number) => value / 1000

/** Kapasite kademeleri, kg — string enum. KAYNAK: Mecalux/PFlow ürün sınıfları. */
export const CAPACITY_CLASSES = ['1000', '1500', '4500'] as const
export type CapacityClass = (typeof CAPACITY_CLASSES)[number]

/**
 * Kademe başına dikey hız, m/dak — ve YAYINLANMIŞ mı.
 *
 * 1000 kg → 80 m/dak, 1500 kg → 60 m/dak: KAYNAK Mecalux/PFlow standart palet
 * asansörü sınıfları (spec §4). 4500 kg ağır hizmet için net m/dak verisi
 * bulunamadı; buradaki 20 m/dak SEÇİLMİŞ VARSAYILAN, ölçüm değil.
 */
export const SPEED_MPM: Record<CapacityClass, { mpm: number; published: boolean }> = {
  '1000': { mpm: 80, published: true },
  '1500': { mpm: 60, published: true },
  '4500': { mpm: 20, published: false },
}

/**
 * Mast (kılavuz kolon) kesiti, metre — kademeye göre.
 *
 * Spec §2: kesit 150-250 mm aralığında YAYINLANMIŞ; kademe başına HANGİ
 * kesitin kullanıldığı yayınlanmıyor, o yüzden aşağıdaki eşleme SEÇİLMİŞ
 * VARSAYILAN — ağır yük daha kalın kolon ister, makul bir kademelendirme.
 */
export const MAST_SECTION_M: Record<CapacityClass, number> = {
  '1000': mm(150),
  '1500': mm(200),
  '4500': mm(250),
}

/**
 * Aşırı seyahat payı — mast, en üst kat kotundan bu kadar yukarı çıkar
 * (spec §3: overtravel_clearance). VARSAYIM.
 */
export const OVERTRAVEL_M = mm(1200)

/** Platform döşeme kalınlığı, metre. Spec §2: ~150-250 mm; orta değer VARSAYIM. */
export const PLATFORM_THICKNESS_M = mm(200)

/** Palet ile platform kenarı arası açıklık payı, HER YANDA (spec §3). VARSAYIM. */
export const CLEARANCE_MARGIN_M = mm(150)

/** Platform kenarı ile mast arası boşluk, metre. VARSAYIM. */
export const MAST_GAP_M = mm(50)

/** Sürüş (tahrik) ünitesi kutusu `[genişlik, yükseklik, derinlik]`, metre.
 *  Spec §2: ~600×600×400 mm. VARSAYIM. */
export const DRIVE_BOX_M: readonly [number, number, number] = [mm(600), mm(400), mm(600)]

/** Kontrol panosu kutusu `[genişlik, yükseklik, derinlik]`, metre.
 *  Spec §2: ~400×300×200 mm. VARSAYIM. */
export const CONTROL_PANEL_M: readonly [number, number, number] = [mm(400), mm(300), mm(200)]

/** Kontrol panosunun zemin kotundan tabanı, metre. VARSAYIM. */
export const CONTROL_PANEL_BASE_M = mm(900)

/** Kat kapısı yüksekliği, metre. Spec §2 satır 6: ~2000 mm. VARSAYIM. */
export const DOOR_HEIGHT_M = mm(2000)

/** Kapı çerçevesi profil kalınlığı, metre. VARSAYIM. */
export const DOOR_FRAME_M = mm(80)

/** Kapı panelinin çerçeve içindeki açıklığından her yana boşluğu, metre. */
export const DOOR_PANEL_INSET_M = mm(20)

/** Kapı paneli sac kalınlığı (Z), metre. VARSAYIM. */
export const DOOR_PANEL_DEPTH_M = mm(40)

/** Taban çerçevesi kirişi yüksekliği, metre. VARSAYIM. */
export const BASE_FRAME_H_M = mm(150)

/** Platform rulo konveyörü — rulo çapı ve adımı, metre. VARSAYIM. */
export const ROLLER_DIAMETER_M = mm(60)
export const ROLLER_PITCH_M = mm(120)

/** Platform kenar takozu (toe guard) yüksekliği ve kalınlığı, metre. VARSAYIM. */
export const TOE_GUARD_H_M = mm(80)
export const TOE_GUARD_T_M = mm(30)

/** Güvenlik muhafazasının mast zarfından her yana payı, metre. VARSAYIM. */
export const ENCLOSURE_MARGIN_M = mm(100)

/**
 * Kapı ve bekleme süreleri, saniye — ÇALIŞMA TAHMİNİ, ölçüm değil.
 *
 * Yükleme/boşaltma (LOADING/UNLOADING, spec §5) süresi ve kapı hareketi hiçbir
 * katalogda yayınlanmıyor; aşağıdaki değerler görselleştirmenin okunabilir
 * olması için seçildi.
 */
export const DOOR_OPEN_S = 1.5
export const DOOR_CLOSE_S = 1.5
export const DWELL_LOAD_S = 2.5

/** Aile paleti — rol başına tek renk, vertex attribute'una yazılır. Boyanabilir
 *  roller (mast/platform/kapı) şema alanı; aşağıdakiler donanım rengi. */
export const PALETTE = {
  /** Rulo konveyör silindirleri — koyu gri (spec §2 satır 3). */
  roller: '#2b2f34',
  /** Tahrik ünitesi gövdesi — RAL 7016 antrasit (spec §2 satır 4). */
  drive: '#383e42',
  /** Taban çerçevesi ve mast tabanları. */
  base: '#4a5157',
  /** Kontrol panosu gövdesi — RAL 7035 açık gri. */
  control: '#d1d3d4',
  /** Kenar takozu — endüstriyel sarı, uyarı rengi. */
  toeGuard: '#f2c200',
} as const
