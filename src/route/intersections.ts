import * as THREE from 'three'
import { ROUTE_ELEVATIONS, ROUTE_JUNCTION_THRESHOLDS } from './constants'
import type { RouteNode } from './schema'

export { ROUTE_ELEVATIONS, ROUTE_JUNCTION_THRESHOLDS } from './constants'

export const ZEBRA_BAR_COUNT = 6
export const ZEBRA_BAR_DEPTH_M = 0.34
export const ZEBRA_BAR_GAP_M = 0.34
export const ZEBRA_BAR_PITCH_M = ZEBRA_BAR_DEPTH_M + ZEBRA_BAR_GAP_M // 0.68m
export const ZEBRA_TOTAL_SPAN_M =
  ZEBRA_BAR_COUNT * ZEBRA_BAR_DEPTH_M + (ZEBRA_BAR_COUNT - 1) * ZEBRA_BAR_GAP_M // 3.74m
export const ZEBRA_TOTAL_LENGTH_M = 4.08
export const ZEBRA_ELEVATION_M = ROUTE_ELEVATIONS.ZEBRA_CROSSWALK

/**
 * The 10 discrete topological route junction archetypes.
 */
export type RouteJunctionKind =
  | 'isolated'
  | 'dead-end'
  | 'straight'
  | 'bend-l'
  | 'bend-v'
  | 'tee'
  | 'y'
  | 'four-way-plus'
  | 'four-way-x'
  | 'multi-leg'

/**
 * Specification for a corridor approaching a junction node.
 */
export interface ApproachSpec {
  id: string
  angle: number // heading in radians from junction center
  halfWidth: number
}

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
  junctionKind?: RouteJunctionKind
  approachCuts?: Record<string, number>
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
 * Calculates the smallest angle (radians) between two 2D vectors.
 */
export function angleBetweenVectors2D(
  v1: readonly [number, number] | [number, number],
  v2: readonly [number, number] | [number, number],
): number {
  const m1 = Math.hypot(v1[0], v1[1])
  const m2 = Math.hypot(v2[0], v2[1])
  if (m1 < 1e-9 || m2 < 1e-9) return 0
  const dot = (v1[0] * v2[0] + v1[1] * v2[1]) / (m1 * m2)
  const clamped = Math.max(-1, Math.min(1, dot))
  return Math.acos(clamped)
}

/**
 * Classifies a junction into one of 10 discrete topological archetypes:
 * - isolated: 0 incident legs
 * - dead-end: 1 incident leg
 * - straight: 2 legs collinear (>= 165 deg)
 * - bend-l: 2 legs orthogonal (75..105 deg)
 * - bend-v: 2 legs acute/obtuse non-orthogonal
 * - tee: 3 legs with a through-pair (>= 150 deg)
 * - y: 3 legs without a through-pair (< 150 deg)
 * - four-way-plus: 4 legs with 2 straight through-pairs (>= 165 deg) and orthogonal axes (75..105 deg)
 * - four-way-x: 4 legs without orthogonal through-axes
 * - multi-leg: >= 5 legs
 *
 * @param incidentDirections Vectors directed AWAY from the junction center [dx, dz]
 */
