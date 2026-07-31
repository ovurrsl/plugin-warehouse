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
  /**
   * GL2000 ikincil kirişi ana kirişe GÖMER (katalogun `secondaryBeamEmbedded`
   * verisi): iki kiriş aynı derinliği paylaşır, yapı yalnız derin olanı
   * kadar sarkar. Yan yana istifleyen sistemlerde ikisi toplanır. Bu alan
   * denetimde "tüketicisiz katalog verisi" çıkmıştı — gerçek etkisi tam
   * olarak bu satır ve `pushTierBeams`teki kot.
   */
  const main = resolveMainBeamProfile(node)
  const secondary = resolveSecondaryBeamProfile(node)
  const beams = CONSTRUCTIVE_SYSTEMS[node.constructiveSystem].secondaryBeamEmbedded
    ? Math.max(main.h, secondary.h)
    : main.h + secondary.h
  return tier.clearHeightM - beams
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

  if (!hasCustomOutline(node)) {
    const points: GridPoint[] = []
    for (let ix = 0; ix <= baysX; ix++) {
      const x = -halfWidth + ix * bayWidthM
      for (let iz = 0; iz <= baysY; iz++) {
        points.push({ x, z: -halfDepth + iz * bayDepthM })
      }
    }
    return points
  }

  /**
   * Özel şekilde ızgara poligonun SINIR KUTUSUNU tarıyor, `grid`in kendi
   * dikdörtgenini değil: `grid` artık sınırı değil ADIMI tanımlıyor.
   * Kullanıcı ızgara dikdörtgeninden büyük bir şekil çizerse kolonsuz
   * kalmasın diye.
   *
   * Aks orijine sabitli — poligon değişince kolonlar yerinden oynamasın.
   */
  const outline = outlinePolygon(node)
  const xs = outline.map(([x]) => x)
  const zs = outline.map(([, z]) => z)
  const startIx = Math.floor(Math.min(...xs) / bayWidthM)
  const endIx = Math.ceil(Math.max(...xs) / bayWidthM)
  const startIz = Math.floor(Math.min(...zs) / bayDepthM)
  const endIz = Math.ceil(Math.max(...zs) / bayDepthM)

  const points: GridPoint[] = []
  for (let ix = startIx; ix <= endIx; ix++) {
    for (let iz = startIz; iz <= endIz; iz++) {
      const x = ix * bayWidthM
      const z = iz * bayDepthM
      if (pointInPolygon(x, z, outline)) points.push({ x, z })
    }
  }
  return points
}

/**
 * Güverte sınırı — mezzanine-yerel `[x, z]` köşeler.
 *
 * Poligon verilmemişse `grid`den dikdörtgen üretiliyor, yani bu alan
 * eklenmeden ÖNCE kaydedilmiş her sahne birebir eskisi gibi davranıyor.
 *
 * Tek kaynak olması önemli: kolon süzme, döşeme kırpma, güverte-slab
 * poligonu ve 2D anahat aynı listeyi okuyor — ikinci bir hesap sessizce
 * ayrışırdı.
 */
export function outlinePolygon(node: MezzanineNode): [number, number][] {
  if (node.polygon && node.polygon.length >= 3) {
    return node.polygon.map(([x, z]) => [x, z])
  }
  const halfWidth = (node.grid.baysX * node.grid.bayWidthM) / 2
  const halfDepth = (node.grid.baysY * node.grid.bayDepthM) / 2
  return [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ]
}

/** Kullanıcı özel bir şekil çizmiş mi — uyarılar ve 2D bunu soruyor. */
export function hasCustomOutline(node: MezzanineNode): boolean {
  return (node.polygon?.length ?? 0) >= 3
}

/**
 * Nokta poligonun içinde mi — ışın atma.
 *
 * Kenar üstündeki noktalarda karar kararsız ve bu KASITLI: kolon ızgarası
 * poligon kenarına tam otururken bir kolonun çizilip çizilmemesi görsel bir
 * ayrıntı, ve kenarı koşulsuz "içeride" saymak dışa taşan kolonlar üretirdi.
 */
export function pointInPolygon(
  px: number,
  pz: number,
  polygon: readonly (readonly [number, number])[],
): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (!a || !b) continue
    const [xi, zi] = a
    const [xj, zj] = b
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Taban izi genişlik/derinliği — özel şekilde poligonun SINIR KUTUSU.
 *
 * Çarpışma kutusu, sürükleme sınırı ve `floorPlaced` ayak izi bunu okuyor;
 * eksen hizalı bir kutu istiyorlar ve bir L şeklinin sınır kutusu doğru
 * cevap. Döşemenin kendisi poligona kırpılıyor, kutu yalnız kabaca yer
 * kaplamayı tarif ediyor.
 */
export function footprintWidthM(node: MezzanineNode): number {
  if (hasCustomOutline(node)) {
    const xs = outlinePolygon(node).map(([x]) => x)
    return Math.max(...xs) - Math.min(...xs)
  }
  return legacyFootprintWidthM(node)
}
export function footprintDepthM(node: MezzanineNode): number {
  if (hasCustomOutline(node)) {
    const zs = outlinePolygon(node).map(([, z]) => z)
    return Math.max(...zs) - Math.min(...zs)
  }
  return legacyFootprintDepthM(node)
}

/** Izgaranın kendi ölçüsü — kolon aksı buradan, sınır poligondan. */
function legacyFootprintWidthM(node: MezzanineNode): number {
  return node.grid.baysX * node.grid.bayWidthM
}
function legacyFootprintDepthM(node: MezzanineNode): number {
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
