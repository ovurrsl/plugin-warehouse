import { describe, expect, test } from 'bun:test'
import { FILM_CLEARANCE_M, STRAP_OFFSET_M } from './cargo-constants'
import { buildCargoGeometry, cargoCacheKey } from './cargo-geometry'
import { type CargoInput, loadExtent } from './cargo-parts'
import { CARTON, DRUM } from './cargo-types'
import { buildFilmGeometry, filmCacheKey, filmRings, filmSkirtDropM, getFilmGeometry } from './film'
import { PALLET_PRESET_IDS, specOf } from './presets'

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

/** The blocks the EPAL stamps are branded on are 78 mm tall, under 44 mm of
 *  boards. Inlined rather than imported: `geometry-builder` keeps them private,
 *  and the point of this figure here is to be an independent statement of it. */
const BLOCK_HEIGHT_M = 0.078

describe('the sleeve stands off the goods and stops above the stamps', () => {
  test('the film never touches the load, at any ring, on any preset', () => {
    // The clearance is what makes it a wrap rather than a skin, and the waist
    // pull-in is the one thing that could eat it. Capped at the same 1.5 mm the
    // strapping stands off by — this package's declared z-fight margin.
    const offenders: string[] = []
    for (const preset of PALLET_PRESET_IDS) {
      for (const type of [CARTON, DRUM]) {
        for (const variant of type.variants) {
          const input = at({ type, preset, variant })
          const [loadX, , loadZ] = loadExtent(input)
          if (loadX <= 0) continue
          for (const ring of filmRings(input)) {
            const gapX = ring.halfX - loadX / 2
            const gapZ = ring.halfZ - loadZ / 2
            if (gapX < STRAP_OFFSET_M - 1e-9 || gapZ < STRAP_OFFSET_M - 1e-9) {
              offenders.push(`${type.id}/${preset}@${variant} y=${ring.y}: ${gapX} / ${gapZ}`)
            }
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('the skirt laps the boards and stops before the blocks', () => {
    // **The first line of the acceptance list**: the EPAL, EUR and IPPC stamps
    // are branded on the blocks' outward faces and have to stay readable under
    // the wrap. The plan's flat 120 mm would bury them — 120 plus the blocks'
    // own 78 is 198 against a 144 mm pallet.
    for (const preset of PALLET_PRESET_IDS) {
      const drop = filmSkirtDropM(preset)
      expect(drop).toBeGreaterThan(0)
      expect(drop + BLOCK_HEIGHT_M).toBeLessThanOrEqual(specOf(preset).height + 1e-9)
    }
    expect(filmSkirtDropM('epal-1')).toBeCloseTo(0.044, 6)
    // The figure the plan asked for, shown failing the same test.
    expect(0.12 + BLOCK_HEIGHT_M).toBeGreaterThan(specOf('epal-1').height)
  })

  test('the sleeve reaches the top of the load and no further', () => {
    const input = at({})
    const [, loadY] = loadExtent(input)
    const rings = filmRings(input)
    expect(rings[rings.length - 1]?.y).toBeCloseTo(loadY, 9)
    expect(rings[0]?.y).toBeCloseTo(-filmSkirtDropM('epal-1'), 9)
  })
})

describe('the mesh is built the way the renderer needs it', () => {
  test('eight facets, three bands and a cap', () => {
    const geometry = buildFilmGeometry(BASE)
    // 8 facets x 3 bands x 2 triangles, plus an 8-triangle cap.
    expect(geometry.getAttribute('position').count / 3).toBe(8 * 3 * 2 + 8)
  })

  test('every facet faces out', () => {
    // The cap shipped inverted the first time it was built, which draws the top
    // of the sleeve only from underneath — invisible from every angle a
    // warehouse is looked at, and obvious from exactly one.
    const geometry = buildFilmGeometry(BASE)
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
      if (length < 1e-12) continue
      worst = Math.min(
        worst,
        (cx / length) * normal.getX(i) +
          (cy / length) * normal.getY(i) +
          (cz / length) * normal.getZ(i),
      )
    }
    expect(worst).toBeGreaterThan(0.999)
  })

  test('the film writes four colour components and the cargo writes three', () => {
    // The silent failure this pins: a three-component colour is padded to
    // `vec4(rgb, 1)` with no error anywhere, so tidying the film's sink to
    // match the cargo's would make the whole sleeve opaque and nothing would
    // say why.
    expect(buildFilmGeometry(BASE).getAttribute('color').itemSize).toBe(4)
    expect(buildCargoGeometry(BASE).getAttribute('color').itemSize).toBe(3)
  })

  test('the sleeve is a clearance larger than the load it wraps', () => {
    const geometry = buildFilmGeometry(BASE)
    geometry.computeBoundingBox()
    const [loadX, , loadZ] = loadExtent(BASE)
    expect(geometry.boundingBox?.max.x).toBeCloseTo(loadX / 2 + FILM_CLEARANCE_M, 6)
    expect(geometry.boundingBox?.max.z).toBeCloseTo(loadZ / 2 + FILM_CLEARANCE_M, 6)
  })
})

describe('the film has its own key, because it depends on the pallet as well', () => {
  test('two decks that carry the identical load still need different sleeves', () => {
    // **The proof that the two key spaces cannot merge.** An EPAL 1 and a
    // plastic euro are both 1200 x 800, so a carton load tiles them identically
    // and they genuinely share one cargo buffer. Their decks are 144 mm and
    // 160 mm, so the film laps a different distance down each and must not.
    const wood = at({ preset: 'epal-1' })
    const plastic = at({ preset: 'plastic-euro' })
    expect(cargoCacheKey(wood)).toBe(cargoCacheKey(plastic))
    expect(filmCacheKey(wood)).not.toBe(filmCacheKey(plastic))
    expect(filmSkirtDropM('epal-1')).not.toBeCloseTo(filmSkirtDropM('plastic-euro'), 4)
  })

  test('one sleeve serves both tiers', () => {
    // `loadExtent` reads type, preset and variant and never the tier, so the
    // far tier's single box has exactly the near tier's extent. A second sleeve
    // would be a byte-identical buffer under a second key.
    expect(filmCacheKey(at({ detail: 'simple' }))).toBe(filmCacheKey(at({ detail: 'full' })))
  })

  test('the detail flags never reach it', () => {
    // Strapping and the label are inside the sleeve and move none of its
    // vertices. Naming them would split the cache for nothing.
    const key = filmCacheKey(BASE)
    expect(filmCacheKey(at({ strapped: false }))).toBe(key)
    expect(filmCacheKey(at({ labelled: false }))).toBe(key)
    expect(filmCacheKey(at({ color: 'blue' }))).toBe(key)
  })

  test('a sleeve survives the eviction its own arrival triggers', () => {
    let lastInput = BASE
    let last = getFilmGeometry(lastInput)
    for (const preset of PALLET_PRESET_IDS) {
      for (const type of [CARTON, DRUM]) {
        for (const variant of type.variants) {
          lastInput = at({ preset, type, variant })
          if (loadExtent(lastInput)[0] <= 0) continue
          last = getFilmGeometry(lastInput)
        }
      }
    }
    expect(getFilmGeometry(lastInput)).toBe(last)
  })
})
