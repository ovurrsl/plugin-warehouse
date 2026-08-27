import { describe, expect, it } from 'bun:test'
import type { AnyNode, AnyNodeId, ZoneNode } from '@pascal-app/core'
import {
  calculateEquipmentFootprint,
  calculateFacilityZDSUReport,
  calculateZoneZDSUAudit,
  evaluateUtilizationHealth,
  exportZoneAuditJson,
  exportZoneAuditMarkdown,
  getOptimalUtilizationRange,
  inferZoneRole,
  pointInPolygonWithTolerance,
  polygonArea,
  polygonPerimeter,
} from './zero-defect'

function makeZone(overrides: Partial<ZoneNode> = {}): ZoneNode {
  return {
    id: 'zone-1' as any,
    type: 'zone' as any,
    name: 'Storage Zone A',
    parentId: 'level-1' as any,
    polygon: [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ], // 20m x 10m = 200 m²
    autoFromWalls: false,
    boundaryWallIds: [],
    spaceRole: 'generic',
    roomNumber: '',
    enclosureStatus: 'auto',
    floorFinish: '',
    wallFinish: '',
    ceilingFinish: '',
    ceilingHeight: 6.0,
    occupancy: '',
    clearDimensionPolicy: 'none',
    color: '#3b82f6',
    metadata: {},
    ...overrides,
  } as ZoneNode
}

