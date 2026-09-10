import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

/**
 * BEKÇİ: tuvalin İÇİNDE hiçbir dosya DOM çizemez.
 *
 * ## Bulunan hata
 *
 * `route/tool.tsx` çizim okumasını `react-dom`'un `createPortal`'ıyla
 * `document.body`'ye basıyordu. Portal, bir alt ağacın HANGİ uzlaştırıcıya ait
 * olduğunu değiştirmez — yalnız kabı etiketler. Araç bileşenleri host'un
 * `ToolManager`'ı tarafından `<Canvas>` içinde mount ediliyor, yani çocukları
 * R3F'in `createInstance`'ından geçiyor ve orada `<div>` için şu fırlıyor:
 *
 *     R3F: Div is not part of the THREE namespace!
 *
 * `<Canvas>` içeride fırlayanı dışarı yeniden fırlatıyor, viewer da sahnesini
 * `<ErrorBoundary fallback={null} scope="viewer-scene">` ile sarıyor: tek bir
 * `<div>` TÜM üç boyutlu alt ağacı — `CustomCameraControls` dahil —
 * söküyordu. Kullanıcının bildirdiği "yaya yoluna tıklayınca kamera kitleniyor
 * ve yaya yolu çizemiyorum" cümlesinin iki yarısı da bu tek fırlatma:
 * kamera denetimleri de araç da aynı anda gitmişti.
 *
 * ## Neden bu test
 *
 * Hata SESSİZ DEĞİL — gürültülü. Ama yalnız tarayıcıda, aracı kurup imleci
 * oynattığında. Derleme, tip denetimi ve bu paketteki hiçbir test bir R3F ağacı
 * kurmadığı için hiçbiri onu göremedi; üç ayrı "kilitlenme" düzeltmesi
 * `route-controls.tsx`'i onarırken hata `tool.tsx`'te el değmeden durdu.
 * Metinsel bir kusurun metinsel bekçisi, ve kapsamı yalnız rota değil: aynı
 * hatayı yapacak bir sonraki araç da buradan geçmek zorunda.
 *
 * Tuvalin DIŞINDAKİ dosyalar (`panels/`, `bom/`) DOM'a serbestçe yazar; kapsam
 * bilerek yalnız R3F ağacına mount edilen dosyalar.
 */

/**
 * Kapsam: `src` altındaki HER `.tsx` — muaf olanlar hariç.
 *
 * ## Bu listenin ilk hâli yanlış yöndeydi
 *
 * Önce ad ad bir izin listesiydi: kind klasörü + sabit dosya adı.
 * İki şekilde sessizce kaçırıyordu, ve ikisi de bu oturumda ÇALIŞTIRILARAK
 * gösterildi:
 *
 * - Her kalıp bir dizin segmenti şart koşuyordu, yani KÖKTEKİ
 *   `src/collider.tsx` — tam adı listede yazdığı hâlde — hiç taranmıyordu.
 * - Bir kind klasörüne listede olmayan bir adla dosya eklemek yeterliydi:
 *   `src/route/hud.tsx` içine düzeltilen hatanın birebir aynısı (`createPortal`
 *   + Tailwind sınıflı `<div>`) konduğunda bekçi 140 test yeşil geçti.
 *
 * Bir bekçinin varsayılanı "yakala" olmalı, "atla" değil. Artık her `.tsx`
 * taranıyor ve kaçmak için GEREKÇELİ bir satır yazmak gerekiyor — yeni bir
 * dosya eklemek yetmiyor.
 */
const ALL_TSX = 'src/**/*.tsx'

/**
 * Tuvalin DIŞINDA yaşayan, DOM'a yazması DOĞRU olan dosyalar.
 *
 * Bunlar host'un yan rayına ve panellerine mount edilir, `<Canvas>` içine
 * değil — orada `<div>` fırlatmaz, beklenen çıktıdır. Her satır bir gerekçe
 * taşımak zorunda: gerekçesiz bir muafiyet, bekçiyi susturmanın en kolay yolu
 * olurdu (aynı kural `definition-category.test.ts`'te de var).
 */
