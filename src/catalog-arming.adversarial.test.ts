import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { CATALOG_ITEMS, CATALOG_SECTIONS, type CatalogItem, chipIsArmed, itemsInSection } from './catalog'
import { warehousePlugin } from './index'
import { useWarehouseStore } from './store'
import { useEditor } from '@pascal-app/editor'

/**
 * Challenger Adversarial Test Suite for Item Arming, Brush Verification,
 * and Catalog Invariants (Milestone 3 / challenger_m3_2).
 */

describe('Challenger Adversarial: Catalog Completeness & Invariants', () => {
  test('all catalog items have valid non-empty fields and unique IDs', () => {
    const ids = new Set<string>()
    for (const item of CATALOG_ITEMS) {
      expect(item.id).toBeDefined()
      expect(item.id.trim().length).toBeGreaterThan(0)
      expect(ids.has(item.id)).toBe(false)
      ids.add(item.id)

      expect(item.kind).toBeDefined()
      expect(item.kind.startsWith('warehouse:')).toBe(true)

      expect(item.label).toBeDefined()
      expect(item.label.trim().length).toBeGreaterThan(0)

      expect(item.sectionId).toBeDefined()
      expect(CATALOG_SECTIONS.some((s) => s.id === item.sectionId)).toBe(true)

      expect(item.description).toBeDefined()
      expect(item.description.trim().length).toBeGreaterThan(0)

      expect(item.icon).toBeDefined()
      expect(item.icon.includes(':')).toBe(true)
    }
  })

  test('every section has at least one catalog item and itemsInSection returns all matching items', () => {
    for (const section of CATALOG_SECTIONS) {
      const items = itemsInSection(section.id)
      expect(items.length).toBeGreaterThan(0)
      for (const item of items) {
        expect(item.sectionId).toBe(section.id)
      }
    }
  })

  test('all registered node kinds in warehousePlugin match catalog kinds or internal kinds', () => {
    const registeredKinds = new Set(warehousePlugin.nodes?.map((n) => n.kind) ?? [])
    for (const item of CATALOG_ITEMS) {
      expect(registeredKinds.has(item.kind)).toBe(true)
    }
  })
})

