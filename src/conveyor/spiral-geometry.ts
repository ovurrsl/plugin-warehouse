/**
 * Sarmal geometri — ailenin ORTAK havuzunda (`getCachedGeometry`), şekil başına
 * İKİ birleştirilmiş buffer: STATİK (iskelet) ve SLAT (helis dizisi).
 *
 * ## Anahtarda NE YOK, ve neden (dockleveller/geometry.ts başlığının aynısı)
 *
 * - **`flow`** — hiçbir vertex kımıldatmıyor: yalnız port rolü ve animasyon
 *   yönü. İki anahtarda da yok.
 * - **`loadClass`** — geometriyi ÇÖZÜLMÜŞ değerleriyle (`outerDiameter`,
 *   `beltWidth`) etkiliyor; onların ötesinde bölecek bir şeyi yok, o yüzden
 *   anahtara girmiyor.
 * - **poz / vida fazı** — renderer'ın grup dönüşümü. Buffer'a girmez.
 * - **`hasCage`** — kafes silindir, birleştirilmiş buffer'da değil.
 * - **`entryHeight`** — SLAT buffer'ında yok: slat'lar dinlenme helisinde
 *   (y tabanı 0) inşa edilip renderer'da grup olarak kaldırılıyor. STATİK'te
 *   VAR: ayaklar/güdükler mutlak kotta pişiyor.
 * - **`inclineDeg` / `handedness`** — STATİK'te YALNIZ korkuluğu etkiliyor
 *   (ayaklar/güdükler onları okumuyor), o yüzden STATİK anahtara korkuluk
 *   jetonu üzerinden, tam-katman + `hasHandrail` kapılı giriyorlar
 *   (dl-frame'in `frameHeight`'ı gibi). SLAT'ta koşulsuz — helisi tanımlıyorlar.
 *
 * `spiral.test.ts` iki yönü de (eksik ve aşırı rapor) ölçüyor.
 */

import type * as THREE from 'three'
import { memoiseGeometryKey } from '../geometry-key-memo'
import { PALETTE } from './constants'
import {
  emitPart,
  finish,
  getCachedGeometry,
  releaseGeometry,
  retainGeometry,
  type Sink,
  toLinear,
} from './geometry-builder'
import type { ConveyorDetail } from './parts'
import {
  type SpiralPart,
  type SpiralSlat,
  spiralSlatParts,
  spiralStaticParts,
} from './spiral-parts'
import type { ConveyorSpiralNode } from './spiral-schema'

/** Slat yüzeyi — koyu bant rengi, SABİT (şema alanı değil, yani anahtarda yok). */
const SLAT_COLOR = '#2b2f34'
/** Korkuluk — RAL 1003 sarısı, SABİT. */
const HANDRAIL_COLOR = '#e8b200'

function staticColorOf(node: ConveyorSpiralNode, role: SpiralPart['role']): string {
  switch (role) {
    case 'leg':
      return node.legColor
    case 'footplate':
      return PALETTE.feetGrey
    case 'stub':
      return node.frameColor
    case 'motor':
      return node.frameColor
    case 'handrail':
      return HANDRAIL_COLOR
  }
}

function buildStatic(node: ConveyorSpiralNode, parts: readonly SpiralPart[]): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  for (const part of parts) {
    emitPart(
      sink,
      part,
      toLinear(staticColorOf(node, part.role)),
      0,
      part.rotationY ?? 0,
      part.tiltX ?? 0,
    )
  }
  return finish(sink)
}

function buildSlats(slats: readonly SpiralSlat[]): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  const color = toLinear(SLAT_COLOR)
  for (const slat of slats) {
    emitPart(sink, slat, color, 0, slat.rotationY, slat.tiltX)
  }
  return finish(sink)
}

function buildStaticKey(
  node: ConveyorSpiralNode,
  detail: ConveyorDetail,
  resolvedRise?: number,
): string {
  const travel = (resolvedRise ?? node.travelHeight).toFixed(3)
  return [
    'spiral-static',
    node.outerDiameter,
    node.beltWidth,
    travel,
    node.entryHeight.toFixed(3),
    node.inclineDeg.toFixed(2),
    node.handedness,
    detail === 'full' && node.hasHandrail ? 'hr' : '-',
    node.legColor,
    node.frameColor,
    detail,
  ].join('|')
}

function buildSlatKey(
  node: ConveyorSpiralNode,
  detail: ConveyorDetail,
  resolvedRise?: number,
): string {
  const travel = (resolvedRise ?? node.travelHeight).toFixed(3)
  return [
    'spiral-slat',
    node.outerDiameter,
    node.beltWidth,
    travel,
    node.inclineDeg.toFixed(2),
    node.handedness,
    detail,
  ].join('|')
}

export function getSpiralStaticGeometry(
  node: ConveyorSpiralNode,
  detail: ConveyorDetail,
  resolvedRise?: number,
): THREE.BufferGeometry {
  return getCachedGeometry(spiralStaticKey(node, detail, resolvedRise), () =>
    buildStatic(node, spiralStaticParts(node, detail, resolvedRise)),
  )
}

export function getSpiralSlatGeometry(
  node: ConveyorSpiralNode,
  detail: ConveyorDetail,
  resolvedRise?: number,
): THREE.BufferGeometry {
  return getCachedGeometry(spiralSlatKey(node, detail, resolvedRise), () =>
    buildSlats(spiralSlatParts(node, detail, resolvedRise)),
  )
}

export { releaseGeometry, retainGeometry }

/** Düğüm-nesnesine memoize — bkz. `geometry-key-memo.ts`. */
export const spiralStaticKey = memoiseGeometryKey(
  buildStaticKey,
  (detail, resolvedRise) =>
    `s:${detail}:${resolvedRise !== undefined ? (resolvedRise as number).toFixed(3) : '-'}`,
)
export const spiralSlatKey = memoiseGeometryKey(
  buildSlatKey,
  (detail, resolvedRise) =>
    `l:${detail}:${resolvedRise !== undefined ? (resolvedRise as number).toFixed(3) : '-'}`,
)
