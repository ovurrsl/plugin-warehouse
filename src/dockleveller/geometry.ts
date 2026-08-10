/**
 * Yükleme rampası geometrisi — ailenin ORTAK havuzunda, ÜÇ şekil.
 *
 * Anahtarlarda `inclination` YOK ve olmaması bu kind'ın bütün mesele:
 * eğim bir POZ, bir şekil değil. Anahtara girseydi kaydırıcının her adımı
 * yeni bir merged buffer bastırırdı ve bir kapıyı ayarlayan kullanıcı
 * saniyede onlarca şekil üretirdi. Hareketi renderer'ın grup dönüşümleri
 * taşıyor.
 *
 * Aynı sebeple `lipExtension` de yok: dudak tam boyunda inşa ediliyor,
 * uzanım grubun X ötelemesi.
 *
 * Anahtarda OLMASI gereken şey, mesh'i gerçekten değiştiren her alan —
 * ve yalnız o. `dockleveller.test.ts` iki yönü de ölçüyor.
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
import { lipFullLengthM } from './metrics'
import {
  type DockLevellerDetail,
  type DockLevellerPart,
  dockLevellerDeckParts,
  dockLevellerFrameParts,
  dockLevellerLipParts,
} from './parts'
import type { DockLevellerNode } from './schema'

function colorOf(node: DockLevellerNode, role: DockLevellerPart['role']): string {
  switch (role) {
    case 'frame':
      return node.frameColor
    case 'deck':
      return node.deckColor
    case 'guard':
      return PALETTE.guard
    case 'bumper':
      return PALETTE.bumper
    case 'control':
      return PALETTE.control
    case 'estop':
      return PALETTE.estop
  }
}

function buildParts(
  node: DockLevellerNode,
  parts: readonly DockLevellerPart[],
): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  for (const part of parts) {
    emitPart(sink, part, toLinear(colorOf(node, part.role)), 0)
  }
  return finish(sink)
}

function buildFrameKey(node: DockLevellerNode, detail: DockLevellerDetail): string {
  const full = detail === 'full'
  return [
    'dl-frame',
    node.width,
    node.length,
    // Çukur astarı yalnız yakın katmanda üretiliyor — uzakta zaten döşemenin
    // içinde ve görünmez. Orada çerçeve yüksekliği hiçbir vertex
    // kımıldatmıyor, yani anahtara girmesi paylaşımı bedelsiz bölerdi.
    // Kapsama testi bunu ilk koşuda yakaladı.
    full ? node.frameHeight : 'x',
    node.hasBumpers,
    node.hasControlPost,
    detail,
    node.frameColor,
  ].join('|')
}

function buildDeckKey(node: DockLevellerNode, detail: DockLevellerDetail): string {
  // `frameColor` DA giriyor: nervürler çerçeve rengini taşıyor ve yalnız
  // yakın katmanda üretiliyorlar — o yüzden katmana kapılı. Uzak katmanda
  // çerçeve rengi tablanın hiçbir vertex'ini kımıldatmıyor ve anahtarı
  // bölmesi bedelsiz bir bölünme olurdu.
  return [
    'dl-deck',
    node.width,
    node.length,
    detail,
    node.deckColor,
    detail === 'full' ? node.frameColor : 'x',
  ].join('|')
}

function buildLipKey(node: DockLevellerNode, detail: DockLevellerDetail): string {
  // ÇÖZÜLMÜŞ tam boy, ham alanlar değil: teleskopik bir dudakta `lipLength`
  // hiç okunmuyor, menteşelide `lip` tipi tek başına bir şey söylemiyor.
  // İkisi de aynı tam boya çözülürse mesh'leri birebir aynıdır.
  return ['dl-lip', node.width, lipFullLengthM(node).toFixed(4), detail, node.deckColor].join('|')
}

export function getDockLevellerFrameGeometry(
  node: DockLevellerNode,
  detail: DockLevellerDetail,
): THREE.BufferGeometry {
  return getCachedGeometry(dockLevellerFrameKey(node, detail), () =>
    buildParts(node, dockLevellerFrameParts(node, detail)),
  )
}

export function getDockLevellerDeckGeometry(
  node: DockLevellerNode,
  detail: DockLevellerDetail,
): THREE.BufferGeometry {
  return getCachedGeometry(dockLevellerDeckKey(node, detail), () =>
    buildParts(node, dockLevellerDeckParts(node, detail)),
  )
}

export function getDockLevellerLipGeometry(
  node: DockLevellerNode,
  detail: DockLevellerDetail,
): THREE.BufferGeometry {
  return getCachedGeometry(dockLevellerLipKey(node, detail), () =>
    buildParts(node, dockLevellerLipParts(node, detail)),
  )
}

export { releaseGeometry, retainGeometry }

/** Düğüm-nesnesine memoize — bkz. `geometry-key-memo.ts`. */
export const dockLevellerFrameKey = memoiseGeometryKey(buildFrameKey, (detail) => `f:${detail}`)
export const dockLevellerDeckKey = memoiseGeometryKey(buildDeckKey, (detail) => `d:${detail}`)
export const dockLevellerLipKey = memoiseGeometryKey(buildLipKey, (detail) => `l:${detail}`)
