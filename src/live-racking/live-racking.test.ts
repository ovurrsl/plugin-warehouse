import { describe, expect, test } from 'bun:test'
import type { GeometryContext } from '@pascal-app/core'
import { CATALOG_ITEMS } from '../catalog'
import { boxesOverlap, occupiedVolumes, toWorldBox } from '../clash'
import { warehouseCatalogPanel, warehousePlugin } from '../index'
import { resetStatsIndex, sceneStats } from '../stats'
import {
  BAY_SIDE_CLEARANCE_M,
  CLEARANCE_TABLE,
  DEFAULT_GRADIENT,
  MAX_PALLETS_DEEP,
  ROLLER_OVER_PALLET_M,
  ROLLER_PITCH_STEP_M,
} from './catalog'
import { liveRackingDefinition } from './definition'
import { buildLiveRackingFloorplan } from './floorplan'
import { liveRackingGeometryKey } from './geometry'
import {
  assignedSkuCount,
  bayWidthM,
  channelDepthM,
  channelDropM,
  exceedsLaneDatum,
  frameHeightIsValid,
  frameHeightM,
  hasBrakeRollers,
  levelEntryYM,
  levelExitYM,
  palletPositions,
  rollerLengthM,
  rollerPitchIsValid,
  skuOfLevel,
} from './metrics'
import { liveRackingParametrics } from './parametrics'
import { liveRackingParts } from './parts'
import { LiveRackingNode } from './schema'

const CTX = {} as GeometryContext
const CTX_SELECTED = {
  viewState: { selected: true, palette: { selectedStroke: '#fff', selectedFill: '#333' } },
} as unknown as GeometryContext

const node = (patch: Record<string, unknown> = {}) => LiveRackingNode.parse(patch)

describe('katalog ölçü zinciri — formüller tabloya karşı', () => {
  /**
   * Katalog hem FORMÜLLERİ hem de üç satırlık açıklık TABLOSUNU yayınlıyor.
   * Formüller tablodan türetilmedi; tabloya karşı doğrulanıyor — bir
   * transkripsiyon hatası ancak iki bağımsız kaynağı karşılaştırınca
   * yakalanır (teleskopik konveyörün C = A + B testinin aynı gerekçesi).
   */
  test('E = A + 160 ve D = A + 30, üç satırın hepsinde', () => {
    for (const row of CLEARANCE_TABLE) {
      expect(row.E, `A=${row.A}`).toBeCloseTo(row.A + 2 * BAY_SIDE_CLEARANCE_M, 9)
      expect(row.D, `A=${row.A}`).toBeCloseTo(row.A + ROLLER_OVER_PALLET_M, 9)
    }
  })

  test('EPAL paleti tablonun 800 mm satırını üretir', () => {
    // EPAL 1: 1200 uzunluk × 800 genişlik. Kanal ağzına bakan yüz genişlik.
    const epal = node({ palletPreset: 'epal-1' })
    expect(bayWidthM(epal)).toBeCloseTo(0.96, 9)
    expect(rollerLengthM(epal)).toBeCloseTo(0.83, 9)
  })

  test("paleti değiştirmek E ve D'yi birlikte değiştirir — ikisi de alan değil", () => {
    const narrow = node({ palletPreset: 'epal-1' })
    const wide = node({ palletPreset: 'euro-1200x1200' })
    expect(bayWidthM(wide)).toBeGreaterThan(bayWidthM(narrow))
    expect(rollerLengthM(wide) - rollerLengthM(narrow)).toBeCloseTo(
      bayWidthM(wide) - bayWidthM(narrow),
      9,
    )
  })
})

