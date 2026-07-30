/**
 * Teleskopik bant konveyör kataloğu — kullanıcının ilettiği üretici tablosu.
 *
 * Kaynak: SZ-Apollo teleskopik bant konveyör model tablosu (A3–A6 serisi,
 * "Fixed Type"; kullanıcı tarafından 2026-07-29'da iletildi — üretici sayfası
 * doğrulama sırasında erişilemezdi, tablo tek yayınlanmış kaynaktır).
 *
 * Kullanıcının netleştirdiği anlamlar: **A sabit kısımdır** (makinenin
 * gövdesi — kapalı hâlde görünen boy da budur), **B kapanan/uzayan
 * teleskopik kısımdır**, **C tam açık toplamdır**. Tablonun kendi ölçü
 * zinciri her satırda kapanıyor ve test bunu kilitler: **C = A + B**.
 * Ayrıca yükseklik bölüm
 * sayısının fonksiyonudur (3→800, 4→900, 5→950, 6→1050) — iç içe geçen her
 * bölüm bir kademe kalınlığı ekler; bu tutarlılık da testte.
 *
 * Tabloda OLMAYANLAR (bant hızı, kapasite, motor gücü, gövde/bant genişliği
 * ilişkisi) katalog satırına YAZILMAZ — görselin ihtiyacı olan tek tahmin
 * (`FRAME_OVER_BELT_M`) adıyla ve notuyla aşağıda durur.
 */

const mm = (value: number): number => value / 1000

export const TELESCOPIC_MODEL_IDS = [
  'a3-6+8',
  'a3-7+9.5',
  'a4-5+10',
  'a4-6+12',
  'a4-7+14',
  'a4-8+16',
  'a5-6+15',
  'a5-7+18',
  'a6-4.5+13',
  'a6-5+16',
] as const

export type TelescopicModelId = (typeof TELESCOPIC_MODEL_IDS)[number]

export type TelescopicModel = {
  id: TelescopicModelId
  /** Atıf — üreticinin model kodu. */
  label: string
  /** Bölüm sayısı: 1 sabit taban + (sections − 1) kayan bom. */
  sections: number
  /** Tam açık toplam boy C, metre. */
  totalM: number
  /** Sabit kısım A, metre — gövdenin kendisi; kapalı hâlde taban izinin
   *  sahibi (B tamamen bunun içine kapanır). */
  fixedM: number
  /** Uzama B, metre. */
  extensionM: number
  /** Bant üstü kotu, metre — "Fixed Type": ayarlanmaz, modelindir. */
  heightM: number
}

export const TELESCOPIC_MODELS: Record<TelescopicModelId, TelescopicModel> = {
  'a3-6+8': {
    id: 'a3-6+8',
    label: 'A3-6+8',
    sections: 3,
    totalM: mm(14000),
    fixedM: mm(6000),
    extensionM: mm(8000),
    heightM: mm(800),
  },
  'a3-7+9.5': {
    id: 'a3-7+9.5',
    label: 'A3-7+9.5',
    sections: 3,
    totalM: mm(16500),
    fixedM: mm(7000),
    extensionM: mm(9500),
    heightM: mm(800),
  },
  'a4-5+10': {
    id: 'a4-5+10',
    label: 'A4-5+10',
    sections: 4,
    totalM: mm(15000),
    fixedM: mm(5000),
    extensionM: mm(10000),
    heightM: mm(900),
  },
  'a4-6+12': {
    id: 'a4-6+12',
    label: 'A4-6+12',
    sections: 4,
    totalM: mm(18000),
    fixedM: mm(6000),
    extensionM: mm(12000),
    heightM: mm(900),
  },
  'a4-7+14': {
    id: 'a4-7+14',
    label: 'A4-7+14',
    sections: 4,
    totalM: mm(21000),
    fixedM: mm(7000),
    extensionM: mm(14000),
    heightM: mm(900),
  },
  'a4-8+16': {
    id: 'a4-8+16',
    label: 'A4-8+16',
    sections: 4,
    totalM: mm(24000),
    fixedM: mm(8000),
    extensionM: mm(16000),
    heightM: mm(900),
  },
  'a5-6+15': {
    id: 'a5-6+15',
    label: 'A5-6+15',
    sections: 5,
    totalM: mm(21000),
    fixedM: mm(6000),
    extensionM: mm(15000),
    heightM: mm(950),
  },
  'a5-7+18': {
    id: 'a5-7+18',
    label: 'A5-7+18',
    sections: 5,
    totalM: mm(25000),
    fixedM: mm(7000),
    extensionM: mm(18000),
    heightM: mm(950),
  },
  'a6-4.5+13': {
    id: 'a6-4.5+13',
    label: 'A6-4.5+13',
    sections: 6,
    totalM: mm(17500),
    fixedM: mm(4500),
    extensionM: mm(13000),
    heightM: mm(1050),
  },
  'a6-5+16': {
    id: 'a6-5+16',
    label: 'A6-5+16',
    sections: 6,
    totalM: mm(21000),
    fixedM: mm(5000),
    extensionM: mm(16000),
    heightM: mm(1050),
  },
}

/** Üç bant genişliği — her modelde aynı üçlü (tablonun tek ortak sütunu). */
export const TELESCOPIC_BELT_WIDTHS = ['600', '800', '1000'] as const
export type TelescopicBeltWidth = (typeof TELESCOPIC_BELT_WIDTHS)[number]

/**
 * Gövdenin bant üzerine payı (yan profiller + korkuluk tabanı) — TAHMİN:
 * tabloda gövde genişliği yayınlanmamış, referans görselden ölçekle okundu.
 * Yalnız görsele ve taban izine girer; hiçbir kapasite hesabına girmez.
 */
export const FRAME_OVER_BELT_M = 0.24

/**
 * Görselleştirme hızı — TAHMİN (sektör tipiği 0.3–0.5 m/s bandının ortası).
 *
 * Kullanıcı kararı: kutu animasyonu bu makinede de çalışır. Tabloda hız
 * yayınlanmadığı için bu sayı yalnız GÖRSELLEŞTİRMEYİ sürer; hiçbir çevrim
 * süresi, kapasite ya da rapor hesabına girmez ve panel notu bunu söyler.
 */
export const TELESCOPIC_BELT_SPEED_EST_MS = 0.4

/** Panel bu metni kelimesi kelimesine gösterir — sayı uydurulmaz. */
export const TELESCOPIC_UNPUBLISHED_NOTE =
  'Bant hızı, kapasite ve motor gücü üreticinin bu tablosunda yayınlanmamış. ' +
  'Kutu animasyonu 0.4 m/s TAHMİNİYLE çizilir — görselleştirmedir, ölçüm değildir.'
