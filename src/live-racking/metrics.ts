/**
 * Canlı raf ölçüleri — saf. three yok, React yok, store yazımı yok.
 *
 * Yerel çerçeve: derinlik +Z (giriş yüksek), genişlik X, kat Y. Kanal
 * girişten çıkışa `X · gradient` kadar alçalır.
 */

import { specOf } from '../pallet/presets'
import {
  BAY_SIDE_CLEARANCE_M,
  BRAKE_ROLLER_MIN_DEPTH,
  CHANNEL_PROFILE_HEIGHT_M,
  DYNAMIC_BEAM_HEIGHT_M,
  FRAME_HEIGHT_STEP_M,
  INTERMEDIATE_RETAINER_MIN_DEPTH,
  LANE_LENGTH_DATUM_M,
  RETAINER_GAP_M,
  ROLLER_OVER_PALLET_M,
  ROLLER_PITCH_STEP_M,
} from './catalog'
import type { LiveRackingNode } from './schema'

/**
 * Paletin kanal ağzına bakan genişliği — katalogun "A" ölçüsü.
 *
 * Canlı rafta palet kanala DERİNLİĞİ boyunca girer, yani ağza bakan yüz
 * paletin genişliğidir. `specOf` uzunluğu X'e, genişliği Z'ye koyar; kanal
 * ekseni Z olduğu için A = `width`... değil: palet kanalda uzunluğu akış
 * yönünde olacak şekilde durur (1200 mm derinliğe, 800 mm ağza). Yani
 * A = `width`, kanal boyunca yer kaplayan ise `length`.
 */
export function palletFaceWidthM(node: LiveRackingNode): number {
  return specOf(node.palletPreset).width
}

/** Paletin kanal boyunca kapladığı derinlik. */
export function palletRunDepthM(node: LiveRackingNode): number {
  return specOf(node.palletPreset).length
}

/** Bay genişliği E = A + 160 mm (her yanda 80). Katalog formülü. */
export function bayWidthM(node: LiveRackingNode): number {
  return palletFaceWidthM(node) + 2 * BAY_SIDE_CLEARANCE_M
}

/** Makara boyu D = A + 30 mm. Katalog formülü. */
export function rollerLengthM(node: LiveRackingNode): number {
  return palletFaceWidthM(node) + ROLLER_OVER_PALLET_M
}

/**
 * Kanal derinliği X = Σ(palet derinliği) + tolerans.
 *
 * Katalogun işlenmiş örneği: 1200 mm × 8 palet, tutucusuz 9800 mm
 * (yani +200 mm tolerans), tutucuyla 10000 mm (+300 mm tutucu boşluğu
 * +100 mm tolerans). İki tolerans da katalogdan okunuyor.
 */
const DEPTH_TOLERANCE_PLAIN_M = 0.2
const DEPTH_TOLERANCE_RETAINER_M = 0.1

export function channelDepthM(node: LiveRackingNode): number {
  const run = palletRunDepthM(node) * node.palletsDeep
  return node.withRetainers
    ? run + RETAINER_GAP_M + DEPTH_TOLERANCE_RETAINER_M
    : run + DEPTH_TOLERANCE_PLAIN_M
}

/** Kanalın giriş ile çıkış ucu arasındaki kot farkı. */
export function channelDropM(node: LiveRackingNode): number {
  return channelDepthM(node) * node.gradient
}

/**
 * Bir katın ÇIKIŞ ucundaki (alçak uç, −Z) makara üst kotu.
 *
 * Kat 0 en alttaki. Bir katın yüksekliği: altındaki serbest yükseklik +
 * kanalın kendi yapısı (kiriş + profil) + kanalın kendi düşüşü — çünkü bir
 * sonraki kat, bu katın EN YÜKSEK noktasının üstünde başlamak zorunda.
 */
