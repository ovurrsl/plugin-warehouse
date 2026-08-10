import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { STAIRCASE_GEOMETRY } from './catalog'
import { buildMezzanineFloorplan } from './floorplan'
import { mezzanineGeometryKey } from './geometry'
import {
  doubleColumnOffsetM,
  gridColumnPositions,
  resolveColumnProfile,
  resolveTierElevations,
} from './metrics'
import { mezzanineParts } from './parts'
import { openingsOnEdge, outlineEdgeSpans, outlineEdges, tierVoidRects } from './railing'
import { emptyAccessories, MezzanineNode, type StaircaseSpec } from './schema'
import { type Rect, rectsOverlap, resolveSteps } from './stairs'

const stair = (patch: Partial<StaircaseSpec> = {}): StaircaseSpec => ({
  id: 'stair-A',
  placement: { mode: 'edge', edge: 'west', offsetM: 3 },
  widthM: 1,
  landing: 'turn180',
  railings: 2,
  steps: 'auto',
  ...patch,
})

function nodeWith(accessories: Partial<ReturnType<typeof emptyAccessories>>) {
  return MezzanineNode.parse({
    grid: { baysX: 4, baysY: 3, bayWidthM: 5, bayDepthM: 5 },
    tiers: [
      {
        index: 0,
        elevationM: 'auto',
        clearHeightM: 3,
        loadClass: 500,
        floorType: 'WOOD_CHIPBOARD_30',
        accessories: { ...emptyAccessories(), ...accessories },
      },
    ],
  })
}

describe('EN ISO 14122-3 merdiven matematiği', () => {
  test("'auto' basamak sayısı gerçek kot farkından çıkar ve standarda uyar", () => {
    // 3.03 m tırmanış (3 m boşluk + 30 mm yonga levha).
    const { geometry, issues } = resolveSteps(stair(), 3.03)
    expect(geometry.steps).toBe(Math.ceil(3.03 / 0.1875))
    expect(geometry.riseM).toBeLessThanOrEqual(STAIRCASE_GEOMETRY.riserMaxM)
    expect(geometry.treadDepthM).toBeGreaterThanOrEqual(STAIRCASE_GEOMETRY.treadDepthMinM)
    expect(issues).toHaveLength(0)
  })

  test('going + 2·rise standardın 600–660 mm bandında', () => {
    for (const delta of [1.5, 2.5, 3.03, 3.56, 4]) {
      const { geometry } = resolveSteps(stair(), delta)
      const band = geometry.goingM + 2 * geometry.riseM
      expect(band, `${delta} m`).toBeGreaterThanOrEqual(0.6 - 1e-9)
      expect(band, `${delta} m`).toBeLessThanOrEqual(0.66 + 1e-9)
    }
  })

  test('elle seçilen basamak sayısı REDDEDİLMEZ, uyarılır', () => {
    // Katalog ürünü 8 basamak, ama 3.03 m için 17 gerekiyor: rıht 379 mm.
    const { geometry, issues } = resolveSteps(stair({ steps: 8 }), 3.03)
    expect(geometry.steps).toBe(8)
    expect(issues.map((i) => i.code)).toContain('step-count-mismatch')
    expect(issues.map((i) => i.code)).toContain('riser-too-tall')
  })

  test('tek DÜZ kolun istisnası: 3 m değil 4 m', () => {
    // Standart kol başına 3000 mm veriyor ama kesintisiz düz bir kola
    // 4000 mm'ye kadar izin veriyor. Önceki sürüm istisnayı okumuyordu,
    // dolayısıyla meşru bir 3.5 m düz kol gereksiz yere uyarı alıyordu.
    const legal = resolveSteps(stair({ landing: 'continuous' }), 3.56)
    expect(legal.issues.map((i) => i.code)).not.toContain('landing-required')

    const tooTall = resolveSteps(stair({ landing: 'continuous' }), 4.4)
    expect(tooTall.issues.map((i) => i.code)).toContain('landing-required')

    const withLanding = resolveSteps(stair({ landing: 'turn180' }), 4.4)
    expect(withLanding.issues.map((i) => i.code)).not.toContain('landing-required')
  })

  test('15 basamaktan uzun merdiven otomatik kollara bölünür', () => {
    // Katalog hazır merdivenleri 15 basamağa kadar yayınlıyor; daha uzunu
    // ara sahanlıklarla bölünüyor. Kullanıcı "kesintisiz" dese bile.
    const long = resolveSteps(stair({ landing: 'continuous' }), 3.8)
    expect(long.geometry.steps).toBeGreaterThan(15)
    expect(long.geometry.flights).toBeGreaterThan(1)
    expect(long.geometry.autoSplit).toBe(true)
    expect(long.geometry.stepsPerFlight).toBeLessThanOrEqual(15)

    const short = resolveSteps(stair({ landing: 'continuous' }), 2.0)
    expect(short.geometry.flights).toBe(1)
    expect(short.geometry.autoSplit).toBe(false)
  })

  test('sahanlık merdiveni iki kola böler ve yatay uzanımı kısaltır', () => {
    const straight = resolveSteps(stair({ landing: 'continuous' }), 2.5)
    const turned = resolveSteps(stair({ landing: 'turn180' }), 2.5)
    expect(straight.geometry.flights).toBe(1)
    expect(turned.geometry.flights).toBe(2)
    expect(turned.geometry.runM).toBeLessThan(straight.geometry.runM)
  })
})

