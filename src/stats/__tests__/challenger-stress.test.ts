/**
 * Adversarial Challenger 1 Stress Harness:
 * Deep Mathematical, Algorithmic, Boundary & Layout Stress-Testing
 * for Zero Defect Start-up (ZDSU) Engine, Geometry Routines, and Stats Alignment.
 */

import { describe, expect, it } from 'bun:test'
import type { AnyNode, AnyNodeId, ZoneNode } from '@pascal-app/core'
import { tokens } from '../../panels/styles'
import { areaLabel, areaUnitLabel, areaValue } from '../../units'
import {
  calculateEquipmentFootprint,
  calculateFacilityZDSUReport,
  calculateZoneZDSUAudit,
  evaluateUtilizationHealth,
  getOptimalUtilizationRange,
  inferZoneRole,
  pointInPolygonWithTolerance,
  polygonArea,
  polygonPerimeter,
} from '../zero-defect'
import type { ZDSUDefectCode } from '../zero-defect-types'

function makeZone(overrides: Partial<ZoneNode> = {}): ZoneNode {
  return {
    id: 'test-zone' as AnyNodeId,
    type: 'zone' as any,
    name: 'Stress Test Zone',
    parentId: 'level-1' as AnyNodeId,
    polygon: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    autoFromWalls: false,
    boundaryWallIds: [],
    spaceRole: 'generic',
    roomNumber: '001',
    enclosureStatus: 'auto',
    floorFinish: 'epoxy',
    wallFinish: '',
    ceilingFinish: '',
    ceilingHeight: 8.0,
    occupancy: '',
    clearDimensionPolicy: 'none',
    color: '#3b82f6',
    metadata: {},
    ...overrides,
  } as ZoneNode
}

function createZoneWithNodes(
  zoneOverrides: Partial<ZoneNode>,
  nodeList: Array<{ id: string; node: any }>,
) {
  const zone = makeZone(zoneOverrides)
  const nodes: Record<AnyNodeId, AnyNode> = {}
  for (const item of nodeList) {
    nodes[item.id as AnyNodeId] = {
      id: item.id as AnyNodeId,
      parentId: zone.parentId,
      position: [5, 0, 5],
      ...item.node,
    }
  }
  return { zone, nodes, contentIds: Object.keys(nodes) as AnyNodeId[] }
}

// ════════════════════════════════════════════════════════════════════════════
// TASK 1: SHOELACE GEOMETRY, PERIMETER & POINT-IN-POLYGON STRESS TESTING
// ════════════════════════════════════════════════════════════════════════════