export function levelExitYM(node: LiveRackingNode, level: number): number {
  const structure = DYNAMIC_BEAM_HEIGHT_M + CHANNEL_PROFILE_HEIGHT_M
  const drop = channelDropM(node)
  let y = node.firstLevelClear
  for (let i = 0; i < level; i++) {
    y += drop + structure + node.levelClear
  }
  return y
}

/** Aynı katın GİRİŞ ucundaki (yüksek uç, +Z) makara üst kotu. */
export function levelEntryYM(node: LiveRackingNode, level: number): number {
  return levelExitYM(node, level) + channelDropM(node)
}

/** Çerçevenin toplam yüksekliği — en üst katın giriş ucu + yapı payı. */
export function frameHeightM(node: LiveRackingNode): number {
  const top = levelEntryYM(node, node.levels - 1)
  return top + DYNAMIC_BEAM_HEIGHT_M + CHANNEL_PROFILE_HEIGHT_M
}

/** Makara aralığı 75 mm'nin katı mı — panel bunu uyarı olarak söyler. */
export function rollerPitchIsValid(node: LiveRackingNode): boolean {
  const ratio = node.rollerPitch / ROLLER_PITCH_STEP_M
  return Math.abs(ratio - Math.round(ratio)) < 1e-6
}

/** Fren makarası takılır mı — katalog: yalnız İKİDEN derin kanalda. */
export function hasBrakeRollers(node: LiveRackingNode): boolean {
  return node.palletsDeep > BRAKE_ROLLER_MIN_DEPTH
}

/**
 * Ara tutucu takılır mı.
 *
 * Bayrak tek başına yetmiyor: kısa bir kanalda ara tutucunun tutacağı bir
 * palet treni yok. Eşiğin altında işaretli bırakmak sessizce etkisiz kalmak
 * olurdu, o yüzden panel de aynı koşulu uyarı olarak söylüyor.
 */
export function hasIntermediateRetainers(node: LiveRackingNode): boolean {
  return node.intermediateRetainers && node.palletsDeep >= INTERMEDIATE_RETAINER_MIN_DEPTH
}

/** Bir kanaldaki makara sayısı. */
export function rollerCount(node: LiveRackingNode): number {
  return Math.max(2, Math.floor(channelDepthM(node) / node.rollerPitch))
}

/**
 * Çerçeve yüksekliği 50 mm'nin katı mı — katalog kısıtı.
 *
 * Dikme delikleri 50 mm adımla açılıyor, yani ara bir yükseklik sipariş
 * edilemez. Yükseklik serbest bir toplam olduğu için (serbest yükseklikler +
 * yapı payı + düşüş) kullanıcının bunu tutturması tesadüfe kalıyor; panel
 * en yakın geçerli değeri de söylüyor.
 */
export function frameHeightIsValid(node: LiveRackingNode): boolean {
  const ratio = frameHeightM(node) / FRAME_HEIGHT_STEP_M
  return Math.abs(ratio - Math.round(ratio)) < 1e-6
}

/** 50 mm adımına oturan en yakın çerçeve yüksekliği. */
export function nearestValidFrameHeightM(node: LiveRackingNode): number {
  return Math.round(frameHeightM(node) / FRAME_HEIGHT_STEP_M) * FRAME_HEIGHT_STEP_M
}

/**
 * Kanal katalogun 20 m koridor datumunu aşıyor mu.
 *
 * Sert sınır DEĞİL — katalog daha uzununun kurulabildiğini söylüyor. 30 palet
 * × 1200 mm kanal 36 m'yi buluyor; kullanıcı bunu bilerek yapmalı.
 */
export function exceedsLaneDatum(node: LiveRackingNode): boolean {
  return channelDepthM(node) > LANE_LENGTH_DATUM_M
}

/** Kanalın tuttuğu palet sayısı — kapasite okumasının girdisi. */
export function palletPositions(node: LiveRackingNode): number {
  return node.levels * node.palletsDeep
}
