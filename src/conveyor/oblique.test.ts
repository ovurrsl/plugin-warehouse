import { beforeEach, describe, expect, test } from 'bun:test'
import { boxesOverlap, isClearAt, toWorldBox } from '../clash'
import { specOf } from '../pallet/presets'
import { PalletNode } from '../pallet/schema'
import { OBQ } from './catalog'
import {
  clearConveyorGeometryCache,
  conveyorGeometryCacheSize,
  getConveyorGeometry,
} from './geometry-builder'
import { resetLineIndex } from './line-index'
import { getObliqueGeometry, obliqueGeometryKey } from './oblique-geometry'
import {
  angleRad,
  branchBoxWidthM,
  branchEndLocal,
  branchLengthM,
  branchOffsetM,
  branchSign,
  divergeXM,
  footprintCentreZM,
  footprintM,
  mainLaneMm,
  mainWidthM,
  moduleLengthM,
} from './oblique-metrics'
import { conveyorObliqueParametrics } from './oblique-parametrics'
import { obliqueParts } from './oblique-parts'
import { ConveyorObliqueNode } from './oblique-schema'
import { jointProblems, resetPortMagnet, snapToLineEnd } from './port-magnet'
import { conveyorPorts, localPorts } from './ports'
import { ConveyorRollerNode } from './schema'

const oblique = (overrides: Record<string, unknown> = {}) =>
  ConveyorObliqueNode.parse({ id: 'conveyor_oblique_t', ...overrides })

describe('where the branch leaves is derived, never placed', () => {
  test('it clears the main frame exactly by the module’s end', () => {
    // The whole file turns on this: the branch has to carry its own frame clear
    // of the main one, and the body is a fixed 1500 mm, so the divergence point
    // is whatever satisfies both. Placing it by hand would let a shallow branch
    // overlap the line it just left.
    for (const angle of ['30', '45'] as const) {
      const node = oblique({ angle })
      const [endX, endZ] = branchEndLocal(node)
      expect(endX).toBeCloseTo(moduleLengthM(node) / 2, 9)
      expect(Math.abs(endZ)).toBeCloseTo(branchOffsetM(node), 9)
      // And the lateral reach really is the tangent of the angle over the run.
      const run = endX - divergeXM(node)
      expect(run * Math.tan(angleRad(node))).toBeCloseTo(branchOffsetM(node), 9)
    }
  })

  test('a shallower angle splits earlier, which is the trade it buys', () => {
    // At 30° the branch starts before the middle of the body and at 45° well
    // after it. Nothing else on screen says so, which is why the panel does.
    expect(divergeXM(oblique({ angle: '30' }))).toBeLessThan(0)
    expect(divergeXM(oblique({ angle: '45' }))).toBeGreaterThan(0)
    expect(branchLengthM(oblique({ angle: '30' }))).toBeGreaterThan(
      branchLengthM(oblique({ angle: '45' })),
    )
  })

  test('a default branch is clean, so a new one is not born yellow', () => {
    expect(
      conveyorObliqueParametrics.invariants?.flatMap((check) => check(oblique())) ?? [],
    ).toEqual([])
  })
})

describe('the branch is a narrower class, and that is the catalogue’s geometry', () => {
  test('467 outside against the main line’s 667', () => {
    const node = oblique()
    expect(mainWidthM(node)).toBeCloseTo(0.667, 9)
    expect(OBQ.branchExteriorWidthM).toBeCloseTo(0.467, 9)
    expect(branchBoxWidthM(node)).toBeLessThan(mainLaneMm(node) / 1000)
  })

  test('the ports say so, which is why a port carries its own lane', () => {
    // Read off the node, this machine would report its own branch as a width
    // mismatch against itself — every oblique ever placed would be yellow.
    const node = oblique()
    const ports = localPorts(node)
    expect(ports.map((port) => port.id)).toEqual(['a', 'b', 'c'])
    expect(ports[0]?.laneMm).toBe(mainLaneMm(node))
    expect(ports[1]?.laneMm).toBe(mainLaneMm(node))
    expect(ports[2]?.laneMm).toBeLessThan(mainLaneMm(node))
  })

  test('the panel names the narrower lane as the one a crossing box must fit', () => {
    const issues =
      conveyorObliqueParametrics.invariants?.flatMap((check) =>
        check(oblique({ shortestBox: 0.6 })),
      ) ?? []
    expect(issues.some((issue) => issue.field === 'shortestBox')).toBe(true)
  })
})

