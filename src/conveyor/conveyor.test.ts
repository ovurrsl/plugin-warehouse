import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clashesWith } from '../clash'
import { PalletRackNode } from '../rack/schema'
import { CAR, exteriorWidthM, SPEEDS_M_PER_MIN } from './catalog'
import { MIN_ROLLERS_UNDER_A_BOX, ROLLER_PITCHES_MM } from './constants'
import { BELT_PITCHES_PER_SECOND } from './conveyor-texture'
import {
  clearConveyorGeometryCache,
  conveyorGeometryCacheSize,
  conveyorGeometryKey,
  getConveyorGeometry,
  releaseGeometry,
  retainGeometry,
  sweepConveyorGeometry,
} from './geometry-builder'
import {
  carriesShortestBox,
  frameWidthM,
  moduleLengthM,
  rollerOffsetsX,
  rollerPitchM,
  speedMPerSec,
  supportOffsetsX,
  withinCatalogueLength,
} from './metrics'
import { moduleOffsets } from './multiply'
import { conveyorRollerParametrics } from './parametrics'
import { conveyorParts } from './parts'
import { ConveyorRollerNode } from './schema'

const conveyor = (overrides: Record<string, unknown> = {}) =>
  ConveyorRollerNode.parse({ id: 'conveyor_roller_t', ...overrides })

const triangles = (
  node: ReturnType<typeof conveyor>,
  detail: 'full' | 'simple' = 'full',
  abutted = false,
) => (getConveyorGeometry(node, detail, abutted).getIndex()?.count ?? 0) / 3

describe('the bed is a whole number of pitches', () => {
  test('length is the roller count times the pitch, never a stored field', () => {
    // The reason `rollers` is the field and length is not: a bed physically is
    // a whole number of pitches, and a metres slider would both produce lengths
    // no supplier cuts and mint a geometry at every step it passed through.
    for (const [rollers, pitch, expected] of [
      [80, '75', 6],
      [27, '75', 2.025],
      [60, '100', 6],
      [200, '75', 15],
    ] as const) {
      const node = conveyor({ rollers, rollerPitch: pitch })
      expect({ rollers, pitch, length: moduleLengthM(node) }).toEqual({
        rollers,
        pitch,
        length: expected,
      })
    }
  })

  test('rollers are half a pitch in from each end, so a joint continues the pitch', () => {
    // What decides whether a box crossing the seam between two modules is ever
    // unsupported. Packed to the ends instead, two abutting beds would leave a
    // double gap exactly where the box has to cross.
    const node = conveyor()
    const offsets = rollerOffsetsX(node)
    const pitch = rollerPitchM(node)
    const half = moduleLengthM(node) / 2

    expect(offsets).toHaveLength(node.rollers)
    expect(offsets[0]).toBeCloseTo(-half + pitch / 2, 9)
    expect(offsets[offsets.length - 1]).toBeCloseTo(half - pitch / 2, 9)
    // And the gap across a joint is one pitch, like every gap inside a module.
    const next = moduleOffsets(node, 2)[0] as [number, number, number]
    const lastOfFirst = offsets[offsets.length - 1] ?? 0
    const firstOfNext = next[0] + (offsets[0] ?? 0)
    expect(firstOfNext - lastOfFirst).toBeCloseTo(pitch, 9)
  })

  test('the catalogue length range is what the module is checked against', () => {
    expect(withinCatalogueLength(conveyor({ rollers: 27, rollerPitch: '75' }))).toBe(true)
    expect(withinCatalogueLength(conveyor({ rollers: 200, rollerPitch: '75' }))).toBe(true)
    expect(withinCatalogueLength(conveyor({ rollers: 27, rollerPitch: '50' }))).toBe(false)
    expect(CAR.lengthRangeM[0]).toBeCloseTo(2.025, 9)
  })
})

