import { beforeEach, describe, expect, test } from 'bun:test'
import { isClearAt } from '../clash'
import { PalletNode } from '../pallet/schema'
import { boosterGeometryKey, getBoosterGeometry } from './booster-geometry'
import {
  carriesShortestBox,
  frameWidthM,
  moduleLengthM,
  supportOffsetsX,
  withinCatalogueLength,
} from './booster-metrics'
import { conveyorBoosterParametrics } from './booster-parametrics'
import { boosterParts } from './booster-parts'
import { ConveyorBoosterNode } from './booster-schema'
import { BST, exteriorWidthM } from './catalog'
import {
  clearConveyorGeometryCache,
  conveyorGeometryCacheSize,
  getConveyorGeometry,
} from './geometry-builder'
import { hasDownstreamNeighbour, lineOf, resetLineIndex } from './line-index'
import { jointProblems, resetPortMagnet, snapToLineEnd } from './port-magnet'
import { conveyorPorts } from './ports'
import { ConveyorRollerNode } from './schema'

const booster = (overrides: Record<string, unknown> = {}) =>
  ConveyorBoosterNode.parse({ id: 'conveyor_booster_t', ...overrides })

describe('the frame is the booster’s own, and it is the tightest in the family', () => {
  test('67 mm over the lane, against the straights’ 147', () => {
    // 600 inside 667 is published for this type. The drive sits under the bed
    // rather than beside it, so there is nothing for the frame to make room for
    // — which is why the two families cannot share a constant.
    expect(frameWidthM(booster({ usefulWidth: '600' }))).toBeCloseTo(0.667, 9)
    expect(frameWidthM(booster({ usefulWidth: '400' }))).toBeCloseTo(0.467, 9)
    expect(exteriorWidthM(600)).toBeCloseTo(0.747, 9)
    expect(frameWidthM(booster())).toBeLessThan(exteriorWidthM(600))
  })

  test('the drive is under the bed, not off the side', () => {
    // The part that buys the tight frame, and always present: a booster with no
    // drive is a length of free roller, which is a different type entirely.
    const node = booster()
    const drives = boosterParts(node, 'full').filter((part) => part.role === 'motor')
    expect(drives).toHaveLength(1)
    const drive = drives[0]
    if (!drive) throw new Error('no drive')
    expect(drive.center[2]).toBeCloseTo(0, 9)
    expect(Math.abs(drive.center[2]) + drive.size[2] / 2).toBeLessThanOrEqual(
      frameWidthM(node) / 2 + 1e-9,
    )
    expect(drive.center[1]).toBeLessThan(node.transportHeight)
  })
})

describe('the length range is a length, and the control is a count', () => {
  test('a count inside its bounds can still be a bed the catalogue does not build', () => {
    // The whole reason `rollers` has generous bounds and an invariant guards the
    // product: seven at 100 mm is a 700 mm booster, seven at 50 mm is 350 mm of
    // nothing. The field cannot express that; the length can.
    expect(withinCatalogueLength(booster({ rollers: 7, rollerPitch: '100' }))).toBe(true)
    expect(withinCatalogueLength(booster({ rollers: 7, rollerPitch: '50' }))).toBe(false)
    expect(withinCatalogueLength(booster({ rollers: 21, rollerPitch: '50' }))).toBe(true)
    expect(withinCatalogueLength(booster({ rollers: 21, rollerPitch: '100' }))).toBe(false)
  })

  test('the panel says so, naming the direction to move in', () => {
    const issuesFor = (overrides: Record<string, unknown>) =>
      conveyorBoosterParametrics.invariants?.flatMap((check) => check(booster(overrides))) ?? []
    const tooShort = issuesFor({ rollers: 7, rollerPitch: '50' })
    expect(tooShort.some((issue) => issue.field === 'rollers')).toBe(true)
    expect(tooShort.some((issue) => issue.msg.includes('Add rollers'))).toBe(true)

    const tooLong = issuesFor({ rollers: 21, rollerPitch: '100' })
    expect(tooLong.some((issue) => issue.msg.includes('Drop rollers'))).toBe(true)
  })

  test('a default booster is clean, so a new one is not born yellow', () => {
    expect(
      conveyorBoosterParametrics.invariants?.flatMap((check) => check(booster())) ?? [],
    ).toEqual([])
    expect(moduleLengthM(booster())).toBeCloseTo(0.9, 9)
    expect(carriesShortestBox(booster())).toBe(true)
  })

  test('the whole catalogue range fits inside one support span', () => {
    // Which is why every booster has exactly two stations, one at each end —
    // and that is what lets it share a support at a seam like a straight.
    for (const [rollers, pitch] of [
      [7, '100'],
      [12, '75'],
      [21, '50'],
    ] as const) {
      const node = booster({ rollers, rollerPitch: pitch })
      expect(supportOffsetsX(node)).toHaveLength(2)
      expect(moduleLengthM(node)).toBeLessThanOrEqual(BST.lengthRangeM[1] + 1e-9)
    }
  })
})

