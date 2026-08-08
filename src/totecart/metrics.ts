/**
 * Toplama arabasının ölçü okumaları — katalogdan, tek yerden.
 *
 * Yerel çerçeve: origin taban izinin ortasında, zemin kotunda. İleri = +X
 * (ailenin konvansiyonu); operatör ARKADAN iter, yani kol −X ucunda.
 * Kasanın 600'lük kenarı +X boyunca, 400'lük kenarı Z'de — koridora bakan
 * yüz dar olan, bir toplama koridorunda istenen şey bu.
 */

import {
  BOTTOM_TIER_M,
  CART_CAPACITY_KG,
  CASTOR_INSET_M,
  CASTORS,
  type CastorSpec,
  DECK_LIP_M,
  DECK_PLATE_M,
  EN1757_MAX_CAPACITY_KG,
  FRAME_M,
  HANDLE_HEIGHT_M,
  HANDLE_TUBE_M,
  TILT_RAD,
  TOTE_CLEARANCE_M,
  TOTE_FAMILIES,
  TOTE_FIT_CLEAR_M,
  type ToteFamily,
  type ToteSize,
} from './catalog'
import type { ToteCartNode } from './schema'

export function familyOf(node: ToteCartNode): ToteFamily {
  return TOTE_FAMILIES[node.toteFootprint]
}

/**
 * Seçilen kasa yüksekliği — ailenin KENDİ merdivenine yaslanmış.
 *
 * Şema bütün ailelerin yüksekliklerini kabul ediyor (tek enum), çünkü iki
 * ayrı alan tutmak taban değişince ötekini sessizce geçersiz bırakırdı.
 * Bedeli burada ödeniyor: 400 × 300 seçili bir arabada `toteHeight: '420'`
 * AUER'in 600 × 400 merdiveninden gelir ve VDA ızgarasında yoktur — o
 * kasa var olmayan bir kasadır. En yakınına yaslamak, çizmemekten ve var
 * olmayanı çizmekten daha iyi; panel de ayrıca uyarıyor.
 */
export function toteSizeOf(node: ToteCartNode): ToteSize {
  const family = familyOf(node)
  const exact = family.heights.find((size) => size.height === node.toteHeight)
  if (exact) return exact
  const wanted = Number(node.toteHeight)
  let nearest = family.heights[0]
  if (!nearest) throw new Error(`${family.id}: yükseklik merdiveni boş`)
  for (const size of family.heights) {
    if (Math.abs(Number(size.height) - wanted) < Math.abs(Number(nearest.height) - wanted)) {
      nearest = size
    }
  }
  return nearest
}

/** Seçilen kasa yüksekliği ailenin merdiveninde GERÇEKTEN var mı. */
export function toteHeightIsExact(node: ToteCartNode): boolean {
  return familyOf(node).heights.some((size) => size.height === node.toteHeight)
}

export function castorOf(node: ToteCartNode): CastorSpec {
  return CASTORS[node.castorDiameter]
}

/** Kasanın dış ölçüleri, metre — `[boy, yükseklik, en]`. */
export function toteSizeM(node: ToteCartNode): readonly [number, number, number] {
  const family = familyOf(node)
  return [family.lengthM, toteSizeOf(node).heightM, family.widthM]
}

/** Araba taban izi: `[boy, en]`, metre. Tepsi artı çerçeve profili. */
export function footprintM(node: ToteCartNode): readonly [number, number] {
  const family = familyOf(node)
  const fit = 2 * TOTE_FIT_CLEAR_M
  return [family.lengthM + fit + 2 * FRAME_M, family.widthM + fit + 2 * FRAME_M]
}

export function cartLengthM(node: ToteCartNode): number {
  return footprintM(node)[0]
}

export function cartWidthM(node: ToteCartNode): number {
  return footprintM(node)[1]
}

