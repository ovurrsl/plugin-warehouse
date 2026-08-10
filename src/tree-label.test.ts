import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { CATALOG_ITEMS } from './catalog'
import { warehousePlugin } from './index'

/**
 * BEKÇİ: aynı kindʼı kuran iki fiş, sahne ağacında iki AYRI ad üretmeli.
 *
 * Kullanıcının bildirdiği hatanın ikinci yarısı bu — "plugin içinde lower rack
 * seçtiğimde pallet rackı da seçiyor bu diğer bazı nesnelerde de var". Fişler
 * ayrı, yerleştirilen düğümler ayrı, ama ağaçtaki satır aynı: on iki kindʼın on
 * ikisi de `defaults()` içinde TEK bir sabit ad yazıyordu ve altı tezgâh fişi
 * de "Bench" üretiyordu.
 *
 * Test fişleri gerçekten UYGULUYOR: her fişin fırçasını kendi kindʼinin
 * şemasına verip düğümü kuruyor, sonra `def.tree.label`'ı çağırıyor. Yani
 * ölçtüğü şey "etiket fonksiyonu var mı" değil, "iki fişten iki farklı ad
 * çıkıyor mu".
 */

type Definition = {
  kind: string
  schema: { parse: (value: unknown) => unknown }
  tree?: { label?: (node: unknown, nodes: unknown) => string }
}

const DEFINITIONS = new Map<string, Definition>(
  (warehousePlugin.nodes ?? []).map((node) => [node.kind, node as unknown as Definition]),
)

/**
 * Fişi bir düğüme çeviriyor.
 *
 * Fırça anahtarları HER ZAMAN şema alanı değil, ve bu testi yazarken ortaya
 * çıktı: `m3` ile `longspan` fişlerinde `structure` / `shelfKind` /
 * `levelCount` düğümün kendi alanları değil, aracın KATLARA açtığı şablon
 * anahtarları (`m3/tool.tsx`, `ghostNode`). Bunları düz `schema.parse`'a
 * vermek sessizce hiçbir şey yapmıyordu — iki m3 fişi de aynı düğümü
 * üretiyor, dolayısıyla test etiket hatası olmadığı hâlde aynı adı görüyordu.
 *
 * Kural genel tutuldu, iki kindʼa özel kılınmadı: şemada karşılığı olmayan
 * anahtar KATLARA uygulanır. Üçüncü bir kind aynı şekli alırsa kendiliğinden
 * çalışır; hiçbir yere uygulanamayan bir anahtar kalırsa test onu söyler.
 */
function chipNode(def: Definition, item: (typeof CATALOG_ITEMS)[number]): unknown {
  const brush = item.brush
  if (!brush) return def.schema.parse({})
  const shape = ('patch' in brush ? brush.patch : brush) as Record<string, unknown>
  const { kind: _kind, ...fields } = shape

  const schemaKeys = new Set(Object.keys((def.schema as { shape?: object }).shape ?? {}))
  const own: Record<string, unknown> = {}
  const forLevels: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (schemaKeys.has(key)) own[key] = value
    else forLevels[key] = value
  }

  const node = def.schema.parse(own) as Record<string, unknown>
  const { levelCount, ...levelFields } = forLevels
  if (Object.keys(forLevels).length === 0) return node
  if (!Array.isArray(node.levels)) {
    throw new Error(
      `${item.id}: şemada olmayan ${Object.keys(forLevels).join(', ')} anahtarı var ama düğümün katı yok`,
    )
  }

  const levels = node.levels as Record<string, unknown>[]
  const count = typeof levelCount === 'number' ? levelCount : levels.length
  return def.schema.parse({
    ...own,
    levels: Array.from({ length: count }, (_, index) => ({
      ...levels[index % levels.length],
      ...levelFields,
    })),
  })
}

const byKind = new Map<string, typeof CATALOG_ITEMS>()
for (const item of CATALOG_ITEMS) {
  byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item])
}
const families = [...byKind].filter(([, items]) => items.length > 1)

describe('çok fişli her ailenin ağaç adı fişe göre ayrışıyor', () => {
  test.each(families)('%s', (kind, items) => {
    const def = DEFINITIONS.get(kind)
    expect({ kind, registered: def !== undefined }).toEqual({ kind, registered: true })

    const label = def?.tree?.label
    // `presentation.label`'a düşmek demek kind başına TEK ad demek: yirmi rafın
    // yirmi satırı birebir aynı okunur.
    expect({ kind, hasLabel: typeof label === 'function' }).toEqual({ kind, hasLabel: true })
    if (typeof label !== 'function') return

    const labels = items.map((item) => {
      const node = def ? chipNode(def, item) : undefined
      return { chip: item.id, label: label(node, {}) }
    })

    // Asıl iddia. Aynı ada düşen iki fiş, kullanıcının gördüğü hatanın kendisi.
    const seen = new Map<string, string>()
    const collisions: string[] = []
    for (const entry of labels) {
      const previous = seen.get(entry.label)
      if (previous) collisions.push(`${previous} ↔ ${entry.chip}: "${entry.label}"`)
      else seen.set(entry.label, entry.chip)
    }
    expect(collisions).toEqual([])
  })
})

