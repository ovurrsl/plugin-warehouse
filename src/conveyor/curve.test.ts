import { beforeEach, describe, expect, test } from 'bun:test'
import { boxesOverlap, isClearAt, toWorldBox } from '../clash'
import { specOf } from '../pallet/presets'
import { PalletNode } from '../pallet/schema'
import { buildCurveFloorplan } from './curve-floorplan'
import { curveGeometryKey, getCurveGeometry } from './curve-geometry'
import {
  angleRad,
  arcCentreLocal,
  arcPointLocal,
  boxClearsTheBend,
  CURVE_FRAME_OVERHANG_M,
  carriesShortestBox,
  centrelineLengthM,
  centrelineRadiusM,
  channelRadiiM,
  colliderSegments,
  footprintM,
  frameWidthM,
  laneWidthM,
  longestBoxThroughBendM,
  outerRadiusM,
  pitchAtRadiusM,
  rollerCount,
  rollerStepRad,
  rollersUnderShortestBox,
  supportAngles,
} from './curve-metrics'
import { conveyorCurveParametrics } from './curve-parametrics'
import { curveParts } from './curve-parts'
import { ConveyorCurveNode } from './curve-schema'
import {
  clearConveyorGeometryCache,
  conveyorGeometryCacheSize,
  getConveyorGeometry,
} from './geometry-builder'
import { hasDownstreamNeighbour, lineOf, resetLineIndex } from './line-index'
import { jointProblems, resetPortMagnet, snapToLineEnd } from './port-magnet'
import { conveyorPorts } from './ports'
import { ConveyorRollerNode } from './schema'

const curve = (overrides: Record<string, unknown> = {}) =>
  ConveyorCurveNode.parse({ id: 'conveyor_curve_t', ...overrides })

describe('the bend is described from its arc centre but placed by its bounding box', () => {
  test('a quarter bend is square, and its side is the outer radius', () => {
    // The node cannot sit at the arc centre: `floorPlaced.footprint` is a box
    // centred on the node, and the arc centre is at a *corner* of the sector's
    // box — a footprint centred there would be twice too big and half empty,
    // and every collision test would be wrong by that much.
    const quarter = curve({ angle: '90' })
    const outer = outerRadiusM(quarter)
    const [width, depth] = footprintM(quarter)
    expect(width).toBeCloseTo(outer, 9)
    expect(depth).toBeCloseTo(outer, 9)
  })

  test('a half bend is a full diameter across and one radius deep', () => {
    const half = curve({ angle: '180' })
    const outer = outerRadiusM(half)
    expect(footprintM(half)).toEqual([expect.closeTo(2 * outer, 9), expect.closeTo(outer, 9)])
  })

  test('a 45° bend reaches neither axis, so its box is the chord, not the radius', () => {
    // The extremum at full outer radius only exists where the sweep crosses an
    // axis. Approximating the box as the quarter's would refuse placements that
    // physically fit — which is the failure the rack shipped once already.
    const shallow = curve({ angle: '45' })
    const [width, depth] = footprintM(shallow)
    expect(width).toBeLessThan(outerRadiusM(shallow))
    expect(depth).toBeLessThan(outerRadiusM(shallow))
  })

  test('every point of the sector lands inside the footprint, both hands', () => {
    for (const angle of ['45', '90', '180'] as const) {
      for (const handed of ['left', 'right'] as const) {
        const node = curve({ angle, handed })
        const [width, depth] = footprintM(node)
        const sweep = angleRad(node)

        for (let step = 0; step <= 32; step++) {
          const theta = (step / 32) * sweep
          for (const radius of [node.innerRadius, outerRadiusM(node)]) {
            const [x, z] = arcPointLocal(node, radius, theta)
            expect({
              angle,
              handed,
              inside: Math.abs(x) <= width / 2 + 1e-9 && Math.abs(z) <= depth / 2 + 1e-9,
            }).toEqual({ angle, handed, inside: true })
          }
        }
      }
    }
  })

  test('the two hands are mirror images, not the same bend', () => {
    const left = curve({ handed: 'left' })
    const right = curve({ handed: 'right' })
    const [lx, lz] = arcPointLocal(left, 1, 0.4)
    const [rx, rz] = arcPointLocal(right, 1, 0.4)
    expect(rx).toBeCloseTo(lx, 9)
    expect(rz).toBeCloseTo(-lz, 9)
    // And the box they occupy is the same, because a mirror preserves it.
    expect(footprintM(right)).toEqual(footprintM(left))
  })

  test('the arc centre offset is what puts the node at the middle of that box', () => {
    // A quarter's arc centre sits at a corner of its own bounding box, so the
    // offset is half the box on each axis — and on the −X, +Z corner, because
    // the sweep runs from local +X towards local −Z.
    const node = curve({ angle: '90' })
    const [ox, oz] = arcCentreLocal(node)
    const [width, depth] = footprintM(node)
    expect(ox).toBeCloseTo(-width / 2, 9)
    expect(oz).toBeCloseTo(depth / 2, 9)
  })
})