describe('döşeme boşluğu: CSG değil, panel dışlama', () => {
  test('merdiven boşlukla çakışan panelleri siler', () => {
    const without = mezzanineParts(nodeWith({}))
    const withStair = mezzanineParts(nodeWith({ staircases: [stair()] }))
    const floors = (parts: typeof without) => parts.filter((p) => p.role === 'floor').length
    expect(floors(withStair)).toBeLessThan(floors(without))
  })

  test('silinen panel sayısı sınırlı — bir merdiven döşemeyi boşaltmaz', () => {
    const withStair = mezzanineParts(nodeWith({ staircases: [stair()] }))
    const floors = withStair.filter((p) => p.role === 'floor').length
    // 4×3 = 12 panelden en fazla birkaçı düşer.
    expect(floors).toBeGreaterThanOrEqual(9)
    expect(floors).toBeLessThan(12)
  })

  test('boşluk dikdörtgeni gerçekten merdivenin yerinde', () => {
    const node = nodeWith({ staircases: [stair()] })
    const resolved = resolveTierElevations(node.tiers)
    const tier = resolved[0]
    if (!tier) throw new Error('tier yok')
    const rects = tierVoidRects(node, tier, tier.deckTopM - tier.resolvedElevationM)
    expect(rects).toHaveLength(1)
    // Batı kenarı: x ≈ −10 (4 göz × 5 m / 2).
    const rect = rects[0] as Rect
    expect(rect.x0).toBeLessThan(-9)
    expect(rect.x1).toBeGreaterThan(-11)
  })

  test('merdiven yoksa hiç boşluk yok', () => {
    const node = nodeWith({})
    const resolved = resolveTierElevations(node.tiers)
    const tier = resolved[0]
    if (!tier) throw new Error('tier yok')
    expect(tierVoidRects(node, tier, 3)).toHaveLength(0)
  })

  test('rectsOverlap: dokunma kesişme sayılmaz', () => {
    const a: Rect = { x0: 0, z0: 0, x1: 5, z1: 5 }
    expect(rectsOverlap(a, { x0: 5, z0: 0, x1: 10, z1: 5 })).toBe(false)
    expect(rectsOverlap(a, { x0: 4.9, z0: 0, x1: 10, z1: 5 })).toBe(true)
  })
})

