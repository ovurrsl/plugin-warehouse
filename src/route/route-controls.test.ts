import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'
import { MAX_VERTICES, ROUTE_ELEVATIONS } from './constants'
import { routeDefinition } from './definition'
import RouteControls, {
  appendControlPoint,
  COLLINEAR_SNAP_THRESHOLD_M,
  calculatePolylineLength,
  deleteControlPoint,
  getRouteMidpoint,
  getRouteMidpoints,
  insertControlPoint,
  localToWorldXZ,
  MIN_SEGMENT_LENGTH_M,
  RouteControls as NamedRouteControls,
  ORTHOGONAL_SNAP_THRESHOLD_M,
  prependControlPoint,
  reverseRouteDirection,
  shiftControlPoint,
  snapCollinear,
  snapOrthogonal,
  withRouteVertexAppended,
  withRouteVertexInserted,
  withRouteVertexMoved,
  withRouteVertexPrepended,
  withRouteVertexRemoved,
  worldToLocalXZ,
} from './route-controls'
import { RouteNode } from './schema'
import type { Point } from './stripes'

describe('Route Controls: Milestone 3 Unit Tests', () => {
  describe('1. Polyline Handle Counts & Midpoint Calculations', () => {
    it('emits exact N vertex points and N - 1 midpoints for varying route lengths', () => {
      // 2 points -> 1 midpoint
      const pts2: Point[] = [
        [0, 0],
        [10, 0],
      ]
      const mids2 = getRouteMidpoints(pts2)
      expect(pts2.length).toBe(2)
      expect(mids2.length).toBe(1)
      expect(mids2[0]).toEqual([5, 0])

      // 3 points -> 2 midpoints
      const pts3: Point[] = [
        [0, 0],
        [10, 0],
        [10, 15],
      ]
      const mids3 = getRouteMidpoints(pts3)
      expect(pts3.length).toBe(3)
      expect(mids3.length).toBe(2)
      expect(mids3[0]).toEqual([5, 0])
      expect(mids3[1]).toEqual([10, 7.5])

      // 5 points -> 4 midpoints
      const pts5: Point[] = [
        [0, 0],
        [2, 4],
        [6, 8],
        [10, 8],
        [12, 10],
      ]
      const mids5 = getRouteMidpoints(pts5)
      expect(mids5.length).toBe(4)

      // Maximum capacity boundary: 64 points -> 63 midpoints
      const pts64: Point[] = Array.from({ length: MAX_VERTICES }, (_, i) => [i, i * 2])
      const mids64 = getRouteMidpoints(pts64)
      expect(pts64.length).toBe(64)
      expect(mids64.length).toBe(63)
    })

    it('calculates exact arithmetic mean across negative, diagonal, and fractional coordinates', () => {
      // Negative coordinates
      const p1: Point = [-10.5, -20.25]
      const p2: Point = [-4.5, 10.75]
      const mid = getRouteMidpoint(p1, p2)
      expect(mid[0]).toBeCloseTo(-7.5, 6)
      expect(mid[1]).toBeCloseTo(-4.75, 6)

      // Sub-centimetre fractional coordinates
      const p3: Point = [0.1234, 0.5678]
      const p4: Point = [0.8766, 0.4322]
      const midFrac = getRouteMidpoint(p3, p4)
      expect(midFrac[0]).toBeCloseTo(0.5, 6)
      expect(midFrac[1]).toBeCloseTo(0.5, 6)

      // Degenerate polyline with < 2 points returns empty midpoint array
      expect(getRouteMidpoints([])).toEqual([])
      expect(getRouteMidpoints([[0, 0]])).toEqual([])
    })
  })

  describe('2. Vertex Translation & Neighbor Boundary Constraints', () => {
    it('shifts start, intermediate, and end vertices while strictly preserving other vertices', () => {
      const original: Point[] = [
        [0, 0],
        [5, 0],
        [10, 5],
        [10, 15],
      ]

      // Shift start vertex index 0
      const movedStart = withRouteVertexMoved(original, 0, [-2, 1])
      expect(movedStart).not.toBeNull()
      expect(movedStart![0]).toEqual([-2, 1])
      expect(movedStart!.slice(1)).toEqual(original.slice(1))

      // Shift intermediate vertex index 1
      const movedMid = withRouteVertexMoved(original, 1, [5, -3])
      expect(movedMid).not.toBeNull()
      expect(movedMid![1]).toEqual([5, -3])
      expect(movedMid![0]).toEqual(original[0])
      expect(movedMid!.slice(2)).toEqual(original.slice(2))

      // Shift end vertex index 3
      const movedEnd = withRouteVertexMoved(original, 3, [12, 18])
      expect(movedEnd).not.toBeNull()
      expect(movedEnd![3]).toEqual([12, 18])
      expect(movedEnd!.slice(0, 3)).toEqual(original.slice(0, 3))
    })

    it('enforces minimum segment length (minDist = 0.05m) to prevent coincident degenerate vertices', () => {
      expect(MIN_SEGMENT_LENGTH_M).toBe(0.05)
      const pts: Point[] = [
        [0, 0],
        [5, 0],
        [10, 0],
      ]

      // Moving index 1 to within 0.02m of index 0 (< 0.05m) must be rejected
      const tooCloseToPrev = withRouteVertexMoved(pts, 1, [0.02, 0])
      expect(tooCloseToPrev).toBeNull()

      // Moving index 1 to within 0.03m of index 2 (< 0.05m) must be rejected
      const tooCloseToSucc = withRouteVertexMoved(pts, 1, [9.98, 0])
      expect(tooCloseToSucc).toBeNull()

      // Moving index 1 to distance >= 0.05m succeeds
      const validMove = withRouteVertexMoved(pts, 1, [0.06, 0])
      expect(validMove).not.toBeNull()
    })

    it('rejects out-of-bounds vertex index gracefully', () => {
      const pts: Point[] = [
        [0, 0],
        [5, 0],
      ]
      expect(withRouteVertexMoved(pts, -1, [1, 1])).toBeNull()
      expect(withRouteVertexMoved(pts, 2, [1, 1])).toBeNull()
      expect(withRouteVertexMoved(pts, 99, [1, 1])).toBeNull()
    })

    it('high-level shiftControlPoint updates route and throws RangeError on invalid index', () => {
      const route = RouteNode.parse({
        id: 'route_test_1',
        type: 'warehouse:route',
        points: [
          [0, 0],
          [5, 0],
          [5, 5],
        ],
      })

      const shifted = shiftControlPoint(route, 1, [6, 2])
      expect(shifted.points[1]).toEqual([6, 2])
      expect(shifted.points[0]).toEqual([0, 0])
      expect(shifted.points[2]).toEqual([5, 5])

      expect(() => shiftControlPoint(route, -1, [0, 0])).toThrow(RangeError)
      expect(() => shiftControlPoint(route, 3, [0, 0])).toThrow(RangeError)
    })
  })

  describe('3. Midpoint Insertion & Capacity Boundary', () => {
    it('inserts midpoint at index segmentIndex + 1 with array length increment', () => {
      const original: Point[] = [
        [0, 0],
        [10, 0],
      ]

      // Default midpoint insertion on segment 0
      const inserted = withRouteVertexInserted(original, 0)
      expect(inserted).not.toBeNull()
      expect(inserted!.length).toBe(3)
      expect(inserted![0]).toEqual([0, 0])
      expect(inserted![1]).toEqual([5, 0]) // [ (0+10)/2, (0+0)/2 ]
      expect(inserted![2]).toEqual([10, 0])

      // Custom coordinate insertion on segment 1 of 3-point polyline
      const customInsert = withRouteVertexInserted(inserted!, 1, [7.5, 3])
      expect(customInsert).not.toBeNull()
      expect(customInsert!.length).toBe(4)
      expect(customInsert![2]).toEqual([7.5, 3])
      expect(customInsert![3]).toEqual([10, 0])
    })

    it('rejects invalid segment indices', () => {
      const pts: Point[] = [
        [0, 0],
        [5, 0],
        [10, 0],
      ]
      expect(withRouteVertexInserted(pts, -1)).toBeNull()
      expect(withRouteVertexInserted(pts, 2)).toBeNull() // max segmentIndex is 1 for 3 points
      expect(withRouteVertexInserted(pts, 10)).toBeNull()
    })

    it('strictly enforces MAX_VERTICES (64) capacity boundary', () => {
      // Create polyline of exactly 64 vertices
      const atCapacity: Point[] = Array.from({ length: MAX_VERTICES }, (_, i) => [i, 0])
      expect(atCapacity.length).toBe(64)

      // Insertion must be rejected when already at MAX_VERTICES
      const rejected = withRouteVertexInserted(atCapacity, 0)
      expect(rejected).toBeNull()

      // 63 vertices allows 1 insertion reaching 64
      const at63: Point[] = Array.from({ length: MAX_VERTICES - 1 }, (_, i) => [i, 0])
      const allowed = withRouteVertexInserted(at63, 0)
      expect(allowed).not.toBeNull()
      expect(allowed!.length).toBe(64)
    })

    it('high-level insertControlPoint integrates with RouteNode and validates segments', () => {
      const route = RouteNode.parse({
        id: 'route_test_insert',
        type: 'warehouse:route',
        points: [
          [0, 0],
          [8, 0],
        ],
      })

      const updated = insertControlPoint(route, 0)
      expect(updated.points.length).toBe(3)
      expect(updated.points[1]).toEqual([4, 0])

      expect(() => insertControlPoint(route, -1)).toThrow(RangeError)
      expect(() => insertControlPoint(route, 1)).toThrow(RangeError)
    })
  })

  describe('4. Vertex Deletion & Minimum Length >= 2 Invariant', () => {
    it('deletes vertex from N=3 polyline leaving valid N=2 polyline', () => {
      const pts3: Point[] = [
        [0, 0],
        [5, 5],
        [10, 0],
      ]
      const removedMid = withRouteVertexRemoved(pts3, 1)
      expect(removedMid).not.toBeNull()
      expect(removedMid!.length).toBe(2)
      expect(removedMid![0]).toEqual([0, 0])
      expect(removedMid![1]).toEqual([10, 0])

      // Deleting start vertex index 0
      const removedStart = withRouteVertexRemoved(pts3, 0)
      expect(removedStart).not.toBeNull()
      expect(removedStart!).toEqual([
        [5, 5],
        [10, 0],
      ])

      // Deleting end vertex index 2
      const removedEnd = withRouteVertexRemoved(pts3, 2)
      expect(removedEnd).not.toBeNull()
      expect(removedEnd!).toEqual([
        [0, 0],
        [5, 5],
      ])
    })

    it('strictly prevents deletion when polyline length is <= 2 (minimum schema requirement)', () => {
      const pts2: Point[] = [
        [0, 0],
        [5, 0],
      ]
      // Removing from 2 points must return null
      expect(withRouteVertexRemoved(pts2, 0)).toBeNull()
      expect(withRouteVertexRemoved(pts2, 1)).toBeNull()

      const route2 = RouteNode.parse({
        id: 'route_test_2',
        type: 'warehouse:route',
        points: pts2,
      })
      expect(() => deleteControlPoint(route2, 0)).toThrow(
        'Cannot delete point: route requires a minimum of 2 vertices',
      )
    })

    it('rejects out of bounds deletion index', () => {
      const pts3: Point[] = [
        [0, 0],
        [5, 0],
        [10, 0],
      ]
      expect(withRouteVertexRemoved(pts3, -1)).toBeNull()
      expect(withRouteVertexRemoved(pts3, 3)).toBeNull()
    })
  })

  describe('5. Collinear & Orthogonal Snapping Logic', () => {
    it('snaps candidate within collinear threshold (15cm) to neighbor chord line', () => {
      const prev: Point = [0, 0]
      const next: Point = [10, 0]

      // Point at (5, 0.10) is 10cm from chord line y=0 (< 15cm threshold) -> snaps to (5, 0)
      const candidateInside: Point = [5, 0.1]
      const snapped = snapCollinear(prev, next, candidateInside, COLLINEAR_SNAP_THRESHOLD_M)
      expect(snapped[0]).toBeCloseTo(5, 6)
      expect(snapped[1]).toBeCloseTo(0, 6)

      // Point at (5, 0.25) is 25cm from chord line (> 15cm threshold) -> remains unchanged
      const candidateOutside: Point = [5, 0.25]
      const notSnapped = snapCollinear(prev, next, candidateOutside, COLLINEAR_SNAP_THRESHOLD_M)
      expect(notSnapped).toEqual(candidateOutside)

      // Point outside segment projection bounds (t < 0 or t > len) -> remains unchanged
      const pastEnd: Point = [12, 0.05]
      expect(snapCollinear(prev, next, pastEnd, COLLINEAR_SNAP_THRESHOLD_M)).toEqual(pastEnd)
      const beforeStart: Point = [-2, 0.05]
      expect(snapCollinear(prev, next, beforeStart, COLLINEAR_SNAP_THRESHOLD_M)).toEqual(
        beforeStart,
      )
    })

    it('snaps candidate within orthogonal threshold (10cm) to Manhattan axes', () => {
      const anchor: Point = [4, 6]

      // Within 8cm of anchor X coordinate (dx=0.08 <= 0.10)
      const nearX: Point = [4.08, 12]
      const snappedX = snapOrthogonal(anchor, nearX, ORTHOGONAL_SNAP_THRESHOLD_M)
      expect(snappedX[0]).toBe(4)
      expect(snappedX[1]).toBe(12)

      // Within 7cm of anchor Z coordinate (dz=0.07 <= 0.10)
      const nearZ: Point = [9, 6.07]
      const snappedZ = snapOrthogonal(anchor, nearZ, ORTHOGONAL_SNAP_THRESHOLD_M)
      expect(snappedZ[0]).toBe(9)
      expect(snappedZ[1]).toBe(6)

      // Beyond threshold (15cm) -> no snap
      const far: Point = [4.15, 6.15]
      const noSnap = snapOrthogonal(anchor, far, ORTHOGONAL_SNAP_THRESHOLD_M)
      expect(noSnap).toEqual(far)
    })

    it('withRouteVertexMoved applies collinear snapping automatically for intermediate vertices', () => {
      const pts: Point[] = [
        [0, 0],
        [5, 2],
        [10, 0],
      ]
      // Move vertex 1 near chord line (at [5, 0.08]) -> snaps to [5, 0]
      const moved = withRouteVertexMoved(pts, 1, [5, 0.08])
      expect(moved).not.toBeNull()
      expect(moved![1][0]).toBeCloseTo(5, 5)
      expect(moved![1][1]).toBeCloseTo(0, 5)
    })
  })

  describe('6. Coordinate Transformations (localToWorldXZ & worldToLocalXZ)', () => {
    it('converts between node-local and world coordinates with translation and rotation', () => {
      const nodePos: [number, number, number] = [10, 0, 20]
      const rotationY = Math.PI / 2 // 90 degrees yaw

      const local: Point = [5, 2]
      const world = localToWorldXZ(local, nodePos, rotationY)

      // For 90 deg rotation: wx = 10 + 5*cos(90) + 2*sin(90) = 10 + 2 = 12
      // wz = 20 - 5*sin(90) + 2*cos(90) = 20 - 5 = 15
      expect(world[0]).toBeCloseTo(12, 6)
      expect(world[1]).toBeCloseTo(15, 6)

      // World to local inverse
      const reconstructed = worldToLocalXZ(world, nodePos, rotationY)
      expect(reconstructed[0]).toBeCloseTo(local[0], 6)
      expect(reconstructed[1]).toBeCloseTo(local[1], 6)
    })

    it('guarantees round-trip fidelity across arbitrary transformations', () => {
      const nodePos: [number, number, number] = [-15.7, 0.5, 42.3]
      const rotationY = 1.234 // arbitrary radians
      const arbitraryLocal: Point = [-7.89, 14.21]

      const world = localToWorldXZ(arbitraryLocal, nodePos, rotationY)
      const localBack = worldToLocalXZ(world, nodePos, rotationY)
      expect(localBack[0]).toBeCloseTo(arbitraryLocal[0], 9)
      expect(localBack[1]).toBeCloseTo(arbitraryLocal[1], 9)
    })

    it('calculates total polyline length accurately', () => {
      const pts: Point[] = [
        [0, 0],
        [3, 4], // length 5
        [3, 10], // length 6
      ]
      expect(calculatePolylineLength(pts)).toBeCloseTo(11, 6)
    })
  })

  describe('7. Store Integration Contracts & History Lifecycle', () => {
    it('useLiveNodeOverrides set, get, and clear contracts function correctly', () => {
      const testNodeId = 'route_mock_live_override_1'
      const testPoints: Point[] = [
        [0, 0],
        [8, 2],
        [16, 0],
      ]

      // Initially empty
      expect(useLiveNodeOverrides.getState().get(testNodeId)).toBeUndefined()

      // Set live override during drag
      useLiveNodeOverrides.getState().set(testNodeId, { points: testPoints })
      const retrieved = useLiveNodeOverrides.getState().get(testNodeId)
      expect(retrieved).toBeDefined()
      expect(retrieved?.points).toEqual(testPoints)

      // Clear on commit / cancel
      useLiveNodeOverrides.getState().clear(testNodeId)
      expect(useLiveNodeOverrides.getState().get(testNodeId)).toBeUndefined()
    })

    it('useScene temporal pause and resume contracts operate as expected', () => {
      // Verify temporal methods exist and can be called safely
      const temporalState = useScene.temporal?.getState()
      if (temporalState) {
        expect(typeof temporalState.pause).toBe('function')
        expect(typeof temporalState.resume).toBe('function')

        // Execute pause and resume sequence without errors
        temporalState.pause()
        temporalState.resume()
      }
    })
  })

  describe('8. Affordance Registration in definition.ts', () => {
    it('registers affordanceTools.selection in routeDefinition', async () => {
      expect(routeDefinition.kind).toBe('warehouse:route')
      expect(routeDefinition.affordanceTools).toBeDefined()
      expect(typeof routeDefinition.affordanceTools?.selection).toBe('function')

      // Load affordance module
      const module = await routeDefinition.affordanceTools!.selection()
      expect(module).toBeDefined()
      expect(typeof module.default).toBe('function')
      expect(typeof module.RouteControls).toBe('function')
    })
  })

  describe('9. Static Source Architecture & Visual Hierarchy Contract', () => {
    it('verifies elevation and styling token invariants in route-controls.tsx source', () => {
      const controlsFilePath = resolve(import.meta.dir, 'route-controls.tsx')
      const source = readFileSync(controlsFilePath, 'utf8')

      // 1. Monotonic elevation requirement
      expect(ROUTE_ELEVATIONS.CONTROLS_GRIPS).toBe(0.05)
      expect(source).toContain('ROUTE_ELEVATIONS.CONTROLS_GRIPS')

      // 2. Editor layer assignment
      expect(EDITOR_LAYER).toBeDefined()
      expect(source).toContain('layers={EDITOR_LAYER}')

      // 3. Exact handle color tokens
      expect(source).toContain('#22c55e') // default vertex green
      expect(source).toContain('#4ade80') // hover vertex green
      expect(source).toContain('#86efac') // selected vertex mint
      expect(source).toContain('#14532d') // outline dark green
      expect(source).toContain('#8fb5d9') // midpoint handle
      expect(source).toContain('#ffffff') // hover midpoint / cross

      // 4. Handle geometry specifications
      expect(source).toContain('sphereGeometry args={[0.22, 16, 12]}') // vertex sphere
      expect(source).toContain('torusGeometry args={[0.245, 0.035, 8, 28]}') // outline ring
      expect(source).toContain('boxGeometry args={[0.6, 0.12, 0.6]}') // pick box
      expect(source).toContain('sphereGeometry args={[0.14, 14, 10]}') // midpoint sphere

      // 5. Plane raycast drag surface
      expect(source).toContain('planeGeometry args={[2000, 2000]}')
      expect(source).toContain('visible={false}')

      // 6. Keyboard deletion on Delete / Backspace
      expect(source).toContain("event.key !== 'Delete' && event.key !== 'Backspace'")
      expect(source).toContain('withRouteVertexRemoved')

      // 7. SFX trigger calls
      expect(source).toContain("triggerSFX('sfx:item-pick')")
      expect(source).toContain("triggerSFX('sfx:item-place')")
      expect(source).toContain("triggerSFX('sfx:item-delete')")
    })

    it('verifies renderer.tsx integrates useLiveNodeOverrides and RouteControls fallback', () => {
      const rendererFilePath = resolve(import.meta.dir, 'renderer.tsx')
      const source = readFileSync(rendererFilePath, 'utf8')

      expect(source).toContain('useLiveNodeOverrides')
      expect(source).toContain('RouteControls')
      expect(source).toContain('{isSelected && <RouteControls node={effectiveNode} />}')
    })

    it('exports RouteControls as both default and named export', () => {
      expect(typeof RouteControls).toBe('function')
      expect(typeof NamedRouteControls).toBe('function')
      expect(RouteControls).toBe(NamedRouteControls)
    })
  })

  describe('10. Route Extension, Prepending, Appending & Reversing', () => {
    it('appends a vertex along end tangent or at custom coordinates', () => {
      const pts: Point[] = [
        [0, 0],
        [10, 0],
      ]
      const appended = withRouteVertexAppended(pts)
      expect(appended).not.toBeNull()
      expect(appended!.length).toBe(3)
      expect(appended![2]).toEqual([12, 0])

      const customAppended = withRouteVertexAppended(pts, [15, 5])
      expect(customAppended).not.toBeNull()
      expect(customAppended!.length).toBe(3)
      expect(customAppended![2]).toEqual([15, 5])
    })

    it('prepends a vertex along start tangent backwards or at custom coordinates', () => {
      const pts: Point[] = [
        [10, 0],
        [20, 0],
      ]
      const prepended = withRouteVertexPrepended(pts)
      expect(prepended).not.toBeNull()
      expect(prepended!.length).toBe(3)
      expect(prepended![0]).toEqual([8, 0])

      const customPrepended = withRouteVertexPrepended(pts, [5, -5])
      expect(customPrepended).not.toBeNull()
      expect(customPrepended!.length).toBe(3)
      expect(customPrepended![0]).toEqual([5, -5])
    })

    it('reverses route polyline direction atomically', () => {
      const route = RouteNode.parse({
        id: 'route_reverse_test',
        type: 'warehouse:route',
        points: [
          [0, 0],
          [5, 5],
          [10, 0],
        ],
      })
      const reversed = reverseRouteDirection(route)
      expect(reversed.points).toEqual([
        [10, 0],
        [5, 5],
        [0, 0],
      ])
    })

    it('high-level appendControlPoint and prependControlPoint validate capacity boundary (MAX_VERTICES)', () => {
      const route = RouteNode.parse({
        id: 'route_ext_test',
        type: 'warehouse:route',
        points: [
          [0, 0],
          [10, 0],
        ],
      })
      const appended = appendControlPoint(route)
      expect(appended.points.length).toBe(3)

      const prepended = prependControlPoint(route)
      expect(prepended.points.length).toBe(3)

      // At max vertices (64), append/prepend throws
      const at64Points: Point[] = Array.from({ length: 64 }, (_, i) => [i, 0])
      const at64Route = RouteNode.parse({
        id: 'route_at_64',
        type: 'warehouse:route',
        points: at64Points,
      })
      expect(() => appendControlPoint(at64Route)).toThrow()
      expect(() => prependControlPoint(at64Route)).toThrow()
    })
  })
})
