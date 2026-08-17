import * as THREE from 'three'
import { type Appearance, previewMaterial, surfaceMaterial } from '../appearance'

/**
 * Sarmal konveyörün boyası — boyalı makine çeliği (roller çinkosu DEĞİL).
 *
 * Parça renkleri vertex-renk attribute'unda: kolon, ayaklar, güdükler ve
 * korkuluk tek materyalden çiziliyor. `metalness 0.25 / roughness 0.6` boyalı
 * gövde için; roller ailesinin çıplak çinkosunun düşük roughness'ı burada
 * yanlış olurdu.
 */
const SPIRAL_SPEC = {
  family: 'conveyor-spiral',
  vertexColors: true,
  roughness: 0.6,
  metalness: 0.25,
} as const

export function getSpiralMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(SPIRAL_SPEC, appearance)
}

export function getSpiralPreviewMaterial(appearance: Appearance): THREE.Material {
  return previewMaterial(SPIRAL_SPEC, appearance)
}

/**
 * Güvenlik kafesi — yarı saydam sarı silindir (spec §2 satır 6, ~%25 opaklık).
 *
 * Ayrı `family` ŞART: `surfaceMaterial` aileye göre önbelleğe alıyor, aynı
 * aileyi paylaşan bir kafes gövdenin opak materyalini ezerdi. `transparent`,
 * `opacity` ve `depthWrite` her modda korunuyor (`appearance.ts` `invariantOf`
 * bunları geçiriyor); `DoubleSide` silindirin iç ve dış yüzünü de çizsin diye,
 * yoksa saydam kafes tek yüz olarak yarım görünürdü.
 */
const SPIRAL_CAGE_SPEC = {
  family: 'conveyor-spiral-cage',
  // Yıkanmış RAL 1003 sarısı — mal değil koruma okunsun diye.
  color: '#f2d04a',
  transparent: true,
  opacity: 0.25,
  depthWrite: false,
  side: THREE.DoubleSide,
} as const

export function getSpiralCageMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(SPIRAL_CAGE_SPEC, appearance)
}
