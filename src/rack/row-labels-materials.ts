import * as THREE from 'three'
import { LEVEL_COLOR_PALETTE } from './beam-label-atlas'

// Pre-allocated materials for level badges (A through F)
export const LEVEL_BADGE_MATERIALS: Record<string, THREE.MeshStandardMaterial> = {
  A: new THREE.MeshStandardMaterial({ color: LEVEL_COLOR_PALETTE.A, roughness: 0.4, metalness: 0.2 }),
  B: new THREE.MeshStandardMaterial({ color: LEVEL_COLOR_PALETTE.B, roughness: 0.4, metalness: 0.2 }),
  C: new THREE.MeshStandardMaterial({ color: LEVEL_COLOR_PALETTE.C, roughness: 0.4, metalness: 0.2 }),
  D: new THREE.MeshStandardMaterial({ color: LEVEL_COLOR_PALETTE.D, roughness: 0.4, metalness: 0.2 }),
  E: new THREE.MeshStandardMaterial({ color: LEVEL_COLOR_PALETTE.E, roughness: 0.4, metalness: 0.2 }),
  F: new THREE.MeshStandardMaterial({ color: LEVEL_COLOR_PALETTE.F, roughness: 0.4, metalness: 0.2 }),
}

// Module-level shared materials for sign backplates and brackets
export const SIGN_BACKPLATE_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#facc15',
  metalness: 0.15,
  roughness: 0.35,
})

export const SIGN_BRACKET_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#27272a',
  metalness: 0.6,
  roughness: 0.4,
})

export const signFaceMaterialCache = new Map<string, THREE.MeshStandardMaterial>()

export function getSignFaceMaterial(label: string, texture: THREE.Texture): THREE.MeshStandardMaterial {
  let mat = signFaceMaterialCache.get(label)
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.3, metalness: 0.1 })
    signFaceMaterialCache.set(label, mat)
  }
  return mat
}

export const stencilMaterialCache = new Map<string, THREE.MeshStandardMaterial>()

export function getStencilMaterial(bayText: string, texture: THREE.Texture | null): THREE.MeshStandardMaterial {
  let mat = stencilMaterialCache.get(bayText)
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      map: texture,
      color: texture ? '#ffffff' : '#facc15',
      transparent: true,
      opacity: 0.92,
      roughness: 0.8,
      metalness: 0.1,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    stencilMaterialCache.set(bayText, mat)
  }
  return mat
}
