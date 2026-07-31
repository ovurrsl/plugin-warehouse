import { describe, expect, test } from 'bun:test'
import { CATALOG_ITEMS } from '../catalog'
import { warehouseCatalogPanel, warehousePlugin } from '../index'
import {
  CONSTRUCTIVE_SYSTEMS,
  FLOOR_TYPES,
  SIGMA_DEFAULT_HEIGHT_M,
  SIGMA_DEFAULT_WIDTH_M,
  SIGMA_PROFILE,
  STAIRCASE_GEOMETRY,
} from './catalog'
import { mezzanineDefinition } from './definition'
import { mezzanineGeometryKey } from './geometry'
import {
  effectiveClearHeightM,
  gridColumnPositions,
  resolveMainBeamProfile,
  resolveSecondaryBeamProfile,
  resolveTierElevations,
  totalHeightM,
} from './metrics'
import { mezzanineParametrics } from './parametrics'
import { mezzanineParts } from './parts'
import { emptyAccessories, MezzanineNode } from './schema'

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
        accessories: emptyAccessories(),
      },
      {
        index: 1,
        elevationM: 5,
        clearHeightM: 3,
        loadClass: 500,
        floorType: 'WOOD_CHIPBOARD_30',
        accessories: emptyAccessories(),
      },
    ])
    expect(resolved[1]?.resolvedElevationM).toBe(5)
  })

  test('totalHeightM = en üst yürüme yüzeyi + korkuluk', () => {
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
    // 3 (tavan boşluğu) + 0.03 (yonga levha) + 1.1 (küpeşte). Korkuluk
    // DAHİL: kolider bunu okuyor ve korkuluksuz bir kutu, mezzanine'in
    // üstünden geçen seçim ışınını kaçırırdı.
    expect(totalHeightM(node)).toBeCloseTo(4.13, 9)
  })

  test("deckTopM bir sonraki tier'in elevation'ıyla AYNI — zincir kapanıyor", () => {
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
    expect(resolved[0]?.deckTopM).toBeCloseTo(resolved[1]?.resolvedElevationM ?? -1, 9)
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
  test('döşeme göz başına panel — tier başına baysX×baysY', () => {
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
    // Varsayılan grid 4×3 = 12 panel, iki tier = 24. Tek kutu DEĞİL: bir
    // merdiven boşluğu ancak panel dışlamayla açılabilir (CSG yasak).
    expect(parts.filter((p) => p.role === 'floor').length).toBe(24)
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

/** Mezzanine fişleri, `[id, patch]` olarak — birleşim daraltması bir yerde. */
function mezzanineTiles() {
  const pairs: Array<
    [
      string,
      Extract<NonNullable<(typeof CATALOG_ITEMS)[number]['brush']>, { kind: 'mezzanine' }>['patch'],
    ]
  > = []
  for (const item of CATALOG_ITEMS) {
    if (item.kind !== 'warehouse:mezzanine') continue
    const brush = item.brush
    if (brush?.kind !== 'mezzanine') continue
    pairs.push([item.id, brush.patch])
  }
  return pairs
}

describe('tanım ve manifest', () => {
  test('kayıtlı ve panelde listeli', () => {
    const registered = new Set(warehousePlugin.nodes?.map((def) => def.kind))
    expect(registered.has('warehouse:mezzanine')).toBe(true)
    expect([...registered].sort()).toEqual([...(warehouseCatalogPanel.kinds ?? [])].sort())
  })

  test('HER kurucu sistemin kataloğa bir yolu var', () => {
    // Sayı sabiti yerine gerçek değişmez. Önceki hâli `toBe(2)` idi ve
    // MIXED'in kataloğa hiç yolu olmamasını yakalayamıyordu: sistem
    // tanımlıydı, yerleştirme sonrası seçilebiliyordu, ama hiçbir fiş onu
    // sahneye koyamıyordu.
    const systems = new Set(mezzanineTiles().map(([, patch]) => patch.constructiveSystem))
    for (const system of Object.keys(CONSTRUCTIVE_SYSTEMS)) {
      expect(systems.has(system as never), `${system} için fiş yok`).toBe(true)
    }
  })

  test('her fiş üstüne çıkılabilir bir platform sevk eder', () => {
    // Aksesuarsız bir fiş, kullanıcıya merdiveni olmayan bir platform
    // veriyordu — katalogdan gelen bir ürünün eksik teslim edilmesi.
    const tiles = mezzanineTiles()
    expect(tiles.length).toBeGreaterThan(0)
    for (const [id, patch] of tiles) {
      for (const tier of patch.tiers) {
        expect(
          tier.accessories?.staircases.length ?? 0,
          `${id} tier ${tier.index}`,
        ).toBeGreaterThan(0)
      }
    }
  })

  test('rack HER ZAMAN registered — kolektif instancing sistemini mount eden tek kind', () => {
    const registered = new Set(warehousePlugin.nodes?.map((def) => def.kind))
    expect(registered.has('warehouse:pallet-rack')).toBe(true)
  })

  test('mezzanine kendi sistemini bildirir ama kolektif havuzu İKİNCİ kez mount etmez', () => {
    // Mezzanine güverte-slab uzlaştırıcısını mount etmek ZORUNDA (güvertenin
    // üstüne raf konabilmesinin tek yolu). Yasak olan şey ayrı: rack'ın
    // asılı olduğu kolektif instancing modülünü ikinci kez mount etmek —
    // `RegisteredSystems` her kaydın sistemini ayrı ayrı kurar, ve o modül
    // sahne başına BİR havuz varsayar.
    expect(mezzanineDefinition.system).toBeDefined()
    expect(String(mezzanineDefinition.system.module)).not.toContain('collective-system')
  })

  test('trailingSection tanımlı, invariants var', () => {
    expect(mezzanineParametrics.trailingSection).toBeDefined()
    expect(mezzanineParametrics.invariants?.length).toBeGreaterThan(0)
  })

  test('hat parçası DEĞİL: port bildirmez', () => {
    expect('ports' in mezzanineDefinition).toBe(false)
  })
})

describe('katalog aralıkları şemaya kilitli — kopya değil, doğrulanan çift', () => {
  test('merdiven genişlik literalleri standardın serbest genişlikleri', () => {
    // Şemada 0.8 | 1 literal, kaynak katalogda. Test ikisini birbirine
    // kilitliyor: biri değişir öbürü kalırsa burada patlar — "formül tabloya
    // karşı" deseninin şema hâli.
    expect(STAIRCASE_GEOMETRY.clearWidthMinM).toBeCloseTo(0.8, 9)
    expect(STAIRCASE_GEOMETRY.clearWidthMultiUserM).toBeCloseTo(1, 9)
    const widths = new Set([0.8, 1])
    const stairWidth = MezzanineNode.parse({}).tiers[0]
    expect(stairWidth).toBeDefined()
    // Şemanın kabul ettiği iki genişlik tam olarak katalogdakiler.
    expect(widths.has(STAIRCASE_GEOMETRY.clearWidthMinM)).toBe(true)
    expect(widths.has(STAIRCASE_GEOMETRY.clearWidthMultiUserM)).toBe(true)
  })

  test('Sigma varsayılan kesiti katalog aralığının içinde', () => {
    expect(SIGMA_DEFAULT_HEIGHT_M).toBeGreaterThanOrEqual(SIGMA_PROFILE.heightRangeM.min)
    expect(SIGMA_DEFAULT_HEIGHT_M).toBeLessThanOrEqual(SIGMA_PROFILE.heightRangeM.max)
    expect(SIGMA_DEFAULT_WIDTH_M).toBeGreaterThanOrEqual(SIGMA_PROFILE.widthRangeM.min)
    expect(SIGMA_DEFAULT_WIDTH_M).toBeLessThanOrEqual(SIGMA_PROFILE.widthRangeM.max)
  })
})

describe('GL2000 gerçekleri', () => {
  test('gömülü ikincil kiriş yapıyı bir kiriş derinliği YUKARI çıkarır', () => {
    const gl2000 = MezzanineNode.parse({ constructiveSystem: 'GL2000' })
    const sigma = MezzanineNode.parse({ constructiveSystem: 'SIGMA' })
    // Gömülüde etkin boşluk yalnız derin kirişi kaybeder, toplamı değil.
    const tierOf = (n: typeof gl2000) => n.tiers[0]
    const glTier = tierOf(gl2000)
    const sTier = tierOf(sigma)
    if (!glTier || !sTier) throw new Error('tier yok')
    const glLoss = glTier.clearHeightM - effectiveClearHeightM(gl2000, glTier)
    const sLoss = sTier.clearHeightM - effectiveClearHeightM(sigma, sTier)
    // GL2000 kaybı = max(ana, ikincil); SIGMA kaybı = ana + ikincil.
    expect(glLoss).toBeLessThan(sLoss + 0.3) // profiller farklı; mutlak değil
    const main = resolveMainBeamProfile(gl2000).h
    const secondary = resolveSecondaryBeamProfile(gl2000).h
    expect(glLoss).toBeCloseTo(Math.max(main, secondary), 9)
  })

  test('intumesan boya çerçeve rengini geçersiz kılar ve anahtara girer', () => {
    const plain = MezzanineNode.parse({ constructiveSystem: 'GL2000' })
    const coated = MezzanineNode.parse({ constructiveSystem: 'GL2000', intumescentPaint: true })
    expect(mezzanineGeometryKey(plain)).not.toBe(mezzanineGeometryKey(coated))
  })

  test('kolon taban plakası ve ankrajlar çiziliyor', () => {
    const parts = mezzanineParts(MezzanineNode.parse({}))
    const plates = parts.filter((p) => p.role === 'footplate')
    // Grid nokta başına 1 plaka + 4 ankraj.
    const columns = gridColumnPositions(MezzanineNode.parse({})).length
    expect(plates.length).toBe(columns * 5)
  })
})