export function classifyRouteJunction(
  incidentDirections: Array<readonly [number, number]> | Array<[number, number]>,
): RouteJunctionKind {
  const k = incidentDirections.length
  if (k === 0) return 'isolated'
  if (k === 1) return 'dead-end'
  if (k >= 5) return 'multi-leg'

  const pairs: Array<{ a: number; b: number; angleRad: number; angleDeg: number }> = []
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      const angleRad = angleBetweenVectors2D(incidentDirections[a]!, incidentDirections[b]!)
      pairs.push({
        a,
        b,
        angleRad,
        angleDeg: (angleRad * 180.0) / Math.PI,
      })
    }
  }

  pairs.sort((p1, p2) => p2.angleRad - p1.angleRad)
  const widestDeg = pairs[0]?.angleDeg ?? 0

  if (k === 2) {
    if (widestDeg >= ROUTE_JUNCTION_THRESHOLDS.STRAIGHT_MIN_DEG) {
      return 'straight'
    }
    if (
      widestDeg >= ROUTE_JUNCTION_THRESHOLDS.ORTHOGONAL_MIN_DEG &&
      widestDeg <= ROUTE_JUNCTION_THRESHOLDS.ORTHOGONAL_MAX_DEG
    ) {
      return 'bend-l'
    }
    return 'bend-v'
  }

  if (k === 3) {
    return widestDeg >= ROUTE_JUNCTION_THRESHOLDS.TEE_MIN_DEG ? 'tee' : 'y'
  }

  // k === 4: Plus (+) vs X-crossing
  const first = pairs[0]!
  const remaining = [0, 1, 2, 3].filter((idx) => idx !== first.a && idx !== first.b)
  const secondAngleRad = angleBetweenVectors2D(
    incidentDirections[remaining[0]!]!,
    incidentDirections[remaining[1]!]!,
  )
  const secondAngleDeg = (secondAngleRad * 180.0) / Math.PI

  if (
    first.angleDeg < ROUTE_JUNCTION_THRESHOLDS.STRAIGHT_MIN_DEG ||
    secondAngleDeg < ROUTE_JUNCTION_THRESHOLDS.STRAIGHT_MIN_DEG
  ) {
    return 'four-way-x'
  }

  const axisAngleRad = angleBetweenVectors2D(
    incidentDirections[first.a]!,
    incidentDirections[remaining[0]!]!,
  )
  const acuteAxisAngleRad = Math.min(axisAngleRad, Math.PI - axisAngleRad)
  const acuteAxisDeg = (acuteAxisAngleRad * 180.0) / Math.PI

  return acuteAxisDeg >= ROUTE_JUNCTION_THRESHOLDS.ORTHOGONAL_MIN_DEG &&
    acuteAxisDeg <= ROUTE_JUNCTION_THRESHOLDS.ORTHOGONAL_MAX_DEG
    ? 'four-way-plus'
    : 'four-way-x'
}

/**
 * Solves approach cutbacks (metres) for arriving route corridors at a junction.
 * Calculates corner fillets and setbacks to prevent corridor overlapping meshes beneath crossings.
 */
