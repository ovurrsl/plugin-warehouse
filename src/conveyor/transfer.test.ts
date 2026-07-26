import { beforeEach, describe, expect, test } from 'bun:test'
import { isClearAt } from '../clash'
import { PalletNode } from '../pallet/schema'
import { MTR } from './catalog'
import { MTR_STRIP_COUNT, MTR_STRIP_STROKE_M, MTR_STRIP_WIDTH_M } from './constants'
import { buildNetwork, isLifting, publishLifting, resetLifting } from './flow-simulation'
import {
  clearConveyorGeometryCache,
  conveyorGeometryCacheSize,
  getConveyorGeometry,
} from './geometry-builder'
import { resetLineIndex } from './line-index'
import { jointProblems, resetPortMagnet, snapToLineEnd } from './port-magnet'
import { conveyorPorts, localPorts } from './ports'
import { ConveyorRollerNode } from './schema'
import { getTransferGeometry, transferGeometryKey, transferStripsKey } from './transfer-geometry'
import {
  dischargeSign,
  frameWidthM,
  laneMm,
  moduleLengthM,
  rollerOffsetsX,
  stripOffsetsX,
  stripSpanM,
  widestRollerGapM,
} from './transfer-metrics'
import { conveyorTransferParametrics } from './transfer-parametrics'
import { stripParts, transferParts } from './transfer-parts'
import { ConveyorTransferNode } from './transfer-schema'

const transfer = (overrides: Record<string, unknown> = {}) =>
  ConveyorTransferNode.parse({ id: 'conveyor_transfer_t', ...overrides })

describe('the body is a size, not a lane plus an overhang', () => {
  test('708 by 723, fixed both ways', () => {
    // Every other shape in the family is lane-plus-something. This one has no
    // lane the frame is built around, which is why it brings no overhang
    // constant — and why looking for one would have produced a wrong number.
    const node = transfer()
    expect(moduleLengthM(node)).toBeCloseTo(0.708, 9)
    expect(frameWidthM(node)).toBeCloseTo(0.723, 9)
    expect(laneMm(node)).toBe(400)
  })

  test('the height floor is 500, not the family’s 370', () => {
    // The lift mechanism lives under the bed, which is also why this machine
    // shows a skirt where the others show their legs.
    expect(() => transfer({ transportHeight: 0.4 })).toThrow()
    expect(transfer({ transportHeight: 0.5 }).transportHeight).toBe(0.5)
  })

  test('it stops at 45 m/min where the family reaches 60', () => {
    expect(() => transfer({ speed: '60' })).toThrow()
    expect(MTR.speedsMPerMin).toEqual([25, 45])
  })
})

describe('the rollers fall in the gaps the strips leave', () => {
  test('no roller sits inside a strip', () => {
    // The reason this shape has no `rollerPitch` field: the strip layout is the
    // input and the spacing is what comes out. A pitch field would let the two
    // disagree, with rollers drawn straight through the strips.
    for (const travel of ['symmetric', 'asymmetric'] as const) {
      const node = transfer({ travel })
      const half = MTR_STRIP_WIDTH_M / 2
      for (const roller of rollerOffsetsX(node)) {
        for (const strip of stripOffsetsX(node)) {
          expect({ travel, clear: Math.abs(roller - strip) >= half }).toEqual({
            travel,
            clear: true,
          })
        }
      }
    }
  })

  test('the bed is one striped segment per gap, each carrying its own rollers', () => {
    // One stripe over the whole body would paint rollers through the strips.
    const node = transfer()
    const decks = transferParts(node, 'full').filter((part) => part.pattern === 'rollers')
    expect(decks).toHaveLength(MTR_STRIP_COUNT + 1)
    for (const deck of decks) expect(deck.stripeSpan).toBe(2)
    expect(rollerOffsetsX(node)).toHaveLength((MTR_STRIP_COUNT + 1) * 2)
  })

  test('the three-roller rule is read at the widest gap, not an average', () => {
    // The spacing is not uniform here — a strip sits between every pair of
    // groups — so the binding case has to be measured.
    const node = transfer()
    const widest = widestRollerGapM(node)
    const offsets = rollerOffsetsX(node)
    for (let index = 1; index < offsets.length; index++) {
      expect((offsets[index] ?? 0) - (offsets[index - 1] ?? 0)).toBeLessThanOrEqual(widest + 1e-9)
    }
  })

  test('a default transfer is clean, so a new one is not born yellow', () => {
    expect(
      conveyorTransferParametrics.invariants?.flatMap((check) => check(transfer())) ?? [],
    ).toEqual([])
  })
})

