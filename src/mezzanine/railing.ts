/**
 * Korkuluk — açık çevrede ZORUNLU, ve bir alan değil bir kural.
 *
 * Katalog: "mandatory on open perimeter, not required against a wall".
 * Kullanıcı korkuluğu açıp kapatamaz; kapılar ve güvenlik bölgeleri onu
 * DELER. Bu yüzden korkuluk `accessories`'te bir eleman değil, çevrenin
 * açıklıklardan türetilmiş bir fonksiyonudur — iki yerde iki liste olsaydı,
 * bir kapı eklemek korkulukta kendiliğinden bir açıklık açmazdı.
 *
 * Saf: three yok, React yok.
 */

import { CONSTRUCTIVE_SYSTEMS } from './catalog'
import { footprintDepthM, footprintWidthM } from './metrics'
import type { MezzanineNode, MezzanineTier } from './schema'
import { type Rect, rectsOverlap, resolveSteps, stairVoidRect } from './stairs'

export type Edge = 'north' | 'south' | 'east' | 'west'
export const EDGES: readonly Edge[] = ['north', 'south', 'east', 'west']

/**
 * Kenarın dünya çerçevesindeki yeri.
 *
 * Konvansiyon: north = −Z, south = +Z, west = −X, east = +X. `offsetM` her
 * kenarda kenarın BAŞINDAN ölçülür (kuzey/güneyde −X ucundan, doğu/batıda
 * −Z ucundan) — tek bir yön kuralı, dört kenarda da aynı.
 */
export type EdgeGeometry = {
  /** Kenar boyunca eksen: 'x' (kuzey/güney) ya da 'z' (doğu/batı). */
  axis: 'x' | 'z'
  /** Kenarın diğer eksendeki sabit konumu. */
  fixed: number
  /** Kenarın uzunluğu. */
  lengthM: number
  /** Kenarın başlangıç koordinatı (offset 0'ın karşılığı). */
  startM: number
  /** Dışa bakan yön (+1 / −1), korkuluğun hangi tarafa çekileceği. */
  outward: number
}

export function edgeGeometry(node: MezzanineNode, edge: Edge): EdgeGeometry {
  const width = footprintWidthM(node)
  const depth = footprintDepthM(node)
  switch (edge) {
    case 'north':
      return { axis: 'x', fixed: -depth / 2, lengthM: width, startM: -width / 2, outward: -1 }
    case 'south':
      return { axis: 'x', fixed: depth / 2, lengthM: width, startM: -width / 2, outward: 1 }
    case 'west':
      return { axis: 'z', fixed: -width / 2, lengthM: depth, startM: -depth / 2, outward: -1 }
    case 'east':
      return { axis: 'z', fixed: width / 2, lengthM: depth, startM: -depth / 2, outward: 1 }
  }
}

/** Bir kenar üzerindeki açıklık — `[başlangıç, bitiş]`, kenarın kendi
 *  parametresinde (offset uzayı). */
export type Opening = { fromM: number; toM: number }

/**
 * Bir kenarın açıklıkları: menteşeli kapılar, palet kapıları, güvenlik
 * bölgeleri ve o kenara oturan merdivenlerin ağzı.
 *
 * Sıralı ve birleştirilmiş döner — üst üste binen iki açıklık, korkulukta
 * iki değil tek boşluk açar.
 */
export function openingsOnEdge(tier: MezzanineTier, edge: Edge): Opening[] {
  const raw: Opening[] = []

  for (const gate of tier.accessories.swingGates) {
    if (gate.edge === edge) {
      raw.push({ fromM: gate.offsetM - gate.widthM / 2, toM: gate.offsetM + gate.widthM / 2 })
    }
  }
  for (const gate of tier.accessories.upAndOverGates) {
    if (gate.edge === edge) {
      raw.push({ fromM: gate.offsetM - gate.widthM / 2, toM: gate.offsetM + gate.widthM / 2 })
    }
  }
  for (const zone of tier.accessories.safetyZones) {
    if (zone.edge === edge) {
      raw.push({ fromM: zone.offsetM - zone.widthM / 2, toM: zone.offsetM + zone.widthM / 2 })
    }
  }
  // Kenara oturan bir merdivenin AĞZI da bir açıklıktır — merdiven varsa
  // korkuluk oradan geçemez, yoksa merdiven korkuluğun içinden çıkardı.
  // Açıklığın genişliği merdivenin kendi genişliği: kot farkı burayı
  // etkilemiyor (o, döşeme boşluğunun DERİNLİĞİNE giriyor).
  for (const stair of tier.accessories.staircases) {
    if (stair.placement.mode !== 'edge' || stair.placement.edge !== edge) continue
    const half = stair.widthM / 2
    raw.push({ fromM: stair.placement.offsetM - half, toM: stair.placement.offsetM + half })
  }

  return mergeOpenings(raw)
}

