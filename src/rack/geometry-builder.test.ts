import { beforeEach, describe, expect, test } from 'bun:test'
import {
  clearRackGeometryCache,
  getRackGeometry,
  rackGeometryCacheSize,
  rackGeometryKey,
} from './geometry-builder'
import { PalletRackNode } from './schema'

const rack = (overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_geo', ...overrides })

const triangleCount = (rackNode: ReturnType<typeof rack>, detail: 'full' | 'simple' = 'full') =>
  (getRackGeometry(rackNode, detail).getIndex()?.count ?? 0) / 3

describe('geometry sharing', () => {
  beforeEach(() => clearRackGeometryCache())

  test('two racks of the same shape share one geometry', () => {
    // The entire performance design rests on this. A warehouse repeats the same
    // rack hundreds of times; if each got its own mesh, memory and draw calls
    // would both scale with the rack count.
    const a = rack({ id: 'pallet_rack_a', position: [0, 0, 0] })
    const b = rack({ id: 'pallet_rack_b', position: [40, 0, 12], rotation: [0, Math.PI / 2, 0] })
    expect(getRackGeometry(a, 'full')).toBe(getRackGeometry(b, 'full'))
    expect(rackGeometryCacheSize()).toBe(1)
  })

  test('the key ignores identity and placement but tracks every shape field', () => {
    const base = rack()
    const moved = rack({ id: 'pallet_rack_other', name: 'Aisle 4', position: [9, 0, 3] })
    expect(rackGeometryKey(moved, 'full')).toBe(rackGeometryKey(base, 'full'))

    // A field that changes a vertex must change the key, or racks that look
    // different would silently share a mesh.
    for (const change of [
      { bayCount: 4 },
      { bayClearWidth: 3.3 },
      { depth: 1.2 },
      { uprightHeight: 7 },
      { levels: 4 },
      { backToBack: true },
      { depthPositions: 2 },
      { bracing: 'x-bracing' },
      { decking: 'open' },
      { pickingLevels: 2 },
      { uprightColor: '#ff0000' },
      { palletOrientation: 'long-side-out' },
    ]) {
      expect(rackGeometryKey(rack(change), 'full')).not.toBe(rackGeometryKey(base, 'full'))
    }
  })

  test('a hundred identical racks still build one geometry', () => {
    for (let index = 0; index < 100; index++) {
      getRackGeometry(rack({ id: `pallet_rack_${index}`, position: [index * 3, 0, 0] }), 'full')
    }
    expect(rackGeometryCacheSize()).toBe(1)
  })

  test('detail levels are cached separately', () => {
    const r = rack()
    expect(getRackGeometry(r, 'full')).not.toBe(getRackGeometry(r, 'simple'))
    expect(rackGeometryCacheSize()).toBe(2)
  })
})

describe('geometry content', () => {
  beforeEach(() => clearRackGeometryCache())

  test('the default rack is one indexed mesh with colours', () => {
    const geometry = getRackGeometry(rack(), 'full')
    expect(geometry.getIndex()).not.toBeNull()
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
    expect(geometry.getAttribute('normal').count).toBe(geometry.getAttribute('position').count)
    // Colours per vertex are what let every rack share one material.
    expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count)
  })

  test('simple detail keeps the silhouette and drops most of the triangles', () => {
    // Posts and beams survive; footplates, bracing, decking and support bars do
    // not. Those are the parts that stop reading past a few tens of metres, and
    // in a warehouse most racks are always at that distance.
    const r = rack()
    const full = triangleCount(r, 'full')
    const simple = triangleCount(r, 'simple')
    expect(simple).toBeLessThan(full * 0.45)
    expect(simple).toBeGreaterThan(0)
  })

  test('the default rack stays well under a thousand triangles', () => {
    // A thousand racks at this size is under a million triangles, which is the
    // budget that makes a 15,000 m2 warehouse viable at all.
    expect(triangleCount(rack())).toBeLessThan(1000)
  })

  test('geometry grows with bays but the mesh count does not', () => {
    const small = triangleCount(rack({ bayCount: 1 }))
    const large = triangleCount(rack({ bayCount: 10 }))
    expect(large).toBeGreaterThan(small)
    // Still one geometry per shape, however many bays it has.
    expect(getRackGeometry(rack({ bayCount: 10 }), 'full').groups).toHaveLength(0)
  })

  test('the steel matches the declared footprint, bar the footplate overhang', () => {
    // The collision footprint measures over the outer upright faces. Catalogue
    // footplates are wider than their post (175 mm under a 122 mm upright), so
    // the built mesh legitimately exceeds it at floor level by about 26 mm a
    // side. Asserted rather than ignored: any larger discrepancy means a part
    // is escaping the footprint and racks could overlap while the editor
    // reported a clear placement.
    const r = rack({ bayCount: 3 })
    const footprint = 3 * (r.bayClearWidth + r.uprightWidth) + r.uprightWidth

    const structure = getRackGeometry(r, 'simple').boundingBox
    const structureWidth = (structure?.max.x ?? 0) - (structure?.min.x ?? 0)
    expect(structureWidth).toBeCloseTo(footprint, 5)

    const full = getRackGeometry(r, 'full').boundingBox
    const fullWidth = (full?.max.x ?? 0) - (full?.min.x ?? 0)
    expect(fullWidth - footprint).toBeCloseTo(0.053, 5)

    expect(full?.min.y ?? -1).toBeGreaterThanOrEqual(-1e-9)
    expect(full?.max.y ?? 0).toBeCloseTo(r.uprightHeight, 5)
  })

  test('a back-to-back rack is twice as deep and still centred', () => {
    const twin = getRackGeometry(rack({ backToBack: true }), 'full').boundingBox
    const single = getRackGeometry(rack(), 'full').boundingBox
    const twinDepth = (twin?.max.z ?? 0) - (twin?.min.z ?? 0)
    const singleDepth = (single?.max.z ?? 0) - (single?.min.z ?? 0)
    expect(twinDepth).toBeGreaterThan(singleDepth * 1.9)
    expect((twin?.max.z ?? 0) + (twin?.min.z ?? 0)).toBeCloseTo(0, 6)
  })

  test('every triangle index addresses a real vertex', () => {
    const geometry = getRackGeometry(rack({ bayCount: 2, backToBack: true }), 'full')
    const index = geometry.getIndex()
    const vertices = geometry.getAttribute('position').count
    expect(index).not.toBeNull()
    for (let i = 0; i < (index?.count ?? 0); i++) {
      const value = index?.getX(i) ?? -1
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(vertices)
    }
  })

  test('normals are unit length', () => {
    // A tilted brace writes rotated normals by hand; getting that wrong shows
    // up as bracing that lights differently from the posts beside it.
    const normals = getRackGeometry(rack(), 'full').getAttribute('normal')
    for (let i = 0; i < normals.count; i++) {
      const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))
      expect(length).toBeCloseTo(1, 6)
    }
  })
})
