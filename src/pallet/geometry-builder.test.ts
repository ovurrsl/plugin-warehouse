import { describe, expect, test } from 'bun:test'
import { ATLAS } from './epal-textures'
import { getPalletGeometry } from './geometry-builder'
import { PALLET_PRESETS } from './presets'

// `geometry-builder` only imports the ATLAS constants from `epal-textures`, not
// the canvas builder, so it runs headless. That separation is deliberate — it
// is what makes the geometry testable without a DOM.

const geo = getPalletGeometry('epal-1')

/** Which atlas rectangle a UV pair falls inside, or 'wood'. */
function regionOf(u: number, v: number): 'epal' | 'eur' | 'ippc' | 'wood' | 'none' {
  for (const name of ['epal', 'eur', 'ippc'] as const) {
    const r = ATLAS[name]
    if (u >= r.uMin - 1e-6 && u <= r.uMax + 1e-6 && v >= r.vMin - 1e-6 && v <= r.vMax + 1e-6) {
      return name
    }
  }
  const w = ATLAS.wood
  if (u >= w.uMin - 1e-6 && u <= w.uMax + 1e-6 && v >= w.vMin - 1e-6 && v <= w.vMax + 1e-6) {
    return 'wood'
  }
  return 'none'
}

type Tri = {
  region: ReturnType<typeof regionOf>
  nx: number
  ny: number
  nz: number
  cx: number
  cy: number
  cz: number
  /** Signed direction the U axis advances along, in world terms. */
  uSlope: number
}

function triangles(): Tri[] {
  const pos = geo.attributes.position as {
    count: number
    getX: (i: number) => number
    getY: (i: number) => number
    getZ: (i: number) => number
  }
  const norm = geo.attributes.normal as typeof pos
  const uv = geo.attributes.uv as { getX: (i: number) => number; getY: (i: number) => number }
  const out: Tri[] = []
  for (let t = 0; t < pos.count / 3; t++) {
    const i0 = t * 3
    const nx = norm.getX(i0)
    const ny = norm.getY(i0)
    const nz = norm.getZ(i0)
    const cx = (pos.getX(i0) + pos.getX(i0 + 1) + pos.getX(i0 + 2)) / 3
    const cy = (pos.getY(i0) + pos.getY(i0 + 1) + pos.getY(i0 + 2)) / 3
    const cz = (pos.getZ(i0) + pos.getZ(i0 + 1) + pos.getZ(i0 + 2)) / 3

    // For a marking triangle the U axis runs along Z (on X-facing surfaces) or
    // along X (on Z-facing ones). Compare the two vertices furthest apart on
    // that axis to recover whether U increases or decreases with it.
    const alongZ = Math.abs(nx) > 0.8
    const axisOf = (i: number) => (alongZ ? pos.getZ(i) : pos.getX(i))
    let lo = i0
    let hi = i0
    for (const i of [i0 + 1, i0 + 2]) {
      if (axisOf(i) < axisOf(lo)) lo = i
      if (axisOf(i) > axisOf(hi)) hi = i
    }
    const spread = axisOf(hi) - axisOf(lo)
    const uSlope = spread > 1e-6 ? (uv.getX(hi) - uv.getX(lo)) / spread : 0

    out.push({ region: regionOf(uv.getX(i0), uv.getY(i0)), nx, ny, nz, cx, cy, cz, uSlope })
  }
  return out
}

const tris = triangles()

describe('EPAL 1 geometry', () => {
  test('matches the published envelope: 1200 × 800 × 144 mm', () => {
    const box = geo.boundingBox
    expect(box).not.toBeNull()
    if (!box) return
    expect(box.max.x - box.min.x).toBeCloseTo(1.2, 5)
    expect(box.max.z - box.min.z).toBeCloseTo(0.8, 5)
    expect(box.max.y - box.min.y).toBeCloseTo(0.144, 5)
  })

  test('origin sits at the bottom centre, so it rests on Y=0 with no offset', () => {
    const box = geo.boundingBox
    if (!box) throw new Error('no bounding box')
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.min.x).toBeCloseTo(-0.6, 5)
    expect(box.max.x).toBeCloseTo(0.6, 5)
  })

  test('is non-indexed, which is what makes per-triangle UV classification safe', () => {
    expect(geo.index).toBeNull()
    expect(geo.attributes.position?.count).toBe(tris.length * 3)
  })

  test('stays light enough to place by the hundred', () => {
    // 304 at the time of writing. A generous ceiling, so a real regression
    // trips it but an intentional detail pass does not.
    expect(tris.length).toBeLessThan(400)
  })

  test('carries baked occlusion as vertex colours', () => {
    const color = geo.attributes.color
    expect(color).toBeDefined()
    expect(color?.count).toBe(geo.attributes.position?.count)
  })

  test('occlusion actually darkens something, and never blows out', () => {
    const color = geo.attributes.color as { count: number; getX: (i: number) => number }
    let min = 1
    let max = 0
    for (let i = 0; i < color.count; i++) {
      const c = color.getX(i)
      min = Math.min(min, c)
      max = Math.max(max, c)
    }
    expect(min).toBeLessThan(0.8)
    // The clamp floor is 1 − 0.62; compare loosely because the attribute is
    // float32 and stores it as 0.37999999.
    expect(min).toBeCloseTo(0.38, 5)
    expect(max).toBeCloseTo(1, 2)
  })
})

