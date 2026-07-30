import { describe, expect, test } from 'bun:test'
import { CATALOG_ITEMS } from '../catalog'
import { warehouseCatalogPanel, warehousePlugin } from '../index'
import { CONSTRUCTIVE_SYSTEMS, FLOOR_TYPES } from './catalog'
import { mezzanineDefinition } from './definition'
import { mezzanineGeometryKey } from './geometry'
import { gridColumnPositions, resolveTierElevations, totalHeightM } from './metrics'
import { mezzanineParametrics } from './parametrics'
import { mezzanineParts } from './parts'
import { MezzanineNode } from './schema'

describe('şema: tiers[], host Level ile karıştırılmaz', () => {
  test('parse({}) başarılı, gidiş-dönüş kayıpsız', () => {
    const first = MezzanineNode.parse({})
    expect(MezzanineNode.parse(first)).toEqual(first)
    expect(first.tiers.length).toBe(1)
    expect(first.constructiveSystem).toBe('SIGMA')
  })

  test('yasak alan yok — levels bir sayı değil, host Level kavramıyla karışmaz', () => {
    const keys = Object.keys(MezzanineNode.parse({}))
    expect(keys).not.toContain('levels')
    expect(keys).toContain('tiers')
  })

  test('en az bir tier — boş dizi reddedilir', () => {
    expect(() => MezzanineNode.parse({ tiers: [] })).toThrow()
  })
})

describe('tier elevation zinciri', () => {
  test("addendum'ın kendi örneği: tier0 3.5 m + METAL_GRID 0.06 m → tier1 3.56 m", () => {
    const node = MezzanineNode.parse({
      tiers: [
        {
          index: 0,
          elevationM: 'auto',
          clearHeightM: 3.5,
          loadClass: 1000,
          floorType: 'METAL_GRID',
        },
        {
          index: 1,
          elevationM: 'auto',
          clearHeightM: 3.5,
          loadClass: 750,
          floorType: 'METAL_GRID',
        },
      ],
    })
    const resolved = resolveTierElevations(node.tiers)
    expect(resolved[0]?.resolvedElevationM).toBeCloseTo(0, 9)
    expect(resolved[1]?.resolvedElevationM).toBeCloseTo(3.56, 9)
  })

  test('açık bir sayı verilirse zincire hiç girmez', () => {
    const resolved = resolveTierElevations([
      {
        index: 0,
        elevationM: 'auto',
        clearHeightM: 3,
        loadClass: 500,
        floorType: 'WOOD_CHIPBOARD_30',
      },
      { index: 1, elevationM: 5, clearHeightM: 3, loadClass: 500, floorType: 'WOOD_CHIPBOARD_30' },
    ])
    expect(resolved[1]?.resolvedElevationM).toBe(5)
  })

  test('totalHeightM = son tier kotu + kendi tavan boşluğu', () => {
    const node = MezzanineNode.parse({
      tiers: [
        {
          index: 0,
          elevationM: 'auto',
          clearHeightM: 3,
          loadClass: 500,
          floorType: 'WOOD_CHIPBOARD_30',
        },
      ],
    })
    expect(totalHeightM(node)).toBeCloseTo(3, 9)
  })

  test('döşeme kalınlığı katalogdan — yazım hatası burada yakalanır', () => {
    for (const id of Object.keys(FLOOR_TYPES)) {
      expect(FLOOR_TYPES[id as keyof typeof FLOOR_TYPES].structuralDepthM).toBeGreaterThan(0)
    }
  })
})

describe('kolon ızgarası', () => {
  test('(baysX+1)×(baysY+1) nokta', () => {
    const node = MezzanineNode.parse({ grid: { baysX: 4, baysY: 3, bayWidthM: 5, bayDepthM: 5 } })
    const points = gridColumnPositions(node)
    expect(points.length).toBe(5 * 4)
  })

  test('köşe noktaları taban izinin tam köşesinde', () => {
    const node = MezzanineNode.parse({ grid: { baysX: 2, baysY: 2, bayWidthM: 5, bayDepthM: 5 } })
    const points = gridColumnPositions(node)
    const xs = points.map((p) => p.x)
    const zs = points.map((p) => p.z)
    expect(Math.min(...xs)).toBeCloseTo(-5, 9)
    expect(Math.max(...xs)).toBeCloseTo(5, 9)
    expect(Math.min(...zs)).toBeCloseTo(-5, 9)
    expect(Math.max(...zs)).toBeCloseTo(5, 9)
  })
})

