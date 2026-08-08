import type * as THREE from 'three'
import { type Appearance, previewMaterial, surfaceMaterial } from '../appearance'
import { getConveyorTexture } from './conveyor-texture'

/**
 * One material for every conveyor in the scene.
 *
 * Part colours ride in the geometry's vertex colour attribute, so blue frames,
 * zinc rollers and white motor housings all draw from this single instance —
 * the same arrangement the rack uses, and for the same reason its own file
 * records: an inline material per part meant a ten-bay rack minted about two
 * hundred and fifty of them and a warehouse minted hundreds of thousands, each
 * one a separate uniform upload and none of them ever disposed.
 *
 * **Its own material rather than the rack's**, and the difference is not
 * cosmetic. The rack is powder-coated painted steel at `metalness 0.15,
 * roughness 0.55`, values chosen after `0.75` rendered near-black for want of
 * an environment map to reflect. A conveyor's rollers are bright bare zinc.
 * Sharing one material to save a shader compile would make one of the two
 * wrong, and the one it would make wrong is the one this kind is mostly made
 * of.
 *
 * Bu ayrım `rendered` modda ifade edilebiliyor ve orada korunuyor. `solid`'de
 * Lambert'in pürüzlülüğü ve metalikliği yok, yani zinc-boya farkı düşüyor —
 * host'un kendi metallerine olan da bu, ve modun anlamı zaten o. Kayıp burada
 * yazılı ki biri sonradan sahte bir parlaklık ekleyerek "düzeltmesin".
 */

function spec() {
  return {
    family: 'conveyor',
    // A two-column atlas: blank for the steelwork, a roller stripe for the bed.
    // The geometry picks a column per part through its UVs, which is what lets
    // eight thousand rollers exist without a second material — and so without a
    // second draw call on every module in the building.
    map: getConveyorTexture(),
    vertexColors: true,
    // Between the rack's painted steel and a mirror: galvanised roller shells
    // and mill-finish profiles, which read as metal but are far from polished.
    metalness: 0.55,
    roughness: 0.38,
  }
}

export function getConveyorMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(spec(), appearance)
}

/**
 * The ghost shown while placing. A separate cached instance rather than a
 * mutated clone: the real material is a module singleton, so setting
 * `transparent` on it would make every committed conveyor in the scene
 * translucent.
 */
export function getConveyorPreviewMaterial(appearance: Appearance): THREE.Material {
  return previewMaterial(spec(), appearance)
}

/**
 * Teleskopik bomun boyası — hattınkinden AYRI, ve bilerek.
 *
 * Hat çinko makara ile mill-finish profil (`metalness 0.55`); bom boyalı
 * makine gövdesi. Tek materyalde birleştirmek ikisinden birini yanlış yapardı
 * ve yanlış olan, bu ailenin en büyük yüzeyi olurdu.
 *
 * Atlas YOK: teleskopik geometri harita sütunu 0'ı (boş) yazıyor, yani
 * dokunun katacağı bir şey olmadığı hâlde her boma bir doku bağlaması binerdi.
 *
 * Bu üçlü buraya taşındı çünkü `telescopic-renderer.tsx` içinde modül düzeyinde
 * çıplak `MeshStandardMaterial` olarak duruyorlardı: `useAppearance()` hiç
 * okunmuyor, yani Display menüsü Solid'e alındığında bütün bina Lambert'e
 * düşerken bom PBR kalıyordu. Kapsam bekçisi (`appearance.test.ts`) yalnız
 * `materials.ts` dosyalarını tarıyor, o yüzden fark edilmemişti — bekçi de
 * bu yamada renderer'ları tarayacak biçimde genişletildi.
 */
const TELESCOPIC_SPEC = {
  family: 'telescopic',
  vertexColors: true,
  roughness: 0.8,
  metalness: 0.2,
} as const

export function getTelescopicMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(TELESCOPIC_SPEC, appearance)
}

export function getTelescopicPreviewMaterial(appearance: Appearance): THREE.Material {
  return previewMaterial(TELESCOPIC_SPEC, appearance)
}

/**
 * Çalışma lambasının merceği — paketin TEK yayıcı yüzeyi.
 *
 * Ayrı materyal, ayrı çizim çağrısı, ve bunun alternatifi yok: makinenin
 * geri kalanı vertex-renkli tek materyalden çiziliyor ve o materyali yayıcı
 * yapmak bomun tamamını parlatırdı. Teleskopik düşük adetli bir kind (bir
 * tesiste iki üç tane), yani düğüm başına bir ek çizim yazılı ve kabul.
 *
 * `solid`'de de yanıyor — Lambert `emissive` taşıyor (bkz. `../appearance`).
 * Dokular kapalıyken sönüyor, çünkü o mod tek renk demek.
 */
const LAMP_LENS_SPEC = {
  family: 'telescopic-lens',
  color: '#fff6d8',
  emissive: '#ffe9a8',
  emissiveIntensity: 1.6,
  roughness: 0.4,
} as const

export function getLampLensMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(LAMP_LENS_SPEC, appearance)
}

/**
 * Akış kutusu — sahnedeki HER kutu, kim çizerse çizsin.
 *
 * İki yer çiziyor: hat sistemi (`flow-system.tsx`, tek `InstancedMesh`, altı
 * yüz kutu) ve teleskopik bom (kendi küçük havuzu). İkisi de kendi çıplak
 * `MeshStandardMaterial`'ini kuruyordu — aynı kraft rengin iki kopyası, ve
 * ikisi de Display menüsünü duymuyordu.
 */
const FLOW_BOX_SPEC = {
  family: 'flow-box',
  // Kraft, so a box reads as goods rather than as machinery — the whole
  // conveyor family is blue steel and zinc.
  color: '#c8a06a',
  metalness: 0,
  roughness: 0.85,
} as const

export function getFlowBoxMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(FLOW_BOX_SPEC, appearance)
}