describe('the strips are steel, and they lean towards the discharge', () => {
  test('three of them, boxes rather than paint, and out of the merged body', () => {
    // A painted line cannot rise, and rising is the whole machine — so they are
    // boxes; and a merged buffer cannot move one part of itself, so they are
    // their own mesh.
    const strips = stripParts(transfer())
    expect(strips).toHaveLength(MTR_STRIP_COUNT)
    for (const strip of strips) expect(strip.pattern).toBeUndefined()
    expect(transferParts(transfer(), 'full').filter((part) => part.role === 'strip')).toHaveLength(
      0,
    )
  })

  test('asymmetric strips are shorter, and both builds reach the discharge edge', () => {
    for (const side of ['left', 'right'] as const) {
      const symmetric = transfer({ travel: 'symmetric', dischargeSide: side })
      const asymmetric = transfer({ travel: 'asymmetric', dischargeSide: side })
      expect(stripSpanM(asymmetric)).toBeLessThan(stripSpanM(symmetric))

      // Whatever the span, the far edge of a strip is the edge the box leaves
      // by — a strip that stopped short of it would set the box down inside.
      for (const node of [symmetric, asymmetric]) {
        const strip = stripParts(node)[0]
        if (!strip) throw new Error('no strip')
        const far = strip.center[2] + (dischargeSign(node) * strip.size[2]) / 2
        expect(Math.abs(far)).toBeCloseTo(frameWidthM(node) / 2, 9)
        expect(Math.sign(far)).toBe(dischargeSign(node))
      }
    }
  })
})

describe('three ends, all one class, and the third only ever discharges', () => {
  test('the cross port is an outlet whichever way the roller line runs', () => {
    // The strips lift a box off the line; they never set one onto it. That is
    // what makes this a transfer rather than a crossing.
    for (const flow of ['forward', 'reverse'] as const) {
      const roles = Object.fromEntries(localPorts(transfer({ flow })).map((p) => [p.id, p.role]))
      expect(roles.c).toBe('out')
      expect([roles.a, roles.b].filter((role) => role === 'out')).toHaveLength(1)
    }
  })

  test('every end reports the 400 mm class, the only one this type is built in', () => {
    for (const port of localPorts(transfer())) expect(port.laneMm).toBe(400)
  })

  test('the cross port sits on the discharge edge and faces out of it', () => {
    for (const side of ['left', 'right'] as const) {
      const node = transfer({ dischargeSide: side })
      const cross = localPorts(node).find((port) => port.id === 'c')
      if (!cross) throw new Error('no cross port')
      expect(cross.z).toBeCloseTo((dischargeSign(node) * frameWidthM(node)) / 2, 9)
      expect(cross.dz).toBe(dischargeSign(node))
    }
  })
})