describe('hiçbir kind `defaults()` içinde sabit ad yazmıyor', () => {
  /**
   * Türetmeyi ezen tek şey bu, ve ezerken hiç ses çıkarmıyor.
   *
   * `treeLabel` düğümün `name`'i doluysa onu kullanıcının verdiği ad sayıp
   * türetmeyi atlıyor — doğru davranış, ama `defaults()` bir ad YAZARSA o ad
   * kullanıcıdan gelmiş gibi görünür. On iki kindʼin on ikisi de böyleydi:
   * etiket fonksiyonları eklendikten sonra bile, host `defaults()` üzerinden
   * kurduğu her düğüme "Pallet Rack" yazıyor, alçak raf da o adla açılıyordu.
   *
   * Bekçi kind listesine değil manifestin kendisine bağlı: yarın eklenen
   * kind, ada dair hiçbir şey bilmeden kapsanıyor.
   */
  const withDefaults = [...DEFINITIONS.values()].filter(
    (def) => typeof (def as { defaults?: unknown }).defaults === 'function',
  )

  test('en az bir kind `defaults()` bildiriyor', () => {
    expect(withDefaults.length).toBeGreaterThan(0)
  })

  test.each(withDefaults.map((def) => [def.kind, def] as const))('%s', (_kind, def) => {
    const defaults = (def as unknown as { defaults: () => Record<string, unknown> }).defaults()
    expect('name' in defaults).toBe(false)
  })
})

describe('hiçbir araç yerleştirdiği düğüme sabit ad yazmıyor', () => {
  /**
   * `defaults()` bekçisinin kaçırdığı ikinci kapı, ve daha çok kullanılan
   * olan o: eklentinin araçları düğümü `defaults()` üzerinden değil, kendi
   * `Node.parse({...})` çağrılarıyla kuruyor. Sekiz araç orada bir sabit ad
   * yazıyordu — `name: 'Bench'`, `name: 'M3 Bay'`, `name: 'Mezzanine'` — ve
   * `treeLabel` dolu bir `name`'i kullanıcının verdiği ad saydığı için
   * türetme hiç çalışmıyordu. Altı tezgâh fişi ağaçta yine altı "Bench"
   * satırı açıyordu; `defaults()` bekçisi yeşil yanarken.
   *
   * Bekçi kaynağa bakıyor çünkü kusur metinsel: aracı testten çalıştırmak
   * R3F ağacı, host mağazaları ve bir tıklama olayı ister. Aranan şey dar
   * tutuldu — yalnızca dizge sabiti. `name: item.label` gibi türetilmiş bir
   * ad meşru ve bilerek serbest.
   */
  const toolSources = [...new Bun.Glob('src/*/tool.tsx').scanSync('.')].sort()

  test('araç dosyaları bulunuyor', () => {
    expect(toolSources.length).toBeGreaterThan(0)
  })

  test.each(toolSources)('%s', (path) => {
    const source = readFileSync(path, 'utf8')
    const literals = [...source.matchAll(/(^|[\s{,])name:\s*(['"`])[^'"`]*\2/g)].map((m) =>
      m[0].trim(),
    )
    expect(literals).toEqual([])
  })
})

describe('kullanıcının verdiği ad her zaman kazanır', () => {
  /**
   * Türetilen ad bir VARSAYILAN, bir dayatma değil. Host'un yedek zinciri
   * `tree.label(...) || node.name || presentation.label` olduğu için etiket
   * fonksiyonu adı okumazsa kullanıcının yeniden adlandırması sessizce yok
   * sayılırdı — ve yeniden adlandırma sahne ağacının en sık kullanılan işi.
   */
  const withLabel = [...DEFINITIONS.values()].filter((def) => typeof def.tree?.label === 'function')

  test('en az bir kind ağaç adı bildiriyor', () => {
    expect(withLabel.length).toBeGreaterThan(0)
  })

  test.each(withLabel.map((def) => [def.kind, def] as const))('%s', (_kind, def) => {
    const node = def.schema.parse({ name: 'Depo girişi' })
    expect(def.tree?.label?.(node, {})).toBe('Depo girişi')
  })
})