describe('the branch port is bidirectional, which is what `both` exists for', () => {
  test('the mode decides the role, and `both` is the default', () => {
    const roleOf = (mode: string) =>
      localPorts(oblique({ branchMode: mode }))?.find((port) => port.id === 'c')?.role
    expect(roleOf('both')).toBe('both')
    expect(roleOf('divert')).toBe('out')
    expect(roleOf('merge')).toBe('in')
    expect(oblique().branchMode).toBe('both')
  })

  test('the main pair still follows the flow', () => {
    for (const flow of ['forward', 'reverse'] as const) {
      const roles = Object.fromEntries(localPorts(oblique({ flow })).map((p) => [p.id, p.role]))
      expect([roles.a, roles.b].sort()).toEqual(['in', 'out'])
    }
  })

  test('the branch faces along its own heading, mirrored by the side', () => {
    for (const branchSide of ['left', 'right'] as const) {
      const node = oblique({ branchSide })
      const branch = localPorts(node).find((port) => port.id === 'c')
      if (!branch) throw new Error('no branch port')
      expect(branch.dx).toBeCloseTo(Math.cos(angleRad(node)), 9)
      expect(branch.dz).toBeCloseTo(branchSign(node) * Math.sin(angleRad(node)), 9)
    }
  })
})

describe('a divert will not mate a divert, and `both` accepts either', () => {
  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  const straight = (overrides: Record<string, unknown> = {}) =>
    ConveyorRollerNode.parse({ id: 'conveyor_roller_s', ...overrides })

  const portOf = (node: Parameters<typeof conveyorPorts>[0], id: 'a' | 'b' | 'c') => {
    const port = conveyorPorts(node).find((candidate) => candidate.id === id)
    if (!port) throw new Error(`no port ${id}`)
    return port
  }

  test('the main line joins a 600 mm straight cleanly', () => {
    const bed = straight({ usefulWidth: '600' })
    const node = oblique()
    const exact: [number, number, number] = [
      portOf(bed, 'b').position[0] - portOf(node, 'a').position[0],
      0,
      portOf(bed, 'b').position[2] - portOf(node, 'a').position[2],
    ]
    expect(snapToLineEnd(node, exact, 0, [], { [bed.id]: bed })).not.toBeNull()

    const joined = oblique({ position: exact })
    resetLineIndex()
    expect(jointProblems(joined, { [bed.id]: bed, [joined.id]: joined })).toEqual([])
  })

  test('a 600 mm straight on the branch is reported, because the branch is 400', () => {
    // R11 as a fact about this module rather than a general warning.
    const node = oblique({ position: [0, 0, 0] })
    const branch = portOf(node, 'c')
    const bed = straight({ id: 'conveyor_roller_b', usefulWidth: '600' })
    const exact: [number, number, number] = [
      branch.position[0] - portOf(bed, 'a').position[0],
      0,
      branch.position[2] - portOf(bed, 'a').position[2],
    ]
    const placed = straight({ id: 'conveyor_roller_b', usefulWidth: '600', position: exact })
    resetLineIndex()
    const problems = jointProblems(placed, { [node.id]: node, [placed.id]: placed })
    expect(problems.some((problem) => problem.includes('mm lane'))).toBe(true)
  })
})

describe('the footprint is asymmetric, because the branch leaves one side', () => {
  test('it spans both beds and its middle is offset from the node', () => {
    for (const branchSide of ['left', 'right'] as const) {
      const node = oblique({ branchSide })
      const [width, depth] = footprintM(node)
      const centre = footprintCentreZM(node)
      expect(width).toBeGreaterThanOrEqual(moduleLengthM(node) - 1e-9)
      expect(depth).toBeGreaterThan(mainWidthM(node))
      expect(Math.sign(centre)).toBe(branchSign(node))

      // Every part lies inside it.
      for (const part of obliqueParts(node, 'full')) {
        const reach = Math.max(part.size[0], part.size[2]) / 2
        expect(Math.abs(part.center[2] - centre)).toBeLessThanOrEqual(depth / 2 + reach)
      }
    }
  })

  test('the wedge between the beds stays free', () => {
    // The rectangle round a Y is mostly that wedge, and in a real layout it is
    // where the line the branch feeds runs. A single collider would refuse it.
    const node = oblique({ angle: '45', branchSide: 'left' })
    const scene = { [node.id]: node }
    // On the branch side, back where the branch has not left yet.
    const pallet = PalletNode.parse({
      id: 'pallet_o',
      position: [-0.6, 0, 0.75],
      rotation: [0, 0, 0],
    })
    expect(isClearAt({ node: pallet, position: pallet.position, rotationY: 0, nodes: scene })).toBe(
      true,
    )

    // And the point: the two *footprints* overlap, so the host's plan-only test
    // — the one `collides` would have used — refuses this placement. Only
    // reading the two beds gets it right.
    const [width, depth] = footprintM(node)
    const centre = footprintCentreZM(node)
    const spec = specOf(pallet.preset)
    expect(
      boxesOverlap(
        toWorldBox([0, 0.5, centre], [width, 1, depth], node.position, 0),
        toWorldBox([0, 0.5, 0], [spec.length, 1, spec.width], pallet.position, 0),
      ),
    ).toBe(true)
  })

  test('the branch bed itself is not free', () => {
    const node = oblique({ branchSide: 'left' })
    const scene = { [node.id]: node }
    const [endX, endZ] = branchEndLocal(node)
    const pallet = PalletNode.parse({
      id: 'pallet_ob',
      position: [endX - 0.2, 0, endZ * 0.8],
      rotation: [0, 0, 0],
    })
    expect(isClearAt({ node: pallet, position: pallet.position, rotationY: 0, nodes: scene })).toBe(
      false,
    )
  })
})

