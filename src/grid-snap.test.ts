import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

/**
 * BEKÇİ: yerleştirme, host'un ızgara ayarını yok sayamaz.
 *
 * ## Bulunan hata
 *
 * Sekiz araç `subscribeGridMove`'un verdiği HAM imleci doğrudan yerleştiriyordu.
 * Kullanıcının bildirdiği "pallet rack dışındaki nesnelerde ızgara ayarı yok
 * sayılıyor" tam olarak buydu.
 *
 * Kodu okurken görülmemesinin sebebi, o araçların `isGridSnapActive()`'i zaten
 * OKUYOR olması. Ama okudukları yer `movementSfxStepKey` — ızgaraya oturunca
 * "tık" sesi çıkaran anahtar. **Ses ızgarayı biliyordu, konum bilmiyordu.**
 * Bu yüzden bekçi "ayarı okuyor mu" diye sormuyor; ham imlecin ileri
 * geçirilmediğini sayıyor.
 *
 * ## Neden kaynağa bakıyor
 *
 * Bir yerleştirme aracını testten çalıştırmak R3F ağacı, host mağazaları,
 * abonelikler ve bir işaretçi olayı ister. Kusur ise metinsel ve tek satır:
 * `applyCursor([rawX, 0, rawZ])`.
 */

const TOOL_GLOB = 'src/*/tool.tsx'

/**
 * Izgarayı KENDİ merdiveniyle çözen araçlar.
 *
 * `resolveAlignedPlacement` bunlar için yanlış olurdu ve denetim bunu ayrıca
 * doğruladı: `warehouse:route` `wall` kip kümesini alan tek kind, yani açı
 * ışınına erişimi olan tek araç. Kendi `snap()` merdiveni adımı
 * `isGridSnapActive()` ile kapatıp `snapPointAlongAngleRay` ya da
 * `snapPointToGrid` uyguluyor. Üstüne `resolveAlignedPlacement` koymak, dosyanın
 * kendi başlığında (`route/tool.tsx:52-55`) düzeltildiği yazan çift-dönüşüm
 * hatasını geri getirirdi.
 */
const OWN_SNAP_LADDER: Record<string, string> = {
  'src/route/tool.tsx':
    'kendi merdiveni: isGridSnapActive() ile kapatılmış snapPointAlongAngleRay / snapPointToGrid (tool.tsx:109-123)',
}

/**
 * Bilerek muaf tutulanlar — her satır bir GEREKÇE taşımak zorunda.
 *
 * Boş bırakılamaz: gerekçesiz bir muafiyet, bekçiyi susturmanın en kolay yolu
 * olurdu ve kimse fark etmezdi.
 */
const EXEMPT: Record<string, string> = {
  'src/mezzanine/tool.tsx':
    'Çok noktalı çizim, ve çizim etkileşiminin tamamı zone/slab sürüklemesine geçirilecek (görev #27). ' +
    'Ayrıca kendi başına bir kare daha var: outline-editor.tsx:122 DÜNYA koordinatını kuantalıyor, ' +
    'placement.ts ise KAT-YEREL çerçeveyi — yani bugün araç ile yeniden şekillendirici iki ayrı ' +
    'kafese yapışırdı. İkisi #27 ile birlikte tek elden düzeltilecek; şimdi yamamak iki kez iş demek.',
}

const toolFiles = [...new Bun.Glob(TOOL_GLOB).scanSync('.')].sort()
const sourceOf = new Map(toolFiles.map((path) => [path, readFileSync(path, 'utf8')]))

/** Yerleştirme imlecini dinleyen araçlar — bekçinin kapsamı bu. */
const placementTools = toolFiles.filter((path) =>
  (sourceOf.get(path) ?? '').includes('subscribeGridMove('),
)