function mergeOpenings(openings: readonly Opening[]): Opening[] {
  if (openings.length === 0) return []
  const sorted = [...openings].sort((a, b) => a.fromM - b.fromM)
  const merged: Opening[] = []
  for (const opening of sorted) {
    const last = merged[merged.length - 1]
    if (last && opening.fromM <= last.toM) {
      last.toM = Math.max(last.toM, opening.toM)
    } else {
      merged.push({ ...opening })
    }
  }
  return merged
}

/** Korkuluğun DOLU parçaları: kenar eksi açıklıklar, kenar parametresinde. */
export function railingSpans(node: MezzanineNode, tier: MezzanineTier, edge: Edge): Opening[] {
  const geo = edgeGeometry(node, edge)
  const openings = openingsOnEdge(tier, edge)
  const spans: Opening[] = []
  let cursor = geo.startM
  const end = geo.startM + geo.lengthM

  for (const opening of openings) {
    const from = Math.max(geo.startM, geo.startM + opening.fromM)
    const to = Math.min(end, geo.startM + opening.toM)
    if (to <= cursor) continue
    if (from > cursor) spans.push({ fromM: cursor, toM: Math.min(from, end) })
    cursor = Math.max(cursor, to)
  }
  if (cursor < end) spans.push({ fromM: cursor, toM: end })

  return spans.filter((span) => span.toM - span.fromM > 0.01)
}

/** Bu kurucu sistemin izin verdiği en geniş direk aralığı. */
export function postSpacingM(node: MezzanineNode): number {
  return CONSTRUCTIVE_SYSTEMS[node.constructiveSystem].railingPostMaxSpacingM
}

/**
 * Bir tier'in bütün merdiven boşlukları, dünya çerçevesinde.
 *
 * `parts.ts` döşeme panellerini bunlara karşı süzer — CSG değil, panel
 * dışlama.
 */
export function tierVoidRects(
  node: MezzanineNode,
  tier: MezzanineTier,
  elevationDeltaM: number,
): Rect[] {
  const rects: Rect[] = []
  for (const stair of tier.accessories.staircases) {
    const { geometry } = resolveSteps(stair, elevationDeltaM)
    const origin = stairOrigin(node, stair)
    rects.push(stairVoidRect(stair, geometry, origin))
  }
  return rects
}

/** Merdivenin dünya çerçevesindeki ağzı ve yönü. */
export function stairOrigin(
  node: MezzanineNode,
  stair: MezzanineTier['accessories']['staircases'][number],
): { x: number; z: number; rotationRad: number } {
  if (stair.placement.mode === 'xz') {
    return {
      x: stair.placement.xM,
      z: stair.placement.zM,
      rotationRad: (stair.placement.rotationDeg * Math.PI) / 180,
    }
  }
  const geo = edgeGeometry(node, stair.placement.edge)
  const along = geo.startM + stair.placement.offsetM
  // Merdiven çevreden İÇERİ doğru iner: yönü kenarın dışa bakan yönünün
  // tersi.
  if (geo.axis === 'x') {
    return { x: along, z: geo.fixed, rotationRad: geo.outward > 0 ? Math.PI : 0 }
  }
  return { x: geo.fixed, z: along, rotationRad: geo.outward > 0 ? -Math.PI / 2 : Math.PI / 2 }
}

export type { Rect }
export { rectsOverlap }
