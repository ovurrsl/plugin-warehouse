/**
 * Canlı raf parçaları — kutu listesi, ailenin `role+center+size` deseni.
 *
 * Eğik olan tek şey kanal profilidir ve `tiltX` onun için var. **Makaralar
 * eğilmez ve bu bir eksiklik değil:** makara ekseni X'tir (bay genişliği),
 * bir silindiri kendi ekseni etrafında döndürmek görsel olarak hiçbir şey
 * yapmaz. Makaranın eğimi konumundan gelir — art arda gelen her makara bir
 * öncekinden `pitch · gradient` kadar alçakta durur.
 *
 * Faz 1 kapsamı: çerçeve, dinamik kirişler, kanal profilleri, makaralar.
 * Fren makarası, tutucu, ortalayıcı, çıkış kirişi ve son durdurucu Faz 2.
 */

import {
  CHANNEL_PROFILE_HEIGHT_M,
  CHANNEL_PROFILE_WIDTH_M,
  DIAGONAL_THICKNESS_M,
  DYNAMIC_BEAM_HEIGHT_M,
  DYNAMIC_BEAM_THICKNESS_M,
  LEVELLING_PLATE_THICKNESS_M,
  ROLLER_DIAMETER_M,
  UPRIGHT_DEPTH_M,
  UPRIGHT_WIDTH_M,
} from './catalog'
import {
  bayWidthM,
  channelDepthM,
  channelDropM,
  frameHeightM,
  levelExitYM,
  rollerLengthM,
} from './metrics'
import type { LiveRackingNode } from './schema'

export type LiveRackingPartRole =
  | 'upright'
  | 'diagonal'
  | 'footplate'
  | 'beam'
  | 'channel'
  | 'roller'

export type LiveRackingPart = {
  role: LiveRackingPartRole
  center: readonly [number, number, number]
  size: readonly [number, number, number]
  /** ZY düzleminde eğim — yalnız kanal profili kullanır. */
  tiltX?: number
}

/** Uzak katman: makaralar teker teker çizilmez, kanal tek bir şerit olur. */
export type LiveRackingDetail = 'full' | 'simple'

/**
 * Dört dikme + çaprazlar + taban plakaları.
 *
 * Kanal derinliği boyunca iki çerçeve: giriş (+Z) ve çıkış (−Z) uçlarında.
 * Gerçek bir kanal daha fazla ara çerçeve taşır ama görsel olarak uçlar
 * yapının okunmasına yetiyor ve ara çerçeveler makaraları gizliyor.
 */
function pushFrames(parts: LiveRackingPart[], node: LiveRackingNode): void {
  const halfWidth = bayWidthM(node) / 2
  const halfDepth = channelDepthM(node) / 2
  const height = frameHeightM(node)

  for (const z of [-halfDepth, halfDepth] as const) {
    for (const side of [-1, 1] as const) {
      const x = side * (halfWidth - UPRIGHT_WIDTH_M / 2)
      parts.push({
        role: 'upright',
        center: [x, height / 2, z],
        size: [UPRIGHT_WIDTH_M, height, UPRIGHT_DEPTH_M],
      })
      parts.push({
        role: 'footplate',
        center: [x, LEVELLING_PLATE_THICKNESS_M / 2, z],
        size: [UPRIGHT_WIDTH_M * 1.6, LEVELLING_PLATE_THICKNESS_M, UPRIGHT_DEPTH_M * 1.6],
      })
    }
    // Çerçeve içi yatay bağlar — kafesi okunur kılan asgari kadar.
    const ties = Math.max(2, Math.round(height / 1.2))
    for (let i = 1; i <= ties; i++) {
      parts.push({
        role: 'diagonal',
        center: [0, (i / (ties + 1)) * height, z],
        size: [halfWidth * 2 - UPRIGHT_WIDTH_M, DIAGONAL_THICKNESS_M, DIAGONAL_THICKNESS_M],
      })
    }
  }
}

/**
 * Bir katın taşıyıcı kirişleri: giriş ve çıkış uçlarında, X boyunca.
 *
 * Kirişin üstü kanalın o uçtaki kotunun altındadır — kanal profili kirişin
 * üstüne oturur, makaralar da profilin içine.
 */
