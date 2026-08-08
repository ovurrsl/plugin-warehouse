import type * as THREE from 'three'
import { type Appearance, previewMaterial, surfaceMaterial } from '../appearance'

/**
 * Tek materyal, üç gövde — renkler vertex attribute'unda.
 *
 * Rafın boyalı çeliğinden (0.15 / 0.55) daha metalik: rampanın görünen
 * yüzeyi galvaniz gözyaşı sac ve kauçuk tampon, boyalı profil değil. Konveyör
 * ailesinin çinko makarasına (0.55 / 0.38) yakın ama ondan biraz mat —
 * üstünden forklift geçen bir sac parlak kalmıyor.
 */
const SPEC = {
  family: 'dockleveller',
  vertexColors: true,
  metalness: 0.45,
  roughness: 0.55,
} as const

export function getDockLevellerMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(SPEC, appearance)
}

/** Yerleştirme hayaleti — ayrı önbellek, gerçek materyalin mutasyonu değil. */
export function getDockLevellerPreviewMaterial(appearance: Appearance): THREE.Material {
  return previewMaterial(SPEC, appearance)
}
