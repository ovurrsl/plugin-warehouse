import { describe, expect, test } from 'bun:test'
import { useEditor } from '@pascal-app/editor'
import {
  CATALOG_ITEMS,
  CATALOG_SECTIONS,
  type CatalogItem,
  chipIsArmed,
  itemsInSection,
} from './catalog'
import { useWarehouseStore } from './store'

describe('Adversarial Challenge: Category Switching Across All 8 Sections', () => {
  test('all 8 sections exist with valid non-empty id, label, icon, and blurb', () => {
    expect(CATALOG_SECTIONS.length).toBe(8)
    const expectedSectionIds = [
      'unit-loads',
      'storage',
      'handling',
      'conveyance',
      'stations',
      'docks',
      'mezzanine',
      'layout',
    ]
    expect(CATALOG_SECTIONS.map((s) => s.id)).toEqual(expectedSectionIds)

    for (const section of CATALOG_SECTIONS) {
      expect(typeof section.id).toBe('string')
      expect(section.id.length).toBeGreaterThan(0)
      expect(typeof section.label).toBe('string')
      expect(section.label.length).toBeGreaterThan(0)
      expect(typeof section.icon).toBe('string')
      expect(section.icon.startsWith('lucide:')).toBe(true)
      expect(typeof section.blurb).toBe('string')
      expect(section.blurb.length).toBeGreaterThan(0)
    }
  })

  test('itemsInSection returns exactly and exclusively items belonging to that sectionId', () => {
    let totalAccounted = 0
    for (const section of CATALOG_SECTIONS) {
      const items = itemsInSection(section.id)
      expect(items.length).toBeGreaterThan(0)
      for (const item of items) {
        expect(item.sectionId).toBe(section.id)
      }
      totalAccounted += items.length
    }
    expect(totalAccounted).toBe(CATALOG_ITEMS.length)
  })

  test('switching between any category sequence yields strict disjoint item sets', () => {
    const categoryItemSets = CATALOG_SECTIONS.map((section) => ({
      sectionId: section.id,
      itemIds: itemsInSection(section.id).map((i) => i.id),
    }))

    for (let i = 0; i < categoryItemSets.length; i++) {
      for (let j = i + 1; j < categoryItemSets.length; j++) {
        const setA = new Set(categoryItemSets[i]!.itemIds)
        const setB = new Set(categoryItemSets[j]!.itemIds)
        const intersection = [...setA].filter((x) => setB.has(x))
        expect(intersection).toEqual([])
      }
    }
  })

  test('all items in catalog have valid icons (lucide:* or iconify format) and non-empty descriptions', () => {
    expect(CATALOG_ITEMS.length).toBe(43)
    for (const item of CATALOG_ITEMS) {
      expect(typeof item.id).toBe('string')
      expect(item.id.length).toBeGreaterThan(0)
      expect(typeof item.label).toBe('string')
      expect(item.label.length).toBeGreaterThan(0)
      expect(typeof item.icon).toBe('string')
      expect(item.icon.length).toBeGreaterThan(0)
      expect(typeof item.description).toBe('string')
      expect(item.description.length).toBeGreaterThan(0)
    }
  })

  test('per-category item distribution matches expected catalog schema', () => {
    const counts: Record<string, number> = {}
    for (const section of CATALOG_SECTIONS) {
      counts[section.id] = itemsInSection(section.id).length
    }
    // Verify each section contains at least 2 items and all 43 items are distributed
    expect(counts['unit-loads']).toBe(2)
    expect(counts['storage']).toBe(11)
    expect(counts['handling']).toBe(7)
    expect(counts['conveyance']).toBe(10)
    expect(counts['stations']).toBe(6)
    expect(counts['docks']).toBe(2)
    expect(counts['mezzanine']).toBe(3)
    expect(counts['layout']).toBe(2)
    const sum = Object.values(counts).reduce((a, b) => a + b, 0)
    expect(sum).toBe(43)
  })
})

