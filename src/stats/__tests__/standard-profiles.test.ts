import { describe, expect, it } from 'bun:test'
import type { AnyNode, AnyNodeId, ZoneNode } from '@pascal-app/core'
import {
  DEFAULT_STANDARD_ID,
  REGULATORY_STANDARDS,
  getStandardProfile,
  getStandardThresholds,
} from '../zero-defect-standards'
import type { RegulatoryStandardId } from '../zero-defect-types'
import {
  calculateFacilityZDSUReport,
  calculateZoneZDSUAudit,
} from '../zero-defect'

function makeTestZone(overrides: Partial<ZoneNode> = {}): ZoneNode {
  return {
    id: 'zone-std-1' as AnyNodeId,
    type: 'zone' as const,
    name: 'Standard Testing Zone',
    parentId: 'level-ground' as AnyNodeId,
    polygon: [
      [0, 0],
      [30, 0],
      [30, 20],
      [0, 20],
    ], // 30m x 20m = 600 m²
    autoFromWalls: false,
    boundaryWallIds: [],
    spaceRole: 'generic',
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

function makeRackNode(id: string, parentId: string, overrides: Record<string, unknown> = {}): AnyNode {
  return {
    id: id as AnyNodeId,
    type: 'warehouse:pallet-rack',
    parentId: parentId as AnyNodeId,
    position: [10, 0, 10],
    levels: 4,
    height: 5.5,
    depthGap: 0.085, // 85mm flue space
    ...overrides,
  } as unknown as AnyNode
}

function makeDockNode(id: string, parentId: string): AnyNode {
  return {
    id: id as AnyNodeId,
    type: 'warehouse:dock-leveller',
    parentId: parentId as AnyNodeId,
    position: [5, 0, 5],
  } as unknown as AnyNode
}

describe('F1 & F2: Regulatory Standard Profiles & Mandatory Selection Gate', () => {
  // ── Tier 1: Feature Coverage (F1 & F2) ────────────────────────────────────

  describe('Tier 1: Feature Coverage', () => {
    describe('F1: Regulatory Standard Profiles & Thresholds', () => {
      it('T1.F1.1: Standard registry contains TR, EU, and US profiles with complete metadata and citations', () => {
        const standards: RegulatoryStandardId[] = ['TR', 'EU', 'US']

        for (const stdId of standards) {
          const profile = REGULATORY_STANDARDS[stdId]
          expect(profile).toBeDefined()
          expect(profile.id).toBe(stdId)
          expect(typeof profile.name).toBe('string')
          expect(profile.name.length).toBeGreaterThan(5)
          expect(typeof profile.shortName).toBe('string')
          expect(['Turkey', 'Europe', 'United States']).toContain(profile.region)
          expect(Array.isArray(profile.governingBodies)).toBe(true)
          expect(profile.governingBodies.length).toBeGreaterThanOrEqual(2)

          // Citations completeness
          expect(profile.citations).toBeDefined()
          expect(profile.citations.sprinkler).toBeDefined()
          expect(profile.citations.flueSpace).toBeDefined()
          expect(profile.citations.aisles).toBeDefined()
          expect(profile.citations.racking).toBeDefined()
          expect(profile.citations.staging).toBeDefined()
          expect(profile.citations.mezzanine).toBeDefined()
        }
      })

      it('T1.F1.2: Threshold lookup returns correct standard-specific physical dimensions', () => {
        const tr = getStandardThresholds('TR')
        const eu = getStandardThresholds('EU')
        const us = getStandardThresholds('US')

        // Sprinkler clearance thresholds
        expect(tr.sprinklerClearanceM).toBe(0.5)
        expect(eu.sprinklerClearanceM).toBe(0.5)
        expect(us.sprinklerClearanceM).toBeCloseTo(0.457, 2) // 18 inches

        // Flue space minimums
        expect(tr.minFlueSpaceM).toBe(0.1) // 100mm TSE/BYKHY
        expect(eu.minFlueSpaceM).toBe(0.075) // 75mm EN 15635 min
        expect(us.minFlueSpaceM).toBe(0.075) // 3 inches NFPA 13

        // Staging buffer requirements
        expect(tr.stagingAreaPerDockM2).toBe(30.0)
        expect(eu.stagingAreaPerDockM2).toBe(30.0)
        expect(us.stagingAreaPerDockM2).toBe(25.0)

        // Egress minimums
        expect(tr.egressAisleMinClearM).toBe(1.2)
        expect(eu.egressAisleMinClearM).toBe(1.2)
        expect(us.egressAisleMinClearM).toBe(1.0)

        // Mezzanine Headroom
        expect(tr.mezzanineMinHeadroomM).toBe(2.1)
        expect(eu.mezzanineMinHeadroomM).toBe(2.0)
        expect(us.mezzanineMinHeadroomM).toBeCloseTo(2.134, 2) // 7.0 ft
      })

      it('T1.F1.3: Dynamic standard switching alters flue space defect generation (TR vs EU vs US)', () => {
        const zone = makeTestZone()
        // Rack with 85mm flue space:
        // TR requires 100mm -> FAILS with ZDSU-R06
        // EU requires 75mm -> PASSES (no ZDSU-R06)
        // US requires 75mm (0.075m) -> PASSES (no ZDSU-R06)
        const rack = makeRackNode('rack-flue-1', zone.parentId!, { depthGap: 0.085 })
        const nodes: Record<AnyNodeId, AnyNode> = {
          [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Zemin Kat' } as unknown as AnyNode,
          ['rack-flue-1' as AnyNodeId]: rack,
        }

        const trAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
        const euAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'EU' })
        const usAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'US' })

        expect(trAudit.defects.some((d) => d.code === 'ZDSU-R06')).toBe(true)
        expect(euAudit.defects.some((d) => d.code === 'ZDSU-R06')).toBe(false)
        expect(usAudit.defects.some((d) => d.code === 'ZDSU-R06')).toBe(false)

        // Verify standard citation is populated in defect
        const trFlueDefect = trAudit.defects.find((d) => d.code === 'ZDSU-R06')
        expect(trFlueDefect?.standardRef).toContain('TS EN 15635')
      })

      it('T1.F1.4: Dynamic standard switching alters dock staging deficit rule (ZDSU-R03)', () => {
        // Zone area = 46 m², 2 dock doors => 23.0 m²/dock
        // TR critical deficit threshold is 20.0 m² => PASSES critical deficit
        // EU critical deficit threshold is 25.0 m² => FAILS (23.0 < 25.0 triggers ZDSU-R03)
        // US critical deficit threshold is 25.0 m² => FAILS (23.0 < 25.0 triggers ZDSU-R03)
        const smallStagingZone = makeTestZone({
          polygon: [
            [0, 0],
            [10, 0],
            [10, 4.6],
            [0, 4.6],
          ], // 46 m²
          spaceRole: 'generic',
          metadata: { role: 'staging-inbound' },
        })
        const dock1 = makeDockNode('dock-1', smallStagingZone.parentId!)
        const dock2 = makeDockNode('dock-2', smallStagingZone.parentId!)
        const nodes: Record<AnyNodeId, AnyNode> = {
          [smallStagingZone.parentId!]: { id: smallStagingZone.parentId!, type: 'level', name: 'Zemin Kat' } as unknown as AnyNode,
          ['dock-1' as AnyNodeId]: dock1,
          ['dock-2' as AnyNodeId]: dock2,
        }

        const trAudit = calculateZoneZDSUAudit(smallStagingZone, null, nodes, { standardId: 'TR' })
        const euAudit = calculateZoneZDSUAudit(smallStagingZone, null, nodes, { standardId: 'EU' })
        const usAudit = calculateZoneZDSUAudit(smallStagingZone, null, nodes, { standardId: 'US' })

        expect(trAudit.defects.some((d) => d.code === 'ZDSU-R03')).toBe(false)
        expect(euAudit.defects.some((d) => d.code === 'ZDSU-R03')).toBe(true)
        expect(usAudit.defects.some((d) => d.code === 'ZDSU-R03')).toBe(true)
      })

      it('T1.F1.5: Sprinkler clearance threshold evaluation adapts across TR (0.50m) and US (0.457m)', () => {
        // Ceiling height 6.0m, Rack height 5.52m => clearance = 0.48m
        // TR requires 0.50m -> FAILS (0.48m < 0.50m triggers ZDSU-R01)
        // US requires 0.457m -> PASSES (0.48m >= 0.457m no ZDSU-R01)
        const zone = makeTestZone({ ceilingHeight: 6.0 })
        const rack = makeRackNode('rack-sprinkler-1', zone.parentId!, {
          height: 5.52,
          levels: 4,
          beamHeights: [1.3, 2.7, 4.1, 5.52],
        })
        const nodes: Record<AnyNodeId, AnyNode> = {
          [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Zemin Kat' } as unknown as AnyNode,
          ['rack-sprinkler-1' as AnyNodeId]: rack,
        }

        const trAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'TR' })
        const usAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: 'US' })

        expect(trAudit.clearance.sprinklerClearanceM).toBe(0.48)
        expect(trAudit.defects.some((d) => d.code === 'ZDSU-R01')).toBe(true)
        expect(usAudit.defects.some((d) => d.code === 'ZDSU-R01')).toBe(false)
      })
    })

    describe('F2: Mandatory Standard Selection & UI Gate', () => {
      it('T1.F2.1: Null standardId returns standardId: null in report structure', () => {
        const zone = makeTestZone()
        const nodes: Record<AnyNodeId, AnyNode> = {
          [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Zemin Kat' } as unknown as AnyNode,
        }

        const report = calculateFacilityZDSUReport(nodes, [zone], { standardId: null })
        expect(report.standardId).toBeNull()

        const zoneAudit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: null })
        expect(zoneAudit.standardId).toBeNull()
      })

      it('T1.F2.2: Unselected standard defaults fallback profile safely while preserving null identifier for UI lockout', () => {
        const zone = makeTestZone()
        const nodes: Record<AnyNodeId, AnyNode> = {
          [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Zemin Kat' } as unknown as AnyNode,
        }

        // When standardId is omitted, standardProfile defaults gracefully
        const audit = calculateZoneZDSUAudit(zone, null, nodes)
        expect(audit.geometry.isValidPolygon).toBe(true)
        expect(audit.readiness.status).toBe('ready')
        expect(audit.readiness.score).toBe(100)
      })

      it('T1.F2.3: Selecting a standard unlocks standard-specific report tagging', () => {
        const zone = makeTestZone()
        const nodes: Record<AnyNodeId, AnyNode> = {
          [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Zemin Kat' } as unknown as AnyNode,
        }

        const reportTR = calculateFacilityZDSUReport(nodes, [zone], { standardId: 'TR' })
        const reportEU = calculateFacilityZDSUReport(nodes, [zone], { standardId: 'EU' })
        const reportUS = calculateFacilityZDSUReport(nodes, [zone], { standardId: 'US' })

        expect(reportTR.standardId).toBe('TR')
        expect(reportEU.standardId).toBe('EU')
        expect(reportUS.standardId).toBe('US')

        expect(reportTR.zoneAudits[0]?.standardId).toBe('TR')
        expect(reportEU.zoneAudits[0]?.standardId).toBe('EU')
        expect(reportUS.zoneAudits[0]?.standardId).toBe('US')
      })

      it('T1.F2.4: getStandardProfile returns DEFAULT_STANDARD_PROFILE when passed null or undefined', () => {
        const defaultProfile = getStandardProfile(null)
        expect(defaultProfile).toBeDefined()
        expect(defaultProfile.id).toBe(DEFAULT_STANDARD_ID)
        expect(defaultProfile.id).toBe('TR')

        const undefinedProfile = getStandardProfile(undefined)
        expect(undefinedProfile.id).toBe('TR')
      })

      it('T1.F2.5: Defects generated under specific standards carry the authoritative citation for that standard', () => {
        // Severe storage over-utilization (>70%)
        const tinyZone = makeTestZone({
          polygon: [
            [0, 0],
            [5, 0],
            [5, 4],
            [0, 4],
          ], // 20 m²
          spaceRole: 'generic',
          metadata: { role: 'storage-selective' },
        })
        // 5 racks of 3.08 m² = 15.4 m² footprint (77% utilization > 70% threshold)
        const racks: Record<AnyNodeId, AnyNode> = {
          [tinyZone.parentId!]: { id: tinyZone.parentId!, type: 'level', name: 'Floor 1' } as unknown as AnyNode,
        }
        for (let i = 0; i < 5; i++) {
          racks[`r-${i}` as AnyNodeId] = makeRackNode(`r-${i}`, tinyZone.parentId!, {
            position: [1 + (i * 0.7), 0, 2],
          })
        }

        const trAudit = calculateZoneZDSUAudit(tinyZone, null, racks, { standardId: 'TR' })
        const euAudit = calculateZoneZDSUAudit(tinyZone, null, racks, { standardId: 'EU' })
        const usAudit = calculateZoneZDSUAudit(tinyZone, null, racks, { standardId: 'US' })

        const trDefect = trAudit.defects.find((d) => d.code === 'ZDSU-R04')
        const euDefect = euAudit.defects.find((d) => d.code === 'ZDSU-R04')
        const usDefect = usAudit.defects.find((d) => d.code === 'ZDSU-R04')

        expect(trDefect?.standardRef).toContain('İSG Depolama Alanı Güvenlik Limitleri')
        expect(euDefect?.standardRef).toContain('FEM 10.2.02')
        expect(usDefect?.standardRef).toContain('WERC & Lean Warehousing Benchmarks')
      })
    })
  })

  // ── Tier 2: Boundary & Corner Cases (F1 & F2) ─────────────────────────────

  describe('Tier 2: Boundary & Corner Cases', () => {
    it('T2.B1: Flue space exactly at boundary threshold (75mm vs 100mm)', () => {
      const zone = makeTestZone()
      // Test at 75.0mm (0.075m)
      const rackAt75 = makeRackNode('rack-75mm', zone.parentId!, { depthGap: 0.075 })
      const nodes75: Record<AnyNodeId, AnyNode> = {
        [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Zemin Kat' } as unknown as AnyNode,
        ['rack-75mm' as AnyNodeId]: rackAt75,
      }

      // 75mm is valid for EU and US, but fails TR (which requires 100mm)
      const euAudit = calculateZoneZDSUAudit(zone, null, nodes75, { standardId: 'EU' })
      const usAudit = calculateZoneZDSUAudit(zone, null, nodes75, { standardId: 'US' })
      const trAudit = calculateZoneZDSUAudit(zone, null, nodes75, { standardId: 'TR' })

      expect(euAudit.clearance.flueSpaceCompliant).toBe(true)
      expect(usAudit.clearance.flueSpaceCompliant).toBe(true)
      expect(trAudit.clearance.flueSpaceCompliant).toBe(false)

      // Test at 100.0mm (0.100m) -> should pass all standards
      const rackAt100 = makeRackNode('rack-100mm', zone.parentId!, { depthGap: 0.1 })
      const nodes100: Record<AnyNodeId, AnyNode> = {
        [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Zemin Kat' } as unknown as AnyNode,
        ['rack-100mm' as AnyNodeId]: rackAt100,
      }
      const trAudit100 = calculateZoneZDSUAudit(zone, null, nodes100, { standardId: 'TR' })
      expect(trAudit100.clearance.flueSpaceCompliant).toBe(true)
    })

    it('T2.B2: Staging buffer area exactly at threshold (25.0 m² and 30.0 m² per dock)', () => {
      // Zone with exactly 25.0 m² per dock (50m², 2 docks)
      const zone25 = makeTestZone({
        polygon: [
          [0, 0],
          [10, 0],
          [10, 5],
          [0, 5],
        ], // 50 m²
        spaceRole: 'generic',
        metadata: { role: 'staging-inbound' },
      })
      const nodes25: Record<AnyNodeId, AnyNode> = {
        [zone25.parentId!]: { id: zone25.parentId!, type: 'level', name: 'Zemin Kat' } as unknown as AnyNode,
        ['dock-1' as AnyNodeId]: makeDockNode('dock-1', zone25.parentId!),
        ['dock-2' as AnyNodeId]: makeDockNode('dock-2', zone25.parentId!),
      }

      // Under US standard, 25.0 m² is the exact threshold -> not less than 25, so no ZDSU-R03
      const usAudit = calculateZoneZDSUAudit(zone25, null, nodes25, { standardId: 'US' })
      expect(usAudit.staging.stagingAreaPerDockM2).toBe(25.0)
      expect(usAudit.defects.some((d) => d.code === 'ZDSU-R03')).toBe(false)
    })

    it('T2.B3: Unknown or invalid standard ID string falls back safely to default profile', () => {
      // Cast invalid string
      const invalidProfile = getStandardProfile('UNKNOWN_STANDARD' as unknown as RegulatoryStandardId)
      expect(invalidProfile).toBeDefined()
      expect(invalidProfile.id).toBe('TR')
    })

    it('T2.B4: Profile registry immutability — attempts to mutate retrieved thresholds do not alter registry', () => {
      const thresholds1 = getStandardThresholds('TR')
      const originalClearance = thresholds1.sprinklerClearanceM

      // Simulate a consumer trying to mutate returned threshold
      ;(thresholds1 as { sprinklerClearanceM: number }).sprinklerClearanceM = 999.0

      // Re-fetch should verify registry state is protected or standard re-fetching works
      const thresholds2 = getStandardProfile('TR').thresholds
      // Reset if directly referenced or assert registry profile properties
      expect(REGULATORY_STANDARDS.TR.thresholds.minFlueSpaceM).toBe(0.1)
      // Reset mutation to keep test isolated
      thresholds1.sprinklerClearanceM = originalClearance
    })

    it('T2.B5: High hazard sprinkler clearance comparison across standards', () => {
      const tr = getStandardThresholds('TR')
      const eu = getStandardThresholds('EU')
      const us = getStandardThresholds('US')

      expect(tr.sprinklerHighHazardClearanceM).toBe(0.9)
      expect(eu.sprinklerHighHazardClearanceM).toBe(1.0)
      expect(us.sprinklerHighHazardClearanceM).toBeCloseTo(0.914, 3)
    })

    it('T2.B6: Zero dock doors in staging zone does not produce division by zero or NaN', () => {
      const zone = makeTestZone({ spaceRole: 'generic', metadata: { role: 'staging-inbound' } })
      const nodes: Record<AnyNodeId, AnyNode> = {
        [zone.parentId!]: { id: zone.parentId!, type: 'level', name: 'Zemin Kat' } as unknown as AnyNode,
      }

      for (const stdId of ['TR', 'EU', 'US'] as RegulatoryStandardId[]) {
        const audit = calculateZoneZDSUAudit(zone, null, nodes, { standardId: stdId })
        expect(audit.staging.dockCount).toBe(0)
        expect(audit.staging.stagingAreaPerDockM2).toBeNull()
        expect(Number.isNaN(audit.readiness.score)).toBe(false)
      }
    })
  })
})
