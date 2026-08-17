/**
 * Palet asansörü parçaları — ÜÇ liste, üç birleştirilmiş buffer.
 *
 * **STATİK** (`palletLiftStaticParts`): mastlar (tam boy), tahrik kutusu, taban
 * çerçevesi, kontrol panosu ve — çözülmüş kotlarından — her durak için kapı
 * ÇERÇEVELERİ. Node çerçevesinde (origin platform ayak izinin merkezi, Y=0).
 *
 * **PLATFORM** (`palletLiftPlatformParts`): döşeme sacı + rulo konveyör
 * (silindir-yerine-kutu) + kenar takozları. DİNLENME çerçevesinde inşa edilir
 * (platform yüzeyi y=0, döşeme altında); dikey seyahat renderer'ın grup Y'si.
 *
 * **KAPI PANELİ** (`palletLiftDoorPanelParts`): TEK panel geometrisi, N mesh
 * olarak yeniden kullanılır (durak başına bir grup); açılma grubun Y'sinin
 * panel boyu kadar YUKARI kalkması.
 *
 * Merkez kolon/silindirler kutu olarak yaklaşıklanıyor — birleştirilmiş kutu
 * üreticisi yalnız kutu emitliyor (Three r128 CapsuleGeometry kısıtına da
 * uygun, spec §7).
 */

import {
  BASE_FRAME_H_M,
  DOOR_FRAME_M,
  DOOR_HEIGHT_M,
  DOOR_PANEL_DEPTH_M,
  DOOR_PANEL_INSET_M,
  PALETTE,
  ROLLER_DIAMETER_M,
  TOE_GUARD_H_M,
  TOE_GUARD_T_M,
} from './catalog'
import {
  controlPanelCenter,
  controlPanelM,
  doorFaceZ,
  doorWidthM,
  driveBoxM,
  mastPositionsXZ,
  mastSectionM,
  platformDepthM,
  platformThicknessM,
  platformWidthM,
  rollerCount,
} from './metrics'
import type { PalletLiftNode } from './schema'

export type PalletLiftDetail = 'full' | 'simple'

export type PalletLiftRole =
  | 'mast'
  | 'drive'
  | 'base'
  | 'control'
  | 'door-frame'
  | 'deck'
  | 'roller'
  | 'toe-guard'
  | 'door-panel'

export type PalletLiftPart = {
  role: PalletLiftRole
  center: readonly [number, number, number]
  size: readonly [number, number, number]
}

/**
 * Statik iskelet — mastlar, tahrik, taban, kontrol panosu, durak kapı
 * çerçeveleri. `stops` çözülmüş (yeniden tabanlanmış) kotların listesi;
 * `mastHeight` = seyahat + aşırı seyahat.
 */
export function palletLiftStaticParts(
  node: PalletLiftNode,
  detail: PalletLiftDetail,
  stops: ReadonlyArray<{ baseY: number }>,
  mastHeight: number,
): PalletLiftPart[] {
  const parts: PalletLiftPart[] = []
  const s = mastSectionM(node)
  const pd = platformDepthM(node)
  const [driveW, driveH, driveD] = driveBoxM()

  // Kılavuz mastlar — tam boy dikey kolonlar.
  for (const [x, z] of mastPositionsXZ(node)) {
    parts.push({ role: 'mast', center: [x, mastHeight / 2, z], size: [s, mastHeight, s] })
  }

  // Taban çerçevesi — mast hatları boyunca alçak kirişler (±X). Platformun XZ
  // dışında, çakışmaz.
  const baseX = platformWidthM(node) / 2 + mastSectionM(node) / 2
  for (const sx of [-1, 1] as const) {
    parts.push({
      role: 'base',
      center: [sx * baseX, BASE_FRAME_H_M / 2, 0],
      size: [s, BASE_FRAME_H_M, pd],
    })
  }

  // Tahrik ünitesi — mast tepesinde, ortada (mast yüksekliği içinde).
  parts.push({
    role: 'drive',
    center: [0, mastHeight - driveH / 2, 0],
    size: [driveW, driveH, driveD],
  })

  // Kontrol panosu — muhafazanın +Z DIŞINDA, operatör kafesin dışında durur.
  if (node.hasControlPanel) {
    parts.push({ role: 'control', center: controlPanelCenter(node), size: controlPanelM() })
    if (detail === 'full') {
      // Okuma ekranı standı gövdesi — yalnız yakın katman.
      const [cx, cy, cz] = controlPanelCenter(node)
      parts.push({
        role: 'control',
        center: [cx, cy + controlPanelM()[1] / 2 + 0.15, cz],
        size: [0.02, 0.3, 0.02],
      })
    }
  }

  // Durak kapı çerçeveleri — −Z ön yüzde, her çözülmüş kotta.
  if (node.hasDoors) {
    const faceZ = doorFaceZ(node)
    const width = doorWidthM(node)
    for (const stop of stops) {
      const base = stop.baseY
      // İki söve (dikey) + lento (üst).
      for (const sx of [-1, 1] as const) {
        parts.push({
          role: 'door-frame',
          center: [sx * (width / 2 + DOOR_FRAME_M / 2), base + DOOR_HEIGHT_M / 2, faceZ],
          size: [DOOR_FRAME_M, DOOR_HEIGHT_M, DOOR_FRAME_M],
        })
      }
      parts.push({
        role: 'door-frame',
        center: [0, base + DOOR_HEIGHT_M + DOOR_FRAME_M / 2, faceZ],
        size: [width + 2 * DOOR_FRAME_M, DOOR_FRAME_M, DOOR_FRAME_M],
      })
    }
  }

  return parts
}