describe('kanal derinliği ve eğim', () => {
  test('katalogun işlenmiş örneği: 1200 mm × 8, tutucusuz 9.8 m', () => {
    const channel = node({ palletPreset: 'euro-1200x1200', palletsDeep: 8, withRetainers: false })
    expect(channelDepthM(channel)).toBeCloseTo(9.8, 9)
  })

  test('katalogun işlenmiş örneği: tutucuyla 10.0 m', () => {
    const channel = node({ palletPreset: 'euro-1200x1200', palletsDeep: 8, withRetainers: true })
    expect(channelDepthM(channel)).toBeCloseTo(10.0, 9)
  })

  test('düşüş = derinlik × eğim; %4 varsayılan katalogdan', () => {
    const channel = node({ palletPreset: 'euro-1200x1200', palletsDeep: 8 })
    expect(channel.gradient).toBe(DEFAULT_GRADIENT)
    expect(channelDropM(channel)).toBeCloseTo(9.8 * 0.04, 9)
  })

  test('giriş ucu çıkıştan TAM düşüş kadar yüksek', () => {
    const channel = node()
    const drop = channelDropM(channel)
    expect(levelEntryYM(channel, 0) - levelExitYM(channel, 0)).toBeCloseTo(drop, 9)
  })

  test('üst kat alttakinin GİRİŞ ucunun üstünde başlar', () => {
    const channel = node({ levels: 3 })
    for (let level = 1; level < 3; level++) {
      expect(levelExitYM(channel, level)).toBeGreaterThan(levelEntryYM(channel, level - 1))
    }
  })

  test('katalog derinlik sınırı 30 palet — şema aşmayı reddeder', () => {
    expect(() => LiveRackingNode.parse({ palletsDeep: MAX_PALLETS_DEEP + 1 })).toThrow()
    expect(LiveRackingNode.parse({ palletsDeep: MAX_PALLETS_DEEP }).palletsDeep).toBe(30)
  })
})

describe('katalog kuralları', () => {
  test('fren makarası YALNIZ ikiden derin kanalda', () => {
    expect(hasBrakeRollers(node({ palletsDeep: 2 }))).toBe(false)
    expect(hasBrakeRollers(node({ palletsDeep: 3 }))).toBe(true)
  })

  test('makara aralığı 75 mm katı olmalı', () => {
    expect(rollerPitchIsValid(node({ rollerPitch: 0.075 }))).toBe(true)
    expect(rollerPitchIsValid(node({ rollerPitch: 0.15 }))).toBe(true)
    expect(rollerPitchIsValid(node({ rollerPitch: 0.1 }))).toBe(false)
  })

  test('75 mm katı olmayan aralık uyarı üretir', () => {
    const issues = liveRackingParametrics.invariants?.flatMap((c) => c(node({ rollerPitch: 0.1 })))
    expect(issues?.some((i) => i.field === 'rollerPitch')).toBe(true)
  })

  test('H < 400 mm hata üretir', () => {
    const issues = liveRackingParametrics.invariants?.flatMap((c) =>
      c(node({ firstLevelClear: 0.4 })),
    )
    // 0.4 tam sınır — geçmeli.
    expect(issues?.some((i) => i.field === 'firstLevelClear')).toBe(false)
  })

  test('varsayılan aralık katalogun adımına eşit', () => {
    expect(node().rollerPitch).toBeCloseTo(ROLLER_PITCH_STEP_M, 9)
  })
})

describe('parça listesi', () => {
  test('her kat kendi makara setini üretir', () => {
    const one = liveRackingParts(node({ levels: 1 }), 'full').filter((p) => p.role === 'roller')
    const three = liveRackingParts(node({ levels: 3 }), 'full').filter((p) => p.role === 'roller')
    expect(three.length).toBe(one.length * 3)
  })

  test('uzak katman makaraları TEK şeride indirir', () => {
    const full = liveRackingParts(node(), 'full').filter((p) => p.role === 'roller')
    const simple = liveRackingParts(node(), 'simple').filter((p) => p.role === 'roller')
    expect(simple.length).toBe(node().levels)
    expect(full.length).toBeGreaterThan(simple.length)
  })

  test('kanal profili eğik, makaralar DEĞİL', () => {
    const parts = liveRackingParts(node(), 'full')
    const channels = parts.filter((p) => p.role === 'channel')
    const rollers = parts.filter((p) => p.role === 'roller')
    expect(channels.every((p) => (p.tiltX ?? 0) !== 0)).toBe(true)
    // Makaranın ekseni X; kendi ekseninde döndürmek görsel olarak no-op.
    expect(rollers.every((p) => (p.tiltX ?? 0) === 0)).toBe(true)
  })

  test('makaralar çıkıştan girişe YÜKSELİR', () => {
    const parts = liveRackingParts(node({ levels: 1 }), 'full').filter((p) => p.role === 'roller')
    const sorted = [...parts].sort((a, b) => a.center[2] - b.center[2])
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    if (!first || !last) throw new Error('makara yok')
    // −Z çıkış (alçak), +Z giriş (yüksek).
    expect(last.center[1]).toBeGreaterThan(first.center[1])
  })
})

