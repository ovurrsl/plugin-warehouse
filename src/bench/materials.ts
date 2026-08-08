import type * as THREE from 'three'
import { type Appearance, previewMaterial, surfaceMaterial } from '../appearance'

/** Tek materyal, tüm tezgâhlar — renkler vertex attribute'unda. Ayarlara
 *  uyumu `../appearance` sürüyor; aile × ayar başına tek örnek. */
const SPEC = {
  family: 'bench',
  vertexColors: true,
  // Boyalı çelik ile ahşabın ortası: tabla mat, çerçeve hafif parlak. Tek
  // materyalden çizildikleri için ikisinin ortası seçildi — ayrı materyal
  // vermek ailenin tek-çizim-çağrısı düzenini bozardı.
  metalness: 0.1,
  roughness: 0.6,
} as const

export function getBenchMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(SPEC, appearance)
}

/** Yerleştirme hayaleti — ayrı önbellek, gerçek materyalin mutasyonu değil. */
export function getBenchPreviewMaterial(appearance: Appearance): THREE.Material {
  return previewMaterial(SPEC, appearance)
}
