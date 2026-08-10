/**
 * Yükleme rampasının ölçü okumaları — katalogdan, tek yerden.
 *
 * Yerel çerçeve: origin ÇUKUR İZİNİN ortasında, bitmiş zemin kotunda.
 * İleri = +X (dorsenin durduğu yön, ailenin konvansiyonu), genişlik Z'de.
 * Menteşe hattı arkada, `x = −L/2`. Makinenin tamamı `y ≤ 0`'da; dinlenmede
 * zeminin üstünde kalan tek şey tabla sacının kendisi.
 */

import {
  BUMPER_FACE_M,
  BUMPER_PROJECTION_M,
  BUMPER_SIDE_CLEAR_M,
  BUMPER_Y_M,
  CONTROL_BOX_M,
  CONTROL_HEIGHT_M,
  CONTROL_OFFSET_M,
  CONTROL_SETBACK_M,
  EN1398_MAX_GRADIENT,
  LIP_PLATE_M,
  PLATFORM_PLATE_M,
  TELESCOPIC_LIP_MAX_M,
  TELESCOPIC_LIP_MAX_SHORT_M,
  TELESCOPIC_SHORT_PLATFORM_M,
  WORKING_RANGE_BANDS,
} from './catalog'
import type { DockLevellerNode } from './schema'

/** Tabla genişliği, metre. */
export function widthM(node: DockLevellerNode): number {
  return Number(node.width) / 1000
}

/** Tabla boyu (dudak hariç), metre. */
export function platformLengthM(node: DockLevellerNode): number {
  return Number(node.length) / 1000
}

/** Çerçeve — yani çukur — derinliği, metre. */
export function frameHeightM(node: DockLevellerNode): number {
  return Number(node.frameHeight) / 1000
}

/** Dinamik kapasite, kN. Geometriye HİÇ girmiyor; panel ve MCP okuyor. */
export function capacityKN(node: DockLevellerNode): number {
  return Number(node.capacity)
}

/**
 * Teleskopik dudağın azami uzanımı — kısa tablada daha az.
 *
 * KAYNAK: Stertil X serisi. Kısa tablanın dudağı çekili hâlde saklayacak
 * cebi yok, o yüzden sınır makinenin kendi ölçüsünden geliyor, bir tercihten
 * değil.
 */
export function telescopicLipMaxM(node: DockLevellerNode): number {
  return platformLengthM(node) <= TELESCOPIC_SHORT_PLATFORM_M
    ? TELESCOPIC_LIP_MAX_SHORT_M
    : TELESCOPIC_LIP_MAX_M
}

/** Dudağın TAM boyu — teleskopikte cebin içindeki kısım dahil. */
export function lipFullLengthM(node: DockLevellerNode): number {
  return node.lip === 'telescopic' ? telescopicLipMaxM(node) : Number(node.lipLength) / 1000
}

/**
 * Rampa DİNLENMEDE mi — tabla bitmiş zeminle aynı kotta, üstünden geçilir.
 *
 * Tek eşik: eğim tam sıfır. "Neredeyse sıfır" diye bir dinlenme konumu yok;
 * makine ya yuvasına oturmuştur ya da yükün altındadır.
 */
export function isStored(node: DockLevellerNode): boolean {
  return node.inclination === 0
}

/**
 * Dudağın ETKİN uzanım oranı.
 *
 * Dinlenmede sıfır, kullanıcı kaydırıcıyı nereye çekmiş olursa olsun:
 * EN 1398 dinlenme konumunda dudağın emniyete alınmasını istiyor ve dışarı
 * uzanmış bir dudakla "kapalı" duran rampa var olmayan bir makine. Menteşeli
 * dudakta oran her zaman 1 — o dudak kayarak değil katlanarak çalışıyor.
 */
export function lipExtensionOf(node: DockLevellerNode): number {
  if (isStored(node)) return 0
  return node.lip === 'telescopic' ? node.lipExtension : 1
}

/** Dudağın tabla burnundan İLERİ uzanan kısmı, metre. */
export function lipReachM(node: DockLevellerNode): number {
  return lipFullLengthM(node) * lipExtensionOf(node)
}

/**
 * Menteşeli dudağın tablaya göre açısı, radyan.
 *
 * Dinlenmede −90°: dudak yuvasına dik olarak asılır ve çukurun içinde kalır,
 * yani zemin üstünde görünmez. Açıkken tablayla aynı düzlemde — dorsenin
 * zeminine yatan yüzey bu.
 */
export function hingedLipAngleRad(node: DockLevellerNode): number {
  return isStored(node) ? -Math.PI / 2 : 0
}

/** Bir bandın içinde doğrusal ara değer — bandın dışında uçlara kelepçeli. */
function lerpBand(value: number, from: number, to: number, low: number, high: number): number {
  if (to <= from) return low
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return low + (high - low) * t
}

