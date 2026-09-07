import * as THREE from 'three'
import { ROUTE_ELEVATIONS } from './constants'
import type { RouteNode } from './schema'

export { ROUTE_ELEVATIONS } from './constants'

export const ZEBRA_BAR_COUNT = 6
export const ZEBRA_BAR_DEPTH_M = 0.34
export const ZEBRA_BAR_GAP_M = 0.34
export const ZEBRA_BAR_PITCH_M = ZEBRA_BAR_DEPTH_M + ZEBRA_BAR_GAP_M // 0.68m
export const ZEBRA_TOTAL_SPAN_M =
  ZEBRA_BAR_COUNT * ZEBRA_BAR_DEPTH_M + (ZEBRA_BAR_COUNT - 1) * ZEBRA_BAR_GAP_M // 3.74m
export const ZEBRA_TOTAL_LENGTH_M = 4.08
export const ZEBRA_ELEVATION_M = ROUTE_ELEVATIONS.ZEBRA_CROSSWALK

export interface ZebraCrossingBar {
  center: [number, number, number]
  size: [number, number] // [width, barDepth (0.34m)]
  points?: Array<[number, number, number]>
}

export interface ZebraCrossingInstance {
  id: string
  position: [number, number, number] // center in world/slab coords
  rotationY: number // aligned with pedestrian route heading Math.atan2(dx, dz)
  width: number // clamped to vehicle route width
  length: number // span of 6 bars (~4.08m / 3.74m)
  bars: ZebraCrossingBar[]
  pedestrianRouteId?: string
  vehicleRouteId?: string
}

export interface SegmentIntersection {
  point: [number, number]
  t: number
  u: number
}

/**
 * Transform route-local 2D points into world/level XZ coordinates.
 */
export function routeWorldPoints(route: RouteNode): Array<[number, number]> {
  const rotY = route.rotation?.[1] ?? 0
  const [posX, , posZ] = route.position ?? [0, 0, 0]
  const cos = Math.cos(rotY)
  const sin = Math.sin(rotY)
  return route.points.map(([lx, lz]) => {
    const wx = posX + lx * cos + lz * sin
    const wz = posZ - lx * sin + lz * cos
    return [wx, wz]
  })
}

/**
 * Calculate 2D line segment intersection on the XZ plane.
 * Returns intersection point and segment parameters t, u in [0, 1].
 */
export function intersectSegments(
  p1: [number, number],
  p2: [number, number],
  q1: [number, number],
  q2: [number, number],
  epsilon = 1e-5,
): SegmentIntersection | null {
  const dx1 = p2[0] - p1[0]
  const dz1 = p2[1] - p1[1]
  const dx2 = q2[0] - q1[0]
  const dz2 = q2[1] - q1[1]

  const det = dx1 * dz2 - dz1 * dx2
  if (Math.abs(det) < 1e-9) {
    return null
  }

  const qp_x = q1[0] - p1[0]
  const qp_z = q1[1] - p1[1]

  const t = (qp_x * dz2 - qp_z * dx2) / det
  const u = (qp_x * dz1 - qp_z * dx1) / det

  if (t >= -epsilon && t <= 1 + epsilon && u >= -epsilon && u <= 1 + epsilon) {
    const clampedT = Math.max(0, Math.min(1, t))
    const clampedU = Math.max(0, Math.min(1, u))
    return {
      point: [p1[0] + clampedT * dx1, p1[1] + clampedT * dz1],
      t: clampedT,
      u: clampedU,
    }
  }

  return null
}

/**
 * Checks if two routes reside on the same level / support slab.
 */
export function areRoutesOnSameLevel(routeA: RouteNode, routeB: RouteNode): boolean {
  if (routeA.parentId && routeB.parentId && routeA.parentId !== routeB.parentId) {
    return false
  }
  if (
    routeA.supportSlabId &&
    routeB.supportSlabId &&
    routeA.supportSlabId !== routeB.supportSlabId
  ) {
    return false
  }
  const elevA = routeA.position?.[1] ?? 0
  const elevB = routeB.position?.[1] ?? 0
  if (Math.abs(elevA - elevB) > 0.1) {
    return false
  }
  return true
}

/**
 * Creates a single ZebraCrossingInstance with 6 bars aligned with the pedestrian route direction.
 */