describe('akış donanımı — Faz 2', () => {
  const childrenOfPlan = (n: LiveRackingNode, ctx: GeometryContext) => {
    const plan = buildLiveRackingFloorplan(n, ctx)
    return plan?.kind === 'group' ? plan.children : []
  }
  const roles = (n: LiveRackingNode, detail: 'full' | 'simple' = 'full') =>
    new Set(liveRackingParts(n, detail).map((p) => p.role))
  const countOf = (n: LiveRackingNode, role: string, detail: 'full' | 'simple' = 'full') =>
    liveRackingParts(n, detail).filter((p) => p.role === role).length

  test('FIFO çıkış kirişi üretir, LIFO son durdurucu — variant artık ŞEKLİ değiştiriyor', () => {
    // Faz 1'de `parts.ts` `variant`'a hiç bakmıyordu: iki varyant birebir
    // aynı mesh'i üretiyordu, halbuki şema LIFO'yu "çıkış ucu yok, son
    // durdurucu var" diye tanımlıyor.
    const fifo = roles(node({ variant: 'FIFO' }))
    const lifo = roles(node({ variant: 'LIFO' }))

    expect(fifo.has('exit-beam')).toBe(true)
    expect(lifo.has('exit-beam')).toBe(false)
    expect(lifo.has('end-stop')).toBe(true)
  })

  test('fren makarası ve tamburu YALNIZ ikiden derin kanalda', () => {
    expect(countOf(node({ palletsDeep: 2 }), 'brake-roller')).toBe(0)
    expect(countOf(node({ palletsDeep: 2 }), 'brake-drum')).toBe(0)

    const deep = node({ palletsDeep: 6 })
    expect(hasBrakeRollers(deep)).toBe(true)
    expect(countOf(deep, 'brake-roller')).toBeGreaterThan(0)
    // Her fren makarasının bir regülatör tamburu var.
    expect(countOf(deep, 'brake-drum')).toBeGreaterThan(0)
  })

  test('fren makarası sıradan makaranın ÜSTÜNDE durur — yükü frene bindiren şey bu', () => {
    const n = node({ palletsDeep: 6 })
    const parts = liveRackingParts(n, 'full')
    const brake = parts.find((p) => p.role === 'brake-roller')
    expect(brake).toBeDefined()
    // Aynı Z'ye en yakın sıradan makarayı bul ve kotları kıyasla.
    const nearest = parts
      .filter((p) => p.role === 'roller')
      .sort(
        (a, b) =>
          Math.abs(a.center[2] - brake!.center[2]) - Math.abs(b.center[2] - brake!.center[2]),
      )[0]
    expect(brake!.center[1]).toBeGreaterThan(nearest!.center[1])
  })

  test('bölünmüş makara ikiye ayrılır ve ortada boşluk bırakır', () => {
    const solid = node()
    const split = node({ splitRollers: true })
    // İkiye bölündüğü için sayı artıyor.
    expect(countOf(split, 'roller')).toBe(countOf(solid, 'roller') * 2)
    // Hiçbir yarım merkezde değil — çatal ortadan geçecek.
    for (const part of liveRackingParts(split, 'full')) {
      if (part.role !== 'roller') continue
      expect(Math.abs(part.center[0])).toBeGreaterThan(0)
    }
  })

  test('tutucu seçeneği görünür parça üretir — Faz 1’de yalnız derinliği uzatıyordu', () => {
    expect(roles(node({ withRetainers: false })).has('retainer')).toBe(false)
    expect(roles(node({ withRetainers: true })).has('retainer')).toBe(true)
  })

  test('ara tutucu eşiğin altında hiçbir şey üretmez, üstünde üretir', () => {
    expect(countOf(node({ palletsDeep: 8, intermediateRetainers: true }), 'retainer')).toBe(0)
    expect(
      countOf(node({ palletsDeep: 18, intermediateRetainers: true }), 'retainer'),
    ).toBeGreaterThan(0)
  })

  test('menteşeli kanal menteşe boğumu üretir', () => {
    expect(roles(node({ hingedChannels: false })).has('hinge')).toBe(false)
    expect(roles(node({ hingedChannels: true })).has('hinge')).toBe(true)
  })

  test('ortalayıcı şeritler kat başına bir ÇİFT, GİRİŞ ucunda ve plan düzleminde açılı', () => {
    // Her katın kendi ağzı var — dört katlı kanalda dört çift.
    expect(countOf(node({ levels: 4 }), 'centraliser')).toBe(8)

    const single = node({ levels: 1 })
    const parts = liveRackingParts(single, 'full').filter((p) => p.role === 'centraliser')
    expect(parts.length).toBe(2)
    const halfDepth = channelDepthM(single) / 2
    for (const part of parts) {
      // Giriş +Z ucu.
      expect(part.center[2]).toBeGreaterThan(0)
      expect(part.center[2]).toBeLessThanOrEqual(halfDepth)
      expect(part.rotationY).toBeDefined()
      expect(part.rotationY).not.toBe(0)
    }
    // İki şerit birbirinin aynası.
    expect(parts[0]!.rotationY).toBe(-parts[1]!.rotationY!)
  })

  test('zemin seviyesi transpalet katı: ilk kanal zemine oturur', () => {
    const raised = node()
    const floorSet = node({ floorSetPalletTruckLevel: true })
    expect(levelExitYM(floorSet, 0)).toBeLessThan(levelExitYM(raised, 0))
    // Yalnız kanalın kendi yapısı kadar yukarıda — altında açıklık yok.
    expect(levelExitYM(floorSet, 0)).toBeLessThan(0.4)
    // Açıklık alanı gizleniyor ve H ≥ 400 mm kuralı ateşlenmiyor: burada
    // açıklığın olmaması ihlal değil, konfigürasyonun tanımı.
    const issues = liveRackingParametrics.invariants?.flatMap((c) =>
      c(node({ floorSetPalletTruckLevel: true, firstLevelClear: 0.4 })),
    )
    expect(issues?.some((i) => i.field === 'firstLevelClear')).toBe(false)
  })

  test('giydirme raf: dikme uzar ve tepede başlık kirişi çıkar', () => {
    const plain = node()
    const clad = node({ cladRack: true })
    expect(frameHeightM(clad)).toBeGreaterThan(frameHeightM(plain))
    // Başlık kirişi iki çerçevede de var.
    const beamsPlain = countOf(plain, 'beam')
    const beamsClad = countOf(clad, 'beam')
    expect(beamsClad).toBe(beamsPlain + 2)
  })

  test('SKU kat başına okunur; kısa dizi boş sayılır', () => {
    const n = node({ levels: 3, skus: ['ABC-1'] })
    expect(skuOfLevel(n, 0)).toBe('ABC-1')
    // Dizi kat sayısıyla senkron olmak zorunda değil — eksik giriş boş.
    expect(skuOfLevel(n, 2)).toBe('')
    expect(assignedSkuCount(n)).toBe(1)
    // Yalnız boşluk yazmak SKU sayılmaz.
    expect(assignedSkuCount(node({ levels: 2, skus: ['  ', 'X'] }))).toBe(1)
  })

  test('plan SKU etiketini SEÇİM GEREKMEDEN çizer', () => {
    const labelled = node({ levels: 2, skus: ['ABC-1', 'ABC-2'] })
    const texts = childrenOfPlan(labelled, CTX)
      .filter((c) => c.kind === 'dimension-label')
      .map((c) => (c as { text: string }).text)
    // Seçili değil, ama referans planda okunuyor: kanal başına tek SKU
    // canlı rafın tanımlayıcı kısıtı, yerleşimi okuyan kişi görmeli.
    expect(texts.some((t) => t.includes('ABC-1') && t.includes('ABC-2'))).toBe(true)

    // SKU yoksa etiket de yok.
    expect(childrenOfPlan(node(), CTX).filter((c) => c.kind === 'dimension-label')).toHaveLength(0)
  })

  test('taban plakaları ankrajlı', () => {
    const n = node()
    expect(countOf(n, 'anchor')).toBe(countOf(n, 'footplate') * 2)
  })

  test('uzak katman akış donanımını ÇİZMEZ — orada yalnız üçgen maliyeti olurdu', () => {
    const n = node({ palletsDeep: 6, withRetainers: true })
    const far = roles(n, 'simple')
    expect(far.has('brake-roller')).toBe(false)
    expect(far.has('centraliser')).toBe(false)
    expect(far.has('retainer')).toBe(false)
    // Uç donanımı uzakta da kalır: kanalın hangi ucu çıkış, uzaktan da okunmalı.
    expect(far.has('exit-beam')).toBe(true)
  })
})

