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
    case 'stair-stringer':
      return node.frameColor
    // Döşeme kendi rengini taşımıyor — tek bir nötr ton; hatch2D yalnız 2D
    // planda, 3B'de floorType'a göre renk ayrımı yok.
    case 'floor':
    case 'stair-tread':
      return '#c7ccd1'
    // Korkuluk ve süpürgelik galvaniz — gövde mavisiyle aynı boyada
    // olsaydı, açık kenar uzaktan yapının bir parçası gibi okunurdu.
    case 'railing':
    case 'kickboard':
      return '#b9bfc6'
    // Kapı sarısı: güvenlik donanımının rengi keyfî değil, standardın
    // kendisi (teleskopik konveyörün `hazard` rolüyle aynı gerekçe).
    case 'gate':
      return '#f2c200'
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
 *
 * Aksesuarlar anahtara TAM olarak girer: bir kapının yeri korkulukta bir
 * açıklık, bir merdivenin yeri döşemede bir boşluk demek — ikisi de şekil.
 * Bunu unutmak, `hasGroundBeam`'in bir kez düştüğü hata sınıfı (bir alan
 * geometriyi değiştirir ama anahtarda yoktur, ve ekranda eski mesh kalır).
 */
export function mezzanineGeometryKey(node: MezzanineNode): string {
  const tierKey = node.tiers
    .map((t) => {
      const stairs = t.accessories.staircases
        .map((s) =>
          s.placement.mode === 'edge'
            ? `E${s.placement.edge}${s.placement.offsetM}w${s.widthM}l${s.landing}s${s.steps}`
            : `X${s.placement.xM},${s.placement.zM},${s.placement.rotationDeg}w${s.widthM}l${s.landing}s${s.steps}`,
        )
        .join(';')
      const gates = [
        ...t.accessories.swingGates.map((g) => `S${g.edge}${g.offsetM}w${g.widthM}`),
        ...t.accessories.upAndOverGates.map((g) => `U${g.edge}${g.offsetM}w${g.widthM}`),
        ...t.accessories.safetyZones.map((z) => `Z${z.edge}${z.offsetM}w${z.widthM}`),
      ].join(';')
      return `${t.index}:${t.elevationM}:${t.clearHeightM}:${t.floorType}:${stairs}:${gates}`
    })
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