describe('the curve family carries its own catalogue figures', () => {
  test('the frame is 111 mm over the lane, not the straight family’s 147', () => {
    // Mecalux publishes 600 → 711 for CNV-CRA and 600 → 747 for the straights.
    // Sharing one constant would put 18 mm of imaginary steel on every bend.
    expect(CURVE_FRAME_OVERHANG_M).toBeCloseTo(0.111, 9)
    expect(frameWidthM(curve({ usefulWidth: '600' }))).toBeCloseTo(0.711, 9)
    expect(frameWidthM(curve({ usefulWidth: '400' }))).toBeCloseTo(0.511, 9)
  })

  test('the shortest box floor is 250 mm, above the family’s 150', () => {
    expect(() => curve({ shortestBox: 0.15 })).toThrow()
    expect(curve({ shortestBox: 0.25 }).shortestBox).toBe(0.25)
  })

  test('the lane stops at 600 mm, where the accumulator reaches 800', () => {
    expect(() => curve({ usefulWidth: '800' })).toThrow()
  })
})

describe('a tapered roller is a constant angular step', () => {
  test('the step divides the arc exactly, so no wedge of bare frame is left', () => {
    for (const angle of ['45', '90', '180'] as const) {
      for (const pitch of ['50', '75', '100'] as const) {
        const node = curve({ angle, rollerPitch: pitch })
        const covered = rollerStepRad(node) * rollerCount(node)
        expect({ angle, pitch, covered }).toEqual({
          angle,
          pitch,
          covered: expect.closeTo(angleRad(node), 9),
        })
      }
    }
  })

  test('the arc pitch grows with the radius, which is what the taper is for', () => {
    const node = curve()
    const inner = pitchAtRadiusM(node, node.innerRadius)
    const outer = pitchAtRadiusM(node, outerRadiusM(node))
    expect(outer).toBeGreaterThan(inner)
    // And the ratio is exactly the radius ratio — the definition of a cone
    // rolling on a radial axis.
    expect(outer / inner).toBeCloseTo(outerRadiusM(node) / node.innerRadius, 9)
  })

  test('the three-roller rule is read at the outer radius, where the fewest sit', () => {
    // A *minimum* count rule binds where the count is lowest, and the pitch is
    // widest on the outside — the very edge a bend throws a box towards. Read
    // at the inner radius the same curve looks fine and a short box drops
    // through at the outer kerb.
    const node = curve({ rollerPitch: '100', shortestBox: 0.25 })
    const outer = Math.floor(node.shortestBox / pitchAtRadiusM(node, outerRadiusM(node))) + 1
    const inner = Math.floor(node.shortestBox / pitchAtRadiusM(node, node.innerRadius)) + 1
    expect(rollersUnderShortestBox(node)).toBe(outer)
    expect(outer).toBeLessThan(inner)
    expect(carriesShortestBox(node)).toBe(outer >= 3)
  })

  test('supports are never further apart along the centreline than the straight’s', () => {
    for (const angle of ['45', '90', '180'] as const) {
      const node = curve({ angle })
      const stations = supportAngles(node)
      const radius = centrelineLengthM(node) / angleRad(node)
      const gaps = stations
        .slice(1)
        .map((theta, index) => (theta - (stations[index] ?? 0)) * radius)
      for (const gap of gaps) expect(gap).toBeLessThanOrEqual(1.5 + 1e-9)
      expect(stations[0]).toBeCloseTo(0, 9)
      expect(stations[stations.length - 1]).toBeCloseTo(angleRad(node), 9)
    }
  })
})

