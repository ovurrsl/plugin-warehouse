import { describe, expect, it } from 'bun:test'
import type { AnyNode, AnyNodeId, ZoneNode } from '@pascal-app/core'
import {
  calculateFacilityZDSUReport,
  calculateZoneZDSUAudit,
  exportZoneAuditJson,
  exportZoneAuditMarkdown,
} from '../zero-defect'

function makeTestZone(id: string, parentId: string | null, name = 'Zone A', overrides: Partial<ZoneNode> = {}): ZoneNode {
  return {
    id: id as AnyNodeId,
    type: 'zone' as const,
    name,
    parentId: parentId as AnyNodeId | null,
    polygon: [
      [0, 0],
      [20, 0],
      [20, 15],
      [0, 15],
    ], // 300 m²
    autoFromWalls: false,
    boundaryWallIds: [],
    spaceRole: 'storage-selective',
    roomNumber: '101',
    enclosureStatus: 'auto',
    floorFinish: 'epoxy',
    wallFinish: '',
    ceilingFinish: '',
    ceilingHeight: 7.0,
    occupancy: '',
    clearDimensionPolicy: 'none',
    color: '#3b82f6',
    metadata: {},
    ...overrides,
  } as ZoneNode
}

function makeRackNode(id: string, parentId: string, name = 'Rack 1', overrides: Record<string, unknown> = {}): AnyNode {
  return {
    id: id as AnyNodeId,
    type: 'warehouse:pallet-rack',
    name,
    parentId: parentId as AnyNodeId,
    position: [5, 0, 5],
    levels: 4,
    height: 6.8, // 6.8m rack in 7.0m ceiling => 0.2m sprinkler clearance (violation)
    depthGap: 0.1,
    ...overrides,
  } as unknown as AnyNode
}

