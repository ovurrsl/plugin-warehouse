import { describe, expect, test } from 'bun:test'
import { LINE_WIDTHS } from './constants'
import { buildRouteGeometry, markingGates, routeGeometryKey } from './geometry'
import { RouteNode } from './schema'
import { outerHalfWidthM } from './stripes'

const route = (patch: Record<string, unknown> = {}) => RouteNode.parse({ id: 'route_1', ...patch })

const STRAIGHT = [
  [0, 0],
  [12, 0],
] as [number, number][]

const triangles = (node: ReturnType<typeof route>) => {
  const geometry = buildRouteGeometry(node)
  return (geometry.getIndex()?.count ?? 0) / 3
}

describe('the key names what the builder consumes, and nothing else', () => {
  const FIELDS: { field: string; change: Record<string, unknown> }[] = [
    { field: 'width', change: { width: 4 } },
    { field: 'lineWidth', change: { lineWidth: 'wide' } },
    { field: 'traffic', change: { traffic: 'one-way' } },
    {
      field: 'points',
      change: {
        points: [
          [0, 0],
          [12, 3],
        ],
      },
    },
  ]

  for (const { field, change } of FIELDS) {
    test(`${field} moves the key exactly when it moves the mesh`, () => {
      const before = route({ points: STRAIGHT })
      const after = route({ points: STRAIGHT, ...change })
      const keyMoved = routeGeometryKey(before) !== routeGeometryKey(after)
      const meshMoved = triangles(before) !== triangles(after) || keyMoved
      expect({ field, keyMoved }).toEqual({ field, keyMoved: meshMoved })
    })
  }

  test('the same shape drawn somewhere else is one buffer', () => {
    // Translation must never mint a mesh. The builder reads every vertex
    // relative to the first, so a route at the far end of the building shares
    // the buffer of an identical one at the origin.
    const here = route({ points: STRAIGHT })
    const there = route({
      points: [
        [40, 25],
        [52, 25],
      ],
      position: [40, 0, 25],
    })
    expect(routeGeometryKey(there)).toBe(routeGeometryKey(here))
  })

  test('a walkway and a one-way aisle of the same width are the same mesh', () => {
    // **What deriving the gates buys.** `role` and `traffic` reach the buffer
    // only through `arrows` and `divider`; listing them raw would split the
    // cache on a change that moves no vertex.
    const walkway = route({ points: STRAIGHT, role: 'pedestrian', traffic: 'one-way', width: 3 })
    const aisle = route({ points: STRAIGHT, role: 'vehicle', traffic: 'one-way', width: 3 })
    expect(routeGeometryKey(aisle)).toBe(routeGeometryKey(walkway))
  })

  test('nothing that cannot move a vertex reaches the key', () => {
    const base = route({ points: STRAIGHT, role: 'vehicle', traffic: 'one-way' })
    const key = routeGeometryKey(base)
    for (const patch of [
      { id: 'route_other' },
      { name: 'Ana koridor' },
      { position: [9, 0, 9] },
      { rotation: [0, 1.2, 0] },
      { supportSlabId: 'slab_7' },
      { requiredFor: 'reach' },
      { datum: 'frame-face' },
    ] as Record<string, unknown>[]) {
      expect(
        routeGeometryKey(
          route({ points: STRAIGHT, role: 'vehicle', traffic: 'one-way', ...patch }),
        ),
      ).toBe(key)
    }
  })
})

describe('the gates are what the mesh actually branches on', () => {
  test('one-way draws arrows, two-way does not', () => {
    expect(markingGates(route({ traffic: 'one-way' })).arrows).toBe(true)
    expect(markingGates(route({ traffic: 'two-way' })).arrows).toBe(false)
  })

  test('only a two-way vehicle aisle gets a lane divider', () => {
    expect(markingGates(route({ role: 'vehicle', traffic: 'two-way' })).divider).toBe(true)
    expect(markingGates(route({ role: 'vehicle', traffic: 'one-way' })).divider).toBe(false)
    expect(markingGates(route({ role: 'pedestrian', traffic: 'two-way' })).divider).toBe(false)
  })

  test('arrows and a divider are never both drawn', () => {
    // They both sit on the axis, so they would be coplanar with each other —
    // the one overlap the two-rank depth bias could not separate. Mutually
    // exclusive by construction rather than by z-ordering.
    for (const role of ['pedestrian', 'vehicle'] as const) {
      for (const traffic of ['one-way', 'two-way'] as const) {
        const gates = markingGates(route({ role, traffic }))
        expect(gates.arrows && gates.divider).toBe(false)
      }
    }
  })
})

