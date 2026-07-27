import { describe, expect, test } from 'bun:test'
import { aisleBandForVariant } from '../handling/metrics'
import { PEDESTRIAN_WIDTH_M } from './catalog'
import { defaultWidthM, routeReading } from './metrics'
import { RouteNode } from './schema'

const route = (patch: Record<string, unknown> = {}) => RouteNode.parse({ id: 'route_1', ...patch })

describe('a route starts at a width somebody published', () => {
  test('a vehicle aisle starts at its class’s minimum', () => {
    // The ordinary gesture produces an aisle that is exactly wide enough, so
    // the margin starts at zero rather than at an accident.
    expect(defaultWidthM('vehicle', 'forklift')).toBeCloseTo(3.2, 9)
    expect(defaultWidthM('vehicle', 'reach')).toBeCloseTo(2.6, 9)
    expect(defaultWidthM('vehicle', 'turret')).toBeCloseTo(1.7, 9)
  })

  test('a vehicle aisle with no class named assumes the commonest truck', () => {
    expect(defaultWidthM('vehicle', null)).toBe(defaultWidthM('vehicle', 'forklift'))
  })

  test('a walkway starts at 1.20 m, not the 2.0 the old editor used', () => {
    // 2.0 m is ASR's 300-person band. Defaulting to it quietly eats two metres
    // of floor along every wall of the building.
    expect(defaultWidthM('pedestrian', null)).toBeCloseTo(PEDESTRIAN_WIDTH_M, 9)
    expect(PEDESTRIAN_WIDTH_M).toBeLessThan(2)
  })
})

describe('a route reports what it is, and refuses to grade what it cannot', () => {
  test('a forklift aisle drawn short reports a negative margin', () => {
    // The 3.10 m the multiply panel actually lays out, read from the paint's
    // side. `rack/envelope.test.ts` records the same 100 mm from the steel's.
    const reading = routeReading(route({ role: 'vehicle', requiredFor: 'forklift', width: 3.1 }))
    expect(reading.marginM).toBeCloseTo(-0.1, 9)
    expect(reading.band?.basis).toBe('published')
  })

  test('an aisle drawn to the published minimum reads exactly zero', () => {
    const reading = routeReading(route({ role: 'vehicle', requiredFor: 'forklift', width: 3.2 }))
    expect(reading.marginM).toBeCloseTo(0, 9)
  })

  test('a walkway has no margin at all, because nothing published grades one', () => {
    // No instrument binding a Turkish user states a pedestrian-route width, and
    // the German table is a starting point rather than a test. A margin here
    // would be a number invented to look like a check.
    const reading = routeReading(route({ role: 'pedestrian' }))
    expect(reading.band).toBeNull()
    expect(reading.marginM).toBeNull()
  })

  test('a margin against an unrated truck still carries its estimate note', () => {
    const reading = routeReading(route({ role: 'vehicle', requiredFor: 'hand-pallet', width: 2.4 }))
    expect(reading.band?.basis).toBe('estimate')
    expect(reading.band?.note.length).toBeGreaterThan(0)
    expect(reading.marginM).toBeCloseTo(2.4 - aisleBandForVariant('hand-pallet').min, 9)
  })

  test('the length is the centreline, so it is the paint quantity', () => {
    const reading = routeReading(
      route({
        points: [
          [0, 0],
          [3, 0],
          [3, 4],
        ],
      }),
    )
    expect(reading.lengthM).toBeCloseTo(7, 9)
  })
})

describe('the schema defaults to something drawable', () => {
  test('an empty route parses into a two-point walkway', () => {
    const node = route()
    expect(node.points.length).toBeGreaterThanOrEqual(2)
    expect(node.role).toBe('pedestrian')
    expect(node.width).toBeCloseTo(PEDESTRIAN_WIDTH_M, 9)
    expect(node.requiredFor).toBeNull()
    expect(node.datum).toBe('load-face')
  })

  test('a single-vertex route is refused', () => {
    // Two points is the minimum that has a direction, and everything from the
    // offset to the arrows needs one.
    expect(RouteNode.safeParse({ id: 'route_1', points: [[0, 0]] }).success).toBe(false)
  })

  test('the load face is the default datum, and it is a real choice', () => {
    expect(route().datum).toBe('load-face')
    expect(route({ datum: 'frame-face' }).datum).toBe('frame-face')
  })
})
