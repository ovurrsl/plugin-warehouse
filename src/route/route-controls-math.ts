import { MAX_VERTICES } from './constants'
import { RouteNode } from './schema'
import type { Point } from './stripes'

export const MIN_SEGMENT_LENGTH_M = 0.05
export const COLLINEAR_SNAP_THRESHOLD_M = 0.15
export const ORTHOGONAL_SNAP_THRESHOLD_M = 0.1

/**
 * Calculates the arithmetic mean midpoint between two 2D points on the XZ floor plane.
 */
export function getRouteMidpoint(p1: Point, p2: Point): Point {
  return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]
}

/**
 * Emits all N - 1 midpoints for an ordered polyline of N points.
 */
export function getRouteMidpoints(points: readonly Point[]): Point[] {
  if (points.length < 2) return []
  const midpoints: Point[] = []
  for (let i = 0; i < points.length - 1; i++) {
    midpoints.push(getRouteMidpoint(points[i]!, points[i + 1]!))
  }
  return midpoints
}

/**
 * Snaps candidate point to the collinear chord line between pPrev and pNext
 * if the perpendicular distance is within the threshold and the projection
 * lies strictly between the two endpoints.
 */
export function snapCollinear(
  pPrev: Point,
  pNext: Point,
  candidate: Point,
  threshold = COLLINEAR_SNAP_THRESHOLD_M,
): Point {
  const vx = pNext[0] - pPrev[0]
  const vz = pNext[1] - pPrev[1]
  const lenSq = vx * vx + vz * vz
  if (lenSq < 1e-8) return candidate

  const len = Math.sqrt(lenSq)
  const ux = vx / len
  const uz = vz / len

  const wx = candidate[0] - pPrev[0]
  const wz = candidate[1] - pPrev[1]

  const t = wx * ux + wz * uz
  // Must project strictly onto the segment interior
  if (t < 0 || t > len) return candidate

  const qx = pPrev[0] + t * ux
  const qz = pPrev[1] + t * uz

  const distSq = (candidate[0] - qx) ** 2 + (candidate[1] - qz) ** 2
  if (distSq <= threshold * threshold) {
    return [qx, qz]
  }
  return candidate
}

/**
 * Snaps candidate coordinate to orthogonal axes (0, 90, 180, 270 degrees)
 * relative to an anchor point if within threshold.
 */
export function snapOrthogonal(
  anchor: Point,
  candidate: Point,
  threshold = ORTHOGONAL_SNAP_THRESHOLD_M,
): Point {
  const dx = Math.abs(candidate[0] - anchor[0])
  const dz = Math.abs(candidate[1] - anchor[1])
  let resX = candidate[0]
  let resZ = candidate[1]

  // Only snap X to anchor (vertical leg) if there is separation along Z
  if (dx <= threshold && dz >= MIN_SEGMENT_LENGTH_M) resX = anchor[0]
  // Only snap Z to anchor (horizontal leg) if there is separation along X
  if (dz <= threshold && dx >= MIN_SEGMENT_LENGTH_M) resZ = anchor[1]

  return [resX, resZ]
}

/**
 * Converts node-local [lx, lz] coordinates to world-space [wx, wz] coordinates.
 */
export function localToWorldXZ(
  local: Point,
  nodePosition: readonly [number, number, number],
  rotationY = 0,
): [number, number] {
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  return [
    nodePosition[0] + local[0] * cos + local[1] * sin,
    nodePosition[2] - local[0] * sin + local[1] * cos,
  ]
}

/**
 * Converts world-space [wx, wz] coordinates to node-local [lx, lz] coordinates.
 */
export function worldToLocalXZ(
  world: readonly [number, number],
  nodePosition: readonly [number, number, number],
  rotationY = 0,
): Point {
  const dx = world[0] - nodePosition[0]
  const dz = world[1] - nodePosition[2]
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  return [dx * cos - dz * sin, dx * sin + dz * cos]
}

/**
 * Moves a vertex at `index` to coordinate `next`, checking boundaries,
 * verifying minimum distance against immediate neighbors (>= minDist),
 * and applying collinear and orthogonal snapping.
 */
export function withRouteVertexMoved(
  points: readonly Point[],
  index: number,
  next: Point,
  minDist = MIN_SEGMENT_LENGTH_M,
): Point[] | null {
  if (index < 0 || index >= points.length) return null

  let snapped = next

  // Intermediate vertices snap to collinear chord between neighbors
  if (index > 0 && index < points.length - 1) {
    snapped = snapCollinear(points[index - 1]!, points[index + 1]!, snapped)
  }

  // Orthogonal snapping relative to neighbors (applied if not collapsing)
  if (index > 0) {
    snapped = snapOrthogonal(points[index - 1]!, snapped)
  }
  if (index < points.length - 1) {
    snapped = snapOrthogonal(points[index + 1]!, snapped)
  }

  // Degeneracy guard: neighbor distances must be >= minDist
  if (index > 0) {
    const prev = points[index - 1]!
    if (Math.hypot(snapped[0] - prev[0], snapped[1] - prev[1]) < minDist) {
      return null
    }
  }
  if (index < points.length - 1) {
    const succ = points[index + 1]!
    if (Math.hypot(snapped[0] - succ[0], snapped[1] - succ[1]) < minDist) {
      return null
    }
  }

  return points.map((p, i) => (i === index ? snapped : [p[0], p[1]]))
}

/**
 * Inserts a vertex along segment `segmentIndex` (inserted vertex lands at index `segmentIndex + 1`).
 * Rejects insertion if array length is already at or above MAX_VERTICES (64).
 */
export function withRouteVertexInserted(
  points: readonly Point[],
  segmentIndex: number,
  point?: Point,
): Point[] | null {
  if (points.length >= MAX_VERTICES) return null
  if (segmentIndex < 0 || segmentIndex >= points.length - 1) return null

  const p1 = points[segmentIndex]!
  const p2 = points[segmentIndex + 1]!
  const insertPt: Point = point ?? getRouteMidpoint(p1, p2)

  return [...points.slice(0, segmentIndex + 1), insertPt, ...points.slice(segmentIndex + 1)]
}

/**
 * Removes a vertex at `index`. Strictly preserves the minimum length >= 2 invariant.
 * Returns null if points.length <= 2 or index is out of bounds.
 */
export function withRouteVertexRemoved(points: readonly Point[], index: number): Point[] | null {
  if (points.length <= 2) return null
  if (index < 0 || index >= points.length) return null

  return points.filter((_, i) => i !== index)
}

/**
 * High-level helper to shift a control point on a RouteNode, returning a new parsed RouteNode.
 * Throws RangeError on out-of-bounds index.
 */
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

/**
 * High-level helper to insert a control point into a RouteNode at segmentIndex + 1.
 * Throws RangeError on invalid segment index.
 */
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

/**
 * High-level helper to delete a control point from a RouteNode.
 * Throws Error if route length is <= 2, or RangeError on out-of-bounds index.
 */
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

/**
 * Calculates total polyline length in metres.
 */
export function calculatePolylineLength(points: readonly Point[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    len += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return len
}
