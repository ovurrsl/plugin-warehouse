import * as THREE from 'three'
import { getOrCreateEPALTextureAtlas } from './epal-textures'

/**
 * Module-level singletons, shared by every pallet in the scene.
 *
 * The earlier version built the material inside a `useMemo` in the renderer, so
 * two hundred pallets meant two hundred `MeshStandardMaterial` instances — and
 * because nothing disposed them, each deleted pallet leaked one. They all
 * shared the same three textures, so three.js compiled one program and the cost
 * was uniform uploads rather than shader churn, but it directly contradicted
 * the file's own "single material" comment.
 */

let cachedMaterial: THREE.MeshStandardMaterial | null = null
let cachedPreviewMaterial: THREE.MeshStandardMaterial | null = null

export function getPalletMaterial(): THREE.MeshStandardMaterial {
  if (cachedMaterial) return cachedMaterial
  const atlas = getOrCreateEPALTextureAtlas()

  cachedMaterial = new THREE.MeshStandardMaterial({
    map: atlas.map,
    roughnessMap: atlas.roughnessMap,
    metalnessMap: atlas.metalnessMap,
    // three multiplies these scalars into the map channels. The earlier version
    // set 0.75 / 0.2, which meant the control nail — authored as pure white in
    // the metalness map, i.e. steel — rendered at 0.2 metalness and read as
    // shiny grey plastic, and the wood came out around 0.5 roughness, glossier
    // than raw pine. Leave them at 1.0 and let the maps carry the values.
    roughness: 1,
    metalness: 1,
    // Multiplies in the baked occlusion the geometry builder writes.
    vertexColors: true,
  })
  return cachedMaterial
}

/**
 * The ghost shown while placing. A separate cached instance rather than a
 * mutated clone of the real one: builders cache materials at module scope, so
 * setting `transparent`/`opacity` on the shared instance would leak the
 * translucency into every committed pallet in the scene.
 */
export function getPalletPreviewMaterial(): THREE.MeshStandardMaterial {
  if (cachedPreviewMaterial) return cachedPreviewMaterial
  cachedPreviewMaterial = getPalletMaterial().clone()
  cachedPreviewMaterial.transparent = true
  cachedPreviewMaterial.opacity = 0.55
  cachedPreviewMaterial.depthWrite = false
  return cachedPreviewMaterial
}
