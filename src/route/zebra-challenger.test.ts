import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { buildZebraGeometry, computeRouteIntersections, ZEBRA_ELEVATION_M } from './intersections'
import type { RouteNode } from './schema'

function makeRoute(
  id: string,
  role: 'pedestrian' | 'vehicle',
  points: Array<[number, number]>,
  opts: Partial<RouteNode> = {},
): RouteNode {
  return {
    id,
    type: 'warehouse:route',
    role,
    points,
    width: opts.width ?? 3.0,
    lineWidth: opts.lineWidth ?? 0.1,
    position: opts.position ?? [0, 0, 0],
    rotation: opts.rotation ?? [0, 0, 0],
    scale: [1, 1, 1],
    zebraCrossing: opts.zebraCrossing ?? true,
    ...opts,
  } as RouteNode
}

describe('Challenger M1: Three.js BufferGeometry Construction', () => {
  const pedRoute = makeRoute('ped-1', 'pedestrian', [
    [0, -10],
    [0, 10],
  ])
  const vehRoute = makeRoute('veh-1', 'vehicle', [
    [-10, 0],
    [10, 0],
  ])

  test('valid BufferGeometry construction with position, normal, uv, index attributes', () => {
    const crossings = computeRouteIntersections([pedRoute, vehRoute])
    expect(crossings.length).toBe(1)
    const crossing = crossings[0]!

    const geom = buildZebraGeometry(crossing, [0, 0, 0], [0, 0, 0])
    expect(geom).toBeInstanceOf(THREE.BufferGeometry)

    // Position attribute verification
    const posAttr = geom.getAttribute('position')
    expect(posAttr).toBeDefined()
    expect(posAttr.itemSize).toBe(3)
    expect(posAttr.count).toBe(24) // 6 bars * 4 vertices
    expect(posAttr.array.length).toBe(72)

    // Verify no NaNs or Infs in positions
    for (let i = 0; i < posAttr.array.length; i++) {
      const val = posAttr.array[i]!
      expect(Number.isFinite(val)).toBe(true)
      expect(Number.isNaN(val)).toBe(false)
    }

    // Normal attribute verification
    const normAttr = geom.getAttribute('normal')
    expect(normAttr).toBeDefined()
    expect(normAttr.itemSize).toBe(3)
    expect(normAttr.count).toBe(24)
    expect(normAttr.array.length).toBe(72)

    // Verify normals point strictly upwards [0, 1, 0]
    for (let i = 0; i < normAttr.count; i++) {
      const nx = normAttr.getX(i)
      const ny = normAttr.getY(i)
      const nz = normAttr.getZ(i)
      expect(nx).toBeCloseTo(0, 5)
      expect(ny).toBeCloseTo(1, 5)
      expect(nz).toBeCloseTo(0, 5)
    }

    // Index attribute verification
    const indexAttr = geom.getIndex()
    expect(indexAttr).not.toBeNull()
    expect(indexAttr!.count).toBe(36) // 6 bars * 2 triangles * 3 indices
    expect(indexAttr!.count % 3).toBe(0)

    // Verify all indices reference valid vertices
    for (let i = 0; i < indexAttr!.count; i++) {
      const idx = indexAttr!.getX(i)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(posAttr.count)
    }

    // UV attribute verification
    const uvAttr = geom.getAttribute('uv')
    expect(uvAttr).toBeDefined()
    expect(uvAttr.itemSize).toBe(2)
    expect(uvAttr.count).toBe(24)

    // Compute bounds without error
    geom.computeBoundingBox()
    geom.computeBoundingSphere()
    expect(geom.boundingBox).not.toBeNull()
    expect(geom.boundingSphere).not.toBeNull()
    expect(geom.boundingBox!.min.y).toBeCloseTo(ZEBRA_ELEVATION_M, 4)
    expect(geom.boundingBox!.max.y).toBeCloseTo(ZEBRA_ELEVATION_M, 4)

    geom.dispose()
  })

  test('triangle winding direction and face normal analysis', () => {
    const crossings = computeRouteIntersections([pedRoute, vehRoute])
    const crossing = crossings[0]!
    const geom = buildZebraGeometry(crossing, [0, 0, 0], [0, 0, 0])

    const pos = geom.getAttribute('position')
    const index = geom.getIndex()!

    const vA = new THREE.Vector3()
    const vB = new THREE.Vector3()
    const vC = new THREE.Vector3()
    const edge1 = new THREE.Vector3()
    const edge2 = new THREE.Vector3()
    const faceNormal = new THREE.Vector3()

    let upwardFacingTriangles = 0
    let downwardFacingTriangles = 0

    const triangleCount = index.count / 3
    for (let t = 0; t < triangleCount; t++) {
      const iA = index.getX(t * 3)
      const iB = index.getX(t * 3 + 1)
      const iC = index.getX(t * 3 + 2)

      vA.fromBufferAttribute(pos, iA)
      vB.fromBufferAttribute(pos, iB)
      vC.fromBufferAttribute(pos, iC)

      edge1.subVectors(vB, vA)
      edge2.subVectors(vC, vA)
      faceNormal.crossVectors(edge1, edge2)

      if (faceNormal.y > 0) {
        upwardFacingTriangles++
      } else if (faceNormal.y < 0) {
        downwardFacingTriangles++
      }
    }

    console.log(
      `[Winding Test] Upward faces: ${upwardFacingTriangles}, Downward faces: ${downwardFacingTriangles}`,
    )
    expect(upwardFacingTriangles).toBe(12)
    expect(downwardFacingTriangles).toBe(0)
    geom.dispose()
  })

  test('raycast from above with default FrontSide material', () => {
    const crossings = computeRouteIntersections([pedRoute, vehRoute])
    const crossing = crossings[0]!
    const geom = buildZebraGeometry(crossing, [0, 0, 0], [0, 0, 0])

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      depthWrite: false,
    }) // default material side is THREE.FrontSide
    const mesh = new THREE.Mesh(geom, material)

    // Bar 3 center is at z = 0.34m (z = 0 is the gap between bar 2 and 3)
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 10, 0.34),
      new THREE.Vector3(0, -1, 0),
    )
    const hitsFront = raycaster.intersectObject(mesh)

    // Now test with DoubleSide
    material.side = THREE.DoubleSide
    const hitsDouble = raycaster.intersectObject(mesh)

    console.log(
      `[Raycast Test] Hits with FrontSide: ${hitsFront.length}, Hits with DoubleSide: ${hitsDouble.length}`,
    )
    expect(hitsFront.length).toBeGreaterThan(0)
    expect(hitsDouble.length).toBeGreaterThan(0)

    geom.dispose()
    material.dispose()
  })
})

