'use client'

import { groupByGeometry, makeBakeReplaceRenderer } from '../instancing/bake-replace'
import { getRackGeometry } from './geometry-builder'
import { getRackMaterial } from './materials'
import { hasRightNeighbour } from './neighbours'
import type { PalletRackNode } from './schema'

/**
 * Baked `/viewer` için rafın kolektif statik çizicisi.
 *
 * Komşuluk bake'te de aynı kaynaktan: seviyenin raf listesi bir kayda
 * dönüştürülüp `hasRightNeighbour`'ın kendisine veriliyor — dikme paylaşımı
 * baked görünümde de korunuyor, editörün çözdüğü çift-dikme z-fighting'i
 * geri gelmiyor. Katman hep `full`: bake mesafeye bağlı bir katmanı dosyaya
 * pişirmemeli (dışa aktarım yolunun kuralıyla aynı).
 */
export default makeBakeReplaceRenderer<PalletRackNode>((nodes, appearance) => {
  const record: Record<string, unknown> = {}
  for (const node of nodes) record[node.id] = node
  const material = getRackMaterial(appearance)
  return groupByGeometry(
    nodes,
    (node) => getRackGeometry(node, 'full', hasRightNeighbour(record, node.id)),
    () => material,
  )
})
