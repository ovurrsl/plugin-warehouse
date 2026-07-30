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
import { PALETTE } from './catalog'
import { hasIntermediateRetainers } from './metrics'
import { type LiveRackingDetail, type LiveRackingPart, liveRackingParts } from './parts'
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

export function liveRackingGeometryKey(node: LiveRackingNode, detail: LiveRackingDetail): string {
  return [
    'live',
    node.variant,
    node.palletPreset,
    node.palletsDeep,
    node.levels,
    node.firstLevelClear,
    node.levelClear,
    node.gradient,
    node.rollerPitch,
    node.withRetainers,
    node.splitRollers,
    // Ham bayrak değil ETKİN değer: ara tutucu eşiğin altında hiçbir parça
    // üretmiyor, dolayısıyla o iki kanalın geometrisi birebir aynı ve aynı
    // buffer'ı paylaşmalılar. Ham bayrağı koymak, hiç farkı olmayan iki
    // kanal için iki ayrı mesh üretirdi.
    hasIntermediateRetainers(node),
    node.hingedChannels,
    detail,
    node.uprightColor,
    node.beamColor,
  ].join('|')
}

export function getLiveRackingGeometry(
  node: LiveRackingNode,
  detail: LiveRackingDetail,
): THREE.BufferGeometry {
  return getCachedGeometry(liveRackingGeometryKey(node, detail), () =>
    buildParts(node, liveRackingParts(node, detail)),
  )
}

export { releaseGeometry, retainGeometry }
