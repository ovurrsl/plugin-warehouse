import { describe, expect, it } from 'bun:test'
import type { AnyNode, AnyNodeId, ZoneNode } from '@pascal-app/core'
import { calculateZoneZDSUAudit } from '../zero-defect'
import type { PalletRackNode } from '../../rack/schema'
import type { MezzanineNode } from '../../mezzanine/schema'

function makeTestZone(overrides: Partial<ZoneNode> = {}): ZoneNode {
  return {
    id: 'zone-deep-1' as AnyNodeId,
    type: 'zone' as const,
    name: 'Deep Inspection Storage Zone',
    parentId: 'level-floor-1' as AnyNodeId,
    polygon: [
      [0, 0],
      [40, 0],
      [40, 30],
      [0, 30],
    ], // 40m x 30m = 1200 m²
    autoFromWalls: false,
    boundaryWallIds: [],
    spaceRole: 'storage-selective',
    roomNumber: 'A-200',
    enclosureStatus: 'auto',
    floorFinish: 'concrete',
    wallFinish: '',
    ceilingFinish: '',
    ceilingHeight: 9.0,
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
  overrides: Partial<PalletRackNode> = {},
): AnyNode {
  return {
    id: id as AnyNodeId,
    type: 'warehouse:pallet-rack',
    name: `High-Bay Selective Rack ${id}`,
    parentId: parentId as AnyNodeId,
    position: [10, 0, 10],
    rotation: [0, 0, 0],
    levels: 4,
    height: 6.0,
    bayClearWidth: 2.7,
    depth: 1.1,
    depthGap: 0.1,
    baySpacing: 2.8,
    bays: 1,
    beamLevelSpacing: 1.5,
    firstBeamElevation: 0.3,
    beamThickness: 0.1,
    palletPositionsPerLevel: 3,
    ...overrides,
  } as unknown as AnyNode
}

function makeMezzanineNode(
  id: string,
  parentId: string,
  overrides: Partial<MezzanineNode> = {},
): AnyNode {
  return {
    id: id as AnyNodeId,
    type: 'warehouse:mezzanine',
    name: `Industrial Steel Mezzanine ${id}`,
    parentId: parentId as AnyNodeId,
    position: [20, 0, 20],
    tiers: [
      {
        index: 1,
        elevationM: 3.0,
        clearHeightM: 2.6,
        deckThicknessM: 0.1,
        joistSpacingM: 0.4,
      },
      {
        index: 2,
        elevationM: 6.0,
        clearHeightM: 2.5,
        deckThicknessM: 0.1,
        joistSpacingM: 0.4,
      },
    ],
    outlinePolygon: [
      [15, 15],
      [25, 15],
      [25, 25],
      [15, 25],
    ],
    ...overrides,
  } as unknown as AnyNode
}

describe('F3 & F4: Deep Rack-Level & Mezzanine Inspection Engine', () => {
  // ── Tier 1: Feature Coverage (F3 & F4) ────────────────────────────────────

  describe('Tier 1: Feature Coverage', () => {
    describe('F3: Deep Level-by-Level Racking Inspection', () => {
      it('T1.F3.1: Multi-level selective rack calculates level capacity and evaluates beam openings', () => {
        const zone = makeTestZone({ ceilingHeight: 10.0 })
        const rack = makeSelectiveRack('rack-multi-1', zone.parentId!, {
          levels: 5,
          height: 8.0,
          beamLevelSpacing: 1.5,
          firstBeamElevation: 0.4,
          beamThickness: 0.1,
        })
        const nodes: Record<AnyNodeId, AnyNode> = {
          [zone.parentId!]: { id: zone.parentId!, type: 'level', name: '1. Kat (Floor 1)' } as AnyNode,
          ['rack-multi-1' as AnyNodeId]: rack,
        }

        const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
        expect(audit.storage.totalPalletPositions).toBe(15) // 5 levels * 3 positions
        expect(audit.clearance.sprinklerCompliant).toBe(true)
        expect(audit.defects.filter((d) => d.code === 'ZDSU-R01').length).toBe(0)
      })

      it('T1.F3.2: Tagging defect to specific rack level when beam clear opening is severely restricted (<0.6m)', () => {
        const zone = makeTestZone()
        // Level 2 has beamLevelSpacing of 0.5m with 0.1m beam => 0.4m clear opening (<0.6m threshold)
        const defectiveRack = makeSelectiveRack('rack-restricted-level', zone.parentId!, {
          name: 'Selective Rack Row 4',
          levels: 4,
          height: 6.0,
          levelClear: 0.35, // Restricted spacing < 0.40m
          firstLevelClear: 0.35,
          levelClears: [0.35, 0.35, 0.35, 0.35],
          beamThickness: 0.1,
        })
        const nodes: Record<AnyNodeId, AnyNode> = {
          [zone.parentId!]: { id: zone.parentId!, type: 'level', name: '1. Kat (Floor 1)' } as AnyNode,
          ['rack-restricted-level' as AnyNodeId]: defectiveRack,
        }

        const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
        const levelDefects = audit.defects.filter((d) => d.title === 'Restricted Rack Beam Level Opening')

        expect(levelDefects.length).toBeGreaterThan(0)
        const defect = levelDefects[0]
        expect(defect).toBeDefined()
        expect(defect?.targetNodeId).toBe('rack-restricted-level')
        expect(defect?.targetNodeName).toBe('Selective Rack Row 4')
        expect(typeof defect?.targetLevel).toBe('number')
        expect(defect?.targetLayer).toContain('Level')
        expect(defect?.floorName).toBe('1. Kat (Floor 1)')
      })

      it('T1.F3.3: Top level sprinkler violation tags the offending rack and top level number', () => {
        const zone = makeTestZone({ ceilingHeight: 6.2 })
        // Rack height = 6.0m, Ceiling = 6.2m => Clearance = 0.20m (<0.50m TR requirement)
        const tallRack = makeSelectiveRack('tall-rack-5', zone.parentId!, {
          name: 'High-Bay Rack 5',
          levels: 4,
          height: 6.0,
        })
        const nodes: Record<AnyNodeId, AnyNode> = {
          [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Zemin Kat' } as AnyNode,
          ['tall-rack-5' as AnyNodeId]: tallRack,
        }

        const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
        const sprinklerDefect = audit.defects.find((d) => d.code === 'ZDSU-R01')

        expect(sprinklerDefect).toBeDefined()
        expect(sprinklerDefect?.severity).toBe('blocking')
        expect(sprinklerDefect?.targetNodeId).toBe('tall-rack-5')
        expect(sprinklerDefect?.targetNodeName).toBe('High-Bay Rack 5')
        expect(sprinklerDefect?.targetLevel).toBe(4)
        expect(sprinklerDefect?.targetLayer).toBe('Level 4')
        expect(sprinklerDefect?.floorName).toBe('Zemin Kat')
      })

      it('T1.F3.4: Mixed rack setup isolates the single defective rack without polluting compliant racks', () => {
        const zone = makeTestZone({ ceilingHeight: 9.0 })
        const rackA = makeSelectiveRack('rack-a', zone.parentId!, { name: 'Rack Alpha', height: 5.0 })
        const rackB = makeSelectiveRack('rack-b', zone.parentId!, {
          name: 'Rack Bravo',
          height: 5.0,
          depthGap: 0.04, // 40mm flue space -> FAILS TR 100mm threshold
        })
        const rackC = makeSelectiveRack('rack-c', zone.parentId!, { name: 'Rack Charlie', height: 5.0 })

        const nodes: Record<AnyNodeId, AnyNode> = {
          [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Zemin Kat' } as AnyNode,
          ['rack-a' as AnyNodeId]: rackA,
          ['rack-b' as AnyNodeId]: rackB,
          ['rack-c' as AnyNodeId]: rackC,
        }

        const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
        const flueDefects = audit.defects.filter((d) => d.code === 'ZDSU-R06')

        expect(flueDefects.length).toBe(1)
        expect(flueDefects[0]?.targetNodeId).toBe('rack-b')
        expect(flueDefects[0]?.targetNodeName).toBe('Rack Bravo')
        expect(flueDefects[0]?.targetLayer).toBe('Flue Space')
      })

      it('T1.F3.5: Flue space defect captures correct rack identification and layer annotation', () => {
        const zone = makeTestZone()
        const rack = makeSelectiveRack('flue-rack-99', zone.parentId!, {
          name: 'Back-to-Back Rack 99',
          depthGap: 0.05, // 50mm
        })
        const nodes: Record<AnyNodeId, AnyNode> = {
          [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Zemin Kat' } as AnyNode,
          ['flue-rack-99' as AnyNodeId]: rack,
        }

        const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU' })
        const defect = audit.defects.find((d) => d.code === 'ZDSU-R06')

        expect(defect).toBeDefined()
        expect(defect?.targetNodeId).toBe('flue-rack-99')
        expect(defect?.targetNodeName).toBe('Back-to-Back Rack 99')
        expect(defect?.targetLayer).toBe('Flue Space')
      })
    })

    describe('F4: Deep Mezzanine Tier Inspection', () => {
      it('T1.F4.1: Multi-tier mezzanine calculates footprint and verifies compliant tiers', () => {
        const zone = makeTestZone()
        const mezz = makeMezzanineNode('mezz-compliant', zone.parentId!, {
          tiers: [
            { index: 1, elevationM: 3.0, clearHeightM: 2.5, deckThicknessM: 0.1, joistSpacingM: 0.4 },
            { index: 2, elevationM: 6.0, clearHeightM: 2.5, deckThicknessM: 0.1, joistSpacingM: 0.4 },
          ],
        })
        const nodes: Record<AnyNodeId, AnyNode> = {
          [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Main Floor' } as AnyNode,
          ['mezz-compliant' as AnyNodeId]: mezz,
        }

        const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU' })
        // 2.5m clear height > 2.0m EU threshold => Compliant
        expect(audit.defects.some((d) => d.title.includes('Mezzanine Headroom'))).toBe(false)
        expect(audit.utilization.equipmentFootprintM2).toBeGreaterThan(0)
      })

      it('T1.F4.2: Mezzanine Tier 2 insufficient clear headroom generates blocking defect with tier targeting', () => {
        const zone = makeTestZone()
        const mezz = makeMezzanineNode('mezz-failing-t2', zone.parentId!, {
          name: 'Order Picking Mezzanine',
          tiers: [
            { index: 1, elevationM: 3.0, clearHeightM: 2.4, deckThicknessM: 0.1, joistSpacingM: 0.4 },
            { index: 2, elevationM: 5.5, clearHeightM: 1.85, deckThicknessM: 0.1, joistSpacingM: 0.4 }, // Restricted 1.85m (<2.0m)
          ],
        })
        const nodes: Record<AnyNodeId, AnyNode> = {
          [zone.parentId!]: { id: zone.parentId!, type: 'level', name: '2. Kat (Floor 2)' } as AnyNode,
          ['mezz-failing-t2' as AnyNodeId]: mezz,
        }

        const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU' })
        const headroomDefect = audit.defects.find((d) => d.title.includes('Mezzanine Headroom'))

        expect(headroomDefect).toBeDefined()
        expect(headroomDefect?.severity).toBe('blocking')
        expect(headroomDefect?.targetNodeId).toBe('mezz-failing-t2')
        expect(headroomDefect?.targetNodeName).toBe('Order Picking Mezzanine')
        expect(headroomDefect?.targetLevel).toBe(2)
        expect(headroomDefect?.targetLayer).toBe('Tier 2 Deck')
        expect(headroomDefect?.floorName).toBe('2. Kat (Floor 2)')
      })

      it('T1.F4.3: Mezzanine headroom compliance adapts across TR (2.10m), EU (2.00m), and US (2.134m)', () => {
        const zone = makeTestZone()
        // Mezzanine tier with 2.05m clear height:
        // EU requires 2.00m -> PASSES (2.05m >= 2.00m)
        // TR requires 2.10m -> FAILS (2.05m < 2.10m)
        // US requires 2.134m (7 ft) -> FAILS (2.05m < 2.134m)
        const mezz = makeMezzanineNode('mezz-borderline', zone.parentId!, {
          tiers: [
            { index: 1, elevationM: 3.0, clearHeightM: 2.05, deckThicknessM: 0.1, joistSpacingM: 0.4 },
          ],
        })
        const nodes: Record<AnyNodeId, AnyNode> = {
          [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Mezzanine Zone' } as AnyNode,
          ['mezz-borderline' as AnyNodeId]: mezz,
        }

        const euAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU' })
        const trAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
        const usAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'US' })

        expect(euAudit.defects.some((d) => d.title.includes('Mezzanine Headroom'))).toBe(false)
        expect(trAudit.defects.some((d) => d.title.includes('Mezzanine Headroom'))).toBe(true)
        expect(usAudit.defects.some((d) => d.title.includes('Mezzanine Headroom'))).toBe(true)
      })

      it('T1.F4.4: 3-tier mezzanine with 1 failing tier correctly pinpoints Tier 3 without affecting Tiers 1 and 2', () => {
        const zone = makeTestZone()
        const mezz = makeMezzanineNode('mezz-3tier', zone.parentId!, {
          tiers: [
            { index: 1, elevationM: 3.0, clearHeightM: 2.4, deckThicknessM: 0.1, joistSpacingM: 0.4 },
            { index: 2, elevationM: 6.0, clearHeightM: 2.4, deckThicknessM: 0.1, joistSpacingM: 0.4 },
            { index: 3, elevationM: 8.5, clearHeightM: 1.7, deckThicknessM: 0.1, joistSpacingM: 0.4 }, // Failing
          ],
        })
        const nodes: Record<AnyNodeId, AnyNode> = {
          [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Mezz Floor' } as AnyNode,
          ['mezz-3tier' as AnyNodeId]: mezz,
        }

        const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU' })
        const defects = audit.defects.filter((d) => d.title.includes('Mezzanine Headroom'))

        expect(defects.length).toBe(1)
        expect(defects[0]?.targetLevel).toBe(3)
        expect(defects[0]?.targetLayer).toBe('Tier 3 Deck')
      })

      it('T1.F4.5: Defect standard citation for mezzanine rules matches authoritative regulatory reference', () => {
        const zone = makeTestZone()
        const mezz = makeMezzanineNode('mezz-cite-test', zone.parentId!, {
          tiers: [
            { index: 1, elevationM: 3.0, clearHeightM: 1.5, deckThicknessM: 0.1, joistSpacingM: 0.4 },
          ],
        })
        const nodes: Record<AnyNodeId, AnyNode> = {
          [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Zemin Kat' } as AnyNode,
          ['mezz-cite-test' as AnyNodeId]: mezz,
        }

        const trAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
        const euAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU' })
        const usAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'US' })

        const trDef = trAudit.defects.find((d) => d.title.includes('Mezzanine Headroom'))
        const euDef = euAudit.defects.find((d) => d.title.includes('Mezzanine Headroom'))
        const usDef = usAudit.defects.find((d) => d.title.includes('Mezzanine Headroom'))

        expect(trDef?.standardRef).toContain('BYKHY Madde 41')
        expect(euDef?.standardRef).toContain('EN ISO 14122')
        expect(usDef?.standardRef).toContain('OSHA 1910.29')
      })
    })
  })

  // ── Tier 2: Boundary & Corner Cases (F3 & F4) ─────────────────────────────

  describe('Tier 2: Boundary & Corner Cases', () => {
    it('T2.B1: Ground level / Level 1 beam elevation handled cleanly without negative heights', () => {
      const zone = makeTestZone()
      const groundRack = makeSelectiveRack('rack-ground-lvl', zone.parentId!, {
        levels: 1,
        height: 1.8,
        firstBeamElevation: 0.1,
        beamLevelSpacing: 1.6,
      })
      const nodes: Record<AnyNodeId, AnyNode> = {
        [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Ground' } as AnyNode,
        ['rack-ground-lvl' as AnyNodeId]: groundRack,
      }

      const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
      expect(audit.storage.totalPalletPositions).toBe(3)
      expect(Number.isNaN(audit.readiness.score)).toBe(false)
    })

    it('T2.B2: Single-level low-profile rack evaluated without array indexing errors', () => {
      const zone = makeTestZone()
      const singleRack = makeSelectiveRack('rack-single-lvl', zone.parentId!, {
        levels: 1,
        height: 2.0,
      })
      const reachTruck: AnyNode = {
        id: 'truck-reach-1' as AnyNodeId,
        type: 'warehouse:truck',
        parentId: zone.parentId! as AnyNodeId,
        position: [5, 0, 5],
        model: 'reach',
      } as unknown as AnyNode
      const nodes: Record<AnyNodeId, AnyNode> = {
        [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Floor 1' } as AnyNode,
        ['rack-single-lvl' as AnyNodeId]: singleRack,
        ['truck-reach-1' as AnyNodeId]: reachTruck,
      }

      const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU', defaultMheClass: 'reach' })
      expect(audit.storage.totalPalletPositions).toBe(3)
      expect(audit.readiness.status).toBe('ready')
    })

    it('T2.B3: Mega-tall 10-level automated high-bay rack audits all beam levels in < 5ms', () => {
      const zone = makeTestZone({ ceilingHeight: 20.0 })
      const megaRack = makeSelectiveRack('mega-rack-10', zone.parentId!, {
        levels: 10,
        height: 18.0,
        beamLevelSpacing: 1.7,
        firstBeamElevation: 0.5,
      })
      const nodes: Record<AnyNodeId, AnyNode> = {
        [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'High-Bay Level' } as AnyNode,
        ['mega-rack-10' as AnyNodeId]: megaRack,
      }

      const startTime = performance.now()
      const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
      const durationMs = performance.now() - startTime

      expect(audit.storage.totalPalletPositions).toBe(30)
      expect(durationMs).toBeLessThan(5.0)
    })

    it('T2.B4: Beam clear opening exactly at threshold (0.60m)', () => {
      const zone = makeTestZone()
      // Beam spacing 0.7m with 0.1m beam = exactly 0.60m opening (not < 0.60m)
      const exactRack = makeSelectiveRack('rack-exact-opening', zone.parentId!, {
        levels: 3,
        height: 4.5,
        beamLevelSpacing: 0.7,
        beamThickness: 0.1,
      })
      const nodes: Record<AnyNodeId, AnyNode> = {
        [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Floor' } as AnyNode,
        ['rack-exact-opening' as AnyNodeId]: exactRack,
      }

      const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
      expect(audit.defects.some((d) => d.title === 'Restricted Rack Beam Level Opening')).toBe(false)
    })

    it('T2.B5: Mezzanine headroom exactly at standard minimum (2.00m EU threshold)', () => {
      const zone = makeTestZone()
      const exactMezz = makeMezzanineNode('mezz-exact-headroom', zone.parentId!, {
        tiers: [
          { index: 1, elevationM: 3.0, clearHeightM: 2.0, deckThicknessM: 0.1, joistSpacingM: 0.4 },
        ],
      })
      const nodes: Record<AnyNodeId, AnyNode> = {
        [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Floor' } as AnyNode,
        ['mezz-exact-headroom' as AnyNodeId]: exactMezz,
      }

      const euAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU' })
      expect(euAudit.defects.some((d) => d.title.includes('Mezzanine Headroom'))).toBe(false)
    })

    it('T2.B6: Rack with empty tiers or missing properties falls back safely without unhandled exceptions', () => {
      const zone = makeTestZone()
      const emptyMezz: AnyNode = {
        id: 'mezz-empty' as AnyNodeId,
        type: 'warehouse:mezzanine',
        parentId: zone.parentId! as AnyNodeId,
        position: [10, 0, 10],
        tiers: [],
      } as unknown as AnyNode

      const nodes: Record<AnyNodeId, AnyNode> = {
        [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Floor' } as AnyNode,
        ['mezz-empty' as AnyNodeId]: emptyMezz,
      }

      const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
      expect(audit.readiness.score).toBeGreaterThan(0)
    })
  })
})
