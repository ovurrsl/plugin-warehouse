import { describe, expect, test } from 'bun:test'
import {
  CARGO_TYPES,
  CARTON,
  cargoHeightM,
  DRUM,
  draw,
  fillSeed,
  resolveVariant,
  unitCount,
  unitsPerLayer,
} from './cargo-types'
import { PALLET_PRESETS } from './presets'
import { PalletNode } from './schema'

describe('a load is a function of its pallet’s id, never of the clock', () => {
  test('the same id resolves to the same fill, every time', () => {
    // The requirement the whole design turns on: reload, export, re-import and
    // undo must all reproduce the warehouse exactly. `Math.random()` would give
    // a different scene per session and make two people looking at one file see
    // different things.
    const ids = ['pallet_aaaaaaaa', 'pallet_bbbbbbbb', 'pallet_zzzzzzzz']
    for (const id of ids) {
      const first = resolveVariant(CARTON, id, [0.4, 1])
      for (let repeat = 0; repeat < 5; repeat++) {
        expect(resolveVariant(CARTON, id, [0.4, 1])).toBe(first)
      }
    }
  })

  test('different ids resolve differently, across the prepared levels', () => {
    // A seeding that produced one answer for every pallet would be worse than
    // no seeding: ten thousand identical loads is the look this exists to break.
    const seen = new Set<number>()
    for (let index = 0; index < 200; index++) {
      seen.add(resolveVariant(CARTON, `pallet_${index.toString(36).padStart(8, '0')}`, [0.2, 1]))
    }
    expect(seen.size).toBeGreaterThan(2)
  })

  test('the draw is a generator, not the hash’s low bits', () => {
    // `seed % variants.length` clusters, because the low bits of a hash are not
    // uniform — ids ending in the same character would tend to the same fill,
    // which is exactly the pattern the seeding exists to break.
    const buckets = new Array(10).fill(0)
    for (let index = 0; index < 4000; index++) {
      buckets[Math.min(9, Math.floor(draw(fillSeed(`pallet_${index}`)) * 10))] += 1
    }
    // No decile should be empty, and none should hold more than a quarter.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(0)
      expect(count).toBeLessThan(1000)
    }
  })

  test('every resolved fill is one of the prepared levels', () => {
    // The contradiction this resolves: fill must be random and geometry must be
    // shared. A continuous fill would mint a buffer per pallet.
    for (const type of Object.values(CARGO_TYPES)) {
      for (let index = 0; index < 100; index++) {
        const variant = resolveVariant(type, `pallet_${index}`, [0, 1])
        expect(type.variants).toContain(variant)
      }
    }
  })

  test('a locked range gives one answer for every pallet in it', () => {
    // What the panel's "fixed fill" is: a range of zero width.
    const ids = ['pallet_11111111', 'pallet_22222222', 'pallet_33333333']
    const answers = new Set(ids.map((id) => resolveVariant(CARTON, id, [0.6, 0.6])))
    expect(answers.size).toBe(1)
    expect([...answers][0]).toBe(0.6)
  })
})

describe('a fill percentage means different things to different cargo', () => {
  test('cartons tile the deck exactly, which is why the module is 300 × 400', () => {
    // 1200 × 800 divides into a 400 × 300 module eight times a layer with
    // nothing left over. A carton that did not tile would leave a ragged edge
    // that reads as a modelling error from every angle.
    const perLayer = unitsPerLayer(CARTON, 'epal-1')
    expect(perLayer.alongX * perLayer.alongZ).toBe(8)
    const spec = PALLET_PRESETS['epal-1']
    expect(perLayer.alongX * CARTON.unitM[0]).toBeCloseTo(spec.length, 9)
    expect(perLayer.alongZ * CARTON.unitM[2]).toBeCloseTo(spec.width, 9)
  })

  test('drums fill by count and stand one high, because two drums are two drums', () => {
    expect(DRUM.fill).toBe('count')
    expect(unitCount(DRUM, 'epal-1', 0.5)).toBe(1)
    expect(unitCount(DRUM, 'epal-1', 1)).toBe(2)
    // Height does not follow the count for a count-filled type.
    expect(cargoHeightM(DRUM, 0.5)).toBeCloseTo(cargoHeightM(DRUM, 1), 9)
    expect(cargoHeightM(DRUM, 1)).toBeCloseTo(0.88, 9)
  })

  test('cartons fill by layers, so the height follows the variant', () => {
    expect(cargoHeightM(CARTON, 0.2)).toBeCloseTo(0.25, 9)
    expect(cargoHeightM(CARTON, 1)).toBeCloseTo(1.25, 9)
    expect(unitCount(CARTON, 'epal-1', 0.2)).toBe(8)
    expect(unitCount(CARTON, 'epal-1', 1)).toBe(40)
  })

  test('two drums fit across a Euro deck and a third would not', () => {
    // Arithmetic rather than choice: 2 × 585 is 1170 against 1200.
    const spec = PALLET_PRESETS['epal-1']
    expect(2 * DRUM.unitM[0]).toBeLessThanOrEqual(spec.length)
    expect(3 * DRUM.unitM[0]).toBeGreaterThan(spec.length)
    expect(DRUM.overhang).toBe(false)
  })
})

describe('the field lands without touching a single saved scene', () => {
  test('a pallet parsed without cargo is the pallet this kind always drew', () => {
    // The compatibility decision, stated as a test: a scene saved before these
    // fields existed parses without them and comes back as an empty pallet.
    //
    // The `loadHeight` in this fixture is deliberate — it is what such a scene
    // really carries. The field was removed, `BaseNode` is a plain z.object()
    // and strips unknown keys, so it is dropped rather than migrated. That is
    // the whole compatibility story for an external pack, which cannot add a
    // `migrateNodes` entry to the host.
    const legacy = PalletNode.parse({ id: 'pallet_legacy1', preset: 'epal-1', loadHeight: 0.93 })
    expect(legacy.cargo).toBe('none')
    expect('loadHeight' in legacy).toBe(false)
  })

  test('the stored range is the input and the fill is derived, never stored', () => {
    // A stored roll would have to survive export, import and undo; a derived one
    // cannot drift because there is nothing to drift.
    const node = PalletNode.parse({ id: 'pallet_derived', cargo: 'carton' })
    expect(node.fillRange).toEqual([0.4, 1])
    expect(Object.keys(node)).not.toContain('fill')
    expect(Object.keys(node)).not.toContain('resolvedVariant')
  })

  test('each type ships with the details it is actually built with', () => {
    // Cartons are filmed, drums are strapped — the catalogue's own practice, and
    // the reason these are per-type defaults rather than one global setting.
    expect(CARTON.defaults.wrap).toBe(true)
    expect(DRUM.defaults.wrap).toBe(false)
    expect(DRUM.defaults.strapping).toBe(true)
  })
})
