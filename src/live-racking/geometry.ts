/**
 * Canlı raf geometrisi — ailenin ORTAK havuzunda (`getCachedGeometry`).
 *
 * Anahtar ŞEKLİ belirleyen her girdiyi taşır. Konfigürasyon bayrakları
 * (tutucu, bölünmüş makara…) Faz 2'de parça üretecek; anahtara şimdiden
 * girmeleri gerekmiyor çünkü henüz hiçbir parçayı değiştirmiyorlar — bir
 * alanı geometriyi değiştirmeden anahtara koymak, paylaşımı bedelsiz
 * bölerdi.
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
import { type LiveRackingDetail, type LiveRackingPart, liveRackingParts } from './parts'
import type { LiveRackingNode } from './schema'

function colorOf(node: LiveRackingNode, role: LiveRackingPart['role']): string {
  switch (role) {
    case 'upright':
    case 'diagonal':
    case 'footplate':
      return node.uprightColor
    case 'beam':
      return node.beamColor
    // Kanal profili ve makara aynı galvaniz — ikisi de akış donanımı ve
    // boyalı çelikten ayrılmaları gerekiyor.
    case 'channel':
    case 'roller':
      return PALETTE.roller
  }
}

function buildParts(
  node: LiveRackingNode,
  parts: readonly LiveRackingPart[],
): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  for (const part of parts) {
    emitPart(sink, part, toLinear(colorOf(node, part.role)), 0, 0, part.tiltX ?? 0)
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
