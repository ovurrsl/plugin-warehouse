/**
 * Palet asansörünün ölçü okumaları — SAHNEDEN BAĞIMSIZ olanlar.
 *
 * Yerel çerçeve (spec §6): origin platform ayak izinin merkezinde, en alt kat
 * kotunda (Y=0). Mast Y=0 → Y=`mastHeight`; platform X'te `platformWidth`,
 * Z'de `platformDepth`. İleri/kapı yüzü −X. Y-up.
 *
 * Kot bağımlı okumalar (kaç kat, seyahat, mast yüksekliği) burada DEĞİL —
 * onlar binaya bağlı ve `levels.ts`'te, host asansör desenini yansıtarak
 * türetiliyor. Bu dosya yalnız palet/kapasite/mast-sayısından çıkan ölçüleri
 * verir.
 */

import { specOf } from '../pallet/presets'
import {
  CLEARANCE_MARGIN_M,
  CONTROL_PANEL_BASE_M,
  CONTROL_PANEL_M,
  DRIVE_BOX_M,
  ENCLOSURE_MARGIN_M,
  MAST_GAP_M,
  MAST_SECTION_M,
  OVERTRAVEL_M,
  PLATFORM_THICKNESS_M,
  ROLLER_PITCH_M,
  SPEED_MPM,
  TOE_GUARD_T_M,
} from './catalog'
import type { PalletLiftNode } from './schema'

/** Platform genişliği (X) = palet boyu + 2 × açıklık payı, metre. */
export function platformWidthM(node: PalletLiftNode): number {
  return specOf(node.palletPreset).length + 2 * CLEARANCE_MARGIN_M
}

/** Platform derinliği (Z) = palet genişliği + 2 × açıklık payı, metre. */
export function platformDepthM(node: PalletLiftNode): number {
  return specOf(node.palletPreset).width + 2 * CLEARANCE_MARGIN_M
}

/** Platform döşeme kalınlığı, metre — kapasite/palet bağımsız. */
export function platformThicknessM(): number {
  return PLATFORM_THICKNESS_M
}

/** Mast kesiti (kare), metre — kapasite kademesinden (spec §2). */
export function mastSectionM(node: PalletLiftNode): number {
  return MAST_SECTION_M[node.capacityClass]
}

/** Mast sayısı — sayı olarak. */
export function mastCount(node: PalletLiftNode): number {
  return Number(node.mastCount)
}

/** Dikey hız, m/s — kapasite kademesinden (spec §4). */
export function speedMps(node: PalletLiftNode): number {
  return SPEED_MPM[node.capacityClass].mpm / 60
}

/**
 * Mast merkezlerinin `[x, z]` konumları, yerel çerçevede.
 *
 * Kolonlar platform ayak izinin X EKSENİNDE DIŞINDA duruyor (platform aralarına
 * girer, kapı −Z ön yüzü serbest kalır): `mx = platformWidth/2 + boşluk +
 * kesit/2`. İki mastlı düzende ikisi de merkez Z'de (±mx, 0); dört mastlı
 * düzende platform Z kenarlarına yakın (±mx, ±pz). Böylece mast kutuları her
 * Y'de platformun XZ AABB'siyle çakışmaz — çakışma testi bunu kilitliyor.
 */
export function mastPositionsXZ(node: PalletLiftNode): Array<readonly [number, number]> {
  const s = mastSectionM(node)
  const mx = platformWidthM(node) / 2 + MAST_GAP_M + s / 2
  if (mastCount(node) === 2) {
    return [
      [-mx, 0],
      [mx, 0],
    ]
  }
  const pz = platformDepthM(node) / 2 - s / 2
  return [
    [-mx, -pz],
    [mx, -pz],
    [-mx, pz],
    [mx, pz],
  ]
}

/** Mast zarfının X yarı-genişliği (en dış mast dış yüzü), metre. */
export function mastEnvelopeHalfXM(node: PalletLiftNode): number {
  const s = mastSectionM(node)
  return platformWidthM(node) / 2 + MAST_GAP_M + s
}