describe('korkuluk: açıklıkların bir FONKSİYONU', () => {
  /** Üretim yolunun kendisi: anahat kenarı + o kenarın dolu parçaları. */
  const spansOn = (node: ReturnType<typeof nodeWith>, cardinal: 'north' | 'south') => {
    const tier = node.tiers[0]
    if (!tier) throw new Error('tier yok')
    const edge = outlineEdges(node).find((e) => e.cardinal === cardinal)
    if (!edge) throw new Error(`${cardinal} kenarı yok`)
    return outlineEdgeSpans(tier, edge)
  }

  test('aksesuarsız çevre kesintisiz — kenar başına tek dolu parça', () => {
    expect(spansOn(nodeWith({}), 'north')).toHaveLength(1)
  })

  test('kapı korkulukta açıklık açar — kenar ikiye bölünür', () => {
    const spans = spansOn(
      nodeWith({ swingGates: [{ edge: 'north', offsetM: 10, widthM: 0.75 }] }),
      'north',
    )
    expect(spans).toHaveLength(2)
    // Toplam dolu uzunluk = kenar − kapı genişliği.
    const filled = spans.reduce((sum, s) => sum + (s.toM - s.fromM), 0)
    expect(filled).toBeCloseTo(20 - 0.75, 6)
  })

  test('kenara oturan merdivenin ağzı da açıklıktır', () => {
    const node = nodeWith({ staircases: [stair()] })
    const tier = node.tiers[0]
    if (!tier) throw new Error('tier yok')
    expect(openingsOnEdge(tier, 'west')).toHaveLength(1)
    // Merdiven batıda; kuzey kenarı etkilenmez.
    expect(openingsOnEdge(tier, 'north')).toHaveLength(0)
  })

  test('üst üste binen iki açıklık TEK boşluk açar', () => {
    const node = nodeWith({
      swingGates: [{ edge: 'south', offsetM: 10, widthM: 1.5 }],
      safetyZones: [{ edge: 'south', offsetM: 10.5, widthM: 1.5 }],
    })
    const tier = node.tiers[0]
    if (!tier) throw new Error('tier yok')
    expect(openingsOnEdge(tier, 'south')).toHaveLength(1)
  })

  test('korkuluk parçaları gerçekten üretiliyor ve kapı onları azaltıyor', () => {
    const plain = mezzanineParts(nodeWith({})).filter((p) => p.role === 'kickboard').length
    const gated = mezzanineParts(
      nodeWith({ swingGates: [{ edge: 'north', offsetM: 10, widthM: 1.5 }] }),
    ).filter((p) => p.role === 'kickboard').length
    // Kapı kuzey kenarını ikiye böler: dört süpürgelik yerine beş.
    expect(plain).toBe(4)
    expect(gated).toBe(5)
  })
})

describe('aksesuarlar geometri anahtarında', () => {
  test('kapı eklemek anahtarı değiştirir — yoksa ekranda eski mesh kalırdı', () => {
    const plain = nodeWith({})
    const gated = nodeWith({ swingGates: [{ edge: 'north', offsetM: 10, widthM: 0.75 }] })
    expect(mezzanineGeometryKey(plain)).not.toBe(mezzanineGeometryKey(gated))
  })

  test('merdiveni TAŞIMAK anahtarı değiştirir', () => {
    const a = nodeWith({
      staircases: [stair({ placement: { mode: 'edge', edge: 'west', offsetM: 3 } })],
    })
    const b = nodeWith({
      staircases: [stair({ placement: { mode: 'edge', edge: 'west', offsetM: 8 } })],
    })
    expect(mezzanineGeometryKey(a)).not.toBe(mezzanineGeometryKey(b))
  })

  test('güvenlik bölgesi de anahtarda — korkuluğu deliyor', () => {
    const plain = nodeWith({})
    const zoned = nodeWith({ safetyZones: [{ edge: 'east', offsetM: 5, widthM: 1.5 }] })
    expect(mezzanineGeometryKey(plain)).not.toBe(mezzanineGeometryKey(zoned))
  })
})

