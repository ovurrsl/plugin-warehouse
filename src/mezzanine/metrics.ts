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
  RAILING_RULES,
  SECONDARY_BEAM_SPACING_M,
  SIGMA_DEFAULT_HEIGHT_M,
  SIGMA_DEFAULT_WIDTH_M,
  SIGMA_PROFILE,
} from './catalog'
import type { MezzanineNode, MezzanineTier } from './schema'

export type ResolvedTier = MezzanineTier & {
  /** Bu tier'in ALTINDAKİ zeminin kotu (tier 0 için 0). */
  resolvedElevationM: number
  /** Bu tier'in YÜRÜME yüzeyi: `elevation + clearHeight + döşeme kalınlığı`.
   *  Bir sonraki tier'in `elevation`'ı da tam olarak budur — zincir buradan
   *  kapanıyor. */
  deckTopM: number
}

/**
 * Tier'lerin dikey konumu.
 *
 * `'auto'` → önceki tier'ların `(clearHeightM + floorType.structuralDepthM)`
 * toplamı, kümülatif (addendum §C formülü). Açık bir sayı verilmişse
 * doğrudan kullanılır — kasıtlı boşluk gibi kenar durumlar için.
 *
 * **Formülün bilinen sadeleştirmesi:** yalnız DÖŞEME PANELİNİ sayıyor,
 * altındaki kirişleri değil. Gerçek kirişler (IPE300 = 0.30 m) 30–60 mm'lik
 * panel kalınlığına sığmaz ve döşemenin altına sarkar, yani fiili tavan
 * boşluğu `clearHeightM`'den küçüktür. Formül kullanıcının verdiği
 * spesifikasyondan geldiği için DEĞİŞTİRİLMEDİ; fark
 * `effectiveClearHeightM` ile ölçülüyor ve panel bir uyarı olarak söylüyor
 * — sessizce düzeltmek, kullanıcının yazdığı sayıyı yalana çevirirdi.
 */
export function resolveTierElevations(tiers: readonly MezzanineTier[]): ResolvedTier[] {
  let cumulative = 0
  const resolved: ResolvedTier[] = []
  for (const tier of tiers) {
    const elevation = tier.elevationM === 'auto' ? cumulative : tier.elevationM
    const deckTop = elevation + tier.clearHeightM + FLOOR_TYPES[tier.floorType].structuralDepthM
    resolved.push({ ...tier, resolvedElevationM: elevation, deckTopM: deckTop })
    cumulative = deckTop
  }
  return resolved
}

/**
 * Kirişler döşemenin altına sarktıktan sonra gerçekte kalan tavan boşluğu.
 *
 * `clearHeightM` yayınlanmış girdi, bu ise ÖLÇÜ — ikisi ayrı adlarla
 * duruyor, çünkü biri kullanıcının yazdığı, öteki yapının verdiği.
 */
export function effectiveClearHeightM(node: MezzanineNode, tier: MezzanineTier): number {
  const structure =
    resolveMainBeamProfile(node).h +
    resolveSecondaryBeamProfile(node).h +
    FLOOR_TYPES[tier.floorType].structuralDepthM
  return tier.clearHeightM + FLOOR_TYPES[tier.floorType].structuralDepthM - structure
}

/** Yapının toplam yüksekliği: en üst yürüme yüzeyi + korkuluk. Kolider ve
 *  taban izi bunu okur — korkuluksuz bir kutu, mezzanine'in üstünden geçen
 *  bir seçim ışınını kaçırırdı. */
export function totalHeightM(node: MezzanineNode): number {
  const resolved = resolveTierElevations(node.tiers)
  const last = resolved[resolved.length - 1]
  return last ? last.deckTopM + RAILING_RULES.handrailHeightM : 0
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
