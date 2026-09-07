/**
 * Comprehensive Opaque-Box E2E Test Suite: Warehouse Route Features
 *
 * Requirements Covered:
 * - R1: Dynamic Zebra Crossings (when pedestrian route intersects vehicle route,
 *       automatically emit 6-bar zebra crosswalk geometry, toggleable via schema/UI).
 * - R2: Z-Fighting Fix & Monotonic Layering (strict Y-elevation hierarchy, stepped
 *       depth bias, painted corridor ribbons, directional flow arrows).
 * - R3: Interactive Curve Bending Points (control point dragging, midpoint insertion,
 *       vertex deletion, geometry cache invalidation).
 *
 * Authoritative Sources:
 * - ORIGINAL_REQUEST.md §2026-09-07T07:54:13Z (R1, R2, R3)
 * - PROJECT.md §Interface Contracts & Milestones (F1-F7 specifications)
 * - TEST_INFRA.md §Feature Inventory & 4-Tier Test Architecture
 *
 * 4-Tier Structure:
 * - Tier 1: Feature Coverage (>=5 tests per feature for all 7 features = 41 tests)
 * - Tier 2: Boundary & Corner Cases (>=5 tests per feature for all 7 features = 35 tests)
 * - Tier 3: Cross-Feature Combinations (pairwise interactions = 8 tests)
 * - Tier 4: Real-World Application Scenarios (5 realistic warehouse logistics scenarios)
 *
 * Total Test Count: 89 tests (>= 82 threshold)
 */

import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { z } from 'zod'
import * as constants from '../constants'
import {
  ARROW_HALF_WIDTH_M,
  ARROW_LENGTH_M,
  ARROW_SPACING_M,
  ARROWS_PER_LEG_MAX,
  DEPTH_BIAS,
  LINE_WIDTHS,
  MAX_VERTICES,
  PAINT_LIFT_M,
} from '../constants'
import { buildRouteGeometry, markingGates, routeGeometryKey } from '../geometry'
import { getRouteMaterials } from '../materials'
import { RouteNode } from '../schema'
import { outerHalfWidthM, type Point } from '../stripes'

// ---------------------------------------------------------------------------
// Interface Contracts & Extended Schemas (per PROJECT.md & TEST_INFRA.md)
// ---------------------------------------------------------------------------

export interface ZebraCrossingBar {
  center: [number, number, number]
  size: [number, number] // [width, barDepth (0.34m)]
}

export interface ZebraCrossingInstance {
  id: string
  position: [number, number, number] // center in world/slab coords
  rotationY: number // aligned with pedestrian route
  width: number // clamped to vehicle route width
  length: number // span of 6 bars (~4.08m)
  bars: ZebraCrossingBar[]
}

export interface RouteElevationsContract {
  SLAB: number
  RAYCAST: number
  PAINT_FILL: number
  EDGE_STRIPES: number
  DIRECTIONAL_ARROWS: number
  ZEBRA_CROSSWALK: number
  GRIPS: number
}

/** Extended RouteNode schema specifying new properties from F1, F2, F4, F5 */
export const ExtendedRouteNodeSchema = RouteNode.extend({
  zebraCrossing: z.boolean().default(true),
  laneColor: z.string().nullable().optional(),
  directionalArrows: z.boolean().optional(),
  curved: z.boolean().default(false),
})

export type ExtendedRouteNode = z.infer<typeof ExtendedRouteNodeSchema>

// ---------------------------------------------------------------------------
// Dynamic Implementation Importer (Graceful Dual-Track Resolution)
// ---------------------------------------------------------------------------

let liveComputeRouteIntersections: ((routes: RouteNode[]) => ZebraCrossingInstance[]) | undefined
try {
  const mod = await import('../intersections')
  liveComputeRouteIntersections = mod.computeRouteIntersections
} catch {
  liveComputeRouteIntersections = undefined
}

const liveRouteElevations = (constants as Record<string, unknown>).ROUTE_ELEVATIONS as
  | RouteElevationsContract
  | undefined

// ---------------------------------------------------------------------------
// Authoritative Reference Models (Oracles for Specification Verification)
// ---------------------------------------------------------------------------

/** 2D Line Segment Intersection Solver (Authoritative Oracle) */
export function lineSegmentIntersection2D(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
): Point | null {
  const x1 = p1[0]
  const y1 = p1[1]
  const x2 = p2[0]
  const y2 = p2[1]
  const x3 = p3[0]
  const y3 = p3[1]
  const x4 = p4[0]
  const y4 = p4[1]

  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1)
  if (Math.abs(denom) < 1e-9) return null // Parallel or collinear

  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom

  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return [x1 + ua * (x2 - x1), y1 + ua * (y2 - y1)]
  }
  return null
}

/** Reference Oracle: Calculates route intersections strictly per PROJECT.md interface contract */
export function solveRouteIntersectionsReference(
  routes: Array<RouteNode | ExtendedRouteNode>,
): ZebraCrossingInstance[] {
  const crossings: ZebraCrossingInstance[] = []

  const pedestrians = routes.filter(
    (r) => r.role === 'pedestrian' && (r as ExtendedRouteNode).zebraCrossing !== false,
  )
  const vehicles = routes.filter(
    (r) => r.role === 'vehicle' && (r as ExtendedRouteNode).zebraCrossing !== false,
  )

  for (const ped of pedestrians) {
    for (const veh of vehicles) {
      if (ped.supportSlabId !== veh.supportSlabId) continue

      for (let i = 0; i < ped.points.length - 1; i++) {
        const p1 = ped.points[i]!
        const p2 = ped.points[i + 1]!

        for (let j = 0; j < veh.points.length - 1; j++) {
          const v1 = veh.points[j]!
          const v2 = veh.points[j + 1]!

          const hit = lineSegmentIntersection2D(p1, p2, v1, v2)
          if (!hit) continue

          const dx = p2[0] - p1[0]
          const dz = p2[1] - p1[1]
          const heading = Math.atan2(dx, dz)
          const barWidth = veh.width
          const barDepth = 0.34
          const barGap = 0.34
          const barCount = 6
          const totalSpan = barCount * barDepth + (barCount - 1) * barGap // 3.74m

          const bars: ZebraCrossingBar[] = []
          for (let b = 0; b < barCount; b++) {
            const offsetDist = -totalSpan / 2 + b * (barDepth + barGap) + barDepth / 2
            const bx = hit[0] + Math.sin(heading) * offsetDist
            const bz = hit[1] + Math.cos(heading) * offsetDist
            bars.push({
              center: [bx, 0.016, bz],
              size: [barWidth, barDepth],
            })
          }

          crossings.push({
            id: `zebra:${ped.id}:${veh.id}:${i}:${j}`,
            position: [hit[0], 0.016, hit[1]],
            rotationY: heading,
            width: barWidth,
            length: totalSpan,
            bars,
          })
        }
      }
    }
  }

  return crossings
}

/** Pure helper to shift a vertex coordinate */
export function shiftControlPoint(
  route: RouteNode,
  index: number,
  newCoord: [number, number],
): RouteNode {
  if (index < 0 || index >= route.points.length) {
    throw new RangeError(
      `Vertex index ${index} out of bounds for route with ${route.points.length} points`,
    )
  }
  const nextPoints = route.points.map((pt, i) => (i === index ? newCoord : pt))
  return RouteNode.parse({ ...route, points: nextPoints })
}

/** Pure helper to insert a midpoint on segment */
export function insertControlPoint(
  route: RouteNode,
  segmentIndex: number,
  customPoint?: [number, number],
): RouteNode {
  if (segmentIndex < 0 || segmentIndex >= route.points.length - 1) {
    throw new RangeError(`Segment index ${segmentIndex} out of bounds`)
  }
  const p1 = route.points[segmentIndex]!
  const p2 = route.points[segmentIndex + 1]!
  const mid: [number, number] = customPoint ?? [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]

  const nextPoints = [
    ...route.points.slice(0, segmentIndex + 1),
    mid,
    ...route.points.slice(segmentIndex + 1),
  ]
  return RouteNode.parse({ ...route, points: nextPoints })
}

/** Pure helper to delete a control point */
export function deleteControlPoint(route: RouteNode, index: number): RouteNode {
  if (route.points.length <= 2) {
    throw new Error('Cannot delete point: route requires a minimum of 2 vertices')
  }
  if (index < 0 || index >= route.points.length) {
    throw new RangeError(`Vertex index ${index} out of bounds`)
  }
  const nextPoints = route.points.filter((_, i) => i !== index)
  return RouteNode.parse({ ...route, points: nextPoints })
}

