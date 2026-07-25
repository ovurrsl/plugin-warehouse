import * as THREE from 'three'

/**
 * One material for every rack in the scene.
 *
 * Part colours ride in the geometry's vertex colour attribute, so blue
 * uprights, orange beams and galvanised shelves all draw from this single
 * instance. The version being replaced wrote `<meshStandardMaterial>` inline on
 * each part, which meant a 10-bay rack minted about 250 materials and a
 * warehouse minted hundreds of thousands — every one a separate uniform upload,
 * and none of them ever disposed.
 */

let cachedMaterial: THREE.MeshStandardMaterial | null = null
let cachedPreviewMaterial: THREE.MeshStandardMaterial | null = null

export function getRackMaterial(): THREE.MeshStandardMaterial {
  if (cachedMaterial) return cachedMaterial
  cachedMaterial = new THREE.MeshStandardMaterial({
    // Racking is powder-coated steel, not bare metal. The earlier version used
    // metalness 0.75 with a flat colour, which is wrong twice: painted steel is
    // a dielectric, and a near-metal surface with no environment map to reflect
    // renders close to black. These values read as paint under any lighting.
    metalness: 0.15,
    roughness: 0.55,
    vertexColors: true,
  })
  return cachedMaterial
}

/**
 * The ghost shown while placing. A separate cached instance rather than a
 * mutated clone: the real material is a module singleton, so setting
 * `transparent` on it would make every committed rack in the scene translucent.
 */
export function getRackPreviewMaterial(): THREE.MeshStandardMaterial {
  if (cachedPreviewMaterial) return cachedPreviewMaterial
  cachedPreviewMaterial = getRackMaterial().clone()
  cachedPreviewMaterial.transparent = true
  cachedPreviewMaterial.opacity = 0.55
  cachedPreviewMaterial.depthWrite = false
  return cachedPreviewMaterial
}
