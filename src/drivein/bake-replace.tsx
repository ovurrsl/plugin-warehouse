'use client'

import { groupByGeometry, makeBakeReplaceRenderer } from '../instancing/bake-replace'
import { getRackMaterial } from '../rack/materials'
import { getDriveInGeometry } from './geometry-builder'
import { hasRightNeighbour } from './neighbours'
import type { DriveInRackNode } from './schema'

/**
 * Baked `/viewer` için şeridin kolektif statik çizicisi — rafın muadili.
 *
 * Komşuluk bake'te de aynı kaynaktan: seviyenin şerit listesi bir kayda
 * dönüştürülüp `hasRightNeighbour`'ın kendisine veriliyor. Bunu atlayıp her
 * şeride kendi sağ çerçevesini kurdurmak baked görünümde her dikişe iki sıra
 * dikme koyardı — editörün çözdüğü çift-dikme z-fighting'inin bake'e sızmış
 * hâli, ve orada düzeltilecek bir yeri yok.
 *
 * Katman hep `full`: bake mesafeye bağlı bir katmanı dosyaya pişirmemeli (dışa
 * aktarım yolunun kuralıyla aynı). Materyal de rafın materyali — canlı
 * hâldeki gibi, iki kind tek shader ve tek havuz paylaşıyor.
 */
export default makeBakeReplaceRenderer<DriveInRackNode>((nodes, appearance) => {
  const record: Record<string, unknown> = {}
  for (const node of nodes) record[node.id] = node
  const material = getRackMaterial(appearance)
  return groupByGeometry(
    nodes,
    (node) => getDriveInGeometry(node, 'full', { omitRight: hasRightNeighbour(record, node.id) }),
    () => material,
  )
})
