import { beforeEach, describe, expect, test } from 'bun:test'
import { clearConveyorGeometryCache } from '../conveyor/geometry-builder'
import { BENCH_VARIANTS, CASTOR_BUILD_HEIGHT_M, TOP_THICKNESS_M } from './catalog'
import { benchGeometryKey, getBenchGeometry } from './geometry'
import { depthM, legHeightM, overallHeightM, widthM, worktopYM } from './metrics'
import { benchParametrics } from './parametrics'
import { type BenchDetail, benchParts } from './parts'
import { BenchNode } from './schema'

const bench = (overrides: Record<string, unknown> = {}) =>
  BenchNode.parse({ id: 'bench_t', ...overrides })

/** Mesh'in ölçülebilir parmak izi: konum + renk tamponu. İki tezgâhın
 *  geometrisi ancak ikisi de aynıysa aynıdır. */
function fingerprint(node: BenchNode, detail: BenchDetail): string {
  clearConveyorGeometryCache()
  const geometry = getBenchGeometry(node, detail)
  const position = geometry.getAttribute('position').array
  const color = geometry.getAttribute('color').array
  return `${Array.from(position).join(',')}|${Array.from(color).join(',')}`
}

describe('varyant zarfları spec ile birebir', () => {
  test('altı varyantın da çözülmüş ölçüleri kataloğunkiyle aynı', () => {
    // Bunlar KAYNAK değerler (kullanıcının eski uygulamasının spec dosyaları).
    // Bir varyantın ölçüsü kaymışsa yerleşim planındaki masa yanlış yer kaplar
    // ve hiçbir yerde hata çıkmaz.
    for (const variant of Object.values(BENCH_VARIANTS)) {
      const node = bench({ variant: variant.id })
      expect(widthM(node), variant.label).toBeCloseTo(variant.widthM, 9)
      expect(worktopYM(node), variant.label).toBeCloseTo(variant.heightM, 9)
      expect(depthM(node), variant.label).toBeCloseTo(variant.depthM, 9)
    }
  })

  test('ölçü alanı BOŞ ile varyantın değerini elle yazmak aynı mesh’i verir', () => {
    /**
     * Anahtar ham `node.width` yazsaydı bu ikisi farklı anahtarlara çözülür
     * ve birebir aynı buffer iki kez saklanırdı — paylaşımı bedelsiz bölen,
     * CLAUDE.md'nin adlandırdığı yön.
     */
    const implicit = bench({ variant: 'eco' })
    const explicit = bench({
      variant: 'eco',
      width: BENCH_VARIANTS.eco.widthM,
      height: BENCH_VARIANTS.eco.heightM,
      depth: BENCH_VARIANTS.eco.depthM,
    })
    expect(benchGeometryKey(explicit, 'full')).toBe(benchGeometryKey(implicit, 'full'))
  })
})

describe('tabla kotu tekerden etkilenmiyor', () => {
  test('mobil tezgâhın tablası sabit tezgâhla AYNI kotta', () => {
    /**
     * Sessiz hata: tekeri ayağın altına eklemek. Masa çalışır, doğru görünür
     * — yalnız mobil tezgâh sabitinden 100 mm yüksek durur ve iki masa yan
     * yana konduğunda tablalar hizalanmaz. Kimse hata görmez, iş yüzeyi
     * basamaklı olur.
     */
    const mobile = bench({ variant: 'mobile-workbench' })
    const fixed = bench({
      variant: 'processing',
      height: BENCH_VARIANTS['mobile-workbench'].heightM,
    })

    expect(worktopYM(mobile)).toBeCloseTo(worktopYM(fixed), 9)
    // Fark ayağın boyunda: teker çapı kadar kısa.
    expect(legHeightM(fixed) - legHeightM(mobile)).toBeCloseTo(CASTOR_BUILD_HEIGHT_M, 9)
  })

  test('ayak + tabla + teker tam olarak tabla kotunu veriyor', () => {
    // Zincir kapanmazsa masa ya havada durur ya zemine gömülür.
    const node = bench({ variant: 'mobile-workbench' })
    expect(legHeightM(node) + TOP_THICKNESS_M + CASTOR_BUILD_HEIGHT_M).toBeCloseTo(
      worktopYM(node),
      9,
    )
  })
})

