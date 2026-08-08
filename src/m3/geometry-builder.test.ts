import { describe, expect, test } from 'bun:test'
import { m3GeometryKey } from './geometry-builder'
import { type M3Level, M3ShelvingNode } from './schema'

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
 * M3'te fazla raporlamanın en kolay kaçırılanı bölücüler: sayı bir alan, ama
 * yükseklik AÇIKLIKTAN türüyor ve yayımlanmış seri sığmadığında hiç bölücü
 * kurulmuyor — sayının o hâlde anahtara girmesi hiçbir vertex kımıldatmıyor.
 */

const PROBE = 'm3_probe'

const bay = (patch: Partial<M3ShelvingNode> = {}) => M3ShelvingNode.parse({ id: PROBE, ...patch })

const key = (patch: Partial<M3ShelvingNode> = {}) => m3GeometryKey(bay(patch), 'full')

/** Varsayılan seviye listesi ve tek bir seviyenin şablonu — yamalar bunun
 *  üstüne yazılıyor, böylece "yalnız şu alan değişti" gerçekten doğru. */
const LEVELS: readonly M3Level[] = bay().levels
const LEVEL: M3Level = {
  elevation: 0.3,
  structure: 'shelf',
  model: 'HL',
  dividers: 0,
  drawerModel: 'MA',
  drawerWidth: 'wide',
}

const withLevel = (index: number, patch: Partial<M3Level>): M3Level[] =>
  LEVELS.map((level, i) => (i === index ? { ...level, ...patch } : level))

describe('anahtarı DEĞİŞTİRMESİ gereken alanlar', () => {
  const moving: Array<[string, Partial<M3ShelvingNode>]> = [
    ['shelfLength', { shelfLength: 1.25 }],
    ['shelfDepth', { shelfDepth: 0.6 }],
    ['frameHeight', { frameHeight: 3 }],
    ['frameVariant', { frameVariant: 'diagonals' }],
    ['backPanel', { backPanel: 'mesh' }],
    ['door', { door: 'h1000' }],
    ['uprightColor', { uprightColor: '#123456' }],
    ['componentColor', { componentColor: '#123456' }],
    ['seviye sayısı', { levels: LEVELS.slice(0, 3) }],
    ['seviye yüksekliği', { levels: withLevel(0, { elevation: 0.5 }) }],
    ['seviye yapısı', { levels: withLevel(0, { structure: 'drawers' }) }],
    ['seviye paneli', { levels: withLevel(0, { model: 'HM' }) }],
    ['bölücü sayısı', { levels: withLevel(0, { dividers: 3 }) }],
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

  test('çekmece modeli ve genişliği çekmeceli seviyede canlı', () => {
    const drawers = (patch: Partial<M3Level>) =>
      key({ levels: withLevel(0, { structure: 'drawers', ...patch }) })
    // Model çekmecenin yüksekliği, genişlik hem ölçüsü hem SAYISI: 1 m'lik bir
    // seviye dört geniş ya da sekiz dar çekmece taşıyor.
    expect(drawers({ drawerModel: 'MB' })).not.toBe(drawers({ drawerModel: 'MA' }))
    expect(drawers({ drawerWidth: 'narrow' })).not.toBe(drawers({ drawerWidth: 'wide' }))
  })
})

describe('anahtarı DEĞİŞTİRMEMESİ gereken alanlar', () => {
  const base = key()
  const inert: Array<[string, Partial<M3ShelvingNode>]> = [
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
    // Anahtar GERÇEKTEN kurulan seviyeleri kodluyor, yani 2 m çerçevenin
    // taşımadığı 5 m'lik bir seviye bildirmek önbelleği bölmemeli.
    expect(key({ levels: [...LEVELS, { ...LEVEL, elevation: 5 }] })).toBe(base)
  })

  test('bölücü sayısı SADE katmanda ölü', () => {
    // `parts.ts` bölücüleri yalnız `detail === 'full'` iken kuruyor, yani sade
    // katmanda sayı tek vertex kımıldatmıyor.
    expect(m3GeometryKey(bay({ levels: withLevel(0, { dividers: 3 }) }), 'simple')).toBe(
      m3GeometryKey(bay({ levels: withLevel(0, { dividers: 0 }) }), 'simple'),
    )
  })

  test('yayımlanmış hiçbir bölücü sığmıyorken sayı ölü', () => {
    // 25 mm'lik bir açıklığa serinin en kısası (100 mm) bile girmiyor, yani
    // `dividerHeightAt` null dönüyor ve hiç bölücü kurulmuyor — üç ile sekiz
    // arasındaki fark orada yalnızca önbelleği bölerdi.
    const cramped = (dividers: number): M3Level[] => [
      { ...LEVEL, elevation: 0.3, dividers },
      { ...LEVEL, elevation: 0.35 },
    ]
    expect(key({ levels: cramped(3) })).toBe(key({ levels: cramped(8) }))
    // …ve açıklık yeterliyken canlı: kontrol olmadan üstteki beklenti, bölücü
    // teriminin tamamen düşürülmesiyle de geçerdi.
    expect(key({ levels: withLevel(0, { dividers: 3 }) })).not.toBe(
      key({ levels: withLevel(0, { dividers: 8 }) }),
    )
  })

  test('bölücü sayısı çekmeceli seviyede ölü', () => {
    // Çekmeceli seviyede raf yüzeyi çekmecelerle dolu; bölücü kurulmuyor.
    expect(key({ levels: withLevel(0, { structure: 'drawers', dividers: 3 }) })).toBe(
      key({ levels: withLevel(0, { structure: 'drawers', dividers: 0 }) }),
    )
  })

  test('çekmece alanları raflı seviyede ölü', () => {
    for (const patch of [{ drawerModel: 'MB' }, { drawerWidth: 'narrow' }] as const) {
      expect(key({ levels: withLevel(0, patch) })).toBe(base)
    }
  })
})

describe('katman ve çerçeve paylaşımı', () => {
  test('iki katman ayrı mesh', () => {
    const node = bay()
    expect(m3GeometryKey(node, 'full')).not.toBe(m3GeometryKey(node, 'simple'))
  })

  test('paylaşılan çerçeve hattını atlamak ayrı mesh', () => {
    const node = bay()
    expect(m3GeometryKey(node, 'full', { omitRight: true })).not.toBe(
      m3GeometryKey(node, 'full', { omitRight: false }),
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
    const before = m3GeometryKey(node, 'full')
    ;(node as unknown as { shelfLength: number }).shelfLength = 1.25
    expect(m3GeometryKey(node, 'full')).toBe(before)

    expect(m3GeometryKey(bay({ shelfLength: 1.25 }), 'full')).not.toBe(before)
  })

  test('yapıca aynı iki AYRI bay aynı anahtarı alıyor — paylaşım korunuyor', () => {
    // Memo'nun bozmaması gereken şey bu: paylaşım düğüm kimliğine değil
    // alanlara bakar. Bozulsaydı on baylık bir run on ayrı geometri tahsis
    // ederdi — kindin tüm çizim maliyeti hikâyesi burada duruyor.
    expect(m3GeometryKey(bay(), 'full')).toBe(m3GeometryKey(bay(), 'full'))
  })
})
