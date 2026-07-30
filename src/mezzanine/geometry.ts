/**
 * Mezzanine geometrisi — ailenin ORTAK havuzunda (`getCachedGeometry`,
 * `../conveyor/geometry-builder`'ın jenerik motoru — telescopic'in de
 * paylaştığı, tamamen jenerik kutu-emisyon fonksiyonları; ikinci bir
 * eviction/retain kopyası yazmaktan kaçınmak için).
 *
 * Rack'ın aksine, mezzanine'in tier'leri ANİMASYONLU DEĞİL — bir tier'in
 * kotu yalnız panelden düzenlendiğinde değişir, telescopic'in `extension`'ı
 * gibi her karede kaymaz. Bu yüzden mutlak Y konumları doğrudan vertex'lere
 * yazılır (rack'ın kendisi gibi TEK birleşik mesh) — telescopic'in
 * bölüm-başına-grup + öteleme deseni burada gereksiz karmaşıklık olurdu.
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
import { type MezzaninePart, mezzanineParts } from './parts'
import type { MezzanineNode } from './schema'

function colorOf(node: MezzanineNode, role: MezzaninePart['role']): string {
  switch (role) {
    case 'column':
    case 'main-beam':
    case 'secondary-beam':
      return node.frameColor
    // Döşeme kendi rengini taşımıyor — Faz 1'de tek bir nötr ton; hatch2D
    // yalnız 2D planda (Faz 3), 3B'de floorType'a göre renk ayrımı yok.
    case 'floor':
      return '#c7ccd1'
  }
}

function buildParts(node: MezzanineNode, parts: readonly MezzaninePart[]): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  for (const part of parts) {
    emitPart(sink, part, toLinear(colorOf(node, part.role)), 0)
  }
  return finish(sink)
}

/**
 * Şekli GERÇEKTEN belirleyen her girdi — `loadClass` hariç: yalnız kapasite
 * metadata'sı, geometriye hiç girmez (kapı testiyle aynı ayrım).
 */
export function mezzanineGeometryKey(node: MezzanineNode): string {
  const tierKey = node.tiers
    .map((t) => `${t.index}:${t.elevationM}:${t.clearHeightM}:${t.floorType}`)
    .join(',')
  return [
    'mezz',
    node.constructiveSystem,
    node.grid.baysX,
    node.grid.baysY,
    node.grid.bayWidthM,
    node.grid.bayDepthM,
    node.columnType,
    node.mainBeamProfile ?? '',
    node.secondaryBeamProfile ?? '',
    node.columnProfile ?? '',
    node.frameColor,
    tierKey,
  ].join('|')
}

export function getMezzanineGeometry(node: MezzanineNode): THREE.BufferGeometry {
  return getCachedGeometry(mezzanineGeometryKey(node), () => buildParts(node, mezzanineParts(node)))
}

export { releaseGeometry, retainGeometry }