describe('F5 & F6: Zone-Floor UI Awareness & Defect Layer Badging', () => {
  // ── Tier 1: Feature Coverage (F5 & F6) ────────────────────────────────────

  describe('Tier 1: Feature Coverage', () => {
    describe('F5: Zone-Floor Architectural Awareness', () => {
      it('T1.F5.1: Resolves zone.parentId to LevelNode name and populates floorName in ZoneZDSUAudit', () => {
        const zone = makeTestZone('z-1', 'level-ground', 'Pallet Storage Zone')
        const nodes: Record<AnyNodeId, AnyNode> = {
          ['level-ground' as AnyNodeId]: {
            id: 'level-ground' as AnyNodeId,
            type: 'level',
            name: 'Zemin Kat (Ground Floor)',
            level: 0,
          } as AnyNode,
        }

        const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
        expect(audit.levelId).toBe('level-ground')
        expect(audit.floorName).toBe('Zemin Kat (Ground Floor)')
        expect(audit.zoneName).toBe('Pallet Storage Zone')
      })

      it('T1.F5.2: Multi-floor facility assigns distinct architectural floor names across zones', () => {
        const zoneBasement = makeTestZone('z-b', 'level-b1', 'Cold Storage')
        const zoneGround = makeTestZone('z-g', 'level-0', 'Receiving Dock')
        const zoneMezz = makeTestZone('z-m', 'level-1', 'Mezzanine Picking')

        const nodes: Record<AnyNodeId, AnyNode> = {
          ['level-b1' as AnyNodeId]: { id: 'level-b1', type: 'level', name: 'Bodrum Kat (-1)', level: -1 } as unknown as AnyNode,
          ['level-0' as AnyNodeId]: { id: 'level-0', type: 'level', name: 'Zemin Kat (0)', level: 0 } as unknown as AnyNode,
          ['level-1' as AnyNodeId]: { id: 'level-1', type: 'level', name: '1. Asma Kat (1)', level: 1 } as unknown as AnyNode,
        }

        const report = calculateFacilityZDSUReport(nodes, [zoneBasement, zoneGround, zoneMezz], { standardId: 'TR' })
        expect(report.zonesAudited).toBe(3)

        const auditB = report.zoneAudits.find((z) => z.zoneId === 'z-b')
        const auditG = report.zoneAudits.find((z) => z.zoneId === 'z-g')
        const auditM = report.zoneAudits.find((z) => z.zoneId === 'z-m')

        expect(auditB?.floorName).toBe('Bodrum Kat (-1)')
        expect(auditG?.floorName).toBe('Zemin Kat (0)')
        expect(auditM?.floorName).toBe('1. Asma Kat (1)')
      })

      it('T1.F5.3: Zone with unassigned or null parentId defaults to General Floor without crashing', () => {
        const unassignedZone = makeTestZone('z-unassigned', null, 'Floating Zone')
        const nodes: Record<AnyNodeId, AnyNode> = {}

        const audit = calculateZoneZDSUAudit(unassignedZone, null, nodes, { standardId: 'EU' })
        expect(audit.levelId).toBeNull()
        expect(audit.floorName).toBe('General Floor')
        expect(audit.geometry.isValidPolygon).toBe(true)
      })

      it('T1.F5.4: JSON export certificate formats floorName and levelId for every zone and defect', () => {
        const zone = makeTestZone('z-json', 'level-l2', 'Buffer Zone')
        const offendingRack = makeRackNode('rack-json-1', 'level-l2', 'High-Bay Rack 1')
        const nodes: Record<AnyNodeId, AnyNode> = {
          ['level-l2' as AnyNodeId]: { id: 'level-l2', type: 'level', name: '2. Kat (Floor 2)', level: 2 } as unknown as AnyNode,
          ['rack-json-1' as AnyNodeId]: offendingRack,
        }

        const report = calculateFacilityZDSUReport(nodes, [zone], { standardId: 'TR' })
        const jsonStr = exportZoneAuditJson(report)
        const parsed = JSON.parse(jsonStr)

        expect(parsed.documentType).toBe('DigitalTwin-ZeroDefectStartup-AuditReport')
        expect(parsed.standardId).toBe('TR')
        expect(parsed.zones.length).toBe(1)
        expect(parsed.zones[0].floorName).toBe('2. Kat (Floor 2)')
        expect(parsed.zones[0].levelId).toBe('level-l2')

        const defect = parsed.zones[0].defects[0]
        if (defect) {
          expect(defect.floorName).toBe('2. Kat (Floor 2)')
          expect(defect.targetNodeId).toBe('rack-json-1')
        }
      })

      it('T1.F5.5: Markdown export certificate formats [Floor Name] in zone section headers', () => {
        const zone = makeTestZone('z-md', 'level-g', 'Forward Pick Area')
        const nodes: Record<AnyNodeId, AnyNode> = {
          ['level-g' as AnyNodeId]: { id: 'level-g', type: 'level', name: 'Zemin Kat', level: 0 } as unknown as AnyNode,
        }

        const report = calculateFacilityZDSUReport(nodes, [zone], { standardId: 'EU' })
        const md = exportZoneAuditMarkdown(report)

        expect(md).toContain('# Zero Defect Start-up (ZDSU) Facility Audit Certificate')
        expect(md).toContain('### Forward Pick Area [Zemin Kat]')
      })
    })

    describe('F6: Defect Layer Badging & Standard Switch Recalculation', () => {
      it('T1.F6.1: Defect model captures targetNodeId, targetNodeName, targetLevel, targetLayer, and floorName', () => {
        const zone = makeTestZone('z-defect-model', 'lvl-3', 'High Bay Storage')
        const tallRack = makeRackNode('rack-high-3', 'lvl-3', 'Automated Rack 3', {
          height: 6.8,
          levels: 5,
        })
        const nodes: Record<AnyNodeId, AnyNode> = {
          ['lvl-3' as AnyNodeId]: { id: 'lvl-3', type: 'level', name: '3. Kat (Tier 3)', level: 3 } as unknown as AnyNode,
          ['rack-high-3' as AnyNodeId]: tallRack,
        }

        const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
        const defect = audit.defects.find((d) => d.code === 'ZDSU-R01')

        expect(defect).toBeDefined()
        expect(defect?.targetNodeId).toBe('rack-high-3')
        expect(defect?.targetNodeName).toBe('Automated Rack 3')
        expect(defect?.targetLevel).toBe(5)
        expect(defect?.targetLayer).toBe('Level 5')
        expect(defect?.floorName).toBe('3. Kat (Tier 3)')
      })

      it('T1.F6.2: Defect row formatting in Markdown exports renders layer badge string ([Level 5], [Tier 2 Deck])', () => {
        const zone = makeTestZone('z-layer-badge', 'lvl-1', 'Aisle Storage')
        const rack = makeRackNode('rack-layer-1', 'lvl-1', 'Storage Rack A', {
          height: 6.8,
          levels: 5,
        })
        const nodes: Record<AnyNodeId, AnyNode> = {
          ['lvl-1' as AnyNodeId]: { id: 'lvl-1', type: 'level', name: 'Zemin Kat', level: 0 } as unknown as AnyNode,
          ['rack-layer-1' as AnyNodeId]: rack,
        }

        const report = calculateFacilityZDSUReport(nodes, [zone], { standardId: 'TR' })
        const md = exportZoneAuditMarkdown(report)

        expect(md).toContain('[Level 5]')
      })

      it('T1.F6.3: Defect formatting omits layer badge cleanly when defect is zone-wide (e.g. unverified emergency egress route)', () => {
        // High density zone with 10 generic objects triggering ZDSU-R05 (advisory)
        const zone = makeTestZone('z-egress', 'lvl-1', 'Selective Storage Aisle', {
          polygon: [
            [0, 0],
            [30, 0],
            [30, 10],
            [0, 10],
          ], // 300 m² > 200 m²
          spaceRole: 'generic',
          metadata: { role: 'storage-selective' },
        })
        const nodes: Record<AnyNodeId, AnyNode> = {
          ['lvl-1' as AnyNodeId]: { id: 'lvl-1', type: 'level', name: 'Zemin Kat', level: 0 } as unknown as AnyNode,
        }
        for (let i = 0; i < 10; i++) {
          nodes[`pallet-${i}` as AnyNodeId] = {
            id: `pallet-${i}` as AnyNodeId,
            type: 'warehouse:pallet',
            parentId: 'lvl-1' as AnyNodeId,
            position: [2 + (i * 2), 0, 5],
          } as unknown as AnyNode
        }

        const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
        const egressDefect = audit.defects.find((d) => d.code === 'ZDSU-R05')

        expect(egressDefect).toBeDefined()
        expect(egressDefect?.targetLayer).toBeUndefined()
        expect(egressDefect?.targetLevel).toBeUndefined()
      })

      it('T1.F6.4: Standard profile change triggers live recalculation and updates defect list and readiness score', () => {
        const zone = makeTestZone('z-switch', 'lvl-1', 'Flue Space Test Zone')
        // Rack with 85mm flue space:
        // TR standard (100mm threshold) -> ZDSU-R06 Warning Defect present, status = 'warning'
        // EU standard (75mm threshold) -> ZDSU-R06 absent, status = 'ready'
        const rack = makeRackNode('rack-flue-sw', 'lvl-1', 'Rack Flue Switch', {
          height: 5.0,
          depthGap: 0.085,
        })
        const truck: AnyNode = {
          id: 'truck-reach' as AnyNodeId,
          type: 'warehouse:truck',
          parentId: 'lvl-1' as AnyNodeId,
          position: [10, 0, 10],
          model: 'reach',
        } as unknown as AnyNode
        const nodes: Record<AnyNodeId, AnyNode> = {
          ['lvl-1' as AnyNodeId]: { id: 'lvl-1', type: 'level', name: 'Zemin Kat', level: 0 } as unknown as AnyNode,
          ['rack-flue-sw' as AnyNodeId]: rack,
          ['truck-reach' as AnyNodeId]: truck,
        }

        const trAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR', defaultMheClass: 'reach' })
        const euAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU', defaultMheClass: 'reach' })

        expect(trAudit.defects.some((d) => d.code === 'ZDSU-R06')).toBe(true)
        expect(trAudit.readiness.status).toBe('warning')

        expect(euAudit.defects.some((d) => d.code === 'ZDSU-R06')).toBe(false)
        expect(euAudit.readiness.status).toBe('ready')
      })

      it('T1.F6.5: Defect standardRef dynamically matches the active standard profile citations', () => {
        const zone = makeTestZone('z-cit', 'lvl-1', 'Sprinkler Test')
        const rack = makeRackNode('rack-spr-cit', 'lvl-1', 'Sprinkler Rack', { height: 6.8 })
        const nodes: Record<AnyNodeId, AnyNode> = {
          ['lvl-1' as AnyNodeId]: { id: 'lvl-1', type: 'level', name: 'Zemin Kat', level: 0 } as unknown as AnyNode,
          ['rack-spr-cit' as AnyNodeId]: rack,
        }

        const trAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
        const euAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU' })
        const usAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'US' })

        const trDef = trAudit.defects.find((d) => d.code === 'ZDSU-R01')
        const euDef = euAudit.defects.find((d) => d.code === 'ZDSU-R01')
        const usDef = usAudit.defects.find((d) => d.code === 'ZDSU-R01')

        expect(trDef?.standardRef).toContain('BYKHY Madde 95-97')
        expect(euDef?.standardRef).toContain('EN 12845')
        expect(usDef?.standardRef).toContain('NFPA 13')
      })
    })
  })

  // ── Tier 2: Boundary & Corner Cases (F5 & F6) ─────────────────────────────

  describe('Tier 2: Boundary & Corner Cases', () => {
    it('T2.B1: LevelNode with empty string name falls back to level index or default label', () => {
      const zone = makeTestZone('z-b1', 'lvl-empty-name')
      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-empty-name' as AnyNodeId]: {
          id: 'lvl-empty-name' as AnyNodeId,
          type: 'level',
          name: '',
          level: 3,
        } as unknown as AnyNode,
      }

      const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
      expect(audit.floorName).toBe('Level 3')
    })

    it('T2.B2: Parent ID pointing to non-existent or deleted LevelNode handled gracefully', () => {
      const zone = makeTestZone('z-ghost-parent', 'non-existent-level-id')
      const nodes: Record<AnyNodeId, AnyNode> = {}

      const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU' })
      expect(audit.floorName).toBe('General Floor')
      expect(audit.levelId).toBe('non-existent-level-id')
      expect(Number.isNaN(audit.readiness.score)).toBe(false)
    })

    it('T2.B3: Negative floor numbers (e.g. basement -2, Bodrum Kat 2) resolved properly', () => {
      const zone = makeTestZone('z-sub', 'lvl-b2')
      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-b2' as AnyNodeId]: {
          id: 'lvl-b2' as AnyNodeId,
          type: 'level',
          name: '-2. Bodrum Kat',
          level: -2,
        } as unknown as AnyNode,
      }

      const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
      expect(audit.floorName).toBe('-2. Bodrum Kat')
    })

    it('T2.B4: Rapid consecutive standard switches (TR -> EU -> US -> TR) maintain calculation idempotency', () => {
      const zone = makeTestZone('z-switch-repeat', 'lvl-1')
      const rack = makeRackNode('rack-rpt', 'lvl-1', 'Rack RPT', { height: 5.0, depthGap: 0.085 })
      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-1' as AnyNodeId]: { id: 'lvl-1', type: 'level', name: 'Zemin Kat', level: 0 } as unknown as AnyNode,
        ['rack-rpt' as AnyNodeId]: rack,
      }

      const run1 = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
      const run2 = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU' })
      const run3 = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'US' })
      const run4 = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })

      expect(run1.defects.length).toBe(run4.defects.length)
      expect(run1.readiness.score).toBe(run4.readiness.score)
      expect(run1.storage.totalPalletPositions).toBe(run4.storage.totalPalletPositions)
      expect(run2.defects.length).toBe(run3.defects.length)
    })

    it('T2.B5: Defect formatting with undefined optional fields produces clean output without undefined string artifacts', () => {
      const zone = makeTestZone('z-clean-str', 'lvl-1')
      const nodes: Record<AnyNodeId, AnyNode> = {
        ['lvl-1' as AnyNodeId]: { id: 'lvl-1', type: 'level', name: 'Main Floor', level: 0 } as unknown as AnyNode,
      }

      const report = calculateFacilityZDSUReport(nodes, [zone], { standardId: 'TR' })
      const md = exportZoneAuditMarkdown(report)

      expect(md.includes('undefined')).toBe(false)
      expect(md.includes('NaN')).toBe(false)
      expect(md.includes('null')).toBe(false)
    })

    it('T2.B6: 50 zones across 10 architectural levels resolve all parent levels in < 5ms', () => {
      const nodes: Record<AnyNodeId, AnyNode> = {}
      const zones: ZoneNode[] = []

      for (let f = 0; f < 10; f++) {
        const lvlId = `floor-level-${f}` as AnyNodeId
        nodes[lvlId] = {
          id: lvlId,
          type: 'level',
          name: `Architectural Floor ${f}`,
          level: f,
        } as unknown as AnyNode

        for (let z = 0; z < 5; z++) {
          const zoneId = `zone-f${f}-z${z}`
          zones.push(makeTestZone(zoneId, lvlId, `Storage Section ${f}-${z}`))
        }
      }

      const start = performance.now()
      const report = calculateFacilityZDSUReport(nodes, zones, { standardId: 'TR' })
      const durationMs = performance.now() - start

      expect(report.zonesAudited).toBe(50)
      expect(report.zoneAudits.length).toBe(50)
      expect(durationMs).toBeLessThan(5.0)

      for (let i = 0; i < 50; i++) {
        const expectedFloorIndex = Math.floor(i / 5)
        expect(report.zoneAudits[i]?.floorName).toBe(`Architectural Floor ${expectedFloorIndex}`)
      }
    })
  })
})
