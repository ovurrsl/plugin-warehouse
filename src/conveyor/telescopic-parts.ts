/**
 * Teleskopik konveyör parçaları — sabit gövde + bölüm başına ayrı liste.
 *
 * Bölümler ayrı gövdelerdir (aracın mast dersinin aynısı): vertex'ler
 * dinlenme pozunda yazılır, uzama renderer'da grup X ötelemesidir — bir
 * uzama sürüklemesi cache'e yeni buffer bastırmaz.
 *
 * Renk rolleri ailenin rolleridir; `frame` düğümün aile-mavisi rengini,
 * `deck` bant rengini giyer — teleskopik, roller hattıyla aynı boyayı
 * paylaşır (kullanıcı kararı).
 */

import type { ConveyorDetail } from './parts'
import { beltWidthM, boomSections, frameWidthM, telescopicModelOf } from './telescopic-metrics'
import type { ConveyorTelescopicNode } from './telescopic-schema'

export type TelescopicPartRole = 'frame' | 'deck' | 'leg' | 'footplate' | 'guide' | 'motor'

export type TelescopicPart = {
  role: TelescopicPartRole
  center: readonly [number, number, number]
  size: readonly [number, number, number]
}

/**
 * Sabit kısım: bacaklı gövde, bant yüzeyi, yan korkuluklar, motor.
 *
 * Bant üstü = model.heightM ("Fixed Type" — kot modelindir); gövde kirişi
 * onun hemen altında. Bacaklar iki uçta çift, taban plakalı.
 */
export function telescopicBaseParts(
  node: ConveyorTelescopicNode,
  detail: ConveyorDetail,
): TelescopicPart[] {
  const model = telescopicModelOf(node.model)
  const a = model.fixedM
  const halfA = a / 2
  const topY = model.heightM
  const frame = frameWidthM(node)
  const belt = beltWidthM(node)
  const parts: TelescopicPart[] = []

  // Gövde kirişi: bandın altındaki taşıyıcı kutu — teleskopun yuvası.
  const beamDepth = 0.22 + 0.045 * (model.sections - 1) // her kademe bir yuva katı
  parts.push({
    role: 'frame',
    center: [0, topY - 0.02 - beamDepth / 2, 0],
    size: [a, beamDepth, frame],
  })
  // Bant yüzeyi.
  parts.push({
    role: 'deck',
    center: [0, topY - 0.01, 0],
    size: [a - 0.05, 0.02, belt],
  })
  if (detail === 'full') {
    // Yan korkuluk profilleri + tahrik/motor kutusu + kuyruk tamburu.
    for (const side of [-1, 1] as const) {
      parts.push({
        role: 'guide',
        center: [0, topY + 0.05, side * (frame / 2 - 0.02)],
        size: [a - 0.02, 0.1, 0.03],
      })
    }
    parts.push({
      role: 'motor',
      center: [-halfA + 0.35, topY - beamDepth - 0.14, 0],
      size: [0.5, 0.28, belt * 0.6],
    })
    parts.push({
      role: 'frame',
      center: [-halfA + 0.06, topY - 0.09, 0],
      size: [0.12, 0.2, frame],
    })
  }
  // Bacaklar: iki uçta çift + uzun modellerde orta destek. Taban plakaları.
  const legXs = a > 7 ? [-halfA + 0.4, 0, halfA - 0.4] : [-halfA + 0.4, halfA - 0.4]
  for (const x of legXs) {
    for (const side of [-1, 1] as const) {
      const z = side * (frame / 2 - 0.06)
      parts.push({
        role: 'leg',
        center: [x, (topY - 0.12) / 2, z],
        size: [0.08, topY - 0.12, 0.08],
      })
      if (detail === 'full') {
        parts.push({ role: 'footplate', center: [x, 0.006, z], size: [0.16, 0.012, 0.16] })
      }
    }
    // Bacak çifti arası travers.
    parts.push({
      role: 'leg',
      center: [x, 0.3, 0],
      size: [0.06, 0.08, frame - 0.12],
    })
  }
  return parts
}

/**
 * Bir kayan bölüm — KENDİ yerel çerçevesinde (merkez origin'de, dinlenme).
 * Renderer bölüm grubunu `centerX`'e taşır; uzama vertex'lere hiç girmez.
 */
export function telescopicSectionParts(
  node: ConveyorTelescopicNode,
  sectionIndex: number,
  detail: ConveyorDetail,
): TelescopicPart[] {
  const model = telescopicModelOf(node.model)
  const sections = boomSections({ ...node, extension: 0 })
  const section = sections[sectionIndex - 1]
  if (!section) return []
  const topY = model.heightM - section.dropM
  const width = section.widthM
  const length = section.lengthM
  const parts: TelescopicPart[] = []

  // Bölüm gövdesi: yanlardan taşıyan iki profil + bant şeridi.
  for (const side of [-1, 1] as const) {
    parts.push({
      role: 'frame',
      center: [0, topY - 0.06, side * (width / 2 - 0.025)],
      size: [length, 0.12, 0.05],
    })
  }
  parts.push({
    role: 'deck',
    center: [0, topY - 0.005, 0],
    size: [length - 0.04, 0.014, width - 0.12],
  })
  if (detail === 'full') {
    // Burun tamburu — yük araca buradan iner.
    parts.push({
      role: 'frame',
      center: [length / 2 - 0.03, topY - 0.05, 0],
      size: [0.06, 0.1, width - 0.1],
    })
    // Alt kızak.
    parts.push({
      role: 'frame',
      center: [0, topY - 0.14, 0],
      size: [length - 0.1, 0.03, width - 0.2],
    })
  }
  return parts
}
