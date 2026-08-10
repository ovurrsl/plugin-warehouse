/**
 * Toplama arabası geometrisi — ailenin ORTAK havuzunda, İKİ şekil.
 *
 * Çerçeve ile kasa ayrı anahtarlanıyor, ve bu ayrım kasanın PAYLAŞILMASINI
 * sağlıyor: beş katlı bir arabada beş mesh var ama tek kasa buffer'ı, ve
 * aynı kasayı kullanan öteki arabalar da onu paylaşıyor. Kasayı çerçeveye
 * katsaydık her kat sayısı × kasa boyu kombinasyonu ayrı bir kasa kopyası
 * basardı.
 *
 * `loadedTiers` HİÇBİR anahtarda yok: kaç kasa çizileceği renderer'ın
 * mesh SAYISI, şeklin kendisi değil.
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
import { bottomTierYM, tierPitchM, tiltRad, toteSizeOf } from './metrics'
import { type ToteCartDetail, type ToteCartPart, toteCartFrameParts, toteParts } from './parts'
import type { ToteCartNode } from './schema'

function colorOf(node: ToteCartNode, role: ToteCartPart['role']): string {
  switch (role) {
    case 'frame':
      return node.frameColor
    case 'deck':
      return PALETTE.deck
    case 'tote':
      return node.toteColor
    case 'tote-inner':
      return PALETTE.toteInner
    case 'tyre':
      return PALETTE.tyre
    case 'hub':
      return PALETTE.hub
    case 'joint':
      return PALETTE.joint
  }
}

function buildParts(node: ToteCartNode, parts: readonly ToteCartPart[]): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  for (const part of parts) {
    // 4. argüman atlas şerit boyu (kullanılmıyor), 5. yalpalama, 6. eğim.
    emitPart(sink, part, toLinear(colorOf(node, part.role)), 0, 0, part.tiltX ?? 0)
  }
  return finish(sink)
}

function buildFrameKey(node: ToteCartNode, detail: ToteCartDetail): string {
  // ÇÖZÜLMÜŞ değerler, ham alanlar değil: kat aralığı kasa boyundan
  // türüyor, ve `toteHeight` ailenin merdiveninde yoksa `toteSizeOf` onu
  // en yakınına yaslıyor — iki farklı ham değer aynı mesh'e çözülebilir.
  return [
    'tc-frame',
    node.toteFootprint,
    node.tiers,
    bottomTierYM(node).toFixed(4),
    // Aralık YALNIZ birden çok katta bir vertex kımıldatıyor: tek katlı bir
    // arabada ikinci tepsi yok, yani 75 mm'lik kasayla 420 mm'lik kasa
    // birebir aynı çerçeveyi üretiyor. Koşulsuz yazmak o iki arabaya iki
    // ayrı buffer bastırıyordu — bedelsiz bir bölünme, ve kaydırıcıyı
    // sürüyen kullanıcı adım başına bir tane basıyordu.
    node.tiers > 1 ? tierPitchM(node).toFixed(4) : 'x',
    node.castorDiameter,
    node.hasHandle,
    // Eğim tepsileri DÖNDÜRÜYOR — vertex kımıldatan bir alan, ve kat
    // aralığına olan etkisinden AYRI. Aralık değişmese bile tepsinin
    // kendisi başka bir şekil.
    tiltRad(node).toFixed(4),
    detail,
    node.frameColor,
  ].join('|')
}

function buildToteKey(node: ToteCartNode, detail: ToteCartDetail): string {
  return ['tc-tote', node.toteFootprint, toteSizeOf(node).height, detail, node.toteColor].join('|')
}

export function getToteCartFrameGeometry(
  node: ToteCartNode,
  detail: ToteCartDetail,
): THREE.BufferGeometry {
  return getCachedGeometry(toteCartFrameKey(node, detail), () =>
    buildParts(node, toteCartFrameParts(node, detail)),
  )
}

export function getToteGeometry(node: ToteCartNode, detail: ToteCartDetail): THREE.BufferGeometry {
  return getCachedGeometry(toteCartToteKey(node, detail), () =>
    buildParts(node, toteParts(node, detail)),
  )
}

export { releaseGeometry, retainGeometry }

/** Düğüm-nesnesine memoize — bkz. `geometry-key-memo.ts`. */
export const toteCartFrameKey = memoiseGeometryKey(buildFrameKey, (detail) => `f:${detail}`)
export const toteCartToteKey = memoiseGeometryKey(buildToteKey, (detail) => `t:${detail}`)
