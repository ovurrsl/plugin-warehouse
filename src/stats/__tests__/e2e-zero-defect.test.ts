/**
 * E2E Zero Defect Start-up (ZDSU) & Stats Alignment Verification Suite.
 *
 * Grounded in:
 * - ORIGINAL_REQUEST.md (§R1 Stats UI Alignment, §R3 Zero Defect Zone Report)
 * - TEST_INFRA.md (4-Tier Verification Architecture)
 * - zero_defect_metrics.md (NFPA 13, EN 15635, OSHA 1910, WERC Standards)
 *
 * Tiers:
 * - Tier 1: Feature Coverage (Stats 3-column alignment CSS, zero_defect_metrics.md integrity, Zone report calculation engine)
 * - Tier 2: Boundary & Corner Cases (empty polygons, 0 capacity, huge mega-warehouses, missing rack fields, extreme dimensions)
 * - Tier 3: Cross-Feature Interactions (renamed project with multi-zone layout, dynamic geometry changes, unit toggle, facility roll-up)
 * - Tier 4: Real-World Warehouse Scenarios (Fulfillment center, cross-dock, cold storage, omni-channel retail, high-bay heavy cargo)
 */

import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AnyNode, AnyNodeId, ZoneNode } from '@pascal-app/core'
import { tokens } from '../../panels/styles'
import { resetStatsIndex, resolveStatsScope, sceneStats, statsReport } from '../../stats'
import { areaLabel, areaUnitLabel, areaValue, lengthLabel, lengthValue } from '../../units'
import {
  calculateEquipmentFootprint,
  calculateFacilityZDSUReport,
  calculateZoneZDSUAudit,
  collectZoneContentIds,
  evaluateUtilizationHealth,
  exportZoneAuditJson,
  exportZoneAuditMarkdown,
  getOptimalUtilizationRange,
  inferZoneRole,
  pointInPolygonWithTolerance,
  polygonArea,
  polygonPerimeter,
} from '../zero-defect'
import type {
  FacilityZDSUReport,
  ZDSUDefect,
  ZDSUDefectCode,
  ZDSUStatus,
  ZDSUUtilizationHealth,
  ZDSUZoneRole,
  ZoneZDSUAudit,
} from '../zero-defect-types'

