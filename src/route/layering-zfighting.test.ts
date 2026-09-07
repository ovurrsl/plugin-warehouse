import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { DEPTH_BIAS, PAINT_LIFT_M, ROUTE_ELEVATIONS } from './constants'
import { buildRouteGeometry, markingGates, routeGeometryKey } from './geometry'
import { getCorridorPaintMaterial, getRouteMaterials, getZebraMaterial } from './materials'
import { routeParametrics } from './parametrics'
import { RouteNode } from './schema'
import { outerHalfWidthM } from './stripes'

function makeRoute(patch: Record<string, unknown> = {}): RouteNode {
  return RouteNode.parse({
    id: `route_${Math.random().toString(36).slice(2, 8)}`,
    points: [
      [0, 0],
      [20, 0],
    ],
    role: 'pedestrian',
    traffic: 'two-way',
    width: 2.0,
    lineWidth: 'standard',
    ...patch,
  })
}

describe('Milestone 2: Monotonic Y-Elevation Hierarchy & Z-Fighting Prevention', () => {
  // ---------------------------------------------------------------------------
  // 1. Strict Monotonic Inequality Verification
  // ---------------------------------------------------------------------------
  describe('1. Strict Monotonic Inequality Hierarchy', () => {
    test('Strict monotonic inequality: Slab < Raycast < Paint < Stripes < Arrows < Zebra < Grips', () => {
      expect(ROUTE_ELEVATIONS.BASE_SLAB).toBeLessThan(ROUTE_ELEVATIONS.RAYCAST_PICK)
      expect(ROUTE_ELEVATIONS.RAYCAST_PICK).toBeLessThan(ROUTE_ELEVATIONS.PAINTED_CORRIDOR)
      expect(ROUTE_ELEVATIONS.PAINTED_CORRIDOR).toBeLessThan(ROUTE_ELEVATIONS.EDGE_STRIPES)
      expect(ROUTE_ELEVATIONS.EDGE_STRIPES).toBeLessThan(ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS)
      expect(ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS).toBeLessThan(ROUTE_ELEVATIONS.ZEBRA_CROSSWALK)
      expect(ROUTE_ELEVATIONS.ZEBRA_CROSSWALK).toBeLessThan(ROUTE_ELEVATIONS.CONTROLS_GRIPS)
    })

    test('Exact published metric values match reference specifications', () => {
      expect(ROUTE_ELEVATIONS.BASE_SLAB).toBe(0.0)
      expect(ROUTE_ELEVATIONS.RAYCAST_PICK).toBe(0.001)
      expect(ROUTE_ELEVATIONS.PAINTED_CORRIDOR).toBe(0.002)
      expect(ROUTE_ELEVATIONS.EDGE_STRIPES).toBe(0.008)
      expect(ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS).toBe(0.012)
      expect(ROUTE_ELEVATIONS.ZEBRA_CROSSWALK).toBe(0.016)
      expect(ROUTE_ELEVATIONS.CONTROLS_GRIPS).toBe(0.05)
    })

    test('Contract aliases match their canonical counterparts', () => {
      expect(ROUTE_ELEVATIONS.SLAB).toBe(ROUTE_ELEVATIONS.BASE_SLAB)
      expect(ROUTE_ELEVATIONS.RAYCAST).toBe(ROUTE_ELEVATIONS.RAYCAST_PICK)
      expect(ROUTE_ELEVATIONS.PAINT_FILL).toBe(ROUTE_ELEVATIONS.PAINTED_CORRIDOR)
      expect(ROUTE_ELEVATIONS.PAINT_CORRIDOR).toBe(ROUTE_ELEVATIONS.PAINTED_CORRIDOR)
      expect(ROUTE_ELEVATIONS.GRIPS).toBe(ROUTE_ELEVATIONS.CONTROLS_GRIPS)
    })

    test('Adjacent elevation delta is >= 0.001m across all contiguous tiers', () => {
      const tiers = [
        ROUTE_ELEVATIONS.BASE_SLAB,
        ROUTE_ELEVATIONS.RAYCAST_PICK,
        ROUTE_ELEVATIONS.PAINTED_CORRIDOR,
        ROUTE_ELEVATIONS.EDGE_STRIPES,
        ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS,
        ROUTE_ELEVATIONS.ZEBRA_CROSSWALK,
        ROUTE_ELEVATIONS.CONTROLS_GRIPS,
      ]

      for (let i = 0; i < tiers.length - 1; i++) {
        const delta = tiers[i + 1]! - tiers[i]!
        expect(delta).toBeGreaterThanOrEqual(0.00099) // >= 1mm threshold
      }
    })

    test('Picking raycast elevation PAINT_LIFT_M sits strictly between slab and paint floor', () => {
      expect(PAINT_LIFT_M).toBeGreaterThan(ROUTE_ELEVATIONS.BASE_SLAB)
      expect(PAINT_LIFT_M).toBeLessThan(ROUTE_ELEVATIONS.PAINTED_CORRIDOR)
      expect(PAINT_LIFT_M).toBe(ROUTE_ELEVATIONS.RAYCAST_PICK)
    })
  })

  // ---------------------------------------------------------------------------
  // 2. WebGL Depth Bias & RenderOrder Matrix
  // ---------------------------------------------------------------------------
  describe('2. Multi-tier Depth Bias & RenderOrder Matrix', () => {
    test('Stepped polygonOffsetUnits ordering: PAINT_FILL (-1) > STRIPES (-2) > ARROWS (-3) > ZEBRA (-4)', () => {
      expect(DEPTH_BIAS.PAINT_FILL.polygonOffsetUnits).toBe(-1)
      expect(DEPTH_BIAS.STRIPES.polygonOffsetUnits).toBe(-2)
      expect(DEPTH_BIAS.ARROWS.polygonOffsetUnits).toBe(-3)
      expect(DEPTH_BIAS.ZEBRA.polygonOffsetUnits).toBe(-4)

      expect(DEPTH_BIAS.PAINT_FILL.polygonOffsetUnits).toBeGreaterThan(
        DEPTH_BIAS.STRIPES.polygonOffsetUnits,
      )
      expect(DEPTH_BIAS.STRIPES.polygonOffsetUnits).toBeGreaterThan(
        DEPTH_BIAS.ARROWS.polygonOffsetUnits,
      )
      expect(DEPTH_BIAS.ARROWS.polygonOffsetUnits).toBeGreaterThan(
        DEPTH_BIAS.ZEBRA.polygonOffsetUnits,
      )
    })

    test('Stepped polygonOffsetFactor ordering: PAINT_FILL (-1) > STRIPES (-2) > ARROWS (-3) > ZEBRA (-4)', () => {
      expect(DEPTH_BIAS.PAINT_FILL.polygonOffsetFactor).toBe(-1)
      expect(DEPTH_BIAS.STRIPES.polygonOffsetFactor).toBe(-2)
      expect(DEPTH_BIAS.ARROWS.polygonOffsetFactor).toBe(-3)
      expect(DEPTH_BIAS.ZEBRA.polygonOffsetFactor).toBe(-4)
    })

    test('Stepped renderOrder ordering: PAINT_FILL (1) < STRIPES (5) < ARROWS (8) < ZEBRA (10)', () => {
      expect(DEPTH_BIAS.PAINT_FILL.renderOrder).toBe(1)
      expect(DEPTH_BIAS.STRIPES.renderOrder).toBe(5)
      expect(DEPTH_BIAS.ARROWS.renderOrder).toBe(8)
      expect(DEPTH_BIAS.ZEBRA.renderOrder).toBe(10)

      expect(DEPTH_BIAS.PAINT_FILL.renderOrder).toBeLessThan(DEPTH_BIAS.STRIPES.renderOrder)
      expect(DEPTH_BIAS.STRIPES.renderOrder).toBeLessThan(DEPTH_BIAS.ARROWS.renderOrder)
      expect(DEPTH_BIAS.ARROWS.renderOrder).toBeLessThan(DEPTH_BIAS.ZEBRA.renderOrder)
    })

    test('Backwards-compatible base DEPTH_BIAS fields are preserved', () => {
      expect(DEPTH_BIAS.factor).toBe(-1)
      expect(DEPTH_BIAS.vehicleUnits).toBe(-2)
      expect(DEPTH_BIAS.pedestrianUnits).toBe(-4)
    })
  })

  // ---------------------------------------------------------------------------
  // 3. Materials Configuration & Depth Attributes
  // ---------------------------------------------------------------------------
  describe('3. Materials Configuration & Depth Attributes', () => {
    const appearance = { shading: 'rendered', textures: true, colorPreset: 'light' } as const

    test('All route marking materials have depthWrite: false and polygonOffset: true', () => {
      const mats = getRouteMaterials('vehicle', appearance as never)
      expect(mats).toHaveLength(3)

      for (const mat of mats) {
        expect(mat.depthWrite).toBe(false)
        expect(mat.polygonOffset).toBe(true)
        expect(mat.side).toBe(THREE.FrontSide)
      }

      // Stripe material matches STRIPES depth bias
      const stripeMat = mats[0]!
      expect(stripeMat.polygonOffsetUnits).toBe(DEPTH_BIAS.STRIPES.polygonOffsetUnits)
      expect(stripeMat.polygonOffsetFactor).toBe(DEPTH_BIAS.STRIPES.polygonOffsetFactor)
      expect((stripeMat as unknown as { renderOrder: number }).renderOrder).toBe(
        DEPTH_BIAS.STRIPES.renderOrder,
      )

      // Contrast material matches ARROWS depth bias
      const contrastMat = mats[1]!
      expect(contrastMat.polygonOffsetUnits).toBe(DEPTH_BIAS.ARROWS.polygonOffsetUnits)
      expect(contrastMat.polygonOffsetFactor).toBe(DEPTH_BIAS.ARROWS.polygonOffsetFactor)
      expect((contrastMat as unknown as { renderOrder: number }).renderOrder).toBe(
        DEPTH_BIAS.ARROWS.renderOrder,
      )

      // Paint fill material matches PAINT_FILL depth bias
      const paintMat = mats[2]!
      expect(paintMat.polygonOffsetUnits).toBe(DEPTH_BIAS.PAINT_FILL.polygonOffsetUnits)
      expect(paintMat.polygonOffsetFactor).toBe(DEPTH_BIAS.PAINT_FILL.polygonOffsetFactor)
      expect((paintMat as unknown as { renderOrder: number }).renderOrder).toBe(
        DEPTH_BIAS.PAINT_FILL.renderOrder,
      )
    })

    test('Zebra material has depthWrite: false, polygonOffset: true, and renderOrder: 10', () => {
      const zebraMat = getZebraMaterial(appearance as never)
      expect(zebraMat.depthWrite).toBe(false)
      expect(zebraMat.polygonOffset).toBe(true)
      expect(zebraMat.polygonOffsetUnits).toBe(DEPTH_BIAS.ZEBRA.polygonOffsetUnits)
      expect(zebraMat.polygonOffsetFactor).toBe(DEPTH_BIAS.ZEBRA.polygonOffsetFactor)
      expect((zebraMat as unknown as { renderOrder: number }).renderOrder).toBe(
        DEPTH_BIAS.ZEBRA.renderOrder,
      )
    })

    test('getCorridorPaintMaterial produces clean surface paint with PAINT_FILL depth bias', () => {
      const mat = getCorridorPaintMaterial('#10b981', appearance as never)
      expect(mat.depthWrite).toBe(false)
      expect(mat.polygonOffset).toBe(true)
      expect(mat.polygonOffsetUnits).toBe(DEPTH_BIAS.PAINT_FILL.polygonOffsetUnits)
      expect(mat.polygonOffsetFactor).toBe(DEPTH_BIAS.PAINT_FILL.polygonOffsetFactor)
      expect((mat as unknown as { renderOrder: number }).renderOrder).toBe(
        DEPTH_BIAS.PAINT_FILL.renderOrder,
      )
    })

    test('Corridor paint materials are cached deterministically by color and appearance', () => {
      const mat1 = getCorridorPaintMaterial('#3b82f6', appearance as never)
      const mat2 = getCorridorPaintMaterial('#3b82f6', appearance as never)
      const mat3 = getCorridorPaintMaterial('#ef4444', appearance as never)

      expect(mat1).toBe(mat2) // Same instance from cache
      expect(mat1).not.toBe(mat3) // Different color produces different material
    })
  })

  // ---------------------------------------------------------------------------
  // 4. Geometry Stratification & Vertex Y-Positions
  // ---------------------------------------------------------------------------
  describe('4. Geometry Stratification & Vertex Y-Positions', () => {
    test('Unpainted route emits edge boundary stripes at Y = 0.008m', () => {
      const route = makeRoute({
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const geom = buildRouteGeometry(route)
      const pos = geom.getAttribute('position')

      // All vertices are edge stripes at 0.008m
      for (let i = 0; i < pos.count; i++) {
        expect(pos.getY(i)).toBeCloseTo(ROUTE_ELEVATIONS.EDGE_STRIPES, 4)
      }
    })

    test('Painted route emits corridor ribbon at Y = 0.002m and stripes at Y = 0.008m', () => {
      const route = makeRoute({
        laneColor: '#3b82f6',
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const geom = buildRouteGeometry(route)
      const pos = geom.getAttribute('position')

      const yValues = new Set<number>()
      for (let i = 0; i < pos.count; i++) {
        yValues.add(Math.round(pos.getY(i) * 1000) / 1000)
      }

      // Contains both 0.002m (corridor ribbon) and 0.008m (stripes)
      expect(yValues.has(0.002)).toBe(true)
      expect(yValues.has(0.008)).toBe(true)
      expect(yValues.size).toBe(2)
    })

    test('Painted one-way route exhibits full 3-tier vertical stratification (0.002, 0.008, 0.012)', () => {
      const route = makeRoute({
        traffic: 'one-way',
        laneColor: '#059669',
        points: [
          [0, 0],
          [30, 0],
        ],
      })
      const geom = buildRouteGeometry(route)
      const pos = geom.getAttribute('position')

      const yValues = new Set<number>()
      for (let i = 0; i < pos.count; i++) {
        yValues.add(Math.round(pos.getY(i) * 1000) / 1000)
      }

      // Corridor (0.002), Stripes (0.008), Arrows (0.012)
      expect(yValues.has(0.002)).toBe(true)
      expect(yValues.has(0.008)).toBe(true)
      expect(yValues.has(0.012)).toBe(true)
      expect(yValues.size).toBe(3)
    })

    test('All geometry triangles have normals facing positive Y (+1) and correct CCW winding', () => {
      const route = makeRoute({
        traffic: 'one-way',
        laneColor: '#ef4444',
        points: [
          [0, 0],
          [20, 0],
          [20, 10],
        ],
      })
      const geom = buildRouteGeometry(route)
      const pos = geom.getAttribute('position')
      const norm = geom.getAttribute('normal')
      const index = geom.getIndex()!

      for (let i = 0; i < norm.count; i++) {
        expect(norm.getY(i)).toBe(1)
      }

      for (let t = 0; t < index.count; t += 3) {
        const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
        const abx = pos.getX(b) - pos.getX(a)
        const abz = pos.getZ(b) - pos.getZ(a)
        const acx = pos.getX(c) - pos.getX(a)
        const acz = pos.getZ(c) - pos.getZ(a)
        const normalY = abz * acx - abx * acz
        expect(normalY).toBeGreaterThan(0)
      }
    })

    test('Corridor ribbon stays strictly within route outer boundaries', () => {
      const route = makeRoute({
        width: 3.0,
        lineWidth: 'wide',
        laneColor: '#f59e0b',
        points: [
          [0, 0],
          [20, 0],
        ],
      })
      const geom = buildRouteGeometry(route)
      const pos = geom.getAttribute('position')
      const maxBound = outerHalfWidthM(route.width, route.lineWidth) + 1e-6

      for (let i = 0; i < pos.count; i++) {
        expect(Math.abs(pos.getZ(i))).toBeLessThanOrEqual(maxBound)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // 5. Decal Visibility & Z-Fighting Suppression
  // ---------------------------------------------------------------------------
  describe('5. Decal Visibility & Z-Fighting Suppression', () => {
    test('Painted corridor floor does NOT obscure edge boundary stripes', () => {
      const delta = ROUTE_ELEVATIONS.EDGE_STRIPES - ROUTE_ELEVATIONS.PAINTED_CORRIDOR
      expect(delta).toBe(0.006)
      expect(delta).toBeGreaterThan(0)

      // Render order & offset hierarchy ensure decals render on top
      expect(DEPTH_BIAS.PAINT_FILL.renderOrder).toBeLessThan(DEPTH_BIAS.STRIPES.renderOrder)
      expect(DEPTH_BIAS.PAINT_FILL.polygonOffsetUnits).toBeGreaterThan(
        DEPTH_BIAS.STRIPES.polygonOffsetUnits,
      )
    })

    test('Painted corridor floor does NOT obscure directional arrows', () => {
      const delta = ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS - ROUTE_ELEVATIONS.PAINTED_CORRIDOR
      expect(delta).toBe(0.01)
      expect(delta).toBeGreaterThan(0)

      expect(DEPTH_BIAS.PAINT_FILL.renderOrder).toBeLessThan(DEPTH_BIAS.ARROWS.renderOrder)
      expect(DEPTH_BIAS.PAINT_FILL.polygonOffsetUnits).toBeGreaterThan(
        DEPTH_BIAS.ARROWS.polygonOffsetUnits,
      )
    })

    test('Painted corridor floor does NOT obscure zebra crossings', () => {
      const delta = ROUTE_ELEVATIONS.ZEBRA_CROSSWALK - ROUTE_ELEVATIONS.PAINTED_CORRIDOR
      expect(delta).toBe(0.014)
      expect(delta).toBeGreaterThan(0)

      expect(DEPTH_BIAS.PAINT_FILL.renderOrder).toBeLessThan(DEPTH_BIAS.ZEBRA.renderOrder)
      expect(DEPTH_BIAS.PAINT_FILL.polygonOffsetUnits).toBeGreaterThan(
        DEPTH_BIAS.ZEBRA.polygonOffsetUnits,
      )
    })

    test('Zebra crossings sit above directional flow arrows', () => {
      const delta = ROUTE_ELEVATIONS.ZEBRA_CROSSWALK - ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS
      expect(delta).toBe(0.004)
      expect(delta).toBeGreaterThan(0)

      expect(DEPTH_BIAS.ARROWS.renderOrder).toBeLessThan(DEPTH_BIAS.ZEBRA.renderOrder)
      expect(DEPTH_BIAS.ARROWS.polygonOffsetUnits).toBeGreaterThan(
        DEPTH_BIAS.ZEBRA.polygonOffsetUnits,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // 6. Directional Arrows Toggle & Cache Key Invalidation
  // ---------------------------------------------------------------------------
  describe('6. Directional Arrows Toggle & Cache Key Invalidation', () => {
    test('One-way route with directionalArrows: true (or default) emits arrow geometry', () => {
      const route = makeRoute({
        traffic: 'one-way',
        directionalArrows: true,
        points: [
          [0, 0],
          [30, 0],
        ],
      })
      expect(markingGates(route).arrows).toBe(true)

      const geom = buildRouteGeometry(route)
      expect(geom.groups).toHaveLength(2)
      const arrowGroup = geom.groups.find((g) => g.materialIndex === 1)
      expect(arrowGroup).toBeDefined()
      expect(arrowGroup!.count).toBeGreaterThan(0)
    })

    test('One-way route with directionalArrows: false suppresses arrow geometry', () => {
      const route = makeRoute({
        traffic: 'one-way',
        directionalArrows: false,
        points: [
          [0, 0],
          [30, 0],
        ],
      })
      expect(markingGates(route).arrows).toBe(false)

      const geom = buildRouteGeometry(route)
      // Only stripes group emitted
      expect(geom.groups).toHaveLength(1)
      expect(geom.groups[0]!.materialIndex).toBe(0)
    })

    test('Two-way route does not emit arrows regardless of directionalArrows toggle', () => {
      const route = makeRoute({
        traffic: 'two-way',
        directionalArrows: true,
        points: [
          [0, 0],
          [30, 0],
        ],
      })
      expect(markingGates(route).arrows).toBe(false)
    })

    test('Setting laneColor modifies routeGeometryKey ensuring cache eviction', () => {
      const unpainted = makeRoute({
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const painted = makeRoute({
        points: [
          [0, 0],
          [10, 0],
        ],
        laneColor: '#10b981',
      })

      expect(routeGeometryKey(painted)).not.toBe(routeGeometryKey(unpainted))
    })

    test('Toggling directionalArrows modifies routeGeometryKey ensuring cache eviction', () => {
      const withArrows = makeRoute({ traffic: 'one-way', directionalArrows: true })
      const withoutArrows = makeRoute({ traffic: 'one-way', directionalArrows: false })

      expect(routeGeometryKey(withoutArrows)).not.toBe(routeGeometryKey(withArrows))
    })
  })

  // ---------------------------------------------------------------------------
  // 7. UI Inspector Parametric Exposure
  // ---------------------------------------------------------------------------
  describe('7. UI Inspector Parametric Exposure', () => {
    test('routeParametrics exposes laneColor and directionalArrows in Route group', () => {
      const routeGroup = routeParametrics.groups.find((g) => g.label === 'Route')
      expect(routeGroup).toBeDefined()

      const laneColorField = routeGroup!.fields.find((f) => f.key === 'laneColor')
      expect(laneColorField).toBeDefined()
      expect(laneColorField!.kind).toBe('color')

      const arrowsField = routeGroup!.fields.find((f) => f.key === 'directionalArrows')
      expect(arrowsField).toBeDefined()
      expect(arrowsField!.kind).toBe('boolean')

      const zebraField = routeGroup!.fields.find((f) => f.key === 'zebraCrossing')
      expect(zebraField).toBeDefined()
      expect(zebraField!.kind).toBe('boolean')

      const curvedField = routeGroup!.fields.find((f) => f.key === 'curved')
      expect(curvedField).toBeDefined()
      expect(curvedField!.kind).toBe('boolean')
    })

    test('Painted route emits dedicated paint draw group (materialIndex: 2) in buildRouteGeometry', () => {
      const route = makeRoute({
        laneColor: '#3b82f6',
        traffic: 'one-way',
        points: [
          [0, 0],
          [20, 0],
        ],
      })
      const geom = buildRouteGeometry(route)
      expect(geom.groups).toHaveLength(3)
      expect(geom.groups[0]!.materialIndex).toBe(0) // stripe
      expect(geom.groups[1]!.materialIndex).toBe(1) // contrast (arrows)
      expect(geom.groups[2]!.materialIndex).toBe(2) // paint
    })
  })
})