describe('UV classification', () => {
  test('every triangle lands inside a known atlas region', () => {
    expect(tris.filter((t) => t.region === 'none')).toHaveLength(0)
  })

  test('markings appear only on near-vertical faces within the block layer', () => {
    for (const t of tris) {
      if (t.region === 'wood') continue
      expect(Math.abs(t.ny)).toBeLessThan(0.3)
      expect(t.cy).toBeGreaterThan(0.02)
      expect(t.cy).toBeLessThan(0.102)
    }
  })

  test('no marking reaches a board, stringer or the deck', () => {
    const boardTriangles = tris.filter((t) => t.cy < 0.02 || t.cy > 0.102)
    expect(boardTriangles.length).toBeGreaterThan(0)
    expect(boardTriangles.every((t) => t.region === 'wood')).toBe(true)
  })

  test('the centre block stays blank — nobody can see it', () => {
    const centre = tris.filter(
      (t) => Math.abs(t.cx) < 0.08 && Math.abs(t.cz) < 0.08 && t.cy > 0.02 && t.cy < 0.102,
    )
    expect(centre.length).toBeGreaterThan(0)
    expect(centre.every((t) => t.region === 'wood')).toBe(true)
  })

  test('the long sides read EPAL on the left, IPPC centre, EUR on the right', () => {
    const front = tris.filter((t) => t.nz > 0.8 && t.cy > 0.02 && t.cy < 0.102 && t.cz > 0.29)
    const regionAt = (x: number) =>
      front.find((t) => Math.abs(t.cx - x) < 0.08 && t.region !== 'wood')?.region
    expect(regionAt(-0.5275)).toBe('epal')
    expect(regionAt(0)).toBe('ippc')
    expect(regionAt(0.5275)).toBe('eur')
  })

  /**
   * The defect this suite exists for. On an X-facing surface the on-screen
   * rightward direction is world −Z for +X and world +Z for −X, so U must
   * advance the opposite way on the two ends. The earlier version applied the
   * flip to the wrong branch and every marking on both 800 mm ends rendered
   * mirror-imaged — "EPAL" read backwards.
   */
  test('markings on the two short ends are not mirrored', () => {
    const marked = (sign: number) =>
      tris.filter(
        (t) =>
          Math.sign(t.nx) === sign && Math.abs(t.nx) > 0.8 && t.region !== 'wood' && t.uSlope !== 0,
      )

    const minusX = marked(-1)
    const plusX = marked(1)
    expect(minusX.length).toBeGreaterThan(0)
    expect(plusX.length).toBeGreaterThan(0)

    // −X face: screen-right is +Z, so U must increase with Z.
    expect(minusX.every((t) => t.uSlope > 0)).toBe(true)
    // +X face: screen-right is −Z, so U must decrease with Z.
    expect(plusX.every((t) => t.uSlope < 0)).toBe(true)
  })

  test('wood UVs are continuous within a triangle rather than a per-vertex hash', () => {
    // A hash gives the three corners of a face unrelated coordinates. Sample the
    // flat top deck, where all three vertices must share a V.
    const pos = geo.attributes.position as { getY: (i: number) => number }
    const uv = geo.attributes.uv as { getX: (i: number) => number; getY: (i: number) => number }
    let checked = 0
    for (let t = 0; t < tris.length; t++) {
      const tri = tris[t]
      if (tri?.region !== 'wood' || tri.ny < 0.9) continue
      const i0 = t * 3
      if (pos.getY(i0) < 0.14) continue
      const vs = [uv.getY(i0), uv.getY(i0 + 1), uv.getY(i0 + 2)]
      const us = [uv.getX(i0), uv.getX(i0 + 1), uv.getX(i0 + 2)]
      // A deck board is 145 mm across at most, so its V span must stay small —
      // a per-vertex hash would scatter the three corners across the band.
      expect(Math.max(...vs) - Math.min(...vs)).toBeLessThan(0.2)
      // U follows the 1200 mm length, so it may span most of the band; what
      // must hold is that it never exceeds it, which clamping used to cause.
      expect(Math.max(...us)).toBeLessThanOrEqual(ATLAS.wood.uMax + 1e-6)
      expect(Math.min(...us)).toBeGreaterThanOrEqual(ATLAS.wood.uMin - 1e-6)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('presets', () => {
  test('each preset is cached and returns the same instance', () => {
    expect(getPalletGeometry('epal-1')).toBe(geo)
    expect(getPalletGeometry('gma-48x40')).toBe(getPalletGeometry('gma-48x40'))
  })

  test('a scaled preset matches its published footprint', () => {
    const gma = getPalletGeometry('gma-48x40')
    const spec = PALLET_PRESETS['gma-48x40']
    const box = gma.boundingBox
    if (!box) throw new Error('no bounding box')
    expect(box.max.x - box.min.x).toBeCloseTo(spec.length, 4)
    expect(box.max.z - box.min.z).toBeCloseTo(spec.width, 4)
    expect(box.max.y - box.min.y).toBeCloseTo(spec.height, 4)
  })

  test('every preset dimension is metres, not millimetres', () => {
    for (const [id, spec] of Object.entries(PALLET_PRESETS)) {
      expect(spec.length, id).toBeLessThan(3)
      expect(spec.width, id).toBeLessThan(3)
      expect(spec.height, id).toBeLessThan(1)
    }
  })
})