describe('toplam yükseklik üst yapıyı sayıyor', () => {
  test('raflı varyantın zarfı tabla kotundan YÜKSEK', () => {
    // `overallHeightM` yerleştirme zarfını ve çarpışmayı sürüyor. Tabla kotunu
    // döndürseydi masanın üstünden geçen her şey serbest sayılırdı.
    const shelved = bench({ variant: 'mail-order-packing' })
    expect(overallHeightM(shelved)).toBeGreaterThan(worktopYM(shelved) + 0.4)
  })

  test('üst yapısı olmayan varyantın zarfı tam tabla kotu', () => {
    const bare = bench({ variant: 'eco' })
    expect(overallHeightM(bare)).toBeCloseTo(worktopYM(bare), 9)
  })

  test('üst yapısı OLMAYAN ama ekran taşıyan varyantın zarfı ekranı sayıyor', () => {
    /**
     * Kaydedilen hata. Terazi tezgâhının `overhead` alanı `none`, yani zarf
     * tam tabla kotu bildiriliyordu — oysa ekran standı tablanın 670 mm
     * üstüne çıkıyor. Sessiz: masa doğru çiziliyor, yalnız üstünden geçen
     * konveyör serbest sayılıyor ve ekrana nişan alan tıklama arkadaki şeyi
     * seçiyor.
     */
    const scale = bench({ variant: 'weighing-scale' })
    expect(overallHeightM(scale)).toBeGreaterThan(worktopYM(scale) + 0.6)
  })
})

/**
 * ZARF BEKÇİSİ — bildirilen kutu ile çizilen geometri BİREBİR aynı.
 *
 * Yerleştirme zarfı, çarpışma, seçim kolideri ve sürükleme sınırı hepsi
 * `widthM × overallHeightM × depthM` okuyor. Bu üçlünün dışına taşan bir
 * parça ekranda hatasız görünür: yalnız duvara ilk değecek şey görünmez
 * olur, ve tıklama onun üstünden geçer.
 *
 * İki yön de ölçülüyor. Eksik bildirim (parça dışarıda) yukarıdaki hatayı
 * üretiyor; fazla bildirim (kutu boş yer kaplıyor) masaları birbirine
 * yaklaştırılamaz yapıyor — alet panosunda tam olarak bu vardı, zarf raf
 * kalınlığı kadar fazla bildiriliyordu.
 */
