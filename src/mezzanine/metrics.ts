/**
 * Mezzanine'in saf ölçü fonksiyonları — three yok, React yok, store yazımı
 * yok (rack/telescopic'in `metrics.ts`/`slots.ts` deseni).
 */

import {
  CONSTRUCTIVE_SYSTEMS,
  FLOOR_TYPES,
  HEA_PROFILES,
  type IBeamProfile,
  IPE_PROFILES,
  SECONDARY_BEAM_SPACING_M,
  SIGMA_DEFAULT_HEIGHT_M,
  SIGMA_DEFAULT_WIDTH_M,
  SIGMA_PROFILE,
} from './catalog'
import type { MezzanineNode, MezzanineTier } from './schema'

export type ResolvedTier = MezzanineTier & { resolvedElevationM: number }

/**
 * Tier'lerin dikey konumu.
 *
 * `'auto'` → önceki tier'ların `(clearHeightM + floorType.structuralDepthM)`
 * toplamı, kümülatif (addendum §C formülü). Açık bir sayı verilmişse
 * doğrudan kullanılır — kasıtlı boşluk gibi kenar durumlar için.
 */
export function resolveTierElevations(tiers: readonly MezzanineTier[]): ResolvedTier[] {
  let cumulative = 0
  const resolved: ResolvedTier[] = []
  for (const tier of tiers) {
    const elevation = tier.elevationM === 'auto' ? cumulative : tier.elevationM
    resolved.push({ ...tier, resolvedElevationM: elevation })
    cumulative = elevation + tier.clearHeightM + FLOOR_TYPES[tier.floorType].structuralDepthM
  }
  return resolved
}

/** Yapının toplam yüksekliği: son tier'in kotu + kendi tavan boşluğu (üstünde
 *  başka bir tier yok, dolayısıyla o tier'in kendi döşemesi eklenmez). */
export function totalHeightM(node: MezzanineNode): number {
  const resolved = resolveTierElevations(node.tiers)
  const last = resolved[resolved.length - 1]
  return last ? last.resolvedElevationM + last.clearHeightM : 0
}

export type GridPoint = { x: number; z: number }

/**
 * Kolon ızgarası: `(baysX+1)×(baysY+1)` nokta, yerel çerçevede orijin
 * merkezde (rack'ın bayPitch'i gibi, ama iki eksende).
 */
export function gridColumnPositions(node: MezzanineNode): GridPoint[] {
  const { baysX, baysY, bayWidthM, bayDepthM } = node.grid
  const halfWidth = (baysX * bayWidthM) / 2
  const halfDepth = (baysY * bayDepthM) / 2
  const points: GridPoint[] = []
  for (let ix = 0; ix <= baysX; ix++) {
    const x = -halfWidth + ix * bayWidthM
    for (let iz = 0; iz <= baysY; iz++) {
      const z = -halfDepth + iz * bayDepthM
      points.push({ x, z })
    }
  }
  return points
}

/** Yerel taban izi genişlik/derinliği, metre. */
export function footprintWidthM(node: MezzanineNode): number {
  return node.grid.baysX * node.grid.bayWidthM
}
export function footprintDepthM(node: MezzanineNode): number {
  return node.grid.baysY * node.grid.bayDepthM
}

// ── Profil çözümü — kutu-listesi parçalarının boyut kaynağı ────────────────
//
// Sigma soğuk şekillendirilmiş, tek et kalınlıklı (tw=tf gerçekçi bir
// yaklaşıklık) — IPE/HEA sıcak haddelenmiş, gövde/flanş kalınlığı farklı.
// İkisi de aynı `IBeamProfile` şekline (h/b/tw/tf) çözülür; `parts.ts` tek
// bir kutu-emisyon fonksiyonu yazar, aile farkını görmez.

function sigmaAsIBeam(): IBeamProfile {
  const t = SIGMA_PROFILE.thicknessM
  return { h: SIGMA_DEFAULT_HEIGHT_M, b: SIGMA_DEFAULT_WIDTH_M, tw: t, tf: t }
}

/** `profileId` bir override'sa doğrudan tabloya bakar; `null` ise kurucu
 *  sistemin ailesine göre bir varsayılana düşer. Bilinmeyen bir override
 *  aynı şekilde varsayılana düşer — sessiz bir yazım hatası çökmemeli. */
function resolveIBeam(
  profileId: string | null,
  family: 'IPE' | 'HEA' | 'SIGMA',
  fallback: string,
): IBeamProfile {
  if (family === 'SIGMA') return sigmaAsIBeam()
  const table = family === 'IPE' ? IPE_PROFILES : HEA_PROFILES
  return table[profileId ?? fallback] ?? (table[fallback] as IBeamProfile)
}

export function resolveColumnProfile(node: MezzanineNode): IBeamProfile {
  const system = CONSTRUCTIVE_SYSTEMS[node.constructiveSystem]
  return resolveIBeam(node.columnProfile, system.columnFamily, 'HEA240')
}

export function resolveMainBeamProfile(node: MezzanineNode): IBeamProfile {
  const system = CONSTRUCTIVE_SYSTEMS[node.constructiveSystem]
  return resolveIBeam(node.mainBeamProfile, system.mainBeamFamily, 'IPE300')
}

export function resolveSecondaryBeamProfile(node: MezzanineNode): IBeamProfile {
  const system = CONSTRUCTIVE_SYSTEMS[node.constructiveSystem]
  return resolveIBeam(node.secondaryBeamProfile, system.secondaryBeamFamily, 'IPE160')
}

export { SECONDARY_BEAM_SPACING_M }