/**
 * Platform — DİNLENME çerçevesinde (yüzey y=0, döşeme altında). Renderer grubu
 * `platformY` kadar kaldırır.
 */
export function palletLiftPlatformParts(
  node: PalletLiftNode,
  detail: PalletLiftDetail,
): PalletLiftPart[] {
  const pw = platformWidthM(node)
  const pd = platformDepthM(node)
  const t = platformThicknessM()
  const parts: PalletLiftPart[] = [{ role: 'deck', center: [0, -t / 2, 0], size: [pw, t, pd] }]

  // Rulo konveyör — X ekseni boyunca silindir (kutu yaklaşımı), Z boyunca
  // dizili. Döşeme üstünde (y = çap/2).
  const count = rollerCount(node)
  const rollerLen = pw - 2 * TOE_GUARD_T_M
  const usableZ = pd - 2 * TOE_GUARD_T_M
  for (let i = 0; i < count; i++) {
    const z = -usableZ / 2 + (usableZ * (i + 0.5)) / count
    parts.push({
      role: 'roller',
      center: [0, ROLLER_DIAMETER_M / 2, z],
      size: [rollerLen, ROLLER_DIAMETER_M, ROLLER_DIAMETER_M],
    })
  }

  // Kenar takozları — ±X yan raylar ve +Z arka; −Z ön (çıkış) açık.
  if (detail === 'full') {
    for (const sx of [-1, 1] as const) {
      parts.push({
        role: 'toe-guard',
        center: [sx * (pw / 2 - TOE_GUARD_T_M / 2), TOE_GUARD_H_M / 2, 0],
        size: [TOE_GUARD_T_M, TOE_GUARD_H_M, pd],
      })
    }
    parts.push({
      role: 'toe-guard',
      center: [0, TOE_GUARD_H_M / 2, pd / 2 - TOE_GUARD_T_M / 2],
      size: [pw, TOE_GUARD_H_M, TOE_GUARD_T_M],
    })
  }

  return parts
}

/**
 * Kapı paneli — TEK geometri, kendi origin'inde (taban y=0, gövde +Y'ye
 * uzanır). Renderer bunu durak başına bir grupta `[0, baseY, doorFaceZ]`'ye
 * koyar (kapalı) ve açılınca grubu panel boyu kadar yukarı kaydırır.
 */
export function palletLiftDoorPanelParts(node: PalletLiftNode): PalletLiftPart[] {
  const width = doorWidthM(node) - 2 * DOOR_PANEL_INSET_M
  return [
    {
      role: 'door-panel',
      center: [0, DOOR_HEIGHT_M / 2, 0],
      size: [width, DOOR_HEIGHT_M, DOOR_PANEL_DEPTH_M],
    },
  ]
}

/** Kapı panelinin açık konumdaki dikey kalkış yüksekliği, metre. */
export function doorPanelLiftM(): number {
  return DOOR_HEIGHT_M
}

export function colorOf(node: PalletLiftNode, role: PalletLiftRole): string {
  switch (role) {
    case 'mast':
    case 'drive':
      return node.mastColor
    case 'deck':
      return node.platformColor
    case 'door-frame':
    case 'door-panel':
      return node.doorColor
    case 'base':
      return PALETTE.base
    case 'control':
      return PALETTE.control
    case 'roller':
      return PALETTE.roller
    case 'toe-guard':
      return PALETTE.toeGuard
  }
}