describe('çizilen geometri bildirilen kutunun İÇİNDE', () => {
  const OVERRIDES: Array<Record<string, unknown>> = [
    {},
    // Şemanın uçları: dar + sığ bir masa, sabit ölçülü donanımın (500 mm
    // terazi platformu, 320 mm ekran) taştığı yer.
    { width: 0.6, depth: 0.4, height: 0.6 },
    { width: 4, depth: 1.4, height: 1.2 },
    { overhead: 'shelf' },
    { overhead: 'toolboard' },
    { overhead: 'none' },
    { under: 'drawers' },
    { under: 'shelf' },
    { under: 'none' },
    { width: 0.6, depth: 0.4, overhead: 'shelf', under: 'drawers' },
  ]

  for (const variant of Object.values(BENCH_VARIANTS)) {
    for (const [index, overrides] of OVERRIDES.entries()) {
      for (const detail of ['full', 'simple'] as const) {
        test(`${variant.id} #${index} ${detail}: her parça kutunun içinde`, () => {
          const node = bench({ variant: variant.id, ...overrides })
          const halfWidth = widthM(node) / 2
          const halfDepth = depthM(node) / 2
          const height = overallHeightM(node)
          // Kayan nokta payı; 0,1 mm'nin altındaki taşma ölçüm gürültüsü.
          const slack = 1e-4

          for (const part of benchParts(node, detail)) {
            const [cx, cy, cz] = part.center
            const [sx, sy, sz] = part.size
            const where = `${part.role} @ ${cx.toFixed(3)},${cy.toFixed(3)},${cz.toFixed(3)}`

            expect(sx, `${where}: negatif genişlik`).toBeGreaterThan(0)
            expect(sy, `${where}: negatif yükseklik`).toBeGreaterThan(0)
            expect(sz, `${where}: negatif derinlik`).toBeGreaterThan(0)

            expect(
              Math.abs(cx) + sx / 2,
              `${where}: X'te taban izinin dışında`,
            ).toBeLessThanOrEqual(halfWidth + slack)
            expect(
              Math.abs(cz) + sz / 2,
              `${where}: Z'de taban izinin dışında`,
            ).toBeLessThanOrEqual(halfDepth + slack)
            expect(cy - sy / 2, `${where}: zeminin altında`).toBeGreaterThanOrEqual(-slack)
            expect(cy + sy / 2, `${where}: zarfın üstünde`).toBeLessThanOrEqual(height + slack)
          }
        })
      }
    }
  }

  test('zarf FAZLA da bildirmiyor — tepe gerçekten bir parçaya değiyor', () => {
    // Tek yönlü bir bekçi (yalnız "içinde mi") kutuyu büyüterek her zaman
    // yeşile çevrilebilir. Bu yön onu kapatıyor: `overallHeightM` en yüksek
    // parçanın tepesine BİREBİR oturmalı.
    for (const variant of Object.values(BENCH_VARIANTS)) {
      const node = bench({ variant: variant.id })
      const peak = Math.max(
        ...benchParts(node, 'full').map((part) => part.center[1] + part.size[1] / 2),
      )
      expect(overallHeightM(node), variant.label).toBeCloseTo(peak, 9)
    }
  })
})

/**
 * MASA YERE BASIYOR MU — ve iki katmanda da.
 *
 * Denetimin bulduğu üç hata da aynı sınıftan: ekranda hiçbir uyarı yok, masa
 * her hâlükârda çiziliyor, yalnız yanlış çiziliyor.
 */