describe('Adversarial Challenge: Real-Time Search Filtering & Edge Cases', () => {
  function searchCatalog(query: string, sectionId?: string): CatalogItem[] {
    const sourceItems = sectionId && !query ? itemsInSection(sectionId) : [...CATALOG_ITEMS]
    if (!query) return sourceItems

    const q = query.toLowerCase()
    return sourceItems.filter((item) => {
      const name = (item.label ?? '').toLowerCase()
      const description = (item.description ?? '').toLowerCase()
      const id = (item.id ?? '').toLowerCase()
      return name.includes(q) || description.includes(q) || id.includes(q)
    })
  }

  test('case-insensitivity across uppercase, lowercase, mixed case', () => {
    const queryLower = searchCatalog('forklift')
    const queryUpper = searchCatalog('FORKLIFT')
    const queryMixed = searchCatalog('FoRkLiFt')

    expect(queryLower.length).toBeGreaterThan(0)
    expect(queryLower).toEqual(queryUpper)
    expect(queryLower).toEqual(queryMixed)
    expect(queryLower.map((i) => i.id)).toContain('truck-forklift')
  })

  test('substring match across label, description, and id', () => {
    // 1. Label match
    const labelMatch = searchCatalog('reach truck')
    expect(labelMatch.map((i) => i.id)).toContain('truck-reach')

    // 2. ID match
    const idMatch = searchCatalog('pallet-rack-low')
    expect(idMatch.map((i) => i.id)).toEqual(['pallet-rack-low'])

    // 3. Description match (e.g. "Stertil", "Mecalux", "EPAL", "RAL 5014", "Sigma")
    const epalMatch = searchCatalog('EPAL')
    expect(epalMatch.map((i) => i.id)).toContain('pallet-empty')

    const stertilMatch = searchCatalog('Stertil')
    expect(stertilMatch.map((i) => i.id)).toContain('dock-leveller-hinged')
    expect(stertilMatch.map((i) => i.id)).toContain('dock-leveller-telescopic')

    const mecaluxMatch = searchCatalog('Mecalux')
    expect(mecaluxMatch.map((i) => i.id)).toContain('pallet-lift')
  })

  test('special characters, regex metacharacters, punctuation and symbols', () => {
    // Special punctuation present in labels/descriptions: '(', ')', '%', '×', '—', '[', ']'
    const fifoMatch = searchCatalog('(FIFO)')
    expect(fifoMatch.map((i) => i.id)).toContain('live-racking-fifo')

    const lifoMatch = searchCatalog('(LIFO')
    expect(lifoMatch.map((i) => i.id)).toContain('live-racking-lifo')

    const spiralCartonMatch = searchCatalog('(carton)')
    expect(spiralCartonMatch.map((i) => i.id)).toContain('conveyor-spiral-carton')

    // Regex characters that would break RegExp if not using plain substring search
    const regexChars = ['.*', '[a-z]', '\\d+', '^$', '(?:test)', '???']
    for (const charQuery of regexChars) {
      expect(() => searchCatalog(charQuery)).not.toThrow()
    }
  })

  test('Turkish character normalization and search strings in descriptions', () => {
    // Descriptions in catalog.ts contain Turkish text
    const yayaMatch = searchCatalog('yaya')
    expect(yayaMatch.map((i) => i.id)).toContain('route-pedestrian')

    const koridorMatch = searchCatalog('koridor')
    expect(koridorMatch.map((i) => i.id)).toContain('route-vehicle')

    const arabaMatch = searchCatalog('araba')
    expect(arabaMatch.map((i) => i.id)).toContain('tote-cart')
    expect(arabaMatch.map((i) => i.id)).toContain('tote-cart-tilted')
  })

  test('search overrides category scoping, empty search restores active section', () => {
    // When section is 'storage' and search is empty: returns only storage items
    const storageOnly = searchCatalog('', 'storage')
    expect(storageOnly.every((i) => i.sectionId === 'storage')).toBe(true)
    expect(storageOnly.map((i) => i.id)).not.toContain('truck-forklift')

    // When searching for 'forklift' while activeSection is 'storage': global search across all categories returns forklift
    const globalSearch = searchCatalog('forklift', 'storage')
    expect(globalSearch.map((i) => i.id)).toContain('truck-forklift')

    // When clearing search query: returns back to 'storage' items only
    const restored = searchCatalog('', 'storage')
    expect(restored).toEqual(storageOnly)
  })

  test('adversarial input: non-matching strings, HTML, long strings', () => {
    expect(searchCatalog('nonexistent_random_token_9999')).toEqual([])
    expect(searchCatalog('<script>alert("xss")</script>')).toEqual([])
    expect(searchCatalog('a'.repeat(500))).toEqual([])
  })
})