describe('the inspector can reach every field, and every option it writes parses back', () => {
  const enumFields = conveyorBoosterParametrics.groups.flatMap((group) =>
    group.fields.flatMap((field) => (field.kind === 'enum' ? [field] : [])),
  )

  for (const field of enumFields) {
    test(`${field.key}: every option the control can write parses back unchanged`, () => {
      for (const option of field.options) {
        const edited = { ...booster(), [field.key]: option }
        const reparsed = ConveyorBoosterNode.parse(edited) as Record<string, unknown>
        expect({ key: field.key, option, stored: reparsed[field.key] }).toEqual({
          key: field.key,
          option,
          stored: option,
        })
      }
    })
  }

  test('no editable field is unreachable from the panel', () => {
    const DELIBERATELY_HIDDEN = new Set([
      'id',
      'type',
      'name',
      'parentId',
      'children',
      'visible',
      'locked',
      'object',
      'metadata',
      'supportSlabId',
    ])
    const shown = new Set(
      conveyorBoosterParametrics.groups.flatMap((group) => group.fields.map((field) => field.key)),
    )
    const missing = Object.keys(booster()).filter(
      (key) => !shown.has(key as never) && !DELIBERATELY_HIDDEN.has(key),
    )
    expect(missing).toEqual([])
  })
})

describe('the booster joins a line like any other shape', () => {
  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  const straight = (overrides: Record<string, unknown> = {}) =>
    ConveyorRollerNode.parse({ id: 'conveyor_roller_s', ...overrides })

  const portOf = (node: Parameters<typeof conveyorPorts>[0], id: 'a' | 'b') => {
    const port = conveyorPorts(node).find((candidate) => candidate.id === id)
    if (!port) throw new Error(`no port ${id}`)
    return port
  }

  test('it magnets onto a straight and the straight cedes its support', () => {
    const bed = straight()
    const inlet = portOf(booster(), 'a')
    const exact: [number, number, number] = [
      portOf(bed, 'b').position[0] - inlet.position[0],
      0,
      portOf(bed, 'b').position[2] - inlet.position[2],
    ]
    expect(
      snapToLineEnd(booster(), [exact[0] + 0.2, 0, exact[2] - 0.1], 0, [], { [bed.id]: bed }),
    ).not.toBeNull()

    const joined = booster({ position: exact })
    const scene = { [bed.id]: bed, [joined.id]: joined }
    resetLineIndex()
    expect(lineOf(scene, bed.id).sort()).toEqual([joined.id, bed.id].sort())
    expect(hasDownstreamNeighbour(scene, bed)).toBe(true)
    // The frames differ by 80 mm and that is fine: two families, and what has to
    // agree is the lane and the height.
    expect(jointProblems(joined, scene)).toEqual([])
  })

  test('a 400 mm booster on a 600 mm line is reported, not silently joined', () => {
    const bed = straight({ usefulWidth: '600' })
    const narrow = booster({ usefulWidth: '400' })
    const exact: [number, number, number] = [
      portOf(bed, 'b').position[0] - portOf(narrow, 'a').position[0],
      0,
      portOf(bed, 'b').position[2] - portOf(narrow, 'a').position[2],
    ]
    expect(snapToLineEnd(narrow, exact, 0, [], { [bed.id]: bed })).toBeNull()

    const joined = booster({ usefulWidth: '400', position: exact })
    resetLineIndex()
    expect(jointProblems(joined, { [bed.id]: bed, [joined.id]: joined })).toContain(
      'Joined to a 600 mm lane; a box wider than 400 mm cannot cross.',
    )
  })
})