const EXEMPT: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /(^|\/)[a-z0-9-]*panel\.tsx$/,
    reason: 'Rail paneli — host panelinin içinde, tuval dışı.',
  },
  {
    pattern: /(^|\/)auto-fields\.tsx$/,
    reason: 'Panel alan üreticisi — panel gövdesinde render edilir.',
  },
  { pattern: /^src\/panels\//, reason: 'Panel kiti ve katalog — tamamı DOM.' },
  { pattern: /^src\/stats\//, reason: 'Rapor bölümü — DOM, sahneye hiç girmez.' },
  { pattern: /(^|\/)length-field\.tsx$/, reason: 'Panel alanı — konveyör panelinin içinde.' },
  { pattern: /(^|\/)issue-list\.tsx$/, reason: 'Panel listesi — uyarıları panelde gösterir.' },
  { pattern: /(^|\/)kit\.tsx$/, reason: 'Panel bileşen kiti — panellerin ortak DOM parçaları.' },
]

function exemptionFor(path: string): string | null {
  return EXEMPT.find((entry) => entry.pattern.test(path))?.reason ?? null
}

/**
 * JSX'te göründüğünde kesin DOM olan etiketler.
 *
 * three'de aynı adı taşıyan bir sınıf yok, yani bunlardan biri bu dosyalarda
 * geçtiyse fırlatan tam olarak odur.
 */
const DOM_TAGS = ['div', 'span', 'p', 'button', 'kbd', 'strong', 'input', 'label', 'ul', 'li']

/** Yorumları çıkarır: dosyaların çoğu ESKİ hâlini yorumda ANLATIYOR. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const allFiles = [...new Bun.Glob(ALL_TSX).scanSync('.')]
  .map((path) => path.replace(/\\/g, '/'))
  .filter((path, index, all) => all.indexOf(path) === index)
  .sort()

const files = allFiles.filter((path) => exemptionFor(path) === null)

const sourceOf = new Map(files.map((path) => [path, withoutComments(readFileSync(path, 'utf8'))]))

describe('tuval içindeki dosyalar DOM çizmez', () => {
  test('kapsam boş değil', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  test('kapsam gerçekten rota aracını içeriyor', () => {
    expect(files).toContain('src/route/tool.tsx')
  })

  /**
   * Kaçıran iki kalıbın ikisi de burada anılıyor, çünkü ikisi de bir daha
   * kaçarsa hiçbir yerde gürültü çıkarmaz: biri kök seviyesindeydi, öbürü
   * yalnızca listede olmayan bir addı.
   */
  test('kök seviyesindeki tuval dosyaları da kapsamda', () => {
    expect(files).toContain('src/collider.tsx')
  })

  test('bir kind klasörüne YENİ bir ad eklemek kapsamdan çıkarmaz', () => {
    const routeFiles = allFiles.filter((path) => path.startsWith('src/route/'))
    const scanned = files.filter((path) => path.startsWith('src/route/'))
    // Rota klasöründe muaf olan tek dosya paneldir; gerisi — adı ne olursa
    // olsun — taranır.
    expect(routeFiles.length - scanned.length).toBe(
      routeFiles.filter((path) => exemptionFor(path) !== null).length,
    )
    expect(scanned).toContain('src/route/tool.tsx')
  })

  test('her muafiyet bir gerekçe taşıyor', () => {
    for (const entry of EXEMPT) {
      expect(entry.reason.length, String(entry.pattern)).toBeGreaterThan(20)
    }
    // Muaf edilen her dosya GERÇEKTEN var: ölü bir kalıp, kapsamı sessizce
    // daraltan bir sonraki kalıbın kılıfı olur.
    for (const entry of EXEMPT) {
      expect(
        allFiles.some((path) => entry.pattern.test(path)),
        String(entry.pattern),
      ).toBe(true)
    }
  })

  test.each(files)('%s — react-dom içe aktarmıyor', (path) => {
    const source = sourceOf.get(path) ?? ''
    expect(source).not.toMatch(/from\s+['"]react-dom(\/client)?['"]/)
    expect(source).not.toMatch(/require\(\s*['"]react-dom['"]\s*\)/)
  })

  test.each(files)('%s — DOM etiketi çizmiyor', (path) => {
    const source = sourceOf.get(path) ?? ''
    const offenders = DOM_TAGS.filter((tag) => new RegExp(`<${tag}(\\s|>|/>)`).test(source))
    expect(offenders).toEqual([])
  })
})
