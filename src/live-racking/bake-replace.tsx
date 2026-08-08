'use client'

import { groupByGeometry, makeBakeReplaceRenderer } from '../instancing/bake-replace'
import { getLiveRackingGeometry } from './geometry'
import { getLiveRackingMaterial } from './materials'
import type { LiveRackingNode } from './schema'

/**
 * Baked `/viewer` için canlı raf kanalının kolektif statik çizicisi — rafın
 * muadili.
 *
 * Öteki raf kind'larının bake yolundan tek farkı burada bir komşuluk
 * hesabının OLMAMASI, ve bu bir eksik değil: canlı raf kanalları çerçeve
 * paylaşmıyor, her kanal kendi dört dikmesini taşıyor (`definition.ts`).
 * Dolayısıyla yan yana dizilmiş bir sıranın her kanalı aynı şekle çözülüyor
 * ve sıra tek çizim çağrısına iniyor.
 *
 * Katman hep `full`: bake mesafeye bağlı bir katmanı dosyaya pişirmemeli (dışa
 * aktarım yolunun kuralıyla aynı). Materyal de canlı hâldekinin aynısı —
 * ayarı `useAppearance` üzerinden jenerik çizici veriyor.
 */
export default makeBakeReplaceRenderer<LiveRackingNode>((nodes, appearance) => {
  const material = getLiveRackingMaterial(appearance)
  return groupByGeometry(
    nodes,
    (node) => getLiveRackingGeometry(node, 'full'),
    () => material,
  )
})
