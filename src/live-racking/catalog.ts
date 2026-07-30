/**
 * Mecalux Canlı Palet Rafı (Live Pallet Racking) — yerçekimi akışlı kanal.
 *
 * Kaynak: kullanıcının ilettiği teknik spesifikasyon paketi (Mecalux Live
 * Pallet Racking kataloğu, DirectIndustry 28 s. + mecalux.com SSS).
 * Etiketler: CATALOG (üreticiden birebir), RESEARCHED (Mecalux dışı tedarikçi
 * verisi), ASSUMPTION (varsayım). Repo'nun her yerde yaptığı gibi JSON
 * `_assumption` bayrağı değil, yorum satırı.
 *
 * Her ölçü METRE — `mm()` yalnız bu dosyayı yazarken kullanılır.
 */

const mm = (value: number): number => value / 1000

// ── Akış ──────────────────────────────────────────────────────────────────

/** Kanal eğimi. Mecalux SSS: "sloped at an angle of approximately 4%". */
export const DEFAULT_GRADIENT = 0.04
/** Sektör aralığı — RESEARCHED (Mecalux dışı tedarikçiler %3–5 veriyor). */
export const GRADIENT_RANGE = { min: 0.03, max: 0.05 }

// ── Ölçü zinciri (CATALOG) ────────────────────────────────────────────────
//
// Tablonun kendisi bu iki formülle kapanıyor ve test bunu kilitliyor
// (teleskopik konveyörün C = A + B testinin aynısı):
//   E = A + 160   (her yanda 80 mm)
//   D = A + 30    (makara boyu; A paletin taban genişliği)

/** Bay genişliği payı: her yanda 80 mm. */
export const BAY_SIDE_CLEARANCE_M = mm(80)
/** Makaranın paletten taşan payı. */
export const ROLLER_OVER_PALLET_M = mm(30)

export type ClearanceRow = {
  /** Paletin kanal ağzına bakan genişliği, metre. */
  A: number
  /** Makara boyu D = A + 30 mm. */
  D: number
  /** Bay genişliği E = A + 160 mm. */
  E: number
}

/**
 * Katalogun yayınladığı açıklık tablosu — üç palet genişliği.
 *
 * Formüller bu satırlardan TÜRETİLMEDİ, bu satırlara karşı DOĞRULANIYOR:
 * tablo bağımsız bir kaynak ve bir transkripsiyon hatası ancak böyle
 * yakalanır.
 */
export const CLEARANCE_TABLE: readonly ClearanceRow[] = [
  { A: mm(800), D: mm(830), E: mm(960) },
  { A: mm(1000), D: mm(1030), E: mm(1160) },
  { A: mm(1200), D: mm(1230), E: mm(1360) },
]

// ── Kısıtlar (CATALOG) ────────────────────────────────────────────────────

/** Kızak genişliği bunun altına inemez. */
export const MIN_SKID_WIDTH_M = mm(100)
/** Kanal altındaki en küçük serbest yükseklik H. */
export const MIN_CLEAR_HEIGHT_M = mm(400)
/** Çerçeve yüksekliği bunun katı olmalı. */
export const FRAME_HEIGHT_STEP_M = mm(50)
/** Makara aralığı (tablo ölçüsü Y) bunun katı olmalı; fren tamburu aralığını
 *  da bu belirliyor. */
export const ROLLER_PITCH_STEP_M = mm(75)
/** Makara ile fren makarası arası (tablo ölçüsü Z). */
export const ROLLER_TO_BRAKE_M = mm(100)
/**
 * Fren makarası YALNIZ ikiden derin kanalda takılır — iki palet derinlikte
 * yerçekimi zaten kontrollü, üçüncüden itibaren hız regülasyonu gerekiyor.
 */
export const BRAKE_ROLLER_MIN_DEPTH = 2
/** Kanal en fazla bu kadar palet derinliğinde olabilir. */
export const MAX_PALLETS_DEEP = 30
/** Palet tutucu takılıysa iki palet arasında bırakılan boşluk. */
export const RETAINER_GAP_M = mm(300)
/**
 * Katalogun yayınladığı koridor boyu datumu: 20 m.
 *
 * Sert bir sınır DEĞİL — katalog "20 m'den uzun koridorlar da kurulabilir"
 * diyor. Bu yüzden reddetmiyoruz, yalnız uyarıyoruz: 30 palet × 1200 mm
 * kanal 36 m'yi buluyor ve kullanıcının bunu bilerek yapması gerekir.
 */
export const LANE_LENGTH_DATUM_M = 20
/**
 * Ara tutucular bu derinlikten sonra anlamlı — uzun kanalda palet dizisi
 * tek çıkış tutucusuyla kontrol edilemiyor.
 */
export const INTERMEDIATE_RETAINER_MIN_DEPTH = 15

// ── Varsayılan makara aralığı ─────────────────────────────────────────────

/** 75 mm'nin katı olmak zorunda; 75 mm en sık kullanılan (RESEARCHED). */
export const DEFAULT_ROLLER_PITCH_M = mm(75)

