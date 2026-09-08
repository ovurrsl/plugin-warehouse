import { describe, expect, test } from 'bun:test'
import { warehousePlugin } from './index'

/**
 * BEKÇİ: bu paketin her kind'ı aynı fazda yaşar.
 *
 * ## Bulunan hata
 *
 * Yirmi iki kind'dan yirmi biri `category: 'furnish'` diyordu; `warehouse:route`
 * `'site'` diyordu. Tek kelime, ve host onu ÜÇ ayrı yerde okuyor:
 *
 * - `editor/lib/selection-routing.ts` bir tıklamayı `furnish` kind'ları için
 *   `phase: 'furnish'`e, diğer her şey için `phase: 'structure'`a yönlendirir.
 *   Yani bir rotaya tıklamak, editörün fazını bu paketin kataloğunun ve
 *   araçlarının yaşadığı fazın DIŞINA çeviriyordu — kurulu bir rota aracı dahil.
 * - `editor/components/editor/selection-manager.tsx` furnish fazında bir düğümü
 *   ancak tanımı `furnish` diyorsa kabul eder.
 * - `core/registry.ts` (`categoryOfDef`) onu **Site** görünürlük grubuna koyar,
 *   yani Site anahtarı boyayı gizlerken diğer bütün depo nesneleri kalır.
 *
 * ## Neden test
 *
 * Yanlış `category` HATA VERMEZ. Kind kaydolur, çizilir, panelini açar — yalnız
 * tıklandığında editörü başka bir faza atar ve başka bir görünürlük anahtarına
 * bağlanır. Yirmi iki kind'ın hepsine elle bakılan bir alan, yirmi üçüncüde
 * unutulur; bu test manifesti tarıyor, yani yeni bir kind eklendiği anda cevap
 * veriyor.
 *
 * Muafiyet haritası GEREKÇE taşımak zorunda: gerekçesiz bir muafiyet, bekçiyi
 * susturmanın en kolay yolu olurdu.
 */

/** Bilerek `furnish` DIŞINDA olanlar — her satır bir gerekçe taşır. */
const EXEMPT: Record<string, string> = {}

type Definition = { kind: string; category?: string }

const DEFINITIONS = (warehousePlugin.nodes ?? []) as unknown as Definition[]

describe('her kind furnish fazında', () => {
  test('manifest gerçekten dolu', () => {
    expect(DEFINITIONS.length).toBeGreaterThan(20)
  })

  test.each(DEFINITIONS.map((def) => def.kind))('%s — category furnish', (kind) => {
    if (EXEMPT[kind]) return
    const def = DEFINITIONS.find((candidate) => candidate.kind === kind)
    expect(def?.category).toBe('furnish')
  })

  /**
   * Rota özellikle anılıyor çünkü kaçan oydu ve tekrar kaçması hiçbir yerde
   * gürültü çıkarmaz.
   */
  test('warehouse:route site DEĞİL', () => {
    const route = DEFINITIONS.find((def) => def.kind === 'warehouse:route')
    expect(route).toBeDefined()
    expect(route?.category).not.toBe('site')
    expect(route?.category).toBe('furnish')
  })

  /**
   * İki zemin boyası aynı cevabı vermek zorunda: yaya geçidi rotanın üstüne
   * çiziliyor, ikisi farklı görünürlük grubunda olursa biri açıkken diğeri
   * gizlenir ve ortaya yarım bir kavşak çıkar.
   */
  test('yaya geçidi ile rota aynı grupta', () => {
    const route = DEFINITIONS.find((def) => def.kind === 'warehouse:route')
    const crosswalk = DEFINITIONS.find((def) => def.kind === 'warehouse:crosswalk')
    expect(crosswalk).toBeDefined()
    expect(route?.category).toBe(crosswalk?.category)
  })
})
