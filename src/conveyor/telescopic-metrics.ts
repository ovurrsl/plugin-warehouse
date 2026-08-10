/**
 * Teleskopik konveyörün ölçü okumaları — katalogdan, tek yerden.
 *
 * Yerel çerçeve: origin SABİT KISMIN arka yüzünde değil, ORTASINDA durur
 * (ailenin modül konvansiyonu); ileri = +X, bom +X'e uzar. Sabit kısım A
 * `[-A/2, +A/2]`; kayan bölümler +X'e doğru `B × extension` kadar taşar.
 * Yani anlık toplam boy `A + B·e`, taban izi `[-A/2, A/2 + B·e]`.
 */

import {
  FRAME_OVER_BELT_M,
  TELESCOPIC_MODELS,
  type TelescopicModel,
  type TelescopicModelId,
} from './telescopic-catalog'
import type { ConveyorTelescopicNode } from './telescopic-schema'

/**
 * Kuyruk ucunun bant kotu — kullanıcının ayarı, yoksa modelin katalog kotu.
 *
 * Makinenin bütün yüksekliği buradan türüyor (gövde kirişi, bacaklar, bom
 * kademeleri, kolider, akış kutuları), yani tek okuma noktası olması şart:
 * bir yer `model.heightM`'de kalırsa kot değiştiğinde o parça yerinde durur
 * ve makine kendi içinde ayrışır.
 */
export function transportHeightM(node: ConveyorTelescopicNode): number {
  return node.transportHeight ?? telescopicModelOf(node.model).heightM
}

export function telescopicModelOf(id: TelescopicModelId): TelescopicModel {
  return TELESCOPIC_MODELS[id]
}

/** Bant genişliği, metre. */
export function beltWidthM(node: ConveyorTelescopicNode): number {
  return Number(node.beltWidth) / 1000
}

/** Gövde genişliği = bant + yan profiller (tek tahmin, katalogda notuyla). */
export function frameWidthM(node: ConveyorTelescopicNode): number {
  return beltWidthM(node) + FRAME_OVER_BELT_M
}

/** Anlık uzamış boy: A + B·e — plan, çarpışma ve kolider hep bunu okur. */
export function currentLengthM(node: ConveyorTelescopicNode): number {
  const model = telescopicModelOf(node.model)
  return model.fixedM + model.extensionM * node.extension
}

/** Bom ucunun yerel X'i: +A/2 + B·e. */
export function boomTipX(node: ConveyorTelescopicNode): number {
  const model = telescopicModelOf(node.model)
  return model.fixedM / 2 + model.extensionM * node.extension
}

/** Taban izinin merkezi kaydırması: iz `[-A/2, A/2 + B·e]` → merkez `B·e/2`. */
export function footprintCenterX(node: ConveyorTelescopicNode): number {
  const model = telescopicModelOf(node.model)
  return (model.extensionM * node.extension) / 2
}

export type BoomSection = {
  /** 1-tabanlı kayan bölüm sırası (0 sabit kısımdır, burada yer almaz). */
  index: number
  /** Bölümün kendi boyu — sabit kısmın içine sığmak zorunda. */
  lengthM: number
  /** Bölüm ÖN ucunun yerel X'i, verilen uzamada. */
  tipX: number
  /** Bölüm merkez X'i. */
  centerX: number
  /** Kademe küçülmesi: her bölüm bir öncekinin içinde kayar. */
  widthM: number
  /** Bant üstü kotundan aşağı ofset — iç bölüm bir kademe alçak koşar. */
  dropM: number
}

/** Kademe başına daralma/alçalma — görsel sabitler (iç içe geçme çizimi). */
const SECTION_SHRINK_M = 0.07
const SECTION_DROP_M = 0.045

/**
 * Kayan bölümlerin verilen uzamadaki yerleşimi.
 *
 * Her bölüm uzamanın eşit payını taşır (`B / (sections−1)`), ve her bölümün
 * kendi boyu bu pay + iç içe binme payıdır — tablonun kendisi bunu doğrular:
 * her modelde `B/(sections−1) ≤ A` (aksi hâlde bölüm sabit kısma sığmazdı)
 * ve test bunu kilitler.
 */
export function boomSections(node: ConveyorTelescopicNode): BoomSection[] {
  const model = telescopicModelOf(node.model)
  const moving = model.sections - 1
  if (moving <= 0) return []
  const stride = model.extensionM / moving
  const overlap = Math.min(0.35, model.fixedM * 0.08)
  const lengthM = Math.min(stride + overlap, model.fixedM - 0.1)
  const frame = frameWidthM(node)
  const sections: BoomSection[] = []
  for (let index = 1; index <= moving; index++) {
    const tipX = model.fixedM / 2 + stride * index * node.extension
    sections.push({
      index,
      lengthM,
      tipX,
      centerX: tipX - lengthM / 2,
      widthM: frame - SECTION_SHRINK_M * index,
      dropM: SECTION_DROP_M * index,
    })
  }
  return sections
}