describe('zincir zemine kadar kapanıyor', () => {
  test('tekerlekli tezgâh İKİ katmanda da yere basıyor', () => {
    /**
     * Bulunan hata: teker yalnız yakın katmanda çiziliyordu ama ayak tabanı
     * her katmanda teker yapı yüksekliği kadar yukarı itiliyordu. Uzak
     * katmanda bütün masa 100 mm havada uçuyordu — altında hiçbir şey yok.
     */
    for (const detail of ['full', 'simple'] as const) {
      const parts = benchParts(bench({ variant: 'mobile-workbench' }), detail)
      const minY = Math.min(...parts.map((part) => part.center[1] - part.size[1] / 2))
      expect(minY, `${detail}: masa havada`).toBeCloseTo(0, 6)
    }
  })

  test('teker AYAĞIN altında, arada boşluk yok', () => {
    // Teker tabla kenarından ölçülüyordu, ayak kendi profilinden: arada 13 mm
    // açık ara kalıyor, ayak boşlukta bitiyor, teker yanında asılı duruyordu.
    const parts = benchParts(bench({ variant: 'mobile-workbench' }), 'full')
    const legs = parts.filter((part) => part.role === 'leg')
    for (const castor of parts.filter((part) => part.role === 'castor')) {
      const above = legs.filter(
        (leg) =>
          Math.abs(leg.center[0] - castor.center[0]) < (leg.size[0] + castor.size[0]) / 2 &&
          Math.abs(leg.center[2] - castor.center[2]) < (leg.size[2] + castor.size[2]) / 2,
      )
      expect(above.length, 'tekerin üstünde ayak yok').toBeGreaterThan(0)
      // Ve zincir dikeyde de kapanıyor: tekerin üstü bir ayağın altına değiyor.
      const gap = Math.min(
        ...above.map(
          (leg) => leg.center[1] - leg.size[1] / 2 - (castor.center[1] + castor.size[1] / 2),
        ),
      )
      expect(gap, 'teker ile ayak arasında boşluk').toBeLessThanOrEqual(1e-9)
    }
  })

  test('tekerlekli ile tekerleksiz tezgâh uzak katmanda AYNI anahtara çözülmüyor', () => {
    // Anahtar `full && hasCastors` yazıyordu: simple katmanda teker bayrağı
    // anahtardan tamamen düşüyor, aynı zarftaki iki masa tek buffer'ı
    // paylaşıyor ve önbelleğe ilk giren kazanıyordu.
    const mobile = bench({ variant: 'mobile-workbench' })
    const fixed = bench({
      variant: 'eco',
      width: widthM(mobile),
      height: worktopYM(mobile),
      depth: depthM(mobile),
      under: 'drawers',
    })
    expect(benchGeometryKey(mobile, 'simple')).not.toBe(benchGeometryKey(fixed, 'simple'))
  })

  test('çekmece bloğu hiçbir ayağın içine girmiyor', () => {
    // 1,24 m'den dar her çekmeceli tezgâhta blok ön ayağın içine giriyordu;
    // şemanın alt sınırında yüzün sekizde biri ayağın içindeydi.
    for (const width of [0.6, 0.8, 1.0, 1.22, 1.6, 2.4]) {
      const parts = benchParts(bench({ variant: 'processing', width, under: 'drawers' }), 'full')
      const legs = parts.filter((part) => part.role === 'leg')
      for (const drawer of parts.filter((part) => part.role === 'drawer')) {
        for (const leg of legs) {
          const overlapX =
            Math.min(drawer.center[0] + drawer.size[0] / 2, leg.center[0] + leg.size[0] / 2) -
            Math.max(drawer.center[0] - drawer.size[0] / 2, leg.center[0] - leg.size[0] / 2)
          const overlapZ =
            Math.min(drawer.center[2] + drawer.size[2] / 2, leg.center[2] + leg.size[2] / 2) -
            Math.max(drawer.center[2] - drawer.size[2] / 2, leg.center[2] - leg.size[2] / 2)
          const overlapY =
            Math.min(drawer.center[1] + drawer.size[1] / 2, leg.center[1] + leg.size[1] / 2) -
            Math.max(drawer.center[1] - drawer.size[1] / 2, leg.center[1] - leg.size[1] / 2)
          const inside = overlapX > 1e-9 && overlapZ > 1e-9 && overlapY > 1e-9
          expect(inside, `${width} m: çekmece ayağın içinde`).toBe(false)
        }
      }
    }
  })

  test('terazi platformu tabla yüzeyiyle EŞ DÜZLEM değil', () => {
    // İki yukarı bakan yüz aynı kotta, 500×500 mm'lik alanda, aynı merged
    // geometride: z-savaşı. Deponun kendi kuralı (`cargo-constants.ts`) bunu
    // adlandırıyor ve orada da ofset kullanılıyor.
    const node = bench({ variant: 'weighing-scale' })
    const parts = benchParts(node, 'full')
    const scale = parts.find((part) => part.role === 'scale')
    const deck = parts.find((part) => part.role === 'top' || part.role === 'bed')
    if (!scale || !deck) throw new Error('platform ya da tabla yok')
    const scaleTop = scale.center[1] + scale.size[1] / 2
    const deckTop = deck.center[1] + deck.size[1] / 2
    expect(Math.abs(scaleTop - deckTop)).toBeGreaterThan(5e-4)
  })

  test('ekran standı uzak katmanda da duruyor', () => {
    // Terazi tezgâhının üst yapısı `none`: ekran düşünce siluet düz bir masaya
    // dönüşüyor ve nesne boyunun %43'ünü kaybediyordu.
    const node = bench({ variant: 'weighing-scale' })
    for (const detail of ['full', 'simple'] as const) {
      const peak = Math.max(
        ...benchParts(node, detail).map((part) => part.center[1] + part.size[1] / 2),
      )
      expect(peak, `${detail}: ekran kayboldu`).toBeCloseTo(overallHeightM(node), 6)
    }
  })
})

