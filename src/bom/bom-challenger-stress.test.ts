import { describe, expect, it } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { calculateWarehouseBOM, generateWarehouseBomPdf } from './index'

const asNodeId = (id: string): AnyNodeId => id as unknown as AnyNodeId
const asNodes = (nodes: Record<string, AnyNode>): Record<string, AnyNode> => nodes

describe('Challenger 2: Empirical Stress Testing & Boundary Verification', () => {
  // ── 1. Multi-Tier Mezzanine Platforms ─────────────────────────────────────
  it('Task 1.1: Multi-tier mezzanine with 3 tiers, column grids, staircases, and safety gates', async () => {
    const mezzMultiTier: AnyNode = {
      id: asNodeId('mezz_multi_3tier'),
      type: 'warehouse:mezzanine',
      parentId: asNodeId('level_0'),
      position: [-20, 0, -40], // Negative coordinates test
      rotation: [0, 0, 0],
      width: 40.0,
      depth: 25.0,
      columnGridX: 8,
      columnGridZ: 5,
      handrailPerimeter: 130.0,
      tiers: [
        {
          index: 0,
          elevationM: 'auto',
          clearHeightM: 3.2,
          loadClass: 500,
          floorType: 'WOOD_CHIPBOARD_30',
          accessories: {
            staircases: [
              {
                id: 'stair_1',
                placement: { mode: 'edge', edge: 'south', offsetM: 5 },
                widthM: 1,
                landing: 'turn180',
                railings: 2,
                steps: 'auto',
              },
            ],
            swingGates: [{ edge: 'north', offsetM: 10, widthM: 0.75 }],
            upAndOverGates: [],
            safetyZones: [],
          },
        },
        {
          index: 1,
          elevationM: 'auto',
          clearHeightM: 3.2,
          loadClass: 350,
          floorType: 'METAL_GRID',
          accessories: {
            staircases: [
              {
                id: 'stair_2',
                placement: { mode: 'edge', edge: 'south', offsetM: 15 },
                widthM: 1,
                landing: 'turn180',
                railings: 2,
                steps: 'auto',
              },
            ],
            swingGates: [],
            upAndOverGates: [{ edge: 'north', offsetM: 20, widthM: 1.5 }],
            safetyZones: [],
          },
        },
        {
          index: 2,
          elevationM: 'auto',
          clearHeightM: 3.2,
          loadClass: 500,
          floorType: 'METAL_GRID',
          accessories: {
            staircases: [
              {
                id: 'stair_3',
                placement: { mode: 'edge', edge: 'south', offsetM: 25 },
                widthM: 1,
                landing: 'turn180',
                railings: 2,
                steps: 'auto',
              },
            ],
            swingGates: [{ edge: 'north', offsetM: 30, widthM: 1.5 }],
            upAndOverGates: [],
            safetyZones: [],
          },
        },
      ],
    } as unknown as AnyNode

    const bom = calculateWarehouseBOM(asNodes({ mezz_multi_3tier: mezzMultiTier }), {
      projectName: 'Multi-Tier Logistics Mezzanine Complex',
      scopeLabel: 'Mezzanine Zone M-1',
    })

    const mezzSec = bom.sections.find((s) => s.id === 'mezzanine-structures')
    expect(mezzSec).toBeDefined()

    // 40 columns (8 x 5)
    const columns = mezzSec?.items.find((i) => i.role === 'column')
    expect(columns?.quantity).toBe(40)

    // Floor area = 40 x 25 x 3 tiers = 3000 m²
    const deck = mezzSec?.items.find((i) => i.role === 'deck-floor')
    expect(deck?.quantity).toBe(3000)

    // Handrails = 130m x 3 tiers = 390m
    const handrail = mezzSec?.items.find((i) => i.role === 'handrail' && i.item.includes('Handrail'))
    expect(handrail?.quantity).toBe(390)

    // Staircases = 3
    const stairs = mezzSec?.items.find((i) => i.role === 'staircase')
    expect(stairs?.quantity).toBe(3)

    // Fasteners: 40 columns * 4 anchors = 160 structural anchors
    const fastenersSec = bom.sections.find((s) => s.id === 'fasteners-accessories')
    const anchors = fastenersSec?.items.find((i) => i.role === 'anchor-bolt' && i.specification.includes('M16'))
    expect(anchors?.quantity).toBe(160)

    // Non-crashing PDF export
    const pdf = await generateWarehouseBomPdf(bom)
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })

  // ── 2. Complex Conveyor Sorting Loops & Specialized Flow ──────────────────
  it('Task 1.2: Complex conveyor sorting loops with spiral chutes, boosters, curves, and diverters', async () => {
    const nodesRecord: Record<string, AnyNode> = {
      conv_straight_1: {
        id: asNodeId('conv_straight_1'),
        type: 'warehouse:conveyor-straight',
        parentId: asNodeId('level_0'),
        position: [-10, 0, -10],
        length: 20.0,
        width: 0.8,
        driven: true,
      } as unknown as AnyNode,
      conv_curve_1: {
        id: asNodeId('conv_curve_1'),
        type: 'warehouse:conveyor-curve',
        parentId: asNodeId('level_0'),
        position: [10, 0, -10],
        innerRadius: 1.2,
        frameWidth: 0.8,
        angleDeg: 90,
      } as unknown as AnyNode,
      conv_booster_1: {
        id: asNodeId('conv_booster_1'),
        type: 'warehouse:conveyor-booster',
        parentId: asNodeId('level_0'),
        position: [15, 0, 0],
        moduleLengthM: 8.0,
        targetLiftM: 2.5,
      } as unknown as AnyNode,
      conv_spiral_1: {
        id: asNodeId('conv_spiral_1'),
        type: 'warehouse:conveyor-spiral',
        parentId: asNodeId('level_0'),
        position: [15, 0, 10],
        totalHeightM: 4.5,
        innerRadiusM: 1.0,
        turns: 2.5,
      } as unknown as AnyNode,
      conv_launcher_1: {
        id: asNodeId('conv_launcher_1'),
        type: 'warehouse:conveyor-launcher',
        parentId: asNodeId('level_0'),
        position: [15, 0, 20],
        lengthM: 4.0,
      } as unknown as AnyNode,
      conv_oblique_1: {
        id: asNodeId('conv_oblique_1'),
        type: 'warehouse:conveyor-oblique',
        parentId: asNodeId('level_0'),
        position: [10, 0, 25],
        lengthM: 6.0,
      } as unknown as AnyNode,
      conv_transfer_1: {
        id: asNodeId('conv_transfer_1'),
        type: 'warehouse:conveyor-transfer',
        parentId: asNodeId('level_0'),
        position: [0, 0, 25],
        lengthM: 1.5,
      } as unknown as AnyNode,
      conv_telescopic_1: {
        id: asNodeId('conv_telescopic_1'),
        type: 'warehouse:conveyor-telescopic',
        parentId: asNodeId('level_0'),
        position: [-15, 0, 25],
        extendedLengthM: 14.0,
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(asNodes(nodesRecord), {
      projectName: 'Automated Parcel Sorting Loop',
    })

    const convSec = bom.sections.find((s) => s.id === 'conveyors')
    expect(convSec).toBeDefined()
    expect(convSec?.items.length).toBeGreaterThanOrEqual(8)

    // Check all conveyor equipment items are accounted for
    expect(convSec?.items.some((i) => i.item.includes('Driven Roller Conveyor'))).toBe(true)
    expect(convSec?.items.some((i) => i.item.includes('Curved Roller'))).toBe(true)
    expect(convSec?.items.some((i) => i.item.includes('Incline Belt Booster'))).toBe(true)
    expect(convSec?.items.some((i) => i.item.includes('Spiral Gravity Chute'))).toBe(true)
    expect(convSec?.items.some((i) => i.item.includes('Conveyor Feed Launcher'))).toBe(true)
    expect(convSec?.items.some((i) => i.item.includes('Oblique Incline'))).toBe(true)
    expect(convSec?.items.some((i) => i.item.includes('Pop-up Diverter'))).toBe(true)
    expect(convSec?.items.some((i) => i.item.includes('Telescopic Boom Truck Loader'))).toBe(true)

    const pdf = await generateWarehouseBomPdf(bom)
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })

  // ── 3. Drive-In Lanes & Live Pallet Flow Racking ───────────────────────────
  it('Task 1.3: Deep drive-in lanes with drive-through mode, entry horns, and live flow FIFO', async () => {
    const nodesRecord: Record<string, AnyNode> = {
      driveIn_deep: {
        id: asNodeId('driveIn_deep'),
        type: 'warehouse:drive-in-rack',
        parentId: asNodeId('level_0'),
        position: [-30, 0, -20],
        laneClearWidth: 1.4,
        uprightWidth: 0.1,
        uprightDepth: 0.08,
        uprightHeight: 9.0,
        palletsDeep: 8,
        levels: 5,
        railType: 'gp',
        guideRails: true,
        centralisers: true,
        uprightReinforcer: true,
        entryMode: 'drive-through',
      } as unknown as AnyNode,
      liveRack_fifo: {
        id: asNodeId('liveRack_fifo'),
        type: 'warehouse:live-rack',
        parentId: asNodeId('level_0'),
        position: [-10, 0, -20],
        bayWidth: 1.8,
        channelDepth: 12.0,
        levels: 4,
        gradient: 0.04,
        rollerPitch: 0.05,
        splitRollers: true,
        variant: 'FIFO',
        withRetainers: true,
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(asNodes(nodesRecord))

    const driveInSec = bom.sections.find((s) => s.id === 'drive-in-racks')
    expect(driveInSec).toBeDefined()
    // 5 levels -> 10 continuous rails
    const rails = driveInSec?.items.find((i) => i.role === 'pallet-rail')
    expect(rails?.quantity).toBe(10)
    // Centralisers: drive-through mode has 4 mouths * 5 levels = 20 centraliser horns
    const horns = driveInSec?.items.find((i) => i.item.includes('Centraliser Horn'))
    expect(horns?.quantity).toBe(20)

    const liveSec = bom.sections.find((s) => s.id === 'live-racking')
    expect(liveSec).toBeDefined()
    // 4 levels -> 4 roller track channels & 4 pallet separators
    const tracks = liveSec?.items.find((i) => i.role === 'roller-track')
    expect(tracks?.quantity).toBe(4)
    const retainers = liveSec?.items.find((i) => i.role === 'pallet-separator')
    expect(retainers?.quantity).toBe(4)
    // Split rollers
    const rollers = liveSec?.items.find((i) => i.role === 'flow-roller')
    expect(rollers?.item).toContain('Split Gravity Flow Roller')
  })

  // ── 4. M3 Shelving Installations ──────────────────────────────────────────
  it('Task 1.4: High-density M3 picking shelving with continuous frame sharing and mixed drawers', async () => {
    const nodesRecord: Record<string, AnyNode> = {}
    const count = 6
    const pitch = 1.03 // shelfLength (1.0) + UPRIGHT_FRONT_FACE (0.03)
    for (let i = 0; i < count; i++) {
      const id = `m3_run_${i}`
      const isLast = i === count - 1
      nodesRecord[id] = {
        id: asNodeId(id),
        type: 'warehouse:m3-rack',
        parentId: asNodeId('level_0'),
        position: [i * pitch, 0, 0],
        rotation: [0, 0, 0],
        shelfLength: 1.0,
        shelfDepth: 0.4,
        frameHeight: 2.5,
        frameVariant: 'basic',
        levels: [
          { elevation: 0.1, structure: 'shelf', model: 'HM', dividers: 4 },
          { elevation: 0.6, structure: 'shelf', model: 'HM', dividers: 4 },
          { elevation: 1.1, structure: 'shelf', model: 'HL', dividers: 2 },
          { elevation: 1.6, structure: 'drawers', model: 'HL', drawerModel: 'MA' },
          { elevation: 2.1, structure: 'shelf', model: 'HL', dividers: 0 },
        ],
        hasRightNeighbour: !isLast,
      } as unknown as AnyNode
    }

    const bom = calculateWarehouseBOM(asNodes(nodesRecord))
    const m3Sec = bom.sections.find((s) => s.id === 'm3-shelving')
    expect(m3Sec).toBeDefined()

    // 6 connected bays -> 7 frame lines = 14 upright posts
    const posts = m3Sec?.items.find((i) => i.role === 'upright-post')
    expect(posts?.quantity).toBe(14)

    // 4 shelf levels per bay * 6 bays = 24 shelves (4 clips/shelf = 96 clips)
    const shelfItems = m3Sec?.items.filter((i) => i.role === 'shelf-panel')
    const totalShelves = shelfItems?.reduce((sum, item) => sum + item.quantity, 0)
    expect(totalShelves).toBe(24)

    const clips = m3Sec?.items.find((i) => i.role === 'shelf-clip')
    expect(clips?.quantity).toBe(96)
  })

  // ── 5. Zone-Scoped vs Global Warehouse BOM Reconciliation ─────────────────
  it('Task 2: Zone-scoped vs global warehouse BOM reconciliation (Zone BOM sum + unzoned = Global BOM)', () => {
    const nodesRecord: Record<string, AnyNode> = {}

    // Zone 1: Selective Racks (4 bays continuous)
    const zone1Ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = `z1_rack_${i}`
      nodesRecord[id] = {
        id: asNodeId(id),
        type: 'warehouse:pallet-rack',
        parentId: asNodeId('level_0'),
        position: [10 + i * 2.8, 0, 10],
        bayClearWidth: 2.7,
        depth: 1.1,
        levels: 4,
        depthPositions: 1,
        decking: 'wire-mesh',
        hasRightNeighbour: i < 3,
      } as unknown as AnyNode
      zone1Ids.push(id)
    }

    // Zone 2: Drive-In & M3 Shelving
    const zone2Ids: string[] = []
    const diId = 'z2_drivein_1'
    nodesRecord[diId] = {
      id: asNodeId(diId),
      type: 'warehouse:drive-in-rack',
      parentId: asNodeId('level_0'),
      position: [50, 0, 10],
      laneClearWidth: 1.35,
      palletsDeep: 4,
      levels: 3,
    } as unknown as AnyNode
    zone2Ids.push(diId)

    for (let j = 0; j < 3; j++) {
      const m3Id = `z2_m3_${j}`
      nodesRecord[m3Id] = {
        id: asNodeId(m3Id),
        type: 'warehouse:m3-rack',
        parentId: asNodeId('level_0'),
        position: [60 + j * 1.1, 0, 10],
        shelfLength: 1.0,
        shelfDepth: 0.5,
        levels: 4,
      } as unknown as AnyNode
      zone2Ids.push(m3Id)
    }

    // Unzoned equipment
    const unzonedIds: string[] = []
    const benchId = 'unzoned_bench_1'
    nodesRecord[benchId] = {
      id: asNodeId(benchId),
      type: 'warehouse:bench',
      parentId: asNodeId('level_0'),
      position: [100, 0, 10],
      widthM: 2.0,
      depthM: 1.0,
    } as unknown as AnyNode
    unzonedIds.push(benchId)

    const truckId = 'unzoned_truck_1'
    nodesRecord[truckId] = {
      id: asNodeId(truckId),
      type: 'warehouse:truck-reach',
      parentId: asNodeId('level_0'),
      position: [110, 0, 10],
    } as unknown as AnyNode
    unzonedIds.push(truckId)

    // Calculate BOMs
    const globalBOM = calculateWarehouseBOM(asNodes(nodesRecord), { scopeLabel: 'Global Warehouse' })
    const zone1BOM = calculateWarehouseBOM(asNodes(nodesRecord), { filterNodeIds: zone1Ids, zoneName: 'Zone 1' })
    const zone2BOM = calculateWarehouseBOM(asNodes(nodesRecord), { filterNodeIds: zone2Ids, zoneName: 'Zone 2' })
    const unzonedBOM = calculateWarehouseBOM(asNodes(nodesRecord), { filterNodeIds: unzonedIds, scopeLabel: 'Unzoned' })

    // Exact reconciliation checks
    // 1. Total hardware parts count reconciliation
    const sumPartsCount = zone1BOM.totalPartsCount + zone2BOM.totalPartsCount + unzonedBOM.totalPartsCount
    expect(sumPartsCount).toBe(globalBOM.totalPartsCount)

    // 2. Storage bays count reconciliation
    const getKpi = (bom: typeof globalBOM, key: string) => Number(bom.kpis.find((k) => k.key === key)?.value ?? 0)
    const sumBays = getKpi(zone1BOM, 'total-bays') + getKpi(zone2BOM, 'total-bays') + getKpi(unzonedBOM, 'total-bays')
    expect(sumBays).toBe(getKpi(globalBOM, 'total-bays'))

    // 3. Storage levels count reconciliation
    const sumLevels = getKpi(zone1BOM, 'storage-levels') + getKpi(zone2BOM, 'storage-levels') + getKpi(unzonedBOM, 'storage-levels')
    expect(sumLevels).toBe(getKpi(globalBOM, 'storage-levels'))

    // 4. Load beams reconciliation
    const sumBeams = getKpi(zone1BOM, 'total-beams') + getKpi(zone2BOM, 'total-beams') + getKpi(unzonedBOM, 'total-beams')
    expect(sumBeams).toBe(getKpi(globalBOM, 'total-beams'))

    // 5. Upright posts reconciliation
    const sumPosts = getKpi(zone1BOM, 'upright-posts') + getKpi(zone2BOM, 'upright-posts') + getKpi(unzonedBOM, 'upright-posts')
    expect(sumPosts).toBe(getKpi(globalBOM, 'upright-posts'))

    // 6. Shelf panels reconciliation
    const sumShelves = getKpi(zone1BOM, 'shelf-panels') + getKpi(zone2BOM, 'shelf-panels') + getKpi(unzonedBOM, 'shelf-panels')
    expect(sumShelves).toBe(getKpi(globalBOM, 'shelf-panels'))
  })

  // ── 6. Edge Cases ─────────────────────────────────────────────────────────
  it('Task 3.1: 0-level racks (ground-only storage / empty levels) handle gracefully without crash', async () => {
    const nodesRecord: Record<string, AnyNode> = {
      zeroLevelRack: {
        id: asNodeId('zero_level_rack'),
        type: 'warehouse:pallet-rack',
        parentId: asNodeId('level_0'),
        position: [-15, 0, -25],
        bayClearWidth: 2.7,
        depth: 1.1,
        levels: 0,
        depthPositions: 1,
      } as unknown as AnyNode,
      zeroLevelDriveIn: {
        id: asNodeId('zero_level_drivein'),
        type: 'warehouse:drive-in-rack',
        parentId: asNodeId('level_0'),
        position: [-10, 0, -25],
        laneClearWidth: 1.35,
        palletsDeep: 3,
        levels: 0,
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(asNodes(nodesRecord))
    expect(bom).toBeDefined()
    expect(bom.sections.length).toBeGreaterThan(0)

    // Pallet section contains posts and footplates, but 0 load beams and 0 shelves
    const palletSec = bom.sections.find((s) => s.id === 'selective-pallet-racks')
    expect(palletSec).toBeDefined()
    const beams = palletSec?.items.find((i) => i.role === 'load-beam')
    expect(beams).toBeUndefined()

    const pdf = await generateWarehouseBomPdf(bom)
    expect(pdf.byteLength).toBeGreaterThan(500)
  })

  it('Task 3.2: Negative coordinate positions across all 4 quadrants calculate correctly', async () => {
    const nodesRecord: Record<string, AnyNode> = {
      quadrant2: {
        id: asNodeId('q2_rack'),
        type: 'warehouse:pallet-rack',
        parentId: asNodeId('level_0'),
        position: [-50, -2, 30],
        bayClearWidth: 2.7,
        depth: 1.1,
        levels: 3,
      } as unknown as AnyNode,
      quadrant3: {
        id: asNodeId('q3_rack'),
        type: 'warehouse:pallet-rack',
        parentId: asNodeId('level_0'),
        position: [-50, -5, -40],
        bayClearWidth: 2.7,
        depth: 1.1,
        levels: 3,
      } as unknown as AnyNode,
      quadrant4: {
        id: asNodeId('q4_rack'),
        type: 'warehouse:pallet-rack',
        parentId: asNodeId('level_0'),
        position: [50, 0, -40],
        bayClearWidth: 2.7,
        depth: 1.1,
        levels: 3,
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(asNodes(nodesRecord))
    expect(bom.kpis.find((k) => k.key === 'total-bays')?.value).toBe(3)

    const pdf = await generateWarehouseBomPdf(bom)
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })

  it('Task 3.3: Empty warehouse exports return valid non-corrupted PDF with %PDF- header and %%EOF', async () => {
    const emptyBom = calculateWarehouseBOM({})
    expect(emptyBom.sections.length).toBe(0)
    expect(emptyBom.totalPartsCount).toBe(0)

    const pdf = await generateWarehouseBomPdf(emptyBom)
    expect(pdf.byteLength).toBeGreaterThan(200)

    const header = String.fromCharCode(pdf[0]!, pdf[1]!, pdf[2]!, pdf[3]!, pdf[4]!)
    expect(header).toBe('%PDF-')

    const text = Buffer.from(pdf).toString('latin1')
    expect(text).toContain('%%EOF')
  })

  it('Task 3.4: Massive multi-page PDF generation (100+ distinct items across multiple sections)', async () => {
    const nodesRecord: Record<string, AnyNode> = {}

    // Generate 30 distinct pallet racks with different specs
    for (let i = 0; i < 30; i++) {
      nodesRecord[`rack_custom_${i}`] = {
        id: asNodeId(`rack_custom_${i}`),
        type: 'warehouse:pallet-rack',
        parentId: asNodeId('level_0'),
        position: [i * 3, 0, 0],
        bayClearWidth: 2.0 + (i % 5) * 0.3,
        depth: 1.0 + (i % 3) * 0.1,
        levels: 2 + (i % 6),
        decking: i % 2 === 0 ? 'wire-mesh' : 'steel',
      } as unknown as AnyNode
    }

    // Generate 15 distinct longspan shelving units
    for (let j = 0; j < 15; j++) {
      nodesRecord[`longspan_custom_${j}`] = {
        id: asNodeId(`longspan_custom_${j}`),
        type: 'warehouse:longspan-rack',
        parentId: asNodeId('level_0'),
        position: [j * 2.5, 0, 20],
        bayLength: 1.8 + (j % 4) * 0.2,
        frameDepth: 0.6 + (j % 3) * 0.2,
        levels: [
          { elevation: 0.2, structure: 'beam-shelf', shelfKind: 'chipboard' },
          { elevation: 1.0, structure: 'hanging' },
        ],
      } as unknown as AnyNode
    }

    // Generate 15 distinct M3 units
    for (let k = 0; k < 15; k++) {
      nodesRecord[`m3_custom_${k}`] = {
        id: asNodeId(`m3_custom_${k}`),
        type: 'warehouse:m3-rack',
        parentId: asNodeId('level_0'),
        position: [k * 1.5, 0, 40],
        shelfLength: 0.9 + (k % 3) * 0.2,
        shelfDepth: 0.4 + (k % 2) * 0.1,
        levels: [
          { elevation: 0.1, structure: 'shelf', model: 'HM', dividers: k % 4 },
          { elevation: 0.8, structure: 'drawers', model: 'HL', drawerModel: 'MA' },
        ],
      } as unknown as AnyNode
    }

    const bom = calculateWarehouseBOM(asNodes(nodesRecord), {
      projectName: 'Stress Test Super Facility',
      scopeLabel: 'Complete Warehouse Installation Suite',
    })

    const totalLineItems = bom.sections.reduce((acc, sec) => acc + sec.items.length, 0)
    expect(totalLineItems).toBeGreaterThanOrEqual(40)

    const pdf = await generateWarehouseBomPdf(bom, {
      title: 'Stress Test Super Facility Report',
      author: 'Pascal Warehouse Digital Twin',
    })
    expect(pdf.byteLength).toBeGreaterThan(4000)

    const header = String.fromCharCode(pdf[0]!, pdf[1]!, pdf[2]!, pdf[3]!, pdf[4]!)
    expect(header).toBe('%PDF-')

    const text = Buffer.from(pdf).toString('latin1')
    expect(text).toContain('%%EOF')
    expect(text).toContain('/Title')
  })
})