// ── Burun çalışma lambası ────────────────────────────────────────────────────

/**
 * Lambanın gövdesi ve merceği TEK aritmetikten çıkar.
 *
 * İkisi iki dosyada yaşamak zorunda: gövde birleştirilmiş geometride
 * (`telescopic-parts.ts`, ailenin vertex-renkli tek materyali), mercek ise
 * yayıcı materyaliyle kendi mesh'inde (`telescopic-renderer.tsx`) — çünkü
 * makinenin tamamının çizildiği materyal yayıcı olsaydı bütün bom parlardı.
 *
 * Ayrı hesaplandıkları sürece ayrıştılar, ve ayrışmışlardı: gövde
 * `+widthM/2 − 0.08`'de, mercek `−widthM/2 − 0.055`'te. Yani parlayan yüzey
 * bomun ÖTEKİ yanında, boşlukta duruyordu. Hata sessizdi çünkü ekranda bir
 * şey yanıyor — yalnız lambanın olmadığı yerde.
 *
 * Bölüm YEREL çerçevesinde döner (renderer bölümü `centerX`'e taşır); X'ten
 * başka eksende öteleme olmadığı için Y ve Z doğrudan düğüm çerçevesindeki
 * değerleridir.
 */
export const LAMP_HOUSING_SIZE_M = [0.14, 0.12, 0.14] as const

/**
 * Mercek gövdenin ÖN yüzünü kaplar — ince eksen X, çünkü lamba +X'e, yani
 * dorsenin içine bakar. Eski hâli Z'de inceydi: yana bakan bir far.
 */
export const LAMP_LENS_SIZE_M = [0.02, 0.09, 0.11] as const

/** Gövdenin burun ucundan geri çekilmesi, bant üstünden yükselişi ve yan
 *  girintisi — SEÇİLMİŞ VARSAYILAN, katalog rakamı değil. */
const LAMP_SETBACK_M = 0.16
const LAMP_RISE_M = 0.58
const LAMP_SIDE_INSET_M = 0.08
/** Direğin gövdeye bağlandığı boy: gövde merkezinin bu kadar altında. */
export const LAMP_POST_DROP_M = 0.16
export const LAMP_POST_SIZE_M = [0.05, 0.3, 0.05] as const

export type NoseLamp = {
  /** Direk merkezi. */
  post: readonly [number, number, number]
  /** Gövde merkezi. */
  housing: readonly [number, number, number]
  /** Mercek merkezi — gövdenin +X yüzüne yapışık. */
  lens: readonly [number, number, number]
}

/**
 * Lambanın üç parçasının yeri.
 *
 * Uzamadan BAĞIMSIZ: okuduğu üç alan (`lengthM`, `widthM`, `dropM`) uzamayla
 * değişmiyor, dolayısıyla parça listesinin dinlenme pozundaki bölümüyle
 * renderer'ın anlık uzamış bölümü aynı sonucu veriyor. Test bunu kilitliyor —
 * çünkü ayrışırsa mercek uzama sürüklendikçe gövdeden kayar.
 */
/**
 * Işık hüzmesinin ölçüleri ve yönü — SEÇİLMİŞ VARSAYILAN, katalogda ışık
 * konisi yayımlanmıyor.
 *
 * Koni geometrisi three'de +Y ekseninde doğuyor; tepesi origin'e çekildikten
 * sonra gövdesi −Y'ye uzanıyor. `lampBeamRotationZ()` o −Y'yi ileri ve
 * aşağı çeviriyor. Burada durmasının sebebi: işareti ters yazmak hüzmeyi
 * makinenin İÇİNE ve yukarı gönderir, ve bu hiçbir hata vermez.
 */
export const LAMP_BEAM_LENGTH_M = 2.4
export const LAMP_BEAM_MOUTH_RADIUS_M = 0.55
export const LAMP_BEAM_TILT_RAD = (12 * Math.PI) / 180
export const LAMP_BEAM_APEX_ALPHA = 0.3

/** Hüzme mesh'inin Z dönüşü. */
export function lampBeamRotationZ(): number {
  return Math.PI / 2 - LAMP_BEAM_TILT_RAD
}

/** Dönüşten sonra hüzmenin gittiği yön — dinlenmedeki −Y'nin görüntüsü. */
export function lampBeamDirection(): readonly [number, number] {
  const theta = lampBeamRotationZ()
  return [Math.sin(theta), -Math.cos(theta)]
}

export function noseLamp(node: ConveyorTelescopicNode, nose: BoomSection): NoseLamp {
  const x = nose.lengthM / 2 - LAMP_SETBACK_M
  const y = transportHeightM(node) - nose.dropM + LAMP_RISE_M
  const z = nose.widthM / 2 - LAMP_SIDE_INSET_M
  return {
    post: [x, y - LAMP_POST_DROP_M, z],
    housing: [x, y, z],
    lens: [x + LAMP_HOUSING_SIZE_M[0] / 2 + LAMP_LENS_SIZE_M[0] / 2, y, z],
  }
}
