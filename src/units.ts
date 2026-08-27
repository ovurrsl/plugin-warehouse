'use client'

import {
  formatAreaLabel,
  formatLinearMeasurement,
  getAreaUnitLabel,
  getLinearUnitLabel,
  type LinearUnit,
  linearUnitToMeters,
  metersToLinearUnit,
  squareMetersToAreaUnit,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'

/**
 * Display → Units'in bu paketteki karşılığı.
 *
 * ## Neden gerekli
 *
 * Host'un birim anahtarı bir görüntüleme tercihi: sahne her zaman metre
 * saklıyor, paneller okurken çeviriyor (`packages/nodes/src/wall/panel.tsx`
 * `metersToLinearUnit` + `getLinearUnitLabel` ile). Bu paket çevirmiyordu —
 * Imperial'a geçen kullanıcı host duvarını feet, yanındaki rafı metre
 * okuyordu.
 *
 * ## Neden host'un yardımcılarına devrediliyor
 *
 * `catalog-panel.tsx` kendi `SQUARE_FEET_PER_SQUARE_METRE = 10.7639` sabitini
 * taşıyordu. Host aynı sayıyı `1 / 0.3048`ten türetiyor, yani ikisi altıncı
 * anlamlı basamakta ayrılıyordu: aynı ekranda, aynı slab için, host'un
 * yazdığından farklı bir alan. Sabiti kopyalamak yerine çeviriyi tek kaynaktan
 * çağırmak bu ayrışmayı imkânsız kılıyor.
 *
 * ## Neden bu import'lar SSR'ı bozmuyor — ölçüldü, varsayılmadı
 *
 * `src/index.ts` eager yükleniyor ve CLAUDE.md oradan erişilen hiçbir şeyin
 * modül kapsamında Three.js'e dokunmamasını istiyor. Bu modül o grafikte:
 * `index → rack/definition → rack/parametrics → units`.
 *
 * `@pascal-app/viewer` import'u YENİ bir yüzey açmıyor, ve gerekçe analoji
 * değil zincirin kendisi: `rack/parametrics` zaten `./auto-fields`'i import
 * ediyor, o da `@pascal-app/editor`'dan DEĞER alıyor (`SegmentedControl`),
 * ve editor'ün kendi barrel'ı (`@pascal-app/editor/src/index.tsx`)
 * `@pascal-app/viewer`'dan yeniden dışa aktarıyor. Yani viewer bu değişiklikten
 * ÖNCE de eager grafikteydi ve paket çalışıyor.
 *
 * Buna güvenen tek şey `useUnit`/`unitNow`. Saf biçimlendiriciler yalnız
 * `@pascal-app/editor`'ın ölçüm yardımcılarına dayanıyor, o yüzden saflık iddiası
 * olan modüller (`mezzanine/stairs.ts`) buradan yalnız onları alıp birimi
 * PARAMETRE olarak isteyebiliyor — mağazayı okumadan.
 */

export type { LinearUnit }

/** Varsayılan — birim okunamayan bir bağlamda sahnenin kendi birimi. */
export const DEFAULT_UNIT: LinearUnit = 'metric'

/**
 * React tarafı: paneller, alan bileşenleri, önizlemeler.
 *
 * İlkel değer döndüren tek seçici — zustand referansla karşılaştırdığı için
 * nesne döndüren bir seçici her mağaza yazışında aboneyi boşuna yeniden
 * render ederdi.
 */
export function useUnit(): LinearUnit {
  return useViewer((s) => s.unit)
}

/**
 * React DIŞI okuma — ve neden kaçınılmaz.
 *
 * Doğrulama mesajları `def.parametrics.invariants` içinden çıkıyor ve o
 * sözleşme `(n: N) => Issue[]`: düğümden başka hiçbir şey vermiyor, bağlam da
 * birim de yok. Kancayla okumak mümkün değil, o yüzden mağaza tekilinden
 * okunuyor. Paketin başka yerlerinde (`placement.ts`, araçlar) zaten kullanılan
 * desen.
 */
export function unitNow(): LinearUnit {
  return useViewer.getState().unit
}

/**
 * `def.floorplan` bağlamından birim.
 *
 * `ctx.viewState` tipte OPSİYONEL ve 3B geometri yolunda her zaman `undefined`
 * — bu yüzden varsayılanı yazmak bir savunma değil, sözleşmenin gereği.
 */
export function unitOf(viewState: { unit?: LinearUnit } | undefined): LinearUnit {
  return viewState?.unit ?? DEFAULT_UNIT
}

/**
 * Bir uzunluk, kullanıcının biriminde ve birimi yazılı.
 *
 * Ondalık feet, feet-inches değil: host'un KENDİ panelleri böyle yazıyor
 * (`wall/panel.tsx:191-196`). `formatLinearMeasurement` feet-inches üretiyor ve
 * ölçüm baloncukları için doğru; bir panel satırında host'un yanında durunca
 * iki farklı yazım olurdu.
 */
export function lengthLabel(metres: number, unit: LinearUnit, digits = 2): string {
  if (!Number.isFinite(metres)) return '––'
  return `${metersToLinearUnit(metres, unit).toFixed(digits)} ${getLinearUnitLabel(unit)}`
}

/** Birimsiz sayı — kendi birim etiketini ayrı yazan yerleşimler için. */
export function lengthValue(metres: number, unit: LinearUnit, digits = 2): string {
  if (!Number.isFinite(metres)) return '––'
  return metersToLinearUnit(metres, unit).toFixed(digits)
}

/** Uzunluk birimi etiketi tek başına. */
export function lengthUnit(unit: LinearUnit): string {
  return getLinearUnitLabel(unit)
}

/**
 * `<input type="number">` ÇİFTİ — ve neden ikisi birden yazılmak zorunda.
 *
 * `metresToField` sahnedeki metreyi alanın göstereceği sayıya, `fieldToMetres`
 * kullanıcının yazdığını geri metreye çeviriyor. Biri olmadan diğeri sessiz bir
 * VERİ hatası, sadece bir okuma hatası değil:
 *
 * - yalnız gösterim çevrilirse: Imperial kullanıcı 8.53 görür, 9 yazar, sahneye
 *   9 METRE girer ve alan bir sonraki render'da 29.5 gösterir;
 * - yalnız ayrıştırma çevrilirse: 2,6 m'lik dikme alanda 2.6 görünür, kullanıcı
 *   dokunmadan bırakır, ilk düzenlemede 0,79 m'ye düşer.
 *
 * İkisi de hata vermez. Bu yüzden tek bir yorumun altında, yan yana duruyorlar.
 *
 * Metrik yol her ikisinde de KİMLİK: metrik kullanıcı için davranış bitine
 * kadar eskisiyle aynı kalıyor. Imperial'da üç ondalık, çünkü alanların metrik
 * adımı 0,05 m = 0,164 ft — iki ondalık bunu gidiş-dönüşte kaydırırdı.
 */
export function metresToField(metres: number, unit: LinearUnit): number {
  // Aynı dosyanın BİÇİMLENDİRME fonksiyonlarının hepsi sonlu-sayı koruyor
  // ('––' gösteriyorlar); dönüşüm çifti korumuyordu. Fark önemli, çünkü bu
  // ikisinin çıktısı ekrana değil DÜĞÜM VERİSİNE gidiyor: NaN bir kez yazıldı
  // mı şema ayrıştırması sessizce düşer ve raf "ölçülemedi" sayılır.
  if (!Number.isFinite(metres)) return 0
  if (unit !== 'imperial') return metres
  return Number(metersToLinearUnit(metres, unit).toFixed(3))
}

/** `metresToField`'in tersi. Yorum için oraya bakın — ikisi bir çift. */
export function fieldToMetres(value: number, unit: LinearUnit): number {
  if (!Number.isFinite(value)) return 0
  return linearUnitToMeters(value, unit)
}

/**
 * Bir sayı alanının adımı.
 *
 * Imperial'da `'any'`, çünkü çevrilmiş bir değer metrik adımın katı olmuyor
 * (2,60 m → 8.53 ft, 0,05'in katı değil) ve tarayıcı alanı `:invalid`
 * işaretliyor: kullanıcıya doğru sayıyı yazdığı hâlde kırmızı bir alan.
 */
export function fieldStep(metricStep: number, unit: LinearUnit): number | 'any' {
  return unit === 'imperial' ? 'any' : metricStep
}

/**
 * MİLİMETRE ölçeğindeki bir uzunluk — ve neden ayrı bir fonksiyon.
 *
 * Bu paket iki ayrı ölçekte yazıyor: raf yüksekliği metre (`2.60 m`), oturma
 * payı milimetre (`75 mm`). İkisini tek fonksiyona indirmek metrik kullanıcıya
 * `0.075 m` yazdırmak demek — çeviri "doğru" ama okunaklılık kaybı bir
 * gerileme, çünkü bu sayılar sektörde milimetre konuşuluyor.
 *
 * Bu yüzden sabit olan BİRİM değil ÖLÇEK: metrikte mm, Imperial'da host'un
 * kendi feet-inches yazımı (`0'3"`). Imperial'da mm'de ısrar etmek, host'un
 * ölçüm baloncuğu inç yazarken panelin milimetre yazması olurdu.
 *
 * Alıntı bir figür için bu DEĞİL, `publishedMillimetres` kullanılır.
 */
export function millimetreLabel(metres: number, unit: LinearUnit): string {
  if (!Number.isFinite(metres)) return '––'
  if (unit === 'imperial') return formatLinearMeasurement(metres, unit)
  return `${(metres * 1000).toFixed(0)} mm`
}

/**
 * Bir alan.
 *
 * Host'un `formatAreaLabel`'ı sayı ile etiketi boşluksuz birleştiriyor
 * (`12.3m²`); bu paketin panelleri boşluklu yazıyor ve satırlar ona göre
 * hizalanmış. Sayı yine host'un çevirisinden geliyor — ayrışabilecek olan
 * çeviri, boşluk değil.
 */
export function areaLabel(squareMetres: number, unit: LinearUnit, digits = 1): string {
  if (!Number.isFinite(squareMetres)) return '––'
  return `${squareMetersToAreaUnit(squareMetres, unit).toFixed(digits)} ${getAreaUnitLabel(unit)}`
}

/** Birimsiz alan değeri — kendi birim etiketini ayrı yazan kolonlu yerleşimler için. */
export function areaValue(squareMetres: number, unit: LinearUnit, digits = 1): string {
  if (!Number.isFinite(squareMetres)) return '––'
  return squareMetersToAreaUnit(squareMetres, unit).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** Alan birimi etiketi tek başına (m², ft²). */
export function areaUnitLabel(unit: LinearUnit): string {
  return getAreaUnitLabel(unit)
}

/** Host'un kendi biçimi, boşluksuz — host bileşeninin yanına konan yerler için. */
export { formatAreaLabel }

/**
 * Yayınlanmış bir MİLİMETRE değeri — çevrilmez, ve bu bir eksiklik değil.
 *
 * Katalog ve standart alıntıları kaynağın birimindedir: EN ISO 14122-3 azami
 * rıhtı 220 mm diye yazar, Mecalux kataloğu her yanda 75 mm oturma ister.
 * Bunları inç'e çevirmek belgede olmayan bir kesinlik ve birim uydurmaktır —
 * paketin kendi kuralı da bu (`CLAUDE.md`: "Numbers need a source", ve bir
 * standardı analojiyle genişletmemek). Bu yüzden alıntı sayı olduğu gibi
 * kalır; kullanıcının KENDİ sahnesinden gelen sayı yanında çevrilir.
 *
 * Fonksiyon olarak var, çünkü çağrı yerinde "bu bilerek çevrilmedi" demenin
 * tek yolu bu — çıplak bir `${x} mm` ise unutulmuş olabilir.
 */
export function publishedMillimetres(millimetres: number, digits = 0): string {
  return `${millimetres.toFixed(digits)} mm`
}