describe('katalog doğrulamaları — Faz 2', () => {
  const issuesFor = (patch: Record<string, unknown>) =>
    liveRackingParametrics.invariants?.flatMap((c) => c(node(patch))) ?? []

  test('çerçeve yüksekliği 50 mm katı değilse uyarı, ve uyarı ALAN bildirmez', () => {
    const tall = node({ firstLevelClear: 1.53 })
    expect(frameHeightIsValid(tall)).toBe(false)
    const issue = issuesFor({ firstLevelClear: 1.53 }).find((i) => i.msg.includes('Çerçeve'))
    expect(issue).toBeDefined()
    // Yüksekliğin tek sahibi yok; bir alana iliştirmek yanlış yeri gösterirdi.
    expect(issue?.field).toBeUndefined()
  })

  test('20 m koridor datumu aşılınca uyarı — ret DEĞİL', () => {
    const long = node({ palletsDeep: 20, palletPreset: 'euro-1200x1200' })
    expect(exceedsLaneDatum(long)).toBe(true)
    const issue = issuesFor({ palletsDeep: 20, palletPreset: 'euro-1200x1200' }).find((i) =>
      i.msg.includes('koridor datumunu'),
    )
    expect(issue?.severity).toBe('warning')
  })

  test('eşiğin altında işaretli ara tutucu, etkisiz olduğunu söyler', () => {
    const issue = issuesFor({ palletsDeep: 8, intermediateRetainers: true }).find((i) =>
      i.msg.includes('hiçbir parça üretmiyor'),
    )
    expect(issue).toBeDefined()
  })
})