describe('a rigid box swings wider than the centreline', () => {
  test('the longest box is the one whose corner exactly touches the outer kerb', () => {
    // The property rather than the number, so the test survives a catalogue
    // figure changing. It also pins the fix: the swing is a difference of
    // squares, so measuring the channel from the frame's inner radius instead
    // of the kerb's inside does *not* cancel out — it understated the answer.
    for (const node of [curve(), curve({ innerRadius: 1.6 }), curve({ usefulWidth: '400' })]) {
      const [inner, outer] = channelRadiiM(node)
      const half = longestBoxThroughBendM(node) / 2
      const outerFace = (inner + outer) / 2 + laneWidthM(node) / 2
      expect(Math.hypot(outerFace, half)).toBeCloseTo(outer, 9)
    }
  })

  test('at the assumed 800 mm radius a full-width box reaches about 690 mm', () => {
    // Worth reporting rather than merely checking: a line carrying longer
    // cartons needs a wider bend, and the panel can say so before it is drawn
    // rather than after it is built.
    expect(longestBoxThroughBendM(curve())).toBeCloseTo(0.691, 3)
  })

  test('a wider radius takes a longer box, which is the whole geometry of it', () => {
    const tight = curve({ innerRadius: 0.5 })
    const wide = curve({ innerRadius: 2 })
    expect(longestBoxThroughBendM(wide)).toBeGreaterThan(longestBoxThroughBendM(tight))
  })

  test('a narrow box gets further round than a wide one at the same radius', () => {
    const node = curve()
    expect(longestBoxThroughBendM(node, 0.2)).toBeGreaterThan(longestBoxThroughBendM(node, 0.6))
  })

  test('the predicate and the figure agree, so the panel cannot say two things', () => {
    const node = curve()
    const longest = longestBoxThroughBendM(node)
    expect(boxClearsTheBend(node, longest)).toBe(true)
    expect(boxClearsTheBend(node, longest + 0.01)).toBe(false)
  })
})