export function solveApproachCuts(
  approaches: ApproachSpec[],
  requestedRadius = 3.0,
): Record<string, number> {
  const cuts: Record<string, number> = {}
  const n = approaches.length
  if (n === 0) return cuts
  if (n === 1) {
    cuts[approaches[0]!.id] = approaches[0]!.halfWidth
    return cuts
  }

  if (n === 2) {
    const angle = angleBetweenVectors2D(
      [Math.cos(approaches[0]!.angle), Math.sin(approaches[0]!.angle)],
      [Math.cos(approaches[1]!.angle), Math.sin(approaches[1]!.angle)],
    )
    const halfAngle = angle / 2
    const sinHalf = Math.max(0.2, Math.sin(halfAngle))
    for (const app of approaches) {
      cuts[app.id] = Math.max(app.halfWidth, Math.min(app.halfWidth * 3, app.halfWidth / sinHalf))
    }
    return cuts
  }

  const sorted = [...approaches].sort((a, b) => a.angle - b.angle)
  const cornerDistances: Array<{ fromDist: number; toDist: number }> = []

  for (let i = 0; i < n; i++) {
    const from = sorted[i]!
    const to = sorted[(i + 1) % n]!
    let gap = to.angle - from.angle
    while (gap < 0) gap += 2 * Math.PI

    const fromDir = [Math.cos(from.angle), Math.sin(from.angle)] as const
    const toDir = [Math.cos(to.angle), Math.sin(to.angle)] as const
    const fromLeft = [-fromDir[1], fromDir[0]] as const
    const toLeft = [-toDir[1], toDir[0]] as const
    const fallback = Math.max(from.halfWidth, to.halfWidth, requestedRadius, 0.5)

    if (gap >= Math.PI - 1e-4) {
      cornerDistances.push({ fromDist: fallback, toDist: fallback })
      continue
    }

    const p1 = [
      fromLeft[0] * (from.halfWidth + requestedRadius),
      fromLeft[1] * (from.halfWidth + requestedRadius),
    ] as const
    const p2 = [
      -toLeft[0] * (to.halfWidth + requestedRadius),
      -toLeft[1] * (to.halfWidth + requestedRadius),
    ] as const

    const denom = fromDir[0] * toDir[1] - fromDir[1] * toDir[0]
    if (Math.abs(denom) < 1e-6) {
      cornerDistances.push({ fromDist: fallback, toDist: fallback })
      continue
    }

    const dx = p2[0] - p1[0]
    const dz = p2[1] - p1[1]
    const t1 = (dx * toDir[1] - dz * toDir[0]) / denom
    const t2 = (dx * fromDir[1] - dz * fromDir[0]) / denom

    if (t1 < 0 || t2 < 0) {
      cornerDistances.push({ fromDist: fallback, toDist: fallback })
    } else {
      cornerDistances.push({
        fromDist: Math.min(t1, from.halfWidth * 4),
        toDist: Math.min(t2, to.halfWidth * 4),
      })
    }
  }

  for (let i = 0; i < n; i++) {
    const app = sorted[i]!
    const prevCorner = cornerDistances[(i - 1 + n) % n]!
    const nextCorner = cornerDistances[i]!
    cuts[app.id] = Math.max(app.halfWidth, prevCorner.toDist, nextCorner.fromDist)
  }

  return cuts
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
  vehSegStart?: [number, number],
  vehSegEnd?: [number, number],
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

  // Approaches and junction topological classification
  const approaches: ApproachSpec[] = []
  const incidentDirs: Array<[number, number]> = []

  // Pedestrian entry & exit
  approaches.push({
    id: `${pedestrianRoute.id}:in`,
    angle: Math.atan2(-dx, -dz),
    halfWidth: (pedestrianRoute.width ?? 1.2) / 2,
  })
  approaches.push({
    id: `${pedestrianRoute.id}:out`,
    angle: Math.atan2(dx, dz),
    halfWidth: (pedestrianRoute.width ?? 1.2) / 2,
  })
  incidentDirs.push([-dx, -dz], [dx, dz])

  if (vehSegStart && vehSegEnd) {
    const vdx = vehSegEnd[0] - vehSegStart[0]
    const vdz = vehSegEnd[1] - vehSegStart[1]
    approaches.push({
      id: `${vehicleRoute.id}:in`,
      angle: Math.atan2(-vdx, -vdz),
      halfWidth: (vehicleRoute.width ?? 3.0) / 2,
    })
    approaches.push({
      id: `${vehicleRoute.id}:out`,
      angle: Math.atan2(vdx, vdz),
      halfWidth: (vehicleRoute.width ?? 3.0) / 2,
    })
    incidentDirs.push([-vdx, -vdz], [vdx, vdz])
  }

  const junctionKind = classifyRouteJunction(incidentDirs)
  const approachCuts = solveApproachCuts(approaches)

  return {
    id,
    position,
    rotationY,
    width: barWidth,
    length: ZEBRA_TOTAL_SPAN_M,
    bars,
    pedestrianRouteId: pedestrianRoute.id,
    vehicleRouteId: vehicleRoute.id,
    junctionKind,
    approachCuts,
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
              crossings.push(createZebraCrossingInstance(id, hit.point, p1, p2, ped, veh, v1, v2))
            }
          }
        }
      }
    }
  }

  return crossings
}

/**
 * Detects intersections between warehouse routes and returns enriched zebra crossing instances.
 * Backward-compatible helper that supports passing an array of routes or two individual routes.
 */
export function findRouteIntersections(routes: RouteNode[]): ZebraCrossingInstance[]
export function findRouteIntersections(
  routeA: RouteNode,
  routeB: RouteNode,
): ZebraCrossingInstance[]
export function findRouteIntersections(
  arg1: RouteNode[] | RouteNode,
  arg2?: RouteNode,
): ZebraCrossingInstance[] {
  if (Array.isArray(arg1)) {
    return computeRouteIntersections(arg1)
  }
  if (arg2) {
    return computeRouteIntersections([arg1, arg2])
  }
  return []
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
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
