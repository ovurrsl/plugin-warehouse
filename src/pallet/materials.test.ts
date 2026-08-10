import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Appearance } from '../appearance'
import { getPalletFarMaterial, getPalletMaterial } from './materials'
import { PALLET_PRESETS } from './presets'

/**
 * Plastik palet ahşap çizilmemeli.
 *
 * "Plastic euro" etiketli fiş, EPAL-1'in ölçeklenmiş klonunu alıyor ve tek
 * bir `pallet-deck` materyali vardı: `epal-textures.ts`'in prosedürel çam
 * atlası — #dfab78 taban, damar çizgileri, yedi budak, üstüne (damga bayrağı
 * okunmadığı için) EPAL/EUR damgaları. Katalog bu preset'i "EPAL, GMA and
 * plastic standards" diye pazarlıyor, yani kullanıcı bilerek seçiyor ve
 * ahşap alıyordu. Gövde BİÇİMİ ahşap yaklaşıklığı olarak kalıyor — o karar
 * kodda yazılı; yazılı olmayan MALZEME gerekçesiydi.
 *
 * Testin ahşap yolunu çağıramamasının sebebi `epal-textures.ts`'in
 * `document.createElement('canvas')` çağırması: bu paket headless test
 * ediliyor. O yüzden plastik yol DAVRANIŞLA, ahşap yolla ayrıştığı yer
 * KAYNAKLA denetleniyor.
 */
const RENDERED: Appearance = { shading: 'rendered', textures: true, colorPreset: 'clay' }

describe('plastik palet ahşap materyali kullanmıyor', () => {
  test('plastik preset headless çözülüyor — atlas hiç kurulmuyor', () => {
    // Ahşap yol `document`'a dokunuyor; bu çağrı patlamıyorsa plastik yol
    // atlasa hiç uğramamış demektir. Bekçinin kendisi budur.
    const material = getPalletMaterial(RENDERED, 'plastic-euro') as {
      map?: unknown
      color?: { getHex: () => number }
    }
    expect(material.map ?? null).toBeNull()
    expect(material.color?.getHex()).not.toBe(0xdfab78)
  })

  test('uzak katman da plastik — ahşap tonuna düşmüyor', () => {
    const far = getPalletFarMaterial(RENDERED, 'plastic-euro') as {
      color?: { getHex: () => number }
    }
    const near = getPalletMaterial(RENDERED, 'plastic-euro') as {
      color?: { getHex: () => number }
    }
    expect(far.color?.getHex()).toBe(near.color?.getHex())
    // 0xb99a6b ahşap uzak tonu — plastik ona düşerse 25 m'de palet tarlası
    // renk değiştirir.
    expect(far.color?.getHex()).not.toBe(0xb99a6b)
  })

  test('iki plastik materyal AYRI ailelerde — ahşabın tekilini ezmiyor', () => {
    const source = readFileSync(join(import.meta.dir, 'materials.ts'), 'utf8')
    // `surfaceMaterial` aile adına göre tekil tutuyor: plastik ahşapla aynı
    // aileyi kullansaydı, sahnede önce hangisi kurulduysa o kazanırdı.
    expect(source).toContain("family: 'pallet-deck-plastic'")
    expect(source).toContain("family: 'pallet-far-plastic'")
  })

  test('materyal seçimi PRESET okuyor — her çağıran da öyle', () => {
    const source = readFileSync(join(import.meta.dir, 'materials.ts'), 'utf8')
    expect(source).toContain('function deckSpec(preset: PalletPreset)')
    for (const file of [
      'renderer.tsx',
      'preview.tsx',
      'bake-replace.tsx',
      '../rack/renderer.tsx',
    ]) {
      const text = readFileSync(join(import.meta.dir, file), 'utf8')
      const calls = text.match(/getPallet(?:Far|Preview)?Material\([^)]*\)/g) ?? []
      for (const call of calls) {
        expect(call, `${file}: ${call}`).toMatch(/,\s*\w+[.\w]*[Pp]reset\s*\)/)
      }
    }
  })

  test('plastik olmayan her preset ahşap yolunda kalıyor', () => {
    // Bekçinin kendini kandırma biçimi: `isPlastic` her zaman true dönerse
    // yukarıdaki üç test de geçer.
    const source = readFileSync(join(import.meta.dir, 'materials.ts'), 'utf8')
    expect(source).toContain("preset === 'plastic-euro'")
    expect(PALLET_PRESETS['plastic-euro']).toBeDefined()
    expect(Object.keys(PALLET_PRESETS).length).toBeGreaterThan(1)
  })
})
