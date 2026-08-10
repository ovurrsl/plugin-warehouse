import { describe, expect, test } from 'bun:test'
import type { GeometryContext } from '@pascal-app/core'
import { CATALOG_ITEMS } from '../catalog'
import { boxesOverlap, occupiedVolumes, toWorldBox } from '../clash'
import { clearConveyorGeometryCache } from '../conveyor/geometry-builder'
import { warehouseCatalogPanel, warehousePlugin } from '../index'
import { resetStatsIndex, sceneStats } from '../stats'
import {
  BAY_SIDE_CLEARANCE_M,
  CHANNEL_PROFILE_HEIGHT_M,
  CHANNEL_PROFILE_WIDTH_M,
  CLEARANCE_TABLE,
  DEFAULT_GRADIENT,
  DYNAMIC_BEAM_HEIGHT_M,
  MAX_PALLETS_DEEP,
  ROLLER_OVER_PALLET_M,
  ROLLER_PITCH_STEP_M,
  UPRIGHT_WIDTH_M,
} from './catalog'
import { liveRackingDefinition } from './definition'
import { buildLiveRackingFloorplan } from './floorplan'
import { getLiveRackingGeometry, liveRackingGeometryKey } from './geometry'
import { resetSeamIndex, snapToNeighbourSeam } from './magnet'
import {
  assignedSkuCount,
  bayWidthM,
  channelDepthM,
  channelDropM,
  channelPitchM,
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
import { hasRightNeighbour, resetNeighbourIndex, rightNeighbourPosition } from './neighbours'
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
  /**
   * İki yönlü kapsama — rafın tablosunun canlı raf hâli, ve HER İKİ katmanda
   * ayrı ayrı.
   *
   * İkinci katmanın kendi turu olmasının sebebi ölçülmüş bir eksik rapordu:
   * akış donanımının tamamı (makara hattı, bölünmüş makara, tutucu) yalnız
   * yakın katmanda üretiliyor, ama anahtar bu alanları katmandan bağımsız
   * yazıyordu — uzaktaki iki kanal birebir aynı şeridi çiziyor, iki ayrı
   * buffer tutuyordu. Yalnız `'full'` üzerinden koşan bir tablo bunu göremez,
   * çünkü orada üç alan da gerçekten mesh'i değiştiriyor.
   */
  const buildFresh = (target: LiveRackingNode, detail: 'full' | 'simple'): Float32Array => {
    clearConveyorGeometryCache()
    const geometry = getLiveRackingGeometry(target, detail)
    // Konum VE renk: boya tek bir vertex kımıldatmıyor ama mesh'i
    // değiştiriyor — renkler vertex attribute'unda.
    const buffers = (['position', 'color'] as const).map(
      (name) => geometry.getAttribute(name).array as ArrayLike<number>,
    )
    const combined = new Float32Array(buffers.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of buffers) {
      combined.set(Float32Array.from(part), offset)
      offset += part.length
    }
    return combined
  }

  const sameMesh = (a: Float32Array, b: Float32Array) =>
    a.length === b.length && a.every((value, index) => value === b[index])

  /**
   * `[etiket, taban yaması, değişken yaması]`.
   *
   * Hangi satırın hangi yöne düştüğü tabloda YAZILI DEĞİL, ölçülüyor: aynı
   * satır `'full'`de mesh'i değiştirip `'simple'`da değiştirmeyebilir ve
   * anahtarın da tam olarak öyle davranması gerekiyor.
   */
  const CASES: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ['variant', {}, { variant: 'LIFO' }],
    ['palletPreset', {}, { palletPreset: 'euro-1200x1200' }],
    ['palletsDeep', {}, { palletsDeep: 9 }],
    ['levels', {}, { levels: 5 }],
    ['firstLevelClear', {}, { firstLevelClear: 1.9 }],
    // Zemin seviyesi transpalet katı `firstLevelClear`i HİÇ okumuyor.
    ['firstLevelClear (zemin katı)', { floorSetPalletTruckLevel: true }, { firstLevelClear: 1.9 }],
    ['levelClear', {}, { levelClear: 1.9 }],
    // Tek katlı kanalda "katlar arası" diye bir şey yok.
    ['levelClear (tek kat)', { levels: 1 }, { levelClear: 1.9 }],
    ['gradient', {}, { gradient: 0.05 }],
    ['rollerPitch', {}, { rollerPitch: 0.15 }],
    ['withRetainers', {}, { withRetainers: true }],
    ['splitRollers', {}, { splitRollers: true }],
    ['intermediateRetainers (derin)', { palletsDeep: 18 }, { intermediateRetainers: true }],
    ['intermediateRetainers (eşiğin altında)', { palletsDeep: 8 }, { intermediateRetainers: true }],
    ['hingedChannels', {}, { hingedChannels: true }],
    ['floorSetPalletTruckLevel', {}, { floorSetPalletTruckLevel: true }],
    ['cladRack', {}, { cladRack: true }],
    ['uprightColor', {}, { uprightColor: '#00ff00' }],
    ['beamColor', {}, { beamColor: '#ff00ff' }],
    // Tek bir vertex bile kımıldatmayanlar: kimlik, yerleşim ve kapasite
    // metadata'sı. Negatif yarı boş bırakılırsa test yalnız "anahtar yeterince
    // büyük mü" diye sorar, ve onu geçmenin en ucuz yolu her alanı yazmaktır.
    ['skus', {}, { skus: ['SKU-1'] }],
    ['name', {}, { name: 'Kanal 3' }],
    ['position', {}, { position: [12, 0, 4] }],
    ['rotation', {}, { rotation: [0, Math.PI / 2, 0] }],
    ['supportSlabId', {}, { supportSlabId: 'slab_abcdefgh' }],
  ]

  test('her katmanda: mesh’i değiştiren her girdi anahtarı da değiştirir, değiştirmeyen değiştirmez', () => {
    for (const detail of ['full', 'simple'] as const) {
      for (const [label, basePatch, variantPatch] of CASES) {
        const base = node(basePatch)
        const variant = node({ ...basePatch, ...variantPatch })
        const changesMesh = !sameMesh(buildFresh(base, detail), buildFresh(variant, detail))
        const changesKey =
          liveRackingGeometryKey(variant, detail) !== liveRackingGeometryKey(base, detail)
        expect({ detail, label, changesKey }).toEqual({ detail, label, changesKey: changesMesh })
      }
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

  test('bake politikası replace, ve yerine geçecek çizici bildirilmiş', () => {
    /**
     * İkisi ayrı düşerse hata görünmez ve sonuç boş bir sahnedir: `replace`
     * host'a baked mesh'i GİZLETİYOR, yerine koyacak çiziciyi ise ikinci alan
     * veriyor. Politika var, çizici yoksa kanallar baked görünümde tümden
     * kaybolur — konsolda tek satır uyarı olmadan.
     */
    expect(liveRackingDefinition.bake).toBe('replace')
    expect(liveRackingDefinition.bakeReplaceRenderer?.module).toBeDefined()
  })

  /**
   * BEKÇİ: ayak izi ARALIK, dış genişlik değil.
   *
   * Test bu turda tersini iddia ediyordu — `bayWidthM` — ve doğru görünüyordu,
   * çünkü kanallar o gün çerçeve paylaşmıyordu. Paylaşınca dış genişlik iki
   * komşuyu tam bir dikme kadar bindiriyor, `spatialGridManager` bunu sert
   * çakışma okuyor, ve kanal bloğun yanına konamıyor. Selective rafın ve
   * drive-in'in bir kez yayınladığı hata.
   *
   * Farkın tam olarak bir dikme olduğu ayrıca sabitleniyor: "biraz daha küçük"
   * bir sayı da bu testi geçerdi ama hatları çakıştırmazdı.
   */
  test('taban izi ARALIK — dış genişlik iki komşuyu bindirirdi', () => {
    const resolver = liveRackingDefinition.capabilities.floorPlaced?.footprint
    if (!resolver) throw new Error('footprint yok')
    const channel = node()
    const dims = resolver(channel as never).dimensions
    expect(dims[0]).toBeCloseTo(channelPitchM(channel), 9)
    expect(dims[0]).toBeCloseTo(bayWidthM(channel) - UPRIGHT_WIDTH_M, 9)
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

/**
 * DENETİMİN BULDUĞU DÖRT KUSUR — hiçbiri ekranda hata üretmiyordu.
 */
describe('kanal, kafes ve fren gerçekten çizildikleri yerde', () => {
  const node = (overrides: Record<string, unknown> = {}) =>
    LiveRackingNode.parse({ id: 'live-racking_g', ...overrides })

  test('ilk katın altındaki açıklık TAM `firstLevelClear`', () => {
    /**
     * `levelExitYM` makara ÜST kotunu döndürüyor; kanalın kendi yapısı
     * (kiriş + profil = 220 mm) o kotun ALTINDA. Zemin-transpalet dalı bunu
     * doğru kuruyordu, öteki dal `structure`'ı eklemiyordu: kullanıcı 1,5 m
     * girdiğinde çizilen açıklık 1,28 m oluyordu.
     *
     * Asıl sessizlik panelde: aynı alan katalogun H ≥ 400 mm kuralına karşı
     * denetleniyor, yani 0,40 girildiğinde panel "uygun" der ve model 0,18 m
     * çizerdi — sınırın yarısından az.
     */
    for (const firstLevelClear of [0.4, 1.0, 1.5, 2.2]) {
      const lane = node({ firstLevelClear })
      const structure = DYNAMIC_BEAM_HEIGHT_M + CHANNEL_PROFILE_HEIGHT_M
      expect(levelExitYM(lane, 0) - structure, `${firstLevelClear} m`).toBeCloseTo(
        firstLevelClear,
        9,
      )
    }
    // Zemin-transpalet katında açıklık YOK ve olmaması kuralın ihlali değil.
    const floorSet = node({ floorSetPalletTruckLevel: true })
    expect(levelExitYM(floorSet, 0)).toBeCloseTo(
      DYNAMIC_BEAM_HEIGHT_M + CHANNEL_PROFILE_HEIGHT_M,
      9,
    )
  })

  test('çerçeve çaprazı gerçekten ÇAPRAZ — yatay basamak değil', () => {
    /**
     * Rolün adı `diagonal` idi ama üretilen kutu sabit y'de X boyunca yatay
     * bir çubuktu: uç çerçeveler kafes değil, düz basamaklı bir merdiven
     * olarak okunuyordu. Paketin öteki üç raf kind'ı gerçek kafes kuruyor.
     */
    const diagonals = liveRackingParts(node(), 'full').filter((part) => part.role === 'diagonal')
    expect(diagonals.length).toBeGreaterThan(2)
    const leaning = diagonals.filter((part) => (part.tiltX ?? 0) !== 0)
    expect(leaning.length, 'hiçbir çapraz yatmıyor').toBeGreaterThan(0)
    // Ve zikzak: ardışık çaprazlar zıt yöne yatıyor.
    const signs = leaning.map((part) => Math.sign(part.tiltX ?? 0))
    expect(new Set(signs).size, 'bütün çaprazlar aynı yöne yatıyor').toBe(2)
  })

  test('giriş ve çıkış yüzleri AÇIK — kafes uzun kenarlarda', () => {
    /**
     * Kullanıcının bildirdiği hata: "live rackın palet atılan yerleri
     * çaprazlar ile kapalı". Kafes giriş (+Z) ve çıkış (−Z) yüzlerine
     * kuruluyordu, yani forkliftin paleti soktuğu iki yüz çelikle örülüydü.
     *
     * Sessizliği şurada: kapalı bir yüz hata vermiyor, model kurulmaya devam
     * ediyor, kafes de kendi başına DOĞRU görünüyor — yalnız yanlış düzlemde.
     * Belirti ancak "bu palet oraya nasıl girecek" diye sorulunca çıkıyor.
     *
     * Bekçi iki yönlü, çünkü tek yön yetmez: çaprazları uzun kenara taşıyıp
     * uçlarda unutulmuş bir tanesini bırakmak da, hepsini silmek de ilk
     * iddiayı geçerdi.
     */
    const lane = node()
    const halfDepth = channelDepthM(lane) / 2
    const halfWidth = bayWidthM(lane) / 2
    const diagonals = liveRackingParts(lane, 'full').filter((part) => part.role === 'diagonal')

    // 1) Hiçbir kafes elemanı uç düzlemlerinde durmuyor.
    const onEndFace = diagonals.filter(
      (part) => Math.abs(Math.abs(part.center[2]) - halfDepth) < 0.05,
    )
    expect(onEndFace.length, 'giriş/çıkış yüzünde kafes var').toBe(0)

    // 2) Ve hepsi iki dikme hattının üstünde — yani gerçekten uzun kenarda.
    const sideLine = halfWidth - UPRIGHT_WIDTH_M / 2
    const offSide = diagonals.filter((part) => Math.abs(Math.abs(part.center[0]) - sideLine) > 0.05)
    expect(offSide.length, 'kafes dikme hattının dışında').toBe(0)

    // 3) Uç yüzler boş kalmıyor: paleti taşıyan kirişler orada duruyor. Kafesi
    //    kaldırıp yerine hiçbir şey koymamak yapıyı çözerdi.
    const beams = liveRackingParts(lane, 'full').filter((part) => part.role === 'beam')
    expect(beams.length, 'uç yüzlerde kiriş yok').toBeGreaterThan(0)
  })

  test('yan kafesin çaprazı gözünün içinde kalıyor', () => {
    /**
     * `atan2`'nin iki izdüşümünü takas etmek — palet rafında adı konmuş "kolay
     * hata" — çaprazı gözünün dışına savuruyor: çubuk kafesten taşıyor, uzun
     * kenar boyunca komşu gözlere giriyor ve alttaki zeminden çıkıyor. Hiçbir
     * hata vermiyor, yalnız çelik yanlış yerde duruyor.
     */
    const lane = node()
    const height = frameHeightM(lane)
    const halfDepth = channelDepthM(lane) / 2
    const leaning = liveRackingParts(lane, 'full').filter(
      (part) => part.role === 'diagonal' && (part.tiltX ?? 0) !== 0,
    )
    expect(leaning.length).toBeGreaterThan(0)

    for (const part of leaning) {
      const lean = part.tiltX ?? 0
      const length = part.size[1]
      // Yatırılmış çubuğun izdüşümleri: düşeyde cos, uzun eksende sin.
      const rise = Math.abs(length * Math.cos(lean))
      const run = Math.abs(length * Math.sin(lean))
      const top = part.center[1] + rise / 2
      const bottom = part.center[1] - rise / 2
      const far = Math.abs(part.center[2]) + run / 2

      expect(bottom, 'çapraz zeminin altına iniyor').toBeGreaterThan(-1e-9)
      expect(top, 'çapraz çerçevenin tepesini aşıyor').toBeLessThanOrEqual(height + 1e-9)
      expect(far, 'çapraz kanalın dışına taşıyor').toBeLessThanOrEqual(halfDepth + 1e-9)
    }
  })

  test('fren tamburu kanal profilinin DIŞINDA', () => {
    /**
     * Tamburun 35 mm'sinin 30 mm'si rayın içinde kalıyordu; dışarıda kalan
     * 5 mm üstten görünüşte üçte bir piksel ediyor, yani 32 tamburun hiçbiri
     * görünmüyordu. Dosyanın kendi yorumu tam tersini söylüyordu.
     */
    const lane = node()
    const parts = liveRackingParts(lane, 'full')
    const drums = parts.filter((part) => part.role === 'brake-drum')
    expect(drums.length).toBeGreaterThan(0)
    const profileOuter = rollerLengthM(lane) / 2 + CHANNEL_PROFILE_WIDTH_M / 2
    for (const drum of drums) {
      const inner = Math.abs(drum.center[0]) - drum.size[0] / 2
      expect(inner, 'tambur profilin içinde').toBeGreaterThanOrEqual(profileOuter - 1e-9)
    }
  })

  test('frenli makara sıradan makaranın İÇİNE girmiyor', () => {
    /**
     * Frenli makara bir makara POZİSYONUDUR, komşusunun içine sokulmuş ikinci
     * bir silindir değil. Ham Z ofseti ızgaraya oturmadığı için varsayılan
     * düğümde 40 çift çakışıyordu.
     */
    const parts = liveRackingParts(node(), 'full')
    const rollers = parts.filter((part) => part.role === 'roller')
    const brakes = parts.filter((part) => part.role === 'brake-roller')
    expect(brakes.length).toBeGreaterThan(0)

    let clashes = 0
    for (const brake of brakes) {
      for (const roller of rollers) {
        const hit = ([0, 1, 2] as const).every(
          (axis) =>
            Math.abs(brake.center[axis] - roller.center[axis]) <
            (brake.size[axis] + roller.size[axis]) / 2 - 1e-9,
        )
        if (hit) clashes += 1
      }
    }
    expect(clashes, 'frenli makara komşusunun içinde').toBe(0)
  })
})

/**
 * BEKÇİ: kanallar bir BLOK kuruyor — paylaşılan dikme hattı ve onu bulan
 * mıknatıs.
 *
 * Buradaki testlerin hiçbiri "doğru kod doğru" demiyor. Her biri belirli bir
 * YANLIŞ cevabın üretilmediğini söylüyor, ve o yanlış cevapların hepsi makul
 * görünüyor:
 *
 * - Aralık dış genişlik olsaydı, iki kanal yan yana dizilir ve ek yerinde
 *   90 mm arayla iki sıra dikme dururdu. Uzaktan doğru görünür.
 * - Kafes hattı izlemeseydi, dikme tek sıraya inerdi ama çapraz panelleri iki
 *   kalırdı — birbirine giren iki kafes.
 * - Geometri anahtarı komşuluğu taşımasaydı, bloğun içiyle ucu aynı mesh'i
 *   paylaşırdı ve sonucu sahnenin YÜKLENME SIRASI belirlerdi.
 * - Mıknatıs şekle bakmasaydı, farklı yükseklikteki iki kanalı hiçbir üreticinin
 *   birleştirmeyeceği bir ek yerine çekerdi.
 */
describe('paylaşılan dikme hattı ve mıknatıs', () => {
  const uprightXs = (n: ReturnType<typeof node>, omission?: { omitRight: boolean }) =>
    [
      ...new Set(
        liveRackingParts(n, 'full', omission)
          .filter((p) => p.role === 'upright')
          .map((p) => Number(p.center[0].toFixed(6))),
      ),
    ].sort((a, b) => a - b)

  const sceneOf = (...channels: ReturnType<typeof node>[]) => {
    resetNeighbourIndex()
    resetSeamIndex()
    const record: Record<string, unknown> = {}
    for (const channel of channels) record[channel.id] = channel
    return record
  }

  const at = (x: number, patch: Record<string, unknown> = {}) =>
    node({ position: [x, 0, 0], rotation: [0, 0, 0], ...patch })

  /**
   * Her şeyin dayandığı sayı. Aralık yanlışsa öteki testlerin hepsi hâlâ yeşil
   * yanabilir — komşuluk kendi aralığıyla tutarlı olur, yalnız çelik çakışmaz.
   */
  test('aralık iki dikme hattını GERÇEKTEN çakıştırıyor', () => {
    const left = at(0)
    const pitch = channelPitchM(left)
    const right = at(pitch)

    const leftPosts = uprightXs(left)
    const rightPosts = uprightXs(right).map((x) => x + pitch - pitch)
    // Sağdaki kanalın direkleri kendi yerel çerçevesinde; dünyaya taşı.
    const rightWorld = uprightXs(right).map((x) => Number((x + pitch).toFixed(6)))

    expect(leftPosts.length).toBe(2)
    expect(rightPosts.length).toBe(2)
    // Soldakinin SAĞ hattı ile sağdakinin SOL hattı aynı x'te.
    expect(rightWorld[0]).toBeCloseTo(leftPosts[1] as number, 9)
    // Ve bu, "yaklaşık" değil: fark tam olarak bir dikme genişliği kadar.
    expect(pitch).toBeCloseTo(bayWidthM(left) - UPRIGHT_WIDTH_M, 9)
  })

  test('bir aralıkta duran kanal komşusunu görüyor, bir dikme fazlada görmüyor', () => {
    const left = at(0)
    const pitch = channelPitchM(left)

    const abutting = sceneOf(left, at(pitch))
    expect(hasRightNeighbour(abutting, left.id)).toBe(true)

    // Dış genişlikte dizmek — yani eski, paylaşımsız aralık — komşu SAYILMAMALI.
    const apart = sceneOf(left, at(bayWidthM(left)))
    expect(hasRightNeighbour(apart, left.id)).toBe(false)
  })

  test('sağdaki kanal komşu saymıyor — paylaşım tek yönlü', () => {
    const left = at(0)
    const right = at(channelPitchM(left))
    const scene = sceneOf(left, right)
    // Sol hattını herkes kurar; sağ hattı yalnız en sağdaki kurar. Çift yönlü
    // olsaydı ikisi de sağ hattını atlar ve bloğun sağ ucu açık kalırdı.
    expect(hasRightNeighbour(scene, right.id)).toBe(false)
  })

  test('şekli tutmayan komşu paylaşmıyor', () => {
    const left = at(0)
    const pitch = channelPitchM(left)
    // Aynı yerde, ama farklı yükseklikte: dikmeler çakışmaz, hattı bırakmak
    // çeliği toparlamaz — açıkta bırakır.
    const taller = sceneOf(left, at(pitch, { levels: 6 }))
    expect(hasRightNeighbour(taller, left.id)).toBe(false)

    // Ve döndürülmüş bir komşu da: çerçeveleri kesişir, çakışmaz.
    const turned = sceneOf(left, at(pitch, { rotation: [0, Math.PI / 2, 0] }))
    expect(hasRightNeighbour(turned, left.id)).toBe(false)
  })

  test('iki bitişik kanal ÜÇ dikme hattı üretiyor, dört değil', () => {
    const left = at(0)
    const pitch = channelPitchM(left)
    const right = at(pitch)

    const lines = new Set<number>()
    for (const x of uprightXs(left, { omitRight: true })) lines.add(Number(x.toFixed(6)))
    for (const x of uprightXs(right, { omitRight: false }))
      lines.add(Number((x + pitch).toFixed(6)))

    expect([...lines].sort((a, b) => a - b).length).toBe(3)
  })

  test('kafes de hattı izliyor — tek sıra dikme, tek panel', () => {
    const channel = at(0)
    const both = liveRackingParts(channel, 'full').filter((p) => p.role === 'diagonal')
    const shared = liveRackingParts(channel, 'full', { omitRight: true }).filter(
      (p) => p.role === 'diagonal',
    )

    // Yarıya iniyor, ve kalanların hepsi SOL hatta.
    expect(shared.length).toBe(both.length / 2)
    const rightX = (bayWidthM(channel) - UPRIGHT_WIDTH_M) / 2
    for (const part of shared) {
      expect(part.center[0]).toBeCloseTo(-rightX, 9)
    }
  })

  /**
   * Yorumun işaret ettiği tuzak. Başlık kirişi iki hattı BAĞLIYOR; hattı
   * bırakmak kirişi de bıraktırsaydı, bloğun içindeki her kanalın üstü açık
   * kalır ve giydirme rafın çatısını taşıyacak hiçbir şey olmazdı.
   */
  test('giydirme rafın başlık kirişi paylaşımdan etkilenmiyor', () => {
    const clad = at(0, { cladRack: true })
    const beams = (omitRight: boolean) =>
      liveRackingParts(clad, 'full', { omitRight }).filter(
        (p) => p.role === 'beam' && p.size[1] === p.size[2],
      ).length

    expect(beams(true)).toBe(beams(false))
    expect(beams(true)).toBeGreaterThan(0)
  })

  test('geometri anahtarı komşuluğu taşıyor — iki yönlü', () => {
    const channel = at(0)
    expect(liveRackingGeometryKey(channel, 'full', { omitRight: true })).not.toBe(
      liveRackingGeometryKey(channel, 'full', { omitRight: false }),
    )
    // Ve bölmediği yerde bölmüyor: aynı komşuluk aynı anahtar.
    expect(liveRackingGeometryKey(channel, 'full', { omitRight: true })).toBe(
      liveRackingGeometryKey(channel, 'full', { omitRight: true }),
    )
    // Katman ile komşuluk BAĞIMSIZ eksenler; memo varyantı ikisini de taşımalı.
    expect(liveRackingGeometryKey(channel, 'simple', { omitRight: true })).not.toBe(
      liveRackingGeometryKey(channel, 'full', { omitRight: true }),
    )
  })

  test('mıknatıs ek yerine tam aralıkla oturuyor', () => {
    const anchor = at(0)
    const pitch = channelPitchM(anchor)
    const dragged = node({ position: [0, 0, 0], rotation: [0, 0, 0] })
    const scene = sceneOf(anchor)

    // 12 cm şaşı bırakılmış bir imleç — hizalama kılavuzunun penceresinden
    // geniş, mıknatıs yarıçapından dar.
    const snapped = snapToNeighbourSeam(dragged, [pitch + 0.12, 0, 0.05], [dragged.id], scene)
    expect(snapped).not.toBeNull()
    expect((snapped as [number, number, number])[0]).toBeCloseTo(pitch, 9)
    expect((snapped as [number, number, number])[2]).toBeCloseTo(0, 9)
  })

  test('mıknatıs yarıçapın dışına uzanmıyor', () => {
    const anchor = at(0)
    const pitch = channelPitchM(anchor)
    const dragged = node({ position: [0, 0, 0], rotation: [0, 0, 0] })
    const scene = sceneOf(anchor)

    expect(snapToNeighbourSeam(dragged, [pitch + 0.9, 0, 0], [dragged.id], scene)).toBeNull()
  })

  test('mıknatıs şekli tutmayan bloğa çekmiyor', () => {
    const anchor = at(0, { levels: 6 })
    const pitch = channelPitchM(anchor)
    const dragged = node({ position: [0, 0, 0], rotation: [0, 0, 0] })
    const scene = sceneOf(anchor)

    expect(snapToNeighbourSeam(dragged, [pitch + 0.1, 0, 0], [dragged.id], scene)).toBeNull()
  })

  test('mıknatıs kendine ve birlikte taşınana yapışmıyor', () => {
    const a = at(0)
    const pitch = channelPitchM(a)
    const b = at(pitch)
    const scene = sceneOf(a, b)

    // İkisi birlikte sürükleniyor: blok bir bütün olarak kımıldamalı, kanallar
    // birbirini çekmemeli.
    expect(snapToNeighbourSeam(a, [0.05, 0, 0], [a.id, b.id], scene)).toBeNull()
  })

  test('mıknatıs dolu yere çekmiyor', () => {
    const a = at(0)
    const pitch = channelPitchM(a)
    const b = at(pitch)
    const dragged = node({ position: [0, 0, 0], rotation: [0, 0, 0] })
    const scene = sceneOf(a, b)

    // İmleç a'nın sağ ek yerinin tam üstünde — ama orada b duruyor. Yapışırsa
    // üçüncü kanal ikincinin içine oturur ve blok bir kanal eksik görünür.
    expect(snapToNeighbourSeam(dragged, [pitch + 0.02, 0, 0], [dragged.id], scene)).toBeNull()
  })

  test('mıknatıs bloğun UCUNDAKİ boş ek yerine oturuyor', () => {
    const a = at(0)
    const pitch = channelPitchM(a)
    const b = at(pitch)
    const dragged = node({ position: [0, 0, 0], rotation: [0, 0, 0] })
    const scene = sceneOf(a, b)

    const snapped = snapToNeighbourSeam(dragged, [2 * pitch + 0.1, 0, 0.06], [dragged.id], scene)
    expect(snapped).not.toBeNull()
    expect((snapped as [number, number, number])[0]).toBeCloseTo(2 * pitch, 9)
  })

  /**
   * İşaret uzlaşımı: +Y dönüşü yerel +X'i dünya (cos, −sin)'e taşıyor. Ters
   * yazmak kanalı komşusunun YANLIŞ tarafına mıknatıslar ve neredeyse doğru
   * görünür — 90°'de fark yalnız Z'nin işareti.
   */
  test('döndürülmüş kanalın ek yeri kendi yerel +X ekseninde', () => {
    const turned = at(0, { rotation: [0, Math.PI / 2, 0] })
    const pitch = channelPitchM(turned)
    const [x, z] = rightNeighbourPosition(turned)

    expect(x).toBeCloseTo(0, 9)
    expect(z).toBeCloseTo(-pitch, 9)
  })
})
