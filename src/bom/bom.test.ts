import { describe, expect, it } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { calculateWarehouseBOM } from './bom-engine'
import { generateWarehouseBomHtml, sanitizeSvg } from './bom-html'
import { generateWarehouseBomPdf } from './bom-pdf'
import { generateWarehouseBomSheets } from './bom-sheets'
import type { BomSheet } from './types'

describe('Warehouse BOM Calculation Engine', () => {
  it('calculates exact hardware tallies for a single-deep selective pallet rack', () => {
    const nodes: Record<string, AnyNode> = {
      rack1: {
        id: 'rack1',
        type: 'warehouse:pallet-rack',
        parentId: 'level1',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        bayClearWidth: 2.7,
        depth: 1.1,
        uprightHeight: 7.0,
        uprightWidth: 0.09,
        uprightDepth: 0.08,
        beamThickness: 0.05,
        beamHeight: 0.12,
        firstLevelClear: 1.2,
        levelClear: 1.2,
        levels: 4,
        hasGroundBeam: false,
        tunnelLevels: 0,
        depthPositions: 1,
        decking: 'wire-mesh',
        bracing: 'z-bracing',
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(nodes, { projectName: 'Test Logistics Hub' })

    expect(bom.projectName).toBe('Test Logistics Hub')
    expect(bom.sections.length).toBeGreaterThan(0)

    const palletSection = bom.sections.find((s) => s.id === 'selective-pallet-racks')
    expect(palletSection).toBeDefined()

    // 1 standalone bay -> 2 frames -> 4 posts (2 posts * 2 frames * 1 depthPos)
    const postsItem = palletSection?.items.find((i) => i.role === 'upright-post')
    expect(postsItem).toBeDefined()
    expect(postsItem?.quantity).toBe(4)

    // Footplates -> 4
    const footplatesItem = palletSection?.items.find((i) => i.role === 'footplate')
    expect(footplatesItem).toBeDefined()
    expect(footplatesItem?.quantity).toBe(4)

    // 4 beam levels -> 8 load beams (2 beams * 4 levels * 1 depthPos)
    const beamsItem = palletSection?.items.find((i) => i.role === 'load-beam')
    expect(beamsItem).toBeDefined()
    expect(beamsItem?.quantity).toBe(8)

    // Shelves -> 4 wire-mesh shelves
    const shelvesItem = palletSection?.items.find((i) => i.role === 'shelf-panel')
    expect(shelvesItem).toBeDefined()
    expect(shelvesItem?.quantity).toBe(4)

    // Fasteners section: anchors (2 * 4 = 8) & safety pins (2 * 8 = 16)
    const fastenersSection = bom.sections.find((s) => s.id === 'fasteners-accessories')
    expect(fastenersSection).toBeDefined()

    const anchors = fastenersSection?.items.find((i) => i.role === 'anchor-bolt')
    expect(anchors?.quantity).toBe(8)

    const pins = fastenersSection?.items.find((i) => i.role === 'safety-pin')
    expect(pins?.quantity).toBe(16)
  })

  it('calculates double-deep pallet rack with doubled posts, beams, shelves, and row spacers', () => {
    const nodes: Record<string, AnyNode> = {
      ddRack: {
        id: 'ddRack',
        type: 'warehouse:pallet-rack',
        parentId: 'level1',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        bayClearWidth: 2.7,
        depth: 1.1,
        uprightHeight: 8.0,
        uprightWidth: 0.09,
        uprightDepth: 0.08,
        beamThickness: 0.05,
        beamHeight: 0.12,
        firstLevelClear: 1.2,
        levelClear: 1.2,
        levels: 5,
        hasGroundBeam: false,
        tunnelLevels: 0,
        depthPositions: 2, // Double deep
        depthGap: 0.25,
        decking: 'steel',
        bracing: 'x-bracing',
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(nodes)
    const palletSection = bom.sections.find((s) => s.id === 'selective-pallet-racks')
    expect(palletSection).toBeDefined()

    // 2 frames * 2 posts * 2 depthPositions = 8 posts
    const postsItem = palletSection?.items.find((i) => i.role === 'upright-post')
    expect(postsItem?.quantity).toBe(8)

    // 5 levels * 2 beams * 2 depthPositions = 20 beams
    const beamsItem = palletSection?.items.find((i) => i.role === 'load-beam')
    expect(beamsItem?.quantity).toBe(20)

    // 5 levels * 1 shelf * 2 depthPositions = 10 shelves
    const shelvesItem = palletSection?.items.find((i) => i.role === 'shelf-panel')
    expect(shelvesItem?.quantity).toBe(10)

    // Fasteners: 8 * 2 = 16 anchors, 20 * 2 = 40 pins, row spacers = 2 * 2 frames = 4 spacers
    const fastenersSection = bom.sections.find((s) => s.id === 'fasteners-accessories')
    const anchors = fastenersSection?.items.find((i) => i.role === 'anchor-bolt')
    expect(anchors?.quantity).toBe(16)

    const pins = fastenersSection?.items.find((i) => i.role === 'safety-pin')
    expect(pins?.quantity).toBe(40)

    const spacers = fastenersSection?.items.find((i) => i.role === 'row-spacer')
    expect(spacers?.quantity).toBe(4)
  })

  it('shares upright frames correctly across continuous runs of N adjacent bays (N+1 frames)', () => {
    // 3 connected bays in a continuous run along X (bayPitch = 2.7 + 0.09 = 2.79)
    const pitch = 2.79
    const nodes: Record<string, AnyNode> = {
      bay1: {
        id: 'bay1',
        type: 'warehouse:pallet-rack',
        parentId: 'level1',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        bayClearWidth: 2.7,
        depth: 1.1,
        uprightHeight: 5.0,
        uprightWidth: 0.09,
        uprightDepth: 0.08,
        beamThickness: 0.05,
        beamHeight: 0.12,
        firstLevelClear: 1.2,
        levelClear: 1.2,
        levels: 3,
        hasGroundBeam: false,
        tunnelLevels: 0,
        depthPositions: 1,
        decking: 'timber',
        bracing: 'z-bracing',
      } as unknown as AnyNode,
      bay2: {
        id: 'bay2',
        type: 'warehouse:pallet-rack',
        parentId: 'level1',
        position: [pitch, 0, 0],
        rotation: [0, 0, 0],
        bayClearWidth: 2.7,
        depth: 1.1,
        uprightHeight: 5.0,
        uprightWidth: 0.09,
        uprightDepth: 0.08,
        beamThickness: 0.05,
        beamHeight: 0.12,
        firstLevelClear: 1.2,
        levelClear: 1.2,
        levels: 3,
        hasGroundBeam: false,
        tunnelLevels: 0,
        depthPositions: 1,
        decking: 'timber',
        bracing: 'z-bracing',
      } as unknown as AnyNode,
      bay3: {
        id: 'bay3',
        type: 'warehouse:pallet-rack',
        parentId: 'level1',
        position: [pitch * 2, 0, 0],
        rotation: [0, 0, 0],
        bayClearWidth: 2.7,
        depth: 1.1,
        uprightHeight: 5.0,
        uprightWidth: 0.09,
        uprightDepth: 0.08,
        beamThickness: 0.05,
        beamHeight: 0.12,
        firstLevelClear: 1.2,
        levelClear: 1.2,
        levels: 3,
        hasGroundBeam: false,
        tunnelLevels: 0,
        depthPositions: 1,
        decking: 'timber',
        bracing: 'z-bracing',
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(nodes)
    const palletSection = bom.sections.find((s) => s.id === 'selective-pallet-racks')

    // 3 bays in a continuous run share 2 intermediate frames:
    // Bay1 builds left (1 frame), Bay2 builds left (1 frame), Bay3 builds left + right (2 frames)
    // Total frames = 1 + 1 + 2 = 4 frames = N + 1 frames.
    // Total posts = 4 frames * 2 posts = 8 posts (instead of 3 * 4 = 12 if unshared).
    const postsItem = palletSection?.items.find((i) => i.role === 'upright-post')
    expect(postsItem?.quantity).toBe(8)

    // Beams are NOT shared: 3 bays * (3 levels * 2 beams) = 18 beams
    const beamsItem = palletSection?.items.find((i) => i.role === 'load-beam')
    expect(beamsItem?.quantity).toBe(18)
  })

  it('calculates drive-in rack continuous rails, brackets, portal beams, and guide angles', () => {
    const nodes: Record<string, AnyNode> = {
      driveInLane: {
        id: 'driveInLane',
        type: 'warehouse:drive-in-rack',
        parentId: 'level1',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        laneClearWidth: 1.35,
        uprightWidth: 0.09,
        uprightDepth: 0.08,
        uprightHeight: 6.0,
        palletsDeep: 4,
        levels: 3,
        railType: 'gp',
        guideRails: true,
        centralisers: true,
        uprightReinforcer: true,
        constructiveSystem: 'cs2',
        entryMode: 'drive-in',
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(nodes)
    const driveInSection = bom.sections.find((s) => s.id === 'drive-in-racks')
    expect(driveInSection).toBeDefined()

    // 3 levels -> 6 continuous pallet support rails
    const rails = driveInSection?.items.find((i) => i.role === 'pallet-rail')
    expect(rails).toBeDefined()
    expect(rails?.quantity).toBe(6)

    // Cantilever support brackets
    const brackets = driveInSection?.items.find((i) => i.role === 'rail-bracket')
    expect(brackets).toBeDefined()
    expect(brackets?.quantity).toBeGreaterThan(0)

    // Top portal tie beams
    const topBeams = driveInSection?.items.find((i) => i.role === 'load-beam')
    expect(topBeams).toBeDefined()
    expect(topBeams?.quantity).toBeGreaterThan(0)

    // Floor guide channels
    const guides = driveInSection?.items.find((i) => i.role === 'guide-rail')
    expect(guides).toBeDefined()
    expect(guides?.quantity).toBe(2)
  })

  it('calculates live dynamic racking (pallet flow) channels, rollers, brakes, and retainers', () => {
    const nodes: Record<string, AnyNode> = {
      liveLane: {
        id: 'liveLane',
        type: 'warehouse:live-rack',
        parentId: 'level1',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        palletWidthM: 0.8,
        palletLengthM: 1.2,
        palletsDeep: 5,
        levels: 3,
        gradient: 0.04,
        rollerPitch: 0.075,
        variant: 'FIFO',
        withRetainers: true,
        hingedChannels: false,
        splitRollers: false,
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(nodes)
    const liveSection = bom.sections.find((s) => s.id === 'live-racking')
    expect(liveSection).toBeDefined()

    // Dynamic entry/exit beams -> 2 * 3 = 6 beams
    const beams = liveSection?.items.find((i) => i.role === 'load-beam')
    expect(beams?.quantity).toBe(6)

    // Gravity roller channel tracks -> 3 channels (1 per level)
    const tracks = liveSection?.items.find((i) => i.role === 'roller-track')
    expect(tracks?.quantity).toBe(3)

    // Gravity flow rollers
    const rollers = liveSection?.items.find((i) => i.role === 'flow-roller')
    expect(rollers).toBeDefined()
    expect(rollers?.quantity).toBeGreaterThan(100)

    // Centrifugal speed brake rollers (palletsDeep = 5 > 2)
    const brakes = liveSection?.items.find((i) => i.role === 'brake-roller')
    expect(brakes).toBeDefined()
    expect(brakes?.quantity).toBeGreaterThan(0)

    // Automatic pallet separators / retainers
    const retainers = liveSection?.items.find((i) => i.role === 'pallet-separator')
    expect(retainers).toBeDefined()
    expect(retainers?.quantity).toBeGreaterThan(0)
  })

  it('calculates longspan M7 shelving step beams, safety pins, and panels', () => {
    const nodes: Record<string, AnyNode> = {
      longspanBay: {
        id: 'longspanBay',
        type: 'warehouse:longspan-rack',
        parentId: 'level1',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        bayLength: 2.1,
        frameDepth: 0.8,
        frameHeight: 2.5,
        uprightProfile: 'M-7515',
        beamProfile: 'ZE-65',
        levels: [
          { elevation: 0.2, structure: 'beam-shelf', shelfKind: 'chipboard' },
          { elevation: 1.0, structure: 'beam-shelf', shelfKind: 'chipboard' },
          { elevation: 1.8, structure: 'hanging' },
        ],
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(nodes)
    const longspanSection = bom.sections.find((s) => s.id === 'longspan-shelving')
    expect(longspanSection).toBeDefined()

    // 4 posts for standalone frame
    const posts = longspanSection?.items.find((i) => i.role === 'upright-post')
    expect(posts?.quantity).toBe(4)

    // 3 levels * 2 step beams = 6 step beams
    const beams = longspanSection?.items.find((i) => i.role === 'load-beam')
    expect(beams?.quantity).toBe(6)

    // 2 shelf levels = 2 chipboard shelf panels
    const shelves = longspanSection?.items.find((i) => i.role === 'shelf-panel')
    expect(shelves?.quantity).toBe(2)

    // 1 garment hanging rail
    const hangRail = longspanSection?.items.find(
      (i) => i.role === 'equipment' && i.item.includes('Hanging Rail'),
    )
    expect(hangRail?.quantity).toBe(1)
  })

  it('calculates M3 picking shelving uprights, shelves, support clips, and drawers', () => {
    const nodes: Record<string, AnyNode> = {
      m3Bay: {
        id: 'm3Bay',
        type: 'warehouse:m3-rack',
        parentId: 'level1',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        shelfLength: 1.0,
        shelfDepth: 0.4,
        frameHeight: 2.0,
        frameVariant: 'basic',
        levels: [
          { elevation: 0.1, structure: 'shelf', model: 'HM', dividers: 3 },
          { elevation: 0.6, structure: 'shelf', model: 'HL', dividers: 0 },
          { elevation: 1.1, structure: 'drawers', model: 'HL', drawerModel: 'MA' },
        ],
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(nodes)
    const m3Section = bom.sections.find((s) => s.id === 'm3-shelving')
    expect(m3Section).toBeDefined()

    // 4 posts
    const posts = m3Section?.items.find((i) => i.role === 'upright-post')
    expect(posts?.quantity).toBe(4)

    // 2 steel shelves (1 HM + 1 HL)
    const shelfItems = m3Section?.items.filter((i) => i.role === 'shelf-panel')
    const totalShelves = shelfItems?.reduce((sum, i) => sum + i.quantity, 0)
    expect(totalShelves).toBe(2)

    // 3 vertical dividers
    const dividers = m3Section?.items.find((i) => i.item.includes('Divider'))
    expect(dividers?.quantity).toBe(3)

    // Drawers cassette
    const drawers = m3Section?.items.find((i) => i.item.includes('Drawer'))
    expect(drawers).toBeDefined()
    expect(drawers?.quantity).toBeGreaterThan(0)
  })

  it('calculates mezzanine platform columns, girders, purlins, deck area, handrails, and gates', () => {
    const nodes: Record<string, AnyNode> = {
      mezz: {
        id: 'mezz1',
        type: 'warehouse:mezzanine',
        parentId: 'level1',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        grid: {
          baysX: 2,
          baysY: 2,
          bayWidthM: 6.0,
          bayDepthM: 4.0,
        },
        floorType: 'chipboard',
        tiers: [
          {
            index: 0,
            elevationM: 'auto',
            clearHeightM: 3.0,
            loadClass: 500,
            floorType: 'WOOD_CHIPBOARD_30',
          },
        ],
        staircase: { enabled: true, width: 1.0 },
        palletGate: { enabled: true, type: 'pivot', width: 1.6 },
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(nodes)
    const mezzSection = bom.sections.find((s) => s.id === 'mezzanine-structures')
    expect(mezzSection).toBeDefined()

    // Structural columns
    const cols = mezzSection?.items.find((i) => i.role === 'column')
    expect(cols).toBeDefined()
    expect(cols?.quantity).toBeGreaterThanOrEqual(4)

    // Floor deck area: (2*6) * (2*4) = 12 * 8 = 96 m2
    const deck = mezzSection?.items.find((i) => i.role === 'deck-floor')
    expect(deck).toBeDefined()
    expect(deck?.quantity).toBe(96)
    expect(deck?.unit).toBe('m²')

    // Perimeter handrail
    const handrail = mezzSection?.items.find(
      (i) => i.role === 'handrail' && i.item.includes('Handrail'),
    )
    expect(handrail).toBeDefined()
    expect(handrail?.quantity).toBeGreaterThanOrEqual(40) // 2 * (12 + 8) = 40m

    // Staircase & Gate
    const stairs = mezzSection?.items.find((i) => i.role === 'staircase')
    expect(stairs?.quantity).toBe(1)

    const gate = mezzSection?.items.find((i) => i.item.includes('Gate'))
    expect(gate?.quantity).toBe(1)
  })

  it('calculates conveyors, workbenches, dock levellers, pallet lifts, and handling fleet', () => {
    const nodes: Record<string, AnyNode> = {
      conveyor1: {
        id: 'conv1',
        type: 'warehouse:conveyor-roller',
        parentId: 'level1',
        position: [0, 0, 0],
        frameWidth: 0.8,
        lengthM: 6.0,
        driven: true,
      } as unknown as AnyNode,
      bench1: {
        id: 'bench1',
        type: 'warehouse:bench',
        parentId: 'level1',
        position: [10, 0, 0],
        widthM: 1.8,
        depthM: 0.9,
      } as unknown as AnyNode,
      dock1: {
        id: 'dock1',
        type: 'warehouse:dock-leveller',
        parentId: 'level1',
        position: [20, 0, 0],
        platformLengthM: 2.5,
        widthM: 2.0,
      } as unknown as AnyNode,
      lift1: {
        id: 'lift1',
        type: 'warehouse:pallet-lift',
        parentId: 'level1',
        position: [30, 0, 0],
      } as unknown as AnyNode,
      truck1: {
        id: 'truck1',
        type: 'warehouse:truck',
        parentId: 'level1',
        position: [40, 0, 0],
        model: 'rt-1800',
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(nodes)

    const convSec = bom.sections.find((s) => s.id === 'conveyors')
    expect(convSec?.items.some((i) => i.item.includes('Roller Conveyor'))).toBe(true)

    const facSec = bom.sections.find((s) => s.id === 'facilities')
    expect(facSec?.items.some((i) => i.item.includes('Workbench'))).toBe(true)
    expect(facSec?.items.some((i) => i.item.includes('Dock Leveller'))).toBe(true)
    expect(facSec?.items.some((i) => i.item.includes('Pallet Lift'))).toBe(true)

    const handSec = bom.sections.find((s) => s.id === 'handling-fleet')
    expect(handSec?.items.some((i) => i.item.includes('Industrial Truck'))).toBe(true)
  })

  it('respects filterNodeIds and zoneName filtering options', () => {
    const nodes: Record<string, AnyNode> = {
      rackInZone: {
        id: 'rackInZone',
        type: 'warehouse:pallet-rack',
        parentId: 'level1',
        position: [0, 0, 0],
        bayClearWidth: 2.7,
        depth: 1.1,
        uprightHeight: 5.0,
        uprightWidth: 0.09,
        uprightDepth: 0.08,
        beamThickness: 0.05,
        beamHeight: 0.12,
        levels: 3,
        hasGroundBeam: false,
        tunnelLevels: 0,
        depthPositions: 1,
        decking: 'steel',
        bracing: 'z-bracing',
      } as unknown as AnyNode,
      rackOutsideZone: {
        id: 'rackOutsideZone',
        type: 'warehouse:pallet-rack',
        parentId: 'level1',
        position: [50, 0, 50],
        bayClearWidth: 2.7,
        depth: 1.1,
        uprightHeight: 5.0,
        uprightWidth: 0.09,
        uprightDepth: 0.08,
        beamThickness: 0.05,
        beamHeight: 0.12,
        levels: 3,
        hasGroundBeam: false,
        tunnelLevels: 0,
        depthPositions: 1,
        decking: 'steel',
        bracing: 'z-bracing',
      } as unknown as AnyNode,
    }

    const zoneBom = calculateWarehouseBOM(nodes, {
      filterNodeIds: ['rackInZone'],
      zoneName: 'Zone A - High Bay',
      scopeLabel: 'Zone: Zone A - High Bay',
    })

    expect(zoneBom.zoneName).toBe('Zone A - High Bay')
    expect(zoneBom.scopeLabel).toBe('Zone: Zone A - High Bay')

    const kpiBays = zoneBom.kpis.find((k) => k.key === 'total-bays')
    expect(kpiBays?.value).toBe(1) // Only 1 bay tallied
  })
})

describe('Warehouse BOM Document & PDF Generation', () => {
  it('generates a valid binary PDF buffer starting with %PDF- header and containing key text', async () => {
    const nodes: Record<string, AnyNode> = {
      rack1: {
        id: 'rack1',
        type: 'warehouse:pallet-rack',
        parentId: 'level1',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        bayClearWidth: 2.7,
        depth: 1.1,
        uprightHeight: 5.0,
        uprightWidth: 0.09,
        uprightDepth: 0.08,
        beamThickness: 0.05,
        beamHeight: 0.12,
        levels: 4,
        hasGroundBeam: false,
        tunnelLevels: 0,
        depthPositions: 1,
        decking: 'wire-mesh',
        bracing: 'z-bracing',
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(nodes, {
      projectName: 'Main Logistics Distribution Centre',
      scopeLabel: 'Global Warehouse Installation',
    })

    const pdfBuffer = await generateWarehouseBomPdf(bom, {
      title: 'BOM Report — Main Logistics DC',
      author: 'Pascal Warehouse Digital Twin',
      companyName: 'ACME LOGISTICS SOLUTIONS',
    })

    expect(pdfBuffer).toBeDefined()
    expect(pdfBuffer.byteLength).toBeGreaterThan(1000)

    // Check %PDF- header (0x25, 0x50, 0x44, 0x46, 0x2D)
    const headerStr = Buffer.from(pdfBuffer.subarray(0, 5)).toString('utf-8')
    expect(headerStr).toBe('%PDF-')

    // Check for metadata text strings in the PDF document
    const latinContent = Buffer.from(pdfBuffer).toString('latin1')
    expect(latinContent).toContain('BOM Report')
    expect(latinContent).toContain('Pascal Warehouse Digital Twin')
  })

  it('generates multi-sheet vector SVG plan set with title blocks and SHEET n/N stamps', () => {
    const nodes: Record<string, AnyNode> = {
      rack1: {
        id: 'rack1',
        type: 'warehouse:pallet-rack',
        parentId: 'level1',
        position: [0, 0, 0],
        bayClearWidth: 2.7,
        depth: 1.1,
        uprightHeight: 5.0,
        uprightWidth: 0.09,
        uprightDepth: 0.08,
        beamThickness: 0.05,
        beamHeight: 0.12,
        levels: 4,
        hasGroundBeam: false,
        tunnelLevels: 0,
        depthPositions: 1,
        decking: 'wire-mesh',
        bracing: 'z-bracing',
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(nodes)
    const sheets = generateWarehouseBomSheets(bom, { title: 'Apollo Facility' })

    expect(sheets.length).toBeGreaterThanOrEqual(2)
    expect(sheets[0]?.title).toContain('Cover')
    expect(sheets[0]?.svg).toContain('<svg')
    expect(sheets[0]?.svg).toContain('SHEET 1/')
    expect(sheets[0]?.svg).toContain('Apollo Facility')
    expect(sheets[1]?.svg).toContain('SHEET 2/')
  })

  it('generates self-contained printable HTML document with @page landscape rules', () => {
    const nodes: Record<string, AnyNode> = {
      rack1: {
        id: 'rack1',
        type: 'warehouse:pallet-rack',
        parentId: 'level1',
        position: [0, 0, 0],
        bayClearWidth: 2.7,
        depth: 1.1,
        uprightHeight: 5.0,
        uprightWidth: 0.09,
        uprightDepth: 0.08,
        beamThickness: 0.05,
        beamHeight: 0.12,
        levels: 4,
        hasGroundBeam: false,
        tunnelLevels: 0,
        depthPositions: 1,
        decking: 'wire-mesh',
        bracing: 'z-bracing',
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(nodes)
    const sheets = generateWarehouseBomSheets(bom)
    const html = generateWarehouseBomHtml(sheets, { title: 'Printable Warehouse BOM' })

    expect(html).toContain('<!doctype html>')
    expect(html).toContain('@page {')
    expect(html).toContain('size: letter landscape;')
    expect(html).toContain('<section class="sheet">')
    expect(html).toContain('Printable Warehouse BOM')
  })
})

describe('Warehouse BOM HTML SVG Sanitization in Headless / SSR Environments', () => {
  it('strips <script> tags and inline event handlers in headless environments', () => {
    const maliciousSheet: BomSheet = {
      title: 'Malicious Sheet',
      svg: '<svg onload="alert(1)"><script>alert("xss")</script><text>Safe</text></svg>',
    }
    const html = generateWarehouseBomHtml([maliciousSheet])
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(')
    expect(html).not.toContain('onload=')
    expect(html).toContain('<text>Safe</text>')
  })

  it('strips <foreignObject>, <iframe src="javascript:..."> and javascript URIs', () => {
    const maliciousSheet: BomSheet = {
      title: 'ForeignObject XSS',
      svg: '<svg><foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject><a href="javascript:alert(2)"><rect width="10" height="10"/></a></svg>',
    }
    const html = generateWarehouseBomHtml([maliciousSheet])
    expect(html).not.toContain('<foreignObject')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('alert(2)')
    expect(html).toContain('<rect')
  })

  it('strips onerror and SMIL animate injection attributes in headless test runs', () => {
    const maliciousSheet: BomSheet = {
      title: 'SMIL & OnError Injection',
      svg: '<svg><image href="invalid.png" onerror="alert(3)"/><animate onbegin="alert(4)"/><set attributeName="onmouseover" to="alert(5)"/></svg>',
    }
    const html = generateWarehouseBomHtml([maliciousSheet])
    expect(html).not.toContain('onerror=')
    expect(html).not.toContain('onbegin=')
    expect(html).not.toContain('onmouseover')
    expect(html).not.toContain('alert(')
  })

  it('strips CDATA wrapped script payloads and XML entity injections', () => {
    const maliciousSheet: BomSheet = {
      title: 'CDATA & XML Injection',
      svg: '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg><script><![CDATA[alert(6)]]></script><text>&xxe;</text></svg>',
    }
    const html = generateWarehouseBomHtml([maliciousSheet])
    expect(html).not.toContain('<!DOCTYPE')
    expect(html).not.toContain('<!ENTITY')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(6)')
  })

  it('direct sanitizeSvg helper safely strips vectors and retains valid geometries', () => {
    const raw =
      '<svg onload=alert(9)><circle cx="5" cy="5" r="5"/><script>alert("bad")</script></svg>'
    const sanitized = sanitizeSvg(raw)
    expect(sanitized).not.toContain('onload')
    expect(sanitized).not.toContain('<script')
    expect(sanitized).not.toContain('alert(')
    expect(sanitized).toContain('<circle cx="5" cy="5" r="5"/>')
  })
})
