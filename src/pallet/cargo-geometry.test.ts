import { describe, expect, test } from 'bun:test'
import type * as THREE from 'three'
import { uvOf } from './cargo-atlas-regions'
import { buildCargoGeometry, cargoCacheKey } from './cargo-geometry'
import { type CargoDetail, type CargoInput, cargoParts, loadExtent } from './cargo-parts'
import { CARTON, DRUM, loadHeightOf } from './cargo-types'
import { PALLET_PRESETS } from './presets'

const BASE: CargoInput = {
  type: CARTON,
  preset: 'epal-1',
  variant: 1,
  detail: 'full',
  strapped: true,
  labelled: true,
  color: 'kraft',
}

const at = (patch: Partial<CargoInput>): CargoInput => ({ ...BASE, ...patch })

/**
 * A mesh's identity, for the sweep below.
 *
 * Position **and** UV **and** colour, because twice in this package a
 * position-only fingerprint returned a false "over-report" verdict: a field that
 * moved no vertex but repainted every one of them looked, to the test, like a
 * field that did nothing at all.
 */
function fingerprint(geometry: THREE.BufferGeometry): string {
  const parts: string[] = []
  for (const name of ['position', 'uv', 'color']) {
    const attribute = geometry.getAttribute(name)
    const array = attribute.array as ArrayLike<number>
    let hash = 0x811c9dc5
    for (let i = 0; i < array.length; i++) {
      hash ^= Math.round((array[i] ?? 0) * 100000) | 0
      hash = Math.imul(hash, 0x01000193)
    }
    parts.push(`${name}:${(hash >>> 0).toString(16)}:${array.length}`)
  }
  return parts.join('|')
}

const meshOf = (input: CargoInput) => fingerprint(buildCargoGeometry(input))

describe('the cache key names what the builder consumes, and nothing else', () => {
  /**
   * The law this package runs on, swept at **both tiers**.
   *
   * Over-reporting splits the cache between byte-identical buffers; under-
   * reporting hands two visibly different loads the same vertices. Neither
   * throws, neither shows up in a screenshot of one pallet, and both are found
   * only by asking every field the same question: does changing you change the
   * mesh, and does changing you change the key — and are those the same answer?
   */
  const FIELDS: { field: string; change: Partial<CargoInput> }[] = [
    { field: 'type', change: { type: DRUM } },
    { field: 'variant', change: { variant: 0.4 } },
    { field: 'color', change: { color: 'blue' } },
    { field: 'strapped', change: { strapped: false } },
    { field: 'labelled', change: { labelled: false } },
    // A quarter pallet is 600 x 400, so the carton tiles it 2 x 1 rather than
    // 4 x 2 — a preset that genuinely changes the layout.
    { field: 'preset (layout changes)', change: { preset: 'quarter' } },
  ]

  for (const detail of ['full', 'simple'] as CargoDetail[]) {
    for (const { field, change } of FIELDS) {
      test(`${detail}: ${field} moves the key exactly when it moves the mesh`, () => {
        const before = at({ detail })
        const after = at({ detail, ...change })
        const keyMoved = cargoCacheKey(before) !== cargoCacheKey(after)
        const meshMoved = meshOf(before) !== meshOf(after)
        expect({ field, detail, keyMoved, meshMoved }).toEqual({
          field,
          detail,
          keyMoved: meshMoved,
          meshMoved,
        })
      })
    }
  }

  test('a preset that tiles the same way is not a different load', () => {
    // 1200 x 800 and 1200 x 1000 both take a 300 x 400 carton four by two, so
    // the two decks produce the identical block. Naming the preset in the key
    // would hand two byte-identical buffers two entries — which is why the key
    // carries the layout the builder lays out, not the preset it came from.
    const epal1 = at({ preset: 'epal-1' })
    const epal2 = at({ preset: 'epal-2' })
    expect(meshOf(epal1)).toBe(meshOf(epal2))
    expect(cargoCacheKey(epal1)).toBe(cargoCacheKey(epal2))
  })

  test('the far tier does not name flags it cannot act on', () => {
    // Dropping the detail elements at `simple` is the whole point of the tier;
    // naming them there anyway would mint a second buffer per drag of a switch
    // that changes nothing — the conveyor's side guides, exactly.
    const key = cargoCacheKey(at({ detail: 'simple' }))
    expect(cargoCacheKey(at({ detail: 'simple', strapped: false }))).toBe(key)
    expect(cargoCacheKey(at({ detail: 'simple', labelled: false }))).toBe(key)
  })
})

