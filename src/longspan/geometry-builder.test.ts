import { describe, expect, test } from 'bun:test'
import { longspanGeometryKey } from './geometry-builder'
import { type LongspanLevel, LongspanNode } from './schema'

/**
 * Şekil anahtarının kapsaması, İKİ yönde birden.
 *
 * Bir şekil önbelleği anahtarı kadar iyidir, ve anahtar birbirine hiç
 * benzemeyen iki şekilde bozulur:
 *
 *  - **Eksik raporlama** — bir alan vertex kımıldatıyor ama anahtarda yok, yani
 *    iki farklı bay tek mesh'i paylaşıyor ve alanı değiştirmek ekranda hiçbir
 *    şeyi değiştirmiyor. Sessiz, ve kullanıcı kontrolün bozuk olduğuna karar
 *    ediyor.
 *  - **Fazla raporlama** — alan anahtarda ama o ayarlarda hiçbir vertex
 *    kımıldatmıyor, yani bayt bayt aynı mesh iki kez kuruluyor. Bellek ve
 *    çizim çağrısı dışında görünmüyor.
 *
 * Deponun kuralı bu testi builder'ı okumaya tercih etmek.
 */

const PROBE = 'longspan_probe'

const bay = (patch: Partial<LongspanNode> = {}) => LongspanNode.parse({ id: PROBE, ...patch })

const key = (patch: Partial<LongspanNode> = {}) => longspanGeometryKey(bay(patch), 'full')

/** Varsayılan seviye listesi ve tek bir seviyenin şablonu — yamalar bunun
 *  üstüne yazılıyor, böylece "yalnız şu alan değişti" gerçekten doğru. */
const LEVELS: readonly LongspanLevel[] = bay().levels
const LEVEL: LongspanLevel = {
  elevation: 0.3,
  structure: 'beam-shelf',
  shelfKind: 'chipboard',
  panels: 1,
}

const withLevel = (index: number, patch: Partial<LongspanLevel>): LongspanLevel[] =>
  LEVELS.map((level, i) => (i === index ? { ...level, ...patch } : level))

describe('anahtarı DEĞİŞTİRMESİ gereken alanlar', () => {
  const moving: Array<[string, Partial<LongspanNode>]> = [
    ['bayLength', { bayLength: 2.3 }],
    ['frameDepth', { frameDepth: 0.8 }],
    ['frameHeight', { frameHeight: 3.5 }],
    ['uprightProfile', { uprightProfile: 'M-80MLD' }],
    ['beamProfile', { beamProfile: 'ZE-65' }],
    ['crossBracing', { crossBracing: true }],
    ['uprightColor', { uprightColor: '#123456' }],
    ['beamColor', { beamColor: '#123456' }],
    ['seviye sayısı', { levels: LEVELS.slice(0, 3) }],
    ['seviye yüksekliği', { levels: withLevel(0, { elevation: 0.5 }) }],
    ['seviye yapısı', { levels: withLevel(0, { structure: 'beam-only' }) }],
    ['seviye panel cinsi', { levels: withLevel(0, { shelfKind: 'mesh' }) }],
    ['seviye panel sayısı', { levels: withLevel(0, { panels: 3 }) }],
  ]

  const base = key()
  for (const [label, patch] of moving) {
    test(label, () => {
      expect(
        key(patch),
        `${label} anahtarı değiştirmiyor — iki farklı bay tek mesh paylaşır`,
      ).not.toBe(base)
    })
  }
})

