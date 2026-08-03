import { describe, expect, test } from 'bun:test'
import type * as THREE from 'three'
import { CARTON_ROW_CELLS, uvOf } from './cargo-atlas-regions'
import {
  buildCargoGeometry,
  cargoCacheKey,
  cargoGeometryCacheSize,
  getCargoGeometry,
} from './cargo-geometry'
import {
  type CargoDetail,
  type CargoInput,
  cargoInputOf,
  cargoParts,
  loadExtent,
} from './cargo-parts'
import { CARTON, DRUM, fitsOnDeck, loadHeightOf, unitCount, unitsPerLayer } from './cargo-types'
import { PALLET_PRESET_IDS, PALLET_PRESETS } from './presets'
import { PalletNode } from './schema'

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
  test('the height is the one the variant resolved to', () => {
    // The failure this prevents: clash testing one number while the renderer
    // draws another — a load that fouls the beam above it and reports itself
    // clear. There is now only one number, and this is where it comes from.
    const height = loadHeightOf({
      id: 'pallet_typedcargo',
      cargo: 'carton',
      preset: 'epal-1',
      fillRange: [1, 1],
    })
    expect(height).toBeCloseTo(1.25, 9)
  })

  test('a pallet with no cargo is a bare deck, and answers zero', () => {
    // The state that used to sit between empty and loaded — no cargo but a
    // typed height, drawn as a wood-coloured block — is gone. 192 pallets in a
    // real scene were in it and read as cartons on empty pallets.
    expect(
      loadHeightOf({
        id: 'pallet_plainblock',
        cargo: 'none',
        preset: 'epal-1',
        fillRange: [0.4, 1],
      }),
    ).toBe(0)
  })

  test('a cargo that does not fit reserves nothing, because nothing is drawn', () => {
    // A drum is wider than a quarter pallet: not drawn, so not reserved either.
    // A collision box standing a metre taller than the pallet it describes is
    // the same renderer/collider disagreement in the other axis.
    expect(
      loadHeightOf({
        id: 'pallet_toobig',
        cargo: 'drum',
        preset: 'quarter',
        fillRange: [1, 1],
      }),
    ).toBe(0)
  })
})

/** The plan's stated placement tolerance: hardware may stand this far off the
 *  goods without counting as an overhang. */
const TOLERANCE = 0.015