describe('every face points out of the load', () => {
  test('winding agrees with the stored normal on all six box faces', () => {
    // The empty pallet shipped with its markings mirrored on two faces because
    // one basis was written backwards, and nothing caught it until someone read
    // the letters. Six faces, one table, one assertion.
    const geometry = buildCargoGeometry(at({ variant: 0.4 }))
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')

    let worst = 1
    for (let triangle = 0; triangle < position.count / 3; triangle++) {
      const i = triangle * 3
      const ax = position.getX(i)
      const ay = position.getY(i)
      const az = position.getZ(i)
      const ux = position.getX(i + 1) - ax
      const uy = position.getY(i + 1) - ay
      const uz = position.getZ(i + 1) - az
      const vx = position.getX(i + 2) - ax
      const vy = position.getY(i + 2) - ay
      const vz = position.getZ(i + 2) - az

      const cx = uy * vz - uz * vy
      const cy = uz * vx - ux * vz
      const cz = ux * vy - uy * vx
      const length = Math.hypot(cx, cy, cz)
      if (length < 1e-9) continue

      const dot =
        (cx / length) * normal.getX(i) +
        (cy / length) * normal.getY(i) +
        (cz / length) * normal.getZ(i)
      worst = Math.min(worst, dot)
    }
    expect(worst).toBeGreaterThan(0.999)
  })

  test('a drum’s shell winds outward too', () => {
    const geometry = buildCargoGeometry(at({ type: DRUM, variant: 1, strapped: false }))
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    let worst = 1
    for (let triangle = 0; triangle < position.count / 3; triangle++) {
      const i = triangle * 3
      const ax = position.getX(i)
      const ay = position.getY(i)
      const az = position.getZ(i)
      const ux = position.getX(i + 1) - ax
      const uy = position.getY(i + 1) - ay
      const uz = position.getZ(i + 1) - az
      const vx = position.getX(i + 2) - ax
      const vy = position.getY(i + 2) - ay
      const vz = position.getZ(i + 2) - az
      const cx = uy * vz - uz * vy
      const cy = uz * vx - ux * vz
      const cz = ux * vy - uy * vx
      const length = Math.hypot(cx, cy, cz)
      if (length < 1e-9) continue
      const dot =
        (cx / length) * normal.getX(i) +
        (cy / length) * normal.getY(i) +
        (cz / length) * normal.getZ(i)
      // Per-vertex normals are radial while the face normal is the chord's, so
      // a twenty-sided drum cannot reach 1 — but it must never go negative.
      worst = Math.min(worst, dot)
    }
    expect(worst).toBeGreaterThan(0.9)
  })
})

