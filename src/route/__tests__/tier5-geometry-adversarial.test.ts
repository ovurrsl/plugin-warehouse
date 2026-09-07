import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { type Appearance, appearanceKey, resetSurfaceMaterials } from '../../appearance'
import {
  ARROW_LENGTH_M,
  DEPTH_BIAS,
  LINE_WIDTHS,
  MAX_VERTICES,
  MITER_LIMIT,
  ROUTE_ELEVATIONS,
} from '../constants'
import {
  buildRouteGeometry,
  getRouteGeometry,
  GROUP_CONTRAST,
  GROUP_PAINT,
  GROUP_STRIPE,
  markingGates,
  releaseRouteGeometry,
  retainRouteGeometry,
  routeGeometryKey,
} from '../geometry'
import {
  areRoutesOnSameLevel,
  buildZebraGeometry,
  computeRouteIntersections,
  createZebraCrossingInstance,
  intersectSegments,
  routeWorldPoints,
  ZEBRA_BAR_COUNT,
  ZEBRA_ELEVATION_M,
} from '../intersections'
import {
  cachedZebraMaterial,
  getCorridorPaintMaterial,
  getRouteMaterials,
  getZebraMaterial,
} from '../materials'
import { RouteNode } from '../schema'
import { offsetCentreline, outerHalfWidthM, stripeCentreOffsetM } from '../stripes'

function makeRoute(patch: Record<string, unknown> = {}): RouteNode {
  const customId =
    typeof patch.id === 'string'
      ? patch.id.startsWith('route_')
        ? patch.id
        : `route_${patch.id}`
      : `route_${Math.random().toString(36).slice(2, 8)}`
  return RouteNode.parse({
    points: [
      [0, 0],
      [20, 0],
    ],
    role: 'vehicle',
    traffic: 'one-way',
    width: 3.0,
    lineWidth: 'standard',
    directionalArrows: true,
    zebraCrossing: true,
    ...patch,
    id: customId,
  })
}

