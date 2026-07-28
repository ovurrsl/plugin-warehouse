/**
 * Rota örnekleyici — çizilmiş çizgi, sürülen yol.
 *
 * Bir aracın izlediği eğri, boyanın çizdiği merkez hattının TA KENDİSİDİR:
 * `route.points` buradan yay-uzunluğu tablosuna çevrilir ve filo o tabloyu
 * örnekler. İkinci bir "sürüş yolu" gösterimi yoktur — iki gösterim, kullanıcı
 * rotayı büktüğünde birinin güncellenmeyi unutması demektir.
 *
 * Poz ROTANIN yerel çerçevesinde üretilir ve rota + araç aynı ebeveyne (level)
 * ait olmak zorunda olduğundan (fleet.ts bunu reddeder) level çerçevesine tek
 * bir toplama ile çıkılır — `Matrix4` zinciri ve onunla gelen çeyrek-tur hata
 * sınıfı hiç kurulmaz.
 */

import type { RouteNode } from '../route/schema'

export type RouteTrack = {
  routeId: string
  parentId: string | null
  /** Rota düğümünün level-yerel konumu — örnek buna eklenir. */
  origin: readonly [number, number, number]
  /** Köşe noktaları, rota-yerel XZ. */
  points: ReadonlyArray<readonly [number, number]>
  /** Kümülatif yay uzunluğu; `cum[i]` = i. köşeye kadarki metre. */
  cum: readonly number[]
  lengthM: number
  traffic: 'one-way' | 'two-way'
}

/** Sıfır uzunluklu ya da tek noktalı rota sürülemez — `null`, sessiz NaN değil. */
export function buildTrack(route: RouteNode): RouteTrack | null {
  const points = route.points
  if (points.length < 2) return null
  const cum: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1] as [number, number]
    const [bx, bz] = points[i] as [number, number]
    const cumPrev = cum[i - 1] ?? 0
    cum.push(cumPrev + Math.hypot(bx - ax, bz - az))
  }
  const lengthM = cum[cum.length - 1] ?? 0
  if (lengthM <= 0) return null
  return {
    routeId: route.id,
    parentId: route.parentId ?? null,
    origin: route.position ?? [0, 0, 0],
    points,
    cum,
    lengthM,
    traffic: route.traffic,
  }
}

export type TrackSample = {
  /** Level-yerel. */
  x: number
  z: number
  /**
   * Aracın Y dönüşü. İleri +X'tir ve three'de `rotation.y = θ` ileriyi
   * `(cosθ, 0, −sinθ)`'ya götürür; segment yönü `(dx, dz)` için
   * `θ = atan2(−dz, dx)`. İşaret testi 90°'lik segmentle kilitli — yanlış
   * işaret 0°'de görünmezdir ve araç rotayı aynada sürer.
   */
  headingRad: number
}

/**
 * Yay uzunluğu `s`'te örnek. `s` [0, uzunluk] dışındaysa KIRPILIR — koşarken
 * kısaltılan bir rota dizi dışına taşırmaz, aracı yeni uca oturtur (T30).
 */
export function sampleTrack(track: RouteTrack, s: number): TrackSample {
  const clamped = Math.min(Math.max(s, 0), track.lengthM)
  // Son köşe hariç aralık ara: cum[i] ≤ s ≤ cum[i+1].
  let i = 0
  while (i < track.cum.length - 2 && (track.cum[i + 1] ?? 0) < clamped) i++
  const [ax, az] = track.points[i] as [number, number]
  const [bx, bz] = track.points[i + 1] as [number, number]
  const segStart = track.cum[i] ?? 0
  const segLen = (track.cum[i + 1] ?? 0) - segStart
  const t = segLen > 0 ? (clamped - segStart) / segLen : 0
  const dx = bx - ax
  const dz = bz - az
  return {
    x: track.origin[0] + ax + dx * t,
    z: track.origin[2] + az + dz * t,
    headingRad: Math.atan2(-dz, dx),
  }
}