describe('the frame is derived, never stored', () => {
  test('exterior is the useful width plus 147 mm, across the straight family', () => {
    // Checked against every straight the catalogue publishes both figures for:
    // LRA 800 → 947, CAR/FRE/BLT 600 → 747. Curves and the booster are
    // different families and bring their own constant when they land.
    expect(exteriorWidthM(800)).toBeCloseTo(0.947, 9)
    expect(exteriorWidthM(600)).toBeCloseTo(0.747, 9)
    expect(frameWidthM(conveyor({ usefulWidth: '600' }))).toBeCloseTo(0.747, 9)
    expect(frameWidthM(conveyor({ usefulWidth: '400' }))).toBeCloseTo(0.547, 9)
  })

  test('supports are never further apart than the catalogue spacing', () => {
    for (const rollers of [27, 80, 133, 200]) {
      const node = conveyor({ rollers })
      const offsets = supportOffsetsX(node)
      expect(offsets[0]).toBeCloseTo(-moduleLengthM(node) / 2, 9)
      expect(offsets[offsets.length - 1]).toBeCloseTo(moduleLengthM(node) / 2, 9)
      for (let index = 1; index < offsets.length; index++) {
        const span = (offsets[index] ?? 0) - (offsets[index - 1] ?? 0)
        expect({ rollers, tooWide: span > 1.5 + 1e-9 }).toEqual({ rollers, tooWide: false })
      }
    }
  })
})

