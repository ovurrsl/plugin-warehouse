import type * as THREE from 'three'
import { type Appearance, previewMaterial, surfaceMaterial } from '../appearance'

/** Tek materyal, tüm canlı raflar — renkler vertex attribute'unda. Ayarlara
 *  uyumu `../appearance` sürüyor. */

const SPEC = {
  family: 'live-racking',
  vertexColors: true,
  // Boyalı çelik: selective rafın değerleriyle aynı, çünkü aynı boya.
  metalness: 0.15,
  roughness: 0.55,
} as const

export function getLiveRackingMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(SPEC, appearance)
}

/** Yerleştirme hayaleti — ayrı önbellek, gerçek materyalin mutasyonu değil
 *  (modül tekilinin üstüne `transparent` yazmak sahnedeki her rafı
 *  saydamlaştırırdı). */
export function getLiveRackingPreviewMaterial(appearance: Appearance): THREE.Material {
  return previewMaterial(SPEC, appearance)
}