describe('Adversarial Challenge: Item Click Arming & Editor Mode Switching', () => {
  // Simulate the arm function from catalog-panel.tsx exactly
  function simulateArm(item: CatalogItem) {
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

  test('clicking every single item in CATALOG_ITEMS properly arms tool, sets build mode and updates store', () => {
    for (const item of CATALOG_ITEMS) {
      simulateArm(item)

      // 1. Armed chip ID set
      expect(useWarehouseStore.getState().armedChipId).toBe(item.id)

      // 2. Editor tool and mode set
      const editorState = useEditor.getState()
      expect(editorState.tool).toBe(item.kind)
      expect(editorState.mode).toBe('build')

      // 3. Single active chip highlighting verified
      const activeTool = editorState.tool
      const armedChipId = useWarehouseStore.getState().armedChipId

      // This item must be armed
      expect(chipIsArmed(item, activeTool, armedChipId)).toBe(true)

      // All other items with same kind must NOT be armed
      const sameKindOthers = CATALOG_ITEMS.filter((other) => other.kind === item.kind && other.id !== item.id)
      for (const other of sameKindOthers) {
        expect(chipIsArmed(other, activeTool, armedChipId)).toBe(false)
      }

      // All items with different kind must NOT be armed
      const differentKindItems = CATALOG_ITEMS.filter((other) => other.kind !== item.kind)
      for (const other of differentKindItems) {
        expect(chipIsArmed(other, activeTool, armedChipId)).toBe(false)
      }
    }
  })

  test('bench arming clears custom dimensions (width, height, depth) to prevent dimension leakage', () => {
    // Manually set custom bench dimensions
    useWarehouseStore.getState().setBenchBrush({
      variant: 'processing',
      width: 3.5,
      height: 1.2,
      depth: 1.0,
    })
    expect(useWarehouseStore.getState().benchBrush.width).toBe(3.5)

    // Arming another bench variant clears width/height/depth
    const ecoBench = CATALOG_ITEMS.find((i) => i.id === 'bench-eco')!
    simulateArm(ecoBench)

    const brush = useWarehouseStore.getState().benchBrush
    expect(brush.variant).toBe('eco')
    expect(brush.width).toBeUndefined()
    expect(brush.height).toBeUndefined()
    expect(brush.depth).toBeUndefined()
  })

  test('rack switching overwrites pickingLevels, levels and uprightHeight properly', () => {
    const lowRack = CATALOG_ITEMS.find((i) => i.id === 'pallet-rack-low')!
    simulateArm(lowRack)
    let brush = useWarehouseStore.getState().rackBrush
    expect(brush.variant).toBe('low-rack')
    expect(brush.uprightHeight).toBe(2.5)
    expect(brush.pickingLevels).toBe(3)

    const standardRack = CATALOG_ITEMS.find((i) => i.id === 'pallet-rack')!
    simulateArm(standardRack)
    brush = useWarehouseStore.getState().rackBrush
    expect(brush.variant).toBe('pallet-rack')
    expect(brush.uprightHeight).toBe(5)
    expect(brush.pickingLevels).toBe(0)
  })
})
