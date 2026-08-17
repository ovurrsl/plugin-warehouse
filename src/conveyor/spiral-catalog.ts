/**
 * Sarmal (spiral) konveyör katalog verisi — çap/bant kademeleri, yük sınıfı
 * hız sabitleri ve yayınlanmamışların açık notu.
 *
 * Kaynaklar: Ryson, FlexLink, EHS (uluslararası — hafif/karton sınıfı) ·
 * Konek Makine (Türkiye — ağır/palet sınıfı). Standart: EN 619:2022 (sürekli
 * taşıma, birim yük).
 *
 * Bu dosya `./constants`'ın yaptığını sarmal için yapıyor: neyin yayınlanmış
 * neyin SEÇİLMİŞ VARSAYILAN olduğunu adıyla ayırmak. Bir kademeyi değiştirmek
 * modelleme kararıdır; bir yazım hatası değil.
 */

/**
 * Dış çap kademeleri, mm STRING enum.
 *
 * **Palet tabanı 2.400 mm YAYINLANMIŞ** (spec §4: ağır/palet sınıfı min.
 * 2.400 mm). Hafif sınıfın küçük kademeleri (1.200 / 1.500 / 1.800) katalogda
 * tek tek yayınlanmıyor — yük boyutuna göre değişken deniyor — yani bunlar
 * SEÇİLMİŞ VARSAYILAN: makul bir görsel kademelendirme, ölçüm değil.
 */
export const SPIRAL_OUTER_DIAMETERS = ['1200', '1500', '1800', '2400'] as const
export type SpiralOuterDiameter = (typeof SPIRAL_OUTER_DIAMETERS)[number]

/**
 * Bant genişliği kademeleri, mm string — SEÇİLMİŞ VARSAYILAN.
 *
 * Kataloglar bant genişliğini yük boyutuna bağlıyor, sabit bir liste
 * yayınlamıyor. Kademeler karton/tote sınıfının olağan aralığından seçildi.
 * Bant çapa göre dar kalmalı (`R = (D − bant)/2 > 0`): geniş bir bant ancak
 * büyük çapta anlamlı ve parametrik bunun için uyarı veriyor.
 */
export const SPIRAL_BELT_WIDTHS = ['400', '500', '650', '800'] as const
export type SpiralBeltWidth = (typeof SPIRAL_BELT_WIDTHS)[number]

/**
 * Görselleştirme hızı, sınıf başına — m/s.
 *
 * Hafif: 0,5 m/s (yayınlanmış üst sınır ≤61 m/dak = 1,02 m/s bandının içinde,
 * SEÇİLMİŞ orta bir değer). Palet: 5 m/dak = 0,083 m/s — YAYINLANMIŞ
 * (spec §4: ağır/palet sınıfı ≤5 m/dak). Yalnız slat animasyonunu sürer;
 * hiçbir çevrim süresi ya da kapasite hesabına girmez.
 */
export const SPIRAL_BELT_SPEED_MS: Record<'light' | 'pallet', number> = {
  light: 0.5,
  pallet: 5 / 60,
}

/** Sınıf başına eğim üst sınırı, derece — YAYINLANMIŞ (spec §4). */
export const SPIRAL_MAX_INCLINE_DEG: Record<'light' | 'pallet', number> = {
  light: 12.5,
  pallet: 13,
}

/** Palet sınıfının yayınlanmış asgari dış çapı, mm (spec §4). */
export const SPIRAL_PALLET_MIN_DIAMETER_MM = 2400

/** Panel bu metni kelimesi kelimesine gösterir — sayı uydurulmaz. */
export const SPIRAL_UNPUBLISHED_NOTE =
  'Kapasite ve motor gücü kataloglarda yük boyutuna bağlı, sabit tablo yok. ' +
  'Slat animasyonu sınıfın hız sabitiyle çizilir (hafif 0,5 m/s; palet ' +
  '5 m/dak, yayınlanmış) — görselleştirmedir, ölçüm değildir.'