describe('geometry', () => {
  beforeEach(() => clearConveyorGeometryCache())

  test('the rollers are painted, not built — the whole affordability of the kind', () => {
    // Six hundred metres of bed at 75 mm pitch is eight thousand rollers. As
    // twelve-sided prisms that is ~384,000 triangles for one kind, against the
    // 400,000 the entire two-thousand-bay rack scene is budgeted at. The bed is
    // one box; this is the assertion that says so.
    const node = conveyor()
    const deck = conveyorParts(node, 'full').filter((part) => part.role === 'deck')
    expect(deck).toHaveLength(1)
    expect(deck[0]?.pattern).toBe('rollers')
    // Whatever the roller count, the bed stays one box.
    expect(
      conveyorParts(conveyor({ rollers: 200 }), 'full').filter((p) => p.role === 'deck'),
    ).toHaveLength(1)
  })

  test('the far tier drops most of the triangles', () => {
    const node = conveyor()
    const full = triangles(node, 'full')
    const simple = triangles(node, 'simple')
    expect(simple).toBeLessThan(full * 0.45)
    expect(simple).toBeGreaterThan(0)
  })

  test('a warehouse of conveyor is a rounding error next to the racks', () => {
    // 600 m of line is about 100 modules at the 6 m default. The rack's own
    // budget test allows 400,000 triangles for 2,000 bays; this has to be small
    // beside it or the kind is not affordable at the scale it is for.
    const full = triangles(conveyor(), 'full')
    const simple = triangles(conveyor(), 'simple')
    expect(30 * full + 70 * simple).toBeLessThan(60_000)
  })

  test('two hundred identical modules share one buffer', () => {
    // The entire memory design. Keying on the node would give two hundred
    // identical meshes.
    for (let index = 0; index < 200; index++) {
      getConveyorGeometry(
        conveyor({ id: `conveyor_roller_${index}`, position: [index * 6, 0, 0] }),
        'full',
      )
    }
    expect(conveyorGeometryCacheSize()).toBe(1)
  })

  test('an abutting module leaves the shared support to its neighbour', () => {
    const node = conveyor()
    const alone = conveyorParts(node, 'full')
    const abutted = conveyorParts(node, 'full', true)
    const legs = (list: typeof alone) => list.filter((part) => part.role === 'leg').length
    expect(legs(abutted)).toBe(legs(alone) - 2)
    // And it is one bit in the key, not a new shape family.
    expect(conveyorGeometryKey(node, 'full', true)).not.toBe(conveyorGeometryKey(node, 'full'))
  })
  test('the ceded station is the one that actually abuts, whichever way goods travel', () => {
    // The bug this pins: `hasDownstreamNeighbour` asks whether the *outlet* is
    // mated, and under reverse flow the outlet is 'a' — the −X end. The parts
    // list dropped `index === lastStation`, always +X. So a reverse-flow module
    // butted at −X deleted the leg pair at its *free* end and left doubled steel
    // at the seam: the exact failure the shared-support rule exists to prevent.
    const legXs = (node: ReturnType<typeof conveyor>, abutted: boolean) =>
      [
        ...new Set(
          conveyorParts(node, 'full', abutted)
            .filter((part) => part.role === 'leg')
            .map((part) => Number(part.center[0].toFixed(6))),
        ),
      ].sort((a, b) => a - b)

    const forward = conveyor({ flow: 'forward' })
    const reverse = conveyor({ flow: 'reverse' })
    const stations = legXs(forward, false)

    // Alone, both build every station.
    expect(legXs(reverse, false)).toEqual(stations)

    // Abutted, each drops the station at its own discharge end.
    expect(legXs(forward, true)).toEqual(stations.slice(0, -1))
    expect(legXs(reverse, true)).toEqual(stations.slice(1))
  })

  test('the ceded end reaches the cache key, so two abutted flows are two meshes', () => {
    // Once the dropped station follows the flow, the flow moves a vertex — and a
    // key that did not carry it would hand a reverse module the forward mesh.
    // `flow` only reached the key through the motor block, so a module with no
    // drive was exactly the case that shared one buffer for two shapes.
    const forward = conveyor({ flow: 'forward', hasDrive: false })
    const reverse = conveyor({ flow: 'reverse', hasDrive: false })
    expect(conveyorGeometryKey(forward, 'full', true)).not.toBe(
      conveyorGeometryKey(reverse, 'full', true),
    )
    // Dayanmamışken de AYRI, ve bu bu turda değişti: yatağın makara deseni
    // artık akış yönünde kayıyor, yön de V'nin işaretinde taşınıyor
    // (`beltStripeSpan`). İki yön tek buffer'ı paylaşsaydı ters modülün bandı
    // kutuların tersine akardı — ekranda hata yok, yalnız yanlış yöne dönen
    // bir hat. Eskiden burada `toBe` yazıyordu ve o zaman doğruydu: yön hiçbir
    // vertex'i kımıldatmıyordu.
    expect(conveyorGeometryKey(forward, 'full')).not.toBe(conveyorGeometryKey(reverse, 'full'))
  })

  /**
   * BANT GERÇEKTEN AKIYOR MU.
   *
   * Bildirilen hata: hat çalışırken kutular gidiyordu ama makaralar
   * duruyordu — kutular hareketsiz bir yüzeyin üstünde kayıyordu. Sessiz:
   * konsolda tek satır yok, sahne kusursuz çiziliyor, yalnız duran bir
   * makinenin üstünde yük taşınıyor.
   *
   * Kaydırmanın kendisi bir `CanvasTexture` üstünde çalışıyor ve canvas
   * `document` istiyor, yani test ortamında doku hiç doğmuyor. O yüzden
   * ölçülebilen iki şey ölçülüyor: hızın katalogla tutarlılığı, ve KABLONUN
   * takılı olduğu — çünkü hız doğru olup döngünün çağırmaması tam da
   * düzeltilen hata.
   */
  test('bant hızı katalog varsayılanından geliyor', () => {
    // 45 m/dk ve 75 mm adım → saniyede 10 makara adımı. Sabit elle yazılsaydı
    // katalog değişince sessizce ayrışırdı.
    const node = conveyor({})
    const expected = speedMPerSec(node) / rollerPitchM(node)
    expect(BELT_PITCHES_PER_SECOND).toBeCloseTo(expected, 9)
    expect(BELT_PITCHES_PER_SECOND).toBeGreaterThan(0)
  })

  test('akış döngüsü bandı gerçekten sürüyor ve durunca sıfırlıyor', () => {
    const source = readFileSync(join(import.meta.dir, 'flow-system.tsx'), 'utf8')
    const frame = source.slice(source.indexOf('useFrame('))
    expect(frame, 'kare döngüsü bandı ilerletmiyor').toContain('advanceConveyorBelt(')
    // Durma dalı `running` kapısının içinde; orada sıfırlanmazsa hat rastgele
    // bir fazda donmuş kalıyor.
    const stopped = frame.slice(frame.indexOf('if (!running'), frame.indexOf('boxesRef.current ='))
    expect(stopped, 'akış durunca bant başa dönmüyor').toContain('resetConveyorBelt()')
  })

  test('ters akışın yatak UV’si ileri akışın AYNASI', () => {
    // Anahtarın ayrışması yetmez: mesh'in gerçekten aynalandığını ölçmek
    // gerekiyor, yoksa anahtar boşuna bölünmüş olurdu.
    clearConveyorGeometryCache()
    const uvOf = (flow: 'forward' | 'reverse') => {
      clearConveyorGeometryCache()
      const geometry = getConveyorGeometry(conveyor({ flow, hasDrive: false }), 'full')
      const uv = geometry.getAttribute('uv')
      const vs: number[] = []
      for (let i = 0; i < uv.count; i++) vs.push(uv.getY(i))
      return vs
    }
    const forward = uvOf('forward')
    const reverse = uvOf('reverse')
    expect(reverse.length).toBe(forward.length)
    expect(Math.max(...forward)).toBeGreaterThan(1)
    expect(Math.min(...reverse)).toBeLessThan(-1)
    for (const [index, v] of forward.entries()) expect(reverse[index]).toBeCloseTo(-v, 9)
  })
})

