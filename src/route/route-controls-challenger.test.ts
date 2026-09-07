import { describe, expect, it } from 'bun:test'
import { useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { MAX_VERTICES } from './constants'
import {
  COLLINEAR_SNAP_THRESHOLD_M,
  calculatePolylineLength,
  deleteControlPoint,
  getRouteMidpoint,
  getRouteMidpoints,
  insertControlPoint,
  localToWorldXZ,
  MIN_SEGMENT_LENGTH_M,
  ORTHOGONAL_SNAP_THRESHOLD_M,
  shiftControlPoint,
  snapCollinear,
  snapOrthogonal,
  withRouteVertexInserted,
  withRouteVertexMoved,
  withRouteVertexRemoved,
  worldToLocalXZ,
} from './route-controls'
import { RouteNode } from './schema'
import type { Point } from './stripes'

describe('Route Controls Challenger: Adversarial Stress Tests', () => {
  describe('1. Extreme Coordinates & Numerical Stability', () => {
    it('handles astronomical and massive coordinates without overflow or NaN', () => {
      const hugeA: Point = [1e8, 2e8]
      const hugeB: Point = [-3e8, 4e8]

      const mid = getRouteMidpoint(hugeA, hugeB)
      expect(Number.isFinite(mid[0])).toBe(true)
      expect(Number.isFinite(mid[1])).toBe(true)
      expect(mid[0]).toBeCloseTo(-1e8, 0)
      expect(mid[1]).toBeCloseTo(3e8, 0)

      const length = calculatePolylineLength([hugeA, hugeB])
      expect(Number.isFinite(length)).toBe(true)
      expect(length).toBeGreaterThan(4e8)

      // Test extreme translation in withRouteVertexMoved
      const pts: Point[] = [
        [0, 0],
        [100, 0],
        [200, 0],
      ]
      const moved = withRouteVertexMoved(pts, 1, [1e7, 1e7])
      expect(moved).not.toBeNull()
      expect(moved![1]).toEqual([1e7, 1e7])
      expect(Number.isFinite(moved![1][0])).toBe(true)
      expect(Number.isFinite(moved![1][1])).toBe(true)

      // High-level shiftControlPoint with massive coordinates
      const route = RouteNode.parse({
        id: 'route_huge_coords',
        type: 'warehouse:route',
        points: pts,
      })
      const shifted = shiftControlPoint(route, 1, [1e8, 1e8])
      expect(shifted.points[1]).toEqual([1e8, 1e8])
    })

    it('handles coordinates across all 4 negative quadrants with precision', () => {
      const q1: Point = [123.456, 789.012]
      const q2: Point = [-123.456, 789.012]
      const q3: Point = [-123.456, -789.012]
      const q4: Point = [123.456, -789.012]

      const poly = [q1, q2, q3, q4]
      const mids = getRouteMidpoints(poly)
      expect(mids.length).toBe(3)

      expect(mids[0][0]).toBeCloseTo(0, 9)
      expect(mids[0][1]).toBeCloseTo(789.012, 9)

      expect(mids[1][0]).toBeCloseTo(-123.456, 9)
      expect(mids[1][1]).toBeCloseTo(0, 9)

      expect(mids[2][0]).toBeCloseTo(0, 9)
      expect(mids[2][1]).toBeCloseTo(-789.012, 9)
    })

    it('handles sub-millimeter offsets and microscopic boundary increments', () => {
      const p1: Point = [0, 0]
      const p2: Point = [0.0001, 0.0002] // 0.1mm - 0.2mm

      const mid = getRouteMidpoint(p1, p2)
      expect(mid[0]).toBeCloseTo(0.00005, 9)
      expect(mid[1]).toBeCloseTo(0.0001, 9)

      // Testing boundary around MIN_SEGMENT_LENGTH_M (0.05m = 50mm)
      expect(MIN_SEGMENT_LENGTH_M).toBe(0.05)
      const base: Point[] = [
        [0, 0],
        [1, 0],
        [2, 0],
      ]

      // Candidate at 0.0499m (49.9mm) from index 0 -> below 50mm, must be rejected
      const tooClose49mm = withRouteVertexMoved(base, 1, [0.0499, 0])
      expect(tooClose49mm).toBeNull()

      // Candidate at 0.0501m (50.1mm) from index 0 -> above 50mm, must succeed
      const allowed50mm = withRouteVertexMoved(base, 1, [0.0501, 0])
      expect(allowed50mm).not.toBeNull()
      expect(allowed50mm![1][0]).toBeCloseTo(0.0501, 4)

      // Microscopic offset in calculatePolylineLength
      const microPoints: Point[] = [
        [0, 0],
        [0.00001, 0],
        [0.00002, 0],
      ]
      expect(calculatePolylineLength(microPoints)).toBeCloseTo(0.00002, 8)
    })
  })

  describe('2. Degenerate Polylines & Invariant Boundaries', () => {
    it('strictly forbids vertex deletion on exactly 2 points', () => {
      const pts2: Point[] = [
        [-5, 2],
        [15, 8],
      ]

      // Removing index 0 must return null
      expect(withRouteVertexRemoved(pts2, 0)).toBeNull()
      // Removing index 1 must return null
      expect(withRouteVertexRemoved(pts2, 1)).toBeNull()

      // High-level deleteControlPoint must throw specific error
      const route2 = RouteNode.parse({
        id: 'route_challenger_2pt',
        type: 'warehouse:route',
        points: pts2,
      })
      expect(() => deleteControlPoint(route2, 0)).toThrow(
        'Cannot delete point: route requires a minimum of 2 vertices',
      )
      expect(() => deleteControlPoint(route2, 1)).toThrow(
        'Cannot delete point: route requires a minimum of 2 vertices',
      )
    })

    it('handles single-point, empty arrays, and out-of-bound indices gracefully', () => {
      const empty: Point[] = []
      const single: Point[] = [[10, 20]]

      expect(getRouteMidpoints(empty)).toEqual([])
      expect(getRouteMidpoints(single)).toEqual([])

      expect(withRouteVertexRemoved(empty, 0)).toBeNull()
      expect(withRouteVertexRemoved(single, 0)).toBeNull()

      expect(withRouteVertexInserted(empty, 0)).toBeNull()
      expect(withRouteVertexInserted(single, 0)).toBeNull()

      expect(withRouteVertexMoved(empty, 0, [5, 5])).toBeNull()
      expect(withRouteVertexMoved(single, -1, [5, 5])).toBeNull()
      expect(withRouteVertexMoved(single, 2, [5, 5])).toBeNull()

      const pts3: Point[] = [
        [0, 0],
        [5, 0],
        [10, 0],
      ]
      expect(withRouteVertexRemoved(pts3, -1)).toBeNull()
      expect(withRouteVertexRemoved(pts3, 3)).toBeNull()
      expect(withRouteVertexRemoved(pts3, 100)).toBeNull()
    })

    it('rejects vertex movement when candidate coordinates collapse onto neighbors', () => {
      const pts: Point[] = [
        [0, 0],
        [5, 0],
        [10, 0],
      ]

      // Exactly onto prev vertex
      expect(withRouteVertexMoved(pts, 1, [0, 0])).toBeNull()
      // Exactly onto succ vertex
      expect(withRouteVertexMoved(pts, 1, [10, 0])).toBeNull()

      // End vertex index 2 moving onto index 1
      expect(withRouteVertexMoved(pts, 2, [5, 0])).toBeNull()
      // Start vertex index 0 moving onto index 1
      expect(withRouteVertexMoved(pts, 0, [5, 0])).toBeNull()
    })
  })

  describe('3. Capacity Overflow & Memory Integrity', () => {
    it('repeatedly inserts midpoints up to MAX_VERTICES (64) and verifies overflow rejection', () => {
      let currentPoints: Point[] = [
        [0, 0],
        [100, 0],
      ]

      // Incrementally insert midpoints from 2 up to 64
      for (let count = 2; count < MAX_VERTICES; count++) {
        const next = withRouteVertexInserted(currentPoints, 0)
        expect(next).not.toBeNull()
        expect(next!.length).toBe(count + 1)
        expect(next![0]).toEqual([0, 0])
        expect(Number.isFinite(next![1][0])).toBe(true)
        expect(Number.isFinite(next![1][1])).toBe(true)
        currentPoints = next!
      }

      // We are now at exactly MAX_VERTICES (64)
      expect(currentPoints.length).toBe(64)
      const frozenSnapshot = JSON.stringify(currentPoints)

      // Attempting insertion on any segment must return null
      expect(withRouteVertexInserted(currentPoints, 0)).toBeNull()
      expect(withRouteVertexInserted(currentPoints, 15)).toBeNull()
      expect(withRouteVertexInserted(currentPoints, 31)).toBeNull()
      expect(withRouteVertexInserted(currentPoints, 62)).toBeNull()

      // Ensure original array was not mutated or corrupted
      expect(JSON.stringify(currentPoints)).toBe(frozenSnapshot)
    })

    it('validates schema bounds against overflow beyond 64 and underflow below 2', () => {
      const valid64: Point[] = Array.from({ length: 64 }, (_, i) => [i, 0])
      const validRoute = RouteNode.parse({
        id: 'route_max_64',
        type: 'warehouse:route',
        points: valid64,
      })
      expect(validRoute.points.length).toBe(64)

      // insertControlPoint on 64-point route must fail schema validation (exceeds MAX_VERTICES)
      expect(() => insertControlPoint(validRoute, 0)).toThrow()

      // 65 points must fail schema validation
      const overflow65: Point[] = Array.from({ length: 65 }, (_, i) => [i, 0])
      expect(() =>
        RouteNode.parse({
          id: 'route_overflow_65',
          type: 'warehouse:route',
          points: overflow65,
        }),
      ).toThrow()

      // 1 point must fail schema validation
      const underflow1: Point[] = [[0, 0]]
      expect(() =>
        RouteNode.parse({
          id: 'route_underflow_1',
          type: 'warehouse:route',
          points: underflow1,
        }),
      ).toThrow()
    })
  })

  describe('4. Rapid Drag Simulation & Draft Override Leak Protection', () => {
    it('simulates 100 rapid pointer moves without NaN, coordinate corruption, or override leaks', () => {
      const nodeId = 'route_rapid_drag_test_node'
      const basePoints: Point[] = [
        [0, 0],
        [10, 0],
        [20, 0],
        [30, 0],
      ]
      const nodePos: [number, number, number] = [50, 0, 100]
      const yaw = Math.PI / 4 // 45 degrees

      // Drag start: temporal pause
      useScene.temporal?.getState()?.pause?.()

      // Dragging vertex index 1
      let currentDraft: Point[] = [...basePoints]

      // Simulate 100 rapid pointer moves along an oscillating path
      for (let step = 1; step <= 100; step++) {
        // Simulated pointer world-space coordinates
        const progress = step / 100
        const wx = nodePos[0] + 10 + Math.sin(progress * Math.PI * 4) * 4
        const wz = nodePos[2] + Math.cos(progress * Math.PI * 4) * 4

        // Convert world hit to local space
        const local = worldToLocalXZ([wx, wz], nodePos, yaw)
        expect(Number.isFinite(local[0])).toBe(true)
        expect(Number.isFinite(local[1])).toBe(true)

        // Attempt move on draft points
        const moved = withRouteVertexMoved(currentDraft, 1, local)
        if (moved) {
          currentDraft = moved
          useLiveNodeOverrides.getState().set(nodeId, { points: moved })

          // Ensure every coordinate in draft is clean
          for (const pt of moved) {
            expect(Number.isFinite(pt[0])).toBe(true)
            expect(Number.isFinite(pt[1])).toBe(true)
            expect(Number.isNaN(pt[0])).toBe(false)
            expect(Number.isNaN(pt[1])).toBe(false)
          }

          // Verify store override matches
          const live = useLiveNodeOverrides.getState().get(nodeId)
          expect(live?.points).toEqual(moved)
        }
      }

      // Ensure final state after 100 moves is valid
      expect(currentDraft.length).toBe(4)
      expect(currentDraft[0]).toEqual([0, 0])
      expect(currentDraft[3]).toEqual([30, 0])

      // Simulate commit / drag release: temporal resume & clear override
      useScene.temporal?.getState()?.resume?.()
      useLiveNodeOverrides.getState().clear(nodeId)
      expect(useLiveNodeOverrides.getState().get(nodeId)).toBeUndefined()
    })

    it('retains previous valid draft when invalid or collapsing moves occur during rapid dragging', () => {
      const pts: Point[] = [
        [0, 0],
        [5, 0],
        [10, 0],
      ]

      let draft = [...pts]

      // 1. Move to a valid position
      const validMove = withRouteVertexMoved(draft, 1, [5, 2])
      expect(validMove).not.toBeNull()
      draft = validMove!

      // 2. Sudden pointer jump right onto vertex 0 (distance = 0 < 0.05m)
      const invalidCollapse = withRouteVertexMoved(draft, 1, [0, 0])
      expect(invalidCollapse).toBeNull()

      // The previous draft must remain uncorrupted at [5, 2]
      expect(draft[1]).toEqual([5, 2])

      // 3. Next pointer tick recovers to valid position
      const recoveryMove = withRouteVertexMoved(draft, 1, [6, 2])
      expect(recoveryMove).not.toBeNull()
      expect(recoveryMove![1]).toEqual([6, 2])
    })
  })

  describe('5. Collinear & Orthogonal Snapping Precision and Edge Cases', () => {
    it('handles identical / zero-length chord segments in snapCollinear safely', () => {
      const pCoincident: Point = [4, 7]
      const candidate: Point = [5, 8]

      // Zero-length segment (lenSq < 1e-8) must return candidate safely without NaN
      const res = snapCollinear(pCoincident, pCoincident, candidate)
      expect(res).toEqual(candidate)
      expect(Number.isNaN(res[0])).toBe(false)
      expect(Number.isNaN(res[1])).toBe(false)
    })

    it('snaps along diagonal and tilted chord lines with perpendicular projection', () => {
      // 45-degree diagonal chord from (0, 0) to (10, 10)
      // Chord line equation: y = x, unit direction: [1/sqrt(2), 1/sqrt(2)]
      // Normal direction: [-1/sqrt(2), 1/sqrt(2)]
      const pPrev: Point = [0, 0]
      const pNext: Point = [10, 10]

      // Candidate offset along normal by 0.10m (10cm < 15cm threshold)
      const offset = 0.1 / Math.SQRT2
      const candidateInside: Point = [5 - offset, 5 + offset]

      const snapped = snapCollinear(pPrev, pNext, candidateInside, COLLINEAR_SNAP_THRESHOLD_M)
      expect(snapped[0]).toBeCloseTo(5, 5)
      expect(snapped[1]).toBeCloseTo(5, 5)

      // Candidate offset along normal by 0.20m (20cm > 15cm threshold) -> no snap
      const offsetLarge = 0.2 / Math.SQRT2
      const candidateOutside: Point = [5 - offsetLarge, 5 + offsetLarge]
      const notSnapped = snapCollinear(pPrev, pNext, candidateOutside, COLLINEAR_SNAP_THRESHOLD_M)
      expect(notSnapped[0]).toBeCloseTo(candidateOutside[0], 6)
      expect(notSnapped[1]).toBeCloseTo(candidateOutside[1], 6)
    })

    it('strictly tests collinear threshold boundary at 15cm (0.150001m vs 0.149999m)', () => {
      const pPrev: Point = [0, 0]
      const pNext: Point = [10, 0]

      // Perpendicular distance = 0.149999m -> must snap to y=0
      const subThreshold: Point = [5, 0.149999]
      const snapped = snapCollinear(pPrev, pNext, subThreshold, 0.15)
      expect(snapped[1]).toBeCloseTo(0, 6)

      // Perpendicular distance = 0.150001m -> must not snap
      const supThreshold: Point = [5, 0.150001]
      const notSnapped = snapCollinear(pPrev, pNext, supThreshold, 0.15)
      expect(notSnapped[1]).toBeCloseTo(0.150001, 6)
    })

    it('enforces projection interior (0 <= t <= len) for collinear snapping', () => {
      const pPrev: Point = [2, 0]
      const pNext: Point = [8, 0]

      // Projection before pPrev (t < 0) at x=1.9, y=0.02 (dist = 2cm)
      const beforeStart: Point = [1.9, 0.02]
      expect(snapCollinear(pPrev, pNext, beforeStart)).toEqual(beforeStart)

      // Projection after pNext (t > len) at x=8.1, y=0.02 (dist = 2cm)
      const afterEnd: Point = [8.1, 0.02]
      expect(snapCollinear(pPrev, pNext, afterEnd)).toEqual(afterEnd)
    })

    it('prevents orthogonal snap from collapsing points along parallel axis', () => {
      const anchor: Point = [5, 5]

      // Candidate at (5.04, 5.02):
      // dx = 0.04 (<= 0.10m threshold), but dz = 0.02 (< MIN_SEGMENT_LENGTH_M = 0.05m)
      // Must NOT snap resX to anchor[0], to prevent zero-distance collapse!
      const closeCandidate: Point = [5.04, 5.02]
      const snapped = snapOrthogonal(anchor, closeCandidate, ORTHOGONAL_SNAP_THRESHOLD_M)
      expect(snapped[0]).toBe(5.04)
      expect(snapped[1]).toBe(5.02)

      // When dz >= 0.05m (e.g. dz = 0.06m), snap to X is permitted
      const validVertical: Point = [5.04, 5.06]
      const snappedVert = snapOrthogonal(anchor, validVertical, ORTHOGONAL_SNAP_THRESHOLD_M)
      expect(snappedVert[0]).toBe(5)
      expect(snappedVert[1]).toBe(5.06)
    })
  })

  describe('6. Coordinate Conversion Round-Trip Fidelity', () => {
    const yawAngles = [
      0,
      Math.PI / 4,
      Math.PI / 2,
      Math.PI,
      -Math.PI / 3,
      -Math.PI / 2,
      (3 * Math.PI) / 4,
      -Math.PI,
      2 * Math.PI,
    ]

    const testNodePositions: Array<[number, number, number]> = [
      [0, 0, 0],
      [10, 0, 20],
      [-45.67, 1.2, 89.01],
      [1000.5, -5.2, -2000.8],
    ]

    const testLocalPoints: Point[] = [
      [0, 0],
      [5, 12],
      [-15.75, 42.125],
      [0.001, -0.002],
      [123.456, -654.321],
    ]

    for (const yaw of yawAngles) {
      const yawDeg = Math.round((yaw * 180) / Math.PI)
      it(`preserves round-trip fidelity local -> world -> local at yaw = ${yawDeg}° (${yaw.toFixed(3)} rad)`, () => {
        for (const nodePos of testNodePositions) {
          for (const localPt of testLocalPoints) {
            const world = localToWorldXZ(localPt, nodePos, yaw)
            const reconstructed = worldToLocalXZ(world, nodePos, yaw)

            expect(reconstructed[0]).toBeCloseTo(localPt[0], 7)
            expect(reconstructed[1]).toBeCloseTo(localPt[1], 7)
          }
        }
      })

      it(`preserves round-trip fidelity world -> local -> world at yaw = ${yawDeg}° (${yaw.toFixed(3)} rad)`, () => {
        for (const nodePos of testNodePositions) {
          for (const localPt of testLocalPoints) {
            // World coordinate
            const worldPt: [number, number] = [nodePos[0] + localPt[0], nodePos[2] + localPt[1]]
            const local = worldToLocalXZ(worldPt, nodePos, yaw)
            const reconstructedWorld = localToWorldXZ(local, nodePos, yaw)

            expect(reconstructedWorld[0]).toBeCloseTo(worldPt[0], 7)
            expect(reconstructedWorld[1]).toBeCloseTo(worldPt[1], 7)
          }
        }
      })
    }
  })
})
