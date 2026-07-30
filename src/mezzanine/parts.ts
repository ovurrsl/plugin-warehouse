/**
 * Mezzanine'in kutu-listesi parçaları — rack/telescopic'in `role+center+size`
 * deseni. Profil kesitleri `THREE.ExtrudeGeometry` ile ÇİZİLMİYOR (repo'da
 * hiçbir yapısal çelik parçası extrude edilmiyor — rack'ın C-kesit dikmesi
 * bile 3 kutudan kurulu); I-profil (IPE/HEA/Sigma-yaklaşık) burada gövde +
 * iki flanştan (3 kutu) kuruluyor, aynı ilke.
 */

import { FLOOR_TYPES, type IBeamProfile } from './catalog'
import {
  footprintDepthM,
  footprintWidthM,
  gridColumnPositions,
  resolveColumnProfile,
  resolveMainBeamProfile,
  resolveSecondaryBeamProfile,
  resolveTierElevations,
  SECONDARY_BEAM_SPACING_M,
} from './metrics'
import type { MezzanineNode } from './schema'

export type MezzaninePartRole = 'column' | 'main-beam' | 'secondary-beam' | 'floor'

export type MezzaninePart = {
  role: MezzaninePartRole
  center: readonly [number, number, number]
  size: readonly [number, number, number]
}

/**
 * Kolon: dikey ekstrüzyon, kesit X-Z düzleminde (h→X, b→Z). Yapının TAM
 * yüksekliği boyunca tek parça — gerçek mezzanine'de kolon tüm katları
 * kesintisiz geçer, kirişler ona braketle bağlanır.
 */
function pushColumn(
  parts: MezzaninePart[],
  gx: number,
  gz: number,
  heightM: number,
  profile: IBeamProfile,
): void {
  const { h, b, tw, tf } = profile
  parts.push({ role: 'column', center: [gx, heightM / 2, gz], size: [tw, heightM, h - 2 * tf] })
  for (const side of [-1, 1] as const) {
    parts.push({
      role: 'column',
      center: [gx, heightM / 2, gz + (side * (h - tf)) / 2],
      size: [b, heightM, tf],
    })
  }
}

/** Ana kiriş: X boyunca ekstrüzyon, kesit Y-Z düzleminde (h→Y, b→Z). Altı
 *  `y0` kotuna oturur (o tier'in tavan boşluğunun bittiği yer). */
function pushBeamAlongX(
  parts: MezzaninePart[],
  role: 'main-beam' | 'secondary-beam',
  x0: number,
  x1: number,
  z: number,
  y0: number,
  profile: IBeamProfile,
): void {
  const { h, b, tw, tf } = profile
  const length = x1 - x0
  const midX = (x0 + x1) / 2
  parts.push({ role, center: [midX, y0 + h / 2, z], size: [length, h - 2 * tf, tw] })
  for (const side of [-1, 1] as const) {
    parts.push({
      role,
      center: [midX, y0 + h / 2 + (side * (h - tf)) / 2, z],
      size: [length, tf, b],
    })
  }
}

/** İkincil kiriş: Z boyunca ekstrüzyon, ana kirişin ÜSTÜNE oturur. */
function pushBeamAlongZ(
  parts: MezzaninePart[],
  z0: number,
  z1: number,
  x: number,
  y0: number,
  profile: IBeamProfile,
): void {
  const { h, b, tw, tf } = profile
  const length = z1 - z0
  const midZ = (z0 + z1) / 2
  parts.push({
    role: 'secondary-beam',
    center: [x, y0 + h / 2, midZ],
    size: [tw, h - 2 * tf, length],
  })
  for (const side of [-1, 1] as const) {
    parts.push({
      role: 'secondary-beam',
      center: [x, y0 + h / 2 + (side * (h - tf)) / 2, midZ],
      size: [b, tf, length],
    })
  }
}

/**
 * Bir tier'in kiriş seti: ana kirişler (her Y ızgara hattı boyunca, X'e
 * ekstrüde), ikincil kirişler (X'te `SECONDARY_BEAM_SPACING_M` aralıklı, ana
 * kirişin üstünde Z'ye ekstrüde). `y0` o tier'in tavan boşluğunun bittiği
 * kot — kirişler bunun üstüne oturur.
 *
 * Kolonlar burada YOK: `mezzanineParts` onları bir kez, tam yükseklikte
 * ekler (gerçek mezzanine'de kolon her katı kesintisiz geçer).
 */
function pushTierBeams(parts: MezzaninePart[], node: MezzanineNode, y0: number): void {
  const { baysY, bayDepthM } = node.grid
  const halfWidth = footprintWidthM(node) / 2
  const halfDepth = footprintDepthM(node) / 2
  const mainProfile = resolveMainBeamProfile(node)
  const secondaryProfile = resolveSecondaryBeamProfile(node)

  for (let iz = 0; iz <= baysY; iz++) {
    const z = -halfDepth + iz * bayDepthM
    pushBeamAlongX(parts, 'main-beam', -halfWidth, halfWidth, z, y0, mainProfile)
  }

  const secondaryY0 = y0 + mainProfile.h
  const secondaryCount = Math.max(1, Math.round(footprintWidthM(node) / SECONDARY_BEAM_SPACING_M))
  for (let i = 0; i <= secondaryCount; i++) {
    const x = -halfWidth + (i / secondaryCount) * footprintWidthM(node)
    pushBeamAlongZ(parts, -halfDepth, halfDepth, x, secondaryY0, secondaryProfile)
  }
}

/**
 * Bütün mezzanine'in parça listesi — geometri havuzunun tükettiği tek yer.
 * Kolonlar TAM yükseklikte bir kez; her tier kendi kiriş+döşeme setini
 * ekler.
 */
export function mezzanineParts(node: MezzanineNode): MezzaninePart[] {
  const parts: MezzaninePart[] = []
  const resolved = resolveTierElevations(node.tiers)
  const last = resolved[resolved.length - 1]
  const totalHeight = last ? last.resolvedElevationM + last.clearHeightM : 0

  const columnProfile = resolveColumnProfile(node)
  for (const point of gridColumnPositions(node)) {
    pushColumn(parts, point.x, point.z, totalHeight, columnProfile)
    if (node.columnType === 'double') {
      // İkinci profil, birincinin hemen yanında (b kadar kaydırılmış Z'de).
      pushColumn(parts, point.x, point.z + columnProfile.b, totalHeight, columnProfile)
    }
  }

  for (const tier of resolved) {
    const y0 = tier.resolvedElevationM + tier.clearHeightM
    pushTierBeams(parts, node, y0)

    const floorType = FLOOR_TYPES[tier.floorType]
    parts.push({
      role: 'floor',
      center: [0, tier.resolvedElevationM - floorType.structuralDepthM / 2, 0],
      size: [footprintWidthM(node), floorType.structuralDepthM, footprintDepthM(node)],
    })
  }

  return parts
}