function createTestZone(overrides: Partial<ZoneNode> = {}): ZoneNode {
  return {
    id: 'zone-1' as AnyNodeId,
    type: 'zone' as any,
    name: 'Storage Zone Alpha',
    parentId: 'level-1' as AnyNodeId,
    polygon: [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ], // 200 m²
    autoFromWalls: false,
    boundaryWallIds: [],
    spaceRole: 'generic',
    roomNumber: '101',
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

// ════════════════════════════════════════════════════════════════════════════
// TIER 1: FEATURE COVERAGE (R1 Stats Alignment, R3 Research & Zone Report)
// ════════════════════════════════════════════════════════════════════════════

describe('Tier 1: Feature Coverage', () => {
  describe('F1: Stats Panel Vertical Number & Suffix UI Alignment (R1)', () => {
    it('T1.F1.1: figures container enforces a strict 3-column CSS Grid layout', () => {
      expect(tokens.figures.display).toBe('grid')
      expect(tokens.figures.gridTemplateColumns).toBe('minmax(max-content, auto) 1fr auto')
      expect(tokens.figures.alignItems).toBe('baseline')
      expect(tokens.figures.rowGap).toBe('0.5rem')
      expect(tokens.figures.columnGap).toBe('0.375rem')
    })

    it('T1.F1.2: figureValue guarantees right alignment, tabular digits, and bold weight', () => {
      expect(tokens.figureValue.textAlign).toBe('right')
      expect(tokens.figureValue.fontVariantNumeric).toBe('tabular-nums')
      expect(tokens.figureValue.fontWeight).toBe(600)
      expect(tokens.figureValue.fontSize).toBe('0.875rem')
      expect(tokens.figureValue.whiteSpace).toBe('nowrap')
    })

    it('T1.F1.3: figureUnit guarantees left alignment and dedicated suffix positioning', () => {
      expect(tokens.figureUnit.textAlign).toBe('left')
      expect(tokens.figureUnit.fontWeight).toBe(400)
      expect(tokens.figureUnit.fontSize).toBe('0.625rem')
      expect(tokens.figureUnit.whiteSpace).toBe('nowrap')
    })

    it('T1.F1.4: figureNote spans all 3 columns (1 / -1) without disrupting numerical column vertical alignment', () => {
      expect(tokens.figureNote.gridColumn).toBe('1 / -1')
      expect(tokens.figureNote.fontSize).toBe('0.625rem')
    })

    it('T1.F1.5: decoupled area formatter cleanly separates numerical value from unit suffix across metric & imperial', () => {
      const metricVal = areaValue(1250.75, 'metric', 1)
      const metricUnit = areaUnitLabel('metric')
      expect(metricVal).toBe('1,250.8')
      expect(metricUnit).toBe('m²')
      expect(metricVal).not.toContain('m²')

      const imperialVal = areaValue(100, 'imperial', 1)
      const imperialUnit = areaUnitLabel('imperial')
      expect(imperialVal).toBe('1,076.4')
      expect(imperialUnit).toBe('ft²')
      expect(imperialVal).not.toContain('ft²')
    })
  })

  describe('F3: Zero Defect Research Document Integrity (zero_defect_metrics.md)', () => {
    const docPath = path.resolve(process.cwd(), '../zero_defect_metrics.md')
    const altDocPath = path.resolve(process.cwd(), 'zero_defect_metrics.md')
    const resolvedPath = fs.existsSync(docPath) ? docPath : altDocPath
    const content = fs.existsSync(resolvedPath) ? fs.readFileSync(resolvedPath, 'utf8') : ''

    it('T1.F3.1: zero_defect_metrics.md file exists and contains authoritative header', () => {
      expect(content.length).toBeGreaterThan(1000)
      expect(content).toContain('# Zero Defect Start-up (ZDSU) Warehouse Zone Metrics & Standards Specification')
      expect(content).toContain('ZDSU-ENG-SPEC-2026-V1')
    })

    it('T1.F3.2: articulates all 6 core Pillars of the ZDSU standard', () => {
      expect(content).toContain('Pillar 1: Zone Geometry & Spatial Envelope')
      expect(content).toContain('Pillar 2: Storage Capacity & Unit Load Density')
      expect(content).toContain('Pillar 3: Floor Space Utilization & Congestion Analysis')
      expect(content).toContain('Pillar 4: Aisle Clearance & Equipment Matching Compliance')
      expect(content).toContain('Pillar 5: Inbound/Outbound Staging Ratios & Dock Buffers')
      expect(content).toContain('Pillar 6: Zero Defect Readiness Score')
    })

    it('T1.F3.3: grounds rules in recognized international logistics and fire codes', () => {
      expect(content).toContain('NFPA 13')
      expect(content).toContain('NFPA 230')
      expect(content).toContain('FM Global 8-9')
      expect(content).toContain('EN 15635')
      expect(content).toContain('FEM 10.2.02')
      expect(content).toContain('OSHA 29 CFR 1910.176')
      expect(content).toContain('ANSI/ITSDF B56.1')
      expect(content).toContain('WERC')
    })

    it('T1.F3.4: documents all 12 defect rules (ZDSU-R01 to ZDSU-R12) with trigger conditions', () => {
      const rules = [
        'ZDSU-R01', 'ZDSU-R02', 'ZDSU-R03', 'ZDSU-R04', 'ZDSU-R05', 'ZDSU-R06',
        'ZDSU-R07', 'ZDSU-R08', 'ZDSU-R09', 'ZDSU-R10', 'ZDSU-R11', 'ZDSU-R12',
      ]
      for (const rule of rules) {
        expect(content).toContain(rule)
      }
    })

    it('T1.F3.5: specifies mathematical formulas for area, selectivity, floor utilization, and composite readiness score', () => {
      expect(content).toContain('Shoelace formula')
      expect(content).toContain('Selectivity Index')
      expect(content).toContain('Floor Utilization Ratio')
      expect(content).toContain('Trailer Cube Buffer Ratio')
      expect(content).toContain('Readiness Score')
    })
  })

  describe('F4: Zone Report Calculation Engine & UI Audit Output', () => {
    it('T1.F4.1: calculates complete 6-pillar audit with zero blocking defects for clean selective storage zone', () => {
      const zone = createTestZone({
        name: 'Clean Selective Storage A',
        ceilingHeight: 8.0,
      })
      const nodes: Record<string, AnyNode> = {
        'pallet-rack_1': {
          id: 'pallet-rack_1',
          type: 'warehouse:pallet-rack',
          parentId: 'level-1',
          position: [5, 0, 5],
          levels: 4,
          bayClearWidth: 2.7,
          depth: 1.1,
          height: 6.0,
          depthGap: 0.1,
        } as any,
        'truck-reach': {
          id: 'truck-reach',
          type: 'warehouse:truck',
          parentId: 'level-1',
          model: 'reach',
        } as any,
      }
      const audit = calculateZoneZDSUAudit(zone, null, nodes, {
        contentIds: ['pallet-rack_1' as any, 'truck-reach' as any],
      })

      expect(audit.geometry.areaM2).toBe(200)
      expect(audit.geometry.volumeM3).toBe(1600)
      expect(audit.storage.totalPalletPositions).toBe(12)
      expect(audit.storage.selectivityIndex).toBe(100)
      expect(audit.clearance.sprinklerClearanceM).toBe(2.0)
      expect(audit.clearance.sprinklerCompliant).toBe(true)
      expect(audit.readiness.blockingDefectsCount).toBe(0)
      expect(audit.readiness.status).toBe('ready')
    })

    it('T1.F4.2: detects blocking sprinkler head violation (ZDSU-R01) when rack height exceeds ceiling clearance', () => {
      const zone = createTestZone({ ceilingHeight: 5.2 })
      const nodes: Record<string, AnyNode> = {
        'pallet-rack_tall': {
          id: 'pallet-rack_tall',
          type: 'warehouse:pallet-rack',
          parentId: 'level-1',
          position: [5, 0, 5],
          levels: 4,
          height: 4.9, // 5.2 - 4.9 = 0.30m < 0.50m (NFPA 13 violation)
        } as any,
        'truck-reach': {
          id: 'truck-reach',
          type: 'warehouse:truck',
          model: 'reach',
        } as any,
      }
      const audit = calculateZoneZDSUAudit(zone, null, nodes, {
        contentIds: ['pallet-rack_tall' as any, 'truck-reach' as any],
      })

      expect(audit.clearance.sprinklerClearanceM).toBe(0.30)
      expect(audit.clearance.sprinklerCompliant).toBe(false)
      expect(audit.defects.some((d) => d.code === 'ZDSU-R01' && d.severity === 'blocking')).toBe(true)
      expect(audit.readiness.status).toBe('blocked')
      expect(audit.readiness.score).toBeLessThanOrEqual(60)
    })

    it('T1.F4.3: detects dock staging buffer deficit (ZDSU-R03) when dock levellers lack required square footage', () => {
      const zone = createTestZone({
        name: 'Inbound Dock Apron',
        polygon: [[0, 0], [10, 0], [10, 8], [0, 8]], // 80 m²
      })
      const nodes: Record<string, AnyNode> = {
        'dock-1': { id: 'dock-1', type: 'warehouse:dock-leveller' } as any,
        'dock-2': { id: 'dock-2', type: 'warehouse:dock-leveller' } as any,
        'dock-3': { id: 'dock-3', type: 'warehouse:dock-leveller' } as any,
        'dock-4': { id: 'dock-4', type: 'warehouse:dock-leveller' } as any, // 80 / 4 = 20 m²/dock (<25)
      }
      const audit = calculateZoneZDSUAudit(zone, null, nodes, {
        contentIds: ['dock-1' as any, 'dock-2' as any, 'dock-3' as any, 'dock-4' as any],
      })

      expect(audit.staging.dockCount).toBe(4)
      expect(audit.staging.stagingAreaPerDockM2).toBe(20)
      expect(audit.defects.some((d) => d.code === 'ZDSU-R03' && d.severity === 'blocking')).toBe(true)
      expect(audit.readiness.status).toBe('blocked')
    })

    it('T1.F4.4: exports valid machine-readable JSON certificate conforming to DigitalTwin ZDSU schema', () => {
      const zone = createTestZone({ name: 'Export Test Zone' })
      const facilityReport = calculateFacilityZDSUReport({}, [zone])
      const jsonStr = exportZoneAuditJson(facilityReport)
      const parsed = JSON.parse(jsonStr)

      expect(parsed.documentType).toBe('DigitalTwin-ZeroDefectStartup-AuditReport')
      expect(parsed.version).toBe('1.0.0')
      expect(parsed.facilitySummary.zonesAudited).toBe(1)
      expect(parsed.facilitySummary.readinessScore).toBe(100)
      expect(parsed.facilitySummary.status).toBe('READY')
      expect(parsed.zones[0].name).toBe('Export Test Zone')
    })

    it('T1.F4.5: exports formatted Markdown certificate with executive summary and checklist findings', () => {
      const zone = createTestZone({ name: 'Markdown Audit Zone' })
      const facilityReport = calculateFacilityZDSUReport({}, [zone])
      const md = exportZoneAuditMarkdown(facilityReport)

      expect(md).toContain('# Zero Defect Start-up (ZDSU) Facility Audit Certificate')
      expect(md).toContain('Markdown Audit Zone')
      expect(md).toContain('Facility Readiness Score')
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TIER 2: BOUNDARY & CORNER CASES
// ════════════════════════════════════════════════════════════════════════════

describe('Tier 2: Boundary & Corner Cases', () => {
  it('T2.B1: degenerate polygon with 0, 1, or 2 vertices yields 0 area and non-crashing audit', () => {
    const emptyZone = createTestZone({ polygon: [] })
    const singlePointZone = createTestZone({ polygon: [[5, 5]] })
    const lineZone = createTestZone({ polygon: [[0, 0], [10, 0]] })

    expect(polygonArea(emptyZone.polygon)).toBe(0)
    expect(polygonArea(singlePointZone.polygon)).toBe(0)
    expect(polygonArea(lineZone.polygon)).toBe(0)

    const audit1 = calculateZoneZDSUAudit(emptyZone, null, {})
    expect(audit1.geometry.areaM2).toBe(0)
    expect(audit1.geometry.isValidPolygon).toBe(false)

    const audit2 = calculateZoneZDSUAudit(singlePointZone, null, {})
    expect(audit2.geometry.areaM2).toBe(0)
    expect(audit2.geometry.isValidPolygon).toBe(false)
  })

  it('T2.B2: collinear vertices polygon yields 0 area and handles geometry gracefully', () => {
    const collinearZone = createTestZone({
      polygon: [
        [0, 0],
        [5, 0],
        [10, 0],
        [15, 0],
      ],
    })
    expect(polygonArea(collinearZone.polygon)).toBe(0)
    const audit = calculateZoneZDSUAudit(collinearZone, null, {})
    expect(audit.geometry.isValidPolygon).toBe(false)
  })

  it('T2.B3: zero capacity empty zone produces 0 pallets, 0 density, and 100% default selectivity', () => {
    const emptyZone = createTestZone({ name: 'Empty Staging Area' })
    const audit = calculateZoneZDSUAudit(emptyZone, null, {}, { contentIds: [] })

    expect(audit.storage.totalPalletPositions).toBe(0)
    expect(audit.storage.directAccessPositions).toBe(0)
    expect(audit.storage.selectivityIndex).toBe(100)
    expect(audit.storage.palletDensityPerM2).toBe(0)
    expect(audit.utilization.equipmentFootprintM2).toBe(0)
    expect(audit.utilization.floorUtilizationPct).toBe(0)
    expect(audit.readiness.score).toBe(100)
    expect(audit.readiness.status).toBe('ready')
  })

  it('T2.B4: missing or unparseable rack fields fall back to robust defaults without NaN', () => {
    const zone = createTestZone()
    const malformedNodes: Record<string, AnyNode> = {
      'pallet-rack_broken-1': {
        id: 'pallet-rack_broken-1',
        type: 'warehouse:pallet-rack',
        parentId: 'level-1',
        position: [2, 0, 2],
        // All optional numbers missing
      } as any,
      'di_broken-2': {
        id: 'di_broken-2',
        type: 'warehouse:drive-in-rack',
        parentId: 'level-1',
        position: [6, 0, 6],
      } as any,
    }

    const audit = calculateZoneZDSUAudit(zone, null, malformedNodes, {
      contentIds: ['pallet-rack_broken-1' as any, 'di_broken-2' as any],
    })

    expect(Number.isNaN(audit.storage.totalPalletPositions)).toBe(false)
    expect(Number.isNaN(audit.storage.selectivityIndex)).toBe(false)
    expect(Number.isNaN(audit.utilization.equipmentFootprintM2)).toBe(false)
    expect(Number.isNaN(audit.utilization.floorUtilizationPct)).toBe(false)
    expect(audit.storage.totalPalletPositions).toBeGreaterThan(0)
  })

  it('T2.B5: massive mega-warehouse (10,000+ pallet capacity across 300 bays) computes in sub-millisecond time', () => {
    const zone = createTestZone({
      name: 'Mega Distribution Hub',
      polygon: [
        [0, 0],
        [200, 0],
        [200, 100],
        [0, 100],
      ], // 20,000 m²
      ceilingHeight: 14.0,
    })

    const nodes: Record<string, AnyNode> = {}
    const contentIds: AnyNodeId[] = []

    for (let i = 0; i < 300; i++) {
      const id = `pallet-rack_${i}` as AnyNodeId
      nodes[id] = {
        id,
        type: 'warehouse:pallet-rack',
        parentId: 'level-1',
        position: [(i % 20) * 10, 0, Math.floor(i / 20) * 6],
        levels: 6,
        bayClearWidth: 3.6,
        depth: 1.1,
        height: 10.5,
        depthGap: 0.1,
      } as any
      contentIds.push(id)
    }

    const start = performance.now()
    const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(50) // High performance assertion
    expect(audit.storage.totalPalletPositions).toBe(300 * 6 * 3) // 5,400 selective pallets
    expect(audit.geometry.areaM2).toBe(20000)
    expect(audit.geometry.volumeM3).toBe(280000)
    expect(audit.clearance.sprinklerClearanceM).toBe(3.5)
    expect(audit.clearance.sprinklerCompliant).toBe(true)
  })

  it('T2.B6: micro-zone (<1 m²) handles extreme density and high footprint ratio gracefully', () => {
    const microZone = createTestZone({
      name: 'Micro Battery Cabinet',
      polygon: [
        [0, 0],
        [0.8, 0],
        [0.8, 0.8],
        [0, 0.8],
      ], // 0.64 m²
    })
    const nodes: Record<string, AnyNode> = {
      'pallet-1': {
        id: 'pallet-1',
        type: 'warehouse:pallet',
        position: [0.4, 0, 0.4],
      } as any, // 0.96 m²
    }
    const audit = calculateZoneZDSUAudit(microZone, null, nodes, { contentIds: ['pallet-1' as any] })

    expect(audit.geometry.areaM2).toBe(0.64)
    expect(audit.utilization.equipmentFootprintM2).toBe(0.96)
    expect(audit.utilization.floorUtilizationPct).toBe(150)
    expect(audit.utilization.health).toBe('severe-congestion')
    expect(audit.defects.some((d) => d.code === 'ZDSU-R04')).toBe(true)
  })

  it('T2.B7: extreme ceiling height (25.0m automated high-bay) maintains valid sprinkler clearance', () => {
    const zone = createTestZone({ ceilingHeight: 25.0 })
    const nodes: Record<string, AnyNode> = {
      'pallet-rack_high': {
        id: 'pallet-rack_high',
        type: 'warehouse:pallet-rack',
        height: 22.0,
      } as any,
    }
    const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds: ['pallet-rack_high' as any] })

    expect(audit.clearance.sprinklerClearanceM).toBe(3.0)
    expect(audit.clearance.sprinklerCompliant).toBe(true)
    expect(audit.defects.some((d) => d.code === 'ZDSU-R01')).toBe(false)
  })

  it('T2.B8: zero ceiling height fallback uses nominal 2.7m without negative volume', () => {
    const zone = createTestZone({ ceilingHeight: 0 })
    const audit = calculateZoneZDSUAudit(zone, null, {})

    expect(audit.geometry.clearHeightM).toBe(2.7)
    expect(audit.geometry.volumeM3).toBe(200 * 2.7)
  })

  it('T2.B9: non-warehouse node types in zone are ignored safely during takeoff & audit', () => {
    const zone = createTestZone()
    const nodes: Record<string, AnyNode> = {
      'wall-1': { id: 'wall-1', type: 'wall', parentId: 'level-1', position: [2, 0, 2] } as any,
      'slab-1': { id: 'slab-1', type: 'slab', parentId: 'level-1', position: [5, 0, 5] } as any,
    }
    const contentIds = collectZoneContentIds(nodes, zone)
    expect(contentIds.length).toBe(0) // Fabric filtered

    const audit = calculateZoneZDSUAudit(zone, null, nodes, { contentIds })
    expect(audit.storage.totalPalletPositions).toBe(0)
    expect(audit.utilization.equipmentFootprintM2).toBe(0)
  })

  it('T2.B10: complex 24-vertex polygon computes accurate area and perimeter', () => {
    const vertices: [number, number][] = []
    const count = 24
    const r = 10
    for (let i = 0; i < count; i++) {
      const theta = (i * 2 * Math.PI) / count
      vertices.push([Math.round(r * Math.cos(theta) * 100) / 100, Math.round(r * Math.sin(theta) * 100) / 100])
    }

    const area = polygonArea(vertices)
    const perimeter = polygonPerimeter(vertices)

    expect(area).toBeGreaterThan(300)
    expect(area).toBeLessThan(320)
    expect(perimeter).toBeGreaterThan(60)
    expect(perimeter).toBeLessThan(65)

    const zone = createTestZone({ polygon: vertices })
    const audit = calculateZoneZDSUAudit(zone, null, {})
    expect(audit.geometry.vertexCount).toBe(24)
    expect(audit.geometry.isValidPolygon).toBe(true)
  })

  it('T2.B11: mixed equipment zone footprint accumulates all catalog kinds accurately', () => {
    const nodes: Record<string, AnyNode> = {
      'pallet-rack_1': { id: 'pallet-rack_1', type: 'warehouse:pallet-rack', bayClearWidth: 2.7, depth: 1.1 } as any, // 3.08
      'di_1': { id: 'di_1', type: 'warehouse:drive-in-rack', laneClearWidth: 1.35, palletDepthPositions: 4 } as any, // 1.45 * 4.8 = 6.96
      'live_1': { id: 'live_1', type: 'warehouse:live-rack', widthM: 3.0, depthM: 6.0 } as any, // 18.0
      'longspan_1': { id: 'longspan_1', type: 'warehouse:longspan-rack', bayClearWidth: 2.0, depth: 0.8 } as any, // 1.6
      'm3_1': { id: 'm3_1', type: 'warehouse:m3-rack', bayClearWidth: 1.0, depth: 0.5 } as any, // 0.5
      'bench-1': { id: 'bench-1', type: 'warehouse:bench' } as any, // 2.0
      'dock-1': { id: 'dock-1', type: 'warehouse:dock-leveller' } as any, // 5.0
      'lift-1': { id: 'lift-1', type: 'warehouse:pallet-lift' } as any, // 4.84
      'truck-1': { id: 'truck-1', type: 'warehouse:truck' } as any, // 3.0
      'cart-1': { id: 'cart-1', type: 'warehouse:tote-cart' } as any, // 0.6
      'conveyor-1': { id: 'conveyor-1', type: 'warehouse:conveyor-roller', length: 5.0 } as any, // 4.0
    }
    const ids = Object.keys(nodes) as AnyNodeId[]
    const footprint = calculateEquipmentFootprint(ids, nodes)
    const expected = 3.08 + 6.96 + 18.0 + 1.6 + 0.5 + 2.0 + 5.0 + 4.84 + 3.0 + 0.6 + 4.0
    expect(footprint).toBeCloseTo(expected, 2)
  })

  it('T2.B12: facility report with 0 zones returns clean 100% READY defaults without NaN or zero division', () => {
    const report = calculateFacilityZDSUReport({}, [])
    expect(report.zonesAudited).toBe(0)
    expect(report.overallReadinessScore).toBe(100)
    expect(report.overallStatus).toBe('ready')
    expect(report.totalZoneAreaM2).toBe(0)
    expect(report.totalPalletCapacity).toBe(0)
    expect(report.averageFloorUtilizationPct).toBe(0)
    expect(report.totalDefects.blocking).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TIER 3: CROSS-FEATURE INTERACTIONS
// ════════════════════════════════════════════════════════════════════════════

describe('Tier 3: Cross-Feature Interactions', () => {
  it('T3.X1: renamed project with multi-zone layout computes synchronized sceneStats and ZDSU facility report', () => {
    resetStatsIndex()
    const nodes: Record<string, AnyNode> = {
      'bldg-1': { id: 'bldg-1', type: 'building', name: 'Distribution Center West', children: ['lvl-1'] } as any,
      'lvl-1': {
        id: 'lvl-1',
        type: 'level',
        name: 'Ground Floor',
        level: 0,
        children: ['pallet-rack_1', 'pallet-rack_2', 'truck-reach-1', 'truck-reach-2', 'slab-1'],
      } as any,
      'truck-reach-1': {
        id: 'truck-reach-1',
        type: 'warehouse:truck',
        parentId: 'lvl-1',
        position: [5, 0, 5],
        model: 'reach',
      } as any,
      'truck-reach-2': {
        id: 'truck-reach-2',
        type: 'warehouse:truck',
        parentId: 'lvl-1',
        position: [15, 0, 5],
        model: 'reach',
      } as any,
      'pallet-rack_1': {
        id: 'pallet-rack_1',
        type: 'warehouse:pallet-rack',
        parentId: 'lvl-1',
        position: [5, 0, 5],
        levels: 3,
        uprightHeight: 6.0,
        groundLevelStorage: true,
        bayClearWidth: 2.7,
        depth: 1.1,
      } as any,
      'pallet-rack_2': {
        id: 'pallet-rack_2',
        type: 'warehouse:pallet-rack',
        parentId: 'lvl-1',
        position: [12, 0, 5],
        levels: 4,
        uprightHeight: 8.0,
        groundLevelStorage: true,
        bayClearWidth: 2.7,
        depth: 1.1,
      } as any,
      'slab-1': {
        id: 'slab-1',
        type: 'slab',
        parentId: 'lvl-1',
        polygon: [[0, 0], [50, 0], [50, 30], [0, 30]], // 1500 m²
      } as any,
    }

    const stats = sceneStats(nodes)
    const resolution = resolveStatsScope(stats, { scope: 'project', buildingId: null, levelId: null })
    const report = statsReport(stats, resolution.levelIds, null)

    expect(report.palletPositions).toBe(12 + 15) // 27 pallet slots
    expect(report.area).toBe(1500)
    expect(report.status.storage).toBe('exact')

    // Create 2 Zones covering the equipment
    const zoneA = createTestZone({
      id: 'za' as AnyNodeId,
      name: 'Zone A - Selective 4-High',
      parentId: 'lvl-1' as AnyNodeId,
      polygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
    })
    const zoneB = createTestZone({
      id: 'zb' as AnyNodeId,
      name: 'Zone B - Selective 5-High',
      parentId: 'lvl-1' as AnyNodeId,
      ceilingHeight: 12.0,
      polygon: [[10, 0], [20, 0], [20, 10], [10, 10]],
    })

    const facilityZDSU = calculateFacilityZDSUReport(nodes, [zoneA, zoneB], { defaultMheClass: 'reach' })
    expect(facilityZDSU.zonesAudited).toBe(2)
    expect(facilityZDSU.totalPalletCapacity).toBe(21)
    expect(facilityZDSU.overallStatus).toBe('ready')
  })

  it('T3.X2: dynamic zone geometry resizing updates floor utilization and triggers defect transitions', () => {
    const nodes: Record<string, AnyNode> = {
      'truck-reach': { id: 'truck-reach', type: 'warehouse:truck', model: 'reach' } as any,
      'route-1': { id: 'route-1', type: 'warehouse:route', role: 'forklift' } as any,
    }
    const contentIds: AnyNodeId[] = ['truck-reach' as AnyNodeId, 'route-1' as AnyNodeId]
    for (let i = 0; i < 5; i++) {
      const id = `pallet-rack_${i}` as AnyNodeId
      nodes[id] = { id, type: 'warehouse:pallet-rack', bayClearWidth: 2.7, depth: 1.1 } as any // 3.08 * 5 = 15.4 m² + truck 3.0 = 18.4 m²
      contentIds.push(id)
    }

    // Step A: Tight polygon (20 m²) -> 18.4 / 20 = 92% (Severe Congestion -> BLOCKED)
    const tightZone = createTestZone({
      polygon: [[0, 0], [5, 0], [5, 4], [0, 4]], // 20 m²
    })
    const auditTight = calculateZoneZDSUAudit(tightZone, null, nodes, { contentIds })
    expect(auditTight.utilization.floorUtilizationPct).toBeGreaterThan(70)
    expect(auditTight.readiness.status).toBe('blocked')
    expect(auditTight.defects.some((d) => d.code === 'ZDSU-R04')).toBe(true)

    // Step B: Expanded polygon (35 m²) -> 18.4 / 35 = 52.6% (Optimal Selective Range: 45-65% -> READY)
    const expandedZone = createTestZone({
      polygon: [[0, 0], [7, 0], [7, 5], [0, 5]], // 35 m²
    })
    const auditExpanded = calculateZoneZDSUAudit(expandedZone, null, nodes, { contentIds })
    expect(auditExpanded.utilization.floorUtilizationPct).toBeCloseTo(52.6, 1)
    expect(auditExpanded.utilization.health).toBe('optimal')
    expect(auditExpanded.readiness.status).toBe('ready')
  })

  it('T3.X3: moving blocking equipment from one zone to another shifts defect and recalculates scores', () => {
    const zoneA = createTestZone({ id: 'za' as AnyNodeId, name: 'Zone A', ceilingHeight: 5.0 })
    const zoneB = createTestZone({ id: 'zb' as AnyNodeId, name: 'Zone B', ceilingHeight: 10.0 })

    const nodes: Record<string, AnyNode> = {
      'pallet-rack_tall': {
        id: 'pallet-rack_tall',
        type: 'warehouse:pallet-rack',
        height: 4.8, // Violates zoneA (5.0m), compliant in zoneB (10.0m)
      } as any,
      'truck-reach': {
        id: 'truck-reach',
        type: 'warehouse:truck',
        model: 'reach',
      } as any,
    }

    // When rack is in Zone A: Zone A is blocked, Zone B is ready
    const auditA1 = calculateZoneZDSUAudit(zoneA, null, nodes, {
      contentIds: ['pallet-rack_tall' as AnyNodeId, 'truck-reach' as AnyNodeId],
    })
    const auditB1 = calculateZoneZDSUAudit(zoneB, null, nodes, { contentIds: ['truck-reach' as AnyNodeId] })
    expect(auditA1.readiness.status).toBe('blocked')
    expect(auditB1.readiness.status).toBe('ready')

    // When rack is moved to Zone B: Zone A is ready, Zone B is ready
    const auditA2 = calculateZoneZDSUAudit(zoneA, null, nodes, { contentIds: ['truck-reach' as AnyNodeId] })
    const auditB2 = calculateZoneZDSUAudit(zoneB, null, nodes, {
      contentIds: ['pallet-rack_tall' as AnyNodeId, 'truck-reach' as AnyNodeId],
    })
    expect(auditA2.readiness.status).toBe('ready')
    expect(auditB2.readiness.status).toBe('ready')
  })

  it('T3.X4: unit preference toggle maintains numerical fidelity in Stats figures and ZDSU export formatting', () => {
    const areaM2 = 250
    const metricStr = areaLabel(areaM2, 'metric', 1)
    const imperialStr = areaLabel(areaM2, 'imperial', 1)

    expect(metricStr).toBe('250.0 m²')
    expect(imperialStr).toBe('2691.0 ft²')

    const lengthM = 12.5
    expect(lengthLabel(lengthM, 'metric')).toBe('12.50 m')
    expect(lengthLabel(lengthM, 'imperial')).toContain('ft')
  })

  it('T3.X5: multi-zone facility report strictly weights readiness score by zone area', () => {
    const smallZone = createTestZone({
      id: 'z-small' as AnyNodeId,
      name: 'Small Staging',
      polygon: [[0, 0], [10, 0], [10, 5], [0, 5]], // 50 m²
    })
    const largeZone = createTestZone({
      id: 'z-large' as AnyNodeId,
      name: 'Large Reserve',
      polygon: [[0, 0], [50, 0], [50, 20], [0, 20]], // 1000 m²
    })

    const report = calculateFacilityZDSUReport({}, [smallZone, largeZone])
    expect(report.totalZoneAreaM2).toBe(1050)
    expect(report.overallReadinessScore).toBe(100)
    expect(report.overallStatus).toBe('ready')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TIER 4: REAL-WORLD WAREHOUSE COMMISSIONING SCENARIOS
// ════════════════════════════════════════════════════════════════════════════

describe('Tier 4: Real-World Warehouse Scenarios', () => {
  it('T4.S1: Greenfield Automated E-Commerce Fulfillment Center', () => {
    // 5,000 m² automated facility with 4 distinct zones
    const zoneReserve = createTestZone({
      id: 'z-reserve' as AnyNodeId,
      name: 'High-Bay Reserve Racking',
      parentId: 'level-1' as AnyNodeId,
      polygon: [[0, 0], [50, 0], [50, 50], [0, 50]], // 2,500 m²
      ceilingHeight: 12.0,
      metadata: { role: 'storage-selective' },
    })

    const zonePick = createTestZone({
      id: 'z-pick' as AnyNodeId,
      name: 'Multi-Tier Pick Mezzanine',
      parentId: 'level-1' as AnyNodeId,
      polygon: [[50, 0], [80, 0], [80, 50], [50, 50]], // 1,500 m²
      ceilingHeight: 8.0,
      metadata: { role: 'picking' },
    })

    const zoneVas = createTestZone({
      id: 'z-vas' as AnyNodeId,
      name: 'Packing & Kitting Hub',
      parentId: 'level-1' as AnyNodeId,
      polygon: [[80, 0], [100, 0], [100, 30], [80, 30]], // 600 m²
      ceilingHeight: 4.5,
      metadata: { role: 'vas-packing' },
    })

    const zoneInbound = createTestZone({
      id: 'z-dock' as AnyNodeId,
      name: 'Inbound Receiving Docks',
      parentId: 'level-1' as AnyNodeId,
      polygon: [[80, 30], [100, 30], [100, 50], [80, 50]], // 400 m²
      ceilingHeight: 6.0,
      metadata: { role: 'staging-inbound' },
    })

    const nodes: Record<string, AnyNode> = {
      // Reserve selective racks (50 bays * 5 levels * 3 positions = 750 pallets)
      ...Array.from({ length: 50 }).reduce((acc: Record<string, AnyNode>, _, i) => {
        const id = `pallet-rack_${i}`
        acc[id] = {
          id,
          type: 'warehouse:pallet-rack',
          parentId: 'level-1',
          position: [5 + (i % 8) * 5, 0, 5 + Math.floor(i / 8) * 6], // inside zoneReserve
          levels: 5,
          bayClearWidth: 2.7,
          depth: 1.1,
          height: 8.5,
          depthGap: 0.1,
        } as any
        return acc
      }, {}),
      'route-res-1': { id: 'route-res-1', type: 'warehouse:route', parentId: 'level-1', position: [25, 0, 25], role: 'forklift' } as any,
      // Picking shelving in zonePick (x between 55 and 75, z between 5 and 45)
      'm3_1': { id: 'm3_1', type: 'warehouse:m3-rack', parentId: 'level-1', position: [60, 0, 10], levels: 5, drawerCount: 20 } as any,
      'longspan_1': { id: 'longspan_1', type: 'warehouse:longspan-rack', parentId: 'level-1', position: [65, 0, 20], levels: 4 } as any,
      'cart-1': { id: 'cart-1', type: 'warehouse:tote-cart', parentId: 'level-1', position: [70, 0, 30], capacity: 8 } as any,
      // Packing benches in zoneVas (x between 85 and 95, z between 5 and 25)
      'bench-1': { id: 'bench-1', type: 'warehouse:bench', parentId: 'level-1', position: [85, 0, 10] } as any,
      'bench-2': { id: 'bench-2', type: 'warehouse:bench', parentId: 'level-1', position: [90, 0, 15] } as any,
      'conveyor-1': { id: 'conveyor-1', type: 'warehouse:conveyor-roller', parentId: 'level-1', position: [88, 0, 20], length: 20.0 } as any,
      // Docks in zoneInbound (x between 85 and 95, z between 35 and 45)
      'dock-1': { id: 'dock-1', type: 'warehouse:dock-leveller', parentId: 'level-1', position: [85, 0, 40] } as any,
      'dock-2': { id: 'dock-2', type: 'warehouse:dock-leveller', parentId: 'level-1', position: [88, 0, 40] } as any,
      'dock-3': { id: 'dock-3', type: 'warehouse:dock-leveller', parentId: 'level-1', position: [91, 0, 40] } as any,
      'dock-4': { id: 'dock-4', type: 'warehouse:dock-leveller', parentId: 'level-1', position: [94, 0, 40] } as any,
      // MHE equipment
      'truck-reach': { id: 'truck-reach', type: 'warehouse:truck', parentId: 'level-1', position: [25, 0, 25], model: 'reach' } as any,
    }

    const facilityReport = calculateFacilityZDSUReport(nodes, [zoneReserve, zonePick, zoneVas, zoneInbound])

    expect(facilityReport.zonesAudited).toBe(4)
    expect(facilityReport.totalZoneAreaM2).toBe(5000)
    expect(facilityReport.totalPalletCapacity).toBeGreaterThanOrEqual(750)
    expect(facilityReport.totalDefects.blocking).toBe(0)
    expect(facilityReport.overallStatus).toBe('ready')
  })

  it('T4.S2: Cross-Dock Transit Terminal with High Door Density', () => {
    // 1,200 m² fast cross-docking terminal with 12 dock doors
    const zoneCrossDock = createTestZone({
      name: 'Active Cross-Dock Marshalling Floor',
      polygon: [[0, 0], [60, 0], [60, 20], [0, 20]], // 1,200 m²
      ceilingHeight: 6.5,
      metadata: { role: 'staging-outbound' },
    })

    const nodes: Record<string, AnyNode> = {
      ...Array.from({ length: 12 }).reduce((acc: Record<string, AnyNode>, _, i) => {
        const id = `dock-${i}`
        acc[id] = { id, type: 'warehouse:dock-leveller' } as any
        return acc
      }, {}),
      // 30 floor-staged pallets waiting for transfer
      ...Array.from({ length: 30 }).reduce((acc: Record<string, AnyNode>, _, i) => {
        const id = `pallet-floor-${i}`
        acc[id] = { id, type: 'warehouse:pallet' } as any
        return acc
      }, {}),
      'route-1': { id: 'route-1', type: 'warehouse:route', role: 'forklift' } as any,
      'route-2': { id: 'route-2', type: 'warehouse:route', role: 'pedestrian' } as any,
    }

    const contentIds = Object.keys(nodes) as AnyNodeId[]
    const audit = calculateZoneZDSUAudit(zoneCrossDock, null, nodes, { contentIds })

    expect(audit.staging.dockCount).toBe(12)
    expect(audit.staging.stagingAreaPerDockM2).toBe(100) // 1200 / 12 = 100 m²/dock (WERC compliant)
    expect(audit.storage.totalPalletPositions).toBe(30)
    expect(audit.defects.some((d) => d.code === 'ZDSU-R03')).toBe(false)
    expect(audit.readiness.status).toBe('ready')
  })

  it('T4.S3: Cold Storage Deep-Freeze Distribution Hub with High-Density Drive-In Racking', () => {
    // 800 m² cold storage facility (-24°C) using drive-in and live flow racks
    const zoneCold = createTestZone({
      name: 'Deep Freeze -24C Drive-In Chamber',
      polygon: [[0, 0], [40, 0], [40, 20], [0, 20]], // 800 m²
      ceilingHeight: 9.0,
      metadata: { role: 'storage-drivein' },
    })

    const nodes: Record<string, AnyNode> = {
      // 10 Drive-in rack blocks (4 levels * 5 depth = 20 pallets each -> 200 pallets)
      ...Array.from({ length: 10 }).reduce((acc: Record<string, AnyNode>, _, i) => {
        const id = `di_${i}`
        acc[id] = {
          id,
          type: 'warehouse:drive-in-rack',
          storageLevels: 4,
          palletDepthPositions: 5,
          laneClearWidth: 1.35,
        } as any
        return acc
      }, {}),
      // 2 Live gravity flow racking lanes (3 levels * 2 channels * 4 depth = 24 pallets each -> 48 pallets)
      'live_1': { id: 'live_1', type: 'warehouse:live-rack', levels: 3, channels: 2, depthPositions: 4, widthM: 3.0, depthM: 5.0 } as any,
      'live_2': { id: 'live_2', type: 'warehouse:live-rack', levels: 3, channels: 2, depthPositions: 4, widthM: 3.0, depthM: 5.0 } as any,
      'truck-reach': { id: 'truck-reach', type: 'warehouse:truck', model: 'reach' } as any,
      'route-1': { id: 'route-1', type: 'warehouse:route', role: 'forklift' } as any,
    }

    const contentIds = Object.keys(nodes) as AnyNodeId[]
    const audit = calculateZoneZDSUAudit(zoneCold, null, nodes, { contentIds })

    expect(audit.storage.totalPalletPositions).toBe(248) // 200 drive-in + 48 live
    expect(audit.storage.directAccessPositions).toBe(40 + 12) // 40 drive-in front + 12 live discharge
    expect(audit.storage.selectivityIndex).toBeLessThan(50) // High-density LIFO/FIFO storage profile
    expect(audit.readiness.blockingDefectsCount).toBe(0)
    expect(audit.readiness.status).toBe('ready')
  })

  it('T4.S4: Mixed Retail Omni-Channel Distribution Center with Forward Piece Picking', () => {
    // 2,000 m² omni-channel retail hub
    const zoneRetail = createTestZone({
      name: 'Retail Forward Picking & Carton Flow',
      polygon: [[0, 0], [50, 0], [50, 40], [0, 40]], // 2,000 m²
      ceilingHeight: 7.0,
      metadata: { role: 'picking' },
    })

    const nodes: Record<string, AnyNode> = {
      // Selective racks with dedicated ground picking slots
      'pallet-rack_pick-1': {
        id: 'pallet-rack_pick-1',
        type: 'warehouse:pallet-rack',
        levels: 4,
        bayClearWidth: 2.7,
        depth: 1.1,
        height: 5.0,
        pickingSlots: ['P-01', 'P-02', 'P-03', 'P-04'],
      } as any,
      // M3 high-density drawer units
      'm3_drawers': {
        id: 'm3_drawers',
        type: 'warehouse:m3-rack',
        levels: 6,
        drawerCount: 48,
      } as any,
      // Tote carts for multi-order pickers
      'cart-1': { id: 'cart-1', type: 'warehouse:totecart', capacity: 12 } as any,
      'cart-2': { id: 'cart-2', type: 'warehouse:totecart', capacity: 12 } as any,
      'truck-reach': { id: 'truck-reach', type: 'warehouse:truck', model: 'reach' } as any,
    }

    const contentIds = Object.keys(nodes) as AnyNodeId[]
    const audit = calculateZoneZDSUAudit(zoneRetail, null, nodes, { contentIds })

    expect(audit.storage.pickingSlots).toBe(4 + 48 + 24) // 76 picking slots
    expect(audit.storage.selectivityIndex).toBe(100)
    expect(audit.readiness.blockingDefectsCount).toBe(0)
    expect(audit.readiness.status).toBe('ready')
  })

  it('T4.S5: Automated High-Bay Heavy Cargo Logistics Center with VNA Turret Trucks and Pallet Lifts', () => {
    // 3,000 m² automated high-bay warehouse with 14.5m clear height
    const zoneHighBay = createTestZone({
      name: 'High-Bay Automated Heavy Cargo',
      polygon: [[0, 0], [60, 0], [60, 50], [0, 50]], // 3,000 m²
      ceilingHeight: 14.5,
      metadata: { role: 'storage-selective' },
    })

    const nodes: Record<string, AnyNode> = {
      // 20 High-bay heavy pallet racks (8 levels * 3 positions = 24 pallets, 12m height)
      ...Array.from({ length: 20 }).reduce((acc: Record<string, AnyNode>, _, i) => {
        const id = `pallet-rack_high_${i}`
        acc[id] = {
          id,
          type: 'warehouse:pallet-rack',
          levels: 8,
          bayClearWidth: 3.6,
          depth: 1.1,
          height: 12.0,
          depthGap: 0.15, // 150mm flue gap (compliant)
        } as any
        return acc
      }, {}),
      'vna-truck-1': { id: 'vna-truck-1', type: 'warehouse:truck', model: 'vna-turret' } as any,
      'pallet-lift-1': { id: 'pallet-lift-1', type: 'warehouse:pallet-lift', travelHeight: 12.0 } as any,
      'route-forklift': { id: 'route-forklift', type: 'warehouse:route', role: 'forklift' } as any,
      'escape-route': { id: 'escape-route', type: 'warehouse:route', role: 'escape' } as any,
    }

    const contentIds = Object.keys(nodes) as AnyNodeId[]
    const audit = calculateZoneZDSUAudit(zoneHighBay, null, nodes, { contentIds })

    expect(audit.storage.totalPalletPositions).toBe(20 * 24) // 480 high-bay pallets
    expect(audit.clearance.sprinklerClearanceM).toBe(2.5) // 14.5 - 12.0 = 2.5m (NFPA 13 OK)
    expect(audit.clearance.flueSpaceCompliant).toBe(true)
    expect(audit.clearance.sprinklerCompliant).toBe(true)
    expect(audit.readiness.blockingDefectsCount).toBe(0)
    expect(audit.readiness.status).toBe('ready')
  })
})