describe('the mesh', () => {
  beforeEach(() => {
    clearConveyorGeometryCache()
  })

  /**
   * Every triangle faces the way its own normal says.
   *
   * The bug this exists for: a right-hand bend is the left one mirrored about
   * local X, and a mirror reverses winding — so the corner order that faces up
   * on one faces *down* on the other, and the bed would be invisible from above
   * on half of all curves while looking perfectly correct in the parts list.
   * Checked across every part, so a rotated box emitted with a stale normal
   * fails here too.
   */
  const windingFaults = (geometry: ReturnType<typeof getCurveGeometry>): number => {
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const index = geometry.getIndex()
    if (!index) throw new Error('indexed geometry expected')
    let faults = 0

    for (let triangle = 0; triangle < index.count; triangle += 3) {
      const [a, b, c] = [index.getX(triangle), index.getX(triangle + 1), index.getX(triangle + 2)]
      const edge1 = [
        position.getX(b) - position.getX(a),
        position.getY(b) - position.getY(a),
        position.getZ(b) - position.getZ(a),
      ]
      const edge2 = [
        position.getX(c) - position.getX(a),
        position.getY(c) - position.getY(a),
        position.getZ(c) - position.getZ(a),
      ]
      const cross = [
        (edge1[1] ?? 0) * (edge2[2] ?? 0) - (edge1[2] ?? 0) * (edge2[1] ?? 0),
        (edge1[2] ?? 0) * (edge2[0] ?? 0) - (edge1[0] ?? 0) * (edge2[2] ?? 0),
        (edge1[0] ?? 0) * (edge2[1] ?? 0) - (edge1[1] ?? 0) * (edge2[0] ?? 0),
      ]
      const dot =
        (cross[0] ?? 0) * normal.getX(a) +
        (cross[1] ?? 0) * normal.getY(a) +
        (cross[2] ?? 0) * normal.getZ(a)
      if (dot <= 0) faults++
    }
    return faults
  }

  test('no triangle is wound against its own normal, either hand, every angle', () => {
    for (const handed of ['left', 'right'] as const) {
      for (const angle of ['45', '90', '180'] as const) {
        const geometry = getCurveGeometry(curve({ angle, handed }), 'full')
        expect({ handed, angle, faults: windingFaults(geometry) }).toEqual({
          handed,
          angle,
          faults: 0,
        })
      }
    }
  })

  test('the bed is one quad pair per roller, so the stripe lands on the taper', () => {
    // Two faces of two triangles each, per angular step. If this ever becomes
    // "one quad for the whole sector" the painted rollers stop following the
    // arc and the bend reads as a smear.
    const node = curve()
    const geometry = getCurveGeometry(node, 'full')
    const deckTriangles = 4 * rollerCount(node)
    const partTriangles = curveParts(node, 'full').length * 12
    expect((geometry.getIndex()?.count ?? 0) / 3).toBe(deckTriangles + partTriangles)
  })

  test('a curve and a straight share one cache, because they are one kind', () => {
    // Two pools would each enforce the size limit against their own half, so
    // the limit would quietly mean less than it says.
    expect(conveyorGeometryCacheSize()).toBe(0)
    getConveyorGeometry(ConveyorRollerNode.parse({ id: 'conveyor_roller_t' }), 'full')
    expect(conveyorGeometryCacheSize()).toBe(1)
    getCurveGeometry(curve(), 'full')
    expect(conveyorGeometryCacheSize()).toBe(2)
  })

  test('two identical bends are one buffer', () => {
    const a = getCurveGeometry(curve({ id: 'conveyor_curve_a' }), 'full')
    const b = getCurveGeometry(curve({ id: 'conveyor_curve_b' }), 'full')
    expect(a).toBe(b)
    expect(conveyorGeometryCacheSize()).toBe(1)
  })

  const sameMesh = (a: Float32Array, b: Float32Array) =>
    a.length === b.length && a.every((value, index) => value === b[index])

  /**
   * The mesh, as one number sequence: positions, colours *and* UVs.
   *
   * All three, because all three are what a viewer sees. Position alone would
   * report a recoloured frame as an identical mesh and so let the key carry a
   * field it did not need; UVs matter more here than on a straight, since the
   * curve's entire stripe correctness is the V index per angular step.
   */
  const buildFresh = (node: ReturnType<typeof curve>, abutted = false): Float32Array => {
    clearConveyorGeometryCache()
    const geometry = getCurveGeometry(node, 'full', abutted)
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

  // One altered value per field, both directions. The negative side has to stay
  // populated: with it empty the test only proves the key is large enough, and
  // the cheapest way to pass that is to list every field.
  const VARIANTS: Array<[string, unknown]> = [
    ['angle', '45'],
    ['handed', 'right'],
    ['innerRadius', 1.4],
    ['usefulWidth', '400'],
    ['rollerPitch', '50'],
    ['transportHeight', 0.57],
    ['sideGuide', 'inner'],
    ['sideGuideHeight', 0.09],
    ['zones', '2'],
    ['frameColor', '#00ff00'],
    ['rollerColor', '#ff00ff'],
    ['profileColor', '#123456'],
    // Must NOT move a vertex.
    ['speed', '25'],
    ['flow', 'reverse'],
    ['shortestBox', 0.6],
    ['name', 'Bend 1'],
    ['position', [12, 0, 4]],
    ['rotation', [0, Math.PI / 2, 0]],
    ['supportSlabId', 'slab_abcdefgh'],
  ]

  test('every field that changes the mesh changes the key, and none that do not', () => {
    // Both abutment states. Unabutted, a curve's mesh does not follow `flow` at
    // all; abutted it does, through which support station it cedes — so half the
    // sweep cannot see half the key. The straight shipped exactly that gap.
    for (const abutted of [false, true]) {
      const base = curve()
      const baseMesh = buildFresh(base, abutted)
      const baseKey = curveGeometryKey(base, 'full', abutted)

      for (const [field, value] of VARIANTS) {
        const variant = curve({ [field]: value })
        const changesMesh = !sameMesh(buildFresh(variant, abutted), baseMesh)
        const changesKey = curveGeometryKey(variant, 'full', abutted) !== baseKey
        expect({ abutted, field, changesKey }).toEqual({ abutted, field, changesKey: changesMesh })
      }
    }
  })

  test('pairs of enum values are compared too, not just one representative', () => {
    // The rack shipped two finishes that were byte-identical because the table
    // above gave each enum a single value and so never compared the pair that
    // mattered. Every pair, both directions.
    const ENUMS: Array<[string, readonly string[]]> = [
      ['angle', ['45', '90', '180']],
      ['handed', ['left', 'right']],
      ['usefulWidth', ['400', '600']],
      ['rollerPitch', ['50', '75', '100']],
      ['sideGuide', ['none', 'inner', 'outer', 'both']],
      ['zones', ['0', '1', '2']],
    ]

    for (const [field, values] of ENUMS) {
      for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < values.length; j++) {
          const a = curve({ [field]: values[i] })
          const b = curve({ [field]: values[j] })
          const changesMesh = !sameMesh(buildFresh(a), buildFresh(b))
          const changesKey = curveGeometryKey(a, 'full') !== curveGeometryKey(b, 'full')
          expect({ field, pair: [values[i], values[j]], changesKey }).toEqual({
            field,
            pair: [values[i], values[j]],
            changesKey: changesMesh,
          })
        }
      }
    }
  })

  test('the shared support at a joint belongs to one of the two modules', () => {
    const node = curve()
    const alone = curveParts(node, 'full', false).filter((part) => part.role === 'leg').length
    const abutted = curveParts(node, 'full', true).filter((part) => part.role === 'leg').length
    expect(abutted).toBe(alone - 2)
    expect(curveGeometryKey(node, 'full', true)).not.toBe(curveGeometryKey(node, 'full', false))
  })

  test('simple drops the detail a bend stops resolving at, and keeps the bed', () => {
    const node = curve()
    const simple = curveParts(node, 'simple')
    expect(simple.some((part) => part.role === 'guide')).toBe(false)
    expect(simple.some((part) => part.role === 'footplate')).toBe(false)
    expect(simple.some((part) => part.role === 'motor')).toBe(false)
    expect(simple.some((part) => part.role === 'frame')).toBe(true)
    expect(simple.some((part) => part.role === 'leg')).toBe(true)
    expect(curveParts(node, 'simple').length).toBeLessThan(curveParts(node, 'full').length)
  })
})