describe('the mesh', () => {
  beforeEach(() => {
    clearConveyorGeometryCache()
  })

  const sameMesh = (a: Float32Array, b: Float32Array) =>
    a.length === b.length && a.every((value, index) => value === b[index])

  const buildFresh = (node: ReturnType<typeof booster>, abutted = false): Float32Array => {
    clearConveyorGeometryCache()
    const geometry = getBoosterGeometry(node, 'full', abutted)
    const parts = (['position', 'color', 'uv'] as const).map(
      (name) => geometry.getAttribute(name).array as ArrayLike<number>,
    )
    const combined = new Float32Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
      combined.set(Float32Array.from(part), offset)
      offset += part.length
    }
    return combined
  }

  const VARIANTS: Array<[string, unknown]> = [
    ['usefulWidth', '400'],
    ['rollers', 10],
    ['rollerPitch', '100'],
    ['transportHeight', 0.57],
    ['sideGuide', 'none'],
    ['sideGuideHeight', 0.09],
    ['frameColor', '#00ff00'],
    ['rollerColor', '#ff00ff'],
    ['profileColor', '#123456'],
    // Must NOT move a vertex.
    ['speed', '25'],
    ['shortestBox', 0.6],
    ['flow', 'reverse'],
    ['name', 'Boost 1'],
    ['position', [12, 0, 4]],
    ['rotation', [0, Math.PI / 2, 0]],
    ['supportSlabId', 'slab_abcdefgh'],
  ]

  test('every field that changes the mesh changes the key, and none that do not', () => {
    for (const abutted of [false, true]) {
      const base = booster()
      const baseMesh = buildFresh(base, abutted)
      const baseKey = boosterGeometryKey(base, 'full', abutted)

      for (const [field, value] of VARIANTS) {
        const variant = booster({ [field]: value })
        const changesMesh = !sameMesh(buildFresh(variant, abutted), baseMesh)
        const changesKey = boosterGeometryKey(variant, 'full', abutted) !== baseKey
        expect({ abutted, field, changesKey }).toEqual({ abutted, field, changesKey: changesMesh })
      }
    }
  })

  test('two ways to reach one length are still two meshes, because the pitch differs', () => {
    // 12 at 75 mm and 9 at 100 mm are both 900 mm — and the stripe repeat is not
    // the same, so they must not share a buffer.
    const a = booster({ rollers: 12, rollerPitch: '75' })
    const b = booster({ rollers: 9, rollerPitch: '100' })
    expect(moduleLengthM(a)).toBeCloseTo(moduleLengthM(b), 9)
    expect(boosterGeometryKey(a, 'full')).not.toBe(boosterGeometryKey(b, 'full'))
  })

  test('it shares the straight’s pool, because it is one kind', () => {
    expect(conveyorGeometryCacheSize()).toBe(0)
    getConveyorGeometry(ConveyorRollerNode.parse({ id: 'conveyor_roller_p' }), 'full')
    getBoosterGeometry(booster(), 'full')
    expect(conveyorGeometryCacheSize()).toBe(2)
  })
})

describe('a booster occupies its own volume, legs and all', () => {
  const pallet = (z: number) =>
    PalletNode.parse({ id: 'pallet_b', position: [0, 0, z], rotation: [0, 0, 0] })

  test('a pallet on the bed clashes and one clear of it does not', () => {
    // Cross-kind, so the volumes are compared — floor to guide top on the
    // booster's side, which is what makes "under a rack's tunnel" answerable at
    // all and is why the height is not the footprint's.
    const node = booster()
    const scene = { [node.id]: node }

    const onTheBed = pallet(0)
    expect(
      isClearAt({ node: onTheBed, position: onTheBed.position, rotationY: 0, nodes: scene }),
    ).toBe(false)

    const alongside = pallet(frameWidthM(node) / 2 + 0.5)
    expect(
      isClearAt({ node: alongside, position: alongside.position, rotationY: 0, nodes: scene }),
    ).toBe(true)
  })
})