type Range = { aboveM: number; belowM: number }

/**
 * Yayımlanmış çalışma aralığı — tabla boyuna göre.
 *
 * Stertil tabloyu iki BANT olarak veriyor; banttaki ara boyların değeri
 * yayımlanmıyor ve buradaki ara değer BENİM. Bantların arasına düşen boylar
 * (3000–3500 mm) için de aynısı: iki bandın uçları arasında geçiş yapılıyor,
 * çünkü aradaki boşluk tablonun bir ifadesi değil, sadece yayımlanmamış bir
 * satır.
 */
export function workingRangeM(node: DockLevellerNode): Range {
  const length = platformLengthM(node)
  const [low, high] = WORKING_RANGE_BANDS
  if (!low || !high) return { aboveM: 0, belowM: 0 }

  if (length <= low.toM) {
    return {
      aboveM: lerpBand(length, low.fromM, low.toM, low.aboveFromM, low.aboveToM),
      belowM: lerpBand(length, low.fromM, low.toM, low.belowFromM, low.belowToM),
    }
  }
  if (length >= high.fromM) {
    return {
      aboveM: lerpBand(length, high.fromM, high.toM, high.aboveFromM, high.aboveToM),
      belowM: lerpBand(length, high.fromM, high.toM, high.belowFromM, high.belowToM),
    }
  }
  // İki bandın arası — üst bandın başına doğru geçiş.
  return {
    aboveM: lerpBand(length, low.toM, high.fromM, low.aboveToM, high.aboveFromM),
    belowM: lerpBand(length, low.toM, high.fromM, low.belowToM, high.belowFromM),
  }
}

/**
 * Tabla burnunun zemin kotundan sapması, metre. Pozitif yukarı.
 *
 * Aralık simetrik DEĞİL: bir rampa yukarı, aşağı olduğundan farklı çıkar ve
 * `inclination`'ı tek bir metreye çevirmek bu asimetriyi silerdi.
 */
export function riseM(node: DockLevellerNode): number {
  const range = workingRangeM(node)
  return node.inclination >= 0 ? node.inclination * range.aboveM : node.inclination * range.belowM
}

/**
 * Tablanın menteşe etrafındaki açısı, radyan.
 *
 * `asin`, `atan` değil: tabla RİJİT ve menteşede dönüyor, yani burnu
 * kalktıkça yatay erişimi kısalıyor. `atan` tablayı uzatırdı.
 */
export function deckAngleRad(node: DockLevellerNode): number {
  const length = platformLengthM(node)
  if (length <= 0) return 0
  return Math.asin(Math.min(1, Math.max(-1, riseM(node) / length)))
}

/**
 * Yükün gerçekten tırmandığı eğim — tabla ARTI dudak üstünden.
 *
 * EN 1398'in %12,5 sınırı bu orana bakıyor: dorsenin zeminine ulaşan rampa
 * tablada bitmiyor, dudak da o rampanın parçası. Yalnız tabla boyuna bakan
 * bir hesap kısa tablalarda makineyi sınırın üstünde gösterirdi.
 */
export function gradient(node: DockLevellerNode): number {
  const run = platformLengthM(node) + lipReachM(node)
  if (run <= 0) return 0
  return Math.abs(riseM(node)) / run
}

export function exceedsEn1398(node: DockLevellerNode): boolean {
  return gradient(node) > EN1398_MAX_GRADIENT
}

/**
 * Çukur izi: `[boy, genişlik]`, metre.
 *
 * Dudak İZE GİRMİYOR ve bu bilinçli: açık dudak binanın dışında, dorsenin
 * üstünde duruyor. İze katmak rampayı kapının dışındaki her şeyle
 * çarpıştırırdı — ve orada zaten bir tır var.
 */
export function footprintM(node: DockLevellerNode): readonly [number, number] {
  return [platformLengthM(node), widthM(node)]
}

/**
 * Zeminin ÜSTÜNDE kalan yükseklik — çarpışma zarfı bu.
 *
 * Dinlenmede tabla sacının kalınlığı kadar; kalkınca burnun yüksekliği
 * kadar. Zemin ALTINA inen hâl sıfır sayılıyor: aşağı inen bir rampa
 * kimsenin yoluna çıkmıyor, ve negatif bir zarf yüksekliği host'un
 * `canPlaceOnFloor`'unu anlamsız kılardı.
 */
export function aboveFloorHeightM(node: DockLevellerNode): number {
  return Math.max(PLATFORM_PLATE_M, riseM(node) + PLATFORM_PLATE_M)
}

