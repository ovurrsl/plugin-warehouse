import * as THREE from 'three'

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
 */

let cachedMaterial: THREE.MeshStandardMaterial | null = null
let cachedPreviewMaterial: THREE.MeshStandardMaterial | null = null

export function getTruckMaterial(): THREE.MeshStandardMaterial {
  if (cachedMaterial) return cachedMaterial
  cachedMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.18,
  })
  return cachedMaterial
}

/** Yerleştirme hayaleti. Paylaşılan örneğin mutasyonu değil, ayrı önbellekli
 *  klon — şeffaflık sahnedeki her araca sızardı. */
export function getTruckPreviewMaterial(): THREE.MeshStandardMaterial {
  if (cachedPreviewMaterial) return cachedPreviewMaterial
  cachedPreviewMaterial = getTruckMaterial().clone()
  cachedPreviewMaterial.transparent = true
  cachedPreviewMaterial.opacity = 0.55
  cachedPreviewMaterial.depthWrite = false
  return cachedPreviewMaterial
}