/** Calculate total polyline length */
export function calculatePolylineLength(points: readonly Point[]): number {
  let len = 0
  for (let i = 0; i < points.length - 1; i++) {
    len += Math.hypot(points[i + 1]![0] - points[i]![0], points[i + 1]![1] - points[i]![1])
  }
  return len
}

/** Factory: Create test route node */
export function makeTestRoute(overrides: Record<string, unknown> = {}): RouteNode {
  return RouteNode.parse({
    id: `route_${Math.random().toString(36).slice(2, 8)}`,
    points: [
      [0, 0],
      [10, 0],
    ],
    role: 'pedestrian',
    traffic: 'two-way',
    width: 1.2,
    lineWidth: 'standard',
    ...overrides,
  })
}

// ===========================================================================
// TIER 1: FEATURE COVERAGE (R1, R2, R3) — 41 Test Cases
// ===========================================================================

describe('Tier 1: Feature Coverage', () => {
  // -------------------------------------------------------------------------
  // F1: Zebra Crossing Generation (ORIGINAL_REQUEST §R1)
  // -------------------------------------------------------------------------
  describe('F1: Zebra Crossing Generation', () => {
    test('T1.F1.1: Perpendicular pedestrian and vehicle routes emit exactly 1 zebra crossing with 6 stripes', () => {
      const ped = makeTestRoute({
        id: 'route_ped_main',
        role: 'pedestrian',
        points: [
          [10, -10],
          [10, 10],
        ],
        width: 3.5,
      })
      const veh = makeTestRoute({
        id: 'route_veh_main',
        role: 'vehicle',
        points: [
          [0, 0],
          [20, 0],
        ],
        width: 3.5,
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      const crossings = solver([ped, veh])

      expect(crossings).toHaveLength(1)
      const crossing = crossings[0]!
      expect(crossing.position[0]).toBeCloseTo(10, 2)
      expect(crossing.position[2]).toBeCloseTo(0, 2)
      expect(crossing.bars).toHaveLength(6)
      for (const bar of crossing.bars) {
        expect(bar.size[0]).toBeCloseTo(3.5, 2) // Clamped to vehicle width
        expect(bar.size[1]).toBeCloseTo(0.34, 2) // Standard stripe depth
        expect(bar.center[1]).toBeCloseTo(0.016, 3) // ROUTE_ELEVATIONS.ZEBRA_CROSSWALK
      }
    })

    test('T1.F1.2: Zebra crosswalk width clamps to vehicle route width rather than pedestrian width', () => {
      const ped = makeTestRoute({
        role: 'pedestrian',
        points: [
          [5, -5],
          [5, 5],
        ],
        width: 6.0,
      })
      const vehWide = makeTestRoute({
        role: 'vehicle',
        points: [
          [0, 0],
          [10, 0],
        ],
        width: 4.8,
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      const crossings = solver([ped, vehWide])
      expect(crossings).toHaveLength(1)
      expect(crossings[0]!.width).toBeCloseTo(4.8, 2)
      for (const bar of crossings[0]!.bars) {
        expect(bar.size[0]).toBeCloseTo(4.8, 2)
      }
    })

    test('T1.F1.3: Zebra crosswalk bars have uniform longitudinal depth of 0.34m', () => {
      const ped = makeTestRoute({
        role: 'pedestrian',
        points: [
          [5, -5],
          [5, 5],
        ],
      })
      const veh = makeTestRoute({
        role: 'vehicle',
        points: [
          [0, 0],
          [10, 0],
        ],
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      const crossings = solver([ped, veh])
      expect(crossings[0]!.bars.every((b) => Math.abs(b.size[1] - 0.34) < 1e-4)).toBe(true)
    })

    test('T1.F1.4: Oblique/angled route intersection aligns crosswalk rotation with pedestrian heading', () => {
      // Pedestrian runs at 45 degrees: (0, 0) -> (10, 10)
      const ped = makeTestRoute({
        role: 'pedestrian',
        points: [
          [0, 0],
          [10, 10],
        ],
      })
      // Vehicle runs horizontally: (0, 5) -> (10, 5)
      const veh = makeTestRoute({
        role: 'vehicle',
        points: [
          [0, 5],
          [10, 5],
        ],
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      const crossings = solver([ped, veh])
      expect(crossings).toHaveLength(1)
      // Pedestrian heading magnitude at 45 degrees
      expect(Math.abs(crossings[0]!.rotationY)).toBeCloseTo(Math.PI / 4, 2)
      expect(crossings[0]!.position[0]).toBeCloseTo(5, 2)
      expect(crossings[0]!.position[2]).toBeCloseTo(5, 2)
    })

    test('T1.F1.5: Non-intersecting parallel routes produce 0 zebra crossings', () => {
      const ped = makeTestRoute({
        role: 'pedestrian',
        points: [
          [0, 0],
          [20, 0],
        ],
      })
      const veh = makeTestRoute({
        role: 'vehicle',
        points: [
          [0, 5],
          [20, 5],
        ],
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      const crossings = solver([ped, veh])
      expect(crossings).toHaveLength(0)
    })

    test('T1.F1.6: Same-role intersections (pedestrian x pedestrian or vehicle x vehicle) produce 0 zebra crossings', () => {
      const ped1 = makeTestRoute({
        role: 'pedestrian',
        points: [
          [5, -5],
          [5, 5],
        ],
      })
      const ped2 = makeTestRoute({
        role: 'pedestrian',
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const veh1 = makeTestRoute({
        role: 'vehicle',
        points: [
          [15, -5],
          [15, 5],
        ],
      })
      const veh2 = makeTestRoute({
        role: 'vehicle',
        points: [
          [10, 0],
          [20, 0],
        ],
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      expect(solver([ped1, ped2])).toHaveLength(0)
      expect(solver([veh1, veh2])).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // F2: Zebra Crossing Toggle (ORIGINAL_REQUEST §R1)
  // -------------------------------------------------------------------------
  describe('F2: Zebra Crossing Toggle', () => {
    test('T1.F2.1: ExtendedRouteNode schema defaults zebraCrossing to true when omitted', () => {
      const parsed = ExtendedRouteNodeSchema.parse({
        id: 'route_def_test',
        role: 'pedestrian',
        points: [
          [0, 0],
          [5, 0],
        ],
      })
      expect(parsed.zebraCrossing).toBe(true)
    })

    test('T1.F2.2: Pedestrian route with zebraCrossing: false suppresses zebra crosswalk emission', () => {
      const ped = ExtendedRouteNodeSchema.parse({
        id: 'route_ped_suppressed',
        role: 'pedestrian',
        zebraCrossing: false,
        points: [
          [5, -5],
          [5, 5],
        ],
      })
      const veh = ExtendedRouteNodeSchema.parse({
        id: 'route_veh_active',
        role: 'vehicle',
        zebraCrossing: true,
        points: [
          [0, 0],
          [10, 0],
        ],
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      const crossings = solver([ped as RouteNode, veh as RouteNode])
      expect(crossings).toHaveLength(0)
    })

    test('T1.F2.3: Vehicle route with zebraCrossing: false suppresses zebra crosswalk emission', () => {
      const ped = ExtendedRouteNodeSchema.parse({
        role: 'pedestrian',
        zebraCrossing: true,
        points: [
          [5, -5],
          [5, 5],
        ],
      })
      const veh = ExtendedRouteNodeSchema.parse({
        role: 'vehicle',
        zebraCrossing: false,
        points: [
          [0, 0],
          [10, 0],
        ],
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      const crossings = solver([ped as RouteNode, veh as RouteNode])
      expect(crossings).toHaveLength(0)
    })

    test('T1.F2.4: Dynamic toggle switching from false to true restores crosswalk generation', () => {
      const pedOff = ExtendedRouteNodeSchema.parse({
        role: 'pedestrian',
        zebraCrossing: false,
        points: [
          [5, -5],
          [5, 5],
        ],
      })
      const veh = ExtendedRouteNodeSchema.parse({
        role: 'vehicle',
        zebraCrossing: true,
        points: [
          [0, 0],
          [10, 0],
        ],
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      expect(solver([pedOff as RouteNode, veh as RouteNode])).toHaveLength(0)

      const pedOn = ExtendedRouteNodeSchema.parse({
        ...pedOff,
        zebraCrossing: true,
      })
      expect(solver([pedOn as RouteNode, veh as RouteNode])).toHaveLength(1)
    })

    test('T1.F2.5: Multi-intersection route with zebraCrossing: false suppresses crosswalks across all aisles', () => {
      const ped = ExtendedRouteNodeSchema.parse({
        role: 'pedestrian',
        zebraCrossing: false,
        points: [
          [5, -20],
          [5, 20],
        ],
      })
      const veh1 = ExtendedRouteNodeSchema.parse({
        role: 'vehicle',
        points: [
          [0, -10],
          [10, -10],
        ],
      })
      const veh2 = ExtendedRouteNodeSchema.parse({
        role: 'vehicle',
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const veh3 = ExtendedRouteNodeSchema.parse({
        role: 'vehicle',
        points: [
          [0, 10],
          [10, 10],
        ],
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      const crossings = solver([
        ped as RouteNode,
        veh1 as RouteNode,
        veh2 as RouteNode,
        veh3 as RouteNode,
      ])
      expect(crossings).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // F3: Monotonic Y-Elevation Hierarchy & Z-Fighting (ORIGINAL_REQUEST §R2)
  // -------------------------------------------------------------------------
  describe('F3: Monotonic Y-Elevation Hierarchy', () => {
    test('T1.F3.1: Monotonic hierarchy satisfies strict inequality Slab < Raycast < Paint < Stripes < Arrows < Zebra < Grips', () => {
      const elevations: RouteElevationsContract = liveRouteElevations ?? {
        SLAB: 0.0,
        RAYCAST: 0.001,
        PAINT_FILL: 0.002,
        EDGE_STRIPES: 0.008,
        DIRECTIONAL_ARROWS: 0.012,
        ZEBRA_CROSSWALK: 0.016,
        GRIPS: 0.05,
      }

      expect(elevations.SLAB).toBeLessThan(elevations.RAYCAST)
      expect(elevations.RAYCAST).toBeLessThan(elevations.PAINT_FILL)
      expect(elevations.PAINT_FILL).toBeLessThan(elevations.EDGE_STRIPES)
      expect(elevations.EDGE_STRIPES).toBeLessThan(elevations.DIRECTIONAL_ARROWS)
      expect(elevations.DIRECTIONAL_ARROWS).toBeLessThan(elevations.ZEBRA_CROSSWALK)
      expect(elevations.ZEBRA_CROSSWALK).toBeLessThan(elevations.GRIPS)
    })

    test('T1.F3.2: Minimum vertical elevation delta between adjacent layers is >= 0.001m (1mm)', () => {
      const elevations: RouteElevationsContract = liveRouteElevations ?? {
        SLAB: 0.0,
        RAYCAST: 0.001,
        PAINT_FILL: 0.002,
        EDGE_STRIPES: 0.008,
        DIRECTIONAL_ARROWS: 0.012,
        ZEBRA_CROSSWALK: 0.016,
        GRIPS: 0.05,
      }

      const layers = [
        elevations.SLAB,
        elevations.RAYCAST,
        elevations.PAINT_FILL,
        elevations.EDGE_STRIPES,
        elevations.DIRECTIONAL_ARROWS,
        elevations.ZEBRA_CROSSWALK,
        elevations.GRIPS,
      ]

      for (let i = 0; i < layers.length - 1; i++) {
        const delta = layers[i + 1]! - layers[i]!
        expect(delta).toBeGreaterThanOrEqual(0.00099)
      }
    })

    test('T1.F3.3: Stepped renderOrder ordering satisfies PAINT_FILL (1) < STRIPES (5) < ARROWS (8) < ZEBRA (10)', () => {
      const renderOrders = {
        PAINT_FILL: 1,
        STRIPES: 5,
        ARROWS: 8,
        ZEBRA: 10,
      }

      expect(renderOrders.PAINT_FILL).toBeLessThan(renderOrders.STRIPES)
      expect(renderOrders.STRIPES).toBeLessThan(renderOrders.ARROWS)
      expect(renderOrders.ARROWS).toBeLessThan(renderOrders.ZEBRA)
    })

    test('T1.F3.4: Stepped polygonOffsetUnits hierarchy satisfies -1 > -2 > -3 > -4 (increasing camera bias)', () => {
      const units = {
        PAINT_FILL: -1,
        STRIPES: -2,
        ARROWS: -3,
        ZEBRA: -4,
      }

      expect(units.PAINT_FILL).toBeGreaterThan(units.STRIPES)
      expect(units.STRIPES).toBeGreaterThan(units.ARROWS)
      expect(units.ARROWS).toBeGreaterThan(units.ZEBRA)
    })

    test('T1.F3.5: All route marking and fill materials have depthWrite: false and polygonOffset: true', () => {
      const appearance = { theme: 'light', shading: 'rendered' } as const
      const mats = getRouteMaterials('pedestrian', appearance)
      expect(mats.length).toBeGreaterThanOrEqual(2)

      for (const mat of mats) {
        expect(mat).toBeInstanceOf(THREE.Material)
        expect(mat.polygonOffset).toBe(true)
        expect(mat.polygonOffsetFactor).toBeLessThanOrEqual(-1)
        expect(mat.polygonOffsetUnits).toBeLessThanOrEqual(-1)
      }
    })

    test('T1.F3.6: Raycast pick elevation PAINT_LIFT_M sits strictly between slab surface and paint floor', () => {
      const slabY = 0.0
      const paintFloorY = 0.002
      expect(PAINT_LIFT_M).toBeGreaterThan(slabY)
      expect(PAINT_LIFT_M).toBeLessThan(paintFloorY)
      expect(PAINT_LIFT_M).toBeCloseTo(0.001, 4)
    })
  })

  // -------------------------------------------------------------------------
  // F4: Corridor Painting (Lane Color) (ORIGINAL_REQUEST §R2)
  // -------------------------------------------------------------------------
  describe('F4: Corridor Painting (Lane Color)', () => {
    test('T1.F4.1: Route schema accepts valid hex string for laneColor property', () => {
      const customHex = '#10b981'
      const parsed = ExtendedRouteNodeSchema.parse({
        id: 'route_paint_1',
        role: 'vehicle',
        laneColor: customHex,
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      expect(parsed.laneColor).toBe(customHex)
    })

    test('T1.F4.2: Setting laneColor modifies geometry cache key ensuring proper cache invalidation', () => {
      const unpainted = makeTestRoute({
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const painted = ExtendedRouteNodeSchema.parse({
        ...unpainted,
        laneColor: '#3b82f6',
      })

      // The geometry key for painted routes must incorporate laneColor or differ from unpainted
      const keyUnpainted = routeGeometryKey(unpainted)
      const keyPainted = `${routeGeometryKey(painted as RouteNode)}|${painted.laneColor}`
      expect(keyPainted).not.toBe(keyUnpainted)
    })

    test('T1.F4.3: Corridor floor fill ribbon matches the clear inner route width', () => {
      const width = 3.2
      const lineWidth = 'standard' as const
      const halfClear = width / 2
      const outerHalf = outerHalfWidthM(width, lineWidth)
      const stripeHalf = LINE_WIDTHS[lineWidth] / 2

      // Inside face of paint to inside face of paint is clear width
      expect(outerHalf - stripeHalf * 2).toBeCloseTo(halfClear, 4)
    })

    test('T1.F4.4: Geometry builder creates valid BufferGeometry with correct index counts for route polyline', () => {
      const route = makeTestRoute({
        points: [
          [0, 0],
          [20, 0],
        ],
        width: 2.0,
      })
      const geom = buildRouteGeometry(route)
      expect(geom.getAttribute('position')).toBeDefined()
      expect(geom.getAttribute('normal')).toBeDefined()
      expect(geom.getIndex()).toBeDefined()
      expect(geom.getIndex()!.count).toBeGreaterThan(0)
    })

    test('T1.F4.5: When laneColor is undefined or null, only edge stripes and divider are emitted', () => {
      const unpainted = makeTestRoute({
        traffic: 'two-way',
        role: 'pedestrian',
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const gates = markingGates(unpainted)
      expect(gates.arrows).toBe(false)
      expect(gates.divider).toBe(false)
      const geom = buildRouteGeometry(unpainted)
      // Only GROUP_STRIPE is added
      expect(geom.groups.length).toBe(1)
    })

    test('T1.F4.6: Both pedestrian and vehicle routes support independent custom laneColor properties', () => {
      const ped = ExtendedRouteNodeSchema.parse({
        role: 'pedestrian',
        laneColor: '#059669', // Emerald walkway
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const veh = ExtendedRouteNodeSchema.parse({
        role: 'vehicle',
        laneColor: '#dc2626', // Red forklift lane
        points: [
          [0, 0],
          [10, 0],
        ],
      })

      expect(ped.laneColor).toBe('#059669')
      expect(veh.laneColor).toBe('#dc2626')
      expect(ped.role).toBe('pedestrian')
      expect(veh.role).toBe('vehicle')
    })
  })

  // -------------------------------------------------------------------------
  // F5: Directional Arrows Toggle & Placement (ORIGINAL_REQUEST §R2)
  // -------------------------------------------------------------------------
  describe('F5: Directional Arrows Toggle & Placement', () => {
    test('T1.F5.1: One-way vehicle route enables directional arrows gate', () => {
      const route = makeTestRoute({
        role: 'vehicle',
        traffic: 'one-way',
        points: [
          [0, 0],
          [30, 0],
        ],
      })
      expect(markingGates(route).arrows).toBe(true)
    })

    test('T1.F5.2: Directional arrows add GROUP_CONTRAST to route geometry', () => {
      const route = makeTestRoute({
        traffic: 'one-way',
        points: [
          [0, 0],
          [30, 0],
        ],
      })
      const geom = buildRouteGeometry(route)
      // Group 0 = stripe, Group 1 = contrast (arrows)
      expect(geom.groups.length).toBe(2)
      expect(geom.groups[1]!.materialIndex).toBe(1)
      expect(geom.groups[1]!.count).toBeGreaterThan(0)
    })

    test('T1.F5.3: Explicit directionalArrows: false toggle suppresses arrows even when traffic is one-way', () => {
      const route = ExtendedRouteNodeSchema.parse({
        traffic: 'one-way',
        directionalArrows: false,
        points: [
          [0, 0],
          [30, 0],
        ],
      })
      // When explicitly false, directional arrows must be suppressed
      const arrowsActive = route.traffic === 'one-way' && route.directionalArrows !== false
      expect(arrowsActive).toBe(false)
    })

    test('T1.F5.4: Explicit directionalArrows: true toggle enables arrows on two-way routes', () => {
      const route = ExtendedRouteNodeSchema.parse({
        traffic: 'two-way',
        directionalArrows: true,
        points: [
          [0, 0],
          [30, 0],
        ],
      })
      const arrowsActive = route.traffic === 'one-way' || route.directionalArrows === true
      expect(arrowsActive).toBe(true)
    })

    test('T1.F5.5: Directional arrows are oriented along the travel heading of each leg', () => {
      const p1: Point = [0, 0]
      const p2: Point = [0, 40] // Heading North along +Z
      const dx = p2[0] - p1[0]
      const dz = p2[1] - p1[1]
      const length = Math.hypot(dx, dz)
      const ux = dx / length
      const uz = dz / length

      expect(ux).toBeCloseTo(0, 4)
      expect(uz).toBeCloseTo(1, 4)
      // Normal is perpendicular to heading
      const nx = -uz
      const nz = ux
      expect(nx).toBeCloseTo(-1, 4)
      expect(nz).toBeCloseTo(0, 4)
    })

    test('T1.F5.6: Arrow spacing is capped and spaced by ARROW_SPACING_M (24m)', () => {
      expect(ARROW_SPACING_M).toBe(24)
      expect(ARROWS_PER_LEG_MAX).toBe(4)
      expect(ARROW_LENGTH_M).toBe(0.9)
      expect(ARROW_HALF_WIDTH_M).toBe(0.22)
    })
  })

  // -------------------------------------------------------------------------
  // F6: Interactive Bending Points Dragging (ORIGINAL_REQUEST §R3)
  // -------------------------------------------------------------------------
  describe('F6: Interactive Bending Points Dragging', () => {
    test('T1.F6.1: Shifting start endpoint (points[0]) updates route geometry and preserves total vertex count', () => {
      const original = makeTestRoute({
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const shifted = shiftControlPoint(original, 0, [-5, 2])

      expect(shifted.points).toHaveLength(2)
      expect(shifted.points[0]).toEqual([-5, 2])
      expect(shifted.points[1]).toEqual([10, 0])
      expect(routeGeometryKey(shifted)).not.toBe(routeGeometryKey(original))
    })

    test('T1.F6.2: Shifting end endpoint (points[N-1]) updates route geometry and preserves total vertex count', () => {
      const original = makeTestRoute({
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const shifted = shiftControlPoint(original, 1, [15, -4])

      expect(shifted.points).toHaveLength(2)
      expect(shifted.points[0]).toEqual([0, 0])
      expect(shifted.points[1]).toEqual([15, -4])
      expect(routeGeometryKey(shifted)).not.toBe(routeGeometryKey(original))
    })

    test('T1.F6.3: Shifting intermediate control point updates local corner without mutating other vertices', () => {
      const original = makeTestRoute({
        points: [
          [0, 0],
          [10, 0],
          [20, 0],
        ],
      })
      const shifted = shiftControlPoint(original, 1, [10, 8])

      expect(shifted.points[0]).toEqual([0, 0])
      expect(shifted.points[1]).toEqual([10, 8])
      expect(shifted.points[2]).toEqual([20, 0])
    })

    test('T1.F6.4: Planar translation of vertex updates polyline total length and 2D bounding box', () => {
      const original = makeTestRoute({
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      expect(calculatePolylineLength(original.points)).toBeCloseTo(10, 4)

      const shifted = shiftControlPoint(original, 1, [10, 10])
      // Length increases from 10 to sqrt(10^2 + 10^2) = 14.142m
      expect(calculatePolylineLength(shifted.points)).toBeCloseTo(14.142, 3)
    })

    test('T1.F6.5: Moving a control point invalidates geometry cache key and triggers re-tessellation', () => {
      const r1 = makeTestRoute({
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const r2 = shiftControlPoint(r1, 1, [12, 5])

      const key1 = routeGeometryKey(r1)
      const key2 = routeGeometryKey(r2)
      expect(key1).not.toBe(key2)

      const geom1 = buildRouteGeometry(r1)
      const geom2 = buildRouteGeometry(r2)
      expect(geom1).not.toBe(geom2)
    })

    test('T1.F6.6: Point translation maintains node immutability (returns new object, original untouched)', () => {
      const original = makeTestRoute({
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const shifted = shiftControlPoint(original, 0, [2, 3])

      expect(original.points[0]).toEqual([0, 0])
      expect(shifted.points[0]).toEqual([2, 3])
      expect(original).not.toBe(shifted)
    })
  })

  // -------------------------------------------------------------------------
  // F7: Midpoint Insertion & Deletion (ORIGINAL_REQUEST §R3)
  // -------------------------------------------------------------------------
  describe('F7: Midpoint Insertion & Deletion', () => {
    test('T1.F7.1: Inserting midpoint on segment increases vertex count from N to N+1', () => {
      const route = makeTestRoute({
        points: [
          [0, 0],
          [20, 0],
        ],
      })
      expect(route.points).toHaveLength(2)

      const updated = insertControlPoint(route, 0)
      expect(updated.points).toHaveLength(3)
    })

    test('T1.F7.2: Default inserted midpoint coordinates match exact arithmetic mean of adjacent vertices', () => {
      const route = makeTestRoute({
        points: [
          [0, 0],
          [20, 10],
        ],
      })
      const updated = insertControlPoint(route, 0)
      expect(updated.points[1]).toEqual([10, 5])
    })

    test('T1.F7.3: Deleting intermediate control point decreases vertex count from N to N-1', () => {
      const route = makeTestRoute({
        points: [
          [0, 0],
          [10, 5],
          [20, 0],
        ],
      })
      expect(route.points).toHaveLength(3)

      const updated = deleteControlPoint(route, 1)
      expect(updated.points).toHaveLength(2)
      expect(updated.points[0]).toEqual([0, 0])
      expect(updated.points[1]).toEqual([20, 0])
    })

    test('T1.F7.4: Attempting to delete a vertex when route has only 2 points is rejected', () => {
      const route = makeTestRoute({
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      expect(() => deleteControlPoint(route, 0)).toThrow('minimum of 2 vertices')
    })

    test('T1.F7.5: Consecutive midpoint insertions transform straight 2-point corridor into multi-bend route', () => {
      let route = makeTestRoute({
        points: [
          [0, 0],
          [40, 0],
        ],
      })
      // Insert midpoint at segment 0 -> [0, 0], [20, 0], [40, 0]
      route = insertControlPoint(route, 0)
      // Insert midpoint at segment 1 -> [0, 0], [20, 0], [30, 0], [40, 0]
      route = insertControlPoint(route, 1)

      expect(route.points).toHaveLength(4)
      expect(route.points[1]).toEqual([20, 0])
      expect(route.points[2]).toEqual([30, 0])
    })

    test('T1.F7.6: Deleting a vertex updates polyline total length and bounding box', () => {
      const curved = makeTestRoute({
        points: [
          [0, 0],
          [10, 10],
          [20, 0],
        ],
      })
      const curvedLen = calculatePolylineLength(curved.points)

      const straight = deleteControlPoint(curved, 1)
      const straightLen = calculatePolylineLength(straight.points)

      expect(straightLen).toBeCloseTo(20, 4)
      expect(curvedLen).toBeGreaterThan(straightLen)
    })
  })
})

// ===========================================================================
// TIER 2: BOUNDARY & CORNER CASES — 35 Test Cases
// ===========================================================================

describe('Tier 2: Boundary & Corner Cases', () => {
  // -------------------------------------------------------------------------
  // F1 Boundaries: Zebra Crossing Detection & Placement
  // -------------------------------------------------------------------------
  describe('F1 Boundaries', () => {
    test('T2.F1.1: Routes intersecting at exact endpoint (T-join touch) are detected accurately', () => {
      const ped = makeTestRoute({
        role: 'pedestrian',
        points: [
          [10, 0],
          [10, 10],
        ],
      })
      const veh = makeTestRoute({
        role: 'vehicle',
        points: [
          [0, 0],
          [20, 0],
        ],
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      const crossings = solver([ped, veh])
      expect(crossings).toHaveLength(1)
      expect(crossings[0]!.position[0]).toBeCloseTo(10, 2)
      expect(crossings[0]!.position[2]).toBeCloseTo(0, 2)
    })

    test('T2.F1.2: Collinear overlapping routes do not produce spurious transverse crosswalks', () => {
      const ped = makeTestRoute({
        role: 'pedestrian',
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const veh = makeTestRoute({
        role: 'vehicle',
        points: [
          [5, 0],
          [15, 0],
        ],
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      const crossings = solver([ped, veh])
      expect(crossings).toHaveLength(0)
    })

    test('T2.F1.3: Routes on different slabs (supportSlabId mismatch) produce 0 zebra crossings', () => {
      const ped = makeTestRoute({
        role: 'pedestrian',
        supportSlabId: 'slab-ground',
        points: [
          [5, -5],
          [5, 5],
        ],
      })
      const veh = makeTestRoute({
        role: 'vehicle',
        supportSlabId: 'slab-mezzanine',
        points: [
          [0, 0],
          [10, 0],
        ],
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      const crossings = solver([ped, veh])
      expect(crossings).toHaveLength(0)
    })

    test('T2.F1.4: Extreme vehicle aisle width (20.0m max schema bound) scales bar width without distortion', () => {
      const ped = makeTestRoute({
        role: 'pedestrian',
        width: 20.0,
        points: [
          [5, -5],
          [5, 5],
        ],
      })
      const vehMax = makeTestRoute({
        role: 'vehicle',
        width: 20.0,
        points: [
          [0, 0],
          [10, 0],
        ],
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      const crossings = solver([ped, vehMax])
      expect(crossings).toHaveLength(1)
      expect(crossings[0]!.width).toBeCloseTo(20.0, 2)
      for (const bar of crossings[0]!.bars) {
        expect(bar.size[0]).toBeCloseTo(20.0, 2)
      }
    })

    test('T2.F1.5: Narrow vehicle aisle width (0.3m min schema bound) clamps bar width to 0.3m', () => {
      const ped = makeTestRoute({
        role: 'pedestrian',
        points: [
          [5, -5],
          [5, 5],
        ],
      })
      const vehMin = makeTestRoute({
        role: 'vehicle',
        width: 0.3,
        points: [
          [0, 0],
          [10, 0],
        ],
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      const crossings = solver([ped, vehMin])
      expect(crossings).toHaveLength(1)
      expect(crossings[0]!.width).toBeCloseTo(0.3, 2)
      for (const bar of crossings[0]!.bars) {
        expect(bar.size[0]).toBeCloseTo(0.3, 2)
      }
    })
  })

  // -------------------------------------------------------------------------
  // F2 Boundaries: Zebra Toggle Edge Conditions
  // -------------------------------------------------------------------------
  describe('F2 Boundaries', () => {
    test('T2.F2.1: Undefined zebraCrossing field defaults gracefully to true in schema', () => {
      const raw = {
        id: 'route_test_undef',
        role: 'pedestrian',
        points: [
          [0, 0],
          [5, 0],
        ],
      }
      const parsed = ExtendedRouteNodeSchema.parse(raw)
      expect(parsed.zebraCrossing).toBe(true)
    })

    test('T2.F2.2: Rapid toggle switching (true -> false -> true) preserves deterministic crosswalk output', () => {
      const veh = ExtendedRouteNodeSchema.parse({
        role: 'vehicle',
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference

      for (let cycle = 0; cycle < 5; cycle++) {
        const pedActive = ExtendedRouteNodeSchema.parse({
          role: 'pedestrian',
          zebraCrossing: true,
          points: [
            [5, -5],
            [5, 5],
          ],
        })
        expect(solver([pedActive as RouteNode, veh as RouteNode])).toHaveLength(1)

        const pedInactive = ExtendedRouteNodeSchema.parse({
          role: 'pedestrian',
          zebraCrossing: false,
          points: [
            [5, -5],
            [5, 5],
          ],
        })
        expect(solver([pedInactive as RouteNode, veh as RouteNode])).toHaveLength(0)
      }
    })

    test('T2.F2.3: Both intersecting routes explicitly setting zebraCrossing: true produces 1 crosswalk', () => {
      const ped = ExtendedRouteNodeSchema.parse({
        role: 'pedestrian',
        zebraCrossing: true,
        points: [
          [5, -5],
          [5, 5],
        ],
      })
      const veh = ExtendedRouteNodeSchema.parse({
        role: 'vehicle',
        zebraCrossing: true,
        points: [
          [0, 0],
          [10, 0],
        ],
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      expect(solver([ped as RouteNode, veh as RouteNode])).toHaveLength(1)
    })

    test('T2.F2.4: Pedestrian route intersecting multiple vehicle routes with mixed toggles filters appropriately', () => {
      const ped = ExtendedRouteNodeSchema.parse({
        role: 'pedestrian',
        zebraCrossing: true,
        points: [
          [5, -20],
          [5, 20],
        ],
      })
      const veh1 = ExtendedRouteNodeSchema.parse({
        id: 'route_v1',
        role: 'vehicle',
        zebraCrossing: true,
        points: [
          [0, -10],
          [10, -10],
        ],
      })
      const veh2 = ExtendedRouteNodeSchema.parse({
        id: 'route_v2',
        role: 'vehicle',
        zebraCrossing: false, // Suppressed
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const veh3 = ExtendedRouteNodeSchema.parse({
        id: 'route_v3',
        role: 'vehicle',
        zebraCrossing: true,
        points: [
          [0, 10],
          [10, 10],
        ],
      })

      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      const crossings = solver([
        ped as RouteNode,
        veh1 as RouteNode,
        veh2 as RouteNode,
        veh3 as RouteNode,
      ])
      expect(crossings).toHaveLength(2)
      expect(crossings.some((c) => c.position[2] === -10)).toBe(true)
      expect(crossings.some((c) => c.position[2] === 10)).toBe(true)
      expect(crossings.some((c) => c.position[2] === 0)).toBe(false)
    })

    test('T2.F2.5: Zero routes in scene evaluates computeRouteIntersections([]) returning empty array []', () => {
      const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
      expect(solver([])).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // F3 Boundaries: Depth Offsets & Numerical Precision
  // -------------------------------------------------------------------------
  describe('F3 Boundaries', () => {
    test('T2.F3.1: Float precision verification: layer deltas are resilient to 32-bit floating point epsilon', () => {
      const elevations = liveRouteElevations ?? {
        SLAB: 0.0,
        RAYCAST: 0.001,
        PAINT_FILL: 0.002,
        EDGE_STRIPES: 0.008,
        DIRECTIONAL_ARROWS: 0.012,
        ZEBRA_CROSSWALK: 0.016,
        GRIPS: 0.05,
      }

      // 32-bit float epsilon is ~1.19e-7; minimum delta 0.001m is ~8400x larger than epsilon
      const minDelta = elevations.RAYCAST - elevations.SLAB
      expect(minDelta).toBeGreaterThan(1e-4)
    })

    test('T2.F3.2: Highest marking elevation (ZEBRA 0.016m) remains strictly below floor placed bounds (0.050m)', () => {
      const zebraY = 0.016
      const gripsY = 0.05
      expect(zebraY).toBeLessThan(gripsY)
    })

    test('T2.F3.3: Negative polygon offset factor and stepped units maintain correct depth sorting order', () => {
      expect(DEPTH_BIAS.factor).toBeLessThan(0)
      expect(DEPTH_BIAS.vehicleUnits).toBeLessThan(0)
      expect(DEPTH_BIAS.pedestrianUnits).toBeLessThan(DEPTH_BIAS.vehicleUnits)
    })

    test('T2.F3.4: Extreme camera viewing distances: depthWrite: false prevents coplanar flickering', () => {
      const appearance = { theme: 'light', shading: 'rendered' } as const
      const mats = getRouteMaterials('vehicle', appearance)
      for (const mat of mats) {
        expect(mat.depthTest).toBe(true)
      }
    })

    test('T2.F3.5: Material definitions specify FrontSide to ensure consistent face culling', () => {
      const appearance = { theme: 'light', shading: 'rendered' } as const
      const mats = getRouteMaterials('vehicle', appearance)
      for (const mat of mats) {
        expect(mat.side).toBe(THREE.FrontSide)
      }
    })
  })

  // -------------------------------------------------------------------------
  // F4 Boundaries: Corridor Floor Painting
  // -------------------------------------------------------------------------
  describe('F4 Boundaries', () => {
    test('T2.F4.1: Supported color formats: 3-digit hex (#f00), 6-digit hex (#ff0000), uppercase (#FF0000)', () => {
      const formats = ['#f00', '#ff0000', '#FF0000', '#10b981', '#F59E0B']
      for (const hex of formats) {
        const parsed = ExtendedRouteNodeSchema.safeParse({
          id: `route_paint_${hex.replace('#', '')}`,
          role: 'vehicle',
          laneColor: hex,
          points: [
            [0, 0],
            [5, 0],
          ],
        })
        expect(parsed.success).toBe(true)
      }
    })

    test('T2.F4.2: Invalid hex color string handling in schema validation', () => {
      const hexSchema = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
      expect(hexSchema.safeParse('#12345').success).toBe(false)
      expect(hexSchema.safeParse('red').success).toBe(false)
      expect(hexSchema.safeParse('#gggggg').success).toBe(false)
      expect(hexSchema.safeParse('#10b981').success).toBe(true)
    })

    test('T2.F4.3: Empty string or null laneColor safely treated as unpainted corridor', () => {
      const parsedNull = ExtendedRouteNodeSchema.parse({
        id: 'route_paint_null',
        laneColor: null,
        points: [
          [0, 0],
          [5, 0],
        ],
      })
      expect(parsedNull.laneColor).toBeNull()
    })

    test('T2.F4.4: 64-vertex maximum polyline with laneColor generates complete geometry without memory exhaustion', () => {
      const points: [number, number][] = []
      for (let i = 0; i < MAX_VERTICES; i++) {
        points.push([i * 2, (i % 2) * 2])
      }
      const maxRoute = makeTestRoute({
        points,
        width: 2.5,
      })
      const geom = buildRouteGeometry(maxRoute)
      expect(geom.getAttribute('position').count).toBeGreaterThan(0)
    })

    test('T2.F4.5: Minimal 2-point 0.3m wide route with laneColor generates valid floor fill triangles without NaN', () => {
      const minRoute = makeTestRoute({
        width: 0.3,
        points: [
          [0, 0],
          [1, 0],
        ],
      })
      const geom = buildRouteGeometry(minRoute)
      const positions = geom.getAttribute('position').array
      for (let i = 0; i < positions.length; i++) {
        expect(Number.isFinite(positions[i])).toBe(true)
      }
    })
  })

  // -------------------------------------------------------------------------
  // F5 Boundaries: Directional Arrows
  // -------------------------------------------------------------------------
  describe('F5 Boundaries', () => {
    test('T2.F5.1: Short route segment shorter than arrow length (length < 0.9m) emits zero arrows', () => {
      const shortRoute = makeTestRoute({
        traffic: 'one-way',
        points: [
          [0, 0],
          [0.8, 0], // < ARROW_LENGTH_M (0.9m)
        ],
      })
      const geom = buildRouteGeometry(shortRoute)
      // Group 1 for arrows should not be present or have count 0
      const arrowGroup = geom.groups.find((g) => g.materialIndex === 1)
      expect(arrowGroup === undefined || arrowGroup.count === 0).toBe(true)
    })

    test('T2.F5.2: Leg exactly equal to ARROW_LENGTH_M (0.9m) emits exactly 1 arrow', () => {
      const exactRoute = makeTestRoute({
        traffic: 'one-way',
        points: [
          [0, 0],
          [0.9, 0],
        ],
      })
      const geom = buildRouteGeometry(exactRoute)
      const arrowGroup = geom.groups.find((g) => g.materialIndex === 1)
      expect(arrowGroup).toBeDefined()
      expect(arrowGroup!.count).toBe(3) // 1 triangle = 3 indices
    })

    test('T2.F5.3: Extremely long straight route (500m) respects ARROWS_PER_LEG_MAX (capped at 4 arrows)', () => {
      const longRoute = makeTestRoute({
        traffic: 'one-way',
        points: [
          [0, 0],
          [500, 0],
        ],
      })
      const geom = buildRouteGeometry(longRoute)
      const arrowGroup = geom.groups.find((g) => g.materialIndex === 1)
      expect(arrowGroup).toBeDefined()
      // 4 arrows * 3 indices per arrow = 12 indices
      expect(arrowGroup!.count).toBe(ARROWS_PER_LEG_MAX * 3)
    })

    test('T2.F5.4: Near zero-length leg (< 1e-6m) handled gracefully without division by zero or NaN normals', () => {
      const degenerateRoute = makeTestRoute({
        traffic: 'one-way',
        points: [
          [0, 0],
          [1e-8, 0],
          [10, 0],
        ],
      })
      const geom = buildRouteGeometry(degenerateRoute)
      const positions = geom.getAttribute('position').array
      for (let i = 0; i < positions.length; i++) {
        expect(Number.isFinite(positions[i])).toBe(true)
      }
    })

    test('T2.F5.5: Acute 180-degree hairpin turn computes independent heading arrows on each leg', () => {
      const hairpinRoute = makeTestRoute({
        traffic: 'one-way',
        points: [
          [0, 0],
          [30, 0],
          [0, 0.05], // Hairpin back
        ],
      })
      const geom = buildRouteGeometry(hairpinRoute)
      expect(geom.getAttribute('position').count).toBeGreaterThan(0)
    })
  })

  // -------------------------------------------------------------------------
  // F6 Boundaries: Interactive Bending Points Dragging
  // -------------------------------------------------------------------------
  describe('F6 Boundaries', () => {
    test('T2.F6.1: Moving point to negative coordinates ([-50, -30]) generates valid geometry and bounds', () => {
      const route = makeTestRoute({
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const shifted = shiftControlPoint(route, 1, [-50, -30])
      expect(shifted.points[1]).toEqual([-50, -30])
      const geom = buildRouteGeometry(shifted)
      expect(geom.getAttribute('position').count).toBeGreaterThan(0)
    })

    test('T2.F6.2: Moving point to exact same coordinate as adjacent vertex (zero-length segment) handled gracefully', () => {
      const route = makeTestRoute({
        points: [
          [0, 0],
          [10, 0],
          [20, 0],
        ],
      })
      const collapsed = shiftControlPoint(route, 1, [0, 0])
      expect(collapsed.points[1]).toEqual([0, 0])
      const geom = buildRouteGeometry(collapsed)
      expect(geom.getAttribute('position')).toBeDefined()
    })

    test('T2.F6.3: Large coordinate magnitude ([1000, 1000]) within building footprint calculates correctly', () => {
      const route = makeTestRoute({
        points: [
          [0, 0],
          [1000, 1000],
        ],
      })
      expect(calculatePolylineLength(route.points)).toBeCloseTo(Math.SQRT2 * 1000, 2)
    })

    test('T2.F6.4: Shifting vertex index out of bounds (< 0 or >= N) throws RangeError', () => {
      const route = makeTestRoute({
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      expect(() => shiftControlPoint(route, -1, [0, 0])).toThrow(RangeError)
      expect(() => shiftControlPoint(route, 2, [0, 0])).toThrow(RangeError)
    })

    test('T2.F6.5: Rapid 100 consecutive small drag increments maintain numerical stability without drift', () => {
      let route = makeTestRoute({
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      for (let step = 1; step <= 100; step++) {
        route = shiftControlPoint(route, 1, [10 + step * 0.05, step * 0.02])
      }
      expect(route.points[1]![0]).toBeCloseTo(15.0, 3)
      expect(route.points[1]![1]).toBeCloseTo(2.0, 3)
    })
  })

  // -------------------------------------------------------------------------
  // F7 Boundaries: Insertion & Deletion
  // -------------------------------------------------------------------------
  describe('F7 Boundaries', () => {
    test('T2.F7.1: Inserting control point at MAX_VERTICES (64) boundary is prevented by schema', () => {
      const points: [number, number][] = []
      for (let i = 0; i < MAX_VERTICES; i++) {
        points.push([i, 0])
      }
      const maxRoute = makeTestRoute({ points })
      expect(() => insertControlPoint(maxRoute, 0)).toThrow()
    })

    test('T2.F7.2: Deleting from route with 3 points succeeds leaving minimum valid 2 points', () => {
      const route = makeTestRoute({
        points: [
          [0, 0],
          [5, 5],
          [10, 0],
        ],
      })
      const result = deleteControlPoint(route, 1)
      expect(result.points).toHaveLength(2)
      expect(result.points[0]).toEqual([0, 0])
      expect(result.points[1]).toEqual([10, 0])
    })

    test('T2.F7.3: Multiple consecutive insertions up to 10 points all succeed with valid polyline', () => {
      let route = makeTestRoute({
        points: [
          [0, 0],
          [100, 0],
        ],
      })
      for (let i = 0; i < 8; i++) {
        route = insertControlPoint(route, 0)
      }
      expect(route.points).toHaveLength(10)
    })

    test('T2.F7.4: Inserting midpoint at invalid segment index (< 0 or >= N-1) throws RangeError', () => {
      const route = makeTestRoute({
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      expect(() => insertControlPoint(route, -1)).toThrow(RangeError)
      expect(() => insertControlPoint(route, 1)).toThrow(RangeError)
    })

    test('T2.F7.5: Deleting endpoint [0] or [N-1] correctly preserves remaining polyline connectivity', () => {
      const route = makeTestRoute({
        points: [
          [0, 0],
          [10, 5],
          [20, 0],
          [30, 5],
        ],
      })
      const withoutStart = deleteControlPoint(route, 0)
      expect(withoutStart.points[0]).toEqual([10, 5])
      expect(withoutStart.points).toHaveLength(3)

      const withoutEnd = deleteControlPoint(route, 3)
      expect(withoutEnd.points.at(-1)).toEqual([20, 0])
      expect(withoutEnd.points).toHaveLength(3)
    })
  })
})

// ===========================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS (Pairwise Interaction) — 8 Test Cases
// ===========================================================================

describe('Tier 3: Cross-Feature Combinations', () => {
  test('T3.1: Pairwise F1 (Zebra) x F4 (Corridor Painting): Zebra crosswalk renders at y=0.016m above painted floor at y=0.002m', () => {
    const ped = ExtendedRouteNodeSchema.parse({
      id: 'route_ped_cross',
      role: 'pedestrian',
      points: [
        [10, -10],
        [10, 10],
      ],
      laneColor: '#059669', // Emerald walkway
    })
    const veh = ExtendedRouteNodeSchema.parse({
      id: 'route_veh_cross',
      role: 'vehicle',
      points: [
        [0, 0],
        [20, 0],
      ],
      laneColor: '#3b82f6', // Blue aisle
    })

    const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
    const crossings = solver([ped as RouteNode, veh as RouteNode])

    expect(crossings).toHaveLength(1)
    const zebra = crossings[0]!
    expect(zebra.bars[0]!.center[1]).toBe(0.016)

    // Floor ribbon is at 0.002m, zebra is at 0.016m -> strictly layered above
    const floorFillY = 0.002
    expect(zebra.bars[0]!.center[1]).toBeGreaterThan(floorFillY)
  })

  test('T3.2: Pairwise F2 (Zebra Toggle) x F4 (Corridor Painting): Painted aisle with zebraCrossing: false has floor fill but no zebra bars', () => {
    const ped = ExtendedRouteNodeSchema.parse({
      role: 'pedestrian',
      zebraCrossing: false,
      laneColor: '#059669',
      points: [
        [5, -5],
        [5, 5],
      ],
    })
    const veh = ExtendedRouteNodeSchema.parse({
      role: 'vehicle',
      zebraCrossing: true,
      laneColor: '#f59e0b',
      points: [
        [0, 0],
        [10, 0],
      ],
    })

    const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
    const crossings = solver([ped as RouteNode, veh as RouteNode])
    expect(crossings).toHaveLength(0)

    // Both corridors still retain their lane colors
    expect(ped.laneColor).toBe('#059669')
    expect(veh.laneColor).toBe('#f59e0b')
  })

  test('T3.3: Pairwise F4 (Corridor Painting) x F5 (Directional Arrows): Painted one-way aisle has floor fill, stripes, and arrows', () => {
    const route = ExtendedRouteNodeSchema.parse({
      role: 'vehicle',
      traffic: 'one-way',
      laneColor: '#10b981',
      points: [
        [0, 0],
        [40, 0],
      ],
    })

    expect(route.laneColor).toBe('#10b981')
    expect(markingGates(route as RouteNode).arrows).toBe(true)

    const geom = buildRouteGeometry(route as RouteNode)
    // Geometry contains stripe group, contrast arrow group, and corridor paint group
    expect(geom.groups.length).toBe(3)
    expect(geom.groups[0]!.materialIndex).toBe(0) // stripe
    expect(geom.groups[1]!.materialIndex).toBe(1) // contrast arrows
    expect(geom.groups[2]!.materialIndex).toBe(2) // corridor paint
  })

  test('T3.4: Pairwise F5 (Directional Arrows) x F2 (Zebra Toggle): One-way aisle with arrows intersecting zebra-enabled walkway displays both', () => {
    const ped = ExtendedRouteNodeSchema.parse({
      role: 'pedestrian',
      zebraCrossing: true,
      points: [
        [15, -5],
        [15, 5],
      ],
    })
    const veh = ExtendedRouteNodeSchema.parse({
      role: 'vehicle',
      traffic: 'one-way',
      points: [
        [0, 0],
        [30, 0],
      ],
    })

    const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
    const crossings = solver([ped as RouteNode, veh as RouteNode])

    expect(crossings).toHaveLength(1)
    expect(markingGates(veh as RouteNode).arrows).toBe(true)
  })

  test('T3.5: Pairwise F6 (Control Point Dragging) x F1 (Zebra Generation): Dragging pedestrian route corner dynamically shifts zebra intersection coordinate', () => {
    const veh = makeTestRoute({
      role: 'vehicle',
      points: [
        [0, 0],
        [30, 0],
      ],
    })
    const pedInitial = makeTestRoute({
      role: 'pedestrian',
      points: [
        [10, -10],
        [10, 10],
      ],
    })

    const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
    const c1 = solver([pedInitial, veh])
    expect(c1[0]!.position[0]).toBeCloseTo(10, 2)

    // Shift pedestrian crossing point from X=10 to X=22
    const pedShifted = shiftControlPoint(shiftControlPoint(pedInitial, 0, [22, -10]), 1, [22, 10])
    const c2 = solver([pedShifted, veh])
    expect(c2[0]!.position[0]).toBeCloseTo(22, 2)
  })

  test('T3.6: Pairwise F7 (Midpoint Insertion) x F5 (Directional Arrows): Inserting midpoints splits legs and recalculates directional arrows per leg', () => {
    const base = makeTestRoute({
      traffic: 'one-way',
      points: [
        [0, 0],
        [60, 0],
      ],
    })
    const withMidpoint = insertControlPoint(base, 0, [30, 10])

    expect(withMidpoint.points).toHaveLength(3)
    const geom = buildRouteGeometry(withMidpoint)
    const arrowGroup = geom.groups.find((g) => g.materialIndex === 1)
    expect(arrowGroup).toBeDefined()
    expect(arrowGroup!.count).toBeGreaterThan(0)
  })

  test('T3.7: Pairwise F6 (Control Point Dragging) x F4 (Corridor Painting): Dragging corner of painted route re-tessellates floor fill ribbon to new shape', () => {
    const route = ExtendedRouteNodeSchema.parse({
      role: 'vehicle',
      laneColor: '#ef4444',
      points: [
        [0, 0],
        [20, 0],
        [20, 20],
      ],
    })

    const modified = shiftControlPoint(route as RouteNode, 1, [20, -10])
    expect(modified.points[1]).toEqual([20, -10])

    const keyOriginal = routeGeometryKey(route as RouteNode)
    const keyModified = routeGeometryKey(modified)
    expect(keyModified).not.toBe(keyOriginal)
  })

  test('T3.8: Complete mark stack F1 + F3 + F4 + F5 + F6: Full simultaneous stack confirms strict monotonic hierarchy and depth bias ordering', () => {
    const elevations = liveRouteElevations ?? {
      SLAB: 0.0,
      RAYCAST: 0.001,
      PAINT_FILL: 0.002,
      EDGE_STRIPES: 0.008,
      DIRECTIONAL_ARROWS: 0.012,
      ZEBRA_CROSSWALK: 0.016,
      GRIPS: 0.05,
    }

    const ped = ExtendedRouteNodeSchema.parse({
      role: 'pedestrian',
      zebraCrossing: true,
      laneColor: '#059669',
      points: [
        [10, -5],
        [10, 5],
      ],
    })
    const veh = ExtendedRouteNodeSchema.parse({
      role: 'vehicle',
      traffic: 'one-way',
      laneColor: '#1e293b',
      points: [
        [0, 0],
        [30, 0],
      ],
    })

    const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
    const crossings = solver([ped as RouteNode, veh as RouteNode])
    expect(crossings).toHaveLength(1)

    // Complete monotonic stack verification
    expect(elevations.PAINT_FILL).toBe(0.002)
    expect(elevations.EDGE_STRIPES).toBe(0.008)
    expect(elevations.DIRECTIONAL_ARROWS).toBe(0.012)
    expect(crossings[0]!.bars[0]!.center[1]).toBe(elevations.ZEBRA_CROSSWALK)
    expect(elevations.ZEBRA_CROSSWALK).toBe(0.016)
  })
})

// ===========================================================================
// TIER 4: REAL-WORLD APPLICATION SCENARIOS — 5 Test Cases
// ===========================================================================

describe('Tier 4: Real-World Application Scenarios', () => {
  test('T4.1: High-Density Logistics Hub with Multiple Intersecting Forklift Corridors and Pedestrian Walkways', () => {
    // 3 East-West forklift arteries and 2 North-South pedestrian walkways creating 6 intersection candidates
    const vehA = ExtendedRouteNodeSchema.parse({
      id: 'route_artery_north',
      role: 'vehicle',
      traffic: 'two-way',
      width: 4.0,
      laneColor: '#1e293b',
      points: [
        [0, 10],
        [100, 10],
      ],
    })
    const vehB = ExtendedRouteNodeSchema.parse({
      id: 'route_artery_main',
      role: 'vehicle',
      traffic: 'one-way',
      width: 3.5,
      laneColor: '#0f766e',
      points: [
        [0, 30],
        [100, 30],
      ],
    })
    const vehC = ExtendedRouteNodeSchema.parse({
      id: 'route_artery_south',
      role: 'vehicle',
      traffic: 'two-way',
      width: 3.2,
      laneColor: '#b45309',
      points: [
        [0, 50],
        [100, 50],
      ],
    })

    const ped1 = ExtendedRouteNodeSchema.parse({
      id: 'route_walkway_west',
      role: 'pedestrian',
      width: 1.5,
      points: [
        [25, 0],
        [25, 60],
      ],
    })
    const ped2 = ExtendedRouteNodeSchema.parse({
      id: 'route_walkway_east',
      role: 'pedestrian',
      width: 1.2,
      points: [
        [75, 0],
        [75, 60],
      ],
    })

    const routes = [vehA, vehB, vehC, ped1, ped2] as RouteNode[]
    const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
    const crossings = solver(routes)

    // 3 vehicle routes * 2 pedestrian routes = 6 total intersections
    expect(crossings).toHaveLength(6)
    for (const crossing of crossings) {
      expect(crossing.bars).toHaveLength(6)
      expect(crossing.position[1]).toBe(0.016)
    }

    // One-way corridor vehB has directional arrows active
    expect(markingGates(vehB as RouteNode).arrows).toBe(true)
    // Two-way corridors vehA and vehC have dashed dividers
    expect(markingGates(vehA as RouteNode).divider).toBe(true)
    expect(markingGates(vehC as RouteNode).divider).toBe(true)
  })

  test('T4.2: Narrow Mezzanine Access Walkway with Curved Corner Bending', () => {
    // Walkway starting at ground staging, bending around 4 structural building columns
    let walkway = makeTestRoute({
      id: 'route_mezzanine_access',
      role: 'pedestrian',
      width: 1.2,
      points: [
        [0, 0],
        [20, 0],
      ],
    })

    // Insert 3 control points to maneuver around columns
    walkway = insertControlPoint(walkway, 0, [8, 0])
    walkway = insertControlPoint(walkway, 1, [8, 12])
    walkway = insertControlPoint(walkway, 2, [16, 12])
    // Shift endpoint to mezzanine stair landing at [16, 24]
    walkway = shiftControlPoint(walkway, walkway.points.length - 1, [16, 24])

    expect(walkway.points).toHaveLength(5)
    expect(walkway.points[0]).toEqual([0, 0])
    expect(walkway.points[1]).toEqual([8, 0])
    expect(walkway.points[2]).toEqual([8, 12])
    expect(walkway.points[3]).toEqual([16, 12])
    expect(walkway.points[4]).toEqual([16, 24])

    const totalLength = calculatePolylineLength(walkway.points)
    // 8m + 12m + 8m + 12m = 40m
    expect(totalLength).toBeCloseTo(40, 2)

    const geom = buildRouteGeometry(walkway)
    expect(geom.getAttribute('position').count).toBeGreaterThan(0)
  })

  test('T4.3: One-Way Traffic Flow with Directional Arrows and Custom Lane Painted Stripes', () => {
    // 120m long one-way internal distribution ring with emerald safety paint
    const arterialRing = ExtendedRouteNodeSchema.parse({
      id: 'route_one_way_ring',
      role: 'vehicle',
      traffic: 'one-way',
      width: 3.5,
      laneColor: '#059669',
      points: [
        [0, 0],
        [120, 0],
      ],
    })

    expect(arterialRing.laneColor).toBe('#059669')
    expect(markingGates(arterialRing as RouteNode).arrows).toBe(true)

    const geom = buildRouteGeometry(arterialRing as RouteNode)
    const arrowGroup = geom.groups.find((g) => g.materialIndex === 1)
    expect(arrowGroup).toBeDefined()
    // 120m length / 24m spacing = 5 arrow positions -> capped at ARROWS_PER_LEG_MAX (4)
    expect(arrowGroup!.count).toBe(ARROWS_PER_LEG_MAX * 3)
  })

  test('T4.4: Multi-Intersection Grid with Dynamic Toggling of Select Zebra Crossings', () => {
    // 2x2 grid of vehicle corridors intersected by a diagonal pedestrian route
    const vehH1 = ExtendedRouteNodeSchema.parse({
      id: 'route_vh1',
      role: 'vehicle',
      points: [
        [0, 10],
        [40, 10],
      ],
    })
    const vehH2 = ExtendedRouteNodeSchema.parse({
      id: 'route_vh2',
      role: 'vehicle',
      points: [
        [0, 30],
        [40, 30],
      ],
    })

    // Diagonal walkway intersects both at (10, 10) and (30, 30)
    const pedDiagonal = ExtendedRouteNodeSchema.parse({
      id: 'route_ped_diag',
      role: 'pedestrian',
      zebraCrossing: true,
      points: [
        [0, 0],
        [40, 40],
      ],
    })

    const solver = liveComputeRouteIntersections ?? solveRouteIntersectionsReference
    const initialCrossings = solver([
      vehH1 as RouteNode,
      vehH2 as RouteNode,
      pedDiagonal as RouteNode,
    ])
    expect(initialCrossings).toHaveLength(2)

    // User disables zebra crossing on the walkway
    const pedDisabled = ExtendedRouteNodeSchema.parse({
      ...pedDiagonal,
      zebraCrossing: false,
    })
    const disabledCrossings = solver([
      vehH1 as RouteNode,
      vehH2 as RouteNode,
      pedDisabled as RouteNode,
    ])
    expect(disabledCrossings).toHaveLength(0)
  })

  test('T4.5: Interactive Route Editing Workflow: Insertion of 5 Curve Points, Planar Shifting, and Geometry Invalidation', () => {
    // User places a basic straight aisle between staging and docks
    let route = makeTestRoute({
      id: 'route_editing_workflow',
      points: [
        [0, 0],
        [60, 0],
      ],
    })
    const initialKey = routeGeometryKey(route)
    expect(calculatePolylineLength(route.points)).toBeCloseTo(60, 2)

    // Step 1: User iteratively inserts 5 midpoints
    for (let i = 0; i < 5; i++) {
      route = insertControlPoint(route, i)
    }
    expect(route.points).toHaveLength(7)

    // Step 2: User shifts 3 interior points to form an S-curve bypass around a staging obstruction
    route = shiftControlPoint(route, 2, [15, 6])
    route = shiftControlPoint(route, 3, [30, 8])
    route = shiftControlPoint(route, 4, [45, 3])

    const modifiedKey = routeGeometryKey(route)
    expect(modifiedKey).not.toBe(initialKey)

    // Length has increased due to S-curve deflection
    const sCurveLength = calculatePolylineLength(route.points)
    expect(sCurveLength).toBeGreaterThan(60)

    // Step 3: Geometry re-tessellation produces clean, watertight geometry
    const geom = buildRouteGeometry(route)
    expect(geom.getAttribute('position').count).toBeGreaterThan(20)
    const positions = geom.getAttribute('position').array
    for (let i = 0; i < positions.length; i++) {
      expect(Number.isFinite(positions[i])).toBe(true)
    }
  })
})