function pushLevelBeams(parts: LiveRackingPart[], node: LiveRackingNode, level: number): void {
  const width = bayWidthM(node)
  const halfDepth = channelDepthM(node) / 2
  const exitY = levelExitYM(node, level)
  const entryY = exitY + channelDropM(node)

  const beamTop = (y: number) => y - CHANNEL_PROFILE_HEIGHT_M
  for (const [z, y] of [
    [-halfDepth, exitY],
    [halfDepth, entryY],
  ] as const) {
    parts.push({
      role: 'beam',
      center: [0, beamTop(y) - DYNAMIC_BEAM_HEIGHT_M / 2, z],
      size: [width, DYNAMIC_BEAM_HEIGHT_M, DYNAMIC_BEAM_THICKNESS_M],
    })
  }
}

/**
 * Bir katın iki kanal profili (rayı) — EĞİK olan tek parça.
 *
 * Profil, kanalın tam boyunca giriş ucundan çıkış ucuna iner. Eğim
 * `atan(gradient)`; %4 için 2.29°. Kutunun Z boyu, eğik mesafeyi karşılamak
 * için `depth / cos(tilt)` — düz boy verilse profil uçlarda kısa kalırdı.
 */
function pushChannelProfiles(parts: LiveRackingPart[], node: LiveRackingNode, level: number): void {
  const depth = channelDepthM(node)
  const drop = channelDropM(node)
  const tilt = Math.atan(node.gradient)
  const exitY = levelExitYM(node, level)
  // Kanalın orta noktası: iki uç kotunun ortası.
  const midY = exitY + drop / 2
  const railHalfSpan = rollerLengthM(node) / 2

  for (const side of [-1, 1] as const) {
    parts.push({
      role: 'channel',
      center: [side * railHalfSpan, midY - CHANNEL_PROFILE_HEIGHT_M / 2, 0],
      size: [CHANNEL_PROFILE_WIDTH_M, CHANNEL_PROFILE_HEIGHT_M, depth / Math.cos(tilt)],
      // +Z ucu YÜKSEK: pozitif tilt +Z'yi yukarı kaldırır.
      tiltX: -tilt,
    })
  }
}

/**
 * Bir katın makaraları.
 *
 * Kutu olarak çizilir, silindir olarak değil: bir kanalda yüzlerce makara
 * var ve bu paketin bütün geometrisi kutu-listesi (rack'ın C-kesit dikmesi
 * bile). Ekseni X, boyu D = A + 30 mm. Eğim konumdan gelir — her makara bir
 * öncekinden `pitch · gradient` alçakta.
 *
 * `simple` katmanında makara ÜRETİLMEZ; onun yerine tek bir şerit çizilir
 * (uzaktan yüzlerce kutu, yüzlerce üçgen ve hiçbir bilgi).
 */
function pushRollers(
  parts: LiveRackingPart[],
  node: LiveRackingNode,
  level: number,
  detail: LiveRackingDetail,
): void {
  const depth = channelDepthM(node)
  const drop = channelDropM(node)
  const exitY = levelExitYM(node, level)
  const length = rollerLengthM(node)
  const halfDepth = depth / 2

  if (detail === 'simple') {
    const tilt = Math.atan(node.gradient)
    parts.push({
      role: 'roller',
      center: [0, exitY + drop / 2 - ROLLER_DIAMETER_M / 2, 0],
      size: [length, ROLLER_DIAMETER_M, depth / Math.cos(tilt)],
      tiltX: -tilt,
    })
    return
  }

  const count = Math.max(2, Math.floor(depth / node.rollerPitch))
  for (let i = 0; i <= count; i++) {
    const t = i / count
    const z = -halfDepth + t * depth
    // Çıkış (−Z) alçak, giriş (+Z) yüksek.
    const y = exitY + t * drop
    parts.push({
      role: 'roller',
      center: [0, y - ROLLER_DIAMETER_M / 2, z],
      size: [length, ROLLER_DIAMETER_M, ROLLER_DIAMETER_M],
    })
  }
}

/** Bütün kanalın parça listesi. */
export function liveRackingParts(
  node: LiveRackingNode,
  detail: LiveRackingDetail,
): LiveRackingPart[] {
  const parts: LiveRackingPart[] = []
  pushFrames(parts, node)
  for (let level = 0; level < node.levels; level++) {
    pushLevelBeams(parts, node, level)
    pushChannelProfiles(parts, node, level)
    pushRollers(parts, node, level, detail)
  }
  return parts
}