describe('yerleştirme ızgara ayarını yok sayamaz', () => {
  test('kapsam boş değil', () => {
    expect(placementTools.length).toBeGreaterThan(8)
  })

  /**
   * Asıl iddia, ve tam da yapılmış olan hata: `subscribeGridMove`'un yıkım
   * yoluyla aldığı ham değerleri bir imleç yazıcısına doğrudan vermek.
   */
  test.each(placementTools)('%s ham imleci ileri geçirmiyor', (path) => {
    if (EXEMPT[path]) return
    const source = sourceOf.get(path) ?? ''
    // Yorum satırları hariç: dosyaların çoğu eski hâli yorumda ANLATIYOR.
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n')
    const raw = [
      ...code.matchAll(/(?:applyCursor|setCursor|cursorRef\.current\s*=)\s*\(?\[\s*raw/g),
    ]
    expect(raw.map((m) => m[0])).toEqual([])
  })

  /**
   * Ters yön: ham imleci geçirmemek yetmez, konumun bir yerde GERÇEKTEN
   * çözülmüş olması gerekiyor. Bu olmadan bir araç imleci başka bir ada
   * kopyalayıp bekçiyi susturabilirdi.
   */
  test.each(placementTools)('%s konumu çözüyor', (path) => {
    if (EXEMPT[path]) return
    const source = sourceOf.get(path) ?? ''
    const resolves =
      source.includes('resolveAlignedPlacement(') || OWN_SNAP_LADDER[path] !== undefined
    expect({ path, resolves }).toEqual({ path, resolves: true })
  })

  /**
   * Ek yeri taşıyan kindʼler üçüncü aşamayı da kurmak ZORUNDA.
   *
   * Yalnız `resolveAlignedPlacement` eklemek bunları bozardı: host'un yapışma
   * kipleri birbirini dışlıyor (`grid` = kuantalama, çekiş yok), ek yeri aralığı
   * hiçbir ızgara adımının katı değil, dolayısıyla kuantalanmış imleç ek yerine
   * hiç ulaşamaz — bitişik bay birkaç santim binince geçerlilik kırmızıya döner
   * ve tıklama yutulur. Izgarayı yok saymaktan daha kötü bir sonuç.
   */
  const SEAM_KINDS = ['drivein', 'live-racking', 'longspan', 'm3']
  test.each(SEAM_KINDS)('%s ek yeri mıknatısını yerleştirmede de uyguluyor', (kind) => {
    const source = sourceOf.get(`src/${kind}/tool.tsx`) ?? ''
    expect(source.includes('snapToNeighbourSeam(')).toBe(true)
    // Sıra: mıknatıs hizalamanın ÜSTÜNE biniyor, altına değil.
    const aligned = source.indexOf('resolveAlignedPlacement(')
    const seam = source.indexOf('snapToNeighbourSeam(', aligned)
    expect({ kind, ordered: aligned >= 0 && seam > aligned }).toEqual({ kind, ordered: true })
  })

  /**
   * Merdiven muafiyeti BEDAVA GEÇİŞ olmasın.
   *
   * Mutasyonla bulundu: route'un `snap()` çağrısı sökülüp yerine ham nokta
   * konduğunda bekçi yeşil kalıyordu, çünkü ham değerler bir değişkenden
   * geçiyor ve yukarıdaki metin araması onları görmüyor. Muaf tutulan dosya
   * merdivenini gerçekten TAŞIMAK zorunda: adımı ayara bağlayan çağrı ve
   * kuantalamanın kendisi.
   */
  test.each(Object.keys(OWN_SNAP_LADDER))('%s merdivenini hâlâ taşıyor', (path) => {
    const source = sourceOf.get(path) ?? ''
    const gated = source.includes('isGridSnapActive() ?')
    const quantises = source.includes('snapPointToGrid(')
    expect({ path, gated, quantises }).toEqual({ path, gated: true, quantises: true })
  })

  /** Ölü muafiyet kalmasın: iş bitince satır da gitsin. */
  test('muafiyet ve merdiven listeleri ölü satır taşımıyor', () => {
    for (const path of [...Object.keys(EXEMPT), ...Object.keys(OWN_SNAP_LADDER)]) {
      expect({ path, listed: placementTools.includes(path) }).toEqual({ path, listed: true })
    }
  })

  test('her muafiyet bir gerekçe taşıyor', () => {
    for (const [path, reason] of Object.entries(EXEMPT)) {
      expect({ path, long: reason.trim().length > 40 }).toEqual({ path, long: true })
    }
  })
})
