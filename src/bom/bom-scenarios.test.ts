import { describe, expect, it } from 'bun:test'
import type { AnyNode, AnyNodeId, ZoneNode } from '@pascal-app/core'
import { calculateWarehouseBOM, generateWarehouseBomPdf } from './index'

const asNodeId = (id: string): AnyNodeId => id as unknown as AnyNodeId
const asNodes = (nodes: Record<string, AnyNode>): Record<string, AnyNode> => nodes

function makeScenarioZone(id: string, name: string, polygon: [number, number][]): ZoneNode {
  return {
    id: asNodeId(id),
    type: 'zone',
    name,
    parentId: asNodeId('level_ground'),
    roomNumber: id.toUpperCase(),
    spaceRole: 'generic',
    enclosureStatus: 'open',
    occupancy: 'Industrial',
    floorFinish: 'Sealed Concrete',
    wallFinish: 'None',
    ceilingFinish: 'None',
    ceilingHeight: 12.0,
    clearDimensionPolicy: 'inside-faces',
    polygon,
    autoFromWalls: false,
    boundaryWallIds: [],
  } as unknown as ZoneNode
}

describe('Tier 4: Real-World Workload Scenarios', () => {
  // ── Scenario 1: 3PL Logistics Distribution Center ─────────────────────────
  it('Scenario 1: 3PL Logistics Distribution Center (Selective Pallet Racking + VNA + Docks)', async () => {
    const mainZone = makeScenarioZone('zone_3pl', 'High-Bay Pallet Storage Zone', [
      [0, 0],
      [120, 0],
      [120, 80],
      [0, 80],
    ])

    const nodesRecord: Record<string, AnyNode> = {}
    const zoneNodeIds: string[] = []

    // 8 Aisles of 15 bays each = 120 selective pallet rack bays
    // Each bay: 4 beam levels, wire-mesh decking, single-deep, 2.7m clear width, 8m high
    const bayPitch = 2.88
    for (let aisle = 0; aisle < 8; aisle++) {
      const zPos = 10 + aisle * 8
      for (let bay = 0; bay < 15; bay++) {
        const id = `rack_3pl_a${aisle}_b${bay}`
        const isLastInRun = bay === 14
        nodesRecord[id] = {
          id: asNodeId(id),
          type: 'warehouse:pallet-rack',
          parentId: asNodeId('level_ground'),
          position: [10 + bay * bayPitch, 0, zPos],
          rotation: [0, 0, 0],
          bayClearWidth: 2.7,
          uprightWidth: 0.09,
          uprightHeight: 8.0,
          depth: 1.1,
          depthPositions: 1,
          levels: 4,
          hasRightNeighbour: !isLastInRun,
          decking: 'wire-mesh',
          palletPreset: 'epal-1',
        } as unknown as AnyNode
        zoneNodeIds.push(id)
      }
    }

    // 4 Inbound/Outbound Dock Levellers
    for (let d = 0; d < 4; d++) {
      const id = `dock_${d + 1}`
      nodesRecord[id] = {
        id: asNodeId(id),
        type: 'warehouse:dock-leveller',
        parentId: asNodeId('level_ground'),
        position: [5 + d * 15, 0, 75],
        platformWidth: 2.0,
        platformLength: 2.5,
      } as unknown as AnyNode
      zoneNodeIds.push(id)
    }

    // 3 Reach Trucks & 2 Forklifts
    for (let t = 0; t < 3; t++) {
      const id = `reach_truck_${t + 1}`
      nodesRecord[id] = {
        id: asNodeId(id),
        type: 'warehouse:truck-reach',
        parentId: asNodeId('level_ground'),
        position: [20 + t * 10, 0, 5],
      } as unknown as AnyNode
      zoneNodeIds.push(id)
    }

    // 1. Calculate Zone-Scoped BOM
    const bom3PL = calculateWarehouseBOM(asNodes(nodesRecord), {
      filterNodeIds: zoneNodeIds,
      projectName: 'Apex Global 3PL Logistics DC',
      zoneName: mainZone.name,
      scopeLabel: 'Zone: High-Bay Pallet Storage',
    })

    expect(bom3PL.projectName).toBe('Apex Global 3PL Logistics DC')
    expect(bom3PL.zoneName).toBe('High-Bay Pallet Storage Zone')

    // Verify 120 bays calculation:
    // 8 runs of 15 bays. In each run of 15 bays: 16 frame lines.
    // 8 runs x 16 frame lines = 128 frame lines = 256 upright posts (2 posts/frame line)
    const rackSection = bom3PL.sections.find(
      (s) => s.id === 'pallet-racking' || s.title.includes('Pallet Rack'),
    )
    expect(rackSection).toBeDefined()

    const posts = rackSection?.items.find(
      (i) => i.role.includes('post') || i.item.includes('Upright Post'),
    )
    expect(posts?.quantity).toBe(256)

    // Load beams: 120 bays x 4 levels x 2 beams = 960 load beams
    const beams = rackSection?.items.find(
      (i) => i.role.includes('beam') || i.item.includes('Load Beam'),
    )
    expect(beams?.quantity).toBe(960)

    // Safety locking pins: 960 x 2 = 1920 safety pins
    const pins = rackSection?.items.find(
      (i) => i.role.includes('pin') || i.item.includes('Safety Pin'),
    )
    expect(pins?.quantity).toBe(1920)

    // Wire mesh shelves: 120 bays x 4 levels = 480 shelf decks
    const decks = rackSection?.items.find(
      (i) => i.role.includes('shelf') || i.item.includes('Wire Mesh'),
    )
    expect(decks?.quantity).toBe(480)

    // 2. Generate PDF Report & Assert Valid Binary Stream
    const pdfBytes = await generateWarehouseBomPdf(bom3PL)
    expect(pdfBytes.byteLength).toBeGreaterThan(1000)
    const header = String.fromCharCode(
      pdfBytes[0]!,
      pdfBytes[1]!,
      pdfBytes[2]!,
      pdfBytes[3]!,
      pdfBytes[4]!,
    )
    expect(header).toBe('%PDF-')
  })

  // ── Scenario 2: High-Density Cold Storage Facility ────────────────────────
  it('Scenario 2: High-Density Cold Storage Facility (Drive-In + Pallet Flow)', async () => {
    const coldZone = makeScenarioZone('zone_cold', 'Deep Freeze Chamber (-25°C)', [
      [0, 0],
      [60, 0],
      [60, 40],
      [0, 40],
    ])

    const nodesRecord: Record<string, AnyNode> = {}
    const zoneNodeIds: string[] = []

    // 10 Drive-In Lanes (6 pallets deep, 4 levels high = 24 positions/lane, 240 positions total)
    for (let lane = 0; lane < 10; lane++) {
      const id = `drivein_lane_${lane + 1}`
      nodesRecord[id] = {
        id: asNodeId(id),
        type: 'warehouse:drive-in-rack',
        parentId: asNodeId('level_ground'),
        position: [10 + lane * 1.6, 0, 15],
        rotation: [0, 0, 0],
        laneClearWidth: 1.35,
        uprightWidth: 0.1,
        palletsDeep: 6,
        palletRunDepth: 1.2,
        depthClearance: 0.025,
        levels: 4,
      } as unknown as AnyNode
      zoneNodeIds.push(id)
    }

    // 6 Pallet Flow Live Racking Lanes (10m deep, 3 levels high)
    for (let flow = 0; flow < 6; flow++) {
      const id = `flow_lane_${flow + 1}`
      nodesRecord[id] = {
        id: asNodeId(id),
        type: 'warehouse:live-rack',
        parentId: asNodeId('level_ground'),
        position: [35 + flow * 1.8, 0, 20],
        rotation: [0, 0, 0],
        bayWidth: 1.6,
        channelDepth: 10.0,
        levels: 3,
      } as unknown as AnyNode
      zoneNodeIds.push(id)
    }

    // Calculate BOM
    const bomCold = calculateWarehouseBOM(asNodes(nodesRecord), {
      filterNodeIds: zoneNodeIds,
      projectName: 'Nordic Cold Logistics Phase II',
      zoneName: coldZone.name,
    })

    expect(bomCold.sections.length).toBeGreaterThanOrEqual(2)

    const driveInSection = bomCold.sections.find(
      (s) => s.id === 'drive-in' || s.title.includes('Drive-In'),
    )
    expect(driveInSection).toBeDefined()
    // 10 lanes x 8 continuous support rails/lane = 80 support rails
    const rails = driveInSection?.items.find(
      (i) => i.role.includes('rail') && !i.role.includes('guide'),
    )
    expect(rails?.quantity).toBe(80)

    const liveSection = bomCold.sections.find(
      (s) => s.id === 'live-racking' || s.title.includes('Live'),
    )
    expect(liveSection).toBeDefined()
    // 6 lanes x 3 levels = 18 roller tracks & 18 pallet separators
    const tracks = liveSection?.items.find(
      (i) => i.role.includes('track') || i.item.includes('Roller Track'),
    )
    expect(tracks?.quantity).toBe(18)
    const separators = liveSection?.items.find(
      (i) => i.role.includes('separator') || i.item.includes('Separator'),
    )
    expect(separators?.quantity).toBe(18)

    // Generate PDF
    const pdfBytes = await generateWarehouseBomPdf(bomCold)
    expect(pdfBytes.byteLength).toBeGreaterThan(1000)
    const header = String.fromCharCode(
      pdfBytes[0]!,
      pdfBytes[1]!,
      pdfBytes[2]!,
      pdfBytes[3]!,
      pdfBytes[4]!,
    )
    expect(header).toBe('%PDF-')
  })

  // ── Scenario 3: E-commerce Fulfillment Hub ────────────────────────────────
  it('Scenario 3: E-commerce Fulfillment Hub (M3 Pick Towers + Mezzanine + Conveyor Sorting Loop)', async () => {
    const fulfillmentZone = makeScenarioZone('zone_fulfillment', 'E-Commerce Pick & Pack Module', [
      [0, 0],
      [100, 0],
      [100, 60],
      [0, 60],
    ])

    const nodesRecord: Record<string, AnyNode> = {}
    const zoneNodeIds: string[] = []

    // 20 M3 Shelving Units (5 levels, 20 drawers, 40 dividers each)
    for (let m = 0; m < 20; m++) {
      const id = `m3_shelving_${m + 1}`
      nodesRecord[id] = {
        id: asNodeId(id),
        type: 'warehouse:m3-rack',
        parentId: asNodeId('level_ground'),
        position: [10 + (m % 10) * 1.2, 0, 10 + Math.floor(m / 10) * 3],
        shelfLength: 1.0,
        shelfDepth: 0.5,
        levels: 5,
        drawers: 2,
        dividers: 4,
      } as unknown as AnyNode
      zoneNodeIds.push(id)
    }

    // Structural Mezzanine Platform (30m x 15m = 450 m²)
    const mezzId = 'fulfillment_mezzanine'
    nodesRecord[mezzId] = {
      id: asNodeId(mezzId),
      type: 'warehouse:mezzanine',
      parentId: asNodeId('level_ground'),
      position: [50, 0, 30],
      width: 30,
      depth: 15,
      columnGridX: 6,
      columnGridZ: 5,
      handrailPerimeter: 90,
      staircases: 2,
    } as unknown as AnyNode
    zoneNodeIds.push(mezzId)

    // Conveyor Network (50m straight run + 2 curve modules)
    const convId1 = 'main_conveyor_line'
    nodesRecord[convId1] = {
      id: asNodeId(convId1),
      type: 'warehouse:conveyor-straight',
      parentId: asNodeId('level_ground'),
      position: [50, 0, 45],
      length: 50,
      width: 0.8,
    } as unknown as AnyNode
    zoneNodeIds.push(convId1)

    // 8 Packing Workbenches
    for (let w = 0; w < 8; w++) {
      const id = `packing_bench_${w + 1}`
      nodesRecord[id] = {
        id: asNodeId(id),
        type: 'warehouse:bench',
        parentId: asNodeId('level_ground'),
        position: [15 + w * 4, 0, 50],
        width: 2.0,
        depth: 1.0,
      } as unknown as AnyNode
      zoneNodeIds.push(id)
    }

    // Calculate BOM
    const bomFulfillment = calculateWarehouseBOM(asNodes(nodesRecord), {
      filterNodeIds: zoneNodeIds,
      projectName: 'Omni-Channel Logistics Mega-Hub',
      zoneName: fulfillmentZone.name,
    })

    // Check M3 Shelves: 20 units x 5 shelves = 100 steel shelves, 400 support clips
    const m3Section = bomFulfillment.sections.find(
      (s) => s.id === 'm3-shelving' || s.title.includes('M3'),
    )
    expect(m3Section).toBeDefined()
    const shelves = m3Section?.items.find(
      (i) => i.role.includes('shelf') || i.item.includes('Steel Shelf'),
    )
    expect(shelves?.quantity).toBe(100)
    const clips = m3Section?.items.find(
      (i) => i.role.includes('clip') || i.item.includes('Support Clip'),
    )
    expect(clips?.quantity).toBe(400)

    // Check Mezzanine: 450 m² deck floor
    const mezzSection = bomFulfillment.sections.find(
      (s) => s.id === 'mezzanines' || s.title.includes('Mezzanine'),
    )
    expect(mezzSection).toBeDefined()
    const deck = mezzSection?.items.find((i) => i.unit === 'm²' || i.item.includes('Deck Flooring'))
    expect(deck?.quantity).toBeCloseTo(450, 1)

    // Check Conveyors
    const convSection = bomFulfillment.sections.find(
      (s) => s.id === 'conveyors' || s.title.includes('Conveyor'),
    )
    expect(convSection).toBeDefined()

    // Generate Full PDF
    const pdfBytes = await generateWarehouseBomPdf(bomFulfillment)
    expect(pdfBytes.byteLength).toBeGreaterThan(1500)
    const header = String.fromCharCode(
      pdfBytes[0]!,
      pdfBytes[1]!,
      pdfBytes[2]!,
      pdfBytes[3]!,
      pdfBytes[4]!,
    )
    expect(header).toBe('%PDF-')
  })
})
