'use client'

import {
  formatAreaLabel,
  getAreaUnitLabel,
  getLinearUnitLabel,
  type LinearUnit,
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
 * ## Neden `@pascal-app/editor` import'u SSR'ı bozmuyor
 *
 * `src/index.ts` eager yükleniyor ve oradan erişilen her şeyin SSR-güvenli
 * olması gerekiyor. Bu modül o grafiğe giriyor (parametrics → auto-fields →
 * definition → index), ama YENİ bir yüzey açmıyor: `auto-fields.tsx` zaten
 * `@pascal-app/editor`'dan DEĞER import ediyor (`SegmentedControl`,
 * `SliderControl`), yani paket eager grafikte hâlihazırda var ve çalışıyor.
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
