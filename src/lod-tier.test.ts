import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = import.meta.dir

/**
 * BEKÇİ: LOD taşıyan bir renderer JSX'inde katmanı SABİT yazmaz.
 *
 * ## Hata
 *
 * Kendi mesh'ini çizen renderer'lar katmanı iki yerde belirliyor: mount
 * anında JSX prop'u, sonrasında `useFrame` içinde `mesh.geometry = ...`.
 * JSX `'full'` sabitini yazarsa ikisi ayrışabiliyor, ve ayrışma şöyle
 * oluyor:
 *
 *   1. Kamera uzaklaşıyor, döngü `detailRef`'i `'simple'` yapıyor ve
 *      mesh'in geometrisini imperatif olarak değiştiriyor.
 *   2. Kullanıcı bir alan değiştiriyor (renk, bir bayrak — şekli
 *      değiştiren herhangi bir şey). Geometri anahtarı yenileniyor,
 *      React yeniden render ediyor ve JSX prop'u mesh'e TAM ayrıntıyı
 *      geri yazıyor. Nesne uzakta ama tam ayrıntıda.
 *   3. Bir daha düzelmiyor: döngünün `if (next === current) return`
 *      kapısı `detailRef`'i hâlâ `'simple'` görüyor, yani "değişiklik
 *      yok" deyip çıkıyor. Nesne kamera BANDIN öteki ucuna geçene kadar
 *      tam ayrıntıda kalıyor.
 *
 * Ekranda hata yok — yalnız uzaktaki nesneler sessizce pahalı çiziliyor,
 * ve LOD'un ölçülmüş kazancı kullanıcı bir kaydırıcıya dokundukça eriyor.
 *
 * `truck/renderer.tsx` bu hatayı bir kez yaşamış ve çözümü yazmış:
 * JSX de `detailRef.current` okur. Dışa aktarım tek istisna — orada
 * çıktının her zaman tam ayrıntı olması gerekiyor.
 */
function drawingRenderers(): { file: string; source: string }[] {
  const found: { file: string; source: string }[] = []
  for (const entry of readdirSync(SRC, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'instancing') continue
    const dir = join(SRC, entry.name)
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('renderer.tsx')) continue
      const source = readFileSync(join(dir, name), 'utf8')
      // Yalnız KENDİ `detailRef`'ini süren renderer'lar. Kolektif havuza
      // giren kind'lar katmanı havuza bırakıyor ve JSX'lerinde geometri
      // prop'u yok.
      if (!source.includes('detailRef')) continue
      found.push({ file: `${entry.name}/${name}`, source })
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file))
}

describe('LOD katmanı JSX ile döngü arasında ayrışmıyor', () => {
  const RENDERERS = drawingRenderers()

  test('kendi LOD’unu süren renderer bulundu', () => {
    // Boş liste üstünde koşan bekçi her zaman yeşildir.
    expect(RENDERERS.length).toBeGreaterThanOrEqual(3)
  })

  for (const { file, source } of RENDERERS) {
    test(`${file} JSX’te katmanı sabit yazmıyor`, () => {
      // `geometry={getX(node, 'full')}` — sabit katman. Dışa aktarım
      // koşulu (`isExporting ? 'full' : detailRef.current`) meşru ve
      // ayrı: orada 'full' bir üçlünün kolu, tek başına bir sabit değil.
      const pinned = [...source.matchAll(/geometry=\{[^}]*\}/g)]
        .map(([match]) => match)
        .filter((match) => /['"]full['"]/.test(match) && !match.includes('detailRef'))

      expect(
        pinned,
        `${file}: JSX katmanı sabit yazıyor — bir alan değişince uzaktaki nesne tam ayrıntıya döner ve bir daha düşmez`,
      ).toEqual([])
    })

    test(`${file} döngüsü katmanı gerçekten güncelliyor`, () => {
      // `detailRef` var ama hiç yazılmıyorsa katman hiç değişmiyor demek —
      // LOD'un kendisi ölü.
      expect(source).toContain('detailRef.current =')
    })
  }
})
