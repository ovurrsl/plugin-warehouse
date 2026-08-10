/**
 * Canlı raf geometrisi — ailenin ORTAK havuzunda (`getCachedGeometry`).
 *
 * Anahtar ŞEKLİ belirleyen her girdiyi taşır — ve artık konfigürasyon
 * bayraklarının hepsi şekli belirliyor: `splitRollers` makarayı ikiye
 * bölüyor, `hingedChannels` menteşe boğumu ekliyor, `intermediateRetainers`
 * ara tutucu koyuyor. Faz 1'de bunlar anahtarda YOKTU ve doğruydu: hiçbir
 * parçayı değiştirmeyen bir alanı anahtara koymak paylaşımı bedelsiz
 * bölerdi. Şimdi değiştiriyorlar, dolayısıyla girmek zorundalar — biri
 * unutulursa iki farklı kanal aynı mesh'i paylaşır.
 */

import type * as THREE from 'three'
import {
  emitPart,
  finish,
  getCachedGeometry,
  releaseGeometry,
  retainGeometry,
  type Sink,
  toLinear,
} from '../conveyor/geometry-builder'
import { memoiseGeometryKey } from '../geometry-key-memo'
import { PALETTE } from './catalog'
import { hasIntermediateRetainers } from './metrics'
import {
  type FrameOmission,
  type LiveRackingDetail,
  type LiveRackingPart,
  liveRackingParts,
} from './parts'
import type { LiveRackingNode } from './schema'

function colorOf(node: LiveRackingNode, role: LiveRackingPart['role']): string {
  switch (role) {
    case 'upright':
    case 'diagonal':
    case 'footplate':
    case 'anchor':
      return node.uprightColor
    case 'beam':
    case 'exit-beam':
      return node.beamColor
    // Kanal profili ve makara aynı galvaniz — ikisi de akış donanımı ve
    // boyalı çelikten ayrılmaları gerekiyor.
    case 'channel':
    case 'roller':
    case 'centraliser':
    case 'hinge':
      return PALETTE.roller
    // Fren donanımı koyu: sıradan makara hattından bir bakışta ayrılmalı,
    // çünkü hangi makaraların frenli olduğu yerleşim kararıdır.
    case 'brake-roller':
    case 'brake-drum':
      return PALETTE.brake
    // Durdurma ve tutma donanımı güvenlik kırmızısı.
    case 'retainer':
    case 'end-stop':
      return PALETTE.stop
  }
}

function buildParts(
  node: LiveRackingNode,
  parts: readonly LiveRackingPart[],
): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  for (const part of parts) {
    emitPart(
      sink,
      part,
      toLinear(colorOf(node, part.role)),
      0,
      part.rotationY ?? 0,
      part.tiltX ?? 0,
    )
  }
  return finish(sink)
}

function buildLiveRackingGeometryKey(
  node: LiveRackingNode,
  detail: LiveRackingDetail,
  omission: FrameOmission = { omitRight: false },
): string {
  /**
   * Makara hattı ve akış donanımı YALNIZ yakın katmanda üretiliyor
   * (`liveRackingParts`): uzak katmanda kanal tek bir eğik şerit, ve o şerit
   * ne makara aralığını, ne bölünmüş makarayı, ne tutucuyu görüyor. Bu üç
   * alanı katmandan bağımsız yazmak, birebir aynı buffer'ı birden çok anahtar
   * altında saklamak — anahtarın CLAUDE.md'de adlandırılan öteki yönü.
   */
  const full = detail === 'full'
  return [
    'live',
    // Bitişik komşusu olan kanal sağ dikme hattını KURMUYOR (`neighbours.ts`).
    // Anahtarda olmazsa bir bloğun içi ile ucu aynı mesh'i paylaşır: ya bütün
    // blok dikmesiz kalır, ya ek yerlerinde çift dikme belirir — hangisinin
    // önce çizildiğine bağlı olarak, yani sahne yüklenme sırasına göre değişen
    // bir hata.
    omission.omitRight ? 'L' : 'LR',
    node.variant,
    node.palletPreset,
    node.palletsDeep,
    node.levels,
    // Zemin seviyesi transpalet katında ilk kanal doğrudan zemine oturuyor ve
    // `firstLevelClear` hiç okunmuyor (`levelExitYM`) — kot zinciri zeminden
    // başlıyor.
    node.floorSetPalletTruckLevel ? 0 : node.firstLevelClear,
    // Katlar arası açıklık ancak ÜSTÜNE bir kat varsa bir şey taşıyor: tek
    // katlı kanalda `levelExitYM`'in döngüsü hiç dönmüyor.
    node.levels > 1 ? node.levelClear : 0,
    node.gradient,
    full ? node.rollerPitch : 0,
    // Bu, katmandan bağımsız: tutucu görünür parçasının yanında kanal
    // DERİNLİĞİNİ de uzatıyor (`channelDepthM`), yani uzak katmanın tek
    // şeridi bile ondan uzuyor.
    node.withRetainers,
    full && node.splitRollers,
    // Ham bayrak değil ETKİN değer: ara tutucu eşiğin altında hiçbir parça
    // üretmiyor, dolayısıyla o iki kanalın geometrisi birebir aynı ve aynı
    // buffer'ı paylaşmalılar. Ham bayrağı koymak, hiç farkı olmayan iki
    // kanal için iki ayrı mesh üretirdi.
    full && hasIntermediateRetainers(node),
    node.hingedChannels,
    node.floorSetPalletTruckLevel,
    node.cladRack,
    detail,
    node.uprightColor,
    node.beamColor,
  ].join('|')
}

export function getLiveRackingGeometry(
  node: LiveRackingNode,
  detail: LiveRackingDetail,
  omission: FrameOmission = { omitRight: false },
): THREE.BufferGeometry {
  return getCachedGeometry(liveRackingGeometryKey(node, detail, omission), () =>
    buildParts(node, liveRackingParts(node, detail, omission)),
  )
}

/** Katmanı ve komşuluğu birlikte tutan retain — çağıranın anahtarı ikinci kez
 *  kurmasına gerek kalmıyor, ve tutulan anahtar ile çizilen anahtarın ayrışması
 *  (tutulmayan bir buffer'ın süpürülmesi) böyle imkânsız oluyor. */
export function retainLiveRackingGeometry(
  node: LiveRackingNode,
  detail: LiveRackingDetail,
  omission: FrameOmission = { omitRight: false },
): string {
  return retainGeometry(liveRackingGeometryKey(node, detail, omission))
}

export { releaseGeometry, retainGeometry }

/** Düğüm-nesnesine memoize — bkz. `geometry-key-memo.ts`; çıplak üretici: `buildLiveRackingGeometryKey`. */
export const liveRackingGeometryKey = memoiseGeometryKey(
  buildLiveRackingGeometryKey,
  (detail, omission) => `${detail}:${omission?.omitRight ? 'L' : 'LR'}`,
)