describe('a bend joins a line, because a line is not made only of straights', () => {
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

  test('a bend’s ends are on its arc, not on an assumed ±X', () => {
    // The assumption a straight-only port list makes, and the one that would
    // put a quarter bend's inlet a metre out into the aisle.
    const node = curve({ angle: '90' })
    const radius = centrelineRadiusM(node)
    for (const [id, theta] of [
      ['a', 0],
      ['b', angleRad(node)],
    ] as const) {
      const [x, z] = arcPointLocal(node, radius, theta)
      const port = portOf(node, id)
      expect({ id, x: port.position[0], z: port.position[2] }).toEqual({
        id,
        x: expect.closeTo(x, 9),
        z: expect.closeTo(z, 9),
      })
      expect(port.position[1]).toBeCloseTo(node.transportHeight, 9)
    }
  })

  test('the two ends face apart by exactly the angle the bend turns', () => {
    for (const angle of ['45', '90', '180'] as const) {
      for (const handed of ['left', 'right'] as const) {
        const node = curve({ angle, handed })
        const a = portOf(node, 'a').direction
        const b = portOf(node, 'b').direction
        // Outward at both ends, so an unturned module would read −1: the turn
        // is what opens them up, and 180° brings them back to parallel.
        const dot = (a[0] ?? 0) * (b[0] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0)
        expect({ angle, handed, dot }).toEqual({
          angle,
          handed,
          dot: expect.closeTo(-Math.cos(angleRad(node)), 9),
        })
      }
    }
  })

  test('a straight and a bend magnet together and read back as one line', () => {
    const bed = straight()
    const outlet = portOf(bed, 'b')

    // Turned so its inlet faces back down the straight. Derived rather than
    // asserted: ask the ports where they are, then move the node by the
    // difference — the same arithmetic the magnet does.
    const rotation: [number, number, number] = [0, -Math.PI / 2, 0]
    const rough = curve({ id: 'conveyor_curve_c', position: [4, 0, 0], rotation })
    const inlet = portOf(rough, 'a')
    const exact: [number, number, number] = [
      rough.position[0] + (outlet.position[0] - inlet.position[0]),
      0,
      rough.position[2] + (outlet.position[2] - inlet.position[2]),
    ]

    // Dropped roughly there, the magnet finds the exact joint.
    const snapped = snapToLineEnd(rough, [exact[0] + 0.18, 0, exact[2] - 0.2], rotation[1], [], {
      [bed.id]: bed,
    })
    expect(snapped).not.toBeNull()
    expect(snapped?.[0]).toBeCloseTo(exact[0], 9)
    expect(snapped?.[2]).toBeCloseTo(exact[2], 9)

    // And placed there, the line index reads the two as one line.
    const joined = curve({ id: 'conveyor_curve_c', position: exact, rotation })
    const scene = { [bed.id]: bed, [joined.id]: joined }
    resetLineIndex()
    expect(lineOf(scene, bed.id).sort()).toEqual([joined.id, bed.id].sort())
    expect(hasDownstreamNeighbour(scene, bed)).toBe(true)
    expect(jointProblems(joined, scene)).toEqual([])
  })

  test('a bend on a different lane is refused, exactly as a straight would be', () => {
    // R1 is a rule about the kind, not about one shape of it — a 400 mm bend on
    // a 600 mm line is a place boxes stop, whichever end is curved.
    const bed = straight({ usefulWidth: '600' })
    const rotation: [number, number, number] = [0, -Math.PI / 2, 0]
    const narrow = curve({
      id: 'conveyor_curve_n',
      usefulWidth: '400',
      position: [4, 0, 0],
      rotation,
    })
    const outlet = portOf(bed, 'b')
    const inlet = portOf(narrow, 'a')
    const exact: [number, number, number] = [
      narrow.position[0] + (outlet.position[0] - inlet.position[0]),
      0,
      narrow.position[2] + (outlet.position[2] - inlet.position[2]),
    ]
    expect(snapToLineEnd(narrow, exact, rotation[1], [], { [bed.id]: bed })).toBeNull()

    // Built by hand anyway — by paste or by MCP — and the panel says why.
    const joined = curve({ id: 'conveyor_curve_n', usefulWidth: '400', position: exact, rotation })
    resetLineIndex()
    const problems = jointProblems(joined, { [bed.id]: bed, [joined.id]: joined })
    // Named from the neighbour's side, because that is the lane this bend is
    // being asked to accept boxes from.
    expect(problems).toContain('Joined to a 600 mm lane; a box wider than 400 mm cannot cross.')
  })
})