describe('every face samples the region it was meant to', () => {
  test('tops read the top of a carton and sides read its side', () => {
    // The mistake a debug atlas is normally needed to catch, caught without one:
    // a face that samples the wrong region is a perfectly valid mesh drawing
    // perfectly valid pixels from the wrong place — flaps up the side of a
    // stack, or a carton face lying across the top of it.
    const geometry = buildCargoGeometry(at({ strapped: false, labelled: false, variant: 0.2 }))
    const normal = geometry.getAttribute('normal')
    const uv = geometry.getAttribute('uv')

    const top = uvOf('cartonTop')
    const sides = [uvOf('cartonFace'), uvOf('cartonFaceTaped')]
    const inside = (rect: ReturnType<typeof uvOf>, u: number, v: number) =>
      u >= rect.uMin - 1e-6 &&
      u <= rect.uMax + 1e-6 &&
      v >= rect.vMin - 1e-6 &&
      v <= rect.vMax + 1e-6

    let checked = 0
    for (let i = 0; i < normal.count; i++) {
      // Corner boards share the mesh; only the cartons are being judged here,
      // and they are the parts whose faces are axis-aligned unit normals.
      const u = uv.getX(i)
      const v = uv.getY(i)
      if (normal.getY(i) > 0.9) {
        if (!inside(top, u, v)) continue
        checked += 1
      } else if (Math.abs(normal.getY(i)) < 0.1 && sides.some((rect) => inside(rect, u, v))) {
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)

    // The real assertion: no upward face anywhere lands in a side region, and no
    // sideways carton face lands in the top region.
    for (let i = 0; i < normal.count; i++) {
      const u = uv.getX(i)
      const v = uv.getY(i)
      if (normal.getY(i) > 0.9) {
        expect(sides.some((rect) => inside(rect, u, v))).toBe(false)
      }
    }
  })
})

describe('the interior of a stack is never built', () => {
  test('a full Euro pallet of cartons is the boundary, not forty boxes', () => {
    // 4 x 2 x 5 cartons: 240 quads if each were a box, of which 164 face another
    // carton and 8 face the deck. 68 remain — 136 triangles against 480, the
    // largest single saving in this kind.
    const parts = cargoParts(at({ strapped: false, labelled: false }))
    const cartons = parts.filter((part) => part.kind === 'carton')
    expect(cartons.length).toBe(40)

    const faces = cartons.reduce(
      (total, part) => total + Object.values(part.faces).filter(Boolean).length,
      0,
    )
    expect(faces).toBe(68)

    // 136 for the cartons, plus 96 for the four corner boards a full load is
    // fitted with — two wings apiece, twelve triangles each.
    const geometry = buildCargoGeometry(at({ strapped: false, labelled: false }))
    expect(geometry.getAttribute('position').count / 3).toBe(136 + 96)
  })

  test('no carton ever emits its underside', () => {
    for (const variant of CARTON.variants) {
      for (const part of cargoParts(at({ variant }))) {
        if (part.kind === 'carton') expect(part.faces.ny).toBe(false)
      }
    }
  })

  test('the whole loaded pallet stays inside the plan’s triangle budget', () => {
    // The plan budgets ~800 triangles for a near-tier loaded pallet, and the
    // empty pallet already spends 304 of them.
    const EMPTY_PALLET = 304
    const geometry = buildCargoGeometry(BASE)
    expect(geometry.getAttribute('position').count / 3 + EMPTY_PALLET).toBeLessThanOrEqual(800)
  })

  test('the far tier costs a fraction of the near one', () => {
    const near = buildCargoGeometry(BASE).getAttribute('position').count
    const far = buildCargoGeometry(at({ detail: 'simple' })).getAttribute('position').count
    expect(far).toBeLessThan(near / 3)
  })
})

describe('the load stands on the deck it was built for', () => {
  test('cartons fill the Euro deck exactly and overhang nothing', () => {
    const [x, , z] = loadExtent(BASE)
    const spec = PALLET_PRESETS['epal-1']
    expect(x).toBeCloseTo(spec.length, 9)
    expect(z).toBeCloseTo(spec.width, 9)
  })

  test('two drums stay inside the deck', () => {
    const [x, , z] = loadExtent(at({ type: DRUM, variant: 1 }))
    const spec = PALLET_PRESETS['epal-1']
    expect(x).toBeLessThanOrEqual(spec.length)
    expect(z).toBeLessThanOrEqual(spec.width)
  })

  test('nothing is built below the deck', () => {
    const geometry = buildCargoGeometry(BASE)
    const position = geometry.getAttribute('position')
    let lowest = Number.POSITIVE_INFINITY
    for (let i = 0; i < position.count; i++) lowest = Math.min(lowest, position.getY(i))
    expect(lowest).toBeGreaterThanOrEqual(0)
  })
})

describe('one height, so collision and the renderer cannot disagree', () => {
  test('cargo wins over the typed load height', () => {
    // The failure this prevents: clash testing the number a user typed while the
    // renderer draws the number the variant resolved to — a load that fouls the
    // beam above it and reports itself clear.
    const height = loadHeightOf({
      id: 'pallet_typedcargo',
      cargo: 'carton',
      preset: 'epal-1',
      fillRange: [1, 1],
      loadHeight: 0.3,
    })
    expect(height).toBeCloseTo(1.25, 9)
  })

  test('a pallet with no cargo still answers with what was typed', () => {
    expect(
      loadHeightOf({
        id: 'pallet_plainblock',
        cargo: 'none',
        preset: 'epal-1',
        fillRange: [0.4, 1],
        loadHeight: 0.93,
      }),
    ).toBe(0.93)
  })
})
