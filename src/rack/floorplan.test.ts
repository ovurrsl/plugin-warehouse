import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { buildPalletRackFloorplan, parseLevelFilter, PLAN_ROLES } from './floorplan'
import { rackParts } from './parts'
import { PalletRackNode } from './schema'
import { orientedPalletFootprint, totalDepth, totalWidth } from './slots'

const rack = (overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_plan', ...overrides })

const ctx = { viewState: undefined } as never

type Rect = { kind: string; x: number; y: number; width: number; height: number }

function rects(node: ReturnType<typeof rack>): Rect[] {
  const geometry = buildPalletRackFloorplan(node, ctx)
  if (geometry?.kind !== 'group') return []
  return geometry.children.filter((child): child is Rect & typeof child => child.kind === 'rect')
}

describe('the plan is projected from the model, not recomputed', () => {
  test('every steel part appears in plan at exactly its 3D footprint', () => {
    // The invariant that makes "2D matches 3D" a fact instead of a hope. Both
    // now read one part list; this asserts the projection is faithful.
    for (const config of [
      {},
      { depthPositions: 2 },
      { hasGroundBeam: true },
      { tunnelLevels: 1 },
      { pickingLevels: 1 },
    ]) {
      const node = rack(config)
      const drawn = rects(node)
      const parts = rackParts(node, 'full').filter((part) => PLAN_ROLES.has(part.role))

      for (const part of parts) {
        const x = part.center[0] - part.size[0] / 2
        const y = part.center[2] - part.size[2] / 2
        const match = drawn.find(
          (rect) =>
            Math.abs(rect.x - x) < 1e-9 &&
            Math.abs(rect.y - y) < 1e-9 &&
            Math.abs(rect.width - part.size[0]) < 1e-9 &&
            Math.abs(rect.height - part.size[2]) < 1e-9,
        )
        expect({ config, role: part.role, found: Boolean(match) }).toEqual({
          config,
          role: part.role,
          found: true,
        })
      }
    }
  })

  test('the plan gains parts when the model does', () => {
    // A plan that ignored a structural field would still look plausible; this
    // catches the projection silently falling behind the model.
    const plain = rects(rack()).length
    expect(rects(rack({ depthPositions: 2 })).length).toBeGreaterThan(plain)
    expect(rects(rack({ hasGroundBeam: true })).length).toBeGreaterThan(plain)
    expect(rects(rack({ levels: 6, uprightHeight: 9 })).length).toBeGreaterThan(plain)
    // And loses them when the model does. A tunnel through every level leaves
    // the frames and takes the beams and the pallet positions with it.
    expect(rects(rack({ tunnelLevels: 15 })).length).toBeLessThan(plain)
  })

  test('the outline is the collision footprint', () => {
    const node = rack({ depthPositions: 2 })
    const outline = rects(node)[0]
    expect(outline?.width).toBeCloseTo(totalWidth(node), 9)
    expect(outline?.height).toBeCloseTo(totalDepth(node), 9)
    expect(outline?.x).toBeCloseTo(-totalWidth(node) / 2, 9)
  })

  test('steel stays inside the outline; pallets overhang it, as they really do', () => {
    const node = rack({ depthPositions: 2 })
    const halfWidth = totalWidth(node) / 2
    const halfDepth = totalDepth(node) / 2
    const [, palletDepth] = orientedPalletFootprint(node)
    // The catalogue pairs a 1,100 mm frame with a 1,200 mm pallet whatever the
    // pallet, so the load protrudes 50 mm front and back. That is intended, and
    // it is why aisle widths are quoted between loads rather than between
    // frames — a plan that clipped it would understate the aisle a truck needs.
    const overhang = Math.max(0, (palletDepth - node.depth) / 2)
    expect(overhang).toBeCloseTo(0.05, 9)

    for (const rect of rects(node)) {
      const isPallet = (rect as unknown as { fill?: string }).fill === 'transparent'
      const slack = isPallet ? overhang : 0
      expect(rect.x).toBeGreaterThanOrEqual(-halfWidth - 1e-9)
      expect(rect.x + rect.width).toBeLessThanOrEqual(halfWidth + 1e-9)
      expect(rect.y).toBeGreaterThanOrEqual(-halfDepth - slack - 1e-9)
      expect(rect.y + rect.height).toBeLessThanOrEqual(halfDepth + slack + 1e-9)
    }
  })

  test('the pallet positions in plan match the slot count', () => {
    const node = rack()
    const drawn = rects(node)
    const outlined = drawn.filter(
      (rect) => (rect as unknown as { fill?: string }).fill === 'transparent',
    )
    // One bay, 3 across, single depth.
    expect(outlined).toHaveLength(3)
  })
})

describe('plan sembolü host mürekkebiyle çizilir', () => {
  /**
   * Renkleri hiçbir test korumuyordu — mavi paletten mimar mürekkebine geçiş
   * testlerden sessizce geçerdi, geri sürüklenmesi de geçerdi. Bu iki test
   * o sessizliği kapatıyor: gövde mürekkebi cabinet'in BODY_FILL/BODY_STROKE
   * değerleriyle AYNI olmalı (host'ta paylaşılan palet modülü yok, sözleşme
   * literal eşitliği), ve marquee vurgusu seçili kromu üretmeli.
   */
  test('gövde cabinet gövdesiyle aynı mürekkep: #ffffff / #7c7468', () => {
    const geometry = buildPalletRackFloorplan(rack(), ctx)
    if (geometry?.kind !== 'group') throw new Error('group bekleniyordu')
    const body = geometry.children[0] as { fill?: string; stroke?: string; strokeWidth?: number }
    expect(body.fill).toBe('#ffffff')
    expect(body.stroke).toBe('#7c7468')
    expect(body.strokeWidth).toBe(0.022)
  })

  test('highlighted tek başına seçili kromu üretir — marquee paritesi', () => {
    // Yalnız `selected` okunsaydı kutu seçim rafın üstünden vurgusuz geçerdi
    // ve hiçbir şey hata vermezdi; kullanıcı yalnızca rafın "seçilmediğini"
    // görürdü.
    const highlightedCtx = {
      viewState: {
        selected: false,
        highlighted: true,
        palette: { selectedStroke: '#123456', selectedFill: '#654321' },
      },
    } as never
    const geometry = buildPalletRackFloorplan(rack(), highlightedCtx)
    if (geometry?.kind !== 'group') throw new Error('group bekleniyordu')
    const body = geometry.children[0] as { fill?: string; stroke?: string; strokeWidth?: number }
    expect(body.stroke).toBe('#123456')
    expect(body.fill).toBe('#654321')
    expect(body.strokeWidth).toBe(0.03)
  })
})

describe('2D Floorplan Annotations & Dynamic Level Filtering (Features 11 & 12)', () => {
  test('parseLevelFilter handles various formats robustly', () => {
    expect(parseLevelFilter('Kat D')).toEqual({ active: true, levelIndex: 3, levelLetter: 'D' })
    expect(parseLevelFilter('kat d')).toEqual({ active: true, levelIndex: 3, levelLetter: 'D' })
    expect(parseLevelFilter('Level D')).toEqual({ active: true, levelIndex: 3, levelLetter: 'D' })
    expect(parseLevelFilter('D')).toEqual({ active: true, levelIndex: 3, levelLetter: 'D' })
    expect(parseLevelFilter(3)).toEqual({ active: true, levelIndex: 3, levelLetter: 'D' })
    expect(parseLevelFilter('3')).toEqual({ active: true, levelIndex: 3, levelLetter: 'D' })
    expect(parseLevelFilter('Kat A')).toEqual({ active: true, levelIndex: 0, levelLetter: 'A' })
    expect(parseLevelFilter(null)).toEqual({ active: false, levelIndex: -1, levelLetter: '' })
    expect(parseLevelFilter(undefined)).toEqual({ active: false, levelIndex: -1, levelLetter: '' })
    expect(parseLevelFilter('')).toEqual({ active: false, levelIndex: -1, levelLetter: '' })
    expect(parseLevelFilter('all')).toEqual({ active: false, levelIndex: -1, levelLetter: '' })
  })

  function getChildren(geom: FloorplanGeometry | null): FloorplanGeometry[] {
    return geom && geom.kind === 'group' ? geom.children : []
  }

  test('Feature 11.1: Aisle header ("SIRA A") is emitted on bayIndex 1 when rowLabel is set', () => {
    const node = rack({ rowLabel: 'A', bayIndex: 1 })
    const geometry = buildPalletRackFloorplan(node, ctx)
    expect(geometry?.kind).toBe('group')
    const texts = getChildren(geometry).filter((c): c is Extract<FloorplanGeometry, { kind: 'text' }> => c.kind === 'text')
    const header = texts.find((t) => t.text === 'SIRA A')
    expect(header).toBeDefined()
    expect(header?.textAnchor).toBe('end')
    expect(header?.x).toBeLessThan(-totalWidth(node) / 2)
  })

  test('Feature 11.1: Aisle header is not emitted on subsequent bays (bayIndex 2)', () => {
    const node = rack({ rowLabel: 'A', bayIndex: 2 })
    const geometry = buildPalletRackFloorplan(node, ctx)
    const texts = getChildren(geometry).filter((c): c is Extract<FloorplanGeometry, { kind: 'text' }> => c.kind === 'text')
    const header = texts.find((t) => t.text === 'SIRA A')
    expect(header).toBeUndefined()
  })

  test('Feature 11.2: Bay numbers ("01", "02") are displayed along the aisle', () => {
    const n1 = rack({ bayIndex: 1 })
    const g1 = buildPalletRackFloorplan(n1, ctx)
    const t1 = getChildren(g1).filter((c): c is Extract<FloorplanGeometry, { kind: 'text' }> => c.kind === 'text')
    expect(t1.some((t) => t.text === '01')).toBe(true)

    const n2 = rack({ bayIndex: 2 })
    const g2 = buildPalletRackFloorplan(n2, ctx)
    const t2 = getChildren(g2).filter((c): c is Extract<FloorplanGeometry, { kind: 'text' }> => c.kind === 'text')
    expect(t2.some((t) => t.text === '02')).toBe(true)
  })

  test('Feature 12: Inactive level filter emits standard footprints without address clutter', () => {
    const node = rack({ rowLabel: 'A', bayIndex: 2, levels: 4 })
    const geometry = buildPalletRackFloorplan(node, ctx)
    const texts = getChildren(geometry).filter((c): c is Extract<FloorplanGeometry, { kind: 'text' }> => c.kind === 'text')
    const addresses = texts.filter((t) => t.text.includes('A-02-'))
    expect(addresses).toHaveLength(0)

    const rectsList = getChildren(geometry).filter((c): c is Extract<FloorplanGeometry, { kind: 'rect' }> => c.kind === 'rect')
    const footprints = rectsList.filter((r) => r.fill === 'transparent')
    expect(footprints).toHaveLength(3)
  })

  test('Feature 12: Active level filter ("Kat D") draws full industrial addresses centered on footprints', () => {
    const node = rack({ rowLabel: 'A', bayIndex: 2, levels: 4, groundLevelStorage: true })
    const filteredCtx = {
      extensions: { activeFloorplanLevelFilter: 'Kat D' },
    } as unknown as GeometryContext

    const geometry = buildPalletRackFloorplan(node, filteredCtx)
    const texts = getChildren(geometry).filter((c): c is Extract<FloorplanGeometry, { kind: 'text' }> => c.kind === 'text')
    const addresses = texts.filter((t) => t.text.startsWith('A-02-D')).map((t) => t.text)
    expect(addresses).toEqual(['A-02-D1', 'A-02-D2', 'A-02-D3'])
  })

  test('Feature 12: Active level filter on dual-facing bays differentiates front (A) and rear (B)', () => {
    const node = rack({
      rowLabel: 'A',
      bayIndex: 2,
      accessMode: 'dual-facing',
      frontAisleLabel: 'A',
      rearAisleLabel: 'B',
      depthPositions: 2,
      levels: 4,
      groundLevelStorage: true,
    })
    const filteredCtx = {
      extensions: { activeFloorplanLevelFilter: 'Kat D' },
    } as unknown as GeometryContext

    const geometry = buildPalletRackFloorplan(node, filteredCtx)
    const texts = getChildren(geometry).filter((c): c is Extract<FloorplanGeometry, { kind: 'text' }> => c.kind === 'text')

    const frontAddresses = texts.filter((t) => t.text.startsWith('A-02-D')).map((t) => t.text)
    expect(frontAddresses).toEqual(['A-02-D1', 'A-02-D2', 'A-02-D3'])

    const rearAddresses = texts.filter((t) => t.text.startsWith('B-02-D')).map((t) => t.text)
    expect(rearAddresses).toEqual(['B-02-D1', 'B-02-D2', 'B-02-D3'])
  })
})
