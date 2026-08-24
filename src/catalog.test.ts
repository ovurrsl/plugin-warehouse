import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { CATALOG_ITEMS, CATALOG_SECTIONS, chipIsArmed } from './catalog'
import { warehousePlugin } from './index'
import { PalletRackNode } from './rack/schema'
import { deckFinishOf, drawnPickingLevels, levelHasShelf } from './rack/slots'
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
    expect(afterLowRack.pickingLevels).toBe(3)
  })
})

describe('toplama gözü vaat eden fiş gerçekten kutu rafı çizmeli', () => {
  /**
   * `pickingLevels` DEPOLAMA konumlarını ZEMİNDEN sayıyor, ama zemin ne kiriş
   * ne raf taşır (`levelHasShelf`, `level <= 0`). İkisinin arasındaki bir
   * birimlik kayma, "toplama gözü" yazan bir fişin hiç kutu rafı çizmemesine
   * yetiyor: alçak raf fişi `pickingLevels: 1` ile geliyordu, yalnız zemini
   * işaretliyordu, ve iki kirişli sıradan bir palet rafı olarak iniyordu.
   *
   * Sessiz olan yanı şu: şema değeri kabul ediyor, panel alanı gösteriyor,
   * geometri hatasız kuruluyor. Tek belirti, kullanıcının katalogda okuduğu
   * ürünle sahneye inenin farklı olması — ve fark ancak yan yana konursa
   * görülüyor.
   *
   * Bekçi tek fişe değil KURALA bağlı: `pickingLevels` yazan her fiş en az bir
   * ÇİZİLEN toplama gözü üretmeli. Aileye yarın eklenen fiş de bakım
   * istemeden kapsanıyor.
   */
  const promising = CATALOG_ITEMS.filter((item) => {
    const patch = item.brush && 'patch' in item.brush ? item.brush.patch : undefined
    return typeof (patch as { pickingLevels?: unknown } | undefined)?.pickingLevels === 'number'
      ? ((patch as { pickingLevels: number }).pickingLevels ?? 0) > 0
      : false
  })

  test('kapsanan fiş var', () => {
    expect(promising.map((item) => item.id)).toContain('pallet-rack-low')
  })

  test.each(promising)('$id', (item) => {
    const patch = (item.brush as { patch: Record<string, unknown> }).patch
    const rack = PalletRackNode.parse({ ...patch, position: [0, 0, 0], rotation: [0, 0, 0] })
    const drawn = drawnPickingLevels(rack)

    expect(drawn.length).toBeGreaterThan(0)
    // Ve çizilenin gerçekten toplama rafı olduğu: palet güvertesi değil.
    for (const level of drawn) {
      expect(levelHasShelf(rack, level)).toBe(true)
      expect(deckFinishOf(rack, level)).toBe('picking')
    }
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

describe('katalog ızgarası ve panel yapısı', () => {
  const source = readFileSync(`${import.meta.dir}/panels/catalog-panel.tsx`, 'utf8')

  /**
   * Bu blok, panelin host'un `ItemCatalog`'unu kullandığını iddia ediyordu.
   * O bağımlılık geri alındı ve asıl korunması gereken şey artık bunun
   * TERSİ: `ItemCatalog` yalnızca fork'un `integration` dalında var, npm'e
   * hiç çıkmadı (en yeni yayın 1.0.0-beta.5'te barrel `FloatingLevelSelector`
   * export ediyor, `ItemCatalog` etmiyor). İçeri alındığı sürece bu paket
   * yayınlanmış hiçbir sürüme karşı tip denetimi geçemiyordu ve CI kırmızıydı.
   */
  test('panel host un yayınlanmamış ItemCatalog una bağlanmıyor', () => {
    // Sembolün ADI üzerinden değil, KULLANIMI üzerinden: bu dosyanın yorumu
    // kararı anlatmak için adı geçiriyor, ve bir yorum bağımlılık değildir.
    expect(source).not.toContain('<ItemCatalog')
    expect(source).not.toMatch(/import\s*\{[^}]*\bItemCatalog\b[^}]*\}\s*from/)
    // Host'tan yalnızca gerçekten yayınlanmış olanlar alınıyor.
    expect(source).toContain("import { SegmentedControl, useEditor } from '@pascal-app/editor'")
  })

  test('ızgarayı panelin kendisi çiziyor', () => {
    expect(source).toContain('tokens.tileGrid')
    expect(source).toContain('<CatalogTile')
    expect(source).toContain('visibleItems.map')
  })

  test('Kategori sekmeleri CATALOG_SECTIONS üzerinden çiziliyor', () => {
    expect(source).toContain('CATALOG_SECTIONS.map((section)')
    expect(source).toContain('activeSectionId === section.id')
  })

  /** Kategori görselle değil isimle: sekme yalnız `section.label` çiziyor. */
  test('kategoriler isimle gösteriliyor, ikonla değil', () => {
    expect(source).toContain('{section.label}')
    expect(source).not.toContain('icon={section.icon}')
  })

  /** Panel açılışta filtresiz: hiçbir kategori seçili değil, hepsi görünür. */
  test('varsayılanda kategori seçili değil', () => {
    expect(source).toContain('useState<string | null>(null)')
  })

  test('Arama girişi mevcut ve duruma bağlı', () => {
    expect(source).toContain('placeholder="Search..."')
    expect(source).toContain('value={search}')
    expect(source).toContain('setSearch(e.target.value)')
  })

  test('Bağlamsal anahtarlar ve alt kontroller mevcut', () => {
    expect(source).toContain('<LoadBrush />')
    expect(source).toContain('<FlowSwitch />')
    expect(source).toContain('<FleetSwitch />')
    expect(source).toContain('<InstancingSwitch />')
    expect(source).toContain('<DetailRangeSwitch />')
  })
})

describe('katalog arama ve filtreleme mantığı', () => {
  test('her bölümün en az 1 öğesi var', () => {
    for (const section of CATALOG_SECTIONS) {
      const sectionItems = CATALOG_ITEMS.filter((item) => item.sectionId === section.id)
      expect(sectionItems.length).toBeGreaterThan(0)
    }
  })

  test('arama adı veya etiketi eşleştiriyor', () => {
    const query = 'forklift'
    const matches = CATALOG_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query),
    )
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.map((m) => m.id)).toContain('truck-forklift')
  })

  test('açıklama veya ad üzerinden arama eşleşiyor', () => {
    const query = 'spiral'
    const matches = CATALOG_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query),
    )
    expect(matches.map((m) => m.id)).toContain('conveyor-spiral-carton')
    expect(matches.map((m) => m.id)).toContain('conveyor-spiral-pallet')
  })
})