describe('merdiven ve kapı parçaları', () => {
  test('merdiven basamak sayısı kadar basamak + KOL BAŞINA iki limon üretir', () => {
    const node = nodeWith({ staircases: [stair()] })
    const parts = mezzanineParts(node)
    const resolved = resolveTierElevations(node.tiers)
    const tier = resolved[0]
    if (!tier) throw new Error('tier yok')
    const { geometry } = resolveSteps(stair(), tier.deckTopM - tier.resolvedElevationM)
    expect(parts.filter((p) => p.role === 'stair-tread')).toHaveLength(geometry.steps)
    // Her kol kendi iki limonunu taşır — sahanlıklı merdivende dört.
    expect(parts.filter((p) => p.role === 'stair-stringer')).toHaveLength(2 * geometry.flights)
  })

  test('merdiven kolu KORKULUKSUZ bırakılmaz', () => {
    // Faz 3'e kadar `pushStaircase` yalnız basamak ve limon çiziyordu:
    // 3B'de açık kenarlı bir kol duruyordu, yayınlanabilir bir çıktı değil.
    const two = mezzanineParts(nodeWith({ staircases: [stair({ railings: 2 })] }))
    const one = mezzanineParts(nodeWith({ staircases: [stair({ railings: 1 })] }))
    const railCount = (parts: ReturnType<typeof mezzanineParts>) =>
      parts.filter((p) => p.role === 'railing').length

    expect(railCount(two)).toBeGreaterThan(railCount(one))
    // Tek korkuluklu kolda bile korkuluk VAR — 0 seçeneği yok.
    const bare = mezzanineParts(nodeWith({}))
    expect(railCount(one)).toBeGreaterThan(railCount(bare))
  })

  test('sahanlıklı merdiven gerçek bir platform çizer', () => {
    // `turn90`/`turn180` yalnız `flights = 2` deyip hiçbir platform
    // çizmiyordu: kullanıcı iki kol arasında boşluğa basıyordu.
    const withLanding = mezzanineParts(nodeWith({ staircases: [stair({ landing: 'turn180' })] }))
    const straight = mezzanineParts(nodeWith({ staircases: [stair({ landing: 'continuous' })] }))

    // Sahanlığın kendi rolü var: döşeme paneliyle aynı role konsaydı panel
    // sayısına karışır ve "boşluk kaç panel siliyor" cevaplanamazdı.
    expect(withLanding.filter((p) => p.role === 'stair-landing').length).toBeGreaterThan(0)
    // Tek düz kolda sahanlık yok — 15 basamağı aşmadığı sürece.
    const straightLandings = straight.filter((p) => p.role === 'stair-landing').length
    expect(straightLandings).toBeLessThan(
      withLanding.filter((p) => p.role === 'stair-landing').length + 1,
    )
  })

  test('limon kirişi ve küpeşte artık gerçekten EĞİK', () => {
    const parts = mezzanineParts(nodeWith({ staircases: [stair()] }))
    const stringers = parts.filter((p) => p.role === 'stair-stringer')
    expect(stringers.length).toBeGreaterThan(0)
    // Eğim olmadan limon kirişi basamakları takip etmez, dikey bir kutu olur.
    expect(stringers.every((p) => (p.tiltX ?? 0) !== 0)).toBe(true)
  })

  test('iki kapı tipi FARKLI geometri üretir', () => {
    // Önceki sürümde ikisi bayt-bayt aynı kutuydu: kullanıcı "kapı" ile
    // "palet kapısı" arasında seçim yapıyor ama model hiç değişmiyordu.
    const swing = mezzanineParts(
      nodeWith({ swingGates: [{ edge: 'north', offsetM: 5, widthM: 0.75 }] }),
    )
    // Yukarı-devrilir en az 1 m: palet kapısı, personel kapısı değil.
    const upOver = mezzanineParts(
      nodeWith({ upAndOverGates: [{ edge: 'north', offsetM: 5, widthM: 1.5 }] }),
    )

    // Kanat kapı: tek kanat + menteşe/kilit dikmesi + tampon.
    expect(swing.filter((p) => p.role === 'gate')).toHaveLength(1)
    expect(swing.filter((p) => p.role === 'gate-post').length).toBeGreaterThan(0)
    expect(swing.filter((p) => p.role === 'gate-pivot')).toHaveLength(0)

    // Yukarı-devrilir: iki kanat (dikey + palet üstü yatay) + sallanma mili.
    expect(upOver.filter((p) => p.role === 'gate')).toHaveLength(2)
    expect(upOver.filter((p) => p.role === 'gate-pivot')).toHaveLength(1)
    expect(upOver.filter((p) => p.role === 'gate-post')).toHaveLength(0)
  })

  test('yukarı-devrilir kapının yatay kanadı palet üstü açıklığı okur', () => {
    const node = nodeWith({
      upAndOverGates: [{ edge: 'north', offsetM: 5, widthM: 1.5 }],
    })
    const gates = mezzanineParts(node).filter((p) => p.role === 'gate')
    const heights = gates.map((p) => p.center[1]).sort((a, b) => a - b)
    // Yatay kanat dikey kanadın belirgin biçimde üstünde — `GATE_SPECS`in
    // palet üstü 300 mm serbest yüksekliği artık okunuyor.
    expect(heights[1]! - heights[0]!).toBeGreaterThan(0.3)
  })

  test('turn90 ile turn180 FARKLI döşeme boşluğu açar', () => {
    // İkisi de iki kollu ve derinlikleri aynı; ayrıldıkları yer ikinci
    // kolun nereye gittiği. Önceki sürümde ikisi de aynı dikdörtgeni
    // açıyordu, yani sahanlık tipi seçimi hiçbir şeyi değiştirmiyordu.
    // 15 basamağın ALTINDA kalan bir kot farkı: yoksa kesintisiz kol da
    // otomatik bölünür ve üçü de aynı derinliğe iner (o kural ayrı test).
    const delta = 2.0
    const continuous = resolveSteps(stair({ landing: 'continuous' }), delta).geometry
    const turn90 = resolveSteps(stair({ landing: 'turn90' }), delta).geometry
    const turn180 = resolveSteps(stair({ landing: 'turn180' }), delta).geometry

    // Derinlik: sahanlıklı olanlar birbirinin aynısı, tek kol daha uzun.
    expect(turn90.runM).toBeCloseTo(turn180.runM, 9)
    expect(continuous.runM).toBeGreaterThan(turn90.runM)

    // Yanal uzanım: üçü de ayrı.
    expect(turn180.lateralM).toBeGreaterThan(continuous.lateralM)
    expect(turn90.lateralM).toBeGreaterThan(turn180.lateralM)
  })

  test('güvenlik bölgesi kanat üretmez — zincir, kapı değil', () => {
    const node = nodeWith({ safetyZones: [{ edge: 'east', offsetM: 5, widthM: 1.5 }] })
    expect(mezzanineParts(node).filter((p) => p.role === 'gate')).toHaveLength(0)
  })
})

