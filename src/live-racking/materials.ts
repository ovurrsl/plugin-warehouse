import * as THREE from 'three'

/** Tek materyal, tüm canlı raflar — renkler vertex attribute'unda. */

let cached: THREE.MeshStandardMaterial | null = null
let cachedPreview: THREE.MeshStandardMaterial | null = null

export function getLiveRackingMaterial(): THREE.MeshStandardMaterial {
  if (cached) return cached
  cached = new THREE.MeshStandardMaterial({
    vertexColors: true,
    // Boyalı çelik: selective rafın değerleriyle aynı, çünkü aynı boya.
    metalness: 0.15,
    roughness: 0.55,
  })
  return cached
}

/** Yerleştirme hayaleti — ayrı önbellek, gerçek materyalin mutasyonu değil
 *  (modül tekilinin üstüne `transparent` yazmak sahnedeki her rafı
 *  saydamlaştırırdı). */
export function getLiveRackingPreviewMaterial(): THREE.MeshStandardMaterial {
  if (cachedPreview) return cachedPreview
  cachedPreview = getLiveRackingMaterial().clone()
  cachedPreview.transparent = true
  cachedPreview.opacity = 0.55
  cachedPreview.depthWrite = false
  return cachedPreview
}
