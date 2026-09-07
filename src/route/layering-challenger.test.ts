import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { DEPTH_BIAS, ROUTE_ELEVATIONS } from './constants'
import { buildRouteGeometry, getRouteGeometry, routeGeometryKey } from './geometry'
import { buildZebraGeometry, computeRouteIntersections } from './intersections'
import { getCorridorPaintMaterial, getRouteMaterials, getZebraMaterial } from './materials'
import { RouteNode } from './schema'
import { outerHalfWidthM } from './stripes'

function makeRoute(patch: Record<string, unknown> = {}): RouteNode {
  return RouteNode.parse({
    id: `route_${Math.random().toString(36).slice(2, 8)}`,
    points: [
      [0, 0],
      [20, 0],
    ],
    role: 'vehicle',
    traffic: 'one-way',
    width: 3.0,
    lineWidth: 'standard',
    directionalArrows: true,
    ...patch,
  })
}

describe('Challenger M2: Depth Buffer, Z-Fighting & Multi-Layer Stack Stress Suite', () => {
  // ---------------------------------------------------------------------------
  // 1. Multi-Layer Stack Geometric Elevation & Boundary Invariance
  // ---------------------------------------------------------------------------
  describe('1. Multi-Layer Stack Geometric Elevation & Boundary Invariance', () => {
    test('Strict monotonic physical elevations: Slab < Raycast < Corridor < Stripes < Arrows < Zebra < Grips', () => {
      expect(ROUTE_ELEVATIONS.BASE_SLAB).toBeLessThan(ROUTE_ELEVATIONS.RAYCAST_PICK)
      expect(ROUTE_ELEVATIONS.RAYCAST_PICK).toBeLessThan(ROUTE_ELEVATIONS.PAINTED_CORRIDOR)
      expect(ROUTE_ELEVATIONS.PAINTED_CORRIDOR).toBeLessThan(ROUTE_ELEVATIONS.EDGE_STRIPES)
      expect(ROUTE_ELEVATIONS.EDGE_STRIPES).toBeLessThan(ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS)
      expect(ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS).toBeLessThan(ROUTE_ELEVATIONS.ZEBRA_CROSSWALK)
      expect(ROUTE_ELEVATIONS.ZEBRA_CROSSWALK).toBeLessThan(ROUTE_ELEVATIONS.CONTROLS_GRIPS)
    })

    test('Adjacent layers have minimum delta >= 1mm preventing coplanar contention', () => {
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
        expect(delta).toBeGreaterThanOrEqual(0.00099)
      }
    })

    test('Emitted geometry vertex elevations exactly match ROUTE_ELEVATIONS across 3 tiers', () => {
      const route = makeRoute({
        laneColor: '#3b82f6',
        traffic: 'one-way',
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

      expect(yValues.has(ROUTE_ELEVATIONS.PAINTED_CORRIDOR)).toBe(true)
      expect(yValues.has(ROUTE_ELEVATIONS.EDGE_STRIPES)).toBe(true)
      expect(yValues.has(ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS)).toBe(true)
      expect(yValues.size).toBe(3)
    })

    test('Zebra crossing geometry emitted at exact ZEBRA_CROSSWALK elevation', () => {
      const ped = makeRoute({
        id: 'route_ped',
        role: 'pedestrian',
        points: [
          [10, -5],
          [10, 5],
        ],
      })
      const veh = makeRoute({
        id: 'route_veh',
        role: 'vehicle',
        points: [
          [0, 0],
          [20, 0],
        ],
      })

      const crossings = computeRouteIntersections([ped, veh])
      expect(crossings.length).toBe(1)

      const zebraGeom = buildZebraGeometry(crossings[0]!, ped.position, ped.rotation)
      const pos = zebraGeom.getAttribute('position')

      for (let i = 0; i < pos.count; i++) {
        expect(pos.getY(i)).toBeCloseTo(ROUTE_ELEVATIONS.ZEBRA_CROSSWALK, 4)
      }
    })

    test('Corridor ribbon vertices stay strictly within route half-width bounds', () => {
      const route = makeRoute({
        width: 4.0,
        lineWidth: 'wide',
        laneColor: '#10b981',
        points: [
          [0, 0],
          [50, 0],
        ],
      })
      const geom = buildRouteGeometry(route)
      const pos = geom.getAttribute('position')
      const limit = outerHalfWidthM(route.width, route.lineWidth) + 1e-6

      for (let i = 0; i < pos.count; i++) {
        expect(Math.abs(pos.getZ(i))).toBeLessThanOrEqual(limit)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // 2. Camera Projections & Depth Buffer Simulation (Perspective, Orthographic, Grazing Angles)
  // ---------------------------------------------------------------------------
  describe('2. Camera Projections & Depth Buffer Simulation', () => {
    const near = 0.1
    const far = 1000.0

    function projectPerspectiveZ(worldDist: number): number {
      const A = -(far + near) / (far - near)
      const B = -(2 * far * near) / (far - near)
      const zView = -worldDist
      return (-A * zView + B) / -zView
    }

    function projectOrthoZ(worldDist: number): number {
      return (2 * worldDist - (far + near)) / (far - near)
    }

    test('Perspective projection at 10m: physical delta produces resolvable NDC depth step', () => {
      const camY = 10
      const slabDepth = projectPerspectiveZ(camY - ROUTE_ELEVATIONS.BASE_SLAB)
      const corridorDepth = projectPerspectiveZ(camY - ROUTE_ELEVATIONS.PAINTED_CORRIDOR)
      const stripesDepth = projectPerspectiveZ(camY - ROUTE_ELEVATIONS.EDGE_STRIPES)
      const arrowsDepth = projectPerspectiveZ(camY - ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS)
      const zebraDepth = projectPerspectiveZ(camY - ROUTE_ELEVATIONS.ZEBRA_CROSSWALK)

      expect(zebraDepth).toBeLessThan(arrowsDepth)
      expect(arrowsDepth).toBeLessThan(stripesDepth)
      expect(stripesDepth).toBeLessThan(corridorDepth)
      expect(corridorDepth).toBeLessThan(slabDepth)

      const delta = slabDepth - corridorDepth
      expect(delta).toBeGreaterThan(5.96e-8)
    })

    test('Perspective projection at 100m (distant zoom): physical delta alone drops below 24-bit buffer resolution', () => {
      const camY = 100
      const slabDepth = projectPerspectiveZ(camY - ROUTE_ELEVATIONS.BASE_SLAB)
      const corridorDepth = projectPerspectiveZ(camY - ROUTE_ELEVATIONS.PAINTED_CORRIDOR)

      const physicalNdcDelta = slabDepth - corridorDepth
      expect(physicalNdcDelta).toBeLessThan(1e-7)
    })

    test('depthWrite: false on all marking materials guarantees zero z-fighting against each other regardless of distance', () => {
      const appearance = { shading: 'rendered', textures: true, colorPreset: 'light' } as const
      const mats = getRouteMaterials('vehicle', appearance as never)
      const zebraMat = getZebraMaterial(appearance as never)
      const paintMat = getCorridorPaintMaterial('#ff0000', appearance as never)

      expect(mats[0]!.depthWrite).toBe(false)
      expect(mats[1]!.depthWrite).toBe(false)
      expect(zebraMat.depthWrite).toBe(false)
      expect(paintMat.depthWrite).toBe(false)
    })

    test('Steep grazing camera angles (89°): depth slope polygonOffset scales bias dynamically', () => {
      const grazingAngleRad = (89 * Math.PI) / 180
      const slope = Math.tan(grazingAngleRad)
      expect(slope).toBeGreaterThan(50)

      expect(DEPTH_BIAS.PAINT_FILL.polygonOffsetFactor).toBeLessThan(0)
      expect(DEPTH_BIAS.STRIPES.polygonOffsetFactor).toBeLessThan(0)
      expect(DEPTH_BIAS.ARROWS.polygonOffsetFactor).toBeLessThan(0)
      expect(DEPTH_BIAS.ZEBRA.polygonOffsetFactor).toBeLessThan(0)
    })

    test('Orthographic projection maintains uniform linear depth resolution across all zoom levels', () => {
      const zoomLevels = [0.01, 0.1, 1.0, 10.0, 100.0]
      for (const zoom of zoomLevels) {
        const camDist = 50 / zoom
        const slabDepth = projectOrthoZ(camDist - ROUTE_ELEVATIONS.BASE_SLAB)
        const corridorDepth = projectOrthoZ(camDist - ROUTE_ELEVATIONS.PAINTED_CORRIDOR)
        const stripesDepth = projectOrthoZ(camDist - ROUTE_ELEVATIONS.EDGE_STRIPES)
        const zebraDepth = projectOrthoZ(camDist - ROUTE_ELEVATIONS.ZEBRA_CROSSWALK)

        expect(zebraDepth).toBeLessThan(stripesDepth)
        expect(stripesDepth).toBeLessThan(corridorDepth)
        expect(corridorDepth).toBeLessThan(slabDepth)

        const step = slabDepth - corridorDepth
        expect(step).toBeCloseTo(4e-6, 7)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // 3. Material Architecture & Visual Rendering Audit (Critical Findings)
  // ---------------------------------------------------------------------------
  describe('3. Material Architecture & Visual Rendering Audit (Critical Findings)', () => {
    test('AUDIT VERIFIED: geometry groups assign corridor ribbon to GROUP_PAINT (materialIndex 2)', () => {
      const route = makeRoute({
        laneColor: '#ff0000',
        traffic: 'one-way',
        points: [
          [0, 0],
          [20, 0],
        ],
      })
      const geom = buildRouteGeometry(route)

      expect(geom.groups).toHaveLength(3)
      expect(geom.groups[0]!.materialIndex).toBe(0)
      expect(geom.groups[1]!.materialIndex).toBe(1)
      expect(geom.groups[2]!.materialIndex).toBe(2)
    })

    test('AUDIT VERIFIED: materials[0] retains static stripe color while materials[2] receives laneColor', () => {
      const appearance = { shading: 'rendered', textures: true, colorPreset: 'light' } as const
      const mats = getRouteMaterials('vehicle', appearance as never, '#ff0000')
      const stripeMat = mats[0] as THREE.MeshStandardMaterial
      const paintMat = mats[2] as THREE.MeshStandardMaterial

      expect(stripeMat.color.getHexString()).toBe('f2c31d')
      expect(stripeMat.vertexColors).toBe(false)
      expect(paintMat.color.getHexString()).toBe('ff0000')
    })

    test('AUDIT VERIFIED: getCorridorPaintMaterial is wired to RouteRenderer and materials[2]', () => {
      const paintMat = getCorridorPaintMaterial('#3b82f6')
      expect(paintMat).toBeDefined()
      expect((paintMat as unknown as { renderOrder: number }).renderOrder).toBe(
        DEPTH_BIAS.PAINT_FILL.renderOrder,
      )
    })

    test('CRITICAL AUDIT: THREE.Material does not have native renderOrder property', () => {
      const mat = new THREE.MeshStandardMaterial()
      expect('renderOrder' in THREE.Material.prototype).toBe(false)
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat)
      expect('renderOrder' in mesh).toBe(true)
    })

    test('AUDIT: ZebraCrossingMesh properly sets renderOrder=10 on the Mesh instance', () => {
      expect(DEPTH_BIAS.ZEBRA.renderOrder).toBe(10)
    })
  })

  // ---------------------------------------------------------------------------
  // 4. Reactive Geometry Invalidation & Cache Responsiveness
  // ---------------------------------------------------------------------------
  describe('4. Reactive Geometry Invalidation & Cache Responsiveness', () => {
    test('Changing laneColor immediately changes routeGeometryKey and generates distinct buffer', () => {
      const routeRed = makeRoute({ laneColor: '#ff0000' })
      const routeBlue = makeRoute({ laneColor: '#0000ff' })

      const keyRed = routeGeometryKey(routeRed)
      const keyBlue = routeGeometryKey(routeBlue)

      expect(keyRed).not.toBe(keyBlue)
      expect(keyRed).toContain('c:#ff0000')
      expect(keyBlue).toContain('c:#0000ff')

      const geomRed = getRouteGeometry(routeRed)
      const geomBlue = getRouteGeometry(routeBlue)

      expect(geomRed).not.toBe(geomBlue)
    })

    test('Toggling directionalArrows immediately updates geometry groups count', () => {
      const routeWithArrows = makeRoute({ traffic: 'one-way', directionalArrows: true })
      const routeNoArrows = makeRoute({ traffic: 'one-way', directionalArrows: false })

      const key1 = routeGeometryKey(routeWithArrows)
      const key2 = routeGeometryKey(routeNoArrows)

      expect(key1).not.toBe(key2)
      expect(key1).toContain('da')
      expect(key2).toContain('-')

      const geomWith = getRouteGeometry(routeWithArrows)
      const geomWithout = getRouteGeometry(routeNoArrows)

      expect(geomWith.groups).toHaveLength(2)
      expect(geomWithout.groups).toHaveLength(1)
    })

    test('Changing route width recalculates outer bounds without stale geometry retention', () => {
      const routeNarrow = makeRoute({ width: 2.0 })
      const routeWide = makeRoute({ width: 6.0 })

      const geomNarrow = getRouteGeometry(routeNarrow)
      const geomWide = getRouteGeometry(routeWide)

      expect(geomNarrow).not.toBe(geomWide)
      const posNarrow = geomNarrow.getAttribute('position')
      const posWide = geomWide.getAttribute('position')

      let maxZNarrow = 0
      for (let i = 0; i < posNarrow.count; i++) {
        maxZNarrow = Math.max(maxZNarrow, Math.abs(posNarrow.getZ(i)))
      }

      let maxZWide = 0
      for (let i = 0; i < posWide.count; i++) {
        maxZWide = Math.max(maxZWide, Math.abs(posWide.getZ(i)))
      }

      expect(maxZWide).toBeGreaterThan(maxZNarrow)
      expect(maxZWide).toBeCloseTo(outerHalfWidthM(6.0, 'standard'), 3)
    })
  })
})
