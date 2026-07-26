import { beforeEach, describe, expect, test } from 'bun:test'
import { curveGeometryKey, getCurveGeometry } from './curve-geometry'
import {
  angleRad,
  arcCentreLocal,
  arcPointLocal,
  boxClearsTheBend,
  CURVE_FRAME_OVERHANG_M,
  carriesShortestBox,
  centrelineLengthM,
  channelRadiiM,
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
import { curveParts } from './curve-parts'
import { ConveyorCurveNode } from './curve-schema'
import {
  clearConveyorGeometryCache,
  conveyorGeometryCacheSize,
  getConveyorGeometry,
} from './geometry-builder'
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
  const buildFresh = (node: ReturnType<typeof curve>): Float32Array => {
    clearConveyorGeometryCache()
    const geometry = getCurveGeometry(node, 'full')
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
    const base = curve()
    const baseMesh = buildFresh(base)
    const baseKey = curveGeometryKey(base, 'full')

    for (const [field, value] of VARIANTS) {
      const variant = curve({ [field]: value })
      const changesMesh = !sameMesh(buildFresh(variant), baseMesh)
      const changesKey = curveGeometryKey(variant, 'full') !== baseKey
      expect({ field, changesKey }).toEqual({ field, changesKey: changesMesh })
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