// ── Bileşen kesitleri — hepsi ASSUMPTION ya da RESEARCHED ─────────────────
//
// Katalog bileşenleri ADLARIYLA listeliyor (12 kalem) ama kesit ölçüsü
// yayınlamıyor. Aşağıdakiler görseldir ve hiçbir kapasite hesabına girmez;
// gerçek Mecalux profil ölçüleri geldiğinde tek dosyada değişirler.

/** Dikme kesiti (RESEARCHED — selective raf profiline yakın). */
export const UPRIGHT_WIDTH_M = mm(90)
export const UPRIGHT_DEPTH_M = mm(100)
/** Çerçeve çaprazı kalınlığı (ASSUMPTION). */
export const DIAGONAL_THICKNESS_M = mm(40)
/** Dinamik kiriş — kanalı taşıyan kiriş (ASSUMPTION). */
export const DYNAMIC_BEAM_HEIGHT_M = mm(120)
export const DYNAMIC_BEAM_THICKNESS_M = mm(50)
/** Dinamik profil — makara kanalının kendisi (ASSUMPTION). */
export const CHANNEL_PROFILE_WIDTH_M = mm(60)
export const CHANNEL_PROFILE_HEIGHT_M = mm(100)
/** Makara çapı (RESEARCHED — sektörde 50–76 mm; alt uç alındı). */
export const ROLLER_DIAMETER_M = mm(50)
/** Fren makarası makara hattının bu kadar üstünde durur (ASSUMPTION). */
export const BRAKE_ROLLER_RAISE_M = mm(8)
/** Fren tamburu / hız regülatörü — makaranın ucuna takılan gövde (ASSUMPTION). */
export const BRAKE_DRUM_DIAMETER_M = mm(40)
export const BRAKE_DRUM_WIDTH_M = mm(35)
/** Ortalama şeridi — palet kanala girerken ortalayan eğik parça (ASSUMPTION). */
export const CENTRALISING_STRIP_LENGTH_M = mm(400)
export const CENTRALISING_STRIP_HEIGHT_M = mm(80)
export const CENTRALISING_STRIP_THICKNESS_M = mm(20)
/** Şeridin akış eksenine göre açısı — palet ağzı daralarak ortalanır
 *  (ASSUMPTION; katalog sadece "centralising strip" adını veriyor). */
export const CENTRALISING_STRIP_ANGLE_RAD = Math.PI / 12
/** Çıkış kirişi ve tampon (ASSUMPTION). */
export const EXIT_BEAM_HEIGHT_M = mm(120)
export const EXIT_BEAM_BUMPER_M = mm(40)
/** Son durdurucu (ASSUMPTION). */
export const END_STOP_HEIGHT_M = mm(150)
/** Palet tutucu gövdesi ve ağırlıkla çalışan pedalı (ASSUMPTION). */
export const RETAINER_BODY_HEIGHT_M = mm(140)
export const RETAINER_BODY_THICKNESS_M = mm(45)
export const RETAINER_PEDAL_LENGTH_M = mm(180)
export const RETAINER_PEDAL_THICKNESS_M = mm(14)
/**
 * Bölünmüş makarada ortada bırakılan boşluk (ASSUMPTION).
 *
 * Sert mastlı araçlar (istif, turret, transtoker) çatalını kanalın ortasından
 * geçirir; makara bu yüzden ikiye bölünür. Boşluk çatal kalınlığından geniş
 * olmalı.
 */
export const SPLIT_ROLLER_GAP_M = mm(200)
/** Menteşeli kanalın zemin katındaki menteşe boğumu (ASSUMPTION). */
export const HINGE_KNUCKLE_M = mm(70)
/** Taban plakası kalınlığı (ASSUMPTION). */
export const LEVELLING_PLATE_THICKNESS_M = mm(6)
/** Taban plakasını zemine bağlayan ankraj cıvatası (ASSUMPTION). */
export const ANCHOR_BOLT_M = mm(24)
export const ANCHOR_BOLT_HEIGHT_M = mm(30)

// ── Renk anahtarları ──────────────────────────────────────────────────────
//
// İlk üçü projenin kendi anahtarları (selective raf ve konveyör ailesiyle
// aynı boya); son ikisi ASSUMPTION.

export const PALETTE = {
  /** RAL 5003 — selective rafın dikmesiyle aynı. */
  upright: '#22344d',
  /** RAL 2001 — selective rafın kirişiyle aynı. */
  beam: '#c94f00',
  /** Galvaniz makara — konveyör ailesinin `rollerZinc`'i. */
  roller: '#c9ced3',
  /** Fren makarası: koyu, akış donanımını sıradan makaradan ayırır
   *  (ASSUMPTION). */
  brake: '#6b7075',
  /** Tutucu ve son durdurucu — güvenlik kırmızısı, RAL 3001 (ASSUMPTION). */
  stop: '#a52019',
} as const

/** Panel bu metni kelimesi kelimesine gösterir. */
export const LIVE_RACKING_UNPUBLISHED_NOTE =
  'Profil kesitleri, makara çapı ve pozisyon başına yük Mecalux tarafından ' +
  'yayınlanmamış — sektör verisi ya da varsayımdır ve yalnız görseli sürer. ' +
  'Ölçü zinciri (E = A + 160, D = A + 30), eğim, aralık kuralları ve derinlik ' +
  'sınırı katalogdandır.'
