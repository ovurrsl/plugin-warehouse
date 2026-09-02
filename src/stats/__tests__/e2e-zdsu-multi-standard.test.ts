import { describe, expect, it } from 'bun:test'
import type { AnyNode, AnyNodeId, ZoneNode } from '@pascal-app/core'
import {
  calculateFacilityZDSUReport,
  calculateZoneZDSUAudit,
  exportZoneAuditJson,
  exportZoneAuditMarkdown,
} from '../zero-defect'
import type { PalletRackNode } from '../../rack/schema'
import type { MezzanineNode } from '../../mezzanine/schema'

function makeTestZone(
  id: string,
  parentId: string | null,
  name: string,
  polygon: [number, number][],
  overrides: Partial<ZoneNode> = {},
): ZoneNode {
  return {
    id: id as AnyNodeId,
    type: 'zone' as const,
    name,
    parentId: parentId as AnyNodeId | null,
    polygon,
    autoFromWalls: false,
    boundaryWallIds: [],
    spaceRole: 'storage-selective',
    roomNumber: '100',
    enclosureStatus: 'auto',
    floorFinish: 'concrete',
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

function makeSelectiveRack(
  id: string,
  parentId: string,
  name: string,
  position: [number, number, number],
  overrides: Partial<PalletRackNode> = {},
): AnyNode {
  return {
    id: id as AnyNodeId,
    type: 'warehouse:pallet-rack',
    name,
    parentId: parentId as AnyNodeId,
    position,
    rotation: [0, 0, 0],
    levels: 4,
    height: 5.5,
    bayClearWidth: 2.7,
    depth: 1.1,
    depthGap: 0.1,
    baySpacing: 2.8,
    bays: 1,
    palletPositionsPerLevel: 3,
    levelClear: 1.4,
    firstLevelClear: 1.5,
    ...overrides,
  } as unknown as AnyNode
}

function makeDriveInRack(
  id: string,
  parentId: string,
  name: string,
  position: [number, number, number],
  overrides: Record<string, unknown> = {},
): AnyNode {
  return {
    id: id as AnyNodeId,
    type: 'warehouse:drive-in-rack',
    name,
    parentId: parentId as AnyNodeId,
    position,
    storageLevels: 4,
    palletDepthPositions: 4,
    laneClearWidth: 1.35,
    ...overrides,
  } as unknown as AnyNode
}

function makeMezzanine(
  id: string,
  parentId: string,
  name: string,
  position: [number, number, number],
  tiers: { index: number; clearHeightM: number; elevationM: number }[],
): AnyNode {
  return {
    id: id as AnyNodeId,
    type: 'warehouse:mezzanine',
    name,
    parentId: parentId as AnyNodeId,
    position,
    outlinePolygon: [
      [position[0], position[2]],
      [position[0] + 10, position[2]],
      [position[0] + 10, position[2] + 10],
      [position[0], position[2] + 10],
    ],
    tiers: tiers.map((t) => ({
      index: t.index,
      elevationM: t.elevationM,
      clearHeightM: t.clearHeightM,
      deckThicknessM: 0.1,
      joistSpacingM: 0.4,
    })),
  } as unknown as AnyNode
}

describe('E2E ZDSU Multi-Standard & Deep Inspection Suite (Tiers 3 & 4)', () => {
  // ── Tier 3: Pairwise Cross-Feature Combinations ───────────────────────────

  describe('Tier 3: Pairwise Combinations', () => {
    it('T3.P1: Standard TR + Multi-Level Selective Racks + Ground Floor Zone', () => {
      const zone = makeTestZone('z-tr-g', 'lvl-g', 'TR Ground Selective Storage', [
        [0, 0],
        [40, 0],
        [40, 30],
        [0, 30],
      ])
      const rack = makeSelectiveRack('rack-tr-1', 'lvl-g', 'Selective Bay TR-1', [10, 0, 10], {
        levels: 4,
        height: 6.0,
      })
      const reachTruck: AnyNode = {
        id: 'truck-1' as AnyNodeId,
        type: 'warehouse:truck',
        parentId: 'lvl-g' as AnyNodeId,
        position: [5, 0, 5],
        model: 'reach',
      } as unknown as AnyNode
      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-g' as AnyNodeId]: { id: 'lvl-g', type: 'level', name: 'Zemin Kat', level: 0 } as AnyNode,
        ['rack-tr-1' as AnyNodeId]: rack,
        ['truck-1' as AnyNodeId]: reachTruck,
      }

      const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR', defaultMheClass: 'reach' })
      expect(audit.floorName).toBe('Zemin Kat')
      expect(audit.standardId).toBe('TR')
      expect(audit.storage.totalPalletPositions).toBe(12)
      expect(audit.clearance.sprinklerCompliant).toBe(true)
      expect(audit.readiness.status).toBe('ready')
    })

    it('T3.P2: Standard EU + Multi-Tier Mezzanine + 1st Floor Zone', () => {
      const zone = makeTestZone('z-eu-1', 'lvl-1', 'EU Level 1 Mezzanine Packing', [
        [0, 0],
        [30, 0],
        [30, 30],
        [0, 30],
      ])
      const mezz = makeMezzanine('mezz-eu-1', 'lvl-1', 'EU Dual Tier Mezzanine', [5, 0, 5], [
        { index: 1, elevationM: 3.0, clearHeightM: 2.5 },
        { index: 2, elevationM: 6.0, clearHeightM: 2.3 },
      ])
      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-1' as AnyNodeId]: { id: 'lvl-1', type: 'level', name: '1. Asma Kat', level: 1 } as AnyNode,
        ['mezz-eu-1' as AnyNodeId]: mezz,
      }

      const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU' })
      expect(audit.floorName).toBe('1. Asma Kat')
      expect(audit.standardId).toBe('EU')
      expect(audit.defects.some((d) => d.title.includes('Mezzanine Headroom'))).toBe(false)
    })

    it('T3.P3: Standard US + High-Hazard Storage + VNA Turret Truck', () => {
      const zone = makeTestZone(
        'z-us-vna',
        'lvl-0',
        'US VNA High-Bay Reserve',
        [
          [0, 0],
          [50, 0],
          [50, 30],
          [0, 30],
        ],
        { ceilingHeight: 12.0 },
      )
      const rack = makeSelectiveRack('rack-us-1', 'lvl-0', 'VNA Heavy Rack 1', [15, 0, 15], {
        levels: 6,
        height: 10.0,
      })
      const vnaTruck: AnyNode = {
        id: 'truck-vna-1' as AnyNodeId,
        type: 'warehouse:truck',
        parentId: 'lvl-0' as AnyNodeId,
        position: [5, 0, 5],
        model: 'vna-turret',
      } as unknown as AnyNode
      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-0' as AnyNodeId]: { id: 'lvl-0', type: 'level', name: 'Ground High-Bay', level: 0 } as AnyNode,
        ['rack-us-1' as AnyNodeId]: rack,
        ['truck-vna-1' as AnyNodeId]: vnaTruck,
      }

      const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'US', defaultMheClass: 'vna' })
      expect(audit.standardId).toBe('US')
      expect(audit.clearance.requiredAisleWidthM).toBeLessThanOrEqual(1.85)
      expect(audit.clearance.sprinklerClearanceM).toBe(2.0)
      expect(audit.readiness.status).toBe('ready')
    })

    it('T3.P4: Mandatory Lockout Gate + Multi-Floor Scene Graph', () => {
      const zone1 = makeTestZone('z-lock-1', 'lvl-1', 'Floor 1 Zone', [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ])
      const zone2 = makeTestZone('z-lock-2', 'lvl-2', 'Floor 2 Zone', [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ])
      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-1' as AnyNodeId]: { id: 'lvl-1', type: 'level', name: 'Floor 1', level: 1 } as AnyNode,
        ['lvl-2' as AnyNodeId]: { id: 'lvl-2', type: 'level', name: 'Floor 2', level: 2 } as AnyNode,
      }

      // Unselected standard
      const nullReport = calculateFacilityZDSUReport(nodes, [zone1, zone2], { standardId: null })
      expect(nullReport.standardId).toBeNull()

      // Selecting standard unlocks full facility report
      const trReport = calculateFacilityZDSUReport(nodes, [zone1, zone2], { standardId: 'TR' })
      expect(trReport.standardId).toBe('TR')
      expect(trReport.zoneAudits.length).toBe(2)
      expect(trReport.zoneAudits[0]?.floorName).toBe('Floor 1')
      expect(trReport.zoneAudits[1]?.floorName).toBe('Floor 2')
    })

    it('T3.P5: Standard Switch TR -> EU on Racks with 85mm Flue Space', () => {
      const zone = makeTestZone('z-flue-pair', 'lvl-g', 'Flue Inspection Bay', [
        [0, 0],
        [30, 0],
        [30, 20],
        [0, 20],
      ])
      const rack = makeSelectiveRack('rack-flue-pair', 'lvl-g', 'Rack Pair 1', [10, 0, 10], {
        depthGap: 0.085, // 85mm
      })
      const reachTruck: AnyNode = {
        id: 'truck-reach-p5' as AnyNodeId,
        type: 'warehouse:truck',
        parentId: 'lvl-g' as AnyNodeId,
        position: [5, 0, 5],
        model: 'reach',
      } as unknown as AnyNode
      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-g' as AnyNodeId]: { id: 'lvl-g', type: 'level', name: 'Ground Floor', level: 0 } as AnyNode,
        ['rack-flue-pair' as AnyNodeId]: rack,
        ['truck-reach-p5' as AnyNodeId]: reachTruck,
      }

      const trAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR', defaultMheClass: 'reach' })
      const euAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU', defaultMheClass: 'reach' })

      // TR expects 100mm -> FAILS with ZDSU-R06
      expect(trAudit.defects.some((d) => d.code === 'ZDSU-R06')).toBe(true)
      // EU expects 75mm -> PASSES
      expect(euAudit.defects.some((d) => d.code === 'ZDSU-R06')).toBe(false)
    })

    it('T3.P6: Standard Switch EU -> US on Dock Staging', () => {
      // 32 m² area with 2 dock doors = 16.0 m²/dock (< 20.0 m² critical buffer deficit for all standards)
      // 46 m² area with 2 dock doors = 23.0 m²/dock:
      // TR critical deficit limit is 20.0 m² -> PASSES critical buffer check
      // EU critical deficit limit is 25.0 m² -> FAILS with ZDSU-R03
      // US critical deficit limit is 25.0 m² -> FAILS with ZDSU-R03
      const stagingZone = makeTestZone(
        'z-dock-p6',
        'lvl-g',
        'Staging Dock Zone',
        [
          [0, 0],
          [10, 0],
          [10, 4.6],
          [0, 4.6],
        ], // 46 m²
        { spaceRole: 'staging-inbound' },
      )
      const dock1: AnyNode = {
        id: 'dock-p6-1' as AnyNodeId,
        type: 'warehouse:dock-leveller',
        parentId: 'lvl-g' as AnyNodeId,
        position: [2, 0, 2],
      } as unknown as AnyNode
      const dock2: AnyNode = {
        id: 'dock-p6-2' as AnyNodeId,
        type: 'warehouse:dock-leveller',
        parentId: 'lvl-g' as AnyNodeId,
        position: [6, 0, 2],
      } as unknown as AnyNode

      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-g' as AnyNodeId]: { id: 'lvl-g', type: 'level', name: 'Ground Floor', level: 0 } as AnyNode,
        ['dock-p6-1' as AnyNodeId]: dock1,
        ['dock-p6-2' as AnyNodeId]: dock2,
      }

      const trAudit = calculateZoneZDSUAudit(stagingZone, null, nodes, { standardId: 'TR' })
      const euAudit = calculateZoneZDSUAudit(stagingZone, null, nodes, { standardId: 'EU' })
      const usAudit = calculateZoneZDSUAudit(stagingZone, null, nodes, { standardId: 'US' })

      expect(trAudit.defects.some((d) => d.code === 'ZDSU-R03')).toBe(false)
      expect(euAudit.defects.some((d) => d.code === 'ZDSU-R03')).toBe(true)
      expect(usAudit.defects.some((d) => d.code === 'ZDSU-R03')).toBe(true)
    })

    it('T3.P7: Granular Defect Layer Badging on Multi-Floor Facility', () => {
      const zoneF1 = makeTestZone('z-mf-1', 'lvl-f1', 'Storage Floor 1', [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ], { ceilingHeight: 6.0 })
      const zoneF2 = makeTestZone('z-mf-2', 'lvl-f2', 'Mezzanine Floor 2', [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ])

      const rackF1 = makeSelectiveRack('rack-mf-1', 'lvl-f1', 'High Rack F1', [10, 0, 10], {
        levels: 4,
        height: 5.8, // 0.2m sprinkler clearance -> defect Level 4
      })
      const mezzF2 = makeMezzanine('mezz-mf-2', 'lvl-f2', 'Mezzanine F2', [5, 0, 5], [
        { index: 1, elevationM: 3.0, clearHeightM: 2.5 },
        { index: 2, elevationM: 5.5, clearHeightM: 1.8 }, // defect Tier 2
      ])

      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-f1' as AnyNodeId]: { id: 'lvl-f1', type: 'level', name: 'Zemin Kat', level: 0 } as AnyNode,
        ['lvl-f2' as AnyNodeId]: { id: 'lvl-f2', type: 'level', name: '1. Kat', level: 1 } as AnyNode,
        ['rack-mf-1' as AnyNodeId]: rackF1,
        ['mezz-mf-2' as AnyNodeId]: mezzF2,
      }

      const report = calculateFacilityZDSUReport(nodes, [zoneF1, zoneF2], { standardId: 'TR' })
      const auditF1 = report.zoneAudits.find((z) => z.zoneId === 'z-mf-1')
      const auditF2 = report.zoneAudits.find((z) => z.zoneId === 'z-mf-2')

      const rackDefect = auditF1?.defects.find((d) => d.code === 'ZDSU-R01')
      const mezzDefect = auditF2?.defects.find((d) => d.title.includes('Mezzanine Headroom'))

      expect(rackDefect?.targetLayer).toBe('Level 4')
      expect(rackDefect?.floorName).toBe('Zemin Kat')

      expect(mezzDefect?.targetLayer).toBe('Tier 2 Deck')
      expect(mezzDefect?.floorName).toBe('1. Kat')
    })

    it('T3.P8: Dynamic Equipment Movement across Floor Levels', () => {
      const zoneGround = makeTestZone('z-mv-g', 'lvl-g', 'Ground Storage', [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ])
      const zoneUpper = makeTestZone('z-mv-u', 'lvl-u', 'Upper Storage', [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ])

      // Initially rack is on Ground
      const rack: AnyNode = makeSelectiveRack('rack-moving', 'lvl-g', 'Mobile Rack Unit', [5, 0, 5])
      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-g' as AnyNodeId]: { id: 'lvl-g', type: 'level', name: 'Zemin Kat', level: 0 } as AnyNode,
        ['lvl-u' as AnyNodeId]: { id: 'lvl-u', type: 'level', name: '2. Kat', level: 2 } as AnyNode,
        ['rack-moving' as AnyNodeId]: rack,
      }

      const report1 = calculateFacilityZDSUReport(nodes, [zoneGround, zoneUpper], { standardId: 'TR' })
      expect(report1.zoneAudits[0]?.storage.totalPalletPositions).toBe(12)
      expect(report1.zoneAudits[1]?.storage.totalPalletPositions).toBe(0)

      // Move rack to Upper Level
      ;(rack as { parentId: AnyNodeId }).parentId = 'lvl-u' as AnyNodeId

      const report2 = calculateFacilityZDSUReport(nodes, [zoneGround, zoneUpper], { standardId: 'TR' })
      expect(report2.zoneAudits[0]?.storage.totalPalletPositions).toBe(0)
      expect(report2.zoneAudits[1]?.storage.totalPalletPositions).toBe(12)
    })

    it('T3.P9: Mixed Equipment (Selective + Drive-In + Mezzanine) under US Standard', () => {
      const zone = makeTestZone('z-mixed-us', 'lvl-g', 'Mega Fulfillment Hybrid Zone', [
        [0, 0],
        [60, 0],
        [60, 40],
        [0, 40],
      ], { ceilingHeight: 10.0 })

      const selectiveRack = makeSelectiveRack('rack-mix-1', 'lvl-g', 'Selective Bay', [10, 0, 10], { levels: 4 })
      const driveInRack = makeDriveInRack('rack-mix-2', 'lvl-g', 'Drive-In Lane', [25, 0, 10], {
        storageLevels: 4,
        palletDepthPositions: 4,
      })
      const mezz = makeMezzanine('mezz-mix-3', 'lvl-g', 'Pick Module Mezzanine', [40, 0, 20], [
        { index: 1, elevationM: 3.5, clearHeightM: 2.8 },
      ])
      const reachTruck: AnyNode = {
        id: 'truck-mix-4' as AnyNodeId,
        type: 'warehouse:truck',
        parentId: 'lvl-g' as AnyNodeId,
        position: [5, 0, 5],
        model: 'reach',
      } as unknown as AnyNode

      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-g' as AnyNodeId]: { id: 'lvl-g', type: 'level', name: 'Main Level', level: 0 } as AnyNode,
        ['rack-mix-1' as AnyNodeId]: selectiveRack,
        ['rack-mix-2' as AnyNodeId]: driveInRack,
        ['mezz-mix-3' as AnyNodeId]: mezz,
        ['truck-mix-4' as AnyNodeId]: reachTruck,
      }

      const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'US', defaultMheClass: 'reach' })

      // Selective: 4 * 3 = 12 pallets; Drive-In: 1 * 4 * 4 = 16 pallets => total 28 pallets
      expect(audit.storage.totalPalletPositions).toBe(28)
      expect(audit.storage.storageBreakdown.selective).toBe(12)
      expect(audit.storage.storageBreakdown.driveIn).toBe(16)
      expect(audit.readiness.status).toBe('ready')
    })

    it('T3.P10: Full Facility Export (JSON & Markdown) under all 3 standards preserves schema integrity', () => {
      const zone = makeTestZone('z-exp', 'lvl-g', 'Main Staging Area', [
        [0, 0],
        [30, 0],
        [30, 20],
        [0, 20],
      ])
      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-g' as AnyNodeId]: { id: 'lvl-g', type: 'level', name: 'Zemin Kat', level: 0 } as AnyNode,
      }

      for (const stdId of ['TR', 'EU', 'US'] as const) {
        const report = calculateFacilityZDSUReport(nodes, [zone], { standardId: stdId })
        const jsonStr = exportZoneAuditJson(report)
        const mdStr = exportZoneAuditMarkdown(report)

        const parsed = JSON.parse(jsonStr)
        expect(parsed.standardId).toBe(stdId)
        expect(parsed.facilitySummary.readinessScore).toBe(100)

        expect(mdStr).toContain(`**Regulatory Framework**:`)
        expect(mdStr).toContain('[Zemin Kat]')
      }
    })
  })

  // ── Tier 4: Real-World Warehouse Application Scenarios ───────────────────

  describe('Tier 4: Real-World Scenarios', () => {
    it('T4.S1: Multi-Storey Istanbul Logistics Center (TR/TSE)', () => {
      // 3 Floors: Bodrum Kat (-1), Zemin Kat (0), 1. Kat (1)
      const zoneBasement = makeTestZone(
        'z-ist-b1',
        'lvl-ist-b1',
        'Soğuk Hava & Rezerv Depolama',
        [
          [0, 0],
          [50, 0],
          [50, 30],
          [0, 30],
        ],
        { ceilingHeight: 6.0, spaceRole: 'storage-drivein' },
      )
      const zoneGround = makeTestZone(
        'z-ist-g',
        'lvl-ist-g',
        'Mal Kabul & Yükleme Alanı',
        [
          [0, 0],
          [60, 0],
          [60, 20],
          [0, 20],
        ], // 1200 m²
        { spaceRole: 'staging-inbound' },
      )
      const zoneFloor1 = makeTestZone(
        'z-ist-1',
        'lvl-ist-1',
        'Asma Kat Sipariş Toplama',
        [
          [0, 0],
          [40, 0],
          [40, 25],
          [0, 25],
        ],
        { ceilingHeight: 5.5, spaceRole: 'picking' },
      )

      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-ist-b1' as AnyNodeId]: { id: 'lvl-ist-b1', type: 'level', name: 'Bodrum Kat', level: -1 } as AnyNode,
        ['lvl-ist-g' as AnyNodeId]: { id: 'lvl-ist-g', type: 'level', name: 'Zemin Kat', level: 0 } as AnyNode,
        ['lvl-ist-1' as AnyNodeId]: { id: 'lvl-ist-1', type: 'level', name: '1. Kat', level: 1 } as AnyNode,

        // Bodrum: Drive-In Racks
        ['rack-ist-b1' as AnyNodeId]: makeDriveInRack('rack-ist-b1', 'lvl-ist-b1', 'Derin Dondurucu Drive-In', [10, 0, 10], {
          storageLevels: 3,
          palletDepthPositions: 5,
        }),

        // Zemin: 4 Dock Levellers + Staging Pallets
        ['dock-ist-1' as AnyNodeId]: {
          id: 'dock-ist-1' as AnyNodeId,
          type: 'warehouse:dock-leveller',
          parentId: 'lvl-ist-g' as AnyNodeId,
          position: [5, 0, 5],
        } as unknown as AnyNode,
        ['dock-ist-2' as AnyNodeId]: {
          id: 'dock-ist-2' as AnyNodeId,
          type: 'warehouse:dock-leveller',
          parentId: 'lvl-ist-g' as AnyNodeId,
          position: [15, 0, 5],
        } as unknown as AnyNode,
        ['dock-ist-3' as AnyNodeId]: {
          id: 'dock-ist-3' as AnyNodeId,
          type: 'warehouse:dock-leveller',
          parentId: 'lvl-ist-g' as AnyNodeId,
          position: [25, 0, 5],
        } as unknown as AnyNode,
        ['dock-ist-4' as AnyNodeId]: {
          id: 'dock-ist-4' as AnyNodeId,
          type: 'warehouse:dock-leveller',
          parentId: 'lvl-ist-g' as AnyNodeId,
          position: [35, 0, 5],
        } as unknown as AnyNode,

        // 1. Kat: Mezzanine Module with 2.3m headroom
        ['mezz-ist-1' as AnyNodeId]: makeMezzanine('mezz-ist-1', 'lvl-ist-1', 'Toplama Platformu', [5, 0, 5], [
          { index: 1, elevationM: 2.8, clearHeightM: 2.3 },
        ]),
      }

      const report = calculateFacilityZDSUReport(nodes, [zoneBasement, zoneGround, zoneFloor1], { standardId: 'TR' })

      expect(report.standardId).toBe('TR')
      expect(report.zonesAudited).toBe(3)
      expect(report.totalPalletCapacity).toBeGreaterThan(0)

      const auditB = report.zoneAudits.find((z) => z.zoneId === 'z-ist-b1')
      const auditG = report.zoneAudits.find((z) => z.zoneId === 'z-ist-g')
      const audit1 = report.zoneAudits.find((z) => z.zoneId === 'z-ist-1')

      expect(auditB?.floorName).toBe('Bodrum Kat')
      expect(auditG?.floorName).toBe('Zemin Kat')
      expect(audit1?.floorName).toBe('1. Kat')

      // Ground dock staging ratio: 1200 m² / 4 docks = 300 m²/dock (far exceeds 30 m² minimum)
      expect(auditG?.staging.dockCount).toBe(4)
      expect(auditG?.staging.stagingAreaPerDockM2).toBe(300)
    })

    it('T4.S2: European Automated Fulfillment Center (EU/EN)', () => {
      // High density automated European facility with Narrow Aisle Racking and EN 15620 clearance banding
      const zone = makeTestZone(
        'z-eu-auto',
        'lvl-eu-main',
        'European High-Bay Fulfillment Bay',
        [
          [0, 0],
          [80, 0],
          [80, 40],
          [0, 40],
        ],
        { ceilingHeight: 14.0 },
      )

      const rackA = makeSelectiveRack('rack-eu-a', 'lvl-eu-main', 'Automated Aisle 1', [10, 0, 10], {
        levels: 6,
        height: 11.0,
        depthGap: 0.1, // 100mm flue space compliant with EN 15620
      })
      const vnaTruck: AnyNode = {
        id: 'truck-eu-vna' as AnyNodeId,
        type: 'warehouse:truck',
        parentId: 'lvl-eu-main' as AnyNodeId,
        position: [5, 0, 5],
        model: 'vna-turret',
      } as unknown as AnyNode

      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-eu-main' as AnyNodeId]: { id: 'lvl-eu-main', type: 'level', name: 'Automated Hall A', level: 0 } as AnyNode,
        ['rack-eu-a' as AnyNodeId]: rackA,
        ['truck-eu-vna' as AnyNodeId]: vnaTruck,
      }

      const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU', defaultMheClass: 'vna' })

      expect(audit.standardId).toBe('EU')
      expect(audit.clearance.flueSpaceCompliant).toBe(true)
      expect(audit.clearance.sprinklerClearanceM).toBe(3.0) // 14m - 11m = 3m
      expect(audit.readiness.status).toBe('ready')
      expect(audit.readiness.score).toBeGreaterThanOrEqual(90)
    })

    it('T4.S3: US East Coast Distribution Hub (US/NFPA)', () => {
      // Large distribution hub evaluated against NFPA 13 / OSHA 1910
      const zone = makeTestZone(
        'z-us-dist',
        'lvl-us-main',
        'US East Coast Bulk Reserve',
        [
          [0, 0],
          [100, 0],
          [100, 50],
          [0, 50],
        ],
        { ceilingHeight: 11.0 },
      )

      // Offending rack violating sprinkler clearance: 10.7m rack in 11.0m ceiling => 0.30m clearance (< 0.457m US standard)
      const tallRack = makeSelectiveRack('rack-us-tall', 'lvl-us-main', 'Bulk Rack Ultra', [20, 0, 20], {
        levels: 6,
        height: 10.7,
        depthGap: 0.08, // 80mm > 75mm (3") NFPA flue compliant
      })
      const reachTruck: AnyNode = {
        id: 'truck-us-reach' as AnyNodeId,
        type: 'warehouse:truck',
        parentId: 'lvl-us-main' as AnyNodeId,
        position: [5, 0, 5],
        model: 'reach',
      } as unknown as AnyNode

      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-us-main' as AnyNodeId]: { id: 'lvl-us-main', type: 'level', name: 'Ground Floor Hub', level: 0 } as AnyNode,
        ['rack-us-tall' as AnyNodeId]: tallRack,
        ['truck-us-reach' as AnyNodeId]: reachTruck,
      }

      const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'US', defaultMheClass: 'reach' })

      expect(audit.standardId).toBe('US')
      const sprinklerDefect = audit.defects.find((d) => d.code === 'ZDSU-R01')
      expect(sprinklerDefect).toBeDefined()
      expect(sprinklerDefect?.severity).toBe('blocking')
      expect(sprinklerDefect?.targetLayer).toBe('Level 6')
      expect(sprinklerDefect?.standardRef).toContain('NFPA 13')
      expect(audit.readiness.status).toBe('blocked')
    })

    it('T4.S4: Multi-Standard Compliance Transition (TR -> EU -> US)', () => {
      // Benchmark layout audited across TR, EU, and US sequentially
      const zone = makeTestZone(
        'z-trans',
        'lvl-t',
        'Cross-Compliance Testing Warehouse',
        [
          [0, 0],
          [40, 0],
          [40, 25],
          [0, 25],
        ],
        { ceilingHeight: 6.0 },
      )
      // Rack with 85mm flue space and 5.52m height (clearance = 0.48m)
      const rack = makeSelectiveRack('rack-trans', 'lvl-t', 'Transitional Rack', [10, 0, 10], {
        levels: 4,
        height: 5.52,
        depthGap: 0.085,
      })
      const reachTruck: AnyNode = {
        id: 'truck-reach-t4' as AnyNodeId,
        type: 'warehouse:truck',
        parentId: 'lvl-t' as AnyNodeId,
        position: [5, 0, 5],
        model: 'reach',
      } as unknown as AnyNode
      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-t' as AnyNodeId]: { id: 'lvl-t', type: 'level', name: 'Universal Floor', level: 0 } as AnyNode,
        ['rack-trans' as AnyNodeId]: rack,
        ['truck-reach-t4' as AnyNodeId]: reachTruck,
      }

      const trAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR', defaultMheClass: 'reach' })
      const euAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU', defaultMheClass: 'reach' })
      const usAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'US', defaultMheClass: 'reach' })

      // TR:
      // - Sprinkler req: 0.50m (actual 0.48m -> FAILS ZDSU-R01)
      // - Flue space req: 100mm (actual 85mm -> FAILS ZDSU-R06)
      expect(trAudit.defects.some((d) => d.code === 'ZDSU-R01')).toBe(true)
      expect(trAudit.defects.some((d) => d.code === 'ZDSU-R06')).toBe(true)
      expect(trAudit.readiness.status).toBe('blocked')

      // EU:
      // - Sprinkler req: 0.50m (actual 0.48m -> FAILS ZDSU-R01)
      // - Flue space req: 75mm (actual 85mm -> PASSES)
      expect(euAudit.defects.some((d) => d.code === 'ZDSU-R01')).toBe(true)
      expect(euAudit.defects.some((d) => d.code === 'ZDSU-R06')).toBe(false)
      expect(euAudit.readiness.status).toBe('blocked')

      // US:
      // - Sprinkler req: 0.457m (actual 0.48m -> PASSES)
      // - Flue space req: 75mm (actual 85mm -> PASSES)
      expect(usAudit.defects.some((d) => d.code === 'ZDSU-R01')).toBe(false)
      expect(usAudit.defects.some((d) => d.code === 'ZDSU-R06')).toBe(false)
      expect(usAudit.readiness.status).toBe('ready')
    })

    it('T4.S5: Mixed Mezzanine & Narrow Racking Failure Matrix', () => {
      // Pinpoints multiple distinct failures simultaneously across structural layers
      const zoneGround = makeTestZone(
        'z-matrix-g',
        'lvl-mg',
        'Ground Rack Hall',
        [
          [0, 0],
          [40, 0],
          [40, 30],
          [0, 30],
        ],
        { ceilingHeight: 6.0 },
      )
      const zoneMezz = makeTestZone(
        'z-matrix-m',
        'lvl-mm',
        'Upper Pick Mezzanine Zone',
        [
          [0, 0],
          [30, 0],
          [30, 20],
          [0, 20],
        ],
      )

      // Failure 1: Rack A Level 5 ceiling breach (height 5.8m in 6.0m ceiling => 0.20m clearance)
      const rackA = makeSelectiveRack('rack-fail-a', 'lvl-mg', 'Selective Rack A', [10, 0, 10], {
        levels: 5,
        height: 5.8,
      })
      // Failure 2: Rack B restricted beam clearance on beam level 2 (< 0.40m)
      const rackB = makeSelectiveRack('rack-fail-b', 'lvl-mg', 'Selective Rack B', [25, 0, 10], {
        levels: 4,
        height: 5.0,
        levelClear: 0.35,
        firstLevelClear: 0.35,
        levelClears: [0.35, 0.35, 0.35, 0.35],
      })
      // Failure 3: Mezzanine Tier 2 restricted headroom (1.80m < 2.0m)
      const mezz = makeMezzanine('mezz-fail-c', 'lvl-mm', 'Complex Mezzanine Structure', [5, 0, 5], [
        { index: 1, elevationM: 3.0, clearHeightM: 2.5 },
        { index: 2, elevationM: 5.5, clearHeightM: 1.8 },
      ])

      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-mg' as AnyNodeId]: { id: 'lvl-mg', type: 'level', name: 'Zemin Kat', level: 0 } as AnyNode,
        ['lvl-mm' as AnyNodeId]: { id: 'lvl-mm', type: 'level', name: 'Asma Kat 1', level: 1 } as AnyNode,
        ['rack-fail-a' as AnyNodeId]: rackA,
        ['rack-fail-b' as AnyNodeId]: rackB,
        ['mezz-fail-c' as AnyNodeId]: mezz,
      }

      const report = calculateFacilityZDSUReport(nodes, [zoneGround, zoneMezz], { standardId: 'TR' })

      const auditGround = report.zoneAudits.find((z) => z.zoneId === 'z-matrix-g')
      const auditMezz = report.zoneAudits.find((z) => z.zoneId === 'z-matrix-m')

      // Check Failure 1
      const sprinklerDefect = auditGround?.defects.find((d) => d.targetNodeId === 'rack-fail-a' && d.code === 'ZDSU-R01')
      expect(sprinklerDefect).toBeDefined()
      expect(sprinklerDefect?.targetLayer).toBe('Level 5')

      // Check Failure 2
      const beamOpeningDefect = auditGround?.defects.find((d) => d.targetNodeId === 'rack-fail-b' && d.title === 'Restricted Rack Beam Level Opening')
      expect(beamOpeningDefect).toBeDefined()
      expect(beamOpeningDefect?.targetLayer).toContain('Level')

      // Check Failure 3
      const headroomDefect = auditMezz?.defects.find((d) => d.targetNodeId === 'mezz-fail-c')
      expect(headroomDefect).toBeDefined()
      expect(headroomDefect?.targetLayer).toBe('Tier 2 Deck')
      expect(headroomDefect?.floorName).toBe('Asma Kat 1')
    })
  })
})