describe('the mesh', () => {
  beforeEach(() => {
    clearConveyorGeometryCache()
  })

  const sameMesh = (a: Float32Array, b: Float32Array) =>
    a.length === b.length && a.every((value, index) => value === b[index])

  const buildFresh = (node: ReturnType<typeof oblique>, abutted = false): Float32Array => {
    clearConveyorGeometryCache()
    const geometry = getObliqueGeometry(node, 'full', abutted)
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
    ['angle', '45'],
    ['branchSide', 'right'],
    ['rollerPitch', '100'],
    ['transportHeight', 0.57],
    ['frameColor', '#00ff00'],
    ['rollerColor', '#ff00ff'],
    ['diverterColor', '#123456'],
    // Must NOT move a vertex. `branchMode` decides what the port does, and a
    // port is not a vertex: a divert and a merge are the same steel.
    ['branchMode', 'divert'],
    ['speed', '25'],
    ['shortestBox', 0.6],
    ['flow', 'reverse'],
    ['name', 'Branch 1'],
    ['position', [12, 0, 4]],
    ['rotation', [0, Math.PI / 2, 0]],
    ['supportSlabId', 'slab_abcdefgh'],
  ]

  test('every field that changes the mesh changes the key, and none that do not', () => {
    for (const abutted of [false, true]) {
      const base = oblique()
      const baseMesh = buildFresh(base, abutted)
      const baseKey = obliqueGeometryKey(base, 'full', abutted)

      for (const [field, value] of VARIANTS) {
        const variant = oblique({ [field]: value })
        const changesMesh = !sameMesh(buildFresh(variant, abutted), baseMesh)
        const changesKey = obliqueGeometryKey(variant, 'full', abutted) !== baseKey
        expect({ abutted, field, changesKey }).toEqual({ abutted, field, changesKey: changesMesh })
      }
    }
  })

  test('it shares the straight’s pool, because it is one kind', () => {
    expect(conveyorGeometryCacheSize()).toBe(0)
    getConveyorGeometry(ConveyorRollerNode.parse({ id: 'conveyor_roller_p' }), 'full')
    getObliqueGeometry(oblique(), 'full')
    expect(conveyorGeometryCacheSize()).toBe(2)
  })

  test('the merge triangle is drawn, and only where there is one', () => {
    // Short rollers at the branch angle sitting on the main line: what actually
    // does the diverting, and what a fitter recognises the machine by.
    for (const angle of ['30', '45'] as const) {
      const node = oblique({ angle })
      const diverters = obliqueParts(node, 'full').filter((part) => part.role === 'diverter')
      expect(diverters).toHaveLength(1)
      expect(diverters[0]?.rotationY).not.toBe(0)
      expect(diverters[0]?.pattern).toBe('rollers')
    }
  })
})

describe('the inspector can reach every field, and every option it writes parses back', () => {
  const enumFields = conveyorObliqueParametrics.groups.flatMap((group) =>
    group.fields.flatMap((field) => (field.kind === 'enum' ? [field] : [])),
  )

  for (const field of enumFields) {
    test(`${field.key}: every option the control can write parses back unchanged`, () => {
      for (const option of field.options) {
        const edited = { ...oblique(), [field.key]: option }
        const reparsed = ConveyorObliqueNode.parse(edited) as Record<string, unknown>
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
      conveyorObliqueParametrics.groups.flatMap((group) => group.fields.map((field) => field.key)),
    )
    const missing = Object.keys(oblique()).filter(
      (key) => !shown.has(key as never) && !DELIBERATELY_HIDDEN.has(key),
    )
    expect(missing).toEqual([])
  })
})
