import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * BEKÇİ: imleç yazan her araç, yazmadan önce kutunun gerçekten kımıldadığını
 * sormak ZORUNDA.
 *
 * `setCursorPosition` bir React state yazımıdır ve her fare hareketinde
 * çağrıldığında ızgaraya oturmuş imleç için birebir aynı kareyi üreten bir
 * render zinciri tetikler. `samePlacementPoint` (`placement.ts`) tam bu
 * yüzden var ve rafın aracı onu 2026-08-07'den beri kullanıyordu; kalan on
 * iki araç kapıyı hiç almamıştı.
 *
 * Testin kaynak düzeyinde olmasının sebebi, yakalamak istediği hatanın
 * çalışma zamanında GÖRÜNMEMESİ: kapısız bir araç doğru çalışır, yalnız
 * pahalıdır. On üçüncü araç eklendiğinde kapı unutulursa bunu söyleyecek
 * başka hiçbir şey yok.
 *
 * Kapının kendi doğruluğu (eşik, eksen başına karşılaştırma) `placement.ts`
 * tarafında ayrıca test ediliyor — burası yalnız KAPININ VARLIĞINI arıyor.
 */
function toolSources(): { file: string; source: string }[] {
  const root = join(import.meta.dir)
  const found: { file: string; source: string }[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('tool.tsx')) continue
      found.push({ file: `${entry.name}/${name}`, source: readFileSync(join(dir, name), 'utf8') })
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file))
}

describe('yerleştirme araçları — imleç yazma kapısı', () => {
  test('imleç yazan her araç `samePlacementPoint` kapısını taşıyor', () => {
    const ungated = toolSources()
      .filter((t) => t.source.includes('setCursorPosition('))
      .filter((t) => !t.source.includes('samePlacementPoint('))
      .map((t) => t.file)

    expect(ungated).toEqual([])
  })

  test('kapıyı arayan bu test gerçekten araç buluyor', () => {
    // Boş bir liste üstünde koşan bir bekçi her zaman yeşildir. Dosya adı
    // kuralı değişirse (`tool.tsx` → başka bir şey) yukarıdaki test sessizce
    // hiçbir şeyi denetlemez hâle gelir; bu, onu görünür kılıyor.
    const writers = toolSources().filter((t) => t.source.includes('setCursorPosition('))
    expect(writers.length).toBeGreaterThanOrEqual(12)
  })
})