describe('a 400 mm machine on a 600 mm line is refused, not silently joined', () => {
  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  test('R1 catches it, because this type has only one class to offer', () => {
    const bed = ConveyorRollerNode.parse({ id: 'conveyor_roller_s', usefulWidth: '600' })
    const outlet = conveyorPorts(bed).find((port) => port.id === 'b')
    const inlet = conveyorPorts(transfer()).find((port) => port.id === 'a')
    if (!outlet || !inlet) throw new Error('missing port')

    const exact: [number, number, number] = [
      outlet.position[0] - inlet.position[0],
      0,
      outlet.position[2] - inlet.position[2],
    ]
    expect(snapToLineEnd(transfer(), exact, 0, [], { [bed.id]: bed })).toBeNull()

    const joined = transfer({ position: exact })
    resetLineIndex()
    expect(jointProblems(joined, { [bed.id]: bed, [joined.id]: joined })).toContain(
      'Joined to a 600 mm lane; a box wider than 400 mm cannot cross.',
    )
  })

  test('a 400 mm straight joins it cleanly', () => {
    const bed = ConveyorRollerNode.parse({ id: 'conveyor_roller_n', usefulWidth: '400' })
    const outlet = conveyorPorts(bed).find((port) => port.id === 'b')
    const inlet = conveyorPorts(transfer()).find((port) => port.id === 'a')
    if (!outlet || !inlet) throw new Error('missing port')

    const exact: [number, number, number] = [
      outlet.position[0] - inlet.position[0],
      0,
      outlet.position[2] - inlet.position[2],
    ]
    expect(snapToLineEnd(transfer(), exact, 0, [], { [bed.id]: bed })).not.toBeNull()

    const joined = transfer({ position: exact })
    resetLineIndex()
    expect(jointProblems(joined, { [bed.id]: bed, [joined.id]: joined })).toEqual([])
  })
})

describe('the mesh', () => {
  beforeEach(() => {
    clearConveyorGeometryCache()
  })

  const sameMesh = (a: Float32Array, b: Float32Array) =>
    a.length === b.length && a.every((value, index) => value === b[index])

  const buildFresh = (node: ReturnType<typeof transfer>, abutted = false): Float32Array => {
    clearConveyorGeometryCache()
    const geometry = getTransferGeometry(node, 'full', abutted)
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
    // Against a symmetric base this moves nothing, and that is the point — the
    // key must not split on it. `asymmetric-right` below is where it does.
    ['dischargeSide', 'right'],
    ['travel', 'asymmetric'],
    ['transportHeight', 0.57],
    ['frameColor', '#00ff00'],
    ['rollerColor', '#ff00ff'],
    ['stripColor', '#123456'],
    // Must NOT move a vertex.
    ['speed', '25'],
    ['shortestBox', 0.5],
    ['flow', 'reverse'],
    ['name', 'Cross 1'],
    ['position', [12, 0, 4]],
    ['rotation', [0, Math.PI / 2, 0]],
    ['supportSlabId', 'slab_abcdefgh'],
  ]

  test('every field that changes the mesh changes the key, and none that do not', () => {
    for (const abutted of [false, true]) {
      const base = transfer()
      const baseMesh = buildFresh(base, abutted)
      const baseKey = transferGeometryKey(base, 'full', abutted)

      for (const [field, value] of VARIANTS) {
        const variant = transfer({ [field]: value })
        const changesMesh = !sameMesh(buildFresh(variant, abutted), baseMesh)
        const changesKey = transferGeometryKey(variant, 'full', abutted) !== baseKey
        expect({ abutted, field, changesKey }).toEqual({ abutted, field, changesKey: changesMesh })
      }
    }
  })

  test('the body is one buffer for every side and travel, now the strips have left', () => {
    // Both fields moved out with the strips: the body's four bed segments are
    // bounded by `stripOffsetsX`, which depends on neither. A key that still
    // carried them would split this buffer four ways for a difference it does
    // not contain — the over-reporting half of the key law, and the same one
    // the sweep caught on `dischargeSide` before the split.
    const bodies = (['symmetric', 'asymmetric'] as const).flatMap((travel) =>
      (['left', 'right'] as const).map((dischargeSide) => transfer({ travel, dischargeSide })),
    )
    const first = bodies[0]
    if (!first) throw new Error('no body')
    const reference = buildFresh(first)
    for (const node of bodies) {
      expect(sameMesh(buildFresh(node), reference)).toBe(true)
      expect(transferGeometryKey(node, 'full')).toBe(transferGeometryKey(first, 'full'))
    }
  })

  test('the strips carry the difference instead, and the stroke never reaches a key', () => {
    // A leaning strip set really is different steel; a *lifted* one is the same
    // three boxes at a different height, and a height is a transform. Keying on
    // the stroke would put two buffers behind every transfer in the building.
    const symmetric = transfer({ travel: 'symmetric', dischargeSide: 'left' })
    const mirrored = transfer({ travel: 'symmetric', dischargeSide: 'right' })
    expect(transferStripsKey(symmetric)).toBe(transferStripsKey(mirrored))

    const leanLeft = transfer({ travel: 'asymmetric', dischargeSide: 'left' })
    const leanRight = transfer({ travel: 'asymmetric', dischargeSide: 'right' })
    expect(transferStripsKey(leanLeft)).not.toBe(transferStripsKey(leanRight))
    expect(transferStripsKey(leanLeft)).not.toBe(transferStripsKey(symmetric))
    expect(transferStripsKey(symmetric)).not.toContain(String(MTR_STRIP_STROKE_M))
  })

  test('the strips lift only for a box crossing, not for one passing through', () => {
    // Route 1 is the cross discharge; route 0 goes straight over strips that
    // stay down. Getting that backwards would have every transfer twitching as
    // the main line runs past it.
    const node = transfer()
    const network = buildNetwork({ [node.id]: node })
    resetLifting()

    publishLifting(network, [{ nodeId: node.id, routeIndex: 0, distance: 0.2, seed: 1 }])
    expect(isLifting(node.id)).toBe(false)

    publishLifting(network, [{ nodeId: node.id, routeIndex: 1, distance: 0.2, seed: 1 }])
    expect(isLifting(node.id)).toBe(true)

    publishLifting(network, [])
    expect(isLifting(node.id)).toBe(false)
  })

  test('it shares the straight’s pool, because it is one kind', () => {
    expect(conveyorGeometryCacheSize()).toBe(0)
    getConveyorGeometry(ConveyorRollerNode.parse({ id: 'conveyor_roller_p' }), 'full')
    getTransferGeometry(transfer(), 'full')
    expect(conveyorGeometryCacheSize()).toBe(2)
  })
})