export function createZebraCrossingInstance(
  id: string,
  intersectionPoint: [number, number],
  pedSegStart: [number, number],
  pedSegEnd: [number, number],
  pedestrianRoute: RouteNode,
  vehicleRoute: RouteNode,
): ZebraCrossingInstance {
  const dx = pedSegEnd[0] - pedSegStart[0]
  const dz = pedSegEnd[1] - pedSegStart[1]

  // Heading aligned with pedestrian walking direction: Math.atan2(dx, dz)
  const rotationY = Math.atan2(dx, dz)

  // Clamped to vehicle route width
  const barWidth = vehicleRoute.width ?? 3.0

  const baseY = Math.max(pedestrianRoute.position?.[1] ?? 0, vehicleRoute.position?.[1] ?? 0)
  const elevation = baseY + ZEBRA_ELEVATION_M

  const [ix, iz] = intersectionPoint
  const position: [number, number, number] = [ix, elevation, iz]

  const bars: ZebraCrossingBar[] = []
  const halfDepth = ZEBRA_BAR_DEPTH_M / 2
  const halfWidth = barWidth / 2

  const sinH = Math.sin(rotationY)
  const cosH = Math.cos(rotationY)
  const nx = cosH
  const nz = -sinH

  for (let b = 0; b < ZEBRA_BAR_COUNT; b++) {
    const offsetDist =
      -ZEBRA_TOTAL_SPAN_M / 2 + b * (ZEBRA_BAR_DEPTH_M + ZEBRA_BAR_GAP_M) + halfDepth
    const bx = ix + sinH * offsetDist
    const bz = iz + cosH * offsetDist
    const center: [number, number, number] = [bx, elevation, bz]

    const points: Array<[number, number, number]> = [
      [bx - sinH * halfDepth + nx * halfWidth, elevation, bz - cosH * halfDepth + nz * halfWidth],
      [bx + sinH * halfDepth + nx * halfWidth, elevation, bz + cosH * halfDepth + nz * halfWidth],
      [bx + sinH * halfDepth - nx * halfWidth, elevation, bz + cosH * halfDepth - nz * halfWidth],
      [bx - sinH * halfDepth - nx * halfWidth, elevation, bz - cosH * halfDepth - nz * halfWidth],
    ]

    bars.push({
      center,
      size: [barWidth, ZEBRA_BAR_DEPTH_M],
      points,
    })
  }

  return {
    id,
    position,
    rotationY,
    width: barWidth,
    length: ZEBRA_TOTAL_SPAN_M,
    bars,
    pedestrianRouteId: pedestrianRoute.id,
    vehicleRouteId: vehicleRoute.id,
  }
}

/**
 * Computes all zebra crossing instances where pedestrian routes cross vehicle routes.
 */
export function computeRouteIntersections(routes: RouteNode[]): ZebraCrossingInstance[] {
  const crossings: ZebraCrossingInstance[] = []
  const pedestrianRoutes = routes.filter((r) => r.role === 'pedestrian')
  const vehicleRoutes = routes.filter((r) => r.role === 'vehicle')

  for (const ped of pedestrianRoutes) {
    if (ped.zebraCrossing === false) continue
    for (const veh of vehicleRoutes) {
      if (veh.zebraCrossing === false) continue
      if (!areRoutesOnSameLevel(ped, veh)) continue

      const pedWorld = routeWorldPoints(ped)
      const vehWorld = routeWorldPoints(veh)
      const pairCrossings: Array<[number, number]> = []

      for (let p = 0; p < pedWorld.length - 1; p++) {
        const p1 = pedWorld[p]!
        const p2 = pedWorld[p + 1]!

        for (let v = 0; v < vehWorld.length - 1; v++) {
          const v1 = vehWorld[v]!
          const v2 = vehWorld[v + 1]!

          const hit = intersectSegments(p1, p2, v1, v2)
          if (hit) {
            const isDuplicate = pairCrossings.some(
              ([cx, cz]) => Math.hypot(cx - hit.point[0], cz - hit.point[1]) < 0.1,
            )
            if (!isDuplicate) {
              pairCrossings.push(hit.point)
              const id = `zebra:${ped.id}:${veh.id}:${p}:${v}`
              crossings.push(createZebraCrossingInstance(id, hit.point, p1, p2, ped, veh))
            }
          }
        }
      }
    }
  }

  return crossings
}

/**
 * Finds zebra crossings specifically for a given route against other routes in scene.
 */
export function findZebraCrossingsForRoute(
  targetRoute: RouteNode,
  allRoutes: RouteNode[],
): ZebraCrossingInstance[] {
  if (targetRoute.zebraCrossing === false) return []
  if (targetRoute.role === 'pedestrian') {
    const vehicles = allRoutes.filter((r) => r.role === 'vehicle' && r.id !== targetRoute.id)
    return computeRouteIntersections([targetRoute, ...vehicles])
  }
  if (targetRoute.role === 'vehicle') {
    const pedestrians = allRoutes.filter((r) => r.role === 'pedestrian' && r.id !== targetRoute.id)
    return computeRouteIntersections([...pedestrians, targetRoute])
  }
  return []
}

/**
 * Generates Three.js BufferGeometry for a ZebraCrossingInstance in node-local or world coordinates.
 */
export function buildZebraGeometry(
  crossing: ZebraCrossingInstance,
  nodePosition: [number, number, number] = [0, 0, 0],
  nodeRotation: [number, number, number] = [0, 0, 0],
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const [nodeX, nodeY = 0, nodeZ] = nodePosition
  const rotY = nodeRotation[1] ?? 0
  const cos = Math.cos(rotY)
  const sin = Math.sin(rotY)

  for (let b = 0; b < crossing.bars.length; b++) {
    const bar = crossing.bars[b]!
    const quad = bar.points!
    const baseIndex = b * 4

    for (let v = 0; v < 4; v++) {
      const [wx, wy = crossing.position[1], wz] = quad[v]!
      const dx = wx - nodeX
      const dz = wz - nodeZ
      const lx = dx * cos - dz * sin
      const lz = dx * sin + dz * cos
      const ly = wy - nodeY

      positions.push(lx, ly, lz)
      normals.push(0, 1, 0)
    }

    uvs.push(0, 0, 1, 0, 1, 1, 0, 1)
    indices.push(baseIndex, baseIndex + 2, baseIndex + 1, baseIndex, baseIndex + 3, baseIndex + 2)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}