/**
 * En alt tepsinin kotu.
 *
 * ROLLCART'ın yayımlanmış 170 mm'si taban, ama tekerlek onu ezebilir:
 * Ø160'lık bir tekerleğin yapı yüksekliği 195 mm ve 170 mm'lik bir tepsi
 * onun içinde kalırdı. Bu yüzden ikisinin BÜYÜĞÜ alınıyor — yayımlanmış
 * değeri korurken imkânsız bir arabayı da engelliyor.
 */
export function bottomTierYM(node: ToteCartNode): number {
  // Eğik tepsinin alçak kenarı kat hattının altına iniyor; en alt kat o
  // kadar yükselmezse tepsi şasenin içinden geçer.
  return Math.max(BOTTOM_TIER_M, castorOf(node).buildHeightM + FRAME_M) + tiltDipM(node)
}

/**
 * EĞİLMİŞ kasanın kapladığı DÜŞEY yer.
 *
 * Eğik bir kasa dik durandan yüksektir ve fark küçük değil: 220 mm'lik bir
 * Euro kasa 15°'de 316 mm yer kaplıyor, yani yarı yarıya fazla. Kutunun
 * X ekseni etrafında θ kadar döndürülmüş en yüksek köşesi
 * `H·cos θ + W·sin θ`.
 *
 * Bu düzeltme olmadan eğimli araba SESSİZCE bozuktu: kasanın uzak köşesi
 * bir üstteki tepsinin 14 mm içinden geçiyor, yakın köşesi de kendi
 * tepsisinin 52 mm ALTINA sarkıyordu. Ekranda hata yok, yalnız çeliğin
 * içinden geçen plastik.
 */
export function occupiedToteHeightM(node: ToteCartNode): number {
  const height = toteSizeOf(node).heightM
  const theta = tiltRad(node)
  if (theta === 0) return height
  return height * Math.cos(theta) + familyOf(node).widthM * Math.sin(theta)
}

/**
 * Eğik tepsinin alçak kenarının kat hattının ALTINA indiği miktar.
 *
 * Eğimli arabada TEPSİ eğiliyor, kasa değil — gerçek ürün de öyle çalışıyor
 * (506CT06 "1 fixed and 2 tilting tiers"): kasa eğik bir rafın üstünde
 * DURUYOR, havada asılı durmuyor. Tepsi kendi merkezi etrafında döndüğü
 * için alçak kenarı `(W/2)·sin θ` kadar iniyor, ve en alttaki kat bunu
 * şasenin üstünde tutmak için o kadar yükselmek zorunda.
 */
export function tiltDipM(node: ToteCartNode): number {
  const theta = tiltRad(node)
  if (theta === 0) return 0
  return (familyOf(node).widthM / 2) * Math.sin(theta)
}

/**
 * Kat aralığı — kasanın KAPLADIĞI yer artı serbest yükseklik artı tepsi sacı.
 *
 * TÜRETİLİYOR, saklanmıyor: saklansaydı kasa boyu değişince aralık yerinde
 * kalır ve kasalar bir üstteki tepsinin içinden geçerdi. Hiçbir hata
 * vermez, yalnız yanlış çizer.
 *
 * Kasa boyunu değil KAPLADIĞI yeri okuyor — eğim de bir kasa boyu değişimi,
 * ve ilk hâli tam olarak bunu kaçırdığı için eğimli araba bozuktu.
 */
export function tierPitchM(node: ToteCartNode): number {
  return occupiedToteHeightM(node) + TOTE_CLEARANCE_M + DECK_PLATE_M
}

/** n. tepsinin (0 tabanlı) üst yüzeyinin kotu. */
export function tierYM(node: ToteCartNode, index: number): number {
  return bottomTierYM(node) + index * tierPitchM(node)
}

/** En üstteki tepsinin kotu. */
export function topTierYM(node: ToteCartNode): number {
  return tierYM(node, Math.max(0, node.tiers - 1))
}

/**
 * Toplam yükseklik — arabanın en tepesi.
 *
 * En üstteki kasanın tepesi ile itme kolunun tepesinin BÜYÜĞÜ: alçak bir
 * arabada kol en yüksek nokta, yüksek bir arabada üst kasa. Zarfı yalnız
 * birine bağlamak ötekini çarpışma denetiminin dışında bırakırdı.
 */
