import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * BEKÇİ: hiçbir renderer, kayıtlı nesnesini "havuz zaten çiziyor" diye
 * gizlemez.
 *
 * ## Neyi kaybettiğimiz ve neden yine de doğru olan bu
 *
 * Kolektif havuz çizerken düğümün kendi alt ağacı ekranda hiçbir şey
 * yapmıyor, ve `visible = false` onu three'nin `projectObject` gezinişinden
 * tamamen düşürüyordu. Ölçülmüş bir kazançtı (rafta gezilen nesne
 * 10.746 → 3.582).
 *
 * Ama host'un kutu-seçimi (`@pascal-app/editor`
 * `tools/select/box-select-tool.tsx`, `isObjectVisible`) adayları toplarken
 * ATA ZİNCİRİNİ yürüyüp `visible === false` gören düğümü eliyor. Yani
 * gizlenen her kind, V modunda mavi alanla seçilemez hâle geliyordu —
 * kullanıcının bildirdiği belirti tam buydu: "rack nesnesini seçemiyorum
 * ama palet nesnesi seçilebiliyor" (palet o sırada bu budamayı henüz
 * almamıştı).
 *
 * Tıklamayla seçim çalışmaya devam ettiği için hata sessizdi: nesne
 * görünüyor, tıklanınca seçiliyor, yalnız marquee onu atlıyor.
 *
 * Kare başına birkaç nesne gezinişi, çalışan bir seçim aracına değmez.
 * Budama bu yüzden geri alındı ve bu test onun geri gelmesini engelliyor.
 *
 * ## Geri gelmesinin şartı
 *
 * Host `isObjectVisible`'ı `HIDDEN_FOR_COLLECTIVE`'i (havuzun kendi
 * `isEffectivelyVisible`'ında zaten var olan ayrım) okuyacak biçimde
 * genişletirse budama yeniden güvenli olur. O gün gelene kadar kayıtlı
 * nesnenin `visible`'ı YALNIZ kullanıcının gizleme kararını taşır.
 */
function rendererSources(): { file: string; source: string }[] {
  const root = import.meta.dir
  const found: { file: string; source: string }[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'instancing') continue
    const dir = join(root, entry.name)
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('renderer.tsx')) continue
      found.push({ file: `${entry.name}/${name}`, source: readFileSync(join(dir, name), 'utf8') })
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file))
}

describe('kayıtlı nesne yalnız KULLANICI gizlediğinde gizlenir', () => {
  test('hiçbir renderer havuz için görünürlük budaması yapmıyor', () => {
    const pruning = rendererSources()
      .filter((r) => r.source.includes('HIDDEN_FOR_COLLECTIVE'))
      .map((r) => r.file)

    expect(pruning).toEqual([])
  })

  test('`visible` prop’u yalnız node.visible okuyor', () => {
    // `visible={!userHidden && !hidden}` biçimindeki her kompozit ifade,
    // kutu-seçimin eleyeceği bir gizleme demek. Kullanıcının kendi gizleme
    // kararı (`node.visible === false`) tek meşru kaynak.
    const composite = rendererSources()
      .filter((r) => /visible=\{(?![^}]*node\.visible)[^}]*!/.test(r.source))
      .map((r) => r.file)

    expect(composite).toEqual([])
  })

  test('bu test gerçekten renderer buluyor', () => {
    // Boş liste üstünde koşan bekçi her zaman yeşildir.
    expect(rendererSources().length).toBeGreaterThanOrEqual(13)
  })
})
