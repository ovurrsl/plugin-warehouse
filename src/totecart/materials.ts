import type * as THREE from 'three'
import { type Appearance, previewMaterial, surfaceMaterial } from '../appearance'

/**
 * Tek materyal, iki gövde — renkler vertex attribute'unda.
 *
 * Ne raf gibi boyalı çelik (0.15 / 0.55) ne konveyör gibi çinko
 * (0.55 / 0.38): arabanın görünen yüzeyinin çoğu PLASTİK kasa. Metaliklik
 * bu yüzden düşük, pürüzlülük yüksek — ve tek materyalden çizildikleri
 * için çerçevenin galvanizi de o değerleri giyiyor. Ayrı materyal vermek
 * ailenin tek-çizim-çağrısı düzenini bozardı ve arabanın çoğu plastik.
 */
const SPEC = {
  family: 'totecart',
  vertexColors: true,
  metalness: 0.15,
  roughness: 0.65,
} as const

export function getToteCartMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(SPEC, appearance)
}

/** Yerleştirme hayaleti — ayrı önbellek, gerçek materyalin mutasyonu değil. */
export function getToteCartPreviewMaterial(appearance: Appearance): THREE.Material {
  return previewMaterial(SPEC, appearance)
}