describe('Zero Defect Start-up (ZDSU) Calculation Engine', () => {
  describe('Pillar 1: Geometry & Spatial Envelope', () => {
    it('calculates polygon area using shoelace formula for a rectangle', () => {
      const rect: [number, number][] = [
        [0, 0],
        [10, 0],
        [10, 5],
        [0, 5],
      ]
      expect(polygonArea(rect)).toBe(50)
    })

    it('calculates polygon area for an irregular L-shape', () => {
      const lShape: [number, number][] = [
        [0, 0],
        [10, 0],
        [10, 5],
        [5, 5],
        [5, 10],
        [0, 10],
      ]
      // (10 * 5) + (5 * 5) = 50 + 25 = 75 m²
      expect(polygonArea(lShape)).toBe(75)
    })

    it('returns 0 area for degenerate or insufficient vertices', () => {
      expect(polygonArea([])).toBe(0)
      expect(polygonArea([[0, 0], [10, 0]])).toBe(0)
    })

    it('calculates perimeter correctly for closed polygon', () => {
      const rect: [number, number][] = [
        [0, 0],
        [10, 0],
        [10, 5],
        [0, 5],
      ]
      // 10 + 5 + 10 + 5 = 30m
      expect(polygonPerimeter(rect)).toBe(30)
    })

    it('tests point containment with tolerance', () => {
      const footprint: [number, number][] = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]
      expect(pointInPolygonWithTolerance([5, 5], footprint)).toBe(true)
      expect(pointInPolygonWithTolerance([0, 0], footprint)).toBe(true)
      expect(pointInPolygonWithTolerance([10.2, 5], footprint)).toBe(true) // within 0.5m tolerance
      expect(pointInPolygonWithTolerance([15, 15], footprint)).toBe(false)
    })
  })

  describe('Zone Role Inference', () => {
    it('infers role from metadata override', () => {
      const zone = makeZone({ metadata: { role: 'staging-inbound' } })
      expect(inferZoneRole(zone, null, {}, [])).toBe('staging-inbound')
    })

    it('infers role from name keywords', () => {
      expect(inferZoneRole(makeZone({ name: 'Inbound Staging Bay 1' }), null, {}, [])).toBe('staging-inbound')
      expect(inferZoneRole(makeZone({ name: 'Outbound Marshalling Yard' }), null, {}, [])).toBe('staging-outbound')
      expect(inferZoneRole(makeZone({ name: 'Fast Pick Mezzanine' }), null, {}, [])).toBe('picking')
      expect(inferZoneRole(makeZone({ name: 'Packing & VAS Station' }), null, {}, [])).toBe('vas-packing')
      expect(inferZoneRole(makeZone({ name: 'Drive-In Cold Storage' }), null, {}, [])).toBe('storage-drivein')
      expect(inferZoneRole(makeZone({ name: 'Gravity Live Flow Racks' }), null, {}, [])).toBe('storage-live')
      expect(inferZoneRole(makeZone({ name: 'High-Bay Reserve Racking' }), null, {}, [])).toBe('storage-selective')
      expect(inferZoneRole(makeZone({ name: 'Main Conveyor Sorter Run' }), null, {}, [])).toBe('conveyor-corridor')
      expect(inferZoneRole(makeZone({ name: 'Forklift Traffic Aisle' }), null, {}, [])).toBe('traffic-aisle')
      expect(inferZoneRole(makeZone({ name: 'QA Quarantine Pen' }), null, {}, [])).toBe('quarantine')
    })

    it('infers role from standing equipment when name is generic', () => {
      const zone = makeZone({ name: 'Zone 1' })
      const nodes: Record<string, AnyNode> = {
        'dock-1': { id: 'dock-1', type: 'warehouse:dock-leveller', parentId: 'level-1' } as any,
      }
      expect(inferZoneRole(zone, null, nodes, ['dock-1' as any])).toBe('staging-inbound')

      const rackNodes: Record<string, AnyNode> = {
        'rack-1': { id: 'rack-1', type: 'warehouse:pallet-rack', parentId: 'level-1' } as any,
      }
      expect(inferZoneRole(zone, null, rackNodes, ['rack-1' as any])).toBe('storage-selective')
    })
  })

  describe('Pillar 2: Storage Capacity & Selectivity Index', () => {
    it('calculates selective rack capacity and 100% direct access', () => {
      const zone = makeZone({ name: 'Selective Storage' })
      const nodes: Record<string, AnyNode> = {
        'rack-1': {
          id: 'rack-1',
          type: 'warehouse:pallet-rack',
          parentId: 'level-1',
          position: [5, 0, 5],
          levels: 4,
          bayClearWidth: 2.7,
          depth: 1.1,
          height: 4.5,
        } as any,
      }

      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds: ['rack-1' as any] })
      expect(audit.storage.totalPalletPositions).toBe(12) // 4 levels * 3 positions
      expect(audit.storage.directAccessPositions).toBe(12)
      expect(audit.storage.selectivityIndex).toBe(100)
    })

    it('calculates drive-in rack capacity and reduced direct access', () => {
      const zone = makeZone({ name: 'Drive-In Storage' })
      const nodes: Record<string, AnyNode> = {
        'di-1': {
          id: 'di-1',
          type: 'warehouse:drive-in-rack',
          parentId: 'level-1',
          position: [5, 0, 5],
          storageLevels: 4,
          palletDepthPositions: 4, // 4 levels * 4 depth = 16 pallets
        } as any,
      }

      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds: ['di-1' as any] })
      expect(audit.storage.totalPalletPositions).toBe(16)
      expect(audit.storage.directAccessPositions).toBe(4) // 1 front position per level = 4
      expect(audit.storage.selectivityIndex).toBe(25) // 4 / 16 = 25%
    })

    it('handles empty zone with 0 pallets and 100% default selectivity', () => {
      const zone = makeZone({ name: 'Empty Storage' })
      const audit = calculateZoneZDSUAudit(zone, null, {}, { contentIds: [] })
      expect(audit.storage.totalPalletPositions).toBe(0)
      expect(audit.storage.directAccessPositions).toBe(0)
      expect(audit.storage.selectivityIndex).toBe(100)
    })
  })

  describe('Pillar 3: Floor Space Utilization & Congestion', () => {
    it('calculates equipment footprint accurately across multiple object kinds', () => {
      const nodes: Record<string, AnyNode> = {
        'rack-1': {
          id: 'rack-1',
          type: 'warehouse:pallet-rack',
          bayClearWidth: 2.7,
          depth: 1.1,
        } as any, // (2.7 + 0.1) * 1.1 = 3.08 m²
        'bench-1': {
          id: 'bench-1',
          type: 'warehouse:bench',
        } as any, // 2.0 * 1.0 = 2.0 m²
        'pallet-1': {
          id: 'pallet-1',
          type: 'warehouse:pallet',
        } as any, // 0.96 m²
      }

      const footprint = calculateEquipmentFootprint(
        ['rack-1' as any, 'bench-1' as any, 'pallet-1' as any],
        nodes,
      )
      expect(footprint).toBeCloseTo(3.08 + 2.0 + 0.96, 2)
    })

    it('evaluates optimal floor utilization ranges and health status', () => {
      expect(getOptimalUtilizationRange('storage-selective')).toEqual([45, 65])
      expect(getOptimalUtilizationRange('staging-inbound')).toEqual([25, 45])
      expect(getOptimalUtilizationRange('picking')).toEqual([30, 50])

      expect(evaluateUtilizationHealth(55, 'storage-selective', true)).toBe('optimal')
      expect(evaluateUtilizationHealth(68, 'storage-selective', true)).toBe('congested')
      expect(evaluateUtilizationHealth(78, 'storage-selective', true)).toBe('severe-congestion')
      expect(evaluateUtilizationHealth(20, 'storage-selective', true)).toBe('sparse')
    })
  })

  describe('Pillar 4 & Defect Rules ZDSU-R01 to ZDSU-R12', () => {
    it('ZDSU-R01: Sprinkler head clearance violation (<0.50m)', () => {
      const zone = makeZone({ ceilingHeight: 5.0 })
      const nodes: Record<string, AnyNode> = {
        'rack-1': {
          id: 'rack-1',
          type: 'warehouse:pallet-rack',
          height: 4.8, // 5.0 - 4.8 = 0.20m (< 0.50m)
        } as any,
      }
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds: ['rack-1' as any] })
      expect(audit.defects.some((d) => d.code === 'ZDSU-R01' && d.severity === 'blocking')).toBe(true)
      expect(audit.readiness.status).toBe('blocked')
    })

    it('ZDSU-R03: Critical staging buffer deficit (<25m²/dock)', () => {
      const zone = makeZone({ name: 'Inbound Dock', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }) // 100 m²
      const nodes: Record<string, AnyNode> = {
        'dock-1': { id: 'dock-1', type: 'warehouse:dock-leveller' } as any,
        'dock-2': { id: 'dock-2', type: 'warehouse:dock-leveller' } as any,
        'dock-3': { id: 'dock-3', type: 'warehouse:dock-leveller' } as any,
        'dock-4': { id: 'dock-4', type: 'warehouse:dock-leveller' } as any,
        'dock-5': { id: 'dock-5', type: 'warehouse:dock-leveller' } as any, // 100 / 5 = 20 m²/dock (<25)
      }
      const audit = calculateZoneZDSUAudit(zone, null, nodes, {
        contentIds: ['dock-1' as any, 'dock-2' as any, 'dock-3' as any, 'dock-4' as any, 'dock-5' as any],
      })
      expect(audit.defects.some((d) => d.code === 'ZDSU-R03' && d.severity === 'blocking')).toBe(true)
      expect(audit.readiness.status).toBe('blocked')
    })

    it('ZDSU-R04: Severe floor over-congestion (>70% storage)', () => {
      const zone = makeZone({ name: 'Storage Zone', polygon: [[0, 0], [5, 0], [5, 5], [0, 5]] }) // 25 m²
      const nodes: Record<string, AnyNode> = {}
      const contentIds: AnyNodeId[] = []
      for (let i = 0; i < 7; i++) {
        const id = `rack-${i}` as AnyNodeId
        nodes[id] = { id, type: 'warehouse:pallet-rack', bayClearWidth: 2.7, depth: 1.1 } as any // 3.08 m² * 7 = 21.56 m² (86.2%)
        contentIds.push(id)
      }
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.defects.some((d) => d.code === 'ZDSU-R04' && d.severity === 'blocking')).toBe(true)
      expect(audit.readiness.status).toBe('blocked')
    })

    it('ZDSU-R06: Narrow flue space warning (<75mm)', () => {
      const zone = makeZone({ ceilingHeight: 6.0 })
      const nodes: Record<string, AnyNode> = {
        'rack-1': {
          id: 'rack-1',
          type: 'warehouse:pallet-rack',
          height: 4.0,
          depthGap: 0.05, // 50mm < 75mm
        } as any,
      }
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds: ['rack-1' as any] })
      expect(audit.defects.some((d) => d.code === 'ZDSU-R06' && d.severity === 'warning')).toBe(true)
    })

    it('ZDSU-R07: Moderate floor over-utilization warning (65-70% storage)', () => {
      const zone = makeZone({ name: 'Storage Zone', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }) // 100 m²
      const nodes: Record<string, AnyNode> = {}
      const contentIds: AnyNodeId[] = []
      // 22 bays * 3.08 = 67.76 m² (67.8%) -> Warning (> 65% and <= 70%)
      for (let i = 0; i < 22; i++) {
        const id = `rack-${i}` as AnyNodeId
        nodes[id] = { id, type: 'warehouse:pallet-rack', bayClearWidth: 2.7, depth: 1.1, height: 4.0 } as any
        contentIds.push(id)
      }
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.defects.some((d) => d.code === 'ZDSU-R07' && d.severity === 'warning')).toBe(true)
    })

    it('ZDSU-R08: Missing floor route demarcation on active zone', () => {
      const zone = makeZone({ name: 'Storage Zone A' })
      const nodes: Record<string, AnyNode> = {}
      const contentIds: AnyNodeId[] = []
      for (let i = 0; i < 6; i++) {
        const id = `rack-${i}` as AnyNodeId
        nodes[id] = { id, type: 'warehouse:pallet-rack', height: 4.0 } as any
        contentIds.push(id)
      }
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
      expect(audit.defects.some((d) => d.code === 'ZDSU-R08' && d.severity === 'warning')).toBe(true)
    })

    it('ZDSU-R09: Low selectivity warning in forward pick zone', () => {
      const zone = makeZone({ name: 'Order Picking Area', metadata: { role: 'picking' } })
      const nodes: Record<string, AnyNode> = {
        'di-1': {
          id: 'di-1',
          type: 'warehouse:drive-in-rack',
          storageLevels: 4,
          palletDepthPositions: 4, // 16 pallets, 4 direct (25% selectivity)
        } as any,
      }
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds: ['di-1' as any] })
      expect(audit.defects.some((d) => d.code === 'ZDSU-R09' && d.severity === 'warning')).toBe(true)
    })

    it('ZDSU-R10: Marginal dock buffer warning (25-35 m²/dock)', () => {
      const zone = makeZone({ name: 'Inbound Staging', polygon: [[0, 0], [10, 0], [10, 6], [0, 6]] }) // 60 m²
      const nodes: Record<string, AnyNode> = {
        'dock-1': { id: 'dock-1', type: 'warehouse:dock-leveller' } as any,
        'dock-2': { id: 'dock-2', type: 'warehouse:dock-leveller' } as any, // 60 / 2 = 30 m²/dock (25-35)
      }
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds: ['dock-1' as any, 'dock-2' as any] })
      expect(audit.defects.some((d) => d.code === 'ZDSU-R10' && d.severity === 'warning')).toBe(true)
    })

    it('ZDSU-R11: Floor space underutilization advisory', () => {
      const zone = makeZone({ name: 'Reserve Storage', polygon: [[0, 0], [20, 0], [20, 10], [0, 10]] }) // 200 m²
      const nodes: Record<string, AnyNode> = {
        'rack-1': { id: 'rack-1', type: 'warehouse:pallet-rack', bayClearWidth: 2.7, depth: 1.1, height: 4.0 } as any, // 3.08 m² = 1.5% utilization
      }
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds: ['rack-1' as any] })
      expect(audit.defects.some((d) => d.code === 'ZDSU-R11' && d.severity === 'advisory')).toBe(true)
    })

    it('ZDSU-R12: High-bay MHE equipment mismatch advisory', () => {
      const zone = makeZone({ ceilingHeight: 12.0 })
      const nodes: Record<string, AnyNode> = {
        'rack-1': { id: 'rack-1', type: 'warehouse:pallet-rack', height: 8.5 } as any,
        'truck-1': { id: 'truck-1', type: 'warehouse:truck', model: 'counterbalance' } as any,
      }
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds: ['rack-1' as any, 'truck-1' as any] })
      expect(audit.defects.some((d) => d.code === 'ZDSU-R12' && d.severity === 'advisory')).toBe(true)
    })
  })

  describe('Pillar 6: Zero Defect Readiness Score & Facility Aggregation', () => {
    it('computes 100% READY score for an unequipped compliant zone', () => {
      const zone = makeZone({ name: 'New Reserve Zone' })
      const audit = calculateZoneZDSUAudit(zone, null, {}, { contentIds: [] })
      expect(audit.readiness.score).toBe(100)
      expect(audit.readiness.status).toBe('ready')
      expect(audit.readiness.blockingDefectsCount).toBe(0)
    })

    it('aggregates multiple zones into a facility-wide report with proper status roll-up', () => {
      const zone1 = makeZone({ id: 'z1' as any, name: 'Compliant Zone 1', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }) // 100 m²
      const zone2 = makeZone({ id: 'z2' as any, name: 'Congested Zone 2', ceilingHeight: 4.0, polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }) // 100 m²

      const nodes: Record<string, AnyNode> = {
        'rack-bad': {
          id: 'rack-bad',
          type: 'warehouse:pallet-rack',
          parentId: 'level-1',
          position: [5, 0, 5],
          height: 3.8, // 4.0 - 3.8 = 0.2m -> violation!
        } as any,
      }

      const report = calculateFacilityZDSUReport(nodes, [zone1, zone2])
      expect(report.zonesAudited).toBe(2)
      expect(report.totalZoneAreaM2).toBe(200)
      expect(report.totalDefects.blocking).toBeGreaterThanOrEqual(1)
      expect(report.overallStatus).toBe('blocked')
    })
  })

  describe('Export Helpers', () => {
    it('exports audit report to valid JSON', () => {
      const zone = makeZone({ name: 'Export Test Zone' })
      const report = calculateFacilityZDSUReport({}, [zone])
      const jsonStr = exportZoneAuditJson(report)
      const parsed = JSON.parse(jsonStr)

      expect(parsed.documentType).toBe('DigitalTwin-ZeroDefectStartup-AuditReport')
      expect(parsed.facilitySummary.zonesAudited).toBe(1)
      expect(parsed.zones.length).toBe(1)
      expect(parsed.zones[0].name).toBe('Export Test Zone')
    })

    it('exports audit report to formatted Markdown certificate', () => {
      const zone = makeZone({ name: 'Certificate Test Zone' })
      const report = calculateFacilityZDSUReport({}, [zone])
      const mdStr = exportZoneAuditMarkdown(report)

      expect(mdStr).toContain('# Zero Defect Start-up (ZDSU) Facility Audit Certificate')
      expect(mdStr).toContain('Certificate Test Zone')
      expect(mdStr).toContain('Facility Readiness Score')
    })
  })
})
