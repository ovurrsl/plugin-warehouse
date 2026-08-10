import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { CATALOG_ITEMS, CATALOG_SECTIONS, chipIsArmed } from './catalog'
import { warehousePlugin } from './index'
import { useWarehouseStore } from './store'

/**
 * Katalogun bekçisi. Üç yorum bu dosyayı VAR SAYARAK yazılmıştı —
 * `catalog-panel.tsx`'in tezgâh kolu, `catalog.ts`'in `stations` bölümü ve
 * `store.ts`'in `setRackBrush`'ı — ama dosya yoktu. Yani üç kural yazılıydı
 * ve hiçbiri tutulmuyordu.
 *
 * Burada tutulan şeylerin ortak yanı: hepsi SESSİZ. Yanlış fırça yerleştirir,
 * boş bölüm var olmayan bir yetenek ilan eder, uygulayıcısı olmayan bir fırça
 * kolu hiçbir hata vermeden görmezden gelinir. Hiçbirinde konsola bir satır
 * düşmez; tek belirti, kullanıcının katalogda tıkladığından başka bir şeyin
 * sahneye inmesidir.
 */

/** Fırçası olan her fişin ayırt edici yaması — kol adı ve yazdığı anahtarlar. */
function brushKeys(item: (typeof CATALOG_ITEMS)[number]): string[] | null {
  const brush = item.brush
  if (!brush) return null
  // `patch` taşıyan kollar yamanın anahtarlarını, taşımayanlar (`pallet`,
  // `route`, `truck`, `telescopic`) kolun kendi alanlarını yazıyor.
  const shape = 'patch' in brush ? brush.patch : brush
  return Object.keys(shape)
    .filter((key) => key !== 'kind')
    .sort()
}

describe('katalog fişleri', () => {
  test('fiş kimlikleri benzersiz', () => {
    const ids = CATALOG_ITEMS.map((item) => item.id)
    expect(ids.length).toBe(new Set(ids).size)
  })

  test('her fişin kindʼı manifestte kayıtlı', () => {
    const registered = new Set(warehousePlugin.nodes?.map((node) => node.kind) ?? [])
    const orphans = [...new Set(CATALOG_ITEMS.map((item) => item.kind))].filter(
      (kind) => !registered.has(kind),
    )
    expect(orphans).toEqual([])
  })

  test('her fişin bölümü var, ve her bölümün fişi', () => {
    const sectionIds = new Set(CATALOG_SECTIONS.map((section) => section.id))
    const strayItems = CATALOG_ITEMS.filter((item) => !sectionIds.has(item.sectionId))
    expect(strayItems.map((item) => item.id)).toEqual([])

    // Boş bölüm bir kez kaldırılıp geri getirilmişti (`catalog.ts`, `stations`):
    // başlığını ve "Nothing here yet." kutusunu çizip var olmayan bir yetenek
    // ilan ediyordu. Kural yazılıydı, bekçisi yoktu.
    const emptySections = CATALOG_SECTIONS.filter(
      (section) => !CATALOG_ITEMS.some((item) => item.sectionId === section.id),
    )
    expect(emptySections.map((section) => section.id)).toEqual([])
  })
})

describe('fırça yapışkanlığı — aynı kindʼı kuran fişler aynı alanları yazmalı', () => {
  /**
   * BU TURUN HATASI, kalıcı hâle getirilmiş bekçi.
   *
   * Fırça yapışkan: bir fişin yazmadığı alan bir önceki yerleştirmeden taşınır
   * (`store.ts`, `setRackBrush`). Yapışkanlık istenen şey — art arda on raf
   * koyan kullanıcı derinliği her seferinde girmez — ama bir ailenin
   * fişlerinden yalnız biri bir alanı yazarsa o alan **hangi fişe basıldığına
   * değil, en son hangisine basıldığına** bağlanır.
   *
   * "Pallet Rack" fişinin hiç fırçası yoktu. Alçak raftan sonra basılan palet
   * rafı onun 2.5 m dikmesini ve toplama gözünü giyiyordu — kullanıcının
   * bildirdiği "hangisini seçersem seçeyim pallet rack geliyor" tam olarak bu.
   *
   * Kural tek tek alanlar değil ANAHTAR KÜMESİ üzerine, çünkü asıl korunan
   * şey bir sonraki ikinci fiş: aile eklendikçe bakım istemiyor.
   */
  const byKind = new Map<string, typeof CATALOG_ITEMS>()
  for (const item of CATALOG_ITEMS) {
    byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item])
  }
  const families = [...byKind].filter(([, items]) => items.length > 1)

  test.each(families)('%s', (_kind, items) => {
    const keySets = items.map((item) => ({ id: item.id, keys: brushKeys(item) }))
    const withBrush = keySets.filter((entry) => entry.keys !== null)
    if (withBrush.length === 0) return

    // Biri fırça yazıyorsa hepsi yazmalı — fırçasız fiş, ailenin geri kalanının
    // bıraktığını giyer.
    expect(keySets.filter((entry) => entry.keys === null).map((entry) => entry.id)).toEqual([])

    const expected = withBrush[0]?.keys?.join(',')
    for (const entry of withBrush) {
      expect(`${entry.id}: ${entry.keys?.join(',')}`).toBe(`${entry.id}: ${expected}`)
    }
  })

  test('rafın iki fişi sırayla basıldığında ikincisi birincisini temizler', () => {
    // Kümeler eşit olsa bile değerlerin gerçekten yazıldığını gören test:
    // fişleri mağazaya UYGULAYIP sonucu okuyor.
    const apply = (id: string) => {
      const item = CATALOG_ITEMS.find((candidate) => candidate.id === id)
      if (item?.brush?.kind !== 'rack') throw new Error(`${id} bir raf fişi değil`)
      useWarehouseStore.getState().setRackBrush(item.brush.patch)
      return useWarehouseStore.getState().rackBrush
    }

    apply('pallet-rack-low')
    const afterPalletRack = apply('pallet-rack')
    expect(afterPalletRack.variant).toBe('pallet-rack')
    expect(afterPalletRack.uprightHeight).toBe(5)
    expect(afterPalletRack.pickingLevels).toBe(0)

    const afterLowRack = apply('pallet-rack-low')
    expect(afterLowRack.variant).toBe('low-rack')
    expect(afterLowRack.uprightHeight).toBe(2.5)
    expect(afterLowRack.pickingLevels).toBe(1)
  })
})

