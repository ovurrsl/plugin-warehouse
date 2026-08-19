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

import * as THREE from 'three'
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

function buildStaticKey(node: ConveyorSpiralNode, detail: ConveyorDetail): string {
  return [
    'spiral-static',
    node.outerDiameter,
    node.beltWidth,
    node.travelHeight.toFixed(3),
    node.entryHeight.toFixed(3),
    // Korkuluk jetonu: eğim ve kiralite STATİK'te yalnız korkuluğu kımıldatıyor
    // ve korkuluk tam-katman + hasHandrail kapılı. Kapatınca eski buffer da
    // görünmesin diye tek jetonda topluyorlar.
    detail === 'full' && node.hasHandrail
      ? `h${node.handedness}:${node.inclineDeg.toFixed(2)}`
      : '-',
    node.legColor,
    node.frameColor,
    detail,
  ].join('|')
}

function buildSlatKey(node: ConveyorSpiralNode, detail: ConveyorDetail): string {
  return [
    'spiral-slat',
    node.outerDiameter,
    node.beltWidth,
    node.travelHeight.toFixed(3),
    node.inclineDeg.toFixed(2),
    node.handedness,
    detail,
  ].join('|')
}

export function getSpiralStaticGeometry(
  node: ConveyorSpiralNode,
  detail: ConveyorDetail,
): THREE.BufferGeometry {
  return getCachedGeometry(spiralStaticKey(node, detail), () =>
    buildStatic(node, spiralStaticParts(node, detail)),
  )
}

export function getSpiralSlatGeometry(
  node: ConveyorSpiralNode,
  detail: ConveyorDetail,
): THREE.BufferGeometry {
  return getCachedGeometry(spiralSlatKey(node, detail), () =>
    buildSlats(spiralSlatParts(node, detail)),
  )
}

export { releaseGeometry, retainGeometry }

/** Düğüm-nesnesine memoize — bkz. `geometry-key-memo.ts`. */
export const spiralStaticKey = memoiseGeometryKey(buildStaticKey, (detail) => `s:${detail}`)
export const spiralSlatKey = memoiseGeometryKey(buildSlatKey, (detail) => `l:${detail}`)

/**
 * Merkez kolon — birim silindir, ama renk attribute'u İLE.
 *
 * `getSpiralMaterial` `vertexColors: true` taşıyor (materyalin kendi yorumu
 * kolonu da o listeye yazıyor). Çıplak bir `CylinderGeometry`'de `color`
 * attribute'u yok, ve eksik bir attribute three'de sessizce atlanıyor
 * (`RenderObject.js`: `if (attribute === undefined) continue`). Atlanınca
 * kalan attribute'ların `shaderLocation`'ları bir aşağı kayıyor
 * (`WebGPUAttributeUtils.js`: konum, filtrelenmiş dizinin sıra numarası) ve
 * shader'ın en yüksek girdisi bağsız kalıyor. WebGPU o çizimi reddediyor —
 * ve reddedilen tek çizim KARENİN TAMAMINI düşürüyor, yalnız bu mesh'i değil.
 * Belirtisi, hiç dokunulmamış komşu nesnelerin de bozuk görünmesiydi.
 *
 * Renk düğümün `legColor`'ından geliyor: kolon yapısal, ayaklarla aynı boya.
 * Renk başına bir silindir; kolon sayısı değil, palet boyutu kadar girdi olur.
 * Paylaşılan konveyör havuzuna KOYULMUYOR: burada ömür modül düzeyi ve
 * süpürme yok, yani ekrandaki bir buffer'ın altından çekilmesi mümkün değil.
 */
const columnGeometries = new Map<string, THREE.BufferGeometry>()

export function getSpiralColumnGeometry(legColor: string): THREE.BufferGeometry {
  const cached = columnGeometries.get(legColor)
  if (cached) return cached

  const geometry = new THREE.CylinderGeometry(1, 1, 1, 24, 1)
  const count = geometry.getAttribute('position').count
  const [r, g, b] = toLinear(legColor)
  const colors = new Float32Array(count * 3)
  for (let index = 0; index < count; index++) {
    colors[index * 3] = r
    colors[index * 3 + 1] = g
    colors[index * 3 + 2] = b
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  columnGeometries.set(legColor, geometry)
  return geometry
}