export function overallHeightM(node: ToteCartNode): number {
  // KAPLADIĞI yer, dik boyu değil: eğimli bir arabanın üst kasası dik
  // durandan yüksek ve zarf onu görmezse araba tavana girer.
  const stack = topTierYM(node) + occupiedToteHeightM(node)
  // Kolun tepesi merkezinin yarım boru üstünde — zarf borunun ORTASINDA
  // biterse kol çarpışma denetiminin dışında kalır.
  return node.hasHandle ? Math.max(stack, HANDLE_HEIGHT_M + HANDLE_TUBE_M / 2) : stack
}

export function handleYM(): number {
  return HANDLE_HEIGHT_M
}

/** Gerçekten kasa taşıyan kat sayısı. Boş bırakılmışsa hepsi. */
export function loadedTiersOf(node: ToteCartNode): number {
  return Math.min(node.tiers, node.loadedTiers ?? node.tiers)
}

/**
 * Tepsi sacının ölçüsü, metre — `[boy, en]`.
 *
 * Kasadan her yandan `TOTE_FIT_CLEAR_M` kadar BÜYÜK: kasa tepsiye düşecek,
 * ve bordür kasanın dışında kalacak. Tam kasa ölçüsünde bir tepside bordür
 * plastiğin içinden geçiyordu.
 */
export function deckM(node: ToteCartNode): readonly [number, number] {
  const family = familyOf(node)
  return [family.lengthM + 2 * TOTE_FIT_CLEAR_M, family.widthM + 2 * TOTE_FIT_CLEAR_M]
}

export function deckLipM(): number {
  return DECK_LIP_M
}

export function tiltRad(node: ToteCartNode): number {
  return node.tilt ? TILT_RAD : 0
}

/** Tekerleğin yerel merkezi — dört köşe, içeri kaçık. */
export function castorCentres(node: ToteCartNode): readonly (readonly [number, number])[] {
  const [length, width] = footprintM(node)
  // Kaçıklık en az tekerlek YARIÇAPI: 70 mm'lik seçilmiş kaçıklık Ø160'ın
  // 80 mm'lik yarıçapından küçük ve tekerlek izin dışına 10 mm taşıyordu —
  // yani çarpışma kutusunun görmediği bir parça.
  const inset = Math.max(CASTOR_INSET_M, castorOf(node).diameterM / 2)
  const x = length / 2 - inset
  const z = width / 2 - inset
  return [
    [x, z],
    [x, -z],
    [-x, z],
    [-x, -z],
  ]
}

/**
 * Arabanın taşıyabileceği yük — tekerlekten mi, gövdeden mi sınırlı.
 *
 * Dört tekerleğin toplamı ile yayımlanmış araba kapasitesinin KÜÇÜĞÜ, çünkü
 * gerçek bir araba ikisinin küçüğüne göre etiketlenir.
 *
 * Bu paketin ölçüleriyle sınır HER ZAMAN gövde: en küçük tekerlek bile
 * 4 × 110 = 440 kg taşıyor, gövde 250. Yani `min` bugün hep 250 veriyor —
 * ve yine de `min` olarak duruyor, çünkü tekerlek tablosuna daha küçük bir
 * çap eklendiği gün doğru cevabı kendiliğinden verir. (Bu dokümanın ilk
 * hâli tam tersini yazıyordu: "sınır tekerlek". 440 > 250, yani değil.)
 */
export function capacityKg(node: ToteCartNode): number {
  return Math.min(CART_CAPACITY_KG, 4 * castorOf(node).capacityKg)
}

/** EN 1757'nin anma kapasitesi tavanını aşıyor mu — standardın kapsamı. */
export function exceedsEn1757(node: ToteCartNode): boolean {
  return capacityKg(node) > EN1757_MAX_CAPACITY_KG
}