describe('Challenger M1: Memory Disposal & Leaks on Unmount', () => {
  test('BufferGeometry dispatches dispose event on dispose()', () => {
    const pedRoute = makeRoute('ped-1', 'pedestrian', [
      [0, -10],
      [0, 10],
    ])
    const vehRoute = makeRoute('veh-1', 'vehicle', [
      [-10, 0],
      [10, 0],
    ])
    const crossing = computeRouteIntersections([pedRoute, vehRoute])[0]!

    const geom = buildZebraGeometry(crossing)
    let disposeFired = false
    geom.addEventListener('dispose', () => {
      disposeFired = true
    })

    geom.dispose()
    expect(disposeFired).toBe(true)
  })

  test('Simulate 1,000 mount/unmount cycles without geometry leaks', () => {
    const pedRoute = makeRoute('ped-1', 'pedestrian', [
      [0, -10],
      [0, 10],
    ])
    const vehRoute = makeRoute('veh-1', 'vehicle', [
      [-10, 0],
      [10, 0],
    ])
    const crossing = computeRouteIntersections([pedRoute, vehRoute])[0]!

    // Track active geometries
    const activeGeometries = new Set<THREE.BufferGeometry>()

    for (let i = 0; i < 1000; i++) {
      const geom = buildZebraGeometry(crossing)
      activeGeometries.add(geom)

      // Simulate unmount cleanup effect:
      geom.addEventListener('dispose', () => {
        activeGeometries.delete(geom)
      })
      geom.dispose()
    }

    expect(activeGeometries.size).toBe(0)
  })
})

