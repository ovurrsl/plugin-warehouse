'use client'

import { groupByGeometry, makeBakeReplaceRenderer } from '../instancing/bake-replace'
import { getLiveRackingGeometry } from './geometry'
import { getLiveRackingMaterial } from './materials'
import { hasRightNeighbour } from './neighbours'
import type { LiveRackingNode } from './schema'

/**
 * Baked `/viewer` için canlı raf kanalının kolektif statik çizicisi — rafın
 * muadili.
 *
 * Komşuluk bake'te de aynı kaynaktan: seviyenin kanal listesi bir kayda
 * dönüştürülüp `hasRightNeighbour`'ın kendisine veriliyor. Bunu atlayıp her
 * kanala kendi sağ çerçevesini kurdurmak baked görünümde her ek yerine iki sıra
 * dikme koyardı — editörün çözdüğü çift-dikme z-fighting'inin bake'e sızmış
 * hâli, ve orada düzeltilecek bir yeri yok.
 *
 * Katman hep `full`: bake mesafeye bağlı bir katmanı dosyaya pişirmemeli (dışa
 * aktarım yolunun kuralıyla aynı). Materyal de canlı hâldekinin aynısı —
 * ayarı `useAppearance` üzerinden jenerik çizici veriyor.
 */
export default makeBakeReplaceRenderer<LiveRackingNode>((nodes, appearance) => {
  const record: Record<string, unknown> = {}
  for (const node of nodes) record[node.id] = node
  const material = getLiveRackingMaterial(appearance)
  return groupByGeometry(
    nodes,
    (node) =>
      getLiveRackingGeometry(node, 'full', { omitRight: hasRightNeighbour(record, node.id) }),
    () => material,
  )
})