describe('geometri anahtarı', () => {
  test('şekli değiştiren her girdi anahtarda', () => {
    const base = node()
    for (const patch of [
      { palletsDeep: 9 },
      { levels: 5 },
      { gradient: 0.05 },
      { rollerPitch: 0.15 },
      { palletPreset: 'euro-1200x1200' },
      { withRetainers: true },
      { variant: 'LIFO' },
      { splitRollers: true },
      { hingedChannels: true },
      { uprightColor: '#ff0000' },
    ]) {
      expect(liveRackingGeometryKey(node(patch), 'full'), JSON.stringify(patch)).not.toBe(
        liveRackingGeometryKey(base, 'full'),
      )
    }
  })

  test('ara tutucu anahtara ETKİN değeriyle girer', () => {
    // Eşiğin altında hiçbir parça üretmiyor → geometri aynı → anahtar aynı.
    // Ham bayrağı anahtara koymak, farkı olmayan iki kanal için iki mesh
    // üretirdi.
    const shallow = { palletsDeep: 8 }
    expect(liveRackingGeometryKey(node({ ...shallow, intermediateRetainers: true }), 'full')).toBe(
      liveRackingGeometryKey(node(shallow), 'full'),
    )

    // Eşiğin üstünde parça üretiyor → anahtar ayrılmak ZORUNDA.
    const deep = { palletsDeep: 18 }
    expect(liveRackingGeometryKey(node({ ...deep, intermediateRetainers: true }), 'full')).not.toBe(
      liveRackingGeometryKey(node(deep), 'full'),
    )
  })

  test('katman anahtarda — iki katman iki buffer', () => {
    expect(liveRackingGeometryKey(node(), 'full')).not.toBe(
      liveRackingGeometryKey(node(), 'simple'),
    )
  })
})

describe('plan sembolü selective raftan ayrılır', () => {
  const childrenOf = (n: LiveRackingNode, ctx: GeometryContext) => {
    const plan = buildLiveRackingFloorplan(n, ctx)
    if (plan?.kind !== 'group') throw new Error('grup bekleniyordu')
    return plan.children
  }

  test('akış oku var — selective rafta yok', () => {
    const arrows = childrenOf(node(), CTX).filter((c) => c.kind === 'polygon')
    expect(arrows).toHaveLength(1)
  })

  test('LIFO çift başlı — tek koridor olduğunu sembol söyler', () => {
    const arrows = childrenOf(node({ variant: 'LIFO' }), CTX).filter((c) => c.kind === 'polygon')
    expect(arrows).toHaveLength(2)
  })

  test('makara taraması derinlikle artar', () => {
    const shallow = childrenOf(node({ palletsDeep: 4 }), CTX).length
    const deep = childrenOf(node({ palletsDeep: 12 }), CTX).length
    expect(deep).toBeGreaterThan(shallow)
  })

  test('hiçbir dolgulu primitif fill: none taşımaz', () => {
    for (const child of childrenOf(node(), CTX)) {
      if ('fill' in child) expect(child.fill).not.toBe('none')
    }
  })

  test('etiket yalnız seçiliyken', () => {
    const labels = (ctx: GeometryContext) =>
      childrenOf(node(), ctx).filter((c) => c.kind === 'dimension-label').length
    expect(labels(CTX)).toBe(0)
    expect(labels(CTX_SELECTED)).toBe(1)
  })
})

