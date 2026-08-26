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
    id: asNodeId('zone_test_1'),
    type: 'zone',
    name: 'Storage Zone A',
    spaceRole: 'generic',
    roomNumber: 'Z-101',
    enclosureStatus: 'open',
    occupancy: 'Storage',
    floorFinish: 'Sealed Concrete',
    wallFinish: 'None',
    ceilingFinish: 'None',
    ceilingHeight: 8.0,
    clearDimensionPolicy: 'inside-faces',
    polygon: [
      [0, 0],
      [50, 0],
      [50, 50],
      [0, 50],
    ],
    autoFromWalls: false,
    boundaryWallIds: [],
    ...partial,
  } as ZoneNode
}

describe('Warehouse Zone Takeoff Engine', () => {
  it('returns null for empty contentIds or non-warehouse nodes', () => {
    const zone = makeZone()
    const emptyResult = calculateWarehouseZoneTakeoff({
      zone,
      contentIds: [],
      nodes: {},
    })
    expect(emptyResult).toBeNull()

    const nodes = asNodes({
      wall_1: { id: 'wall_1', type: 'wall' } as unknown as AnyNode,
      slab_1: { id: 'slab_1', type: 'slab' } as unknown as AnyNode,
    })
    const nonWarehouseResult = calculateWarehouseZoneTakeoff({
      zone,
      contentIds: asContentIds(['wall_1', 'slab_1']),
      nodes,
    })
    expect(nonWarehouseResult).toBeNull()
  })

  it('correctly calculates selective pallet rack metrics, double-deep access, and picking slots', () => {
    const zone = makeZone()
    // Standard single-deep rack (4 beam levels + ground = 5 levels, 3 pallets/level = 15 positions, all direct access)
    const rack1: AnyNode = {
      id: asNodeId('rack_1'),
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

    // Double-deep rack with 2 picking levels at ground/lower level
    const rack2WithPicking: AnyNode = {
      id: asNodeId('rack_2'),
      type: 'warehouse:pallet-rack',
      bayClearWidth: 2.7,
      depth: 1.1,
      uprightHeight: 8.0,
      depthPositions: 2, // double deep
      levels: 4,
      groundLevelStorage: true,
      pickingLevels: 2, // bottom 2 levels are picking
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

    const nodes = asNodes({ rack_1: rack1, rack_2: rack2WithPicking })
    const report = calculateWarehouseZoneTakeoff({
      zone,
      contentIds: asContentIds(['rack_1', 'rack_2']),
      nodes,
    })

    expect(report).not.toBeNull()
    expect(report?.title).toBe('Warehouse storage takeoff')
    expect(report?.metrics).toBeDefined()
    expect(report?.metrics.length).toBe(4)

    const baysMetric = report?.metrics.find((m) => m.key === 'total-bays')
    expect(baysMetric?.value).toBe(2)

    const levelsMetric = report?.metrics.find((m) => m.key === 'total-levels')
    expect(Number(levelsMetric?.value)).toBeGreaterThan(0)

    const palletMetric = report?.metrics.find((m) => m.key === 'pallet-capacity')
    expect(Number(palletMetric?.value)).toBeGreaterThan(0)

    const pickMetric = report?.metrics.find((m) => m.key === 'picking-capacity')
    expect(Number(pickMetric?.value)).toBeGreaterThan(0)

    const breakdown = report?.breakdown?.find((b) => b.id === 'selective-pallet-rack')
    expect(breakdown).toBeDefined()
    expect(breakdown?.count).toBe(2)
    expect(breakdown?.submetrics?.find((s) => s.label === 'Direct Access')).toBeDefined()
    expect(breakdown?.submetrics?.find((s) => s.label === 'Picking Slots')).toBeDefined()
  })

  it('correctly calculates high-density drive-in and live racking capacities', () => {
    const zone = makeZone()
    const driveInLane: AnyNode = {
      id: asNodeId('drivein_1'),
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

    const liveRack: AnyNode = {
      id: asNodeId('liverack_1'),
      type: 'warehouse:live-rack',
      palletsDeep: 8,
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
      skus: ['SKU-1001', 'SKU-1002'],
    } as unknown as AnyNode

    const nodes = asNodes({ drivein_1: driveInLane, liverack_1: liveRack })
    const report = calculateWarehouseZoneTakeoff({
      zone,
      contentIds: asContentIds(['drivein_1', 'liverack_1']),
      nodes,
    })

    expect(report).not.toBeNull()
    const baysMetric = report?.metrics.find((m) => m.key === 'total-bays')
    expect(baysMetric?.value).toBe(2) // 1 drive-in lane + 1 live rack channel

    const driveInBreakdown = report?.breakdown?.find((b) => b.id === 'drive-in-rack')
    expect(driveInBreakdown).toBeDefined()
    expect(driveInBreakdown?.count).toBe(1)
    // 4 levels (floor + 3 fitted rails) * 5 deep = 20 pallet positions
    expect(driveInBreakdown?.details).toContain('20 pallet positions')

    const liveBreakdown = report?.breakdown?.find((b) => b.id === 'live-rack')
    expect(liveBreakdown).toBeDefined()
    expect(liveBreakdown?.count).toBe(1)
    // 4 levels * 8 deep = 32 pallet positions
    expect(liveBreakdown?.details).toContain('32 pallet positions')
    expect(liveBreakdown?.submetrics?.find((s) => s.label === 'Direct Access')?.value).toBe(4)
  })

  it('correctly calculates Longspan M7 and M3 shelving metrics', () => {
    const zone = makeZone()
    const longspan: AnyNode = {
      id: asNodeId('longspan_1'),
      type: 'warehouse:longspan-rack',
      bayLength: 1.8,
      frameDepth: 0.8,
      frameHeight: 2.5,
      uprightProfile: 'M-7515',
      beamProfile: 'ZE-55',
      crossBracing: false,
      levels: [
        {
          elevation: 0.2,
          structure: 'beam-shelf',
          shelfKind: 'chipboard',
          panels: 1,
        },
        {
          elevation: 1.0,
          structure: 'beam-shelf',
          shelfKind: 'chipboard',
          panels: 1,
        },
        {
          elevation: 1.8,
          structure: 'hanging',
          shelfKind: 'chipboard',
          panels: 1,
        },
      ],
    } as unknown as AnyNode

    const m3: AnyNode = {
      id: asNodeId('m3_1'),
      type: 'warehouse:m3-rack',
      shelfLength: 1.0,
      shelfDepth: 0.4,
      frameHeight: 2.0,
      frameVariant: 'basic',
      backPanel: 'none',
      door: 'none',
      uprightColor: '#637d96',
      componentColor: '#c5c7c4',
      supportSlabId: null,
      levels: [
        {
          elevation: 0.3,
          structure: 'shelf',
          model: 'HL',
          dividers: 0,
          drawerModel: 'MA',
          drawerWidth: 'wide',
        },
        {
          elevation: 0.8,
          structure: 'drawers',
          model: 'HL',
          dividers: 0,
          drawerModel: 'MA',
          drawerWidth: 'wide',
        },
        {
          elevation: 1.3,
          structure: 'shelf',
          model: 'HL',
          dividers: 0,
          drawerModel: 'MA',
          drawerWidth: 'wide',
        },
      ],
    } as unknown as AnyNode

    const nodes = asNodes({ longspan_1: longspan, m3_1: m3 })
    const report = calculateWarehouseZoneTakeoff({
      zone,
      contentIds: asContentIds(['longspan_1', 'm3_1']),
      nodes,
    })

    expect(report).not.toBeNull()
    const baysMetric = report?.metrics.find((m) => m.key === 'total-bays')
    expect(baysMetric?.value).toBe(2)

    const longspanBreakdown = report?.breakdown?.find((b) => b.id === 'longspan-shelving')
    expect(longspanBreakdown).toBeDefined()
    expect(longspanBreakdown?.count).toBe(1)
    expect(longspanBreakdown?.details).toContain('3 shelf levels')
    expect(longspanBreakdown?.submetrics?.find((s) => s.label === 'Hanging Rail')?.value).toBe('1.8 m')

    const m3Breakdown = report?.breakdown?.find((b) => b.id === 'm3-shelving')
    expect(m3Breakdown).toBeDefined()
    expect(m3Breakdown?.count).toBe(1)
    expect(m3Breakdown?.details).toContain('3 shelf levels')
    expect(m3Breakdown?.submetrics?.find((s) => s.label === 'Drawers')?.value).toBe(4)
    expect(m3Breakdown?.submetrics?.find((s) => s.label === 'Rated Load')?.value).toBe('450 kg')
  })

  it('correctly calculates mezzanine deck area and tiers', () => {
    const zone = makeZone()
    const mezzanine: AnyNode = {
      id: asNodeId('mezz_1'),
      type: 'warehouse:mezzanine',
      constructiveSystem: 'SIGMA',
      grid: {
        baysX: 2,
        baysY: 2,
        bayWidthM: 5,
        bayDepthM: 5,
      },
      columnType: 'single',
      polygon: null, // rectangular 10m x 10m = 100 m²
      mainBeamProfile: null,
      secondaryBeamProfile: null,
      columnProfile: null,
      tiers: [
        {
          index: 0,
          elevationM: 'auto',
          clearHeightM: 3.0,
          loadClass: 500,
          floorType: 'WOOD_CHIPBOARD_30',
          accessories: { staircases: [], swingGates: [], upAndOverGates: [], safetyZones: [] },
        },
        {
          index: 1,
          elevationM: 'auto',
          clearHeightM: 3.0,
          loadClass: 500,
          floorType: 'WOOD_CHIPBOARD_30',
          accessories: { staircases: [], swingGates: [], upAndOverGates: [], safetyZones: [] },
        },
      ],
      frameColor: '#383e42',
      intumescentPaint: false,
      supportSlabId: null,
    } as unknown as AnyNode

    const nodes = asNodes({ mezz_1: mezzanine })
    const report = calculateWarehouseZoneTakeoff({
      zone,
      contentIds: asContentIds(['mezz_1']),
      nodes,
    })

    expect(report).not.toBeNull()
    const mezzBreakdown = report?.breakdown?.find((b) => b.id === 'mezzanine-platforms')
    expect(mezzBreakdown).toBeDefined()
    expect(mezzBreakdown?.count).toBe(1)
    expect(mezzBreakdown?.details).toContain('2 tiers')
    expect(mezzBreakdown?.details).toContain('200.0 m²')
  })

  it('correctly calculates conveyor network total length across all 8 conveyor types', () => {
    const zone = makeZone()
    const straightRoller: AnyNode = {
      id: asNodeId('conv_roller'),
      type: 'warehouse:conveyor-roller',
      usefulWidth: '600',
      rollers: 40,
      rollerPitch: '75', // 40 * 0.075 = 3.0m
      transportHeight: 0.75,
      speed: '45',
      flow: 'forward',
      inclination: 0,
      hasDrive: true,
      sideGuide: 'both',
      sideGuideHeight: 0.068,
      shortestBox: 0.3,
      frameColor: '#1e56a0',
      rollerColor: '#c9ced3',
      profileColor: '#e8eaec',
      supportSlabId: null,
    } as unknown as AnyNode

    const curveConveyor: AnyNode = {
      id: asNodeId('conv_curve'),
      type: 'warehouse:conveyor-curve',
      usefulWidth: '600',
      angle: '90',
      innerRadius: 0.8,
      handed: 'right',
      rollerPitch: '75',
      transportHeight: 0.75,
      speed: '45',
      zones: '1',
      sideGuide: 'both',
      sideGuideHeight: 0.068,
      shortestBox: 0.3,
      frameColor: '#1e56a0',
      rollerColor: '#c9ced3',
      profileColor: '#e8eaec',
      supportSlabId: null,
    } as unknown as AnyNode

    const booster: AnyNode = {
      id: asNodeId('conv_booster'),
      type: 'warehouse:conveyor-booster',
      usefulWidth: '600',
      rollers: 10,
      rollerPitch: '75', // 10 * 0.075 = 0.75m
      transportHeight: 0.75,
      speed: '45',
      sideGuide: 'both',
      sideGuideHeight: 0.068,
      shortestBox: 0.3,
      frameColor: '#1e56a0',
      rollerColor: '#c9ced3',
      profileColor: '#e8eaec',
      supportSlabId: null,
    } as unknown as AnyNode

    const launcher: AnyNode = {
      id: asNodeId('conv_launcher'),
      type: 'warehouse:conveyor-launcher',
      usefulWidth: '600',
      launchSide: 'right',
      rollerPitch: '75',
      transportHeight: 0.75,
      sideGuide: true,
      sideGuideHeight: 0.068,
      frameColor: '#1e56a0',
      rollerColor: '#c9ced3',
      profileColor: '#e8eaec',
      supportSlabId: null,
    } as unknown as AnyNode

    const oblique: AnyNode = {
      id: asNodeId('conv_oblique'),
      type: 'warehouse:conveyor-oblique',
      branchSide: 'right',
      angle: '45',
      flow: 'forward',
      rollerPitch: '75',
      transportHeight: 0.75,
      speed: '45',
      shortestBox: 0.3,
      frameColor: '#1e56a0',
      rollerColor: '#c9ced3',
      profileColor: '#e8eaec',
      supportSlabId: null,
    } as unknown as AnyNode

    const spiral: AnyNode = {
      id: asNodeId('conv_spiral'),
      type: 'warehouse:conveyor-spiral',
      outerDiameter: '1800',
      beltWidth: '500',
      inclineDeg: 12,
      handedness: 'ccw',
      entryHeight: 0.8,
      travelHeight: 3.5,
      flowDirection: 'up',
      loadClass: 'light',
      supportSlabId: null,
    } as unknown as AnyNode

    const telescopic: AnyNode = {
      id: asNodeId('conv_telescopic'),
      type: 'warehouse:conveyor-telescopic',
      model: 'a4-6+12',
      beltWidth: '600',
      extension: 0.5,
      transportHeight: 0.85,
      sideGuide: true,
      sideGuideHeight: 0.068,
      frameColor: '#1e56a0',
      supportSlabId: null,
    } as unknown as AnyNode

    const transfer: AnyNode = {
      id: asNodeId('conv_transfer'),
      type: 'warehouse:conveyor-transfer',
      dischargeSide: 'right',
      travel: 'symmetric',
      transportHeight: 0.75,
      speed: '45',
      shortestBox: 0.3,
      frameColor: '#1e56a0',
      rollerColor: '#c9ced3',
      profileColor: '#e8eaec',
      supportSlabId: null,
    } as unknown as AnyNode

    const nodes = asNodes({
      conv_roller: straightRoller,
      conv_curve: curveConveyor,
      conv_booster: booster,
      conv_launcher: launcher,
      conv_oblique: oblique,
      conv_spiral: spiral,
      conv_telescopic: telescopic,
      conv_transfer: transfer,
    })

    const report = calculateWarehouseZoneTakeoff({
      zone,
      contentIds: asContentIds([
        'conv_roller',
        'conv_curve',
        'conv_booster',
        'conv_launcher',
        'conv_oblique',
        'conv_spiral',
        'conv_telescopic',
        'conv_transfer',
      ]),
      nodes,
    })

    expect(report).not.toBeNull()
    const convBreakdown = report?.breakdown?.find((b) => b.id === 'conveyor-network')
    expect(convBreakdown).toBeDefined()
    expect(convBreakdown?.count).toBe(8)
    expect(convBreakdown?.details).toContain('total conveyor line length')
    const submetric = convBreakdown?.submetrics?.find((s) => s.label === 'Total Length')
    expect(submetric).toBeDefined()
    expect(typeof submetric?.value === 'string' && submetric.value.endsWith('m')).toBe(true)
  })

  it('correctly aggregates logistics equipment, benches, trucks, and marked routes', () => {
    const zone = makeZone()
    const bench: AnyNode = {
      id: asNodeId('bench_1'),
      type: 'warehouse:bench',
      variant: 'dispatch-packing',
    } as unknown as AnyNode

    const dockLeveller: AnyNode = {
      id: asNodeId('dock_1'),
      type: 'warehouse:dock-leveller',
      width: '2000',
      length: '2500',
      lip: 'hinged',
      lipLength: '400',
      lipExtension: 1,
      capacity: '60',
      frameHeight: '585',
      inclination: 0,
      hasBumpers: true,
      hasControlPost: true,
      frameColor: '#1e56a0',
      deckColor: '#c9ced3',
    } as unknown as AnyNode

    const palletLift: AnyNode = {
      id: asNodeId('lift_1'),
      type: 'warehouse:pallet-lift',
      capacityClass: '1000',
      palletPreset: 'epal-1',
      mastCount: '2',
      fromLevelId: null,
      toLevelId: null,
      fallbackTravelM: 3.5,
      hasEnclosure: true,
      hasDoors: true,
      hasControlPanel: true,
      mastColor: '#383e42',
      platformColor: '#d1d3d4',
      doorColor: '#e8b200',
      supportSlabId: null,
    } as unknown as AnyNode

    const truck: AnyNode = {
      id: asNodeId('truck_1'),
      type: 'warehouse:truck',
      model: 'forklift-1300',
      referenceLoad: '1000x1200',
      forkHeight: 0,
      routeId: null,
      routeAnchor: 0,
      duty: 'parked',
      pickSlot: null,
      dropSlot: null,
      carryingPalletId: null,
      supportSlabId: null,
    } as unknown as AnyNode

    const toteCart: AnyNode = {
      id: asNodeId('cart_1'),
      type: 'warehouse:tote-cart',
      toteFootprint: '600x400',
      toteHeight: '220',
      tiers: 5,
      castorDiameter: '100',
      tilt: false,
      hasHandle: true,
      frameColor: '#383e42',
      toteColor: '#e8b200',
    } as unknown as AnyNode

    const route: AnyNode = {
      id: asNodeId('route_1'),
      type: 'warehouse:route',
      points: [
        [0, 0],
        [10, 0],
        [10, 5],
      ],
      role: 'vehicle',
      traffic: 'two-way',
      width: 2.5,
      lineWidth: 'standard',
      requiredFor: null,
      datum: 'load-face',
      supportSlabId: null,
    } as unknown as AnyNode

    const floorPallet: AnyNode = {
      id: asNodeId('pallet_1'),
      type: 'warehouse:pallet',
      preset: 'epal-1',
      cargo: 'carton',
      fillRange: [0.5, 1],
      wrapped: true,
      strapped: true,
      labelled: true,
      cargoColor: 'kraft',
      slotAddress: null,
      slotRackId: null,
      supportSlabId: null,
    } as unknown as AnyNode

    const nodes = asNodes({
      bench_1: bench,
      dock_1: dockLeveller,
      lift_1: palletLift,
      truck_1: truck,
      cart_1: toteCart,
      route_1: route,
      pallet_1: floorPallet,
    })

    const report = calculateWarehouseZoneTakeoff({
      zone,
      contentIds: asContentIds([
        'bench_1',
        'dock_1',
        'lift_1',
        'truck_1',
        'cart_1',
        'route_1',
        'pallet_1',
      ]),
      nodes,
    })

    expect(report).not.toBeNull()

    expect(report?.breakdown?.find((b) => b.id === 'work-benches')?.count).toBe(1)
    expect(report?.breakdown?.find((b) => b.id === 'dock-levellers')?.count).toBe(1)
    expect(report?.breakdown?.find((b) => b.id === 'pallet-lifts')?.count).toBe(1)
    expect(report?.breakdown?.find((b) => b.id === 'handling-equipment')?.count).toBe(2)
    expect(report?.breakdown?.find((b) => b.id === 'floor-pallets')?.count).toBe(1)

    const routeBreakdown = report?.breakdown?.find((b) => b.id === 'marked-routes')
    expect(routeBreakdown).toBeDefined()
    expect(routeBreakdown?.count).toBe(1)
    expect(routeBreakdown?.details).toContain('15.0 m')
  })

  it('correctly derives comprehensive takeoff report for a complex mixed logistics zone', () => {
    const zone = makeZone({ name: 'Central Logistics Hub', roomNumber: 'LOG-01' })

    const nodes = asNodes({
      rack_a: {
        id: asNodeId('rack_a'),
        type: 'warehouse:pallet-rack',
        bayClearWidth: 2.7,
        depth: 1.1,
        uprightHeight: 7.0,
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
      } as unknown as AnyNode,
      drivein_a: {
        id: asNodeId('drivein_a'),
        type: 'warehouse:drive-in-rack',
        laneClearWidth: 1.35,
        palletsDeep: 4,
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
      } as unknown as AnyNode,
      live_a: {
        id: asNodeId('live_a'),
        type: 'warehouse:live-rack',
        palletsDeep: 6,
        levels: 3,
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
      } as unknown as AnyNode,
      longspan_a: {
        id: asNodeId('longspan_a'),
        type: 'warehouse:longspan-rack',
        bayLength: 1.9,
        frameDepth: 0.6,
        frameHeight: 2.5,
        uprightProfile: 'M-7515',
        beamProfile: 'ZE-55',
        crossBracing: false,
        levels: [
          { elevation: 0.3, structure: 'beam-shelf', shelfKind: 'chipboard', panels: 1 },
          { elevation: 1.0, structure: 'beam-shelf', shelfKind: 'chipboard', panels: 1 },
          { elevation: 1.8, structure: 'hanging', shelfKind: 'chipboard', panels: 1 },
        ],
      } as unknown as AnyNode,
      m3_a: {
        id: asNodeId('m3_a'),
        type: 'warehouse:m3-rack',
        shelfLength: 1.0,
        shelfDepth: 0.4,
        frameHeight: 2.0,
        frameVariant: 'basic',
        backPanel: 'none',
        door: 'none',
        uprightColor: '#637d96',
        componentColor: '#c5c7c4',
        supportSlabId: null,
        levels: [
          { elevation: 0.3, structure: 'shelf', model: 'HL', dividers: 0, drawerModel: 'MA', drawerWidth: 'wide' },
          { elevation: 0.8, structure: 'drawers', model: 'HL', dividers: 0, drawerModel: 'MA', drawerWidth: 'wide' },
        ],
      } as unknown as AnyNode,
      pallet_staged: {
        id: asNodeId('pallet_staged'),
        type: 'warehouse:pallet',
        preset: 'epal-1',
        cargo: 'carton',
        fillRange: [0.5, 1],
        wrapped: true,
        strapped: true,
        labelled: true,
        cargoColor: 'kraft',
        slotAddress: null,
        slotRackId: null,
        supportSlabId: null,
      } as unknown as AnyNode,
      mezz_a: {
        id: asNodeId('mezz_a'),
        type: 'warehouse:mezzanine',
        constructiveSystem: 'SIGMA',
        grid: { baysX: 1, baysY: 1, bayWidthM: 6, bayDepthM: 6 },
        columnType: 'single',
        polygon: null,
        mainBeamProfile: null,
        secondaryBeamProfile: null,
        columnProfile: null,
        tiers: [
          {
            index: 0,
            elevationM: 'auto',
            clearHeightM: 3.0,
            loadClass: 500,
            floorType: 'WOOD_CHIPBOARD_30',
            accessories: { staircases: [], swingGates: [], upAndOverGates: [], safetyZones: [] },
          },
        ],
        frameColor: '#383e42',
        intumescentPaint: false,
        supportSlabId: null,
      } as unknown as AnyNode,
      conv_a: {
        id: asNodeId('conv_a'),
        type: 'warehouse:conveyor-roller',
        usefulWidth: '600',
        rollers: 40,
        rollerPitch: '75',
        transportHeight: 0.75,
        speed: '45',
        flow: 'forward',
        inclination: 0,
        hasDrive: true,
        sideGuide: 'both',
        sideGuideHeight: 0.068,
        shortestBox: 0.3,
        frameColor: '#1e56a0',
        rollerColor: '#c9ced3',
        profileColor: '#e8eaec',
        supportSlabId: null,
      } as unknown as AnyNode,
      bench_a: {
        id: asNodeId('bench_a'),
        type: 'warehouse:bench',
        variant: 'dispatch-packing',
      } as unknown as AnyNode,
      dock_a: {
        id: asNodeId('dock_a'),
        type: 'warehouse:dock-leveller',
        width: '2000',
        length: '2500',
        lip: 'hinged',
        lipLength: '400',
        lipExtension: 1,
        capacity: '60',
        frameHeight: '585',
        inclination: 0,
        hasBumpers: true,
        hasControlPost: true,
        frameColor: '#1e56a0',
        deckColor: '#c9ced3',
      } as unknown as AnyNode,
      lift_a: {
        id: asNodeId('lift_a'),
        type: 'warehouse:pallet-lift',
        capacityClass: '1000',
        palletPreset: 'epal-1',
        mastCount: '2',
        fromLevelId: null,
        toLevelId: null,
        fallbackTravelM: 3.5,
        hasEnclosure: true,
        hasDoors: true,
        hasControlPanel: true,
        mastColor: '#383e42',
        platformColor: '#d1d3d4',
        doorColor: '#e8b200',
        supportSlabId: null,
      } as unknown as AnyNode,
      truck_a: {
        id: asNodeId('truck_a'),
        type: 'warehouse:truck',
        model: 'forklift-1300',
        referenceLoad: '1000x1200',
        forkHeight: 0,
        routeId: null,
        routeAnchor: 0,
        duty: 'parked',
        pickSlot: null,
        dropSlot: null,
        carryingPalletId: null,
        supportSlabId: null,
      } as unknown as AnyNode,
      cart_a: {
        id: asNodeId('cart_a'),
        type: 'warehouse:tote-cart',
        toteFootprint: '600x400',
        toteHeight: '220',
        tiers: 4,
        castorDiameter: '100',
        tilt: false,
        hasHandle: true,
        frameColor: '#383e42',
        toteColor: '#e8b200',
      } as unknown as AnyNode,
      route_a: {
        id: asNodeId('route_a'),
        type: 'warehouse:route',
        points: [
          [0, 0],
          [20, 0],
        ],
        role: 'vehicle',
        traffic: 'two-way',
        width: 2.5,
        lineWidth: 'standard',
        requiredFor: null,
        datum: 'load-face',
        supportSlabId: null,
      } as unknown as AnyNode,
    })

    const contentIds = asContentIds([
      'rack_a',
      'drivein_a',
      'live_a',
      'longspan_a',
      'm3_a',
      'pallet_staged',
      'mezz_a',
      'conv_a',
      'bench_a',
      'dock_a',
      'lift_a',
      'truck_a',
      'cart_a',
      'route_a',
    ])
    const report = calculateWarehouseZoneTakeoff({ zone, contentIds, nodes })

    expect(report).not.toBeNull()
    expect(report?.id).toBe('zone_test_1:warehouse-takeoff')
    expect(report?.title).toBe('Warehouse storage takeoff')

    // 5 storage types: selective rack (1) + drive-in (1) + live rack (1) + longspan (1) + m3 (1) = 5 bays
    const baysMetric = report?.metrics.find((m) => m.key === 'total-bays')
    expect(baysMetric?.value).toBe(5)

    // Pallet capacity: rack (15) + drivein (16) + live (18) + floor (1) = 50 pallets
    const palletMetric = report?.metrics.find((m) => m.key === 'pallet-capacity')
    expect(Number(palletMetric?.value)).toBeGreaterThanOrEqual(40)

    // Picking capacity: m3 drawers (4) + tote cart (4) = 8
    const pickMetric = report?.metrics.find((m) => m.key === 'picking-capacity')
    expect(pickMetric?.value).toBe(8)

    // All 13 categories should be populated in the breakdown
    const breakdownIds = report?.breakdown?.map((b) => b.id)
    expect(breakdownIds).toEqual([
      'selective-pallet-rack',
      'drive-in-rack',
      'live-rack',
      'longspan-shelving',
      'm3-shelving',
      'floor-pallets',
      'mezzanine-platforms',
      'conveyor-network',
      'work-benches',
      'pallet-lifts',
      'dock-levellers',
      'handling-equipment',
      'marked-routes',
    ])
  })

  it('properly conforms to ZoneTakeoffExtension protocol and plugin registration', () => {
    const zone = makeZone()
    const rackNode: AnyNode = {
      id: asNodeId('rack_node_1'),
      type: 'warehouse:pallet-rack',
      bayClearWidth: 2.7,
      depth: 1.1,
      uprightHeight: 6.0,
      depthPositions: 1,
      levels: 3,
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

    const nodes = asNodes({ rack_node_1: rackNode })

    expect(warehouseZoneTakeoffExtension.id).toBe('pascal:warehouse:zone-takeoff')
    expect(warehouseZoneTakeoffExtension.pluginId).toBe(warehousePlugin.id)

    // Check supportsZone
    expect(
      warehouseZoneTakeoffExtension.supportsZone({
        zone,
        contentIds: [],
        nodes,
      }),
    ).toBe(false)

    expect(
      warehouseZoneTakeoffExtension.supportsZone({
        zone,
        contentIds: asContentIds(['rack_node_1']),
        nodes,
      }),
    ).toBe(true)

    // Check deriveTakeoff
    const derived = warehouseZoneTakeoffExtension.deriveTakeoff({
      zone,
      contentIds: asContentIds(['rack_node_1']),
      nodes,
    })
    expect(derived).not.toBeNull()
    expect(derived?.title).toBe('Warehouse storage takeoff')

    // Check plugin registration
    expect(warehousePlugin.zoneTakeoffExtensions).toBeDefined()
    expect(warehousePlugin.zoneTakeoffExtensions).toContain(warehouseZoneTakeoffExtension)
  })
})