describe('the cache key is derived, never raw', () => {
  const buildFresh = (node: ReturnType<typeof conveyor>, abutted = false): Float32Array => {
    clearConveyorGeometryCache()
    const geometry = getConveyorGeometry(node, 'full', abutted)
    const positions = geometry.getAttribute('position').array as ArrayLike<number>
    const colors = geometry.getAttribute('color').array as ArrayLike<number>
    const combined = new Float32Array(positions.length + colors.length)
    combined.set(Float32Array.from(positions), 0)
    combined.set(Float32Array.from(colors), positions.length)
    return combined
  }

  const sameMesh = (a: Float32Array, b: Float32Array) =>
    a.length === b.length && a.every((value, index) => value === b[index])

  // One altered value per field, both directions. The negative side has to stay
  // populated: with it empty the test only proves the key is large enough, and
  // the cheapest way to pass that is to list every field.
  const VARIANTS: Array<[string, unknown]> = [
    ['usefulWidth', '400'],
    ['rollers', 100],
    ['rollerPitch', '100'],
    ['transportHeight', 0.57],
    ['sideGuide', 'none'],
    ['sideGuideHeight', 0.09],
    ['hasDrive', false],
    ['flow', 'reverse'],
    ['frameColor', '#00ff00'],
    ['rollerColor', '#ff00ff'],
    ['profileColor', '#123456'],
    // Must NOT move a vertex.
    ['speed', '25'],
    ['shortestBox', 0.6],
    ['inclination', 3],
    ['name', 'Spine 1'],
    ['position', [12, 0, 4]],
    ['rotation', [0, Math.PI / 2, 0]],
    ['supportSlabId', 'slab_abcdefgh'],
  ]

  test('every field that changes the mesh changes the key, and none that do not', () => {
    /**
     * Swept at **both** abutment states, and that is not thoroughness for its
     * own sake.
     *
     * Run only unabutted, this sweep reported `flow` as key-covered because flow
     * reached the key through the motor block — while an abutted module's mesh
     * also depends on flow, through which support station it cedes. A module
     * with `hasDrive: false` therefore had two shapes behind one key and the
     * sweep could not see it.
     */
    for (const abutted of [false, true]) {
      const base = conveyor()
      const baseMesh = buildFresh(base, abutted)
      const baseKey = conveyorGeometryKey(base, 'full', abutted)

      for (const [field, value] of VARIANTS) {
        const variant = conveyor({ [field]: value })
        const changesMesh = !sameMesh(buildFresh(variant, abutted), baseMesh)
        const changesKey = conveyorGeometryKey(variant, 'full', abutted) !== baseKey
        expect({ abutted, field, changesKey }).toEqual({ abutted, field, changesKey: changesMesh })
      }
    }
  })

  test('two ways to reach one length are still two meshes, because the pitch differs', () => {
    // 80 at 75 mm and 60 at 100 mm are both 6 m — and the stripe repeat is not
    // the same, so they must not share a buffer.
    const a = conveyor({ rollers: 80, rollerPitch: '75' })
    const b = conveyor({ rollers: 60, rollerPitch: '100' })
    expect(moduleLengthM(a)).toBeCloseTo(moduleLengthM(b), 9)
    expect(conveyorGeometryKey(a, 'full')).not.toBe(conveyorGeometryKey(b, 'full'))
  })
})