describe('her fırça kolunun bir uygulayıcısı var', () => {
  /**
   * Kaynak düzeyi bekçi, ve gerekçesi `arm()`'ın şekli: on üç bağımsız `if`,
   * hiçbiri `else`'li değil ve hiçbiri tükenmişlik denetiminden geçmiyor. Bir
   * kola uygulayıcı yazılmazsa TypeScript susar, çalışma zamanı susar, ve fiş
   * yalnızca aracı kurup fırçayı olduğu gibi bırakır.
   *
   * Tezgâhta bir kez oldu: altı fişin altısı da `processing` masayı
   * yerleştiriyordu, ve fark yalnız gözle görülüyordu.
   */
  const source = readFileSync(`${import.meta.dir}/panels/catalog-panel.tsx`, 'utf8')
  const arms = [...new Set(CATALOG_ITEMS.map((item) => item.brush?.kind).filter(Boolean))]

  test.each(arms)('%s', (arm) => {
    expect(source).toContain(`item.brush?.kind === '${arm}'`)
  })
})

describe('vurgulama — bir seferde TEK fiş yanar', () => {
  /**
   * Kullanıcının bildirdiği "lower rack seçtiğimde pallet rackı da seçiyor"
   * şikâyetinin panel tarafı.
   *
   * Vurgulama JSX'in içinde altı elle yazılmış yüklemdi ve yüklemi yazılmamış
   * her aile aynı anda birden çok fişi yakıyordu: raf, longspan, m3, drive-in,
   * live-rack, mezzanine — çok fişli ailelerin yarısından fazlası. Yüklem
   * listesine yedincisini eklemek yalnız bir sonraki ailenin unutulmasını
   * geciktirirdi, o yüzden karşılaştırma fişin KİMLİĞİNE taşındı ve bekçi de
   * aile başına değil, bütün aileleri süpürerek yazıldı.
   */
  const byKind = new Map<string, typeof CATALOG_ITEMS>()
  for (const item of CATALOG_ITEMS) {
    byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item])
  }

  test.each([...byKind])('%s', (kind, items) => {
    for (const armed of items) {
      const lit = items.filter((item) => chipIsArmed(item, kind, armed.id))
      expect({ armed: armed.id, lit: lit.map((item) => item.id) }).toEqual({
        armed: armed.id,
        lit: [armed.id],
      })
    }
  })

  test('başka bir kindʼın aracı silahlıyken hiçbir fiş yanmıyor', () => {
    const lit = CATALOG_ITEMS.filter((item) => chipIsArmed(item, 'wall', 'pallet-rack'))
    expect(lit.map((item) => item.id)).toEqual([])
  })

  test('katalog dışından silahlanan araçta ailenin fişleri yanıyor', () => {
    // Kasıtlı geri düşme: kısayolla ya da host paletinden silahlanan araç fiş
    // kimliği yazmıyor. Kimlik yoksa hiçbir şey yanmasaydı panel silahlı
    // aracı hiç göstermezdi — bugünkü davranış korunuyor.
    const lit = CATALOG_ITEMS.filter((item) =>
      chipIsArmed(item, 'warehouse:pallet-rack', null),
    ).map((item) => item.id)
    expect(lit).toEqual(['pallet-rack', 'pallet-rack-low'])
  })
})
