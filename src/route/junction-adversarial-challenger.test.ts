import { describe, expect, test } from 'bun:test'
import { type ApproachSpec, classifyRouteJunction, solveApproachCuts } from './intersections'

const DEG2RAD = Math.PI / 180.0

describe('Challenger M1: Junction Classification Boundary Angles', () => {
  test('164.99° vs 165.01° (bend-v vs straight)', () => {
    const v0: [number, number] = [1, 0]
    const radBelow = 164.99 * DEG2RAD
    const radAbove = 165.01 * DEG2RAD

    const vBelow: [number, number] = [Math.cos(radBelow), Math.sin(radBelow)]
    const vAbove: [number, number] = [Math.cos(radAbove), Math.sin(radAbove)]

    expect(classifyRouteJunction([v0, vBelow])).toBe('bend-v')
    expect(classifyRouteJunction([v0, vAbove])).toBe('straight')
  })

  test('74.99° vs 75.01° (bend-v vs bend-l)', () => {
    const v0: [number, number] = [1, 0]
    const radBelow = 74.99 * DEG2RAD
    const radAbove = 75.01 * DEG2RAD

    const vBelow: [number, number] = [Math.cos(radBelow), Math.sin(radBelow)]
    const vAbove: [number, number] = [Math.cos(radAbove), Math.sin(radAbove)]

    expect(classifyRouteJunction([v0, vBelow])).toBe('bend-v')
    expect(classifyRouteJunction([v0, vAbove])).toBe('bend-l')
  })

  test('104.99° vs 105.01° (bend-l vs bend-v)', () => {
    const v0: [number, number] = [1, 0]
    const radBelow = 104.99 * DEG2RAD
    const radAbove = 105.01 * DEG2RAD

    const vBelow: [number, number] = [Math.cos(radBelow), Math.sin(radBelow)]
    const vAbove: [number, number] = [Math.cos(radAbove), Math.sin(radAbove)]

    expect(classifyRouteJunction([v0, vBelow])).toBe('bend-l')
    expect(classifyRouteJunction([v0, vAbove])).toBe('bend-v')
  })

  test('149.99° vs 150.01° (y vs tee)', () => {
    const v0: [number, number] = [1, 0]
    const radBelow = 149.99 * DEG2RAD
    const radAbove = 150.01 * DEG2RAD

    // 3-way with widest angle at 149.99°
    const vBelow: [number, number] = [Math.cos(radBelow), Math.sin(radBelow)]
    const bisectorBelow: [number, number] = [Math.cos(radBelow / 2), Math.sin(radBelow / 2)]
    expect(classifyRouteJunction([v0, vBelow, bisectorBelow])).toBe('y')

    // 3-way with widest angle at 150.01°
    const vAbove: [number, number] = [Math.cos(radAbove), Math.sin(radAbove)]
    const bisectorAbove: [number, number] = [Math.cos(radAbove / 2), Math.sin(radAbove / 2)]
    expect(classifyRouteJunction([v0, vAbove, bisectorAbove])).toBe('tee')
  })

  test('4-way axis angle: 74.99° vs 75.01° (four-way-x vs four-way-plus)', () => {
    const axisA1: [number, number] = [1, 0]
    const axisA2: [number, number] = [-1, 0]

    // Axis B at 74.99°
    const phiBelow = 74.99 * DEG2RAD
    const axisB1Below: [number, number] = [Math.cos(phiBelow), Math.sin(phiBelow)]
    const axisB2Below: [number, number] = [-Math.cos(phiBelow), -Math.sin(phiBelow)]
    expect(classifyRouteJunction([axisA1, axisA2, axisB1Below, axisB2Below])).toBe('four-way-x')

    // Axis B at 75.01°
    const phiAbove = 75.01 * DEG2RAD
    const axisB1Above: [number, number] = [Math.cos(phiAbove), Math.sin(phiAbove)]
    const axisB2Above: [number, number] = [-Math.cos(phiAbove), -Math.sin(phiAbove)]
    expect(classifyRouteJunction([axisA1, axisA2, axisB1Above, axisB2Above])).toBe('four-way-plus')
  })

  test('4-way axis angle upper boundary: 104.99° vs 105.01°', () => {
    const axisA1: [number, number] = [1, 0]
    const axisA2: [number, number] = [-1, 0]

    // Axis B at 104.99° (acute axis angle = 180° - 104.99° = 75.01°)
    const phiInside = 104.99 * DEG2RAD
    const axisB1Inside: [number, number] = [Math.cos(phiInside), Math.sin(phiInside)]
    const axisB2Inside: [number, number] = [-Math.cos(phiInside), -Math.sin(phiInside)]
    expect(classifyRouteJunction([axisA1, axisA2, axisB1Inside, axisB2Inside])).toBe(
      'four-way-plus',
    )

    // Axis B at 105.01° (acute axis angle = 180° - 105.01° = 74.99°)
    const phiOutside = 105.01 * DEG2RAD
    const axisB1Outside: [number, number] = [Math.cos(phiOutside), Math.sin(phiOutside)]
    const axisB2Outside: [number, number] = [-Math.cos(phiOutside), -Math.sin(phiOutside)]
    expect(classifyRouteJunction([axisA1, axisA2, axisB1Outside, axisB2Outside])).toBe('four-way-x')
  })

  test('4-way with non-straight through legs (< 165°) emits four-way-x even with orthogonal 90° axes', () => {
    // Route 1 is kinked at 164.99°
    const k1 = 164.99 * DEG2RAD
    const legA1: [number, number] = [1, 0]
    const legA2: [number, number] = [Math.cos(k1), Math.sin(k1)]

    // Route 2 is perfectly straight along perpendicular axis
    const legB1: [number, number] = [0, 1]
    const legB2: [number, number] = [0, -1]

    expect(classifyRouteJunction([legA1, legA2, legB1, legB2])).toBe('four-way-x')
  })
})