describe('anahtarı DEĞİŞTİRMEMESİ gereken alanlar', () => {
  const base = key()
  const inert: Array<[string, Partial<LongspanNode>]> = [
    ['position', { position: [12, 0, -4] }],
    ['rotation', { rotation: [0, Math.PI / 2, 0] }],
    ['supportSlabId', { supportSlabId: 'slab_x' }],
  ]

  for (const [label, patch] of inert) {
    test(label, () => {
      expect(key(patch), `${label} anahtarı bölüyor — aynı mesh iki kez kuruluyor`).toBe(base)
    })
  }

  test('çerçeveden yüksek bir seviye ölü', () => {
    // Anahtar GERÇEKTEN kurulan seviyeleri kodluyor, yani 2,5 m çerçevenin
    // taşımadığı 7 m'lik bir seviye bildirmek önbelleği bölmemeli.
    expect(key({ levels: [...LEVELS, { ...LEVEL, elevation: 7 }] })).toBe(base)
  })

  test('çapraz bağlantı SADE katmanda ölü', () => {
    // Fazla raporlamanın kanonik hâli: `parts.ts` çaprazı yalnız
    // `detail === 'full'` iken kuruyor, yani sade katmanda bayrak tek vertex
    // kımıldatmıyor.
    expect(longspanGeometryKey(bay({ crossBracing: true }), 'simple')).toBe(
      longspanGeometryKey(bay({ crossBracing: false }), 'simple'),
    )
    // …ve tam katmanda canlı.
    expect(longspanGeometryKey(bay({ crossBracing: true }), 'full')).not.toBe(
      longspanGeometryKey(bay({ crossBracing: false }), 'full'),
    )
  })

  test('çapraz bağlantı sağ çerçeve PAYLAŞILIRKEN ölü', () => {
    // Çapraz sağ çerçeveye bağlanıyor; komşu onu kurduğunda bu bay hiç çapraz
    // emit etmiyor (`parts.ts`: `&& !omission.omitRight`).
    const shared = { omitRight: true }
    expect(longspanGeometryKey(bay({ crossBracing: true }), 'full', shared)).toBe(
      longspanGeometryKey(bay({ crossBracing: false }), 'full', shared),
    )
  })

  test('panel cinsi kirişsiz seviyelerde ölü', () => {
    // `beam-only` hiç panel kurmuyor; `reinforced-hm` panelini her zaman tek
    // parça HM sacından kuruyor ve seviyenin `shelfKind`'ına hiç bakmıyor.
    for (const structure of ['beam-only', 'hanging', 'reinforced-hm'] as const) {
      expect(key({ levels: withLevel(0, { structure, shelfKind: 'mesh' }) })).toBe(
        key({ levels: withLevel(0, { structure, shelfKind: 'chipboard' }) }),
      )
    }
  })

  test('panel sayısı panelsiz seviyelerde ölü', () => {
    for (const structure of ['beam-only', 'hanging', 'reinforced-hm'] as const) {
      expect(key({ levels: withLevel(0, { structure, panels: 5 }) })).toBe(
        key({ levels: withLevel(0, { structure, panels: 1 }) }),
      )
    }
  })
})

describe('katman ve çerçeve paylaşımı', () => {
  test('iki katman ayrı mesh', () => {
    const node = bay()
    expect(longspanGeometryKey(node, 'full')).not.toBe(longspanGeometryKey(node, 'simple'))
  })

  test('paylaşılan çerçeve hattını atlamak ayrı mesh', () => {
    const node = bay()
    expect(longspanGeometryKey(node, 'full', { omitRight: true })).not.toBe(
      longspanGeometryKey(node, 'full', { omitRight: false }),
    )
  })
})

/**
 * Anahtar düğüm nesnesine memoize (`geometry-key-memo.ts`), ve yukarıdaki
 * kapsama blokları da o sarmalayıcı üzerinden koşuyor — her çağrı yeni bir
 * düğüm nesnesi kurduğu için memo hep soğuk, yani alan taraması gerçekten
 * yapılıyor.
 */
describe('şekil anahtarı memoizasyonu', () => {
  test('YERİNDE mutasyon anahtarı tazelemez — memo nesne kimliğine bağlı', () => {
    // İki iş görüyor. Birincisi sözleşmeyi sabitlemek: host düğümü değiştirmez,
    // yenisiyle DEĞİŞTİRİR (`neighbours.ts` de aynı değişmeze dayanıyor).
    // İkincisi memo'nun kendisini yakalamak: memo kaldırılırsa anahtar
    // mutasyondan sonra yeniden kurulur, DEĞİŞİR, ve bu beklenti düşer.
    const node = bay()
    const before = longspanGeometryKey(node, 'full')
    ;(node as unknown as { bayLength: number }).bayLength = 2.7
    expect(longspanGeometryKey(node, 'full')).toBe(before)

    expect(longspanGeometryKey(bay({ bayLength: 2.7 }), 'full')).not.toBe(before)
  })

  test('yapıca aynı iki AYRI bay aynı anahtarı alıyor — paylaşım korunuyor', () => {
    // Memo'nun bozmaması gereken şey bu: paylaşım düğüm kimliğine değil
    // alanlara bakar. Bozulsaydı on baylık bir run on ayrı geometri tahsis
    // ederdi — kindin tüm çizim maliyeti hikâyesi burada duruyor.
    expect(longspanGeometryKey(bay(), 'full')).toBe(longspanGeometryKey(bay(), 'full'))
  })
})