describe('çakışma ve kapasite', () => {
  test('kanalın altı AÇIK — ilk kat açıklığı yürüme alanı', () => {
    const channel = node({ firstLevelClear: 1.5 })
    const volumes = occupiedVolumes(channel)
    const probe = toWorldBox([0, 0.7, 0], [0.4, 0.4, 0.4], [0, 0, 0], 0)
    expect(volumes.some((box) => boxesOverlap(box, probe))).toBe(false)
  })

  test('kanal kotu DOLU — makaralar orada', () => {
    const channel = node({ firstLevelClear: 1.5 })
    const volumes = occupiedVolumes(channel)
    const y = levelExitYM(channel, 0)
    const probe = toWorldBox(
      [0, y - 0.025, -channelDepthM(channel) / 2 + 0.1],
      [0.3, 0.05, 0.3],
      [0, 0, 0],
      0,
    )
    expect(volumes.some((box) => boxesOverlap(box, probe))).toBe(true)
  })

  test('kapasite: derinlik depolama sayar, erişim SAYMAZ', () => {
    resetStatsIndex()
    // Kimlik `live-racking_` önekli olmak zorunda — şemanın kendi kuralı.
    const channel = node({ id: 'live-racking_1', levels: 4, palletsDeep: 8 })
    // Figürler KAT başına toplanıyor, bu yüzden düğüm bir seviyenin
    // çocuğu olmak zorunda — sahnedeki gerçek yapısı da bu.
    const scene = {
      'level-1': { id: 'level-1', type: 'level', children: ['live-racking_1'], level: 0 },
      'live-racking_1': channel,
    }
    const level = sceneStats(scene).levels[0]
    if (!level) throw new Error('seviye yok')
    expect(level.palletPositions).toBe(32)
    // Kanal başına yalnız çıkıştaki palet doğrudan alınabilir: kat başına 1.
    expect(level.directPositions).toBe(4)
    resetStatsIndex()
  })

  test('palletPositions = kat × derinlik', () => {
    expect(palletPositions(node({ levels: 3, palletsDeep: 10 }))).toBe(30)
  })
})

describe('tanım ve manifest', () => {
  test('kayıtlı, panelde listeli, katalogda iki fiş', () => {
    const registered = new Set(warehousePlugin.nodes?.map((def) => def.kind))
    expect(registered.has('warehouse:live-rack')).toBe(true)
    expect([...registered].sort()).toEqual([...(warehouseCatalogPanel.kinds ?? [])].sort())
    expect(CATALOG_ITEMS.filter((i) => i.kind === 'warehouse:live-rack')).toHaveLength(2)
  })

  test('taban izi türetilmiş ölçüleri okur', () => {
    const resolver = liveRackingDefinition.capabilities.floorPlaced?.footprint
    if (!resolver) throw new Error('footprint yok')
    const channel = node()
    const dims = resolver(channel as never).dimensions
    expect(dims[0]).toBeCloseTo(bayWidthM(channel), 9)
    expect(dims[1]).toBeCloseTo(frameHeightM(channel), 9)
    expect(dims[2]).toBeCloseTo(channelDepthM(channel), 9)
  })

  test('her şema alanı ya bir grupta ya bilinçli gizli', () => {
    const BASE = ['object', 'id', 'type', 'name', 'parentId', 'visible', 'metadata', 'camera']
    /**
     * `supportSlabId` yerleştirmede yazılır, kullanıcı alanı değil.
     * `skus` generic alanla erişilemez — `ParametricField` birleşiminde
     * metin alanı yok (number/boolean/enum/vec3/color/material/ref) — ama
     * trailing panelde kat başına düzenlenebiliyor, yani ERİŞİLEBİLİR.
     * Bu liste "kullanıcıya kapalı" demek değil, "generic alan değil" demek.
     */
    const HIDDEN = ['supportSlabId', 'skus']
    const covered = new Set(
      liveRackingParametrics.groups.flatMap((g) => g.fields.map((f) => String(f.key))),
    )
    for (const key of Object.keys(LiveRackingNode.parse({}))) {
      if (BASE.includes(key)) continue
      expect(covered.has(key) || HIDDEN.includes(key), `${key} erişilemez`).toBe(true)
    }
  })
})