describe('the inspector can reach every field, and every option it writes parses back', () => {
  /**
   * The same sweep the straight has, and for the same reported bug: the enum
   * control declares `options: readonly string[]`, renders a value only when
   * `typeof value === 'string'`, and writes back `e.target.value`. A field
   * declared as a numeric literal union displayed the *first* option whatever it
   * really was, and the first edit stored a string the schema refused — so
   * `def.schema.parse(duplicateInfo)` threw and Duplicate was dead.
   *
   * The bend has two more of them than the straight, `angle` and `zones`, which
   * is precisely why this walks the descriptor rather than naming fields.
   */
  const enumFields = conveyorCurveParametrics.groups.flatMap((group) =>
    group.fields.flatMap((field) => (field.kind === 'enum' ? [field] : [])),
  )

  test('the descriptor offers enums at all, so the sweep below is not vacuous', () => {
    expect(enumFields.map((field) => field.key).sort()).toEqual([
      'angle',
      'flow',
      'handed',
      'rollerPitch',
      'sideGuide',
      'speed',
      'usefulWidth',
      'zones',
    ])
  })

  for (const field of enumFields) {
    test(`${field.key}: every option the control can write parses back unchanged`, () => {
      for (const option of field.options) {
        const edited = { ...curve(), [field.key]: option }
        const reparsed = ConveyorCurveNode.parse(edited) as Record<string, unknown>
        expect({ key: field.key, option, stored: reparsed[field.key] }).toEqual({
          key: field.key,
          option,
          stored: option,
        })
      }
    })
  }

  test('no editable field is unreachable from the panel', () => {
    // The failure this catches is silent: a field exists on the schema, the
    // geometry reads it, and nothing in the UI can change it. The rack shipped
    // exactly that when a panel was rebuilt and four fields lost their mount.
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
      // Elected at placement time from whatever slab is underneath; not a
      // choice a person makes in a number box.
      'supportSlabId',
    ])
    const shown = new Set(
      conveyorCurveParametrics.groups.flatMap((group) => group.fields.map((field) => field.key)),
    )
    const missing = Object.keys(curve()).filter(
      (key) => !shown.has(key as never) && !DELIBERATELY_HIDDEN.has(key),
    )
    expect(missing).toEqual([])
  })
})

