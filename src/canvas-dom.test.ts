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

/** R3F ağacına mount edilen dosyalar: araçlar, önizlemeler, çiziciler, jestler. */
const IN_CANVAS_GLOBS = [
  'src/*/tool.tsx',
  'src/*/*-tool.tsx',
  'src/*/preview.tsx',
  'src/*/*-preview.tsx',
  'src/*/renderer.tsx',
  'src/*/*-renderer.tsx',
  'src/*/*-system.tsx',
  'src/*/route-controls.tsx',
  'src/*/collider.tsx',
]

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

const files = IN_CANVAS_GLOBS.flatMap((glob) => [...new Bun.Glob(glob).scanSync('.')])
  .map((path) => path.replace(/\\/g, '/'))
  .filter((path, index, all) => all.indexOf(path) === index)
  .sort()

const sourceOf = new Map(files.map((path) => [path, withoutComments(readFileSync(path, 'utf8'))]))

describe('tuval içindeki dosyalar DOM çizmez', () => {
  test('kapsam boş değil', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  test('kapsam gerçekten rota aracını içeriyor', () => {
    expect(files).toContain('src/route/tool.tsx')
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