describe('ön yüz +Z — operatör orada duruyor', () => {
  const sideOf = (node: ReturnType<typeof bench>, role: string) => {
    const parts = benchParts(node, 'full').filter((part) => part.role === role)
    if (parts.length === 0) throw new Error(`${role} parçası yok`)
    return parts.map((part) => Math.sign(Number(part.center[2].toFixed(6))))
  }

  test('çekmece yüzleri ÖN kenarda', () => {
    // Arkaya konsalardı masa duvara dayandığı anda çekmece açılamazdı — ve
    // hiçbir test bunu söylemezdi, çünkü masa kusursuz çiziliyor.
    expect(sideOf(bench({ variant: 'processing', under: 'drawers' }), 'drawer')).toEqual([
      1, 1, 1, 1,
    ])
  })

  /** ÜST rafın Z işareti. `shelf` rolünü alt raf da kullanıyor (o ortada,
   *  işareti 0) — ayıran şey kot, o yüzden en yüksek olan seçiliyor. */
  const overheadSide = (node: ReturnType<typeof bench>) => {
    const shelves = benchParts(node, 'full').filter((part) => part.role === 'shelf')
    const highest = shelves.reduce((best, part) => (part.center[1] > best.center[1] ? part : best))
    return Math.sign(Number(highest.center[2].toFixed(6)))
  }

  test('üst yapı ve ekran ARKA kenarda', () => {
    // Üst raf öne gelseydi operatörün tam gözünün önünde dururdu.
    expect(overheadSide(bench({ variant: 'mail-order-packing' }))).toBe(-1)
    for (const side of sideOf(bench({ variant: 'weighing-scale' }), 'screen')) {
      expect(side).toBe(-1)
    }
    for (const side of sideOf(bench({ variant: 'processing' }), 'toolboard')) {
      expect(side).toBe(-1)
    }
  })

  test('çekmece ile üst yapı ZIT yüzlerde', () => {
    // Asıl kural bu: ikisi aynı yüze düşerse masanın önü diye bir şey kalmaz.
    const node = bench({ variant: 'processing', under: 'drawers', overhead: 'shelf' })
    expect(sideOf(node, 'drawer')[0]).toBe(-overheadSide(node))
  })
})

describe('makara yatağı tablanın YERİNE geçiyor', () => {
  test('makara sırtı tam tabla kotunda — üstünde değil', () => {
    /**
     * Kaydedilen hata: makaralar düz tablanın ÜSTÜNE diziliyordu. Çalışma
     * kotu 50 mm yükseliyor, yayımlanmış 920 mm zarf aşılıyor, ve makaralı
     * masa düz masanın yanına konduğunda yüzey basamaklanıyordu. Spec'in
     * cümlesi de tersini söylüyor: "built-in rollers **or** smooth
     * countertops".
     */
    const node = bench({ variant: 'dispatch-packing' })
    const rollers = benchParts(node, 'full').filter((part) => part.role === 'roller')
    expect(rollers.length).toBeGreaterThan(10)
    for (const roller of rollers) {
      expect(roller.center[1] + roller.size[1] / 2).toBeCloseTo(worktopYM(node), 9)
    }
  })

  test('makaralı masanın çalışma yüzeyi düz masanınkiyle AYNI kotta', () => {
    // Yan yana konan iki masanın yüzeyi hizalanmalı — tekerli/sabit masada
    // korunan invaryantın aynısı.
    const rollered = bench({ variant: 'dispatch-packing' })
    const flat = bench({
      variant: 'mail-order-packing',
      height: BENCH_VARIANTS['dispatch-packing'].heightM,
    })
    const topOf = (node: ReturnType<typeof bench>) =>
      Math.max(
        ...benchParts(node, 'full')
          .filter((part) => part.role === 'roller' || part.role === 'top')
          .map((part) => part.center[1] + part.size[1] / 2),
      )
    expect(topOf(rollered)).toBeCloseTo(topOf(flat), 9)
  })
})