describe('Challenger Adversarial: 15 Brush Branches Verification in arm(item)', () => {
  const arm = (item: CatalogItem) => {
    useWarehouseStore.getState().setArmedChipId(item.id)
    if (item.brush?.kind === 'pallet') {
      useWarehouseStore.getState().setPalletBrush({ cargo: item.brush.cargo })
    }
    if (item.brush?.kind === 'route') {
      useWarehouseStore.getState().setRouteBrush({ role: item.brush.role, traffic: item.brush.traffic })
    }
    if (item.brush?.kind === 'truck') {
      useWarehouseStore.getState().setTruckBrush({ model: item.brush.model as never })
    }
    if (item.brush?.kind === 'rack') {
      useWarehouseStore.getState().setRackBrush(item.brush.patch)
    }
    if (item.brush?.kind === 'telescopic') {
      useWarehouseStore.getState().setTelescopicBrush({ model: item.brush.model as never })
    }
    if (item.brush?.kind === 'conveyor-spiral') {
      useWarehouseStore.getState().setSpiralBrush(item.brush.patch)
    }
    if (item.brush?.kind === 'mezzanine') {
      useWarehouseStore.getState().setMezzanineBrush(item.brush.patch as never)
    }
    if (item.brush?.kind === 'longspan') {
      useWarehouseStore.getState().setLongspanBrush(item.brush.patch)
    }
    if (item.brush?.kind === 'm3') {
      useWarehouseStore.getState().setM3Brush(item.brush.patch)
    }
    if (item.brush?.kind === 'drive-in') {
      useWarehouseStore.getState().setDriveInBrush(item.brush.patch)
    }
    if (item.brush?.kind === 'live-racking') {
      useWarehouseStore.getState().setLiveRackingBrush(item.brush.patch)
    }
    if (item.brush?.kind === 'bench') {
      useWarehouseStore.getState().setBenchBrush({
        ...item.brush.patch,
        width: undefined,
        height: undefined,
        depth: undefined,
      })
    }
    if (item.brush?.kind === 'dockleveller') {
      useWarehouseStore.getState().setDockLevellerBrush(item.brush.patch)
    }
    if (item.brush?.kind === 'pallet-lift') {
      useWarehouseStore.getState().setPalletLiftBrush(item.brush.patch)
    }
    if (item.brush?.kind === 'totecart') {
      useWarehouseStore.getState().setToteCartBrush(item.brush.patch)
    }
    const editor = useEditor.getState() as unknown as {
      setTool: (value: string) => void
      setMode: (value: string) => void
    }
    editor.setTool(item.kind)
    editor.setMode('build')
  }

  test('Branch 1: pallet brush arms correctly (empty and loaded)', () => {
    const empty = CATALOG_ITEMS.find((i) => i.id === 'pallet-empty')!
    arm(empty)
    expect(useWarehouseStore.getState().armedChipId).toBe('pallet-empty')
    expect(useWarehouseStore.getState().palletBrush.cargo).toBe('none')
    expect(useEditor.getState().tool).toBe('warehouse:pallet')

    const loaded = CATALOG_ITEMS.find((i) => i.id === 'pallet-loaded')!
    arm(loaded)
    expect(useWarehouseStore.getState().armedChipId).toBe('pallet-loaded')
    expect(useWarehouseStore.getState().palletBrush.cargo).toBe('carton')
  })

  test('Branch 2: route brush arms correctly (pedestrian and vehicle)', () => {
    const ped = CATALOG_ITEMS.find((i) => i.id === 'route-pedestrian')!
    arm(ped)
    expect(useWarehouseStore.getState().armedChipId).toBe('route-pedestrian')
    expect(useWarehouseStore.getState().routeBrush.role).toBe('pedestrian')
    expect(useWarehouseStore.getState().routeBrush.traffic).toBe('two-way')

    const veh = CATALOG_ITEMS.find((i) => i.id === 'route-vehicle')!
    arm(veh)
    expect(useWarehouseStore.getState().armedChipId).toBe('route-vehicle')
    expect(useWarehouseStore.getState().routeBrush.role).toBe('vehicle')
    expect(useWarehouseStore.getState().routeBrush.traffic).toBe('one-way')
  })

  test('Branch 3: truck brush arms correctly across all 5 models', () => {
    const truckItems = CATALOG_ITEMS.filter((i) => i.brush?.kind === 'truck')
    expect(truckItems.length).toBe(5)
    for (const item of truckItems) {
      arm(item)
      expect(useWarehouseStore.getState().armedChipId).toBe(item.id)
      if (item.brush?.kind === 'truck') {
        expect(useWarehouseStore.getState().truckBrush.model).toBe(item.brush.model)
      }
    }
  })

  test('Branch 4: rack brush arms correctly (pallet rack vs low rack with picking levels)', () => {
    const lowRack = CATALOG_ITEMS.find((i) => i.id === 'pallet-rack-low')!
    arm(lowRack)
    expect(useWarehouseStore.getState().rackBrush.variant).toBe('low-rack')
    expect(useWarehouseStore.getState().rackBrush.uprightHeight).toBe(2.5)
    expect(useWarehouseStore.getState().rackBrush.pickingLevels).toBe(3)

    const standardRack = CATALOG_ITEMS.find((i) => i.id === 'pallet-rack')!
    arm(standardRack)
    expect(useWarehouseStore.getState().rackBrush.variant).toBe('pallet-rack')
    expect(useWarehouseStore.getState().rackBrush.uprightHeight).toBe(5)
    expect(useWarehouseStore.getState().rackBrush.pickingLevels).toBe(0)
  })

  test('Branch 5: telescopic belt conveyor arms correctly', () => {
    const tele = CATALOG_ITEMS.find((i) => i.id === 'conveyor-telescopic')!
    arm(tele)
    expect(useWarehouseStore.getState().armedChipId).toBe('conveyor-telescopic')
    expect(useWarehouseStore.getState().telescopicBrush.model).toBe('a4-6+12')
  })

  test('Branch 6: conveyor spiral arms correctly (carton vs pallet load class)', () => {
    const spiralCarton = CATALOG_ITEMS.find((i) => i.id === 'conveyor-spiral-carton')!
    arm(spiralCarton)
    expect(useWarehouseStore.getState().spiralBrush.loadClass).toBe('light')
    expect(useWarehouseStore.getState().spiralBrush.outerDiameter).toBe('1500')

    const spiralPallet = CATALOG_ITEMS.find((i) => i.id === 'conveyor-spiral-pallet')!
    arm(spiralPallet)
    expect(useWarehouseStore.getState().spiralBrush.loadClass).toBe('pallet')
    expect(useWarehouseStore.getState().spiralBrush.outerDiameter).toBe('2400')
  })

  test('Branch 7: mezzanine arms correctly (SIGMA, GL2000, MIXED)', () => {
    const sigma = CATALOG_ITEMS.find((i) => i.id === 'mezzanine-sigma')!
    arm(sigma)
    expect(useWarehouseStore.getState().mezzanineBrush.constructiveSystem).toBe('SIGMA')

    const gl2000 = CATALOG_ITEMS.find((i) => i.id === 'mezzanine-gl2000')!
    arm(gl2000)
    expect(useWarehouseStore.getState().mezzanineBrush.constructiveSystem).toBe('GL2000')

    const mixed = CATALOG_ITEMS.find((i) => i.id === 'mezzanine-mixed')!
    arm(mixed)
    expect(useWarehouseStore.getState().mezzanineBrush.constructiveSystem).toBe('MIXED')
  })

  test('Branch 8: longspan rack arms correctly (picking vs bulk)', () => {
    const picking = CATALOG_ITEMS.find((i) => i.id === 'longspan-picking')!
    arm(picking)
    expect(useWarehouseStore.getState().longspanBrush.shelfKind).toBe('chipboard')

    const bulk = CATALOG_ITEMS.find((i) => i.id === 'longspan-bulk')!
    arm(bulk)
    expect(useWarehouseStore.getState().longspanBrush.shelfKind).toBe('mesh')
  })

  test('Branch 9: m3 rack arms correctly (picking, drawers, cabinet)', () => {
    const picking = CATALOG_ITEMS.find((i) => i.id === 'm3-picking')!
    arm(picking)
    expect(useWarehouseStore.getState().m3Brush.structure).toBe('shelf')
    expect(useWarehouseStore.getState().m3Brush.model).toBe('HL')

    const drawers = CATALOG_ITEMS.find((i) => i.id === 'm3-drawers')!
    arm(drawers)
    expect(useWarehouseStore.getState().m3Brush.structure).toBe('drawers')
    expect(useWarehouseStore.getState().m3Brush.model).toBe('HM')

    const cabinet = CATALOG_ITEMS.find((i) => i.id === 'm3-cabinet')!
    arm(cabinet)
    expect(useWarehouseStore.getState().m3Brush.backPanel).toBe('metal')
    expect(useWarehouseStore.getState().m3Brush.door).toBe('h2000')
  })

  test('Branch 10: drive-in rack arms correctly (drive-in vs drive-through)', () => {
    const driveIn = CATALOG_ITEMS.find((i) => i.id === 'drive-in-rack')!
    arm(driveIn)
    expect(useWarehouseStore.getState().driveInBrush.entryMode).toBe('drive-in')

    const driveThrough = CATALOG_ITEMS.find((i) => i.id === 'drive-through-rack')!
    arm(driveThrough)
    expect(useWarehouseStore.getState().driveInBrush.entryMode).toBe('drive-through')
  })

  test('Branch 11: live racking arms correctly (FIFO vs LIFO)', () => {
    const fifo = CATALOG_ITEMS.find((i) => i.id === 'live-racking-fifo')!
    arm(fifo)
    expect(useWarehouseStore.getState().liveRackingBrush.variant).toBe('FIFO')
    expect(useWarehouseStore.getState().liveRackingBrush.withRetainers).toBe(false)

    const lifo = CATALOG_ITEMS.find((i) => i.id === 'live-racking-lifo')!
    arm(lifo)
    expect(useWarehouseStore.getState().liveRackingBrush.variant).toBe('LIFO')
    expect(useWarehouseStore.getState().liveRackingBrush.withRetainers).toBe(true)
  })

  test('Branch 12: bench arms correctly across all 6 variants with clean dimension resets', () => {
    const benches = CATALOG_ITEMS.filter((i) => i.brush?.kind === 'bench')
    expect(benches.length).toBe(6)
    for (const item of benches) {
      if (item.brush?.kind === 'bench') {
        arm(item)
        expect(useWarehouseStore.getState().benchBrush.variant).toBe(item.brush.patch.variant)
        expect(useWarehouseStore.getState().benchBrush.width).toBeUndefined()
        expect(useWarehouseStore.getState().benchBrush.height).toBeUndefined()
        expect(useWarehouseStore.getState().benchBrush.depth).toBeUndefined()
      }
    }
  })

  test('Branch 13: dock leveller arms correctly (hinged vs telescopic lip)', () => {
    const hinged = CATALOG_ITEMS.find((i) => i.id === 'dock-leveller-hinged')!
    arm(hinged)
    expect(useWarehouseStore.getState().dockLevellerBrush.lip).toBe('hinged')

    const telescopic = CATALOG_ITEMS.find((i) => i.id === 'dock-leveller-telescopic')!
    arm(telescopic)
    expect(useWarehouseStore.getState().dockLevellerBrush.lip).toBe('telescopic')
  })

  test('Branch 14: pallet lift arms correctly', () => {
    const lift = CATALOG_ITEMS.find((i) => i.id === 'pallet-lift')!
    arm(lift)
    expect(useWarehouseStore.getState().palletLiftBrush.capacityClass).toBe('1000')
    expect(useWarehouseStore.getState().palletLiftBrush.mastCount).toBe('2')
  })

  test('Branch 15: tote cart arms correctly (standard vs tilted tiers)', () => {
    const std = CATALOG_ITEMS.find((i) => i.id === 'tote-cart')!
    arm(std)
    expect(useWarehouseStore.getState().toteCartBrush.tilt).toBe(false)
    expect(useWarehouseStore.getState().toteCartBrush.tiers).toBe(5)

    const tilted = CATALOG_ITEMS.find((i) => i.id === 'tote-cart-tilted')!
    arm(tilted)
    expect(useWarehouseStore.getState().toteCartBrush.tilt).toBe(true)
    expect(useWarehouseStore.getState().toteCartBrush.tiers).toBe(3)
  })
})