describe('merdiven istenen yere konabiliyor', () => {
  test('serbest yerleşim kenardan bağımsız — konum ve dönüş kullanıcının', () => {
    // Şema ve `stairOrigin` bunu baştan destekliyordu; eksik olan yalnız
    // arayüzdü, yani merdiven "istenen yere" konamıyordu çünkü UI sormuyordu.
    const free = stair({
      placement: { mode: 'xz', xM: 3.5, zM: -2, rotationDeg: 45 },
    })
    const parts = mezzanineParts(nodeWith({ staircases: [free] }))
    const treads = parts.filter((p) => p.role === 'stair-tread')
    expect(treads.length).toBeGreaterThan(0)
    // Dönüş parçalara geçiyor: 45° eksen hizalı bir kutuyla ifade edilemez.
    expect(treads.every((p) => (p.rotationY ?? 0) !== 0)).toBe(true)
  })

  test('serbest merdiven döşeme boşluğunu KENDİ yerinde açar', () => {
    const here = nodeWith({
      staircases: [stair({ placement: { mode: 'xz', xM: -6, zM: 4, rotationDeg: 0 } })],
    })
    const there = nodeWith({
      staircases: [stair({ placement: { mode: 'xz', xM: 6, zM: -4, rotationDeg: 0 } })],
    })
    const centres = (n: ReturnType<typeof nodeWith>) =>
      mezzanineParts(n)
        .filter((p) => p.role === 'floor')
        .map((p) => `${p.center[0].toFixed(2)},${p.center[2].toFixed(2)}`)
        .sort()
        .join('|')
    // İki farklı konum iki farklı panel kümesi siliyor.
    expect(centres(here)).not.toBe(centres(there))
  })
})

// ── Boşluk merdivenin gerçekten üstünde mi ───────────────────────────────────