describe('geometri anahtarı kapsaması — iki yönlü', () => {
  beforeEach(() => {
    clearConveyorGeometryCache()
  })

  /**
   * Her satır bir alanı oynatıyor. Test hangi yöne düşeceğini VARSAYMIYOR:
   * mesh'i ölçüp anahtarla karşılaştırıyor, ve ikisinin AYNI cevabı vermesini
   * şart koşuyor. Böylece hem eksik rapor (mesh değişti, anahtar değişmedi →
   * iki masa tek buffer'ı paylaşır, biri yanlış çizilir) hem aşırı rapor
   * (anahtar değişti, mesh değişmedi → önbellek boşuna bölünür) yakalanıyor.
   */
  const VARIANTS: Array<
    [label: string, base: Record<string, unknown>, changed: Record<string, unknown>]
  > = [
    ['genişlik', {}, { width: 1.9 }],
    ['tabla kotu', {}, { height: 1.05 }],
    ['derinlik', {}, { depth: 0.68 }],
    ['üst yapı: pano → raf', {}, { overhead: 'shelf' }],
    ['üst yapı: pano → yok', {}, { overhead: 'none' }],
    ['alt donanım: çekmece → raf', {}, { under: 'shelf' }],
    ['alt donanım: çekmece → yok', {}, { under: 'none' }],
    ['çerçeve rengi', {}, { frameColor: '#112233' }],
    ['ahşap rengi', {}, { timberColor: '#445566' }],
    ['makaralı tabla', { variant: 'eco' }, { variant: 'dispatch-packing' }],
    // Yalnız `top` oynatan satır: zarfı ve donanımı eşitlenmiş iki varyant,
    // aralarındaki TEK fark tabla tipi. Yukarıdaki satır bunu ölçemiyor —
    // orada ölçüler de değişiyor ve mesh zaten değişiyor, yani anahtar
    // `top`'u hiç taşımasa bile testi geçerdi.
    [
      'yalnız tabla tipi',
      { variant: 'eco', width: 1.4, height: 0.9, depth: 0.75, overhead: 'none', under: 'shelf' },
      { variant: 'dispatch-packing' },
    ],
    ['terazi platformu', { variant: 'eco' }, { variant: 'weighing-scale' }],
    ['tekerler', { variant: 'processing' }, { variant: 'mobile-workbench' }],
    // Mesh'e girmeyenler: adı ve konumu geometriyi kımıldatmıyor.
    ['ad', {}, { name: 'Paketleme 2' }],
    ['konum', {}, { position: [4, 0, -2] }],
    ['dönüş', {}, { rotation: [0, Math.PI / 2, 0] }],
  ]

  for (const detail of ['full', 'simple'] as const) {
    for (const [label, base, changed] of VARIANTS) {
      test(`${detail}: ${label} — anahtar ile mesh aynı cevabı veriyor`, () => {
        const before = bench(base)
        const after = bench({ ...base, ...changed })

        const meshChanged = fingerprint(before, detail) !== fingerprint(after, detail)
        const keyChanged = benchGeometryKey(before, detail) !== benchGeometryKey(after, detail)

        expect(keyChanged, `${label}: mesh ${meshChanged ? 'değişti' : 'değişmedi'}`).toBe(
          meshChanged,
        )
      })
    }
  }
})

describe('uzak katman siluetı koruyor', () => {
  test('simple katmanda tabla, dört ayak ve çevre kirişi duruyor', () => {
    // Uzak katman "daha az parça" demek, "tanınmaz şekil" değil. Tabla ya da
    // ayaklar düşerse masa 40 m'den havada duran bir levha olur.
    const parts = benchParts(bench({ variant: 'processing' }), 'simple')
    const roles = new Set(parts.map((part) => part.role))
    expect(roles.has('top')).toBe(true)
    expect(roles.has('leg')).toBe(true)
    expect(roles.has('apron')).toBe(true)
    expect(parts.filter((part) => part.role === 'leg')).toHaveLength(4)
  })

  test('simple katman yakın katmandan GERÇEKTEN daha az parça çiziyor', () => {
    // Aynı sayıda parça üreten bir "uzak" katman, LOD'un hiçbir şey
    // kazandırmadığı hâlde kazandırıyormuş gibi görünmesidir.
    const node = bench({ variant: 'dispatch-packing' })
    expect(benchParts(node, 'simple').length).toBeLessThan(benchParts(node, 'full').length)
  })
})

