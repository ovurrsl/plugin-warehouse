import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import {
  areRoutesOnSameLevel,
  buildZebraGeometry,
  classifyRouteJunction,
  computeRouteIntersections,
  findRouteIntersections,
  findZebraCrossingsForRoute,
  intersectSegments,
  ROUTE_ELEVATIONS,
  ROUTE_JUNCTION_THRESHOLDS,
  routeWorldPoints,
  solveApproachCuts,
  ZEBRA_BAR_COUNT,
  ZEBRA_BAR_DEPTH_M,
  ZEBRA_BAR_GAP_M,
  ZEBRA_BAR_PITCH_M,
  ZEBRA_ELEVATION_M,
  ZEBRA_TOTAL_SPAN_M,
  type ApproachSpec,
  type RouteJunctionKind,
} from './intersections'
import { cachedZebraMaterial, getZebraMaterial } from './materials'
import { RouteNode } from './schema'

function makeRoute(overrides: Record<string, unknown> = {}): RouteNode {
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

describe('2D Segment Intersection Math', () => {
  test('perpendicular segments crossing at midpoint find exact intersection (5, 5)', () => {
    const p1: [number, number] = [0, 5]
    const p2: [number, number] = [10, 5]
    const q1: [number, number] = [5, 0]
    const q2: [number, number] = [5, 10]

    const hit = intersectSegments(p1, p2, q1, q2)
    expect(hit).not.toBeNull()
    expect(hit!.point[0]).toBeCloseTo(5, 5)
    expect(hit!.point[1]).toBeCloseTo(5, 5)
    expect(hit!.t).toBeCloseTo(0.5, 5)
    expect(hit!.u).toBeCloseTo(0.5, 5)
  })

  test('oblique segments crossing at 45 degrees find accurate intersection', () => {
    const p1: [number, number] = [0, 0]
    const p2: [number, number] = [10, 10]
    const q1: [number, number] = [0, 10]
    const q2: [number, number] = [10, 0]

    const hit = intersectSegments(p1, p2, q1, q2)
    expect(hit).not.toBeNull()
    expect(hit!.point[0]).toBeCloseTo(5, 5)
    expect(hit!.point[1]).toBeCloseTo(5, 5)
  })

  test('parallel segments do not intersect (returns null)', () => {
    const p1: [number, number] = [0, 0]
    const p2: [number, number] = [10, 0]
    const q1: [number, number] = [0, 5]
    const q2: [number, number] = [10, 5]

    expect(intersectSegments(p1, p2, q1, q2)).toBeNull()
  })

  test('collinear segments return null', () => {
    const p1: [number, number] = [0, 0]
    const p2: [number, number] = [10, 0]
    const q1: [number, number] = [5, 0]
    const q2: [number, number] = [15, 0]

    expect(intersectSegments(p1, p2, q1, q2)).toBeNull()
  })

  test('non-parallel segments that do not overlap return null', () => {
    const p1: [number, number] = [0, 0]
    const p2: [number, number] = [2, 2]
    const q1: [number, number] = [10, 0]
    const q2: [number, number] = [10, 5]

    expect(intersectSegments(p1, p2, q1, q2)).toBeNull()
  })

  test('T-junction touching at endpoint (t=1.0) is detected', () => {
    const p1: [number, number] = [0, 5]
    const p2: [number, number] = [5, 5]
    const q1: [number, number] = [5, 0]
    const q2: [number, number] = [5, 10]

    const hit = intersectSegments(p1, p2, q1, q2)
    expect(hit).not.toBeNull()
    expect(hit!.point[0]).toBeCloseTo(5, 3)
    expect(hit!.point[1]).toBeCloseTo(5, 3)
  })
})

describe('Route Transformation to World Coordinates', () => {
  test('unrotated route points match local coordinates offset by position', () => {
    const route = makeRoute({
      position: [10, 0, 20],
      rotation: [0, 0, 0],
      points: [
        [0, 0],
        [5, 10],
      ],
    })
    const world = routeWorldPoints(route)
    expect(world).toEqual([
      [10, 20],
      [15, 30],
    ])
  })

  test('route rotated by 90 degrees transforms XZ correctly', () => {
    const route = makeRoute({
      position: [0, 0, 0],
      rotation: [0, Math.PI / 2, 0],
      points: [
        [0, 0],
        [10, 0],
      ],
    })
    const world = routeWorldPoints(route)
    expect(world[0]).toEqual([0, 0])
    expect(world[1]![0]).toBeCloseTo(0, 3)
    expect(world[1]![1]).toBeCloseTo(-10, 3)
  })
})

describe('Zebra Crossing Generation & Parameters', () => {
  test('perpendicular intersection emits exactly 6 zebra bars', () => {
    const ped = makeRoute({
      role: 'pedestrian',
      points: [
        [5, -10],
        [5, 10],
      ],
      width: 1.2,
    })
    const veh = makeRoute({
      role: 'vehicle',
      points: [
        [0, 0],
        [10, 0],
      ],
      width: 3.2,
    })

    const crossings = computeRouteIntersections([ped, veh])
    expect(crossings).toHaveLength(1)

    const c = crossings[0]!
    expect(c.position[0]).toBeCloseTo(5, 2)
    expect(c.position[2]).toBeCloseTo(0, 2)
    expect(c.position[1]).toBeCloseTo(ZEBRA_ELEVATION_M, 3)
    expect(c.bars).toHaveLength(ZEBRA_BAR_COUNT)
    expect(c.width).toBeCloseTo(3.2, 2)
    expect(c.length).toBeCloseTo(ZEBRA_TOTAL_SPAN_M, 2)
  })

  test('each zebra bar has 0.34m depth and 0.68m center pitch', () => {
    const ped = makeRoute({
      role: 'pedestrian',
      points: [
        [0, 0],
        [0, 20],
      ],
    })
    const veh = makeRoute({
      role: 'vehicle',
      points: [
        [-10, 10],
        [10, 10],
      ],
      width: 4.0,
    })

    const crossings = computeRouteIntersections([ped, veh])
    const c = crossings[0]!

    for (const bar of c.bars) {
      expect(bar.size[0]).toBeCloseTo(4.0, 2)
      expect(bar.size[1]).toBeCloseTo(ZEBRA_BAR_DEPTH_M, 2)
      expect(bar.center[1]).toBeCloseTo(ZEBRA_ELEVATION_M, 3)
      expect(bar.points).toHaveLength(4)
    }

    // Pitch check between consecutive bars
    for (let i = 0; i < c.bars.length - 1; i++) {
      const b1 = c.bars[i]!
      const b2 = c.bars[i + 1]!
      const dist = Math.hypot(b2.center[0] - b1.center[0], b2.center[2] - b1.center[2])
      expect(dist).toBeCloseTo(ZEBRA_BAR_PITCH_M, 2)
    }
  })

  test('crosswalk rotation aligns with pedestrian heading across different angles', () => {
    // Northbound (+Z): dx=0, dz=10 -> heading = 0
    const pedNorth = makeRoute({
      role: 'pedestrian',
      points: [
        [5, 0],
        [5, 10],
      ],
    })
    const veh = makeRoute({
      role: 'vehicle',
      points: [
        [0, 5],
        [10, 5],
      ],
    })
    const cNorth = computeRouteIntersections([pedNorth, veh])[0]!
    expect(cNorth.rotationY).toBeCloseTo(0, 2)

    // Eastbound (+X): dx=10, dz=0 -> heading = Math.PI / 2
    const pedEast = makeRoute({
      role: 'pedestrian',
      points: [
        [0, 5],
        [10, 5],
      ],
    })
    const vehVert = makeRoute({
      role: 'vehicle',
      points: [
        [5, 0],
        [5, 10],
      ],
    })
    const cEast = computeRouteIntersections([pedEast, vehVert])[0]!
    expect(cEast.rotationY).toBeCloseTo(Math.PI / 2, 2)

    // 45 degrees: dx=10, dz=10 -> heading = Math.PI / 4
    const ped45 = makeRoute({
      role: 'pedestrian',
      points: [
        [0, 0],
        [10, 10],
      ],
    })
    const c45 = computeRouteIntersections([ped45, veh])[0]!
    expect(c45.rotationY).toBeCloseTo(Math.PI / 4, 2)
  })

  test('crosswalk width clamps to vehicle route width', () => {
    const ped = makeRoute({
      role: 'pedestrian',
      width: 1.5,
      points: [
        [5, -5],
        [5, 5],
      ],
    })
    const vehNarrow = makeRoute({
      role: 'vehicle',
      width: 2.2,
      points: [
        [0, 0],
        [10, 0],
      ],
    })
    const vehWide = makeRoute({
      role: 'vehicle',
      width: 6.0,
      points: [
        [0, 0],
        [10, 0],
      ],
    })

    expect(computeRouteIntersections([ped, vehNarrow])[0]!.width).toBeCloseTo(2.2, 2)
    expect(computeRouteIntersections([ped, vehWide])[0]!.width).toBeCloseTo(6.0, 2)
  })
})

describe('Suppression & Gating Rules', () => {
  test('zebraCrossing: false on pedestrian route suppresses crosswalk', () => {
    const ped = makeRoute({
      role: 'pedestrian',
      zebraCrossing: false,
      points: [
        [5, -5],
        [5, 5],
      ],
    })
    const veh = makeRoute({
      role: 'vehicle',
      zebraCrossing: true,
      points: [
        [0, 0],
        [10, 0],
      ],
    })

    expect(computeRouteIntersections([ped, veh])).toHaveLength(0)
  })

  test('zebraCrossing: false on vehicle route suppresses crosswalk', () => {
    const ped = makeRoute({
      role: 'pedestrian',
      zebraCrossing: true,
      points: [
        [5, -5],
        [5, 5],
      ],
    })
    const veh = makeRoute({
      role: 'vehicle',
      zebraCrossing: false,
      points: [
        [0, 0],
        [10, 0],
      ],
    })

    expect(computeRouteIntersections([ped, veh])).toHaveLength(0)
  })

  test('same-role routes (pedestrian x pedestrian or vehicle x vehicle) never emit zebra crossings', () => {
    const ped1 = makeRoute({
      role: 'pedestrian',
      points: [
        [5, -5],
        [5, 5],
      ],
    })
    const ped2 = makeRoute({
      role: 'pedestrian',
      points: [
        [0, 0],
        [10, 0],
      ],
    })
    const veh1 = makeRoute({
      role: 'vehicle',
      points: [
        [5, -5],
        [5, 5],
      ],
    })
    const veh2 = makeRoute({
      role: 'vehicle',
      points: [
        [0, 0],
        [10, 0],
      ],
    })

    expect(computeRouteIntersections([ped1, ped2])).toHaveLength(0)
    expect(computeRouteIntersections([veh1, veh2])).toHaveLength(0)
  })

  test('routes on different levels / slabs are rejected', () => {
    const pedSlab1 = makeRoute({
      role: 'pedestrian',
      supportSlabId: 'slab_1',
      points: [
        [5, -5],
        [5, 5],
      ],
    })
    const vehSlab2 = makeRoute({
      role: 'vehicle',
      supportSlabId: 'slab_2',
      points: [
        [0, 0],
        [10, 0],
      ],
    })
    expect(areRoutesOnSameLevel(pedSlab1, vehSlab2)).toBe(false)
    expect(computeRouteIntersections([pedSlab1, vehSlab2])).toHaveLength(0)

    const pedLevelA = makeRoute({
      role: 'pedestrian',
      parentId: 'level_ground',
      points: [
        [5, -5],
        [5, 5],
      ],
    })
    const vehLevelB = makeRoute({
      role: 'vehicle',
      parentId: 'level_mezzanine',
      points: [
        [0, 0],
        [10, 0],
      ],
    })
    expect(areRoutesOnSameLevel(pedLevelA, vehLevelB)).toBe(false)
    expect(computeRouteIntersections([pedLevelA, vehLevelB])).toHaveLength(0)

    const pedElev0 = makeRoute({
      role: 'pedestrian',
      position: [0, 0, 0],
      points: [
        [5, -5],
        [5, 5],
      ],
    })
    const vehElev4m = makeRoute({
      role: 'vehicle',
      position: [0, 4.0, 0],
      points: [
        [0, 0],
        [10, 0],
      ],
    })
    expect(areRoutesOnSameLevel(pedElev0, vehElev4m)).toBe(false)
    expect(computeRouteIntersections([pedElev0, vehElev4m])).toHaveLength(0)
  })
})

describe('findZebraCrossingsForRoute Helper', () => {
  test('finds crosswalks from single pedestrian route perspective', () => {
    const ped = makeRoute({
      id: 'route_ped_main',
      role: 'pedestrian',
      points: [
        [5, -20],
        [5, 20],
      ],
    })
    const veh1 = makeRoute({
      id: 'route_veh_1',
      role: 'vehicle',
      points: [
        [0, -10],
        [10, -10],
      ],
    })
    const veh2 = makeRoute({
      id: 'route_veh_2',
      role: 'vehicle',
      points: [
        [0, 10],
        [10, 10],
      ],
    })

    const crossings = findZebraCrossingsForRoute(ped, [ped, veh1, veh2])
    expect(crossings).toHaveLength(2)
    expect(crossings[0]!.position[2]).toBeCloseTo(-10, 2)
    expect(crossings[1]!.position[2]).toBeCloseTo(10, 2)
  })

  test('returns empty array if targetRoute has zebraCrossing: false', () => {
    const ped = makeRoute({
      role: 'pedestrian',
      zebraCrossing: false,
      points: [
        [5, -5],
        [5, 5],
      ],
    })
    const veh = makeRoute({
      role: 'vehicle',
      points: [
        [0, 0],
        [10, 0],
      ],
    })

    expect(findZebraCrossingsForRoute(ped, [ped, veh])).toHaveLength(0)
  })
})

describe('Three.js BufferGeometry Construction', () => {
  test('buildZebraGeometry creates valid BufferGeometry with 24 vertices and 36 indices', () => {
    const ped = makeRoute({
      role: 'pedestrian',
      points: [
        [5, -5],
        [5, 5],
      ],
    })
    const veh = makeRoute({
      role: 'vehicle',
      points: [
        [0, 0],
        [10, 0],
      ],
      width: 3.5,
    })

    const crossing = computeRouteIntersections([ped, veh])[0]!
    const geometry = buildZebraGeometry(crossing)

    expect(geometry).toBeInstanceOf(THREE.BufferGeometry)

    const posAttr = geometry.getAttribute('position')
    expect(posAttr).toBeDefined()
    expect(posAttr.count).toBe(24) // 6 bars * 4 corners

    const normalAttr = geometry.getAttribute('normal')
    expect(normalAttr).toBeDefined()
    expect(normalAttr.count).toBe(24)

    // Normals face up
    for (let i = 0; i < 24; i++) {
      expect(normalAttr.getY(i)).toBeCloseTo(1.0, 4)
    }

    const index = geometry.getIndex()
    expect(index).not.toBeNull()
    expect(index!.count).toBe(36) // 6 bars * 2 triangles * 3 indices

    // Vertex elevations sit at +0.016m
    for (let i = 0; i < 24; i++) {
      expect(posAttr.getY(i)).toBeCloseTo(ZEBRA_ELEVATION_M, 3)
    }

    geometry.dispose()
  })

  test('buildZebraGeometry correctly transforms into node-local coordinates', () => {
    const ped = makeRoute({
      position: [10, 0, 20],
      rotation: [0, 0, 0],
      role: 'pedestrian',
      points: [
        [5, -5],
        [5, 5],
      ],
    })
    const veh = makeRoute({
      position: [10, 0, 20],
      rotation: [0, 0, 0],
      role: 'vehicle',
      points: [
        [0, 0],
        [10, 0],
      ],
    })

    const crossing = computeRouteIntersections([ped, veh])[0]!
    const localGeom = buildZebraGeometry(crossing, [10, 0, 20], [0, 0, 0])
    const posAttr = localGeom.getAttribute('position')

    // Midpoint of the 6 bars in local space should be [5, 0.016, 0]
    let avgX = 0
    let avgZ = 0
    for (let i = 0; i < 24; i++) {
      avgX += posAttr.getX(i)
      avgZ += posAttr.getZ(i)
    }
    avgX /= 24
    avgZ /= 24

    expect(avgX).toBeCloseTo(5, 2)
    expect(avgZ).toBeCloseTo(0, 2)

    localGeom.dispose()
  })
})

describe('Monotonic Hierarchy Constants Verification', () => {
  test('ROUTE_ELEVATIONS adheres strictly to specification layering', () => {
    expect(ROUTE_ELEVATIONS.SLAB).toBe(0.0)
    expect(ROUTE_ELEVATIONS.RAYCAST).toBe(0.001)
    expect(ROUTE_ELEVATIONS.PAINT_CORRIDOR).toBe(0.002)
    expect(ROUTE_ELEVATIONS.PAINT_FILL).toBe(0.002)
    expect(ROUTE_ELEVATIONS.EDGE_STRIPES).toBe(0.008)
    expect(ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS).toBe(0.012)
    expect(ROUTE_ELEVATIONS.ZEBRA_CROSSWALK).toBe(0.016)
    expect(ROUTE_ELEVATIONS.GRIPS).toBe(0.05)
    expect(ROUTE_ELEVATIONS.SLAB).toBeLessThan(ROUTE_ELEVATIONS.RAYCAST)
    expect(ROUTE_ELEVATIONS.RAYCAST).toBeLessThan(ROUTE_ELEVATIONS.PAINT_CORRIDOR)
    expect(ROUTE_ELEVATIONS.PAINT_CORRIDOR).toBeLessThan(ROUTE_ELEVATIONS.EDGE_STRIPES)
    expect(ROUTE_ELEVATIONS.EDGE_STRIPES).toBeLessThan(ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS)
    expect(ROUTE_ELEVATIONS.DIRECTIONAL_ARROWS).toBeLessThan(ROUTE_ELEVATIONS.ZEBRA_CROSSWALK)
    expect(ROUTE_ELEVATIONS.ZEBRA_CROSSWALK).toBeLessThan(ROUTE_ELEVATIONS.GRIPS)
  })

  test('zebra dimensions constants are correct', () => {
    expect(ZEBRA_BAR_COUNT).toBe(6)
    expect(ZEBRA_BAR_DEPTH_M).toBe(0.34)
    expect(ZEBRA_BAR_GAP_M).toBe(0.34)
    expect(ZEBRA_BAR_PITCH_M).toBe(0.68)
    expect(ZEBRA_TOTAL_SPAN_M).toBe(3.74)
  })
})

describe('Milestone 1 Hardening & Challenger Verification', () => {
  test('zebra geometry triangle winding is counter-clockwise (CCW) with upward geometric face normal', () => {
    const ped = makeRoute({
      role: 'pedestrian',
      points: [
        [5, -5],
        [5, 5],
      ],
    })
    const veh = makeRoute({
      role: 'vehicle',
      points: [
        [0, 0],
        [10, 0],
      ],
    })
    const crossing = computeRouteIntersections([ped, veh])[0]!
    const geom = buildZebraGeometry(crossing)

    const pos = geom.getAttribute('position')
    const index = geom.getIndex()!
    const vA = new THREE.Vector3()
    const vB = new THREE.Vector3()
    const vC = new THREE.Vector3()
    const edge1 = new THREE.Vector3()
    const edge2 = new THREE.Vector3()
    const faceNormal = new THREE.Vector3()

    let upwardFaces = 0
    let downwardFaces = 0
    const triangleCount = index.count / 3

    for (let t = 0; t < triangleCount; t++) {
      vA.fromBufferAttribute(pos, index.getX(t * 3))
      vB.fromBufferAttribute(pos, index.getX(t * 3 + 1))
      vC.fromBufferAttribute(pos, index.getX(t * 3 + 2))
      edge1.subVectors(vB, vA)
      edge2.subVectors(vC, vA)
      faceNormal.crossVectors(edge1, edge2)

      if (faceNormal.y > 0) upwardFaces++
      if (faceNormal.y < 0) downwardFaces++
    }

    expect(upwardFaces).toBe(12)
    expect(downwardFaces).toBe(0)

    // Raycast from above with THREE.FrontSide detects hit
    const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ side: THREE.FrontSide }))
    mesh.updateMatrixWorld(true)
    const rayDown = new THREE.Raycaster(new THREE.Vector3(5, 10, 0.34), new THREE.Vector3(0, -1, 0))
    const hits = rayDown.intersectObject(mesh)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.face!.normal.y).toBeCloseTo(1, 4)

    geom.dispose()
    mesh.geometry.dispose()
  })

  test('deduplicates crossings at shared route vertices / joints (< 0.1m)', () => {
    const pedJoint = makeRoute({
      role: 'pedestrian',
      points: [
        [0, 0],
        [0, 10],
        [0, 20],
      ],
    })
    const vehJoint = makeRoute({
      role: 'vehicle',
      points: [
        [-10, 10],
        [10, 10],
      ],
    })

    const crossings = computeRouteIntersections([pedJoint, vehJoint])
    expect(crossings).toHaveLength(1)
    expect(crossings[0]!.position[0]).toBeCloseTo(0, 2)
    expect(crossings[0]!.position[2]).toBeCloseTo(10, 2)
  })

  test('corner bend joint (90-deg turn) emits exactly one crossing', () => {
    const pedCorner = makeRoute({
      role: 'pedestrian',
      points: [
        [-10, 0],
        [0, 0],
        [0, 10],
      ],
    })
    const vehCross = makeRoute({
      role: 'vehicle',
      points: [
        [-10, -10],
        [10, 10],
      ],
    })

    const crossings = computeRouteIntersections([pedCorner, vehCross])
    expect(crossings).toHaveLength(1)
    expect(crossings[0]!.position[0]).toBeCloseTo(0, 2)
    expect(crossings[0]!.position[2]).toBeCloseTo(0, 2)
  })

  test('zebra crossing elevation accounts for higher route elevation with coplanar ZEBRA_ELEVATION_M', () => {
    const ped = makeRoute({
      role: 'pedestrian',
      position: [0, 0.0, 0],
      points: [
        [0, 5],
        [10, 5],
      ],
    })
    const vehElevated = makeRoute({
      role: 'vehicle',
      position: [0, 0.05, 0], // 5cm higher
      points: [
        [5, 0],
        [5, 10],
      ],
    })

    const crossings = computeRouteIntersections([ped, vehElevated])
    expect(crossings).toHaveLength(1)
    const c = crossings[0]!
    expect(c.position[1]).toBeCloseTo(0.05 + ZEBRA_ELEVATION_M, 4)

    // Verify local geometry elevation accounts for relative node position
    const geom = buildZebraGeometry(c, ped.position, ped.rotation)
    const worldY = ped.position[1] + geom.getAttribute('position').getY(0)
    expect(worldY).toBeCloseTo(0.05 + ZEBRA_ELEVATION_M, 4)
    expect(worldY).toBeGreaterThanOrEqual(vehElevated.position[1])

    geom.dispose()
  })

  test('cached zebra material exports DoubleSide, depthWrite: false, polygonOffsetUnits: -4, renderOrder: 10', () => {
    const mat = getZebraMaterial()
    expect(mat).toBe(cachedZebraMaterial)
    expect(mat.side).toBe(THREE.DoubleSide)
    expect(mat.depthWrite).toBe(false)
    expect(mat.polygonOffset).toBe(true)
    expect(mat.polygonOffsetUnits).toBe(-4)
    expect((mat as unknown as { renderOrder?: number }).renderOrder).toBe(10)
  })
})