describe('Challenger M1: High-Density Scene Stress Testing (100x100 routes)', () => {
  test('100x100 intersecting routes performance benchmark', () => {
    // Generate 100 horizontal vehicle routes (Y = 0 to 99, along X from -10 to 110)
    // and 100 vertical pedestrian routes (X = 0 to 99, along Y from -10 to 110)
    // Each pair intersects exactly once -> 10,000 total intersections.
    const vehicleRoutes: RouteNode[] = []
    const pedestrianRoutes: RouteNode[] = []

    for (let v = 0; v < 100; v++) {
      vehicleRoutes.push(
        makeRoute(
          `veh-${v}`,
          'vehicle',
          [
            [-10, v],
            [110, v],
          ],
          { width: 3.0 },
        ),
      )
    }

    for (let p = 0; p < 100; p++) {
      pedestrianRoutes.push(
        makeRoute(
          `ped-${p}`,
          'pedestrian',
          [
            [p, -10],
            [p, 110],
          ],
          { width: 2.0 },
        ),
      )
    }

    const allRoutes = [...pedestrianRoutes, ...vehicleRoutes]
    expect(allRoutes.length).toBe(200)

    // Benchmark computeRouteIntersections
    const startCompute = performance.now()
    const crossings = computeRouteIntersections(allRoutes)
    const computeDurationMs = performance.now() - startCompute

    console.log(
      `[100x100 Benchmark] computeRouteIntersections found ${crossings.length} crossings in ${computeDurationMs.toFixed(2)}ms`,
    )

    expect(crossings.length).toBe(10000)

    // Check execution time requirement (< 50ms)
    // Note: We record actual compute duration
    console.log(`[Execution Time] Target: < 50ms, Actual: ${computeDurationMs.toFixed(2)}ms`)

    // Benchmark geometry generation for a sample of 100 crossings
    const startGeomSample = performance.now()
    for (let i = 0; i < 100; i++) {
      const g = buildZebraGeometry(crossings[i]!)
      g.dispose()
    }
    const geomSampleDurationMs = performance.now() - startGeomSample
    console.log(
      `[Geometry Benchmark] 100 geometries built & disposed in ${geomSampleDurationMs.toFixed(2)}ms (${(geomSampleDurationMs / 100).toFixed(3)}ms/geom)`,
    )
  })

  test('multi-segment vertex joint intersection: duplicate crossing check', () => {
    // Pedestrian route with 2 segments meeting at (0, 10)
    const pedRoute = makeRoute('ped-joint', 'pedestrian', [
      [0, 0],
      [0, 10],
      [0, 20],
    ])
    // Vehicle route crossing directly through the joint at y = 10
    const vehRoute = makeRoute('veh-joint', 'vehicle', [
      [-10, 10],
      [10, 10],
    ])

    const crossings = computeRouteIntersections([pedRoute, vehRoute])
    console.log(`[Joint Test] Crossings emitted at vertex joint: ${crossings.length}`)
    for (const c of crossings) {
      console.log(
        `  Crossing: id=${c.id}, position=${JSON.stringify(c.position)}, rotation=${c.rotationY}`,
      )
    }
    // DEDUPLICATION VERIFIED: Seg 0 (t=1.0) and Seg 1 (t=0.0) deduplicate to exactly 1 crossing
    expect(crossings.length).toBe(1)
  })

  test('corner bend joint (90-deg turn): overlapping crisscrossing zebra bars bug', () => {
    // Pedestrian route turns 90 degrees at (0, 0): [-10, 0] -> [0, 0] -> [0, 10]
    const pedRoute = makeRoute('ped-corner', 'pedestrian', [
      [-10, 0],
      [0, 0],
      [0, 10],
    ])
    // Vehicle route crossing through (0, 0) diagonally or transversely
    const vehRoute = makeRoute('veh-cross', 'vehicle', [
      [-10, -10],
      [10, 10],
    ])

    const crossings = computeRouteIntersections([pedRoute, vehRoute])
    console.log(`[Corner Bend Test] Crossings emitted at corner joint: ${crossings.length}`)
    for (const c of crossings) {
      console.log(
        `  Crossing: id=${c.id}, rotY=${c.rotationY.toFixed(3)}, pos=${JSON.stringify(c.position)}`,
      )
    }
    // DEDUPLICATION VERIFIED: Emits exactly 1 crossing at corner joint
    expect(crossings.length).toBe(1)
  })
})