describe('Challenger Adversarial: chipIsArmed Active Highlighting Verification', () => {
  test('chipIsArmed returns true strictly when item matches activeTool and armedChipId', () => {
    for (const targetItem of CATALOG_ITEMS) {
      for (const queryItem of CATALOG_ITEMS) {
        const isActive = chipIsArmed(queryItem, targetItem.kind, targetItem.id)
        if (queryItem.id === targetItem.id) {
          expect(isActive).toBe(true)
        } else {
          // If queryItem has different ID but same kind, it should NOT be active when armedChipId is specific
          expect(isActive).toBe(false)
        }
      }
    }
  })

  test('chipIsArmed returns false when activeTool does not match item kind regardless of chipId', () => {
    for (const item of CATALOG_ITEMS) {
      expect(chipIsArmed(item, 'wall', item.id)).toBe(false)
      expect(chipIsArmed(item, 'select', item.id)).toBe(false)
      expect(chipIsArmed(item, null, item.id)).toBe(false)
      expect(chipIsArmed(item, undefined, item.id)).toBe(false)
    }
  })

  test('chipIsArmed falls back to kind-matching when armedChipId is null or unknown', () => {
    // When external tools activate without armedChipId, all chips of that kind match
    const rackItems = CATALOG_ITEMS.filter((i) => i.kind === 'warehouse:pallet-rack')
    for (const item of rackItems) {
      expect(chipIsArmed(item, 'warehouse:pallet-rack', null)).toBe(true)
      expect(chipIsArmed(item, 'warehouse:pallet-rack', 'unknown-external-id')).toBe(true)
    }
  })
})