describe('geometri anahtarı', () => {
  test('frameColor değişince değişir', () => {
    const a = MezzanineNode.parse({ frameColor: '#004f7c' })
    const b = MezzanineNode.parse({ frameColor: '#ff0000' })
    expect(mezzanineGeometryKey(a)).not.toBe(mezzanineGeometryKey(b))
  })

  test('tier sayısı/clearHeight değişince değişir', () => {
    const a = MezzanineNode.parse({})
    const b = MezzanineNode.parse({
      tiers: [
        {
          index: 0,
          elevationM: 'auto',
          clearHeightM: 4,
          loadClass: 500,
          floorType: 'WOOD_CHIPBOARD_30',
        },
      ],
    })
    expect(mezzanineGeometryKey(a)).not.toBe(mezzanineGeometryKey(b))
  })

  test("loadClass DEĞİŞMEZ — yalnız kapasite metadata'sı, geometriye girmez", () => {
    const a = MezzanineNode.parse({
      tiers: [
        {
          index: 0,
          elevationM: 'auto',
          clearHeightM: 3,
          loadClass: 250,
          floorType: 'WOOD_CHIPBOARD_30',
        },
      ],
    })
    const b = MezzanineNode.parse({
      tiers: [
        {
          index: 0,
          elevationM: 'auto',
          clearHeightM: 3,
          loadClass: 1000,
          floorType: 'WOOD_CHIPBOARD_30',
        },
      ],
    })
    expect(mezzanineGeometryKey(a)).toBe(mezzanineGeometryKey(b))
  })
})

describe('kutu-listesi parçaları', () => {
  test('her tier bir döşeme paneli üretir', () => {
    const node = MezzanineNode.parse({
      tiers: [
        {
          index: 0,
          elevationM: 'auto',
          clearHeightM: 3,
          loadClass: 500,
          floorType: 'WOOD_CHIPBOARD_30',
        },
        {
          index: 1,
          elevationM: 'auto',
          clearHeightM: 3,
          loadClass: 500,
          floorType: 'WOOD_CHIPBOARD_30',
        },
      ],
    })
    const parts = mezzanineParts(node)
    expect(parts.filter((p) => p.role === 'floor').length).toBe(2)
  })

  test('kolonlar grid nokta sayısı × 3 (I-profil: gövde + 2 flanş) — tek kat', () => {
    const node = MezzanineNode.parse({ grid: { baysX: 2, baysY: 2, bayWidthM: 5, bayDepthM: 5 } })
    const parts = mezzanineParts(node)
    expect(parts.filter((p) => p.role === 'column').length).toBe(9 * 3)
  })

  test('çift kolon tek kolonun iki katı parça üretir', () => {
    const single = mezzanineParts(
      MezzanineNode.parse({
        columnType: 'single',
        grid: { baysX: 1, baysY: 1, bayWidthM: 5, bayDepthM: 5 },
      }),
    )
    const double = mezzanineParts(
      MezzanineNode.parse({
        columnType: 'double',
        grid: { baysX: 1, baysY: 1, bayWidthM: 5, bayDepthM: 5 },
      }),
    )
    const columnCount = (parts: typeof single) => parts.filter((p) => p.role === 'column').length
    expect(columnCount(double)).toBe(columnCount(single) * 2)
  })
})

describe('kurucu sistemler', () => {
  test('üç sistem de tanımlı, SIGMA çok katlıda uyarı taşır', () => {
    expect(Object.keys(CONSTRUCTIVE_SYSTEMS).sort()).toEqual(['GL2000', 'MIXED', 'SIGMA'])
    expect(CONSTRUCTIVE_SYSTEMS.SIGMA.multiTierWarning).not.toBeNull()
    expect(CONSTRUCTIVE_SYSTEMS.GL2000.multiTierWarning).toBeNull()
  })

  test('çok katlı Sigma invariant uyarısı üretir, GL2000 üretmez', () => {
    const twoTierSigma = MezzanineNode.parse({
      constructiveSystem: 'SIGMA',
      tiers: [
        {
          index: 0,
          elevationM: 'auto',
          clearHeightM: 3,
          loadClass: 500,
          floorType: 'WOOD_CHIPBOARD_30',
        },
        {
          index: 1,
          elevationM: 'auto',
          clearHeightM: 3,
          loadClass: 500,
          floorType: 'WOOD_CHIPBOARD_30',
        },
      ],
    })
    const issues = mezzanineParametrics.invariants?.flatMap((check) => check(twoTierSigma)) ?? []
    expect(issues.some((issue) => issue.severity === 'warning' && issue.field === 'tiers')).toBe(
      true,
    )
  })
})

describe('tanım ve manifest', () => {
  test('kayıtlı, panelde listeli, katalogda iki fiş var', () => {
    const registered = new Set(warehousePlugin.nodes?.map((def) => def.kind))
    expect(registered.has('warehouse:mezzanine')).toBe(true)
    expect([...registered].sort()).toEqual([...(warehouseCatalogPanel.kinds ?? [])].sort())
    const tiles = CATALOG_ITEMS.filter((item) => item.kind === 'warehouse:mezzanine')
    expect(tiles.length).toBe(2)
  })

  test("rack HER ZAMAN registered — kolektif instancing sistemini mount eden tek kind, mezzanine kendi system'ini bildirmiyor", () => {
    const registered = new Set(warehousePlugin.nodes?.map((def) => def.kind))
    expect(registered.has('warehouse:pallet-rack')).toBe(true)
    expect('system' in mezzanineDefinition).toBe(false)
  })

  test('trailingSection tanımlı, invariants var', () => {
    expect(mezzanineParametrics.trailingSection).toBeDefined()
    expect(mezzanineParametrics.invariants?.length).toBeGreaterThan(0)
  })

  test('hat parçası DEĞİL: port bildirmez', () => {
    expect('ports' in mezzanineDefinition).toBe(false)
  })
})
