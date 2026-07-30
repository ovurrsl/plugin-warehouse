import * as THREE from 'three'

/**
 * Tek materyal, tüm mezzanine'ler — vertex renkleri taşır (rack/telescopic
 * kuralının aynısı): kolon/kiriş `frameColor`, döşeme kendi nötr tonu, hepsi
 * bir vertex-color attribute'unda, tek çizim çağrısı ailesi.
 */

let cachedMaterial: THREE.MeshStandardMaterial | null = null
let cachedPreviewMaterial: THREE.MeshStandardMaterial | null = null

export function getMezzanineMaterial(): THREE.MeshStandardMaterial {
  if (cachedMaterial) return cachedMaterial
  cachedMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: 0.15,
    roughness: 0.55,
  })
  return cachedMaterial
}

/** Yerleştirme hayaleti — ayrı önbelleklenmiş nesne, gerçek materyalin
 *  mutasyonu değil (rack'ın deseni: gerçek materyal modül-tekili, üstüne
 *  `transparent` yazmak sahnedeki her mezzanine'i saydamlaştırırdı). */
export function getMezzaninePreviewMaterial(): THREE.MeshStandardMaterial {
  if (cachedPreviewMaterial) return cachedPreviewMaterial
  cachedPreviewMaterial = getMezzanineMaterial().clone()
  cachedPreviewMaterial.transparent = true
  cachedPreviewMaterial.opacity = 0.55
  cachedPreviewMaterial.depthWrite = false
  return cachedPreviewMaterial
}