describe('Challenger M1: Junction Topological Degrees & Extremes', () => {
  test('degree 0 (isolated)', () => {
    expect(classifyRouteJunction([])).toBe('isolated')
  })

  test('degree 1 (dead-end)', () => {
    expect(classifyRouteJunction([[1, 0]])).toBe('dead-end')
    expect(classifyRouteJunction([[-0.5, 0.866]])).toBe('dead-end')
  })

  test('degrees 5+ (multi-leg)', () => {
    for (const legCount of [5, 6, 7, 8, 12, 20]) {
      const legs: Array<[number, number]> = []
      for (let i = 0; i < legCount; i++) {
        const theta = (i * 2 * Math.PI) / legCount
        legs.push([Math.cos(theta), Math.sin(theta)])
      }
      expect(classifyRouteJunction(legs)).toBe('multi-leg')
    }
  })

  test('unnormalized incident vectors give identical classification as unit vectors', () => {
    // 90 degree turn with large and tiny vectors
    const v1: [number, number] = [1000, 0]
    const v2: [number, number] = [0, 0.0001]
    expect(classifyRouteJunction([v1, v2])).toBe('bend-l')

    // Straight with unequal vectors
    const s1: [number, number] = [450, 0]
    const s2: [number, number] = [-0.05, 0]
    expect(classifyRouteJunction([s1, s2])).toBe('straight')
  })

  test('zero-magnitude vector input does not crash and handles safely', () => {
    const zero: [number, number] = [0, 0]
    const v1: [number, number] = [1, 0]
    expect(classifyRouteJunction([zero, v1])).toBe('bend-v')
  })
})