describe('merdiven boşluğu merdivenin yerinde — origin’e simetrik DEĞİL', () => {
  /** Merdivene ait parçaların dünya çerçevesindeki XZ sınır kutusu. */
  const stairBounds = (node: MezzanineNode) => {
    const parts = mezzanineParts(node).filter(
      (part) =>
        part.role === 'stair-tread' ||
        part.role === 'stair-stringer' ||
        part.role === 'stair-landing',
    )
    expect(parts.length).toBeGreaterThan(0)
    let x0 = Number.POSITIVE_INFINITY
    let x1 = Number.NEGATIVE_INFINITY
    let z0 = Number.POSITIVE_INFINITY
    let z1 = Number.NEGATIVE_INFINITY
    for (const part of parts) {
      // Parçalar önce KENDİ ZY düzleminde eğiliyor, sonra yaw'lanıyor
      // (`emitPart`'ın sırası). Eğik limon kirişinin plandaki izdüşümü
      // kendi boyundan KISA; eğimi yok sayan bir ölçüm kolu olduğundan uzun
      // gösterir ve boşluğu haksız yere yetersiz ilan ederdi.
      const yaw = part.rotationY ?? 0
      const tilt = part.tiltX ?? 0
      const depth =
        Math.abs(Math.cos(tilt)) * part.size[2] + Math.abs(Math.sin(tilt)) * part.size[1]
      const hx = (Math.abs(Math.cos(yaw)) * part.size[0] + Math.abs(Math.sin(yaw)) * depth) / 2
      const hz = (Math.abs(Math.sin(yaw)) * part.size[0] + Math.abs(Math.cos(yaw)) * depth) / 2
      x0 = Math.min(x0, part.center[0] - hx)
      x1 = Math.max(x1, part.center[0] + hx)
      z0 = Math.min(z0, part.center[2] - hz)
      z1 = Math.max(z1, part.center[2] + hz)
    }
    return { x0, z0, x1, z1 }
  }

  const voidOf = (node: MezzanineNode) => {
    const resolved = resolveTierElevations(node.tiers)
    const tier = resolved[0]
    if (!tier) throw new Error('tier yok')
    const rects = tierVoidRects(node, tier, tier.deckTopM - tier.resolvedElevationM)
    expect(rects).toHaveLength(1)
    return rects[0] as Rect
  }

  const CASES: [string, Partial<StaircaseSpec>][] = [
    [
      'turn180, batı',
      { landing: 'turn180', placement: { mode: 'edge', edge: 'west', offsetM: 3 } },
    ],
    [
      'turn180, kuzey',
      { landing: 'turn180', placement: { mode: 'edge', edge: 'north', offsetM: 4 } },
    ],
    [
      'continuous, doğu',
      { landing: 'continuous', placement: { mode: 'edge', edge: 'east', offsetM: 5 } },
    ],
    [
      'turn90, güney',
      { landing: 'turn90', placement: { mode: 'edge', edge: 'south', offsetM: 6 } },
    ],
  ]

  for (const [label, patch] of CASES) {
    test(`${label}: boşluk merdivenin TAMAMINI kapsıyor`, () => {
      /**
       * Eski hâl dikdörtgeni origin'e SİMETRİK kuruyordu, oysa `flightFrames`
       * bütün kolları origin'in tek tarafına koyuyor. Varsayılan merdivende
       * boşluğun yarısı güvertenin dışında hiçbir paneli silmiyor, merdivenin
       * üst yarısı ise sağlam bir panelin altında kalıyordu. 5 m'lik
       * varsayılan göz ızgarası hatayı yutuyor — bu yüzden panel SAYAN bir
       * test onu göremiyordu; kapsama ölçülmek zorunda.
       */
      const node = nodeWith({ staircases: [stair(patch)] })
      const bounds = stairBounds(node)
      const rect = voidOf(node)
      const slack = 1e-6
      expect(rect.x0, `${label} x0`).toBeLessThanOrEqual(bounds.x0 + slack)
      expect(rect.x1, `${label} x1`).toBeGreaterThanOrEqual(bounds.x1 - slack)
      expect(rect.z0, `${label} z0`).toBeLessThanOrEqual(bounds.z0 + slack)
      expect(rect.z1, `${label} z1`).toBeGreaterThanOrEqual(bounds.z1 - slack)
    })
  }

  test('boşluk FAZLA da bildirmiyor — merdivenin yarım metresinden fazla dışına taşmıyor', () => {
    // Tek yönlü bekçi dikdörtgeni büyüterek yeşile çevrilebilir; 80 mm'lik
    // katalog açıklığı artı basamak bindirmesi 250 mm'yi geçmemeli.
    const node = nodeWith({ staircases: [stair()] })
    const bounds = stairBounds(node)
    const rect = voidOf(node)
    expect(bounds.x0 - rect.x0).toBeLessThan(0.25)
    expect(rect.x1 - bounds.x1).toBeLessThan(0.25)
    expect(bounds.z0 - rect.z0).toBeLessThan(0.25)
    expect(rect.z1 - bounds.z1).toBeLessThan(0.25)
  })
})

// ── Kolon kesiti: 3B ile plan aynı şeyi söylüyor mu ──────────────────────────

