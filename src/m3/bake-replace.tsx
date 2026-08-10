'use client'

import { groupByGeometry, makeBakeReplaceRenderer } from '../instancing/bake-replace'
import { getRackMaterial } from '../rack/materials'
import { getM3Geometry } from './geometry-builder'
import { hasRightNeighbour } from './neighbours'
import type { M3ShelvingNode } from './schema'

/**
 * Baked `/viewer` için M3 bay'inin kolektif statik çizicisi — rafın muadili.
 *
 * Komşuluk bake'te de aynı kaynaktan: seviyenin bay listesi bir kayda
 * dönüştürülüp `hasRightNeighbour`'ın kendisine veriliyor. Bunu atlayıp her
 * bay'e kendi sağ çerçevesini kurdurmak baked görünümde her dikişe iki sıra
 * dikme koyardı — editörün çözdüğü çift-dikme z-fighting'inin bake'e sızmış
 * hâli, ve orada düzeltilecek bir yeri yok.
 *
 * Katman hep `full`: bake mesafeye bağlı bir katmanı dosyaya pişirmemeli (dışa
 * aktarım yolunun kuralıyla aynı). Materyal de rafın materyali — canlı
 * hâldeki gibi, dört raf kind'ı tek shader ve tek havuz paylaşıyor.
 */
export default makeBakeReplaceRenderer<M3ShelvingNode>((nodes, appearance) => {
  const record: Record<string, unknown> = {}
  for (const node of nodes) record[node.id] = node
  const material = getRackMaterial(appearance)
  return groupByGeometry(
    nodes,
    (node) => getM3Geometry(node, 'full', { omitRight: hasRightNeighbour(record, node.id) }),
    () => material,
  )
})