describe('every enum the inspector offers survives a re-parse', () => {
  /**
   * The exact path Duplicate takes, and the one that broke.
   *
   * `ParametricInspector`'s enum control declares `options: readonly string[]`,
   * renders a value only when `typeof value === 'string'`, and writes back
   * `e.target.value`. A field declared as a numeric literal union therefore
   * displayed the *first* option whatever it really was, and the first edit
   * stored a string the schema refused — so `def.schema.parse(duplicateInfo)`
   * threw and the module could not be duplicated.
   *
   * Walking the descriptor rather than naming the fields is the point: a
   * numeric enum added later fails here without anyone having to remember.
   */
  const enumFields = conveyorRollerParametrics.groups.flatMap((group) =>
    group.fields.flatMap((field) => (field.kind === 'enum' ? [field] : [])),
  )

  test('the descriptor offers enums at all, so the sweep below is not vacuous', () => {
    expect(enumFields.map((field) => field.key).sort()).toEqual([
      'flow',
      'rollerPitch',
      'sideGuide',
      'speed',
      'usefulWidth',
    ])
  })

  for (const field of enumFields) {
    test(`${field.key}: every option the control can write parses back unchanged`, () => {
      for (const option of field.options) {
        const edited = { ...conveyor(), [field.key]: option }
        const reparsed = ConveyorRollerNode.parse(edited) as Record<string, unknown>
        expect({ key: field.key, option, stored: reparsed[field.key] }).toEqual({
          key: field.key,
          option,
          stored: option,
        })
      }
    })
  }
})

describe('a conveyor may pass under a rack, but not through its legs', () => {
  const scene = (rack: ReturnType<typeof PalletRackNode.parse>) => ({ [rack.id]: rack })
  const tunnelled = PalletRackNode.parse({
    id: 'pallet_rack_tunnel',
    levels: 3,
    uprightHeight: 6,
    tunnelLevels: 2,
  })
  const solid = PalletRackNode.parse({ id: 'pallet_rack_solid', levels: 3, uprightHeight: 6 })

  /** Across the bay, through the middle, at a given transport height. */
  const across = (transportHeight: number, rack: ReturnType<typeof PalletRackNode.parse>) =>
    clashesWith({
      node: conveyor({ rollers: 40, transportHeight }),
      position: [0, 0, 0],
      rotationY: Math.PI / 2,
      nodes: scene(rack),
    }).length > 0

  test('a tunnel is clear at a height a solid bay is not', () => {
    // The whole requirement, in one assertion. No special case computes it: a
    // tunnelled level emits no beams at all, so the clearance is real rather
    // than assumed.
    expect(across(1.55, tunnelled)).toBe(false)
    expect(across(1.55, solid)).toBe(true)
  })

  test('the standard height passes under either, because the first beam is at 1.5 m', () => {
    expect(across(0.75, tunnelled)).toBe(false)
    expect(across(0.75, solid)).toBe(false)
  })

  test('the legs are part of the machine, so a high bed still drags them through', () => {
    // A bed at 2.5 m clears the level-1 beam, but its legs run from the floor
    // to it and cannot. "Under the tunnel" has to mean the whole machine.
    expect(across(2.5, solid)).toBe(true)
    expect(across(2.5, tunnelled)).toBe(false)
  })

  test('an upright is always a clash, tunnel or no tunnel', () => {
    // The frames stay whatever the tunnel does — they carry what is above.
    const atUpright = clashesWith({
      node: conveyor({ rollers: 40 }),
      position: [1.411, 0, 0],
      rotationY: Math.PI / 2,
      nodes: scene(tunnelled),
    })
    expect(atUpright).toHaveLength(1)
  })

  test('a conveyor nowhere near a rack costs one envelope test and reports nothing', () => {
    expect(
      clashesWith({
        node: conveyor(),
        position: [40, 0, 40],
        rotationY: 0,
        nodes: scene(tunnelled),
      }),
    ).toHaveLength(0)
  })
})