describe('the bend brings warnings a straight cannot have', () => {
  const issuesFor = (overrides: Record<string, unknown>) =>
    conveyorCurveParametrics.invariants?.flatMap((check) => check(curve(overrides))) ?? []
  const fieldsOf = (overrides: Record<string, unknown>) =>
    issuesFor(overrides).map((issue) => issue.field)

  test('a default bend is clean, so a new one is not born yellow', () => {
    expect(issuesFor({})).toEqual([])
  })

  test('a bend too tight for a full-width box says so before it is drawn', () => {
    expect(fieldsOf({ innerRadius: 0.4 })).toContain('innerRadius')
    expect(fieldsOf({ innerRadius: 1.6 })).not.toContain('innerRadius')
  })

  test('a pitch that drops a short box between the rollers is caught at the outer edge', () => {
    expect(fieldsOf({ rollerPitch: '100' })).toContain('rollerPitch')
    expect(fieldsOf({ rollerPitch: '50' })).not.toContain('rollerPitch')
  })

  test('a bend with no outer rail is a bend boxes leave sideways', () => {
    for (const guide of ['none', 'inner'] as const) {
      expect(fieldsOf({ sideGuide: guide })).toContain('sideGuide')
    }
    for (const guide of ['outer', 'both'] as const) {
      expect(fieldsOf({ sideGuide: guide })).not.toContain('sideGuide')
    }
  })

  test('zones shorter than the boxes they accumulate are named', () => {
    expect(fieldsOf({ angle: '45', zones: '2' })).toContain('zones')
    expect(fieldsOf({ angle: '180', zones: '2' })).not.toContain('zones')
  })
})