describe('kolon kesiti — ikiz kolon ve plan sembolü', () => {
  const CTX = {} as GeometryContext
  const SYSTEMS = ['SIGMA', 'GL2000', 'MIXED'] as const

  const columnNode = (system: (typeof SYSTEMS)[number], columnType: 'single' | 'double') =>
    MezzanineNode.parse({
      grid: { baysX: 2, baysY: 2, bayWidthM: 5, bayDepthM: 5 },
      constructiveSystem: system,
      columnType,
      tiers: [
        {
          index: 0,
          elevationM: 'auto',
          clearHeightM: 3,
          loadClass: 500,
          floorType: 'WOOD_CHIPBOARD_30',
          accessories: emptyAccessories(),
        },
      ],
    })

  for (const system of SYSTEMS) {
    test(`${system}: ikiz kolonun iki gövdesi iç içe geçmiyor`, () => {
      /**
       * Öteleme `b` ile, yani ÖTEKİ eksenin ölçüsüyle yapılıyordu. Varsayılan
       * SIGMA'da (h=300, b=110) ikinci kolon birincinin 190 mm içine giriyor,
       * yani profil derinliğinin %63'ü — iki ayrı kolon değil, 410 mm
       * derinliğinde tek bir kaynaşmış blok. HEA240'ta b>h olduğu için
       * tesadüfen 10 mm boşluk kalıyor ve hata görünmüyordu; tam da
       * VARSAYILAN sistemde patlıyordu.
       */
      const node = columnNode(system, 'double')
      const profile = resolveColumnProfile(node)
      const offset = doubleColumnOffsetM(profile)
      const columns = mezzanineParts(node).filter((part) => part.role === 'column')
      expect(columns.length).toBeGreaterThan(0)

      // Bir ızgara noktasındaki iki gövde: z ekseninde `offset` kadar ayrı.
      for (const point of gridColumnPositions(node)) {
        const near = columns.filter((c) => Math.abs(c.center[0] - point.x) < 1e-9)
        const half = profile.h / 2 + 1e-9
        const first = near.filter((c) => Math.abs(c.center[2] - point.z) < half)
        const second = near.filter((c) => Math.abs(c.center[2] - (point.z + offset)) < half)
        expect(first.length, `${system} birinci gövde`).toBeGreaterThan(0)
        expect(second.length, `${system} ikinci gövde`).toBeGreaterThan(0)
        const firstMax = Math.max(...first.map((c) => c.center[2] + c.size[2] / 2))
        const secondMin = Math.min(...second.map((c) => c.center[2] - c.size[2] / 2))
        expect(secondMin, `${system}: iki kolon iç içe`).toBeGreaterThanOrEqual(firstMax - 1e-9)
      }
    })

    for (const columnType of ['single', 'double'] as const) {
      test(`${system}/${columnType}: plan kolonu 3B ayak iziyle aynı`, () => {
        /**
         * Plan `max(h, b)`'yi KARE basıyordu: varsayılan SIGMA'da 300×300,
         * yani gerçek kolonun X yönünde 2,7 katı. 5 m'lik bir gözde plandan
         * raf yerleşimi ölçen biri her kolonda 190 mm fazla engel görüyordu —
         * üstelik dosyanın kendi başlığı "3B ile AYNI hesaplayıcılardan"
         * diyor.
         */
        const node = columnNode(system, columnType)
        const profile = resolveColumnProfile(node)
        const columns = mezzanineParts(node).filter((part) => part.role === 'column')
        const point = gridColumnPositions(node)[0]
        if (!point) throw new Error('kolon noktası bekleniyordu')

        // 3B: tek gövdenin ayak izi X'te `b`, Z'de `h`.
        const near = columns.filter(
          (c) =>
            Math.abs(c.center[0] - point.x) < 1e-9 &&
            Math.abs(c.center[2] - point.z) < profile.h / 2 + 1e-9,
        )
        const footX = Math.max(...near.map((c) => c.center[0] + c.size[0] / 2))
        const footZ = Math.max(...near.map((c) => c.center[2] + c.size[2] / 2))
        expect((footX - point.x) * 2).toBeCloseTo(profile.b, 9)
        expect((footZ - point.z) * 2).toBeCloseTo(profile.h, 9)

        const plan = buildMezzanineFloorplan(node, CTX)
        const rects = (plan?.kind === 'group' ? plan.children : []).filter(
          (child): child is Extract<FloorplanGeometry, { kind: 'rect' }> =>
            child.kind === 'rect' &&
            Math.abs(child.width - profile.b) + Math.abs(child.height - profile.h) < 1e-9,
        )
        const expected = gridColumnPositions(node).length * (columnType === 'double' ? 2 : 1)
        expect(rects.length, `${system}/${columnType} plan kolonu`).toBe(expected)
      })
    }
  }
})
