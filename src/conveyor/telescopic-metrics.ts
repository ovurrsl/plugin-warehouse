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