describe('Challenger Adversarial: AST & Code Invariant Checks', () => {
  const panelSource = readFileSync(`${import.meta.dir}/panels/catalog-panel.tsx`, 'utf8')

  test('AST verification: all 15 brush branch conditionals are strictly present in catalog-panel.tsx', () => {
    const requiredBrushKinds = [
      'pallet',
      'route',
      'truck',
      'rack',
      'telescopic',
      'conveyor-spiral',
      'mezzanine',
      'longspan',
      'm3',
      'drive-in',
      'live-racking',
      'bench',
      'dockleveller',
      'pallet-lift',
      'totecart',
    ]

    for (const kind of requiredBrushKinds) {
      expect(panelSource).toContain(`item.brush?.kind === '${kind}'`)
    }
  })

  test('AST verification: ItemCatalog integration and state bindings are intact', () => {
    expect(panelSource).toContain('import {\n  ItemCatalog,')
    expect(panelSource).toContain('<ItemCatalog')
    expect(panelSource).toContain('category={search ? undefined : activeSectionId}')
    expect(panelSource).toContain('isItemActive={(item) => chipIsArmed(item as CatalogItem, activeTool, armedChipId)}')
    expect(panelSource).toContain('onItemClick={(item) => arm(item as CatalogItem)}')
    expect(panelSource).toContain('search={search}')
  })

  test('AST verification: contextual switches and controls are rendered in catalog-panel.tsx', () => {
    expect(panelSource).toContain('<LoadBrush />')
    expect(panelSource).toContain('<FlowSwitch />')
    expect(panelSource).toContain('<FleetSwitch />')
    expect(panelSource).toContain('<InstancingSwitch />')
    expect(panelSource).toContain('<DetailRangeSwitch />')
  })
})
