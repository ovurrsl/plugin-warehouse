import { beforeEach, describe, expect, test } from 'bun:test'
import { clearConveyorGeometryCache } from '../conveyor/geometry-builder'
import { BENCH_VARIANTS, CASTOR_DIAMETER_M, TOP_THICKNESS_M } from './catalog'
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
    expect(legHeightM(fixed) - legHeightM(mobile)).toBeCloseTo(CASTOR_DIAMETER_M, 9)
  })

  test('ayak + tabla + teker tam olarak tabla kotunu veriyor', () => {
    // Zincir kapanmazsa masa ya havada durur ya zemine gömülür.
    const node = bench({ variant: 'mobile-workbench' })
    expect(legHeightM(node) + TOP_THICKNESS_M + CASTOR_DIAMETER_M).toBeCloseTo(worktopYM(node), 9)
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
