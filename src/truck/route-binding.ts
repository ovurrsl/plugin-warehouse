/**
 * Rota talebi — yerleştirme anında BİR KEZ, sonra kalıcı.
 *
 * En yakın rota değil, ATANMIŞ rota (plan §5.3): iki koridor arasına park
 * etmiş bir araç, kullanıcı bir rafı bir santim kaydırdığında sessizce
 * koridor değiştirirdi; atama görünmez ve düzenlenemez olurdu. Bu yüzden
 * seçim commit'te yapılır, cevabı düğüme yazılır (`electSupportSlab`'ın
 * deseni) ve ancak kullanıcı değiştirirse değişir.
 */

import type { RouteNode } from '../route/schema'
import { buildTrack, sampleTrack } from './route-index'

/** Aracın merkezinin, talep edilecek rotanın merkez hattına en fazla uzaklığı. */
export const ROUTE_CLAIM_M = 1.5

/** Merkez hattına dik en kısa mesafe — kaba ama commit'te bir kez koşar. */
function distanceToTrack(route: RouteNode, x: number, z: number): number {
  const track = buildTrack(route)
  if (!track) return Number.POSITIVE_INFINITY
  // Yarım metrelik adımlarla örnekle: ROUTE_CLAIM_M = 1.5'lik bir eşiğe
  // segment-dik izdüşüm hassasiyeti gerekmiyor.
  let best = Number.POSITIVE_INFINITY
  const steps = Math.max(2, Math.ceil(track.lengthM / 0.5))
  for (let i = 0; i <= steps; i++) {
    const sample = sampleTrack(track, (i / steps) * track.lengthM)
    best = Math.min(best, Math.hypot(sample.x - x, sample.z - z))
  }
  return best
}

/**
 * Aynı level'daki en yakın `role === 'vehicle'` rota, eşiğin içindeyse.
 *
 * Yaya yolu ASLA talep edilmez: 1.27 m'lik bir aracı yaya genişliğindeki
 * boyadan sürmek, panel yaya figürünü alıntılarken boyayı kesen bir makine
 * çizerdi.
 */
export function claimRoute(
  nodes: Readonly<Record<string, unknown>>,
  levelId: string | null,
  x: number,
  z: number,
  /** Yerleştirme 1.5 m'de kalır; panelin AÇIK "bağla" düğmesi daha geniş
   *  arayabilir — niyet beyan edilmiştir, sessiz bir tahmin değildir. */
  maxDistanceM: number = ROUTE_CLAIM_M,
): string | null {
  let bestId: string | null = null
  let bestDistance = maxDistanceM
  for (const [id, candidate] of Object.entries(nodes)) {
    const route = candidate as RouteNode
    if ((route as { type?: string }).type !== 'warehouse:route') continue
    if (route.role !== 'vehicle') continue
    if ((route.parentId ?? null) !== levelId) continue
    const distance = distanceToTrack(route, x, z)
    if (distance <= bestDistance) {
      bestDistance = distance
      bestId = id
    }
  }
  return bestId
}