describe('what gets built is paint, and only paint', () => {
  test('a plain two-way walkway is two ribbons and nothing else', () => {
    // One quad per stripe per segment: two stripes, one segment, four triangles.
    expect(triangles(route({ points: STRAIGHT, traffic: 'two-way' }))).toBe(4)
  })

  test('every vertex lies flat, at local zero', () => {
    // The height comes from the host's floor lift and nothing else. A builder
    // that baked its own Y would fight the slab elevation and float the paint.
    const geometry = buildRouteGeometry(route({ points: STRAIGHT, traffic: 'one-way' }))
    const position = geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      expect(position.getY(i)).toBe(0)
    }
  })

  test('every face points up', () => {
    const geometry = buildRouteGeometry(route({ points: STRAIGHT, traffic: 'one-way' }))
    const normal = geometry.getAttribute('normal')
    for (let i = 0; i < normal.count; i++) {
      expect(normal.getY(i)).toBe(1)
    }
  })

  test('the paint stays inside the route’s own outer edge', () => {
    const node = route({ points: STRAIGHT, width: 3.2, lineWidth: 'wide', traffic: 'one-way' })
    const geometry = buildRouteGeometry(node)
    const position = geometry.getAttribute('position')
    const limit = outerHalfWidthM(node.width, node.lineWidth) + 1e-6
    for (let i = 0; i < position.count; i++) {
      expect(Math.abs(position.getZ(i))).toBeLessThanOrEqual(limit)
    }
  })

  test('a stripe is exactly its declared width', () => {
    const node = route({ points: STRAIGHT, width: 3.2, lineWidth: 'standard' })
    const geometry = buildRouteGeometry(node)
    const position = geometry.getAttribute('position')
    const offsets = new Set<string>()
    for (let i = 0; i < position.count; i++) offsets.add(position.getZ(i).toFixed(6))
    // Four distinct edges: inner and outer of each stripe.
    expect(offsets.size).toBe(4)
    const sorted = [...offsets].map(Number).sort((a, b) => a - b)
    expect((sorted[1] ?? 0) - (sorted[0] ?? 0)).toBeCloseTo(LINE_WIDTHS.standard, 6)
    expect((sorted[3] ?? 0) - (sorted[2] ?? 0)).toBeCloseTo(LINE_WIDTHS.standard, 6)
    // And the clear width between the inner faces is what the schema promised.
    expect((sorted[2] ?? 0) - (sorted[1] ?? 0)).toBeCloseTo(3.2, 6)
  })

  test('arrows and dividers land in their own draw group', () => {
    // Two groups so one buffer serves two colours without a second draw call.
    const plain = buildRouteGeometry(route({ points: STRAIGHT, traffic: 'two-way' }))
    expect(plain.groups).toHaveLength(1)

    const arrowed = buildRouteGeometry(route({ points: STRAIGHT, traffic: 'one-way' }))
    expect(arrowed.groups).toHaveLength(2)
    expect(arrowed.groups[1]?.materialIndex).toBe(1)
  })

  test('a long leg gets more arrows, but never an unbounded number', () => {
    // An arrow every N metres makes the primitive count grow with route LENGTH
    // rather than node count, and none of them is legible at the zoom that
    // shows the whole run.
    const short = triangles(
      route({
        points: [
          [0, 0],
          [12, 0],
        ],
        traffic: 'one-way',
      }),
    )
    const long = triangles(
      route({
        points: [
          [0, 0],
          [200, 0],
        ],
        traffic: 'one-way',
      }),
    )
    expect(long).toBeGreaterThan(short)
    expect(long - 4).toBeLessThanOrEqual(4)
  })

  test('a two-way aisle’s divider is dashed rather than solid', () => {
    const solidish = triangles(route({ points: STRAIGHT, role: 'pedestrian', traffic: 'two-way' }))
    const dashed = triangles(route({ points: STRAIGHT, role: 'vehicle', traffic: 'two-way' }))
    // 12 m at a 2 m period is six dashes, two triangles each.
    expect(dashed - solidish).toBe(12)
  })
})