describe('Milestone 1: Junction Classification & Approach Cuts Suite', () => {
  describe('classifyRouteJunction - 10 Topological Archetypes', () => {
    test('k=0 emits isolated', () => {
      expect(classifyRouteJunction([])).toBe('isolated')
    })

    test('k=1 emits dead-end', () => {
      expect(classifyRouteJunction([[1, 0]])).toBe('dead-end')
    })

    test('k=2 collinear (180 deg) emits straight', () => {
      expect(
        classifyRouteJunction([
          [1, 0],
          [-1, 0],
        ]),
      ).toBe('straight')
    })

    test('k=2 orthogonal (90 deg) emits bend-l', () => {
      expect(
        classifyRouteJunction([
          [1, 0],
          [0, 1],
        ]),
      ).toBe('bend-l')
    })

    test('k=2 non-orthogonal non-collinear emits bend-v', () => {
      // 45 degrees
      expect(
        classifyRouteJunction([
          [1, 0],
          [Math.SQRT1_2, Math.SQRT1_2],
        ]),
      ).toBe('bend-v')

      // 120 degrees
      expect(
        classifyRouteJunction([
          [1, 0],
          [-0.5, Math.sqrt(3) / 2],
        ]),
      ).toBe('bend-v')
    })

    test('k=3 with widest angle >= 150 deg emits tee', () => {
      // Standard T-junction: straight through along X, branch along +Z (widest is 180 deg)
      expect(
        classifyRouteJunction([
          [1, 0],
          [-1, 0],
          [0, 1],
        ]),
      ).toBe('tee')
    })

    test('k=3 with widest angle < 150 deg emits y', () => {
      // Symmetric Y-junction: 120 deg apart
      const a1 = 0
      const a2 = (2 * Math.PI) / 3
      const a3 = (4 * Math.PI) / 3
      expect(
        classifyRouteJunction([
          [Math.cos(a1), Math.sin(a1)],
          [Math.cos(a2), Math.sin(a2)],
          [Math.cos(a3), Math.sin(a3)],
        ]),
      ).toBe('y')
    })

    test('k=4 mutually orthogonal pairs emit four-way-plus', () => {
      // Standard + cross
      expect(
        classifyRouteJunction([
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]),
      ).toBe('four-way-plus')
    })

    test('k=4 skewed / non-orthogonal emits four-way-x', () => {
      // Skewed X: axes at 45 deg and 135 deg to each other
      const cos30 = Math.cos(Math.PI / 6)
      const sin30 = Math.sin(Math.PI / 6)
      expect(
        classifyRouteJunction([
          [cos30, sin30],
          [-cos30, -sin30],
          [cos30, -sin30],
          [-cos30, sin30],
        ]),
      ).toBe('four-way-x')
    })

    test('k >= 5 emits multi-leg', () => {
      const fiveLegs: Array<[number, number]> = []
      for (let i = 0; i < 5; i++) {
        const theta = (i * 2 * Math.PI) / 5
        fiveLegs.push([Math.cos(theta), Math.sin(theta)])
      }
      expect(classifyRouteJunction(fiveLegs)).toBe('multi-leg')

      const sixLegs: Array<[number, number]> = []
      for (let i = 0; i < 6; i++) {
        const theta = (i * 2 * Math.PI) / 6
        sixLegs.push([Math.cos(theta), Math.sin(theta)])
      }
      expect(classifyRouteJunction(sixLegs)).toBe('multi-leg')
    })
  })

  describe('classifyRouteJunction - Boundary Threshold Verification', () => {
    test('collinear straight boundary at 165 deg (164.9 vs 165.1)', () => {
      const radBelow = (164.9 * Math.PI) / 180
      const radAbove = (165.1 * Math.PI) / 180

      expect(
        classifyRouteJunction([
          [1, 0],
          [Math.cos(radBelow), Math.sin(radBelow)],
        ]),
      ).toBe('bend-v')

      expect(
        classifyRouteJunction([
          [1, 0],
          [Math.cos(radAbove), Math.sin(radAbove)],
        ]),
      ).toBe('straight')
    })

    test('orthogonal bend-l lower boundary at 75 deg (74.9 vs 75.1)', () => {
      const radBelow = (74.9 * Math.PI) / 180
      const radAbove = (75.1 * Math.PI) / 180

      expect(
        classifyRouteJunction([
          [1, 0],
          [Math.cos(radBelow), Math.sin(radBelow)],
        ]),
      ).toBe('bend-v')

      expect(
        classifyRouteJunction([
          [1, 0],
          [Math.cos(radAbove), Math.sin(radAbove)],
        ]),
      ).toBe('bend-l')
    })

    test('orthogonal bend-l upper boundary at 105 deg (104.9 vs 105.1)', () => {
      const radBelow = (104.9 * Math.PI) / 180
      const radAbove = (105.1 * Math.PI) / 180

      expect(
        classifyRouteJunction([
          [1, 0],
          [Math.cos(radBelow), Math.sin(radBelow)],
        ]),
      ).toBe('bend-l')

      expect(
        classifyRouteJunction([
          [1, 0],
          [Math.cos(radAbove), Math.sin(radAbove)],
        ]),
      ).toBe('bend-v')
    })

    test('tee vs y boundary at 150 deg (149.9 vs 150.1)', () => {
      const radBelow = (149.9 * Math.PI) / 180
      const radAbove = (150.1 * Math.PI) / 180

      // 3 legs: [1, 0], [cos(theta), sin(theta)], and a third bisector leg
      expect(
        classifyRouteJunction([
          [1, 0],
          [Math.cos(radBelow), Math.sin(radBelow)],
          [Math.cos(radBelow / 2), Math.sin(radBelow / 2)],
        ]),
      ).toBe('y')

      expect(
        classifyRouteJunction([
          [1, 0],
          [Math.cos(radAbove), Math.sin(radAbove)],
          [Math.cos(radAbove / 2), Math.sin(radAbove / 2)],
        ]),
      ).toBe('tee')
    })
  })

  describe('solveApproachCuts - Fillets & Corridor Trimming Math', () => {
    test('empty approaches returns empty record', () => {
      expect(solveApproachCuts([])).toEqual({})
    })

    test('single approach returns cut equal to halfWidth', () => {
      const cuts = solveApproachCuts([{ id: 'r1', angle: 0, halfWidth: 1.0 }])
      expect(cuts['r1']).toBe(1.0)
    })

    test('two orthogonal approaches compute symmetric cutback >= halfWidth', () => {
      const approaches: ApproachSpec[] = [
        { id: 'app1', angle: 0, halfWidth: 1.0 },
        { id: 'app2', angle: Math.PI / 2, halfWidth: 1.0 },
      ]
      const cuts = solveApproachCuts(approaches, 2.0)
      expect(cuts['app1']).toBeDefined()
      expect(cuts['app2']).toBeDefined()
      expect(cuts['app1']).toBeGreaterThanOrEqual(1.0)
      expect(cuts['app2']).toBeGreaterThanOrEqual(1.0)
      expect(cuts['app1']).toBeCloseTo(cuts['app2']!, 4)
    })

    test('tee junction calculates valid positive cuts for all 3 corridors', () => {
      const approaches: ApproachSpec[] = [
        { id: 'east', angle: 0, halfWidth: 0.8 },
        { id: 'west', angle: Math.PI, halfWidth: 0.8 },
        { id: 'north', angle: Math.PI / 2, halfWidth: 1.2 },
      ]
      const cuts = solveApproachCuts(approaches, 1.5)
      expect(cuts['east']).toBeGreaterThanOrEqual(0.8)
      expect(cuts['west']).toBeGreaterThanOrEqual(0.8)
      expect(cuts['north']).toBeGreaterThanOrEqual(1.2)
      expect(Number.isFinite(cuts['east'])).toBe(true)
      expect(Number.isFinite(cuts['west'])).toBe(true)
      expect(Number.isFinite(cuts['north'])).toBe(true)
    })
  })

  describe('findRouteIntersections API Compatibility & Overloads', () => {
    test('supports array of routes overload', () => {
      const ped = makeRoute({
        role: 'pedestrian',
        points: [
          [0, 5],
          [10, 5],
        ],
      })
      const veh = makeRoute({
        role: 'vehicle',
        points: [
          [5, 0],
          [5, 10],
        ],
      })
      const results = findRouteIntersections([ped, veh])
      expect(results).toHaveLength(1)
      expect(results[0]!.pedestrianRouteId).toBe(ped.id)
      expect(results[0]!.vehicleRouteId).toBe(veh.id)
      expect(results[0]!.junctionKind).toBeDefined()
    })

    test('supports two-route overload findRouteIntersections(routeA, routeB)', () => {
      const ped = makeRoute({
        role: 'pedestrian',
        points: [
          [0, 5],
          [10, 5],
        ],
      })
      const veh = makeRoute({
        role: 'vehicle',
        points: [
          [5, 0],
          [5, 10],
        ],
      })
      const results = findRouteIntersections(ped, veh)
      expect(results).toHaveLength(1)
      expect(results[0]!.pedestrianRouteId).toBe(ped.id)
      expect(results[0]!.vehicleRouteId).toBe(veh.id)
    })
  })
})