describe('Challenger M1: solveApproachCuts Collinear & Reflex Geometric Configurations', () => {
  test('2 collinear approaches opposite (180°) produce symmetric halfWidth cut with zero NaN', () => {
    const approaches: ApproachSpec[] = [
      { id: 'east', angle: 0, halfWidth: 1.5 },
      { id: 'west', angle: Math.PI, halfWidth: 1.5 },
    ]
    const cuts = solveApproachCuts(approaches, 3.0)
    expect(cuts.east).toBeCloseTo(1.5, 4)
    expect(cuts.west).toBeCloseTo(1.5, 4)
    expect(Number.isFinite(cuts.east)).toBe(true)
    expect(Number.isFinite(cuts.west)).toBe(true)
    expect(Number.isNaN(cuts.east)).toBe(false)
    expect(Number.isNaN(cuts.west)).toBe(false)
  })

  test('2 identical approaches (heading 0° and 0°) clamp cleanly without division by zero', () => {
    const approaches: ApproachSpec[] = [
      { id: 'a1', angle: 0, halfWidth: 1.2 },
      { id: 'a2', angle: 0, halfWidth: 1.2 },
    ]
    const cuts = solveApproachCuts(approaches, 3.0)
    expect(cuts.a1).toBeCloseTo(1.2 * 3, 4) // clamped by halfWidth * 3
    expect(cuts.a2).toBeCloseTo(1.2 * 3, 4)
    expect(Number.isFinite(cuts.a1)).toBe(true)
    expect(Number.isFinite(cuts.a2)).toBe(true)
  })

  test('2 micro-angle approaches (0.0001 rad) avoid infinity via sinHalf clamp', () => {
    const approaches: ApproachSpec[] = [
      { id: 'a1', angle: 0, halfWidth: 2.0 },
      { id: 'a2', angle: 0.0001, halfWidth: 2.0 },
    ]
    const cuts = solveApproachCuts(approaches, 3.0)
    expect(cuts.a1).toBeLessThanOrEqual(2.0 * 3)
    expect(cuts.a1).toBeGreaterThanOrEqual(2.0)
    expect(Number.isFinite(cuts.a1)).toBe(true)
  })

  test('3 approaches with 2 collinear (T-junction) handle Math.PI gap safely', () => {
    const approaches: ApproachSpec[] = [
      { id: 'east', angle: 0, halfWidth: 1.0 },
      { id: 'west', angle: Math.PI, halfWidth: 1.0 },
      { id: 'north', angle: Math.PI / 2, halfWidth: 1.0 },
    ]
    const cuts = solveApproachCuts(approaches, 2.0)
    expect(cuts.east).toBeGreaterThanOrEqual(1.0)
    expect(cuts.west).toBeGreaterThanOrEqual(1.0)
    expect(cuts.north).toBeGreaterThanOrEqual(1.0)
    expect(Number.isFinite(cuts.east)).toBe(true)
    expect(Number.isFinite(cuts.west)).toBe(true)
    expect(Number.isFinite(cuts.north)).toBe(true)
    expect(Number.isNaN(cuts.east)).toBe(false)
    expect(Number.isNaN(cuts.west)).toBe(false)
    expect(Number.isNaN(cuts.north)).toBe(false)
  })

  test('3 approaches with reflex gap (0°, 30°, 60° -> 300° reflex gap) activate fallback safely', () => {
    const approaches: ApproachSpec[] = [
      { id: 'leg0', angle: 0, halfWidth: 1.5 },
      { id: 'leg1', angle: 30 * DEG2RAD, halfWidth: 1.5 },
      { id: 'leg2', angle: 60 * DEG2RAD, halfWidth: 1.5 },
    ]
    const cuts = solveApproachCuts(approaches, 2.5)
    for (const app of approaches) {
      expect(cuts[app.id]).toBeGreaterThanOrEqual(app.halfWidth)
      expect(Number.isFinite(cuts[app.id])).toBe(true)
      expect(Number.isNaN(cuts[app.id])).toBe(false)
    }
  })

  test('4 approaches orthogonal (+ junction: 0°, 90°, 180°, 270°) compute symmetric cutbacks', () => {
    const approaches: ApproachSpec[] = [
      { id: 'east', angle: 0, halfWidth: 1.0 },
      { id: 'north', angle: Math.PI / 2, halfWidth: 1.0 },
      { id: 'west', angle: Math.PI, halfWidth: 1.0 },
      { id: 'south', angle: (3 * Math.PI) / 2, halfWidth: 1.0 },
    ]
    const cuts = solveApproachCuts(approaches, 2.0)
    expect(cuts.east).toBeCloseTo(cuts.north!, 3)
    expect(cuts.north).toBeCloseTo(cuts.west!, 3)
    expect(cuts.west).toBeCloseTo(cuts.south!, 3)
    expect(cuts.east).toBeGreaterThanOrEqual(1.0)
    expect(Number.isFinite(cuts.east)).toBe(true)
  })

  test('5+ approaches (5, 8, 12 legs) all produce valid finite cuts >= halfWidth', () => {
    for (const count of [5, 8, 12]) {
      const approaches: ApproachSpec[] = Array.from({ length: count }, (_, i) => ({
        id: `app_${count}_${i}`,
        angle: (i * 2 * Math.PI) / count,
        halfWidth: 1.2,
      }))
      const cuts = solveApproachCuts(approaches, 2.0)
      for (const app of approaches) {
        expect(cuts[app.id]).toBeDefined()
        expect(cuts[app.id]).toBeGreaterThanOrEqual(app.halfWidth)
        expect(Number.isFinite(cuts[app.id])).toBe(true)
        expect(Number.isNaN(cuts[app.id])).toBe(false)
      }
    }
  })
})

