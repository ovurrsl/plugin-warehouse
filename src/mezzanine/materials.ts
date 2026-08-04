import type * as THREE from 'three'
import { type Appearance, previewMaterial, surfaceMaterial } from '../appearance'

/**
 * Tek materyal, tüm mezzanine'ler — vertex renkleri taşır (rack/telescopic
 * kuralının aynısı): kolon/kiriş `frameColor`, döşeme kendi nötr tonu, hepsi
 * bir vertex-color attribute'unda, tek çizim çağrısı ailesi.
 *
 * Ayarlara uyumu `../appearance` sürüyor; gerekçesi orada.
 */

const SPEC = {
  family: 'mezzanine',
  vertexColors: true,
  metalness: 0.15,
  roughness: 0.55,
} as const

export function getMezzanineMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(SPEC, appearance)
}

/** Yerleştirme hayaleti — ayrı önbelleklenmiş nesne, gerçek materyalin
 *  mutasyonu değil (rack'ın deseni: gerçek materyal modül-tekili, üstüne
 *  `transparent` yazmak sahnedeki her mezzanine'i saydamlaştırırdı). */
export function getMezzaninePreviewMaterial(appearance: Appearance): THREE.Material {
  return previewMaterial(SPEC, appearance)
}
