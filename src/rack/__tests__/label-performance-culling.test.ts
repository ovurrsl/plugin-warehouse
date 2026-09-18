import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import {
  CULL_DISTANCE_FAR,
  CULL_DISTANCE_NEAR,
  LABEL_HEIGHT,
  LABEL_WIDTH,
} from '../beam-labels-renderer'
import {
  BADGE_BOX_GEOMETRY,
  BADGE_HEIGHT,
  BADGE_THICKNESS,
  BADGE_WIDTH,
  getSignFaceMaterial,
  getSignTexture,
  getStencilMaterial,
  GROUND_STENCIL_CULL_FAR,
  GROUND_STENCIL_CULL_NEAR,
  GROUND_STENCIL_GEOMETRY,
  GROUND_STENCIL_HEIGHT,
  GROUND_STENCIL_WIDTH,
  LEVEL_BADGE_CULL_FAR,
  LEVEL_BADGE_CULL_NEAR,
  LEVEL_BADGE_MATERIALS,
  LEVEL_COLOR_PALETTE,
  SIGN_BACKPLATE_MATERIAL,
  SIGN_BRACKET_MATERIAL,
  SIGN_CULL_DISTANCE_FAR,
  SIGN_CULL_DISTANCE_NEAR,
  signTextureCache,
  stencilMaterialCache,
  stringHash,
} from '../row-labels-renderer'

describe('3D Label & Stencil Performance Optimization Suite', () => {
  describe('1. Module Singleton Geometries & Shared Materials', () => {
    test('BADGE_BOX_GEOMETRY is a singleton BoxGeometry with correct dimensions', () => {
      expect(BADGE_BOX_GEOMETRY).toBeInstanceOf(THREE.BoxGeometry)
      expect(BADGE_BOX_GEOMETRY.parameters.width).toBe(BADGE_WIDTH)
      expect(BADGE_BOX_GEOMETRY.parameters.height).toBe(BADGE_HEIGHT)
      expect(BADGE_BOX_GEOMETRY.parameters.depth).toBe(BADGE_THICKNESS)
    })

    test('GROUND_STENCIL_GEOMETRY is a singleton PlaneGeometry with correct dimensions', () => {
      expect(GROUND_STENCIL_GEOMETRY).toBeInstanceOf(THREE.PlaneGeometry)
      expect(GROUND_STENCIL_GEOMETRY.parameters.width).toBe(GROUND_STENCIL_WIDTH)
      expect(GROUND_STENCIL_GEOMETRY.parameters.height).toBe(GROUND_STENCIL_HEIGHT)
    })

    test('LEVEL_BADGE_MATERIALS holds pre-allocated singleton materials for all 6 levels', () => {
      const levels = ['A', 'B', 'C', 'D', 'E', 'F'] as const
      for (const letter of levels) {
        const mat = LEVEL_BADGE_MATERIALS[letter]
        expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial)
        const expectedColor = new THREE.Color(LEVEL_COLOR_PALETTE[letter])
        expect(mat.color.getHexString()).toBe(expectedColor.getHexString())
        expect(mat.roughness).toBe(0.4)
        expect(mat.metalness).toBe(0.2)
      }
    })

    test('SIGN_BACKPLATE_MATERIAL and SIGN_BRACKET_MATERIAL are shared singletons', () => {
      expect(SIGN_BACKPLATE_MATERIAL).toBeInstanceOf(THREE.MeshStandardMaterial)
      expect(SIGN_BACKPLATE_MATERIAL.metalness).toBe(0.15)
      expect(SIGN_BRACKET_MATERIAL).toBeInstanceOf(THREE.MeshStandardMaterial)
      expect(SIGN_BRACKET_MATERIAL.metalness).toBe(0.6)
    })
  })

  describe('2. Texture & Material Caching (Zero-Duplicate Allocation)', () => {
    test('getSignFaceMaterial caches MeshStandardMaterial by label string', () => {
      const dummyTexture = new THREE.Texture()
      const mat1 = getSignFaceMaterial('Aisle 1', dummyTexture)
      const mat2 = getSignFaceMaterial('Aisle 1', dummyTexture)
      expect(mat1).toBe(mat2) // Exactly identical reference, 0 duplicate allocations
    })

    test('getStencilMaterial caches MeshStandardMaterial by bayText string', () => {
      const dummyTexture = new THREE.Texture()
      const mat1 = getStencilMaterial('01', dummyTexture)
      const mat2 = getStencilMaterial('01', dummyTexture)
      expect(mat1).toBe(mat2) // Exactly identical reference
      expect(stencilMaterialCache.has('01')).toBe(true)
    })

    test('getSignTexture safely returns null for empty or whitespace labels', () => {
      expect(getSignTexture('')).toBeNull()
      expect(getSignTexture('   ')).toBeNull()
    })
  })

  describe('3. Distance Culling & Hysteresis Invariants', () => {
    test('Aisle signs have 55m near / 65m far hysteresis (10m flicker immunity)', () => {
      expect(SIGN_CULL_DISTANCE_NEAR).toBe(55)
      expect(SIGN_CULL_DISTANCE_FAR).toBe(65)
      expect(SIGN_CULL_DISTANCE_FAR - SIGN_CULL_DISTANCE_NEAR).toBeGreaterThanOrEqual(10)
    })

    test('Ground stencils have 20m near / 25m far hysteresis (5m flicker immunity)', () => {
      expect(GROUND_STENCIL_CULL_NEAR).toBe(20)
      expect(GROUND_STENCIL_CULL_FAR).toBe(25)
      expect(GROUND_STENCIL_CULL_FAR - GROUND_STENCIL_CULL_NEAR).toBeGreaterThanOrEqual(5)
    })

    test('Level badges have 18m near / 22m far hysteresis (4m flicker immunity)', () => {
      expect(LEVEL_BADGE_CULL_NEAR).toBe(18)
      expect(LEVEL_BADGE_CULL_FAR).toBe(22)
      expect(LEVEL_BADGE_CULL_FAR - LEVEL_BADGE_CULL_NEAR).toBeGreaterThanOrEqual(4)
    })

    test('Beam lip barcodes have 20m near / 25m far hysteresis', () => {
      expect(CULL_DISTANCE_NEAR).toBe(20)
      expect(CULL_DISTANCE_FAR).toBe(25)
      expect(CULL_DISTANCE_FAR - CULL_DISTANCE_NEAR).toBeGreaterThanOrEqual(5)
    })
  })

  describe('4. Frame-Staggering & CPU Throttling Distribution', () => {
    test('stringHash produces deterministic non-negative integers', () => {
      const h1 = stringHash('pallet_rack_01')
      const h2 = stringHash('pallet_rack_01')
      const h3 = stringHash('pallet_rack_02')
      expect(h1).toBe(h2)
      expect(h1).toBeGreaterThanOrEqual(0)
      expect(h1).not.toBe(h3)
    })

    test('staggers 1,000 racks across 8 frame slots with high uniformity', () => {
      const bucketCounts = new Array(8).fill(0)
      for (let i = 0; i < 1000; i++) {
        const hash = stringHash(`rack_${i}`)
        const slot = hash % 8
        bucketCounts[slot]++
      }

      // Every slot should get approximately 125 items (allow reasonable variance)
      for (const count of bucketCounts) {
        expect(count).toBeGreaterThan(90)
        expect(count).toBeLessThan(160)
      }
    })
  })
})
