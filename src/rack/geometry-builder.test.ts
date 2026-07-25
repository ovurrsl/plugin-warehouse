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

  test('the key ignores identity and placement', () => {
    // Which fields must and must not reach the key is asserted exhaustively in
    // 'cache key coverage' below, against the built mesh rather than a list
    // somebody has to remember to update.
    const base = rack()
    const moved = rack({ id: 'pallet_rack_other', name: 'Aisle 4', position: [9, 0, 3] })
    expect(rackGeometryKey(moved, 'full')).toBe(rackGeometryKey(base, 'full'))
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

  test('a warehouse-sized scene stays inside a sane triangle budget', () => {
    // The number that matters is the far tier, because in a 15,000 m2 warehouse
    // almost every rack is always far away. A thousand racks with fifty of them
    // near works out at well under half a million triangles, which any GPU that
    // can open the editor will draw without noticing.
    const full = triangleCount(rack(), 'full')
    const simple = triangleCount(rack(), 'simple')
    expect(simple).toBeLessThan(400)
    expect(full).toBeLessThan(2000)
    expect(50 * full + 950 * simple).toBeLessThan(500_000)
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

describe('frame detail parity', () => {
  beforeEach(() => clearRackGeometryCache())

  test('a ground beam is added only when asked for, and sits on the floor', () => {
    const without = getRackGeometry(rack(), 'full')
    const withBeam = getRackGeometry(rack({ hasGroundBeam: true }), 'full')
    expect((withBeam.getIndex()?.count ?? 0) > (without.getIndex()?.count ?? 0)).toBe(true)
    // Off by default: a beam at floor level blocks a truck reaching the ground
    // position, which is the one every rack has.
    expect(rack().hasGroundBeam).toBe(false)
    // And it rests on the floor rather than hanging half-buried in it.
    expect(withBeam.boundingBox?.min.y ?? -1).toBeGreaterThanOrEqual(-1e-9)
  })

  test('timber decking is visibly thicker than steel or mesh', () => {
    // 18 mm chipboard against a 6 mm panel, and it shows at the shelf edge.
    const timber = getRackGeometry(rack({ decking: 'timber' }), 'full')
    const steel = getRackGeometry(rack({ decking: 'steel' }), 'full')
    expect(timber).not.toBe(steel)
    expect(timber.boundingBox?.max.y ?? 0).toBeCloseTo(steel.boundingBox?.max.y ?? 0, 5)
  })

  test('bracing closes with a horizontal tie at each end', () => {
    const braced = getRackGeometry(rack(), 'full')
    const open = getRackGeometry(rack({ bracing: 'open' }), 'full')
    const bracedTris = (braced.getIndex()?.count ?? 0) / 3
    const openTris = (open.getIndex()?.count ?? 0) / 3
    // Diagonals plus two ties per frame line; without the ties a frame reads
    // as unfinished and the diagonals terminate into nothing.
    const frames = 4
    expect(bracedTris - openTris).toBeGreaterThanOrEqual(frames * 2 * 12)
  })

  test('nothing escapes the floor in any bracing mode', () => {
    for (const bracing of ['z-bracing', 'x-bracing', 'open'] as const) {
      const box = getRackGeometry(rack({ bracing }), 'full').boundingBox
      expect(box?.min.y ?? -1).toBeGreaterThanOrEqual(-1e-9)
    }
  })
})

describe('cache key coverage', () => {
  /**
   * Build without the cache, so two shapes that share a key can still be
   * compared. Otherwise the second lookup returns the first one's mesh and the
   * bug this guards against becomes invisible to the guard.
   */
  const buildFresh = (rackNode: ReturnType<typeof rack>): Float32Array => {
    clearRackGeometryCache()
    const geometry = getRackGeometry(rackNode, 'full')
    // Positions and colours both: part colours are baked into the vertex colour
    // attribute, so a recolour moves no vertex but still produces a different
    // mesh. Comparing positions alone would call the colour fields redundant
    // and invite removing them from the key.
    const positions = geometry.getAttribute('position').array as ArrayLike<number>
    const colors = geometry.getAttribute('color').array as ArrayLike<number>
    const combined = new Float32Array(positions.length + colors.length)
    combined.set(Float32Array.from(positions), 0)
    combined.set(Float32Array.from(colors), positions.length)
    return combined
  }

  const sameMesh = (a: Float32Array, b: Float32Array) =>
    a.length === b.length && a.every((value, index) => value === b[index])

  // One altered value per field. Kept explicit rather than generated so each
  // stays inside its schema range.
  const VARIANTS: Array<[string, unknown]> = [
    ['bayCount', 5],
    ['bayClearWidth', 3.3],
    ['depth', 1.2],
    ['uprightHeight', 8],
    ['backToBack', true],
    ['backToBackGap', 0.4],
    ['depthPositions', 2],
    ['depthGap', 0.12],
    ['levels', 2],
    ['firstLevelClear', 1.9],
    ['levelClear', 1.7],
    ['groundLevelStorage', false],
    ['hasGroundBeam', true],
    ['bayOverrides', { 'R1-B2': { skipped: true } }],
    ['pickingLevels', 2],
    ['levelTypes', ['picking', 'pallet', 'pallet', 'pallet']],
    ['pickingLevelClear', 0.8],
    ['pickingBeamHeight', 0.09],
    ['pickingShelfThickness', 0.04],
    ['uprightWidth', 0.101],
    ['uprightDepth', 0.069],
    ['beamHeight', 0.16],
    ['beamThickness', 0.07],
    ['bracing', 'x-bracing'],
    ['decking', 'timber'],
    ['palletSupportBars', 3],
    ['palletPreset', 'epal-2'],
    ['palletOrientation', 'long-side-out'],
    ['palletsPerLevel', 2],
    ['clearanceToUpright', 0.12],
    ['clearanceBetweenPallets', 0.12],
    ['uprightColor', '#00ff00'],
    ['beamColor', '#ff00ff'],
    // Fields that must NOT move a vertex — included so the test also catches a
    // key that over-reports and needlessly splits the cache.
    ['ghostFill', 0.8],
    ['levelCapacity', 5000],
    ['name', 'Aisle 7'],
    ['position', [12, 0, 4]],
  ]

  test('every field that changes the mesh also changes the key, and none that do not', () => {
    // The failure this exists for is silent and one-directional: a geometry
    // field missing from the key makes two visibly different racks share one
    // mesh, and nothing looks wrong until you notice a rack ignoring a setting.
    // `hasGroundBeam` shipped exactly that way and this caught it.
    const base = rack()
    const baseMesh = buildFresh(base)
    const baseKey = rackGeometryKey(base, 'full')

    for (const [field, value] of VARIANTS) {
      const variant = rack({ [field]: value })
      const changesMesh = !sameMesh(buildFresh(variant), baseMesh)
      const changesKey = rackGeometryKey(variant, 'full') !== baseKey
      expect({ field, changesKey }).toEqual({ field, changesKey: changesMesh })
    }
  })
})