describe('a bend occupies its arc, not the box around it', () => {
  const pallet = (position: [number, number, number]) =>
    PalletNode.parse({ id: 'pallet_t', position, rotation: [0, 0, 0] })

  test('the corner a bend curls around stays free', () => {
    // The reason the clash test reads segments rather than one box: a quarter
    // annulus fills under a third of its own bounding square, and in a real
    // layout the corner it curls around is exactly where the racking goes.
    const bend = curve({ angle: '90', handed: 'left' })
    const [ox, oz] = arcCentreLocal(bend)
    const scene = { [bend.id]: bend }

    // A Euro pallet centred on the arc centre reaches 721 mm to its corners,
    // inside the 800 mm the bed starts at.
    const inside = pallet([ox, 0, oz])
    expect(isClearAt({ node: inside, position: inside.position, rotationY: 0, nodes: scene })).toBe(
      true,
    )

    // And the point: the two *footprints* overlap, so the host's plan-only
    // test — the one `collides` would have used — refuses this placement. Only
    // reading the arc gets it right.
    const footprint = footprintM(bend)
    const spec = specOf(inside.preset)
    const asPlanRectangles = boxesOverlap(
      toWorldBox([0, 0.5, 0], [footprint[0], 1, footprint[1]], bend.position, 0),
      toWorldBox([0, 0.5, 0], [spec.length, 1, spec.width], inside.position, 0),
    )
    expect(asPlanRectangles).toBe(true)
  })

  test('the band itself is not free', () => {
    const bend = curve({ angle: '90', handed: 'left' })
    const [ox, oz] = arcCentreLocal(bend)
    const scene = { [bend.id]: bend }
    const onTheBed = pallet([ox + centrelineRadiusM(bend), 0, oz])
    expect(
      isClearAt({ node: onTheBed, position: onTheBed.position, rotationY: 0, nodes: scene }),
    ).toBe(false)
  })

  test('every point of the bed lies inside some stand-in box', () => {
    // What makes the segments a fair substitute for the arc rather than a
    // cheaper, leakier one.
    for (const angle of ['45', '90', '180'] as const) {
      for (const handed of ['left', 'right'] as const) {
        const bend = curve({ angle, handed })
        const segments = colliderSegments(bend)
        const sweep = angleRad(bend)

        for (let step = 0; step <= 48; step++) {
          const theta = (step / 48) * sweep
          const [px, pz] = arcPointLocal(bend, centrelineRadiusM(bend), theta)
          const covered = segments.some((segment) => {
            const cos = Math.cos(segment.rotationY)
            const sin = Math.sin(segment.rotationY)
            const dx = px - segment.center[0]
            const dz = pz - segment.center[1]
            // Into the segment's own frame, which is the inverse rotation.
            const localX = dx * cos + dz * sin
            const localZ = -dx * sin + dz * cos
            return (
              Math.abs(localX) <= segment.size[0] / 2 + 1e-9 &&
              Math.abs(localZ) <= segment.size[1] / 2 + 1e-9
            )
          })
          expect({ angle, handed, theta: theta.toFixed(3), covered }).toEqual({
            angle,
            handed,
            theta: theta.toFixed(3),
            covered: true,
          })
        }
      }
    }
  })
})

describe('the plan symbol is the same bend the mesh is', () => {
  const plan = (node: ReturnType<typeof curve>) =>
    buildCurveFloorplan(node, { viewState: undefined } as never)

  const firstPath = (group: ReturnType<typeof plan>) => {
    const child = group?.kind === 'group' ? group.children[0] : null
    if (child?.kind !== 'path') throw new Error('expected a path')
    return child.d
  }

  test('the sector starts where the arc does', () => {
    // The plan and the model agreeing is a fact rather than a hope only while
    // both read the same helper. This asserts they do.
    const node = curve({ angle: '90' })
    const numbers =
      firstPath(plan(node))
        .match(/-?\d+(\.\d+)?(e-?\d+)?/g)
        ?.map(Number) ?? []
    const [expectedX, expectedY] = arcPointLocal(node, outerRadiusM(node), 0)
    expect(numbers[0]).toBeCloseTo(expectedX, 9)
    expect(numbers[1]).toBeCloseTo(expectedY, 9)
  })

  test('the sweep flag follows the hand, so neither bend draws its complement', () => {
    // `M x y A r r 0 <large> <sweep> …` — the sweep flag is the ninth token.
    const flagOf = (d: string) => d.split(/\s+/)[8]
    expect(flagOf(firstPath(plan(curve({ handed: 'left' }))))).toBe('0')
    expect(flagOf(firstPath(plan(curve({ handed: 'right' }))))).toBe('1')
  })

  test('one tick per support and one arrow, whatever the angle', () => {
    for (const angle of ['45', '90', '180'] as const) {
      const node = curve({ angle })
      const group = plan(node)
      const children = group?.kind === 'group' ? group.children : []
      expect({ angle, lines: children.filter((child) => child.kind === 'line').length }).toEqual({
        angle,
        // Supports, plus the arrow's shaft.
        lines: supportAngles(node).length + 1,
      })
      expect(children.filter((child) => child.kind === 'path')).toHaveLength(2)
      expect(children.filter((child) => child.kind === 'polygon')).toHaveLength(1)
    }
  })
})