describe('the inspector can reach every field, and every option it writes parses back', () => {
  const enumFields = conveyorTransferParametrics.groups.flatMap((group) =>
    group.fields.flatMap((field) => (field.kind === 'enum' ? [field] : [])),
  )

  for (const field of enumFields) {
    test(`${field.key}: every option the control can write parses back unchanged`, () => {
      for (const option of field.options) {
        const edited = { ...transfer(), [field.key]: option }
        const reparsed = ConveyorTransferNode.parse(edited) as Record<string, unknown>
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
      conveyorTransferParametrics.groups.flatMap((group) => group.fields.map((field) => field.key)),
    )
    const missing = Object.keys(transfer()).filter(
      (key) => !shown.has(key as never) && !DELIBERATELY_HIDDEN.has(key),
    )
    expect(missing).toEqual([])
  })
})

describe('the volume is the body, skirt and legs included', () => {
  test('a pallet on it clashes and one clear of it does not', () => {
    const node = transfer()
    const scene = { [node.id]: node }
    const pallet = (z: number) =>
      PalletNode.parse({ id: 'pallet_m', position: [0, 0, z], rotation: [0, 0, 0] })

    const onTop = pallet(0)
    expect(isClearAt({ node: onTop, position: onTop.position, rotationY: 0, nodes: scene })).toBe(
      false,
    )
    const alongside = pallet(frameWidthM(node) / 2 + 0.5)
    expect(
      isClearAt({ node: alongside, position: alongside.position, rotationY: 0, nodes: scene }),
    ).toBe(true)
  })
})
