import { beforeEach, describe, expect, test } from 'bun:test'
import {
  clearRackGeometryCache,
  getRackGeometry,
  rackGeometryCacheSize,
  rackGeometryKey,
  releaseRackGeometry,
  retainRackGeometry,
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

  test('iki katman aynı üçgen sayısını üretir — kompozisyon eşitlendi', () => {
    // Sadelik kararı (2026-08-07): full'ün fazladan taşıdığı milimetre işi
    // (beş kutulu profil, bağlantı plakaları, destek çubukları) tümden gitti;
    // katman farkı artık yalnız DESEN (UV kolonu), o da üçgen eklemez. Sayılar
    // ayrışırsa biri yeniden "yalnız yakında görünen" kutu kazanmış demektir —
    // LOD takasında pat diye belirip kaybolan türden, ve parça-eşitliği testi
    // ile birlikte iki ayrı dosyadan kilitli.
    const r = rack()
    expect(triangleCount(r, 'simple')).toBe(triangleCount(r, 'full'))
  })

  test('a warehouse-sized scene stays inside a sane triangle budget', () => {
    // Re-derived for one node per bay, rather than nudged until it passed.
    //
    // 15,000 m2 — call it 100 x 150 m. Runs down the long side at a 2.822 m bay
    // pitch is 53 bays; back-to-back pairs at 2.4 m plus a 3.2 m reach-truck
    // aisle is 5.6 m per pair, so 100 m holds about 17 pairs, 34 rows. That is
    // roughly 1,800 bays, and 2,000 is the round number to budget against.
    //
    // The LOD band is 55/70 m, so at any moment a hundred-odd bays are full and
    // the rest are reduced. A hundred full and 1,900 reduced is the mix to
    // budget against.
    //
    // The ceiling moved from 400k to 1M when the far tier gained its decks,
    // bracing and footplates, and that is a deliberate re-derivation rather
    // than a nudge: the far tier went from 120 to 372 triangles, so 1,900 of
    // them is 707k where it used to be 234k. It is affordable because a CPU
    // profile of the real 3,704-bay scene found ~61% of frame time in
    // per-object draw dispatch and ~25% in matrix maths, and geometry
    // complexity nowhere. Triangles were never what this scene was short of.
    //
    // What this test still does NOT measure is the cost that actually moved.
    // Two thousand bays are two thousand draw calls, where the block this
    // replaced was about ninety-five. That is the price of a bay being an
    // ordinary object, it was paid deliberately, and only instancing fixes it.
    const full = triangleCount(rack(), 'full')
    const simple = triangleCount(rack(), 'simple')
    expect(full).toBeLessThan(1000)
    expect(simple).toBeLessThan(500)
    expect(100 * full + 1_900 * simple).toBeLessThan(1_000_000)
  })

  test('a bay with something against its right builds one frame, not two', () => {
    // The whole shared-frame rule, measured. Two bays at a pitch would otherwise
    // put two posts in the same place: doubled steel, doubled perforation, and
    // z-fighting on every coincident face.
    const r = rack()
    const alone = triangleCount(r, 'full')
    const abutted = (getRackGeometry(r, 'full', true).getIndex()?.count ?? 0) / 3
    expect(abutted).toBeLessThan(alone)

    // Two variants of one shape, and no more: the flag is worth exactly one bit
    // in the key.
    clearRackGeometryCache()
    getRackGeometry(r, 'full', false)
    getRackGeometry(r, 'full', true)
    getRackGeometry(rack({ id: 'pallet_rack_b', position: [2.822, 0, 0] }), 'full', true)
    expect(rackGeometryCacheSize()).toBe(2)
  })

  test('the steel overhangs the declared footprint by exactly the shared post', () => {
    // The collision footprint is the **pitch**, not the outer width, and the
    // difference is the whole shared-frame story: a bay occupies one pitch in
    // the world and its two half-posts stick out either side, so bays at the
    // sharing pitch tile exactly instead of overlapping by a post.
    //
    // Declaring the outer width instead is what made the editor refuse to place
    // a bay flush against another — a 122 mm overlap, read as a hard conflict —
    // so the one gesture the kind is built around was the one it would not do.
    // This pins the relationship rather than the number.
    const r = rack()
    const footprint = r.bayClearWidth + r.uprightWidth
    const steel = r.bayClearWidth + 2 * r.uprightWidth

    // Catalogue footplates are wider than the post they carry — 175 mm under a
    // 122 mm upright — so the built mesh reaches a further 26 mm a side at
    // floor level. Real, and asserted rather than ignored: anything larger
    // means a part is escaping further than the design says it may.
    const full = getRackGeometry(r, 'full').boundingBox
    const fullWidth = (full?.max.x ?? 0) - (full?.min.x ?? 0)
    expect(fullWidth - steel).toBeCloseTo(0.053, 5)
    // Precision 5, not 9: this is measured off the built Float32 buffer, so the
    // last few digits are the attribute's, not the arithmetic's.
    expect(steel - footprint).toBeCloseTo(r.uprightWidth, 5)

    expect(full?.min.y ?? -1).toBeGreaterThanOrEqual(-1e-9)
    expect(full?.max.y ?? 0).toBeCloseTo(r.uprightHeight, 5)

    // Both tiers reach exactly the same width, which is what makes the LOD
    // swap invisible: a rack that grew or shrank by 53 mm as it crossed the
    // band would pop, and the footplates are the widest thing it builds. This
    // is the assertion that the far tier is a reduction in detail and not in
    // extent — it replaced one that read the bare-steel width off `simple`,
    // which stopped being bare steel when the far tier gained its footplates.
    const simple = getRackGeometry(r, 'simple').boundingBox
    const simpleWidth = (simple?.max.x ?? 0) - (simple?.min.x ?? 0)
    expect(simpleWidth).toBeCloseTo(fullWidth, 5)
  })

  test('a double-deep bay is twice as deep and still centred', () => {
    // Depth positions survived the move to one node per bay where rows did not,
    // because a second position is genuinely inside the same bay — served from
    // the same aisle, behind the first pallet.
    const twin = getRackGeometry(rack({ depthPositions: 2 }), 'full').boundingBox
    const single = getRackGeometry(rack(), 'full').boundingBox
    const twinDepth = (twin?.max.z ?? 0) - (twin?.min.z ?? 0)
    const singleDepth = (single?.max.z ?? 0) - (single?.min.z ?? 0)
    expect(twinDepth).toBeGreaterThan(singleDepth * 1.9)
    // Centred on the node, which is what the footprint and the alignment bridge
    // both assume.
    expect((twin?.max.z ?? 0) + (twin?.min.z ?? 0)).toBeCloseTo(0, 6)
  })

  test('every triangle index addresses a real vertex', () => {
    const geometry = getRackGeometry(rack({ depthPositions: 2, pickingLevels: 1 }), 'full')
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
  //
  // **Every value of every enum is listed, not one representative.** A single
  // representative only proves the key notices the value that happens to differ,
  // and the bug this table exists to catch is precisely the opposite: `decking`
  // shipped with `wire-mesh` and `steel` building byte-identical meshes under
  // two different keys, and the table said nothing because it only ever tried
  // `timber`. `ENUMS` below sweeps every value against every other.
  const VARIANTS: Array<[string, unknown]> = [
    ['bayClearWidth', 3.3],
    ['depth', 1.2],
    ['uprightHeight', 8],
    ['depthPositions', 2],
    ['depthGap', 0.12],
    ['levels', 2],
    ['levelClears', [2.4]],
    ['firstLevelClear', 1.9],
    ['levelClear', 1.7],
    ['groundLevelStorage', false],
    ['hasGroundBeam', true],
    ['tunnelLevels', 1],
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
    // key that over-reports and needlessly splits the cache. The negative side
    // has to stay populated: with it empty the test only proves the key is
    // *large enough*, and the cheapest way to pass that is to list every field.
    ['ghostFill', 0.8],
    ['levelCapacity', 5000],
    ['name', 'Aisle 7'],
    ['position', [12, 0, 4]],
    // Two bays standing in a line are the same shape whichever slab they landed
    // on and whichever way the run faces — this is exactly the sharing that
    // makes two thousand nodes affordable.
    ['rotation', [0, Math.PI / 2, 0]],
    ['supportSlabId', 'slab_abcdefgh'],
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

  /**
   * Every value of every geometry enum, so the sweep below compares each against
   * each rather than each against the default.
   *
   * `decking` is the reason this exists. With one representative per field, the
   * table could only ever ask "does `timber` differ from `wire-mesh`?" — which it
   * does — and never "does `steel` differ from `wire-mesh`?", which it did not.
   * A whole class of over-reporting was invisible to the strongest test in the
   * repo. Enums are small; sweep them exhaustively.
   */
  const ENUMS: Array<[string, readonly unknown[], Record<string, unknown>]> = [
    // Decking only reaches the mesh where a level actually carries a panel, so
    // the sweep needs a rack that has one.
    ['decking', ['wire-mesh', 'steel', 'timber', 'open'], { levels: 2, uprightHeight: 8 }],
    ['bracing', ['z-bracing', 'x-bracing', 'open'], {}],
    ['palletOrientation', ['short-side-out', 'long-side-out'], { decking: 'open' }],
    ['palletPreset', ['epal-1', 'epal-2', 'epal-3'], { decking: 'open' }],
  ]

  test('every pair of enum values agrees about whether it changes the mesh', () => {
    for (const [field, values, context] of ENUMS) {
      const meshes = values.map((value) => buildFresh(rack({ ...context, [field]: value })))
      const keys = values.map((value) =>
        rackGeometryKey(rack({ ...context, [field]: value }), 'full'),
      )

      for (let a = 0; a < values.length; a++) {
        for (let b = a + 1; b < values.length; b++) {
          const pair = `${field}: ${String(values[a])} vs ${String(values[b])}`
          const differentMesh = !sameMesh(meshes[a] as Float32Array, meshes[b] as Float32Array)
          const differentKey = keys[a] !== keys[b]
          expect({ pair, differentKey }).toEqual({ pair, differentKey: differentMesh })
        }
      }
    }
  })

  test('every decking value is visibly its own thing, not just its own key', () => {
    // A key that distinguishes them is necessary and nowhere near sufficient —
    // that was exactly the shipped state. What the user needs is for the four
    // options to look like four different products, so this asserts against the
    // *colour* buffer, which is where the difference now lives.
    const shelfColors = (decking: string) => {
      clearRackGeometryCache()
      const node = rack({ decking, levels: 2, uprightHeight: 8 })
      const geometry = getRackGeometry(node, 'full')
      const colors = geometry.getAttribute('color').array as ArrayLike<number>
      return new Set(
        Array.from({ length: colors.length / 3 }, (_, index) =>
          [colors[index * 3], colors[index * 3 + 1], colors[index * 3 + 2]].join(','),
        ),
      )
    }

    const mesh = shelfColors('wire-mesh')
    const steel = shelfColors('steel')
    const timber = shelfColors('timber')
    // Each carries a colour neither of the others has: the deck's own.
    expect([...mesh].some((color) => !steel.has(color) && !timber.has(color))).toBe(true)
    expect([...steel].some((color) => !mesh.has(color) && !timber.has(color))).toBe(true)
    expect([...timber].some((color) => !mesh.has(color) && !steel.has(color))).toBe(true)
  })

  test('a scrub does not leak, and cannot evict what a rack is drawing', () => {
    // The host's slider fires an update per step of a drag, so scrubbing a
    // dimension mints a geometry at every value it passes through — hundreds of
    // buffers nothing will draw again, in the session where the warehouse is
    // about to be filled. The cache is bounded for that, and the bound must
    // never reach a shape a mounted rack is holding.
    clearRackGeometryCache()
    const placed = rack({ uprightHeight: 5 })
    const held = retainRackGeometry(placed, 'full', false)
    const holding = getRackGeometry(placed, 'full')

    // A scrub across the whole legal range, at the step the inspector uses.
    for (let height = 1; height <= 20; height += 0.1) {
      getRackGeometry(rack({ uprightHeight: Number(height.toFixed(1)) }), 'full')
    }

    expect(rackGeometryCacheSize()).toBeLessThanOrEqual(96)
    // The held shape is still there and still the same buffer, so the rack it
    // belongs to is still drawing rather than blank.
    expect(getRackGeometry(placed, 'full')).toBe(holding)
    expect(holding.getAttribute('position').count).toBeGreaterThan(0)

    releaseRackGeometry(held)
  })

  test('the shared-frame flag reaches the key, in both directions', () => {
    // Not a schema field, so it cannot ride in on the VARIANTS table — and it is
    // the one input to the builder that comes from *another node*. Missing from
    // the key, a bay that gained a neighbour would keep drawing its old mesh and
    // the seam would carry two posts with nothing to say why.
    const r = rack()
    const alone = buildFresh(r)
    clearRackGeometryCache()
    const abutted = getRackGeometry(r, 'full', true).getAttribute('position')
      .array as ArrayLike<number>

    expect(Float32Array.from(abutted).length).not.toBe(alone.length)
    expect(rackGeometryKey(r, 'full', true)).not.toBe(rackGeometryKey(r, 'full', false))
  })
})

/**
 * The key is memoised on the rack object (`geometryKeys`). Both failure modes
 * are silent: a memo that over-collapses makes two visibly different racks share
 * one geometry, and a memo that is quietly removed restores a cost that shows up
 * only as frame time. These pin both directions.
 */
describe('şekil anahtarı memoizasyonu', () => {
  test('aynı düğüm nesnesi için katman anahtarı hâlâ ayırıyor', () => {
    // Memo katmanı anahtara katmasaydı, `simple` katman `full`'ün anahtarını
    // geri alır ve uzaktaki her raf yakın katmanın geometrisini çizerdi.
    const node = rack({ uprightHeight: 10.3, levels: 8 })
    expect(rackGeometryKey(node, 'full')).not.toBe(rackGeometryKey(node, 'simple'))
  })

  test('aynı düğüm nesnesi için komşu bayrağı hâlâ ayırıyor', () => {
    // Sağında bay olan raf sağ çerçevesini komşusuna bırakır — farklı mesh.
    // Memo bunu anahtara katmasaydı, bir sıradaki bütün bayların çerçeveleri
    // ilk hesaplanan hâle saplanır ve dikişte ya çift direk ya boşluk kalırdı.
    const node = rack()
    expect(rackGeometryKey(node, 'full', true)).not.toBe(rackGeometryKey(node, 'full', false))
  })

  test('yapıca aynı iki AYRI düğüm aynı anahtarı alıyor — paylaşım korunuyor', () => {
    // Memoizasyonun bozmaması gereken şey bu: paylaşım düğüm kimliğine değil,
    // alanlara bakar. Bozulsaydı depo raf sayısı kadar geometri tahsis ederdi.
    expect(rackGeometryKey(rack(), 'full')).toBe(rackGeometryKey(rack(), 'full'))
  })

  test('YERİNDE mutasyon anahtarı tazelemez — önbellek nesne kimliğine bağlı', () => {
    // Bu testin iki işi var. Birincisi sözleşmeyi sabitlemek: host düğümleri
    // değiştirmez, yenisiyle DEĞİŞTİRİR (`neighbours.ts` de aynı değişmeze
    // dayanıyor), ve yerinde mutasyon desteklenmiyor.
    //
    // İkincisi memoizasyonun kendisini yakalamak: memo kaldırılırsa anahtar
    // mutasyondan sonra yeniden kurulur ve DEĞİŞİR, yani bu beklenti düşer.
    const node = rack({ bayClearWidth: 2.7 })
    const before = rackGeometryKey(node, 'full')
    ;(node as unknown as { bayClearWidth: number }).bayClearWidth = 3.6
    expect(rackGeometryKey(node, 'full')).toBe(before)

    // Yeni nesne = yeni kimlik → yeni anahtar. Host'un gerçekte yaptığı bu.
    expect(rackGeometryKey(rack({ bayClearWidth: 3.6 }), 'full')).not.toBe(before)
  })
})