/**
 * SEÇİM kutusu — zeminin üstünde duran her şeyi saran kutu, `{merkez, ölçü}`.
 *
 * ## Neden çarpışma zarfından ayrı
 *
 * Yerleştirme zarfı (`footprintM` × `aboveFloorHeightM`) bilerek İNCE: rampanın
 * üstünden geçmek onun işi ve zarfı 1,3 m yapmak forklift rotasını, paleti,
 * konveyör ayağını rampanın üstünde çakışık sayardı.
 *
 * Ama seçim aynı kutuyu okuyunca başka bir şey oluyor: tampon kapı yüzünün
 * 100 mm önünde, kumanda direği tablanın 350 mm yanında ve 1,2 m yukarıda —
 * ikisi de o ince kutunun tamamen DIŞINDA. Ekranda duruyorlar, tıklama
 * içlerinden geçip arkadaki duvarı seçiyor. Sessiz: parça doğru çiziliyor,
 * yalnız var olmadığı söyleniyor.
 *
 * Tek bir AABB "zeminle aynı kotta tabla + yanda 1,2 m'lik direk" diyemiyor,
 * o yüzden ikisi ayrı: çarpışma sürüş kotunu, seçim çizilen gövdeyi anlatıyor.
 *
 * Dudak İKİSİNE DE girmiyor. Açık dudak dorsenin üstünde duruyor ve `bbox`
 * seçimi orada tırın kendi tıklamalarını çalardı — izden dışlanmasıyla aynı
 * gerekçe.
 */
export function selectionBoxM(node: DockLevellerNode): {
  center: readonly [number, number, number]
  size: readonly [number, number, number]
} {
  const length = platformLengthM(node)
  const width = widthM(node)

  let xMax = length / 2
  let zMax = width / 2
  // Tampon ÇİFT: kapı yüzünün iki yanında da bir tane var. `zMin`'i sabit
  // −W/2'de bırakmak −Z tamponunu kutunun dışında bırakırdı — hem de tam
  // olarak +Z'dekini içeri alan düzeltmenin yanında, yani yarısı görünmez.
  let zMin = -width / 2
  let yMax = aboveFloorHeightM(node)
  // Zeminin ALTI da kutuya girebiliyor: tampon rıhtım yüzüne monte ve zemin
  // hizasından aşağı sarkıyor — çukur astarı gibi gömülü değil, dışarıdan
  // görünen bir gövde. Görünen ama tıklanamayan parça bırakmamak bu kutunun
  // varlık sebebi.
  let yMin = 0

  if (node.hasBumpers) {
    xMax = Math.max(xMax, length / 2 + BUMPER_PROJECTION_M)
    zMax = Math.max(zMax, width / 2 + BUMPER_SIDE_CLEAR_M + BUMPER_FACE_M[1])
    zMin = Math.min(zMin, -(width / 2 + BUMPER_SIDE_CLEAR_M + BUMPER_FACE_M[1]))
    yMin = Math.min(yMin, BUMPER_Y_M - BUMPER_FACE_M[0] / 2)
  }
  if (node.hasControlPost) {
    // Direk yalnız +Z yanında: kutu bu yüzden simetrik değil ve merkezi de
    // origin'de değil.
    zMax = Math.max(zMax, width / 2 + CONTROL_OFFSET_M + CONTROL_BOX_M[2] / 2)
    yMax = Math.max(yMax, CONTROL_HEIGHT_M + CONTROL_BOX_M[1] / 2)
  }

  const xMin = -length / 2
  return {
    center: [(xMin + xMax) / 2, (yMin + yMax) / 2, (zMin + zMax) / 2],
    size: [xMax - xMin, yMax - yMin, zMax - zMin],
  }
}

/**
 * Kumanda direğinin yeri, `[x, z]` — 3B ve plan sembolünün TEK kaynağı.
 *
 * İki hesap sessizce ayrışmıştı: plan `halfLength - BUMPER_Y_M` yazıyordu,
 * yani tamponun zeminden KOTUNU bir X geri çekmesi olarak kullanıyordu.
 * Varsayılan düğümde 260 mm kayma, ve bağ yanlış yerdeydi — tamponun
 * yüksekliğini değiştiren biri planda direği yürütüyor, direği taşıyan biri
 * planı kımıldatmıyordu.
 */
export function controlPostXZ(node: DockLevellerNode): readonly [number, number] {
  return [platformLengthM(node) / 2 - CONTROL_SETBACK_M, widthM(node) / 2 + CONTROL_OFFSET_M]
}

/** Kapı yüzünün yerel X'i — tampon oraya oturuyor. */
export function dockFaceX(node: DockLevellerNode): number {
  return platformLengthM(node) / 2
}

/** Tamponun ileri çıkıntısı, metre. KAYNAK: çalışma aralığı tablosunun tamponu. */
export function bumperProjectionM(): number {
  return BUMPER_PROJECTION_M
}

/** Dudak sacı kalınlığı, metre. KAYNAK: Loading Systems. */
export function lipPlateM(): number {
  return LIP_PLATE_M
}
