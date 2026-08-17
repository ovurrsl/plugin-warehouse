import type * as THREE from 'three'
import { type Appearance, previewMaterial, surfaceMaterial } from '../appearance'

/**
 * Palet asansörünün boyası — tek materyal, renkler vertex attribute'unda.
 *
 * Boyalı makine çeliği (rampa gibi 0.45/0.55): mast, platform sacı, tahrik
 * gövdesi ve kapılar boyalı profil; roller ailesinin çıplak çinkosunun düşük
 * roughness'ı burada yanlış olurdu.
 */
const PALLETLIFT_SPEC = {
  family: 'pallet-lift',
  vertexColors: true,
  metalness: 0.45,
  roughness: 0.55,
} as const

export function getPalletLiftMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(PALLETLIFT_SPEC, appearance)
}

/** Yerleştirme hayaleti — ayrı önbellek, gerçek materyalin mutasyonu değil. */
export function getPalletLiftPreviewMaterial(appearance: Appearance): THREE.Material {
  return previewMaterial(PALLETLIFT_SPEC, appearance)
}

/**
 * Güvenlik muhafazası — yarı saydam gri (spec §2 satır 7, ~%30 opaklık).
 *
 * AYRI `family` ŞART: `surfaceMaterial` aileye göre önbelleğe alıyor, aynı
 * aileyi paylaşan bir muhafaza gövdenin opak materyalini ezerdi. `transparent`,
 * `opacity` ve `depthWrite` her modda korunuyor (`appearance.ts invariantOf`).
 */
const LIFT_ENCLOSURE_SPEC = {
  family: 'pallet-lift-enclosure',
  color: '#9aa3ab',
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
} as const

export function getPalletLiftEnclosureMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(LIFT_ENCLOSURE_SPEC, appearance)
}