/** Kapı (ön) yüzünün yerel Z'si (−Z ön yüz), metre — negatif. */
export function doorFaceZ(node: PalletLiftNode): number {
  return -(platformDepthM(node) / 2 + MAST_GAP_M)
}

/** Kapı açıklığı genişliği (X), metre — spec §2: genişlik = platform_width. */
export function doorWidthM(node: PalletLiftNode): number {
  return platformWidthM(node)
}

/** Tahrik ünitesi kutusu ölçüsü, metre. */
export function driveBoxM(): readonly [number, number, number] {
  return DRIVE_BOX_M
}

/** Kontrol panosu kutusu ölçüsü, metre. */
export function controlPanelM(): readonly [number, number, number] {
  return CONTROL_PANEL_M
}

/** Muhafaza kutusunun X yarı-genişliği — mast zarfının dışında, metre. */
export function enclosureHalfXM(node: PalletLiftNode): number {
  return mastEnvelopeHalfXM(node) + ENCLOSURE_MARGIN_M
}

/** Muhafaza kutusunun Z yarı-derinliği — mast/kapı zarfının dışında, metre. */
export function enclosureHalfZM(node: PalletLiftNode): number {
  // Kapı yüzü (−Z) platform kenarından `MAST_GAP` ötede; iki yönü de sar.
  return platformDepthM(node) / 2 + MAST_GAP_M + ENCLOSURE_MARGIN_M
}

/** Muhafaza kutusu ölçüsü `[x, z]`, metre — mast zarfının DIŞINDA. */
export function enclosureXZ(node: PalletLiftNode): readonly [number, number] {
  return [2 * enclosureHalfXM(node), 2 * enclosureHalfZM(node)]
}

/**
 * Toplam ayak izi `[genişlikX, derinlikZ]`, metre — kolider ve host
 * `floorPlaced` zarfının okuduğu.
 *
 * Muhafaza zarfını sarıyor, artı kontrol panosu muhafazanın DIŞINA (+Z, operatör
 * kafesin dışında durur) monte olduğu için onu da: iz simetrik bir AABB, panosu
 * kapsamak için +Z'deki taşmayı iki yana da yansıtır.
 */
export function footprintM(node: PalletLiftNode): readonly [number, number] {
  const halfX = enclosureHalfXM(node)
  const panelBump = node.hasControlPanel ? controlPanelM()[2] : 0
  const halfZ = enclosureHalfZM(node) + panelBump
  return [2 * halfX, 2 * halfZ]
}

/** Kontrol panosunun merkezi `[x, y, z]`, metre — muhafazanın +Z dışında. */
export function controlPanelCenter(node: PalletLiftNode): readonly [number, number, number] {
  const [, height, depth] = controlPanelM()
  return [
    platformWidthM(node) / 4,
    CONTROL_PANEL_BASE_M + height / 2,
    enclosureHalfZM(node) + depth / 2,
  ]
}

/** Kaç rulo — platform derinliğine sığan sayı. */
export function rollerCount(node: PalletLiftNode): number {
  return Math.max(3, Math.floor(platformDepthM(node) / ROLLER_PITCH_M))
}

/** Kenar takozunun platform yüzeyinden içeriye çektiği Z, metre. */
export function toeGuardInsetM(): number {
  return TOE_GUARD_T_M
}

/**
 * Düğümden türetilen mast yüksekliği zarfı, metre — GERÇEK kotlar sahnede
 * (`levels.ts resolveLift`) çözülüyor, ama tanımın `floorPlaced.footprint`'i
 * sahne göremiyor. Yedek seyahat + aşırı seyahatle kararlı bir zarf verir;
 * renderer koliderı gerçek çözülmüş yüksekliği kullanır.
 */
export function fallbackEnvelopeHeightM(node: PalletLiftNode): number {
  return node.fallbackTravelM + OVERTRAVEL_M
}