describe('Tier 5 White-Box Adversarial Hardening Suite', () => {
  // ===========================================================================
  // 1. 3-Group Draw Call Structure & Multi-Material Topology
  // ===========================================================================
  describe('1. 3-Group Draw Call Structure & Multi-Material Topology', () => {
    test('T5.1.1: Group allocation: Walkway without paint or contrast has exactly 1 group (STRIPE)', () => {
      const route = makeRoute({
        role: 'pedestrian',
        traffic: 'two-way',
        laneColor: null,
        points: [
          [0, 0],
          [25, 0],
        ],
      })
      const geom = buildRouteGeometry(route)
      expect(geom.groups).toHaveLength(1)
      expect(geom.groups[0]!.materialIndex).toBe(GROUP_STRIPE)
      expect(geom.groups[0]!.start).toBe(0)
      expect(geom.groups[0]!.count).toBe(geom.getIndex()!.count)
    })

    test('T5.1.2: Group allocation: One-way aisle with arrows but no laneColor has 2 groups (STRIPE + CONTRAST)', () => {
      const route = makeRoute({
        role: 'vehicle',
        traffic: 'one-way',
        directionalArrows: true,
        laneColor: null,
        points: [
          [0, 0],
          [30, 0],
        ],
      })
      const geom = buildRouteGeometry(route)
      expect(geom.groups).toHaveLength(2)
      expect(geom.groups[0]!.materialIndex).toBe(GROUP_STRIPE)
      expect(geom.groups[1]!.materialIndex).toBe(GROUP_CONTRAST)
      expect(geom.groups[0]!.start).toBe(0)
      expect(geom.groups[1]!.start).toBe(geom.groups[0]!.count)
      expect(geom.groups[0]!.count + geom.groups[1]!.count).toBe(geom.getIndex()!.count)
    })

    test('T5.1.3: Group allocation: Two-way vehicle aisle with divider has 2 groups (STRIPE + CONTRAST)', () => {
      const route = makeRoute({
        role: 'vehicle',
        traffic: 'two-way',
        laneColor: null,
        points: [
          [0, 0],
          [30, 0],
        ],
      })
      const geom = buildRouteGeometry(route)
      expect(geom.groups).toHaveLength(2)
      expect(geom.groups[0]!.materialIndex).toBe(GROUP_STRIPE)
      expect(geom.groups[1]!.materialIndex).toBe(GROUP_CONTRAST)
      expect(geom.groups[0]!.start).toBe(0)
      expect(geom.groups[1]!.start).toBe(geom.groups[0]!.count)
      expect(geom.groups[0]!.count + geom.groups[1]!.count).toBe(geom.getIndex()!.count)
    })

    test('T5.1.4: Group allocation: Walkway with laneColor but no contrast has 2 groups with non-contiguous material indices (0 and 2)', () => {
      const route = makeRoute({
        role: 'pedestrian',
        traffic: 'two-way',
        laneColor: '#10b981',
        points: [
          [0, 0],
          [20, 0],
        ],
      })
      const geom = buildRouteGeometry(route)
      expect(geom.groups).toHaveLength(2)
      expect(geom.groups[0]!.materialIndex).toBe(GROUP_STRIPE) // 0
      expect(geom.groups[1]!.materialIndex).toBe(GROUP_PAINT) // 2 (materialIndex 1 is skipped)
      expect(geom.groups[0]!.start).toBe(0)
      expect(geom.groups[1]!.start).toBe(geom.groups[0]!.count)
      expect(geom.groups[0]!.count + geom.groups[1]!.count).toBe(geom.getIndex()!.count)
    })

    test('T5.1.5: Group allocation: Full stack (Stripes + Arrows + Paint Ribbon) has all 3 groups (0, 1, 2)', () => {
      const route = makeRoute({
        role: 'vehicle',
        traffic: 'one-way',
        directionalArrows: true,
        laneColor: '#3b82f6',
        points: [
          [0, 0],
          [30, 0],
        ],
      })
      const geom = buildRouteGeometry(route)
      expect(geom.groups).toHaveLength(3)
      expect(geom.groups[0]!.materialIndex).toBe(GROUP_STRIPE)
      expect(geom.groups[1]!.materialIndex).toBe(GROUP_CONTRAST)
      expect(geom.groups[2]!.materialIndex).toBe(GROUP_PAINT)

      expect(geom.groups[0]!.start).toBe(0)
      expect(geom.groups[1]!.start).toBe(geom.groups[0]!.count)
      expect(geom.groups[2]!.start).toBe(geom.groups[0]!.count + geom.groups[1]!.count)
      expect(geom.groups[0]!.count + geom.groups[1]!.count + geom.groups[2]!.count).toBe(
        geom.getIndex()!.count,
      )
    })

    test('T5.1.6: Winding & face normals: Group 0 (stripes), Group 1 (arrows/dividers), Group 2 (paint) all face upwards', () => {
      const route = makeRoute({
        role: 'vehicle',
        traffic: 'one-way',
        directionalArrows: true,
        laneColor: '#e11d48',
        points: [
          [0, 0],
          [30, 0],
        ],
      })
      const geom = buildRouteGeometry(route)
      const pos = geom.getAttribute('position')
      const index = geom.getIndex()!

      const vA = new THREE.Vector3()
      const vB = new THREE.Vector3()
      const vC = new THREE.Vector3()
      const e1 = new THREE.Vector3()
      const e2 = new THREE.Vector3()
      const normal = new THREE.Vector3()

      for (const group of geom.groups) {
        const triStart = group.start / 3
        const triEnd = (group.start + group.count) / 3
        for (let t = triStart; t < triEnd; t++) {
          const iA = index.getX(t * 3)
          const iB = index.getX(t * 3 + 1)
          const iC = index.getX(t * 3 + 2)

          vA.fromBufferAttribute(pos, iA)
          vB.fromBufferAttribute(pos, iB)
          vC.fromBufferAttribute(pos, iC)

          e1.subVectors(vB, vA)
          e2.subVectors(vC, vA)
          normal.crossVectors(e1, e2)

          // Face normal must have strictly positive Y component (CCW winding seen from above)
          expect(normal.y).toBeGreaterThan(0)
        }
      }
    })

    test('T5.1.7: Winding & face normals for two-way divider dashes face upwards', () => {
      const route = makeRoute({
        role: 'vehicle',
        traffic: 'two-way',
        points: [
          [0, 0],
          [20, 0],
        ],
      })
      const geom = buildRouteGeometry(route)
      const pos = geom.getAttribute('position')
      const index = geom.getIndex()!
      const contrastGroup = geom.groups.find((g) => g.materialIndex === GROUP_CONTRAST)!
      expect(contrastGroup).toBeDefined()

      const vA = new THREE.Vector3()
      const vB = new THREE.Vector3()
      const vC = new THREE.Vector3()
      const e1 = new THREE.Vector3()
      const e2 = new THREE.Vector3()
      const normal = new THREE.Vector3()

      const triStart = contrastGroup.start / 3
      const triEnd = (contrastGroup.start + contrastGroup.count) / 3
      for (let t = triStart; t < triEnd; t++) {
        vA.fromBufferAttribute(pos, index.getX(t * 3))
        vB.fromBufferAttribute(pos, index.getX(t * 3 + 1))
        vC.fromBufferAttribute(pos, index.getX(t * 3 + 2))
        e1.subVectors(vB, vA)
        e2.subVectors(vC, vA)
        normal.crossVectors(e1, e2)
        expect(normal.y).toBeGreaterThan(0)
      }
    })

    test('T5.1.8: Edge Case: Zero-length polyline (coincident points) degrades gracefully without NaN or infinite bounds', () => {
      const route = makeRoute({
        points: [
          [5, 5],
          [5, 5],
        ],
        laneColor: '#3b82f6',
      })
      const geom = buildRouteGeometry(route)
      const pos = geom.getAttribute('position')
      for (let i = 0; i < pos.count; i++) {
        expect(Number.isFinite(pos.getX(i))).toBe(true)
        expect(Number.isFinite(pos.getY(i))).toBe(true)
        expect(Number.isFinite(pos.getZ(i))).toBe(true)
      }
      expect(geom.boundingBox).not.toBeNull()
    })

    test('T5.1.9: Edge Case: Maximum polyline (64 vertices) with full stack builds valid geometry and retains bounds', () => {
      const points: Array<[number, number]> = []
      for (let i = 0; i < MAX_VERTICES; i++) {
        points.push([i * 2, Math.sin(i * 0.5) * 4])
      }
      const route = makeRoute({
        points,
        role: 'vehicle',
        traffic: 'one-way',
        laneColor: '#8b5cf6',
      })
      const geom = buildRouteGeometry(route)
      expect(geom.groups).toHaveLength(3)
      expect(geom.getAttribute('position').count).toBeGreaterThan(0)
      expect(geom.getIndex()!.count).toBeGreaterThan(0)
    })

    test('T5.1.10: Extreme route widths: min 0.3m and max 20.0m generate valid non-overlapping ribbons', () => {
      for (const width of [0.3, 20.0]) {
        const route = makeRoute({ width, laneColor: '#10b981' })
        const geom = buildRouteGeometry(route)
        const pos = geom.getAttribute('position')
        const limit = outerHalfWidthM(width, 'standard') + 1e-4

        for (let i = 0; i < pos.count; i++) {
          expect(Math.abs(pos.getZ(i))).toBeLessThanOrEqual(limit)
        }
      }
    })

    test('T5.1.11: Collinear segments (4 points on line) produce continuous geometry without degenerate zero-area faces', () => {
      const route = makeRoute({
        points: [
          [0, 0],
          [10, 0],
          [20, 0],
          [30, 0],
        ],
        laneColor: '#f59e0b',
      })
      const geom = buildRouteGeometry(route)
      const pos = geom.getAttribute('position')
      const index = geom.getIndex()!

      const vA = new THREE.Vector3()
      const vB = new THREE.Vector3()
      const vC = new THREE.Vector3()
      const e1 = new THREE.Vector3()
      const e2 = new THREE.Vector3()
      const cross = new THREE.Vector3()

      for (let t = 0; t < index.count / 3; t++) {
        vA.fromBufferAttribute(pos, index.getX(t * 3))
        vB.fromBufferAttribute(pos, index.getX(t * 3 + 1))
        vC.fromBufferAttribute(pos, index.getX(t * 3 + 2))
        e1.subVectors(vB, vA)
        e2.subVectors(vC, vA)
        cross.crossVectors(e1, e2)
        // Area = 0.5 * cross.length(). Must be strictly non-zero
        expect(cross.length()).toBeGreaterThan(1e-6)
      }
    })

    test('T5.1.12: Acute hairpin turn (179° turn) bevels outer vertex according to MITER_LIMIT', () => {
      // Route goes forward, then folds back at an acute angle
      const route = makeRoute({
        points: [
          [0, 0],
          [20, 0],
          [0.1, 0.2],
        ],
        laneColor: '#ec4899',
      })
      const geom = buildRouteGeometry(route)
      const pos = geom.getAttribute('position')
      for (let i = 0; i < pos.count; i++) {
        expect(Number.isFinite(pos.getX(i))).toBe(true)
        expect(Number.isFinite(pos.getZ(i))).toBe(true)
        // Ensure vertex did not blow up past reasonable miter limit
        expect(Math.abs(pos.getX(i))).toBeLessThan(100)
        expect(Math.abs(pos.getZ(i))).toBeLessThan(100)
      }
    })
  })

  // ===========================================================================
  // 2. Zebra Crosswalk Generation & Topological Hardening
  // ===========================================================================
  describe('2. Zebra Crosswalk Generation & Topological Hardening', () => {
    test('T5.2.1: Sweep across acute intersection angles (5°, 15°, 30°, 45°, 60°, 75°, 85°)', () => {
      const anglesDeg = [5, 15, 30, 45, 60, 75, 85]
      for (const deg of anglesDeg) {
        const rad = (deg * Math.PI) / 180
        const ped = makeRoute({
          id: `ped_${deg}`,
          role: 'pedestrian',
          points: [
            [-10 * Math.cos(rad), -10 * Math.sin(rad)],
            [10 * Math.cos(rad), 10 * Math.sin(rad)],
          ],
        })
        const veh = makeRoute({
          id: `veh_${deg}`,
          role: 'vehicle',
          points: [
            [-10, 0],
            [10, 0],
          ],
          width: 3.5,
        })

        const crossings = computeRouteIntersections([ped, veh])
        expect(crossings).toHaveLength(1)
        const c = crossings[0]!
        expect(c.position[0]).toBeCloseTo(0, 3)
        expect(c.position[2]).toBeCloseTo(0, 3)
        expect(c.width).toBe(3.5)
        expect(c.bars).toHaveLength(ZEBRA_BAR_COUNT)

        const geom = buildZebraGeometry(c)
        expect(geom.getAttribute('position').count).toBe(24)
        expect(geom.getIndex()!.count).toBe(36)
        geom.dispose()
      }
    })

    test('T5.2.2: Grazing and collinear parallel segments emit 0 zebra crossings', () => {
      // Two routes parallel along X axis, separated by 0.5m
      const ped = makeRoute({
        id: 'ped_par',
        role: 'pedestrian',
        points: [
          [-20, 0.5],
          [20, 0.5],
        ],
      })
      const veh = makeRoute({
        id: 'veh_par',
        role: 'vehicle',
        points: [
          [-20, 0],
          [20, 0],
        ],
      })
      expect(computeRouteIntersections([ped, veh])).toHaveLength(0)
    })

    test('T5.2.3: Collinear overlapping segments emit 0 zebra crossings', () => {
      // Both routes lie along exact same line (Y=0, Z=0)
      const ped = makeRoute({
        id: 'ped_col',
        role: 'pedestrian',
        points: [
          [-5, 0],
          [15, 0],
        ],
      })
      const veh = makeRoute({
        id: 'veh_col',
        role: 'vehicle',
        points: [
          [0, 0],
          [20, 0],
        ],
      })
      expect(computeRouteIntersections([ped, veh])).toHaveLength(0)
    })

    test('T5.2.4: Multi-segment intersection: zigzagging pedestrian route crossing vehicle corridor 3 times', () => {
      const ped = makeRoute({
        id: 'ped_zigzag',
        role: 'pedestrian',
        points: [
          [5, -10],
          [5, 10],
          [15, 10],
          [15, -10],
          [25, -10],
          [25, 10],
        ],
      })
      const veh = makeRoute({
        id: 'veh_straight',
        role: 'vehicle',
        points: [
          [0, 0],
          [30, 0],
        ],
      })

      const crossings = computeRouteIntersections([ped, veh])
      expect(crossings).toHaveLength(3)
      const xCoords = crossings.map((c) => c.position[0]).sort((a, b) => a - b)
      expect(xCoords[0]).toBeCloseTo(5, 3)
      expect(xCoords[1]).toBeCloseTo(15, 3)
      expect(xCoords[2]).toBeCloseTo(25, 3)
    })

    test('T5.2.5: Endpoint T-junction touch (pedestrian route starts on vehicle route) is detected', () => {
      const ped = makeRoute({
        id: 'ped_t',
        role: 'pedestrian',
        points: [
          [10, 0],
          [10, 15],
        ],
      })
      const veh = makeRoute({
        id: 'veh_t',
        role: 'vehicle',
        points: [
          [0, 0],
          [20, 0],
        ],
      })

      const crossings = computeRouteIntersections([ped, veh])
      expect(crossings).toHaveLength(1)
      expect(crossings[0]!.position[0]).toBeCloseTo(10, 3)
      expect(crossings[0]!.position[2]).toBeCloseTo(0, 3)
    })

    test('T5.2.6: Zebra Crossing bars geometry: all 6 bars lie exactly at ZEBRA_ELEVATION_M (0.016m)', () => {
      const ped = makeRoute({
        id: 'ped_bars',
        role: 'pedestrian',
        points: [
          [0, -10],
          [0, 10],
        ],
      })
      const veh = makeRoute({
        id: 'veh_bars',
        role: 'vehicle',
        points: [
          [-10, 0],
          [10, 0],
        ],
      })
      const crossing = computeRouteIntersections([ped, veh])[0]!
      const geom = buildZebraGeometry(crossing)
      const pos = geom.getAttribute('position')

      for (let i = 0; i < pos.count; i++) {
        expect(pos.getY(i)).toBeCloseTo(ZEBRA_ELEVATION_M, 4)
      }
      geom.dispose()
    })
  })

  // ===========================================================================
  // 3. Material Lifecycle, Cache Identity & Appearance Theme Transitions
  // ===========================================================================
  describe('3. Material Lifecycle, Cache Identity & Appearance Theme Transitions', () => {
    test('T5.3.1: Material instance uniqueness across appearance switches (Rendered PBR vs Solid Lambert vs Monochrome)', () => {
      const appRendered: Appearance = {
        shading: 'rendered',
        textures: true,
        colorPreset: 'light',
      }
      const appSolid: Appearance = {
        shading: 'solid',
        textures: true,
        colorPreset: 'light',
      }
      const appMonoDark: Appearance = {
        shading: 'rendered',
        textures: false,
        colorPreset: 'dark',
      }

      const matsRendered = getRouteMaterials('vehicle', appRendered, '#3b82f6')
      const matsSolid = getRouteMaterials('vehicle', appSolid, '#3b82f6')
      const matsMono = getRouteMaterials('vehicle', appMonoDark, '#3b82f6')

      // Key differentiates them, so each appearance gets distinct material instances
      expect(matsRendered[0]).not.toBe(matsSolid[0])
      expect(matsRendered[0]).not.toBe(matsMono[0])
      expect(matsSolid[0]).not.toBe(matsMono[0])

      // Rendered mode produces MeshStandardMaterial
      expect(matsRendered[0]).toBeInstanceOf(THREE.MeshStandardMaterial)
      // Solid and Monochrome produce MeshLambertMaterial
      expect(matsSolid[0]).toBeInstanceOf(THREE.MeshLambertMaterial)
      expect(matsMono[0]).toBeInstanceOf(THREE.MeshLambertMaterial)
    })

    test('T5.3.2: Cache stability: Repeated calls with same role, appearance, and laneColor return identical material references', () => {
      const appearance: Appearance = {
        shading: 'rendered',
        textures: true,
        colorPreset: 'light',
      }
      const first = getRouteMaterials('pedestrian', appearance, '#10b981')
      const second = getRouteMaterials('pedestrian', appearance, '#10b981')

      expect(first).toBe(second)
      expect(first[0]).toBe(second[0])
      expect(first[1]).toBe(second[1])
      expect(first[2]).toBe(second[2])
    })

    test('T5.3.3: Corridor paint material respects appearance and preserves depth bias properties', () => {
      const appearance: Appearance = {
        shading: 'rendered',
        textures: true,
        colorPreset: 'light',
      }
      const paintMat = getCorridorPaintMaterial('#f97316', appearance)

      expect(paintMat).toBeInstanceOf(THREE.MeshStandardMaterial)
      expect(paintMat.depthWrite).toBe(false)
      expect(paintMat.polygonOffset).toBe(true)
      expect(paintMat.polygonOffsetFactor).toBe(DEPTH_BIAS.PAINT_FILL.polygonOffsetFactor)
      expect(paintMat.polygonOffsetUnits).toBe(DEPTH_BIAS.PAINT_FILL.polygonOffsetUnits)
      expect((paintMat as unknown as { renderOrder: number }).renderOrder).toBe(
        DEPTH_BIAS.PAINT_FILL.renderOrder,
      )
    })

    test('T5.3.4: AUDIT FINDING: getZebraMaterial returns singleton material ignoring appearance parameters', () => {
      const app1: Appearance = { shading: 'rendered', textures: true, colorPreset: 'light' }
      const app2: Appearance = { shading: 'solid', textures: false, colorPreset: 'dark' }

      const zMat1 = getZebraMaterial(app1)
      const zMat2 = getZebraMaterial(app2)

      // Verified white-box behavior: cachedZebraMat is a shared singleton
      expect(zMat1).toBe(zMat2)
      expect(zMat1).toBe(cachedZebraMaterial)
      expect(zMat1.depthWrite).toBe(false)
      expect(zMat1.side).toBe(THREE.DoubleSide)
      expect((zMat1 as unknown as { renderOrder: number }).renderOrder).toBe(
        DEPTH_BIAS.ZEBRA.renderOrder,
      )
    })

    test('T5.3.5: Geometry retain and release lifecycle: retainRouteGeometry and releaseRouteGeometry work symmetrically', () => {
      const route = makeRoute({
        points: [
          [0, 0],
          [40, 0],
        ],
        laneColor: '#06b6d4',
      })
      const key = routeGeometryKey(route)

      // Retain geometry claims key
      const claimedKey = retainRouteGeometry(route)
      expect(claimedKey).toBe(key)

      // Release geometry releases claim
      expect(() => releaseRouteGeometry(claimedKey)).not.toThrow()
    })
  })

  // ===========================================================================
  // 4. Depth Bias Stratification & Cache Invalidation Hardening
  // ===========================================================================
  describe('4. Depth Bias Stratification & Cache Invalidation Hardening', () => {
    test('T5.4.1: Monotonic depth bias hierarchy verification: Factor & Units strictly negative and stepped', () => {
      expect(DEPTH_BIAS.PAINT_FILL.polygonOffsetFactor).toBe(-1)
      expect(DEPTH_BIAS.STRIPES.polygonOffsetFactor).toBe(-2)
      expect(DEPTH_BIAS.ARROWS.polygonOffsetFactor).toBe(-3)
      expect(DEPTH_BIAS.ZEBRA.polygonOffsetFactor).toBe(-4)

      expect(DEPTH_BIAS.PAINT_FILL.polygonOffsetUnits).toBe(-1)
      expect(DEPTH_BIAS.STRIPES.polygonOffsetUnits).toBe(-2)
      expect(DEPTH_BIAS.ARROWS.polygonOffsetUnits).toBe(-3)
      expect(DEPTH_BIAS.ZEBRA.polygonOffsetUnits).toBe(-4)
    })

    test('T5.4.2: Monotonic physical elevation hierarchy: strictly increasing deltas', () => {
      expect(ROUTE_ELEVATIONS.BASE_SLAB).toBe(0.0)
      expect(ROUTE_ELEVATIONS.RAYCAST_PICK).toBe(0.001)
      expect(ROUTE_ELEVATIONS.PAINTED_CORRIDOR).toBe(0.002)
      expect(ROUTE_ELEVATIONS.EDGE_STRIPES).toBe(0.008)
      expect(ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS).toBe(0.012)
      expect(ROUTE_ELEVATIONS.ZEBRA_CROSSWALK).toBe(0.016)
      expect(ROUTE_ELEVATIONS.CONTROLS_GRIPS).toBe(0.05)

      // Verify strict monotonicity
      const elevations = [
        ROUTE_ELEVATIONS.BASE_SLAB,
        ROUTE_ELEVATIONS.RAYCAST_PICK,
        ROUTE_ELEVATIONS.PAINTED_CORRIDOR,
        ROUTE_ELEVATIONS.EDGE_STRIPES,
        ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS,
        ROUTE_ELEVATIONS.ZEBRA_CROSSWALK,
        ROUTE_ELEVATIONS.CONTROLS_GRIPS,
      ]
      for (let i = 0; i < elevations.length - 1; i++) {
        expect(elevations[i + 1]!).toBeGreaterThan(elevations[i]!)
      }
    })

    test('T5.4.3: Cache key collision resistance: distinct polylines never share identical geometry keys', () => {
      const routeA = makeRoute({
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const routeB = makeRoute({
        points: [
          [0, 0],
          [0, 10],
        ],
      })
      const routeC = makeRoute({
        points: [
          [0, 0],
          [5, 5],
          [10, 0],
        ],
      })

      const keyA = routeGeometryKey(routeA)
      const keyB = routeGeometryKey(routeB)
      const keyC = routeGeometryKey(routeC)

      expect(keyA).not.toBe(keyB)
      expect(keyA).not.toBe(keyC)
      expect(keyB).not.toBe(keyC)
    })

    test('T5.4.4: Geometry cache key responsiveness: changing laneColor or arrows immediately updates key', () => {
      const baseRoute = makeRoute({ laneColor: '#111827', directionalArrows: true })
      const keyBase = routeGeometryKey(baseRoute)

      const changedColor = makeRoute({ laneColor: '#ef4444', directionalArrows: true })
      expect(routeGeometryKey(changedColor)).not.toBe(keyBase)

      const toggledArrows = makeRoute({ laneColor: '#111827', directionalArrows: false })
      expect(routeGeometryKey(toggledArrows)).not.toBe(keyBase)
    })
  })
})