describe('varyant kimliği anahtarda YOK — aynı şekle çözülen iki varyant buffer paylaşır', () => {
  test('zarfı ve donanımı eşitlenen iki varyant aynı anahtara çözülüyor', () => {
    /**
     * Bilinçli tasarım: anahtar varyantın ADINI değil, varyantın ÇÖZÜLDÜĞÜ
     * şeyi yazıyor. `weighing-scale` ile `processing` aynı zarfta (1400×900×750
     * yapıldığında) hâlâ farklı — biri gömme terazi taşıyor — ama zarfı ve
     * donanımı birebir aynı olan iki satır tek mesh üretmeli.
     */
    const a = bench({
      variant: 'processing',
      width: 1.2,
      height: 0.9,
      depth: 0.6,
      under: 'none',
      overhead: 'none',
    })
    const b = bench({ variant: 'eco' })
    expect(benchGeometryKey(a, 'full')).toBe(benchGeometryKey(b, 'full'))
    expect(fingerprint(a, 'full')).toBe(fingerprint(b, 'full'))
  })
})

describe('ölçüler gerçekten ayarlanabilir', () => {
  const sizeFields = () => {
    const group = benchParametrics.groups.find((entry) => entry.label === 'Size')
    if (!group) throw new Error('Size grubu yok')
    return group.fields
  }

  test('üç ölçü de panelde kaydırıcı olarak var', () => {
    // Kullanıcının şartı: "masa boyutları ayarlanabilir olmalı." Şemada alan
    // olması yetmez — panelde görünmeyen bir alan kullanıcı için yoktur.
    const keys = sizeFields().map((field) => field.key)
    expect(keys).toEqual(['width', 'height', 'depth'])
  })

  test('panel sınırları şemanınkiyle BİREBİR aynı', () => {
    /**
     * Sessiz hata: panel şemadan geniş bir aralık gösterirse kullanıcı
     * kaydırıcıyı sonuna kadar sürer, Zod yazımı reddeder ve kaydırıcı geri
     * sıçrar — konsolda tek satır çıkmaz, panelde tek kelime yazmaz, masa
     * "bir yerde takılıyor" gibi görünür.
     *
     * Aralıklar şemadan OKUNUYOR, elle tekrarlanmıyor: bir gün şema sınırı
     * değişirse bu test onu takip eder, kopyalanmış bir sayıyı değil.
     */
    const shape = BenchNode.shape
    const bounds = {
      width: shape.width,
      height: shape.height,
      depth: shape.depth,
    }

    for (const field of sizeFields()) {
      if (field.kind !== 'number') throw new Error(`${field.key} sayı alanı değil`)
      const checks = (
        bounds[field.key as 'width' | 'height' | 'depth'] as unknown as {
          def: {
            innerType: { def: { checks?: Array<{ _zod: { def: Record<string, unknown> } }> } }
          }
        }
      ).def.innerType.def.checks
      const limits: Record<string, number> = {}
      for (const check of checks ?? []) {
        const def = check._zod.def as { check?: string; value?: number }
        if (def.check === 'greater_than' && typeof def.value === 'number') limits.min = def.value
        if (def.check === 'less_than' && typeof def.value === 'number') limits.max = def.value
      }
      expect(field.min, `${field.key} alt sınır`).toBe(limits.min)
      expect(field.max, `${field.key} üst sınır`).toBe(limits.max)
    }
  })

  test('ölçü değiştirmek gerçekten mesh’i değiştiriyor', () => {
    // Kaydırıcının var olması yetmez: alanın geometriye bağlı olduğunu da
    // ölçmek gerekiyor. Bağlı olmasaydı kaydırıcı çalışır, sahne kımıldamazdı.
    const narrow = bench({ variant: 'eco', width: 1.0 })
    const wide = bench({ variant: 'eco', width: 1.8 })
    expect(fingerprint(narrow, 'full')).not.toBe(fingerprint(wide, 'full'))
    expect(widthM(narrow)).toBeCloseTo(1.0, 9)
    expect(widthM(wide)).toBeCloseTo(1.8, 9)
  })
})