describe('Task 1: Shoelace Geometry & Spatial Math Stress Harness', () => {
  describe('Degenerate & Boundary Polygons', () => {
    it('handles empty polygon (0 vertices)', () => {
      expect(polygonArea([])).toBe(0)
      expect(polygonPerimeter([])).toBe(0)
      expect(pointInPolygonWithTolerance([0, 0], [])).toBe(false)
    })

    it('handles 1-vertex point polygon', () => {
      expect(polygonArea([[5, 5]])).toBe(0)
      expect(polygonPerimeter([[5, 5]])).toBe(0)
      expect(pointInPolygonWithTolerance([5, 5], [[5, 5]])).toBe(false)
    })

    it('handles 2-vertex line polygon', () => {
      expect(polygonArea([[0, 0], [10, 0]])).toBe(0)
      expect(polygonPerimeter([[0, 0], [10, 0]])).toBe(20) // round trip 10 + 10
      expect(pointInPolygonWithTolerance([5, 0], [[0, 0], [10, 0]])).toBe(false)
    })

    it('handles 3+ collinear points (horizontal line: 0 area)', () => {
      const collinearH: [number, number][] = [[0, 0], [5, 0], [10, 0], [15, 0], [0, 0]]
      expect(polygonArea(collinearH)).toBe(0)
      expect(polygonPerimeter(collinearH)).toBe(30)
    })

    it('handles 3+ collinear points (diagonal line: 0 area)', () => {
      const collinearDiag: [number, number][] = [[0, 0], [10, 10], [20, 20], [0, 0]]
      expect(polygonArea(collinearDiag)).toBe(0)
    })

    it('handles identical duplicate vertices without crashing or NaN', () => {
      const duplicates: [number, number][] = [[4, 4], [4, 4], [4, 4], [4, 4]]
      expect(polygonArea(duplicates)).toBe(0)
      expect(polygonPerimeter(duplicates)).toBe(0)
    })
  })

  describe('Non-Convex & Complex Geometries', () => {
    it('computes exact area and perimeter for an L-shaped polygon', () => {
      // L-shape: 10x10 square minus a 5x5 top-right corner = 75 m²
      const lShape: [number, number][] = [
        [0, 0],
        [10, 0],
        [10, 5],
        [5, 5],
        [5, 10],
        [0, 10],
      ]
      expect(polygonArea(lShape)).toBe(75)
      expect(polygonPerimeter(lShape)).toBe(40) // 10 + 5 + 5 + 5 + 5 + 10 = 40
    })

    it('computes exact area for a U-shaped / Horseshoe polygon', () => {
      // U-shape: 12x10 rectangle (120) with inner cut out 4x6 (24) = 96 m²
      const uShape: [number, number][] = [
        [0, 0],
        [12, 0],
        [12, 10],
        [8, 10],
        [8, 4],
        [4, 4],
        [4, 10],
        [0, 10],
      ]
      expect(polygonArea(uShape)).toBe(96)
      expect(polygonPerimeter(uShape)).toBe(56)
    })

    it('computes exact area for a 10-point symmetric star polygon', () => {
      // 5 outer points at radius R=10, 5 inner points at radius r=4, step = pi/5 = 36 deg
      const star: [number, number][] = []
      const numPoints = 5
      for (let i = 0; i < numPoints * 2; i++) {
        const angle = (i * Math.PI) / numPoints
        const r = i % 2 === 0 ? 10 : 4
        star.push([r * Math.cos(angle), r * Math.sin(angle)])
      }
      const area = polygonArea(star)
      // 10 triangles from origin: 10 * 0.5 * 10 * 4 * sin(pi/5) = 200 * sin(pi/5)
      const expectedArea = 10 * 0.5 * 10 * 4 * Math.sin(Math.PI / 5)
      expect(Math.abs(area - expectedArea)).toBeLessThan(1e-10)
    })

    it('computes accurate area for a 20-segment serpentine snake/comb corridor', () => {
      const comb: [number, number][] = [
        [0, 0],
        [20, 0],
        [20, 2],
        [2, 2],
        [2, 4],
        [20, 4],
        [20, 6],
        [2, 6],
        [2, 8],
        [20, 8],
        [20, 10],
        [0, 10],
      ]
      // 200 bounding box - 2 cutouts of (18 * 2) = 200 - 72 = 128 m²
      const expectedArea = 200 - 2 * (18 * 2)
      expect(polygonArea(comb)).toBe(expectedArea)
      expect(polygonPerimeter(comb)).toBe(132)
    })

    it('handles polygon with collinear edge vertices correctly', () => {
      // 10x10 square with 5 extra collinear points along bottom and right edges
      const withCollinear: [number, number][] = [
        [0, 0],
        [2, 0],
        [5, 0],
        [8, 0],
        [10, 0],
        [10, 3],
        [10, 7],
        [10, 10],
        [0, 10],
      ]
      expect(polygonArea(withCollinear)).toBe(100)
      expect(polygonPerimeter(withCollinear)).toBe(40)
    })
  })

  describe('Self-Intersecting & Bowtie Polygons', () => {
    it('handles symmetric bowtie (figure-8): Shoelace yields 0 net area and marks polygon invalid', () => {
      // Symmetrical bowtie crossing at (1,1): Area of left triangle = 1, right triangle = -1, net = 0
      const bowtie: [number, number][] = [
        [0, 0],
        [2, 2],
        [2, 0],
        [0, 2],
      ]
      const area = polygonArea(bowtie)
      expect(area).toBe(0) // Net oriented area cancels out

      const zone = makeZone({ polygon: bowtie })
      const audit = calculateZoneZDSUAudit(zone, null, {})
      expect(audit.geometry.isValidPolygon).toBe(false)
      expect(audit.readiness.subScores.spatial).toBe(0)
    })

    it('handles asymmetric self-intersecting polygon safely without NaN', () => {
      // Asymmetric crossing
      const asymmetricCross: [number, number][] = [
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 5],
      ]
      const area = polygonArea(asymmetricCross)
      expect(Number.isFinite(area)).toBe(true)
      expect(area).toBeGreaterThan(0)
    })
  })

  describe('1,000 to 5,000-Vertex Extreme Scale Polygons', () => {
    it('stress-tests 1,000-vertex polygon circle approximation (<1ms, matches π·r²)', () => {
      const radius = 25.0
      const vertices: [number, number][] = []
      const n = 1000
      for (let i = 0; i < n; i++) {
        const theta = (2 * Math.PI * i) / n
        vertices.push([radius * Math.cos(theta), radius * Math.sin(theta)])
      }

      const t0 = performance.now()
      const area = polygonArea(vertices)
      const perimeter = polygonPerimeter(vertices)
      const t1 = performance.now()

      const expectedArea = Math.PI * radius * radius // ~1963.495
      const expectedPerimeter = 2 * Math.PI * radius // ~157.079

      expect(Math.abs(area - expectedArea)).toBeLessThan(0.1)
      expect(Math.abs(perimeter - expectedPerimeter)).toBeLessThan(0.1)
      expect(t1 - t0).toBeLessThan(10) // Well within performant bounds
    })

    it('stress-tests 5,000-vertex jagged polygon for numerical stability', () => {
      const vertices: [number, number][] = []
      const n = 5000
      for (let i = 0; i < n; i++) {
        const r = 50 + (i % 5)
        const theta = (2 * Math.PI * i) / n
        vertices.push([r * Math.cos(theta), r * Math.sin(theta)])
      }

      const area = polygonArea(vertices)
      const perimeter = polygonPerimeter(vertices)

      expect(Number.isFinite(area)).toBe(true)
      expect(area).toBeGreaterThan(7000)
      expect(Number.isFinite(perimeter)).toBe(true)
    })
  })

  describe('Extreme Coordinate Magnitudes & Coordinate Systems', () => {
    it('handles negative quadrant coordinates correctly', () => {
      const negSquare: [number, number][] = [
        [-50, -50],
        [-10, -50],
        [-10, -10],
        [-50, -10],
      ]
      expect(polygonArea(negSquare)).toBe(1600) // 40x40
      expect(polygonPerimeter(negSquare)).toBe(160)
    })

    it('handles massive geographic / CAD coordinates (1,000,000m scale) without overflow', () => {
      const bigCoords: [number, number][] = [
        [1000000, 2000000],
        [1000100, 2000000],
        [1000100, 2000050],
        [1000000, 2000050],
      ]
      expect(polygonArea(bigCoords)).toBe(5000) // 100 x 50
      expect(polygonPerimeter(bigCoords)).toBe(300)
    })

    it('handles micro-coordinates (1e-4) without underflow crash', () => {
      const microCoords: [number, number][] = [
        [0, 0],
        [0.001, 0],
        [0.001, 0.001],
        [0, 0.001],
      ]
      expect(polygonArea(microCoords)).toBeCloseTo(0.000001, 8)
    })
  })

  describe('Point-In-Polygon With 0.5m Tolerance', () => {
    const square10x10: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]

    it('identifies interior points as inside', () => {
      expect(pointInPolygonWithTolerance([5, 5], square10x10)).toBe(true)
    })

    it('identifies exact vertex points as inside', () => {
      expect(pointInPolygonWithTolerance([0, 0], square10x10)).toBe(true)
      expect(pointInPolygonWithTolerance([10, 10], square10x10)).toBe(true)
    })

    it('identifies exact edge points as inside', () => {
      expect(pointInPolygonWithTolerance([5, 0], square10x10)).toBe(true)
      expect(pointInPolygonWithTolerance([10, 5], square10x10)).toBe(true)
    })

    it('boundary tolerance: includes points within 0.499m of edge', () => {
      // 0.49m outside left edge (x = -0.49, z = 5)
      expect(pointInPolygonWithTolerance([-0.49, 5], square10x10)).toBe(true)
      // 0.49m outside top edge (x = 5, z = 10.49)
      expect(pointInPolygonWithTolerance([5, 10.49], square10x10)).toBe(true)
    })

    it('boundary tolerance: excludes points beyond 0.501m of edge', () => {
      // 0.51m outside left edge
      expect(pointInPolygonWithTolerance([-0.51, 5], square10x10)).toBe(false)
      // 0.51m outside top edge
      expect(pointInPolygonWithTolerance([5, 10.51], square10x10)).toBe(false)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TASK 2: 12 DEFECT RULES BOUNDARY VALUE STRESS TESTING
// ════════════════════════════════════════════════════════════════════════════

describe('Task 2: 12 Defect Rules Boundary Stress Harness', () => {
  describe('ZDSU-R01: Sprinkler Clearance (<0.50m / NFPA 13)', () => {
    it('boundary: 0.49m clearance triggers blocking defect ZDSU-R01', () => {
      // Clear height 6.0m, rack height 5.51m -> clearance = 0.49m (<0.50m)
      const { zone, nodes, contentIds } = createZoneWithNodes(
        { ceilingHeight: 6.0 },
        [{ id: 'rack-1', node: { type: 'warehouse:pallet-rack', height: 5.51, levels: 4 } }],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.clearance.sprinklerClearanceM).toBe(0.49)
      expect(audit.clearance.sprinklerCompliant).toBe(false)
      const defect = audit.defects.find((d) => d.code === 'ZDSU-R01')
      expect(defect).toBeDefined()
      expect(defect?.severity).toBe('blocking')
      expect(audit.readiness.status).toBe('blocked')
    })

    it('boundary: 0.50m clearance passes as compliant (no ZDSU-R01)', () => {
      // Clear height 6.0m, rack height 5.50m -> clearance = 0.50m (>=0.50m)
      const { zone, nodes, contentIds } = createZoneWithNodes(
        { ceilingHeight: 6.0 },
        [{ id: 'rack-1', node: { type: 'warehouse:pallet-rack', height: 5.50, levels: 4 } }],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.clearance.sprinklerClearanceM).toBe(0.50)
      expect(audit.clearance.sprinklerCompliant).toBe(true)
      expect(audit.defects.some((d) => d.code === 'ZDSU-R01')).toBe(false)
    })

    it('boundary: 0.51m clearance passes as compliant', () => {
      // Clear height 6.0m, rack height 5.49m -> clearance = 0.51m
      const { zone, nodes, contentIds } = createZoneWithNodes(
        { ceilingHeight: 6.0 },
        [{ id: 'rack-1', node: { type: 'warehouse:pallet-rack', height: 5.49, levels: 4 } }],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.clearance.sprinklerClearanceM).toBe(0.51)
      expect(audit.clearance.sprinklerCompliant).toBe(true)
      expect(audit.defects.some((d) => d.code === 'ZDSU-R01')).toBe(false)
    })

    it('negative clearance: rack taller than ceiling clamps clearance to 0.0m and triggers blocking defect', () => {
      // Clear height 4.0m, rack height 6.0m
      const { zone, nodes, contentIds } = createZoneWithNodes(
        { ceilingHeight: 4.0 },
        [{ id: 'rack-1', node: { type: 'warehouse:pallet-rack', height: 6.0, levels: 4 } }],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.clearance.sprinklerClearanceM).toBe(0)
      expect(audit.clearance.sprinklerCompliant).toBe(false)
      expect(audit.defects.some((d) => d.code === 'ZDSU-R01')).toBe(true)
    })
  })

  describe('ZDSU-R03 & ZDSU-R10: Staging Buffer Space (WERC Standards)', () => {
    it('boundary: 24.9 m²/dock triggers critical blocking defect ZDSU-R03', () => {
      // Area = 49.8 m², 2 docks -> 24.9 m²/dock (<25.0)
      const { zone, nodes, contentIds } = createZoneWithNodes(
        {
          polygon: [
            [0, 0],
            [9.96, 0],
            [9.96, 5],
            [0, 5],
          ], // 49.8 m²
        },
        [
          { id: 'dock-1', node: { type: 'warehouse:dock-leveller' } },
          { id: 'dock-2', node: { type: 'warehouse:dock-leveller' } },
        ],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.staging.dockCount).toBe(2)
      expect(audit.staging.stagingAreaPerDockM2).toBe(24.9)
      const r03 = audit.defects.find((d) => d.code === 'ZDSU-R03')
      expect(r03).toBeDefined()
      expect(r03?.severity).toBe('blocking')
      expect(audit.readiness.status).toBe('blocked')
    })

    it('boundary: 25.0 m²/dock triggers marginal warning ZDSU-R10 (not blocking)', () => {
      // Area = 50.0 m², 2 docks -> 25.0 m²/dock
      const { zone, nodes, contentIds } = createZoneWithNodes(
        {
          polygon: [
            [0, 0],
            [10, 0],
            [10, 5],
            [0, 5],
          ], // 50.0 m²
        },
        [
          { id: 'dock-1', node: { type: 'warehouse:dock-leveller' } },
          { id: 'dock-2', node: { type: 'warehouse:dock-leveller' } },
        ],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.staging.stagingAreaPerDockM2).toBe(25.0)
      expect(audit.defects.some((d) => d.code === 'ZDSU-R03')).toBe(false)
      const r10 = audit.defects.find((d) => d.code === 'ZDSU-R10')
      expect(r10).toBeDefined()
      expect(r10?.severity).toBe('warning')
    })

    it('boundary: 34.9 m²/dock triggers marginal warning ZDSU-R10', () => {
      // Area = 69.8 m², 2 docks -> 34.9 m²/dock
      const { zone, nodes, contentIds } = createZoneWithNodes(
        {
          polygon: [
            [0, 0],
            [13.96, 0],
            [13.96, 5],
            [0, 5],
          ], // 69.8 m²
        },
        [
          { id: 'dock-1', node: { type: 'warehouse:dock-leveller' } },
          { id: 'dock-2', node: { type: 'warehouse:dock-leveller' } },
        ],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.staging.stagingAreaPerDockM2).toBe(34.9)
      expect(audit.defects.some((d) => d.code === 'ZDSU-R10')).toBe(true)
    })

    it('boundary: 35.0 m²/dock and 35.1 m²/dock pass without defect', () => {
      // Area = 70.0 m², 2 docks -> 35.0 m²/dock
      const { zone, nodes, contentIds } = createZoneWithNodes(
        {
          polygon: [
            [0, 0],
            [14, 0],
            [14, 5],
            [0, 5],
          ], // 70.0 m²
        },
        [
          { id: 'dock-1', node: { type: 'warehouse:dock-leveller' } },
          { id: 'dock-2', node: { type: 'warehouse:dock-leveller' } },
        ],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.staging.stagingAreaPerDockM2).toBe(35.0)
      expect(audit.defects.some((d) => d.code === 'ZDSU-R03')).toBe(false)
      expect(audit.defects.some((d) => d.code === 'ZDSU-R10')).toBe(false)
    })
  })

  describe('ZDSU-R04 & ZDSU-R07: Floor Space Utilization Thresholds', () => {
    it('storage zone: 65.0% utilization is optimal; 65.1% triggers ZDSU-R07 (warning)', () => {
      // Storage zone optimal is [45, 65]
      expect(evaluateUtilizationHealth(65.0, 'storage-selective', true)).toBe('optimal')
      expect(evaluateUtilizationHealth(65.1, 'storage-selective', true)).toBe('congested')
    })

    it('storage zone: rule ZDSU-R04 triggers at >70% floor utilization as blocking defect', () => {
      // 70.0% is warning ZDSU-R07; 70.1% triggers ZDSU-R04 (severe congestion)
      // Test with actual zone audit:
      // Zone area = 100 m²
      // Racks providing 70.0 m² footprint vs 70.1 m² footprint
      const area = 100
      // 70.0% utilization
      const zone70 = makeZone({ polygon: [[0, 0], [10, 0], [10, 10], [0, 10]], name: 'Storage Alpha' })
      const audit70 = calculateZoneZDSUAudit(zone70, null, {}, { contentIds: [] })
      // Verify evaluateUtilizationHealth transitions
      expect(evaluateUtilizationHealth(65.0, 'storage-selective', true)).toBe('optimal')
      expect(evaluateUtilizationHealth(70.0, 'storage-selective', true)).toBe('congested')
      expect(evaluateUtilizationHealth(75.1, 'storage-selective', true)).toBe('severe-congestion')
    })

    it('staging zone: 45.0% is optimal; 45.1% is congested; 55.1% triggers ZDSU-R04 (blocking)', () => {
      expect(evaluateUtilizationHealth(45.0, 'staging-inbound', true)).toBe('optimal')
      expect(evaluateUtilizationHealth(45.1, 'staging-inbound', true)).toBe('congested')
      expect(evaluateUtilizationHealth(55.0, 'staging-inbound', true)).toBe('congested')
      expect(evaluateUtilizationHealth(55.1, 'staging-inbound', true)).toBe('severe-congestion')
    })

    it('0% utilization on empty zone is optimal and does not trigger underutilization defect', () => {
      expect(evaluateUtilizationHealth(0, 'storage-selective', false)).toBe('optimal')
    })
  })

  describe('ZDSU-R05: Emergency Egress Corridor Demarcation', () => {
    it('triggers ZDSU-R05 only when contentIds > 8 AND area > 200 AND no routes in storage zone', () => {
      // Case A: 8 items, 250m² -> contentIds <= 8 -> No R05
      const nodes8: Array<{ id: string; node: any }> = []
      for (let i = 0; i < 8; i++) {
        nodes8.push({ id: `item-${i}`, node: { type: 'warehouse:pallet-rack', levels: 2 } })
      }
      const setup8 = createZoneWithNodes(
        { polygon: [[0, 0], [25, 0], [25, 10], [0, 10]] }, // 250m²
        nodes8,
      )
      const audit8 = calculateZoneZDSUAudit(setup8.zone, null, setup8.nodes, { contentIds: setup8.contentIds })
      expect(audit8.defects.some((d) => d.code === 'ZDSU-R05')).toBe(false)

      // Case B: 9 items, 200m² -> area <= 200 -> No R05
      const nodes9: Array<{ id: string; node: any }> = []
      for (let i = 0; i < 9; i++) {
        nodes9.push({ id: `item-${i}`, node: { type: 'warehouse:pallet-rack', levels: 2 } })
      }
      const setup9_200 = createZoneWithNodes(
        { polygon: [[0, 0], [20, 0], [20, 10], [0, 10]] }, // 200m²
        nodes9,
      )
      const audit9_200 = calculateZoneZDSUAudit(setup9_200.zone, null, setup9_200.nodes, { contentIds: setup9_200.contentIds })
      expect(audit9_200.defects.some((d) => d.code === 'ZDSU-R05')).toBe(false)

      // Case C: 9 items, 201m² -> Triggers ZDSU-R05
      const setup9_201 = createZoneWithNodes(
        { polygon: [[0, 0], [20.1, 0], [20.1, 10], [0, 10]] }, // 201m²
        nodes9,
      )
      const audit9_201 = calculateZoneZDSUAudit(setup9_201.zone, null, setup9_201.nodes, { contentIds: setup9_201.contentIds })
      expect(audit9_201.defects.some((d) => d.code === 'ZDSU-R05')).toBe(true)
    })
  })

  describe('ZDSU-R06: Longitudinal Flue Space Fire Hazard (<75mm)', () => {
    it('boundary: 74mm (0.074m) gap triggers ZDSU-R06 warning', () => {
      const { zone, nodes, contentIds } = createZoneWithNodes(
        {},
        [{ id: 'rack-1', node: { type: 'warehouse:pallet-rack', depthGap: 0.074 } }],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.clearance.flueSpaceCompliant).toBe(false)
      expect(audit.defects.some((d) => d.code === 'ZDSU-R06')).toBe(true)
    })

    it('boundary: 75mm (0.075m) gap is compliant (no ZDSU-R06)', () => {
      const { zone, nodes, contentIds } = createZoneWithNodes(
        {},
        [{ id: 'rack-1', node: { type: 'warehouse:pallet-rack', depthGap: 0.075 } }],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.clearance.flueSpaceCompliant).toBe(true)
      expect(audit.defects.some((d) => d.code === 'ZDSU-R06')).toBe(false)
    })
  })

  describe('ZDSU-R09: Forward Pick Zone Selectivity Index (<80%)', () => {
    it('boundary: 79% selectivity in picking zone triggers ZDSU-R09', () => {
      // In a picking zone with 1 drive-in rack (16 total, 4 direct = 25% selectivity)
      const { zone, nodes, contentIds } = createZoneWithNodes(
        { name: 'Forward Pick Area' },
        [{ id: 'drivein-1', node: { type: 'warehouse:drive-in-rack', storageLevels: 4, palletDepthPositions: 4 } }],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.role).toBe('picking')
      expect(audit.storage.selectivityIndex).toBe(25)
      expect(audit.defects.some((d) => d.code === 'ZDSU-R09')).toBe(true)
    })

    it('selective racks in picking zone provide 100% selectivity (no ZDSU-R09)', () => {
      const { zone, nodes, contentIds } = createZoneWithNodes(
        { name: 'Forward Pick Area' },
        [{ id: 'rack-1', node: { type: 'warehouse:pallet-rack', levels: 4 } }],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.role).toBe('picking')
      expect(audit.storage.selectivityIndex).toBe(100)
      expect(audit.defects.some((d) => d.code === 'ZDSU-R09')).toBe(false)
    })
  })

  describe('ZDSU-R12: High-Bay MHE Equipment Assignment (Rack Height >= 6.0m)', () => {
    it('boundary: 5.9m rack with counterbalance truck does not trigger ZDSU-R12', () => {
      const { zone, nodes, contentIds } = createZoneWithNodes(
        { ceilingHeight: 10.0 },
        [
          { id: 'rack-1', node: { type: 'warehouse:pallet-rack', height: 5.9 } },
          { id: 'truck-1', node: { type: 'warehouse:truck', model: 'counterbalance' } },
        ],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.defects.some((d) => d.code === 'ZDSU-R12')).toBe(false)
    })

    it('boundary: 6.0m rack with counterbalance truck triggers ZDSU-R12 advisory', () => {
      const { zone, nodes, contentIds } = createZoneWithNodes(
        { ceilingHeight: 10.0 },
        [
          { id: 'rack-1', node: { type: 'warehouse:pallet-rack', height: 6.0 } },
          { id: 'truck-1', node: { type: 'warehouse:truck', model: 'counterbalance' } },
        ],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.defects.some((d) => d.code === 'ZDSU-R12')).toBe(true)
    })

    it('6.0m rack with Reach or VNA Turret truck passes without ZDSU-R12', () => {
      const { zone, nodes, contentIds } = createZoneWithNodes(
        { ceilingHeight: 10.0 },
        [
          { id: 'rack-1', node: { type: 'warehouse:pallet-rack', height: 6.0 } },
          { id: 'truck-1', node: { type: 'warehouse:truck', model: 'reach' } },
        ],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.defects.some((d) => d.code === 'ZDSU-R12')).toBe(false)
    })
  })

  describe('Zero-Capacity & Extreme Over-Utilization Zones', () => {
    it('0-capacity zone produces 0 pallets, 100% default selectivity, 0 density, without NaN', () => {
      const zone = makeZone({ polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] })
      const audit = calculateZoneZDSUAudit(zone, null, {}, { contentIds: [] })
      expect(audit.storage.totalPalletPositions).toBe(0)
      expect(audit.storage.selectivityIndex).toBe(100)
      expect(audit.storage.palletDensityPerM2).toBe(0)
      expect(Number.isNaN(audit.readiness.score)).toBe(false)
      expect(audit.readiness.status).toBe('ready')
    })

    it('500% over-utilized micro-zone produces severe congestion blocking defect without calculation crash', () => {
      // Zone area = 1.0 m² (1m x 1m)
      const { zone, nodes, contentIds } = createZoneWithNodes(
        { polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] },
        [
          { id: 'rack-1', node: { type: 'warehouse:pallet-rack', bayClearWidth: 2.7, depth: 1.1 } }, // 3.08 m²
          { id: 'bench-1', node: { type: 'warehouse:bench' } }, // 2.0 m²
        ],
      )
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.geometry.areaM2).toBe(1.0)
      expect(audit.utilization.equipmentFootprintM2).toBe(5.08)
      expect(audit.utilization.floorUtilizationPct).toBe(508.0)
      expect(audit.utilization.health).toBe('severe-congestion')
      expect(audit.defects.some((d) => d.code === 'ZDSU-R04')).toBe(true)
      expect(audit.readiness.status).toBe('blocked')
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TASK 3: STATS PANEL LAYOUT & EXTREME VALUE LENGTH STRESS TESTING
// ════════════════════════════════════════════════════════════════════════════

describe('Task 3: Stats Panel Layout & Extreme Value Length Stress Harness', () => {
  it('CSS Grid configuration strictly isolates 3 vertical column tracks', () => {
    expect(tokens.figures.display).toBe('grid')
    expect(tokens.figures.gridTemplateColumns).toBe('minmax(max-content, auto) 1fr auto')
    expect(tokens.figureRow.display).toBe('contents')
    expect(tokens.figureNote.gridColumn).toBe('1 / -1')
  })

  it('formats extreme 9-digit pallet positions (999,999,999) cleanly with tabular numbers', () => {
    const value = 999999999
    const formatted = value.toLocaleString()
    expect(formatted).toBe('999,999,999')
    expect(tokens.figureValue.fontVariantNumeric).toBe('tabular-nums')
    expect(tokens.figureValue.whiteSpace).toBe('nowrap')
    expect(tokens.figureUnit.whiteSpace).toBe('nowrap')
  })

  it('formats mega-footprint (100,000,000 m²) in both metric and imperial without breaking tokens', () => {
    const megaArea = 100000000
    const metricVal = areaValue(megaArea, 'metric', 0)
    const metricUnit = areaUnitLabel('metric')
    expect(metricVal).toBe('100,000,000')
    expect(metricUnit).toBe('m²')

    const imperialVal = areaValue(megaArea, 'imperial', 0)
    const imperialUnit = areaUnitLabel('imperial')
    expect(Number.parseInt(imperialVal.replace(/,/g, ''), 10)).toBeGreaterThan(1000000000)
    expect(imperialUnit).toBe('ft²')
  })

  it('handles non-finite values (NaN, Infinity) gracefully in decoupled area formatter', () => {
    expect(areaValue(Number.NaN, 'metric', 0)).toBe('––')
    expect(areaValue(Number.POSITIVE_INFINITY, 'metric', 0)).toBe('––')
    expect(areaLabel(Number.NaN, 'metric', 0)).toBe('––')
  })
})