describe('Challenger M1: solveApproachCuts Numerical Stability & Edge Cases', () => {
  test('requestedRadius = 0 does not divide by zero', () => {
    const approaches: ApproachSpec[] = [
      { id: 'a', angle: 0, halfWidth: 1.0 },
      { id: 'b', angle: Math.PI / 2, halfWidth: 1.0 },
      { id: 'c', angle: Math.PI, halfWidth: 1.0 },
    ]
    const cuts = solveApproachCuts(approaches, 0)
    for (const app of approaches) {
      expect(cuts[app.id]).toBeGreaterThanOrEqual(app.halfWidth)
      expect(Number.isFinite(cuts[app.id])).toBe(true)
      expect(Number.isNaN(cuts[app.id])).toBe(false)
    }
  })

  test('negative requestedRadius falls back safely without NaN', () => {
    const approaches: ApproachSpec[] = [
      { id: 'a', angle: 0, halfWidth: 1.0 },
      { id: 'b', angle: Math.PI / 2, halfWidth: 1.0 },
      { id: 'c', angle: Math.PI, halfWidth: 1.0 },
    ]
    const cuts = solveApproachCuts(approaches, -5.0)
    for (const app of approaches) {
      expect(cuts[app.id]).toBeGreaterThanOrEqual(app.halfWidth)
      expect(Number.isFinite(cuts[app.id])).toBe(true)
    }
  })

  test('large requestedRadius (10,000m) maintains finite values with zero NaN', () => {
    const approaches: ApproachSpec[] = [
      { id: 'a', angle: 0, halfWidth: 1.0 },
      { id: 'b', angle: Math.PI / 2, halfWidth: 1.0 },
      { id: 'c', angle: Math.PI, halfWidth: 1.0 },
    ]
    const cuts = solveApproachCuts(approaches, 10000.0)
    for (const app of approaches) {
      expect(cuts[app.id]).toBeGreaterThanOrEqual(app.halfWidth)
      expect(Number.isFinite(cuts[app.id])).toBe(true)
      expect(Number.isNaN(cuts[app.id])).toBe(false)
    }
  })

  test('microscopic halfWidth (0.0001m) does not underflow or produce NaN', () => {
    const approaches: ApproachSpec[] = [
      { id: 'a', angle: 0, halfWidth: 0.0001 },
      { id: 'b', angle: Math.PI / 2, halfWidth: 0.0001 },
    ]
    const cuts = solveApproachCuts(approaches, 1.0)
    expect(cuts.a).toBeGreaterThanOrEqual(0.0001)
    expect(cuts.b).toBeGreaterThanOrEqual(0.0001)
    expect(Number.isFinite(cuts.a)).toBe(true)
    expect(Number.isFinite(cuts.b)).toBe(true)
  })

  test('approaches with negative angles (e.g. -PI/2, -PI) wrap and sort correctly', () => {
    const approaches: ApproachSpec[] = [
      { id: 'north', angle: Math.PI / 2, halfWidth: 1.0 },
      { id: 'south', angle: -Math.PI / 2, halfWidth: 1.0 },
      { id: 'east', angle: 0, halfWidth: 1.0 },
    ]
    const cuts = solveApproachCuts(approaches, 2.0)
    for (const app of approaches) {
      expect(cuts[app.id]).toBeDefined()
      expect(cuts[app.id]).toBeGreaterThanOrEqual(app.halfWidth)
      expect(Number.isFinite(cuts[app.id])).toBe(true)
      expect(Number.isNaN(cuts[app.id])).toBe(false)
    }
  })

  test('approaches with duplicate coincident angles activate det < 1e-6 fallback safely', () => {
    const approaches: ApproachSpec[] = [
      { id: 'dup1', angle: 0, halfWidth: 1.0 },
      { id: 'dup2', angle: 0, halfWidth: 1.0 },
      { id: 'branch', angle: Math.PI / 2, halfWidth: 1.0 },
    ]
    const cuts = solveApproachCuts(approaches, 2.0)
    expect(cuts.dup1).toBeDefined()
    expect(cuts.dup2).toBeDefined()
    expect(cuts.branch).toBeDefined()
    expect(Number.isFinite(cuts.dup1)).toBe(true)
    expect(Number.isFinite(cuts.dup2)).toBe(true)
    expect(Number.isFinite(cuts.branch)).toBe(true)
  })
})
