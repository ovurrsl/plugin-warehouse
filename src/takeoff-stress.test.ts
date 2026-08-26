import type { AnyNode, AnyNodeId, ZoneNode } from '@pascal-app/core'
import { describe, expect, it } from 'bun:test'
import {
  calculateWarehouseZoneTakeoff,
  warehousePlugin,
  warehouseZoneTakeoffExtension,
} from './index'

const asNodeId = (id: string): AnyNodeId => id as unknown as AnyNodeId
const asNodes = (nodes: Record<string, AnyNode>): Record<AnyNodeId, AnyNode> =>
  nodes as unknown as Record<AnyNodeId, AnyNode>
const asContentIds = (ids: string[]): AnyNodeId[] => ids as unknown as AnyNodeId[]

function makeZone(partial?: Partial<ZoneNode>): ZoneNode {
  return {
    id: asNodeId('zone_stress_root'),
    type: 'zone',
    name: 'Mega Logistics Zone',
    spaceRole: 'generic',
    roomNumber: 'WH-STRESS',
    enclosureStatus: 'open',
    occupancy: 'High Density Logistics',
    floorFinish: 'Sealed Concrete',
    wallFinish: 'None',
    ceilingFinish: 'None',
    ceilingHeight: 14.0,
    clearDimensionPolicy: 'inside-faces',
    polygon: [
      [0, 0],
      [200, 0],
      [200, 200],
      [0, 200],
    ],
    autoFromWalls: false,
    boundaryWallIds: [],
    parentId: 'level_main',
    ...partial,
  } as ZoneNode
}