describe('the catalogue rules are checked, not assumed', () => {
  const issuesFor = (overrides: Record<string, unknown>) =>
    (conveyorRollerParametrics.invariants ?? []).flatMap((check) => check(conveyor(overrides)))
  const fieldsOf = (overrides: Record<string, unknown>) =>
    issuesFor(overrides).map((issue) => issue.field)

  test('a default module is clean', () => {
    expect(issuesFor({})).toEqual([])
  })

  test('a pitch too coarse for the shortest box is reported', () => {
    // The catalogue rule: a box always sits on at least three rollers. Fewer and
    // it drops between them — a failure a drawing cannot show.
    expect(fieldsOf({ rollerPitch: '100', shortestBox: 0.15 })).toContain('rollerPitch')
    expect(carriesShortestBox(conveyor({ rollerPitch: '100', shortestBox: 0.15 }))).toBe(false)
    expect(MIN_ROLLERS_UNDER_A_BOX).toBe(3)
  })

  test('a length outside the catalogue range is reported', () => {
    expect(fieldsOf({ rollers: 27, rollerPitch: '50' })).toContain('rollers')
  })

  test('a fall steeper than the type allows is reported', () => {
    expect(CAR.maxInclinationDeg).toBe(6)
    expect(fieldsOf({ inclination: 6 })).not.toContain('inclination')
  })

  test('a non-standard transport height is named, because it silently stops a joint', () => {
    expect(fieldsOf({ transportHeight: 0.75 })).not.toContain('transportHeight')
    expect(fieldsOf({ transportHeight: 0.82 })).toContain('transportHeight')
  })

  test('every issue names a field the schema has', () => {
    const shape = ConveyorRollerNode.shape as Record<string, unknown>
    for (const overrides of [
      { rollerPitch: '100', shortestBox: 0.15 },
      { rollers: 27, rollerPitch: '50' },
      { transportHeight: 0.82 },
    ]) {
      for (const issue of issuesFor(overrides)) {
        expect({ overrides, field: issue.field, known: (issue.field ?? '') in shape }).toEqual({
          overrides,
          field: issue.field,
          known: true,
        })
        expect(issue.msg.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('laying a run down', () => {
  test('modules butt end to end at exactly one bed length', () => {
    const node = conveyor()
    const offsets = moduleOffsets(node, 5)
    expect(offsets).toHaveLength(4)
    const length = moduleLengthM(node)
    offsets.forEach((offset, index) => {
      expect(offset[0]).toBeCloseTo((index + 1) * length, 9)
      expect(offset[2]).toBeCloseTo(0, 9)
    })
  })

  test('a turned run follows its own axis, not world X', () => {
    const node = conveyor({ position: [5, 0, 5], rotation: [0, Math.PI / 2, 0] })
    const first = moduleOffsets(node, 2)[0] as [number, number, number]
    expect(first[0]).toBeCloseTo(5, 9)
    expect(first[2]).toBeCloseTo(5 - moduleLengthM(node), 9)
  })

  test('one module places nothing', () => {
    expect(moduleOffsets(conveyor(), 1)).toHaveLength(0)
  })
})

describe('the catalogue is the source, and it is not paraphrased', () => {
  test('the speeds are the three the catalogue offers', () => {
    expect([...SPEEDS_M_PER_MIN]).toEqual([25, 45, 60])
  })

  test('the pitches are the set the support rule admits', () => {
    // pitch <= shortestBox / 3, across the family's 150-800 mm box range.
    expect([...ROLLER_PITCHES_MM]).toEqual([50, 75, 100])
    for (const pitch of ROLLER_PITCHES_MM) {
      expect(pitch * MIN_ROLLERS_UNDER_A_BOX).toBeLessThanOrEqual(800)
    }
  })
})

describe('sıfır-tutan süpürme — paylaşılan konveyör havuzu', () => {
  const GRACE = 5000

  beforeEach(() => {
    clearConveyorGeometryCache()
  })

  test('kimsenin tutmadığı şekil pencere dolunca silinir, tutulan asla', () => {
    /**
     * İki sessiz hata. Pencere dolduğu hâlde silinmeyen şekil, kaydırıcı
     * sürtmesinin artığını oturum boyunca taşır — ve bu havuzu yedi kind
     * paylaştığı için tavan (`CACHE_LIMIT`) tek başına yetmiyordu, yalnız
     * TAVANA ULAŞILDIĞINDA iş yapıyordu. TUTULAN bir şekli silmek ise o
     * şekli paylaşan her modülü aynı anda karartır ve hiçbir yerde hata
     * görünmez.
     */
    const held = conveyor()
    const scrub = conveyor({ rollers: 30 })

    const key = retainGeometry(conveyorGeometryKey(held, 'full', false))
    const heldGeometry = getConveyorGeometry(held, 'full')
    const scrubGeometry = getConveyorGeometry(scrub, 'full')
    expect(conveyorGeometryCacheSize()).toBe(2)

    // Saat şekiller kurulduktan SONRA okunuyor: damgayı `getCachedGeometry`
    // kendi `Date.now()`'ıyla basıyor, yani önce okunursa test iki
    // birleştirilmiş buffer'ın inşa süresine yarışır ve yüklü bir süitte
    // rastgele kırılır.
    const now = Date.now()

    sweepConveyorGeometry(now + GRACE - 1)
    expect(conveyorGeometryCacheSize()).toBe(2)

    sweepConveyorGeometry(now + GRACE + 1)
    expect(conveyorGeometryCacheSize()).toBe(1)
    // Silindiğinin kanıtı kimlikten okunur: three'nin `dispose()`'u tamponu
    // yerinde bırakır, yalnız GPU tarafını boşaltır.
    expect(getConveyorGeometry(scrub, 'full')).not.toBe(scrubGeometry)
    expect(getConveyorGeometry(held, 'full')).toBe(heldGeometry)

    releaseGeometry(key)
  })

  test('bırakılan şekil pencereyi YENİDEN başlatır, silinme anında olmaz', () => {
    // Sıfıra düşen sayaç anında dispose etseydi, React'in commit boşluğunda
    // (renderer anahtarını bir efektte tutuyor) çizilen buffer serbest
    // kalırdı — `evict`'in belgelediği yarışın aynısı.
    const module = conveyor({ rollers: 34 })
    const key = retainGeometry(conveyorGeometryKey(module, 'full', false))
    getConveyorGeometry(module, 'full')

    releaseGeometry(key)
    const now = Date.now()

    sweepConveyorGeometry(now + GRACE - 1)
    expect(conveyorGeometryCacheSize()).toBe(1)

    sweepConveyorGeometry(now + GRACE + 1)
    expect(conveyorGeometryCacheSize()).toBe(0)
  })
})
