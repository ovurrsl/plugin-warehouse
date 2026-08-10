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
import {
  footprintDepthM,
  footprintWidthM,
  hasCustomOutline,
  outlinePolygon,
  pointInPolygon,
} from './metrics'
import type { MezzanineNode, MezzanineTier } from './schema'
import { type Rect, resolveSteps, stairVoidRect } from './stairs'

export type Edge = 'north' | 'south' | 'east' | 'west'

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

/**
 * Poligon anahatının bir kenarı.
 *
 * Dikdörtgen mezzanine'de dört kenar dört kardinale birebir düşüyor ve
 * davranış `edgeGeometry`nin aynısı; özel şekilde kenar sayısı serbest.
 */
export type OutlineEdge = {
  /** Kenarın uçları, mezzanine-yerel `[x, z]`. */
  a: readonly [number, number]
  b: readonly [number, number]
  lengthM: number
  /** Dışa bakan birim normal. */
  outward: readonly [number, number]
  /** En yakın kardinal yön — aksesuarlar hâlâ bu adlarla yerleşiyor. */
  cardinal: Edge
  /**
   * Bu kenar, kardinalinin TEMSİLCİSİ mi.
   *
   * `edge: 'north'` diyen bir kapı, kuzeye bakan HER kenarda açılamaz —
   * bir kapı bir yerdedir. Kardinal başına en uzun kenar temsilci seçiliyor
   * ve açıklıklar yalnız orada kesiliyor. Dikdörtgende her kardinalin tek
   * kenarı var, yani bu kural bugünkü davranışa birebir iniyor.
   */
  representative: boolean
}

const CARDINAL_NORMALS: ReadonlyArray<readonly [Edge, number, number]> = [
  ['north', 0, -1],
  ['south', 0, 1],
  ['west', -1, 0],
  ['east', 1, 0],
]

/**
 * Anahat kenarları, dış normalleriyle.
 *
 * **Dış normal sarımdan DEĞİL poligondan çıkarılıyor:** kenarın ortasından
 * aday normal boyunca küçük bir adım atılıyor ve `pointInPolygon` ile
 * dışarıda olup olmadığı soruluyor. Sarım kuralına güvenmek, çizim aracının
 * normalleştirmesi bir gün değişirse korkuluğu sessizce içe çevirirdi.
 */
export function outlineEdges(node: MezzanineNode): OutlineEdge[] {
  const outline = outlinePolygon(node)
  const probe = 0.05
  const edges: Omit<OutlineEdge, 'representative'>[] = []

  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]
    const b = outline[(i + 1) % outline.length]
    if (!a || !b) continue
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const lengthM = Math.hypot(dx, dz)
    if (lengthM < 1e-6) continue

    const midX = (a[0] + b[0]) / 2
    const midZ = (a[1] + b[1]) / 2
    // Kenara dik iki aday; poligonun dışına düşen doğru olan.
    let nx = -dz / lengthM
    let nz = dx / lengthM
    if (pointInPolygon(midX + nx * probe, midZ + nz * probe, outline)) {
      nx = -nx
      nz = -nz
    }

    let cardinal: Edge = 'north'
    let best = Number.NEGATIVE_INFINITY
    for (const [name, cx, cz] of CARDINAL_NORMALS) {
      const dot = nx * cx + nz * cz
      if (dot > best) {
        best = dot
        cardinal = name
      }
    }

    edges.push({ a, b, lengthM, outward: [nx, nz], cardinal })
  }

  // Kardinal başına en uzun kenar temsilci.
  const longest = new Map<Edge, number>()
  edges.forEach((edge, index) => {
    const current = longest.get(edge.cardinal)
    if (current === undefined || (edges[current]?.lengthM ?? 0) < edge.lengthM) {
      longest.set(edge.cardinal, index)
    }
  })

  return edges.map((edge, index) => ({
    ...edge,
    representative: longest.get(edge.cardinal) === index,
  }))
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

/**
 * Bir anahat kenarının DOLU parçaları — kenarın kendi parametresinde
 * (0 → `lengthM`).
 *
 * Açıklıklar yalnız kardinalinin temsilcisi olan kenarda kesiliyor; bkz.
 * `OutlineEdge.representative`. Dikdörtgende her kardinalin tek kenarı
 * olduğu için sonuç `railingSpans`ın verdiğinin aynısı.
 */
export function outlineEdgeSpans(tier: MezzanineTier, edge: OutlineEdge): Opening[] {
  const end = edge.lengthM
  if (!edge.representative) return [{ fromM: 0, toM: end }]

  const spans: Opening[] = []
  let cursor = 0
  for (const opening of openingsOnEdge(tier, edge.cardinal)) {
    const from = Math.max(0, opening.fromM)
    const to = Math.min(end, opening.toM)
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
  /**
   * Özel şekilde kenara sabitli merdiven, kardinalinin TEMSİLCİ anahat
   * kenarına oturur — sınır dikdörtgenine değil. `offsetM` o kenarın kendi
   * parametresinde (0 → uzunluk) ve iniş yönü kenarın dış normalinin tersi:
   * merdiven döşemedeki boşluktan İÇERİ iner.
   *
   * Dikdörtgen yol aşağıda aynen duruyor: dört kardinal kenar orada
   * `edgeGeometry`den geliyor ve mevcut sahnelerin davranışı değişmiyor.
   */
  if (hasCustomOutline(node) && stair.placement.mode === 'edge') {
    // Daraltma kapanışın içinde kayboluyor; kardinali önce yakala.
    const cardinal = stair.placement.edge
    const edge = outlineEdges(node).find(
      (candidate) => candidate.representative && candidate.cardinal === cardinal,
    )
    if (edge) {
      const t = Math.min(Math.max(stair.placement.offsetM, 0), edge.lengthM)
      const ux = (edge.b[0] - edge.a[0]) / edge.lengthM
      const uz = (edge.b[1] - edge.a[1]) / edge.lengthM
      return {
        x: edge.a[0] + ux * t,
        z: edge.a[1] + uz * t,
        // Yerel +Z'yi içe (−normal) çeviren yaw: (−sin, cos) = (−nx, −nz).
        rotationRad: Math.atan2(edge.outward[0], -edge.outward[1]),
      }
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
