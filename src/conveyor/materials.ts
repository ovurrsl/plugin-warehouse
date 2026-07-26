import * as THREE from 'three'
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
 */

let cached: THREE.MeshStandardMaterial | null = null
let cachedPreview: THREE.MeshStandardMaterial | null = null

export function getConveyorMaterial(): THREE.MeshStandardMaterial {
  if (cached) return cached
  cached = new THREE.MeshStandardMaterial({
    // A two-column atlas: blank for the steelwork, a roller stripe for the bed.
    // The geometry picks a column per part through its UVs, which is what lets
    // eight thousand rollers exist without a second material — and so without a
    // second draw call on every module in the building.
    map: getConveyorTexture(),
    // Between the rack's painted steel and a mirror: galvanised roller shells
    // and mill-finish profiles, which read as metal but are far from polished.
    metalness: 0.55,
    roughness: 0.38,
    vertexColors: true,
  })
  return cached
}

/**
 * The ghost shown while placing. A separate cached instance rather than a
 * mutated clone: the real material is a module singleton, so setting
 * `transparent` on it would make every committed conveyor in the scene
 * translucent.
 */
export function getConveyorPreviewMaterial(): THREE.MeshStandardMaterial {
  if (cachedPreview) return cachedPreview
  cachedPreview = getConveyorMaterial().clone()
  cachedPreview.transparent = true
  cachedPreview.opacity = 0.55
  cachedPreview.depthWrite = false
  return cachedPreview
}