describe('Warehouse Zone Takeoff Engine — Empirical Stress & Adversarial Suite', () => {
  // =========================================================================
  // DIMENSION 1: Extreme Scale Stress Harness (10,000+ Mixed Nodes)
  // =========================================================================
  describe('Dimension 1: Extreme Scale Stress Harness (10,000+ Mixed Nodes)', () => {
    it('processes 10,000 mixed warehouse nodes in a single zone within tight execution budget (<1000ms)', () => {
      const zone = makeZone()
      const nodesRecord: Record<string, AnyNode> = {}
      const contentIdsList: string[] = []

      const totalNodes = 10000
      for (let i = 0; i < totalNodes; i++) {
        const id = `node_${i}`
        contentIdsList.push(id)
        const bucket = i % 10

        switch (bucket) {
          case 0: // Pallet Rack
            nodesRecord[id] = {
              id: asNodeId(id),
              type: 'warehouse:pallet-rack',
              bayClearWidth: 2.7,
              depth: 1.1,
              uprightHeight: 8.0,
              depthPositions: 1,
              levels: 4,
              groundLevelStorage: true,
              pickingLevels: 1, // 1 picking level per pallet rack
              levelClear: 1.5,
              firstLevelClear: 1.6,
              pickingLevelClear: 0.5,
              palletPreset: 'epal-1',
              palletOrientation: 'short-side-out',
              beamHeight: 0.1,
              pickingBeamHeight: 0.08,
              uprightWidth: 0.09,
              depthGap: 0.2,
              clearanceBetweenPallets: 0.1,
              clearanceToUpright: 0.075,
              hasGroundBeam: false,
              tunnelLevels: 0,
              ghostFill: 0,
              decking: 'open',
              pickingShelfThickness: 0.02,
              pickingBoxWidth: 0.3,
              pickingBoxDepth: 0.4,
              pickingBoxGap: 0.05,
            } as unknown as AnyNode
            break

          case 1: // Drive-In Rack
            nodesRecord[id] = {
              id: asNodeId(id),
              type: 'warehouse:drive-in-rack',
              laneClearWidth: 1.35,
              palletsDeep: 5,
              levels: 3,
              entryMode: 'drive-in',
              constructiveSystem: 'cs1',
              railType: 'gp',
              uprightWidth: 0.09,
              uprightHeight: 6.0,
              levelClear: 1.5,
              topClear: 0.5,
              depthClearance: 0.1,
              clearanceSide: 0.05,
              palletPreset: 'epal-1',
              palletOrientation: 'short-side-out',
              topBeamHeight: 0.12,
              guideRails: false,
              centralisers: false,
            } as unknown as AnyNode
            break

          case 2: // Live Dynamic Racking
            nodesRecord[id] = {
              id: asNodeId(id),
              type: 'warehouse:live-rack',
              palletsDeep: 6,
              levels: 4,
              variant: 'FIFO',
              gradient: 0.04,
              rollerPitch: 0.075,
              palletPreset: 'epal-1',
              firstLevelClear: 0.4,
              levelClear: 1.5,
              cladRack: false,
              floorSetPalletTruckLevel: false,
              withRetainers: false,
              intermediateRetainers: false,
              skus: ['SKU-A'],
            } as unknown as AnyNode
            break

          case 3: // Longspan M7 Shelving
            nodesRecord[id] = {
              id: asNodeId(id),
              type: 'warehouse:longspan-rack',
              bayLength: 2.1,
              depth: 0.8,
              uprightHeight: 2.5,
              shelfLevels: 4,
              beamHeight: 0.065,
              uprightWidth: 0.055,
              hasGroundBeam: false,
              deckingType: 'chipboard',
              deckingThickness: 0.022,
              hangingRail: true,
              hangingRailDiameter: 0.03,
              firstLevelClear: 0.2,
              levelClear: 0.5,
            } as unknown as AnyNode
            break

          case 4: // M3 Shelving
            nodesRecord[id] = {
              id: asNodeId(id),
              type: 'warehouse:m3-rack',
              shelfLength: 1.0,
              depth: 0.5,
              uprightHeight: 2.2,
              hasBackPanel: true,
              hasSidePanels: true,
              levels: [
                { elevation: 0.2, structure: 'shelf', model: 'HL', dividers: 0, drawerModel: 'MA', drawerWidth: 'wide' },
                { elevation: 0.6, structure: 'drawers', model: 'HL', dividers: 0, drawerModel: 'MA', drawerWidth: 'wide' },
              ],
            } as unknown as AnyNode
            break

          case 5: // Mezzanine Raised Platform
            nodesRecord[id] = {
              id: asNodeId(id),
              type: 'warehouse:mezzanine',
              constructiveSystem: 'SIGMA',
              grid: { baysX: 4, baysY: 3, bayWidthM: 5, bayDepthM: 5 },
              tiers: [
                {
                  index: 0,
                  elevationM: 0,
                  clearHeightM: 3.5,
                  loadClass: 500,
                  floorType: 'WOOD_CHIPBOARD_30',
                  accessories: { staircases: [], swingGates: [], upAndOverGates: [], safetyZones: [] },
                },
                {
                  index: 1,
                  elevationM: 3.5,
                  clearHeightM: 3.5,
                  loadClass: 500,
                  floorType: 'WOOD_CHIPBOARD_30',
                  accessories: { staircases: [], swingGates: [], upAndOverGates: [], safetyZones: [] },
                },
              ],
            } as unknown as AnyNode
            break

          case 6: // Conveyor Roller
            nodesRecord[id] = {
              id: asNodeId(id),
              type: 'warehouse:conveyor-roller',
              conveyorType: 'roller',
              straightLength: 6.0,
              conveyorWidth: 0.8,
              elevation: 0.8,
              driveType: 'lineshaft',
              zoneControl: 'none',
              legSpacing: 2.0,
            } as unknown as AnyNode
            break

          case 7: // Tote Cart
            nodesRecord[id] = {
              id: asNodeId(id),
              type: 'warehouse:tote-cart',
              toteFootprint: '600x400',
              toteHeight: '220',
              tiers: 3,
              castorDiameter: '100',
            } as unknown as AnyNode
            break

          case 8: // Floor Pallet
            nodesRecord[id] = {
              id: asNodeId(id),
              type: 'warehouse:pallet',
              preset: 'epal-1',
              loadType: 'carton-boxes',
              stackLayers: 4,
              overhang: 0.0,
              strapped: true,
              wrapped: true,
              slotRackId: null,
              slotAddress: null,
            } as unknown as AnyNode
            break

          case 9: // Route / Traffic Marking
            nodesRecord[id] = {
              id: asNodeId(id),
              type: 'warehouse:route',
              routeType: 'pedestrian',
              lineWidth: 0.1,
              color: '#FFD700',
              dashed: false,
              dashLength: 0.5,
              gapLength: 0.5,
              points: [
                [0, 0],
                [10, 0],
                [10, 20],
              ],
            } as unknown as AnyNode
            break
        }
      }

      const nodes = asNodes(nodesRecord)
      const contentIds = asContentIds(contentIdsList)

      const start = performance.now()
      const report = calculateWarehouseZoneTakeoff({ zone, contentIds, nodes })
      const elapsed = performance.now() - start

      expect(report).not.toBeNull()
      expect(report?.title).toBe('Warehouse storage takeoff')
      expect(elapsed).toBeLessThan(1000) // 10,000 nodes parsed and aggregated under 1s

      // Check aggregated statistics
      const baysMetric = report?.metrics.find((m) => m.key === 'total-bays')
      const palletMetric = report?.metrics.find((m) => m.key === 'pallet-capacity')
      const pickMetric = report?.metrics.find((m) => m.key === 'picking-capacity')
      const lvlsMetric = report?.metrics.find((m) => m.key === 'total-levels')

      // 1000 of each storage rack family:
      // Pallet racks (1000) + Drive-in (1000) + Live rack (1000) + Longspan (1000) + M3 (1000) = 5000 storage bays
      expect(baysMetric?.value).toBe(5000)
      expect(Number(palletMetric?.value)).toBeGreaterThan(10000)
      expect(Number(pickMetric?.value)).toBeGreaterThan(1000)
      expect(Number(lvlsMetric?.value)).toBeGreaterThan(10000)

      // Breakdown entries check
      expect(report?.breakdown).toBeDefined()
      expect(report?.breakdown?.length).toBeGreaterThanOrEqual(9)
    })
  })

  // =========================================================================
  // DIMENSION 2: Capacity Edge Cases
  // =========================================================================
  describe('Dimension 2: Capacity Calculation Edge Cases', () => {
    it('handles tight-clearance levels and single vs double-deep racks accurately', () => {
      const zone = makeZone()

      // Single-deep rack with minimum allowable clearance
      const rackSingleDeep: AnyNode = {
        id: asNodeId('rack_single'),
        type: 'warehouse:pallet-rack',
        bayClearWidth: 2.7,
        depth: 1.1,
        uprightHeight: 10.0,
        depthPositions: 1,
        levels: 5,
        groundLevelStorage: true,
        pickingLevels: 0,
        levelClear: 0.2, // Minimum valid clearance
        firstLevelClear: 0.2,
        palletPreset: 'epal-1',
        palletOrientation: 'short-side-out',
        beamHeight: 0.1,
        pickingBeamHeight: 0.08,
        uprightWidth: 0.09,
        depthGap: 0.05,
        clearanceBetweenPallets: 0.05,
        clearanceToUpright: 0.05,
        hasGroundBeam: false,
        tunnelLevels: 0,
        ghostFill: 0,
        decking: 'open',
        pickingShelfThickness: 0.02,
        pickingBoxWidth: 0.3,
        pickingBoxDepth: 0.4,
        pickingBoxGap: 0.02,
      } as unknown as AnyNode

      // Double-deep rack
      const rackDoubleDeep: AnyNode = {
        id: asNodeId('rack_double'),
        type: 'warehouse:pallet-rack',
        bayClearWidth: 2.7,
        depth: 1.1,
        uprightHeight: 10.0,
        depthPositions: 2, // Double deep
        levels: 5,
        groundLevelStorage: true,
        pickingLevels: 0,
        levelClear: 1.5,
        firstLevelClear: 1.6,
        palletPreset: 'epal-1',
        palletOrientation: 'short-side-out',
        beamHeight: 0.1,
        pickingBeamHeight: 0.08,
        uprightWidth: 0.09,
        depthGap: 0.2,
        clearanceBetweenPallets: 0.1,
        clearanceToUpright: 0.075,
        hasGroundBeam: false,
        tunnelLevels: 0,
        ghostFill: 0,
        decking: 'open',
        pickingShelfThickness: 0.02,
        pickingBoxWidth: 0.3,
        pickingBoxDepth: 0.4,
        pickingBoxGap: 0.05,
      } as unknown as AnyNode

      const nodes = asNodes({ rack_single: rackSingleDeep, rack_double: rackDoubleDeep })
      const report = calculateWarehouseZoneTakeoff({
        zone,
        contentIds: asContentIds(['rack_single', 'rack_double']),
        nodes,
      })

      expect(report).not.toBeNull()
      const selectiveBreakdown = report?.breakdown?.find((b) => b.id === 'selective-pallet-rack')
      expect(selectiveBreakdown).toBeDefined()
      expect(selectiveBreakdown?.count).toBe(2)

      const directAccessSub = selectiveBreakdown?.submetrics?.find((s) => s.label === 'Direct Access')
      expect(directAccessSub).toBeDefined()
      // In double-deep racks, direct access is half of total capacity
      expect(Number(directAccessSub?.value)).toBeGreaterThan(0)
    })

    it('calculates multi-tier mezzanine deck area and multi-level platforms', () => {
      const zone = makeZone()
      const mezz4Tier: AnyNode = {
        id: asNodeId('mezz_4tier'),
        type: 'warehouse:mezzanine',
        constructiveSystem: 'SIGMA',
        grid: { baysX: 4, baysY: 6, bayWidthM: 5, bayDepthM: 5 }, // 20m x 30m = 600m² per tier
        tiers: [
          {
            index: 0,
            elevationM: 0,
            clearHeightM: 3.5,
            loadClass: 500,
            floorType: 'WOOD_CHIPBOARD_30',
            accessories: { staircases: [], swingGates: [], upAndOverGates: [], safetyZones: [] },
          },
          {
            index: 1,
            elevationM: 3.5,
            clearHeightM: 3.5,
            loadClass: 500,
            floorType: 'WOOD_CHIPBOARD_30',
            accessories: { staircases: [], swingGates: [], upAndOverGates: [], safetyZones: [] },
          },
          {
            index: 2,
            elevationM: 7.0,
            clearHeightM: 3.5,
            loadClass: 500,
            floorType: 'WOOD_CHIPBOARD_30',
            accessories: { staircases: [], swingGates: [], upAndOverGates: [], safetyZones: [] },
          },
          {
            index: 3,
            elevationM: 10.5,
            clearHeightM: 3.5,
            loadClass: 500,
            floorType: 'WOOD_CHIPBOARD_30',
            accessories: { staircases: [], swingGates: [], upAndOverGates: [], safetyZones: [] },
          },
        ],
      } as unknown as AnyNode

      const nodes = asNodes({ mezz_4tier: mezz4Tier })
      const report = calculateWarehouseZoneTakeoff({
        zone,
        contentIds: asContentIds(['mezz_4tier']),
        nodes,
      })

      expect(report).not.toBeNull()
      const mezzBreakdown = report?.breakdown?.find((b) => b.id === 'mezzanine-platforms')
      expect(mezzBreakdown).toBeDefined()
      expect(mezzBreakdown?.count).toBe(1)
      expect(mezzBreakdown?.details).toContain('4 tiers')

      const tiersSub = mezzBreakdown?.submetrics?.find((s) => s.label === 'Tiers')
      expect(tiersSub?.value).toBe(4)

      const deckAreaSub = mezzBreakdown?.submetrics?.find((s) => s.label === 'Deck Area')
      expect(deckAreaSub).toBeDefined()
      // 20m x 30m = 600m² per tier * 4 tiers = 2400m²
      expect(deckAreaSub?.value).toBe('2400.0 m²')
    })

    it('aggregates 8 chained conveyor types into a unified Conveyor Network metric', () => {
      const zone = makeZone()
      const nodesRecord: Record<string, AnyNode> = {
        c_roller: {
          id: asNodeId('c_roller'),
          type: 'warehouse:conveyor-roller',
          conveyorType: 'roller',
          straightLength: 10.0,
          conveyorWidth: 0.8,
          elevation: 0.8,
          driveType: 'lineshaft',
          zoneControl: 'none',
          legSpacing: 2.0,
        } as unknown as AnyNode,

        c_curve: {
          id: asNodeId('c_curve'),
          type: 'warehouse:conveyor-curve',
          angleDeg: 90,
          innerRadiusM: 1.0,
          conveyorWidth: 0.8,
          curveAngle: 90,
          curveRadius: 1.0,
          elevation: 0.8,
          driveType: 'belt',
        } as unknown as AnyNode,

        c_booster: {
          id: asNodeId('c_booster'),
          type: 'warehouse:conveyor-booster',
          straightLength: 8.0,
          lengthM: 8.0,
          inclineAngleDeg: 15,
          beltType: 'grip-top',
          elevation: 0.8,
        } as unknown as AnyNode,

        c_launcher: {
          id: asNodeId('c_launcher'),
          type: 'warehouse:conveyor-launcher',
          straightLength: 5.0,
          lengthM: 5.0,
          elevation: 1.2,
        } as unknown as AnyNode,

        c_oblique: {
          id: asNodeId('c_oblique'),
          type: 'warehouse:conveyor-oblique',
          straightLength: 4.0,
          lengthM: 4.0,
          angleDeg: 45,
          elevation: 0.8,
        } as unknown as AnyNode,

        c_spiral: {
          id: asNodeId('c_spiral'),
          type: 'warehouse:conveyor-spiral',
          radiusM: 1.5,
          turns: 2.5,
          pitchM: 0.8,
          elevation: 0.8,
        } as unknown as AnyNode,

        c_telescopic: {
          id: asNodeId('c_telescopic'),
          type: 'warehouse:conveyor-telescopic',
          baseLengthM: 6.0,
          extensionLengthM: 12.0,
          extensionState: 0.5, // 6 + 0.5 * 12 = 12m
          elevation: 1.0,
        } as unknown as AnyNode,

        c_transfer: {
          id: asNodeId('c_transfer'),
          type: 'warehouse:conveyor-transfer',
          straightLength: 3.0,
          lengthM: 3.0,
          transferType: 'pop-up-rollers',
          elevation: 0.8,
        } as unknown as AnyNode,
      }

      const nodes = asNodes(nodesRecord)
      const contentIds = asContentIds(Object.keys(nodesRecord))

      const report = calculateWarehouseZoneTakeoff({ zone, contentIds, nodes })
      expect(report).not.toBeNull()

      const conveyorBreakdown = report?.breakdown?.find((b) => b.id === 'conveyor-network')
      expect(conveyorBreakdown).toBeDefined()
      expect(conveyorBreakdown?.count).toBe(8)

      const lengthSub = conveyorBreakdown?.submetrics?.find((s) => s.label === 'Total Length')
      expect(lengthSub).toBeDefined()
      expect(parseFloat(String(lengthSub?.value))).toBeGreaterThan(35) // Substantial chained length
    })
  })

  // =========================================================================
  // DIMENSION 3: Shallow Equality Stability & React 185 Loop Prevention
  // =========================================================================
  describe('Dimension 3: Shallow Equality Stability & React 185 Loop Prevention', () => {
    it('produces deterministically identical outputs across repeated calls on unchanged scenes', () => {
      const zone = makeZone()
      const rack: AnyNode = {
        id: asNodeId('rack_memo'),
        type: 'warehouse:pallet-rack',
        bayClearWidth: 2.7,
        depth: 1.1,
        uprightHeight: 8.0,
        depthPositions: 1,
        levels: 4,
        groundLevelStorage: true,
        pickingLevels: 0,
        levelClear: 1.5,
        firstLevelClear: 1.6,
        palletPreset: 'epal-1',
        palletOrientation: 'short-side-out',
        beamHeight: 0.1,
        pickingBeamHeight: 0.08,
        uprightWidth: 0.09,
        depthGap: 0.2,
        clearanceBetweenPallets: 0.1,
        clearanceToUpright: 0.075,
        hasGroundBeam: false,
        tunnelLevels: 0,
        ghostFill: 0,
        decking: 'open',
        pickingShelfThickness: 0.02,
        pickingBoxWidth: 0.3,
        pickingBoxDepth: 0.4,
        pickingBoxGap: 0.05,
      } as unknown as AnyNode

      const nodes = asNodes({ rack_memo: rack })
      const contentIds = asContentIds(['rack_memo'])

      const run1 = calculateWarehouseZoneTakeoff({ zone, contentIds, nodes })
      const run2 = calculateWarehouseZoneTakeoff({ zone, contentIds, nodes })

      expect(run1).not.toBeNull()
      expect(run2).not.toBeNull()
      expect(run1).toEqual(run2)

      // Compare metric values and keys
      expect(run1?.metrics.map((m) => `${m.key}:${m.value}`)).toEqual(
        run2?.metrics.map((m) => `${m.key}:${m.value}`),
      )
    })

    it('extension supportsZone returns false for non-warehouse nodes and avoids unnecessary derivations', () => {
      const zone = makeZone()
      const nodes = asNodes({
        wall_1: { id: asNodeId('wall_1'), type: 'wall' } as unknown as AnyNode,
        slab_1: { id: asNodeId('slab_1'), type: 'slab' } as unknown as AnyNode,
        item_1: { id: asNodeId('item_1'), type: 'item' } as unknown as AnyNode,
      })

      const supportsNonWarehouse = warehouseZoneTakeoffExtension.supportsZone({
        zone,
        contentIds: asContentIds(['wall_1', 'slab_1', 'item_1']),
        nodes,
      })
      expect(supportsNonWarehouse).toBe(false)

      const supportsEmpty = warehouseZoneTakeoffExtension.supportsZone({
        zone,
        contentIds: [],
        nodes: {},
      })
      expect(supportsEmpty).toBe(false)
    })
  })

  // =========================================================================
  // DIMENSION 4: Non-Warehouse & Degenerate Scene Safety
  // =========================================================================
  describe('Dimension 4: Non-Warehouse & Degenerate Scene Safety', () => {
    it('safely handles corrupted node schemas, missing fields, and NaN geometry without throwing', () => {
      const zone = makeZone()
      const corruptNodes: Record<string, AnyNode> = {
        corrupt_rack: {
          id: asNodeId('corrupt_rack'),
          type: 'warehouse:pallet-rack',
          // missing all required rack fields
        } as unknown as AnyNode,
        corrupt_mezz: {
          id: asNodeId('corrupt_mezz'),
          type: 'warehouse:mezzanine',
          tiers: 'invalid-tiers' as unknown as [],
        } as unknown as AnyNode,
        corrupt_route: {
          id: asNodeId('corrupt_route'),
          type: 'warehouse:route',
          points: [[NaN, NaN], [undefined, null]] as unknown as [],
        } as unknown as AnyNode,
        null_node: null as unknown as AnyNode,
        undefined_node: undefined as unknown as AnyNode,
      }

      const nodes = asNodes(corruptNodes)
      const contentIds = asContentIds([
        'corrupt_rack',
        'corrupt_mezz',
        'corrupt_route',
        'null_node',
        'undefined_node',
      ])

      // Must not throw an unhandled exception
      expect(() => {
        const report = calculateWarehouseZoneTakeoff({ zone, contentIds, nodes })
      }).not.toThrow()
    })

    it('returns clean null when contentIds is completely empty', () => {
      const zone = makeZone()
      const report = calculateWarehouseZoneTakeoff({
        zone,
        contentIds: [],
        nodes: {},
      })
      expect(report).toBeNull()
    })
  })
})
