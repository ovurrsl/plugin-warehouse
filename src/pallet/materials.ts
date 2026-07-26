import * as THREE from 'three'
import { getOrCreateCargoAtlas } from './cargo-atlas'
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

let cachedCargoMaterial: THREE.MeshStandardMaterial | null = null
let cachedCargoPreviewMaterial: THREE.MeshStandardMaterial | null = null

/**
 * One material for everything a pallet carries — cartons, drums, straps, corner
 * boards and the label alike.
 *
 * **The same texture is handed to `roughnessMap` and `metalnessMap`**, which is
 * not a mistake: three reads roughness from a texture's green channel and
 * metalness from its blue, expressly so one packed sheet can serve both. Two
 * separate sheets would double the VRAM to say the same thing.
 *
 * `vertexColors` carries two multiplied together — each part's own hue and the
 * approximate occlusion baked over it. That is what lets a green strap and a
 * kraft carton share one mesh, and it is why a per-instance tint is left to do
 * only the small per-pallet variation it is good at.
 */
export function getCargoMaterial(): THREE.MeshStandardMaterial {
  if (cachedCargoMaterial) return cachedCargoMaterial
  const atlas = getOrCreateCargoAtlas()

  cachedCargoMaterial = new THREE.MeshStandardMaterial({
    map: atlas.map,
    roughnessMap: atlas.orm,
    metalnessMap: atlas.orm,
    // Left at 1 so the packed sheet carries the values rather than being scaled
    // by a second opinion — the mistake the pallet's own material shipped with,
    // which rendered its steel control nail as grey plastic.
    roughness: 1,
    metalness: 1,
    vertexColors: true,
  })
  return cachedCargoMaterial
}

export function getCargoPreviewMaterial(): THREE.MeshStandardMaterial {
  if (cachedCargoPreviewMaterial) return cachedCargoPreviewMaterial
  cachedCargoPreviewMaterial = getCargoMaterial().clone()
  cachedCargoPreviewMaterial.transparent = true
  cachedCargoPreviewMaterial.opacity = 0.55
  cachedCargoPreviewMaterial.depthWrite = false
  return cachedCargoPreviewMaterial
}
