import { beforeEach, describe, expect, test } from 'bun:test'
import { clashesWith } from '../clash'
import { PalletRackNode } from '../rack/schema'
import { CAR, exteriorWidthM, SPEEDS_M_PER_MIN } from './catalog'
import { MIN_ROLLERS_UNDER_A_BOX, ROLLER_PITCHES_MM } from './constants'
import {
  clearConveyorGeometryCache,
  conveyorGeometryCacheSize,
  conveyorGeometryKey,
  getConveyorGeometry,
} from './geometry-builder'
import {
  carriesShortestBox,
  frameWidthM,
  moduleLengthM,
  rollerOffsetsX,
  rollerPitchM,
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
      [80, 75, 6],
      [27, 75, 2.025],
      [60, 100, 6],
      [200, 75, 15],
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
    expect(withinCatalogueLength(conveyor({ rollers: 27, rollerPitch: 75 }))).toBe(true)
    expect(withinCatalogueLength(conveyor({ rollers: 200, rollerPitch: 75 }))).toBe(true)
    expect(withinCatalogueLength(conveyor({ rollers: 27, rollerPitch: 50 }))).toBe(false)
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
    expect(frameWidthM(conveyor({ usefulWidth: 600 }))).toBeCloseTo(0.747, 9)
    expect(frameWidthM(conveyor({ usefulWidth: 400 }))).toBeCloseTo(0.547, 9)
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
})

describe('the cache key is derived, never raw', () => {
  const buildFresh = (node: ReturnType<typeof conveyor>): Float32Array => {
    clearConveyorGeometryCache()
    const geometry = getConveyorGeometry(node, 'full')
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
    ['usefulWidth', 400],
    ['rollers', 100],
    ['rollerPitch', 100],
    ['transportHeight', 0.57],
    ['sideGuide', 'none'],
    ['sideGuideHeight', 0.09],
    ['hasDrive', false],
    ['flow', 'reverse'],
    ['frameColor', '#00ff00'],
    ['rollerColor', '#ff00ff'],
    ['profileColor', '#123456'],
    // Must NOT move a vertex.
    ['speed', 25],
    ['shortestBox', 0.6],
    ['inclination', 3],
    ['name', 'Spine 1'],
    ['position', [12, 0, 4]],
    ['rotation', [0, Math.PI / 2, 0]],
    ['supportSlabId', 'slab_abcdefgh'],
  ]

  test('every field that changes the mesh changes the key, and none that do not', () => {
    const base = conveyor()
    const baseMesh = buildFresh(base)
    const baseKey = conveyorGeometryKey(base, 'full')

    for (const [field, value] of VARIANTS) {
      const variant = conveyor({ [field]: value })
      const changesMesh = !sameMesh(buildFresh(variant), baseMesh)
      const changesKey = conveyorGeometryKey(variant, 'full') !== baseKey
      expect({ field, changesKey }).toEqual({ field, changesKey: changesMesh })
    }
  })

  test('two ways to reach one length are still two meshes, because the pitch differs', () => {
    // 80 at 75 mm and 60 at 100 mm are both 6 m — and the stripe repeat is not
    // the same, so they must not share a buffer.
    const a = conveyor({ rollers: 80, rollerPitch: 75 })
    const b = conveyor({ rollers: 60, rollerPitch: 100 })
    expect(moduleLengthM(a)).toBeCloseTo(moduleLengthM(b), 9)
    expect(conveyorGeometryKey(a, 'full')).not.toBe(conveyorGeometryKey(b, 'full'))
  })
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
    expect(fieldsOf({ rollerPitch: 100, shortestBox: 0.15 })).toContain('rollerPitch')
    expect(carriesShortestBox(conveyor({ rollerPitch: 100, shortestBox: 0.15 }))).toBe(false)
    expect(MIN_ROLLERS_UNDER_A_BOX).toBe(3)
  })

  test('a length outside the catalogue range is reported', () => {
    expect(fieldsOf({ rollers: 27, rollerPitch: 50 })).toContain('rollers')
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
      { rollerPitch: 100, shortestBox: 0.15 },
      { rollers: 27, rollerPitch: 50 },
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
