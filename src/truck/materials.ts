import type * as THREE from 'three'
import { type Appearance, previewMaterial, surfaceMaterial } from '../appearance'

/**
 * TEK materyal, iki katman — kasten.
 *
 * Uzak katman materyali YOKTUR ve olmayacak: pallet'te uzak katmanın ayrı
 * materyali (`vertexColors` taşımayan) attribute-parite hattının kıyısından
 * döndü — yalnız materyalin geometriyle aynı ifadede takas edilmesi kurtardı.
 * Araçta iki katman aynı attribute kümesini yazar ve aynı materyal örneğini
 * kullanır; T19 bunu referans eşitliğiyle kilitler.
 *
 * Renk vertex'te taşınır (rol paleti), bu yüzden bütün filo tek programla
 * çizilir ve katman geçişi bir uniform yüklemesi bile değildir.
 *
 * "Tek örnek" artık ayar başına tek örnek — bkz. `../appearance`. İki katmanın
 * AYNI örneği paylaşması bozulmuyor: ikisi de aynı `Appearance`'ı okuyor.
 */

const SPEC = {
  family: 'truck',
  vertexColors: true,
  roughness: 0.82,
  metalness: 0.18,
} as const

export function getTruckMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(SPEC, appearance)
}

/** Yerleştirme hayaleti. Paylaşılan örneğin mutasyonu değil, ayrı önbellekli
 *  örnek — şeffaflık sahnedeki her araca sızardı. */
export function getTruckPreviewMaterial(appearance: Appearance): THREE.Material {
  return previewMaterial(SPEC, appearance)
}