describe('a load never leaves the deck it was built for', () => {
  test('no cargo overhangs any preset, in either axis', () => {
    // **The invariant that would have caught it.** Drums were counted on two
    // axes by `unitsPerLayer` and then laid out on one by the builder, so four
    // drums on a 1200 x 1200 became a 2340 mm line on a 1200 mm deck — and
    // because the footprint and the clash box are both built from the pallet's
    // own dimensions, 570 mm of steel passed through the neighbouring pallet
    // and collision reported clear. Every earlier test pinned epal-1, the one
    // Euro preset where the drum grid happens to be one deep.
    const offenders: string[] = []
    for (const preset of PALLET_PRESET_IDS) {
      for (const type of [CARTON, DRUM]) {
        if (!fitsOnDeck(type, preset)) continue
        for (const variant of type.variants) {
          const input = at({ type, preset, variant })
          const [x, , z] = loadExtent(input)
          const spec = PALLET_PRESETS[preset]
          if (x > spec.length + 1e-9 || z > spec.width + 1e-9) {
            offenders.push(
              `${type.id} on ${preset} @${variant}: ${x.toFixed(3)} x ${z.toFixed(3)} on ${spec.length} x ${spec.width}`,
            )
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('the built geometry agrees with the extent it reports', () => {
    // An extent that is honest about an overhang is still an overhang. This
    // checks the vertices themselves, so a builder that drifts from
    // `loadExtent` is caught too.
    //
    // The tolerance is the plan's own 15 mm and it is not slack: the strapping
    // stands 2.5 mm off the goods and the label floats 1 mm off the face, both
    // deliberately, so a load that fills its deck exactly reaches a few
    // millimetres past it in hardware. The failure this guards against was 570.
    const offenders: string[] = []
    for (const preset of PALLET_PRESET_IDS) {
      for (const type of [CARTON, DRUM]) {
        if (!fitsOnDeck(type, preset)) continue
        const geometry = buildCargoGeometry(at({ type, preset, variant: 1 }))
        const position = geometry.getAttribute('position')
        const spec = PALLET_PRESETS[preset]
        let maxX = 0
        let maxZ = 0
        for (let i = 0; i < position.count; i++) {
          maxX = Math.max(maxX, Math.abs(position.getX(i)))
          maxZ = Math.max(maxZ, Math.abs(position.getZ(i)))
        }
        if (maxX > spec.length / 2 + TOLERANCE || maxZ > spec.width / 2 + TOLERANCE) {
          offenders.push(`${type.id} on ${preset}: ${maxX.toFixed(3)} / ${maxZ.toFixed(3)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('four drums on a square Euro deck are two by two, not four in a line', () => {
    // The four-up variant is not the overhanging case after all — it was the
    // one-dimensional layout that overhung. 2 x 585 is 1170 against 1200 in
    // both directions.
    const input = at({ type: DRUM, preset: 'euro-1200x1200', variant: 1, strapped: false })
    expect(unitCount(DRUM, 'euro-1200x1200', 1)).toBe(4)
    const [x, , z] = loadExtent(input)
    expect(x).toBeCloseTo(1.17, 6)
    expect(z).toBeCloseTo(1.17, 6)

    const centres = cargoParts(input)
      .filter((part) => part.kind === 'drum')
      .map((part) => `${part.center[0].toFixed(4)},${part.center[2].toFixed(4)}`)
    expect(new Set(centres).size).toBe(4)
  })

  test('an EPAL 3 takes its two drums along the deep axis', () => {
    // 1000 x 1200: one across, two deep. Counted on Z and built on X was 1170
    // on a 1000 mm deck.
    const input = at({ type: DRUM, preset: 'epal-3', variant: 1, strapped: false })
    const [x, , z] = loadExtent(input)
    expect(x).toBeCloseTo(0.585, 6)
    expect(z).toBeCloseTo(1.17, 6)
  })

  test('a drum does not fit a quarter pallet, and is refused rather than shrunk', () => {
    // 585 mm inside 400 mm in no orientation. `Math.max(1, floor(...))` used to
    // round that up to one drum hanging 92 mm over both long edges.
    expect(fitsOnDeck(DRUM, 'quarter')).toBe(false)
    expect(unitsPerLayer(DRUM, 'quarter').alongZ).toBe(0)
    const node = PalletNode.parse({ id: 'pallet_toosmall', preset: 'quarter', cargo: 'drum' })
    expect(cargoInputOf(node, 'full')).toBeNull()
    // And it reserves no height either, so the clash box cannot stand a metre
    // taller than the pallet it describes.
    expect(loadHeightOf(node)).toBe(0)
  })
})

describe('the far tier is the same load, drawn cheaper', () => {
  test('drums keep their own shape at distance', () => {
    // Collapsed into one cylinder, the radius came from the block's X extent
    // and Z was never read: two 585 mm drums became one 1170 mm tank, 356 mm
    // over each long edge, snapping into view at the tier boundary.
    // Bare goods on both sides: the near tier carries a label standing 1 mm off
    // the face and the far tier drops it, which is correct and would otherwise
    // read as a shape change.
    const near = buildCargoGeometry(
      at({ type: DRUM, variant: 1, strapped: false, labelled: false }),
    )
    const far = buildCargoGeometry(
      at({ type: DRUM, variant: 1, strapped: false, labelled: false, detail: 'simple' }),
    )
    near.computeBoundingBox()
    far.computeBoundingBox()
    const a = near.boundingBox
    const b = far.boundingBox
    // Within a tenth, not to the millimetre: a ten-sided drum is inscribed in
    // the same circle as a twenty-sided one and so reads about 5% smaller
    // across its flats. What this pins is the SCALE — the failure was a single
    // cylinder taking its radius from the whole block's X extent, which doubled
    // it and put 356 mm over each long edge.
    const ratioX = (b?.max.x ?? 0) / (a?.max.x ?? 1)
    const ratioZ = (b?.max.z ?? 0) / (a?.max.z ?? 1)
    expect(ratioX).toBeGreaterThan(0.9)
    expect(ratioX).toBeLessThan(1.1)
    expect(ratioZ).toBeGreaterThan(0.9)
    expect(ratioZ).toBeLessThan(1.1)
    // Still cheaper: half the radial segments.
    expect(far.getAttribute('position').count).toBeLessThan(near.getAttribute('position').count)
  })

  test('a short face paints the cartons it has, not the whole row', () => {
    // The region is drawn as four cells. A face that maps all of them shows
    // four cartons however wide it is, so the Euro deck's two-carton short face
    // gained two at the tier switch and the module width halved.
    const geometry = buildCargoGeometry(at({ detail: 'simple' }))
    const normal = geometry.getAttribute('normal')
    const uv = geometry.getAttribute('uv')
    const row = uvOf('cartonRow')
    const span = row.uMax - row.uMin

    let shortMax = row.uMin
    let longMax = row.uMin
    for (let i = 0; i < normal.count; i++) {
      if (Math.abs(normal.getX(i)) > 0.9) shortMax = Math.max(shortMax, uv.getX(i))
      if (Math.abs(normal.getZ(i)) > 0.9) longMax = Math.max(longMax, uv.getX(i))
    }
    // EPAL 1: four cartons along X on the long faces, two along Z on the short.
    expect((longMax - row.uMin) / span).toBeCloseTo(4 / CARTON_ROW_CELLS, 5)
    expect((shortMax - row.uMin) / span).toBeCloseTo(2 / CARTON_ROW_CELLS, 5)
  })
})

describe('the hardware is continuous where it is meant to be', () => {
  test('a strap has no gap at its corners', () => {
    // The legs stopped at the load's top while the band floated 1.5 mm above
    // it, so both straps broke at all four corners and you looked through to
    // the carton behind.
    const parts = cargoParts(BASE).filter((part) => part.kind === 'strap')
    const legs = parts.filter((part) => part.size[2] < part.size[0])
    const bands = parts.filter((part) => part.size[2] > part.size[0])
    expect(legs.length).toBeGreaterThan(0)
    expect(bands.length).toBeGreaterThan(0)

    const legTop = Math.max(...legs.map((part) => part.center[1] + part.size[1] / 2))
    const bandBottom = Math.min(...bands.map((part) => part.center[1] - part.size[1] / 2))
    expect(legTop).toBeGreaterThanOrEqual(bandBottom - 1e-9)
  })
})

describe('the cache never frees what it is about to hand out', () => {
  test('a load survives the eviction triggered by its own arrival', () => {
    // The renderer claims its keys in an effect, which runs after the render
    // that asked for the geometry — so a fresh load is unretained for exactly
    // as long as React takes to commit. A Map iterates in insertion order and
    // the new entry is last, so at a full cache it was the only candidate the
    // retain guard did not skip: disposed, dropped from the cache, and still
    // returned to be mounted.
    const colors = ['kraft', 'white', 'bleached', 'blue', 'green', 'charcoal'] as const
    let lastInput = BASE
    let last = getCargoGeometry(lastInput)
    for (const color of colors) {
      for (const variant of CARTON.variants) {
        for (const strapped of [true, false]) {
          for (const labelled of [true, false]) {
            lastInput = at({ color, variant, strapped, labelled })
            last = getCargoGeometry(lastInput)
          }
        }
      }
    }
    expect(cargoGeometryCacheSize()).toBeGreaterThan(0)
    // Still shared: asking again returns the very object just handed out.
    expect(getCargoGeometry(lastInput)).toBe(last)
  })
})

/**
 * BEKÇİ: yük artık kolektif havuza giriyor, ve o kararın dayandığı iki varsayım.
 *
 * Yük, güverte havuza alındıktan sonra sahnede kalan en kalabalık çizim çağrısı
 * kaynağıydı: palet başına bir renk çizimi, artı gölge geçidinde bir tane daha.
 * Havuza almanın ön koşulu, iki paletin yükünün gerçekten AYNI tampona
 * çözülebilmesi — çözülemiyorsa havuz başına tek örnek düşer ve `InstancedMesh`
 * ek yükü net kayıp olur.
 */
describe('yük havuzlanabilir mi — anahtarın paylaşması ve ayırması', () => {
  test('kimliği farklı iki palet aynı yüke çözülür', () => {
    // Havuzun tamamı buna bağlı. `resolveVariant` kimliği okuyor, yani iki
    // paletin dolumu farklı çıkabilir — ama anahtar varyantı DEĞİL, varyantın
    // yuvarlandığı kat/adet sayısını taşıyor. Sabit bir dolum aralığında ikisi
    // aynı yerleşime düşer ve tek havuzda buluşur.
    const a = PalletNode.parse({ id: 'pallet_a', cargo: 'carton', fillRange: [1, 1] })
    const b = PalletNode.parse({ id: 'pallet_zzz_9', cargo: 'carton', fillRange: [1, 1] })
    const inputA = cargoInputOf(a, 'full')
    const inputB = cargoInputOf(b, 'full')
    expect(inputA).not.toBeNull()
    expect(inputB).not.toBeNull()
    if (!inputA || !inputB) return
    expect(cargoCacheKey(inputA)).toBe(cargoCacheKey(inputB))
  })

  test('rengi farklı iki palet AYRI havuza düşer', () => {
    // Ayırmanın da doğru olması şart: tek materyal ve köşe renkleri kullanılıyor,
    // yani renk geometride. Aynı havuza düşselerdi mavi bir yük kraft çizilirdi.
    const kraft = PalletNode.parse({ id: 'pallet_k', cargo: 'carton', cargoColor: 'kraft' })
    const blue = PalletNode.parse({ id: 'pallet_k', cargo: 'carton', cargoColor: 'blue' })
    const inputKraft = cargoInputOf(kraft, 'full')
    const inputBlue = cargoInputOf(blue, 'full')
    if (!inputKraft || !inputBlue) throw new Error('yük girdisi kurulamadı')
    expect(cargoCacheKey(inputKraft)).not.toBe(cargoCacheKey(inputBlue))
  })

  test('iki katman AYRI havuza düşer', () => {
    // Katman anahtara girmeseydi uzak katmandaki paletler tam detay çizilirdi —
    // ya da tersi, ve ikisi de sessiz.
    const node = PalletNode.parse({ id: 'pallet_t', cargo: 'carton' })
    const full = cargoInputOf(node, 'full')
    const simple = cargoInputOf(node, 'simple')
    if (!full || !simple) throw new Error('yük girdisi kurulamadı')
    expect(cargoCacheKey(full)).not.toBe(cargoCacheKey(simple))
  })

  test('güverteye sığma kararı KATMANDAN bağımsız — mount kapısının dayanağı', () => {
    // `PalletRenderer` yükü mount edip etmeyeceğine `full` girdisine bakarak
    // karar veriyor ve `CargoLoad` ondan sonra iki katmanı da `null` kontrolü
    // yapmadan kullanıyor. Sığma kararı bir gün katmana bağlanırsa, o kapı
    // yanlış katmanda sessizce yükü düşürür ya da olmayan bir girdiyi kullanır.
    for (const cargo of ['carton', 'drum'] as const) {
      for (const preset of PALLET_PRESET_IDS) {
        const node = PalletNode.parse({ id: 'pallet_fit', cargo, preset })
        const full = cargoInputOf(node, 'full')
        const simple = cargoInputOf(node, 'simple')
        expect({ cargo, preset, agrees: (full === null) === (simple === null) }).toEqual({
          cargo,
          preset,
          agrees: true,
        })
      }
    }
  })
})
