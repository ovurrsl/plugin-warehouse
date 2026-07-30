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

export type TelescopicPartRole =
  | 'frame'
  | 'deck'
  | 'leg'
  | 'footplate'
  | 'guide'
  | 'motor'
  | 'rail'
  | 'console'
  | 'estop'
  | 'hazard'
  | 'lamp-housing'

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
    // Kuyruk ucunda acil stop mantarı — operatörün besleme tarafındaki eli.
    parts.push({
      role: 'estop',
      center: [-halfA + 0.14, topY + 0.16, frame / 2 - 0.06],
      size: [0.1, 0.1, 0.08],
    })
    // Kuyruk ikaz bandı: sarı-siyah şeridin gövde ucundaki karşılığı.
    parts.push({
      role: 'hazard',
      center: [-halfA + 0.02, topY - beamDepth / 2, 0],
      size: [0.04, beamDepth * 0.7, frame - 0.06],
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
    // Kayma önleyici yan korkuluklar — her bölümde, bölüm boyunca.
    for (const side of [-1, 1] as const) {
      parts.push({
        role: 'rail',
        center: [0, topY + 0.07, side * (width / 2 - 0.02)],
        size: [length - 0.06, 0.09, 0.025],
      })
    }
  }

  // ── Burun donanımı: YALNIZ en uçtaki bölümde ────────────────────────────
  // Operatör bu uçta durur; kumanda, lamba ve acil stop oradadır. Her
  // bölüme koymak makineyi beş kumandalı bir şeye çevirirdi.
  const isNose = sectionIndex === model.sections - 1
  if (isNose && detail === 'full') {
    const noseX = length / 2
    // Kumanda konsolu — yan tarafta, bel hizasında bir kutu + kol.
    parts.push({
      role: 'console',
      center: [noseX - 0.3, topY + 0.24, width / 2 + 0.06],
      size: [0.26, 0.2, 0.1],
    })
    parts.push({
      role: 'frame',
      center: [noseX - 0.3, topY + 0.08, width / 2 + 0.05],
      size: [0.05, 0.24, 0.05],
    })
    // Acil stop mantarı, konsolun üstünde.
    parts.push({
      role: 'estop',
      center: [noseX - 0.3, topY + 0.36, width / 2 + 0.06],
      size: [0.08, 0.06, 0.08],
    })
    // Çalışma lambası: gövde + mercek. Mercek kendi materyalini alır
    // (yayıcı) — makinenin karanlık dorse içini aydınlatan parçası.
    parts.push({
      role: 'frame',
      center: [noseX - 0.16, topY + 0.42, -width / 2 - 0.04],
      size: [0.05, 0.3, 0.05],
    })
    parts.push({
      role: 'lamp-housing',
      center: [noseX - 0.16, topY + 0.58, -width / 2 - 0.04],
      size: [0.14, 0.12, 0.14],
    })
    // Burun ikaz bandı — çarpma riski en yüksek nokta.
    parts.push({
      role: 'hazard',
      center: [noseX + 0.01, topY - 0.05, 0],
      size: [0.03, 0.12, width - 0.08],
    })
  }
  return parts
}
