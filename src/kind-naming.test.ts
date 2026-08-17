import { describe, expect, test } from 'bun:test'
import { warehousePlugin } from './index'
import { KIND_PREFIX } from './plugin-id'

/**
 * BEKÇİ: kind isimleri EDİTÖRÜN kendi kuralını izler.
 *
 * ## Kural uydurulmadı, host'un kind listesinden okundu
 *
 * `packages/nodes/src/*` kırk küsur kind kaydediyor ve ikisi arasında net bir
 * ayrım yapıyor:
 *
 *  1. **Kompozisyon → aile adı ÖNDE.** `duct-segment`, `duct-fitting`,
 *     `duct-terminal`, `pipe-segment`, `pipe-fitting`, `pipe-trap`,
 *     `roof-segment`, `stair-segment`, `cabinet-module`. Bir kanal parçası bir
 *     kanal hattının PARÇASIDIR; tek başına bir "kanal" değildir.
 *
 *  2. **Varyasyon → nitelik ÖNDE, aile adı SONDA.** `box-vent`, `ridge-vent`,
 *     `turbine-vent`, `eyebrow-vent` — dört havalandırma varyantı, dördü de
 *     `vent` ile bitiyor. Ayrıca `solar-panel`, `liquid-line`,
 *     `structural-grid`. Bir tepe havalandırması bir havalandırmanın
 *     TÜRÜDÜR.
 *
 *  3. **Tekil şey → eksiz.** `wall`, `slab`, `column`, `door`, `shelf`,
 *     `zone`, `elevator`.
 *
 * ## Eklentiye uygulanışı
 *
 * Konveyör modülleri bir HATTIN parçası — düz, viraj, hızlandırıcı bir arada
 * bir hat kurar — yani kural 1: `conveyor-<parça>`. Zaten öyleydi.
 *
 * Raf tipleri ise rafın VARYANTI — drive-in bir raf türü, M3 bir raf türü —
 * yani kural 2: `<varyant>-rack`. `pallet-rack` ve `drive-in-rack` buna zaten
 * uyuyordu; `live-racking` (çoğul aile adı), `longspan` (aile adı yok) ve
 * `m3-shelving` (İKİNCİ bir aile adı) uymuyordu ve düzeltildi.
 *
 * Palet, asma kat, rota ve araç tekil şeyler — kural 3, eksiz.
 *
 * ## Neden test
 *
 * Kind dizgesi kayıtlı sahnelerde saklanıyor ve host'un registry'sinde takma
 * ad desteği yok (`legacyKind`/`aliasKind` — hiçbiri), harici bir eklenti de
 * host'un `migrateNodes` tablosuna satır ekleyemiyor. Yani bir kind yanlış
 * doğduğunda düzeltmenin bedeli, o düğümü taşıyan sahnelerin bozulması. Bu
 * testin işi, o bedeli bir kez ödettikten sonra bir daha ödetmemek.
 */

const KINDS = (warehousePlugin.nodes ?? []).map((node) => (node as { kind: string }).kind)

/** Kural 1 — bir hattın parçaları. Aile adı ÖNDE. */
const COMPOSED_FAMILIES = ['conveyor'] as const

/** Kural 2 — bir şeyin varyantları. Aile adı SONDA. */
const VARIANT_FAMILIES = ['rack'] as const

/** Kural 3 — ailesi olmayan tekil şeyler. */
const SINGLETONS = [
  'pallet',
  'mezzanine',
  'route',
  'truck',
  'bench',
  'dock-leveller',
  'tote-cart',
  // Kural 3 — tekil şey, eksiz. Bir dikey transfer makinesi: paletin bir
  // varyantı değil, konveyör hattının bir parçası değil, ve bir "lift"
  // ailesi de yok (tek üye). `elevator` gibi eksiz.
  'pallet-lift',
] as const

describe('kind isimlendirme standardı', () => {
  test('manifest gerçekten kind taşıyor', () => {
    expect(KINDS.length).toBeGreaterThan(10)
  })

  for (const kind of KINDS) {
    test(`${kind} — biçim`, () => {
      expect(kind.startsWith(KIND_PREFIX), `${kind}: "${KIND_PREFIX}" öneki yok`).toBe(true)
      const local = kind.slice(KIND_PREFIX.length)
      // Küçük harf, kebab-case, rakam serbest (m3). Host'un kendi listesinde
      // istisnasız böyle.
      expect(local, `${kind}: kebab-case değil`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    })
  }

  test('her kind üç kuraldan BİRİNE giriyor — sınıflanamayan kalmıyor', () => {
    const unclassified = KINDS.filter((kind) => {
      const local = kind.slice(KIND_PREFIX.length)
      if ((SINGLETONS as readonly string[]).includes(local)) return false
      if (COMPOSED_FAMILIES.some((family) => local.startsWith(`${family}-`))) return false
      if (VARIANT_FAMILIES.some((family) => local.endsWith(`-${family}`))) return false
      return true
    })
    expect(
      unclassified,
      `sınıflanamayan kind: ${unclassified.join(', ')} — yeni bir aile mi eklendi? Kuralı yukarıya yazın.`,
    ).toEqual([])
  })

  test('raf ailesi TEK bir aile adında birleşiyor', () => {
    // Bu ailenin bir zamanlar dört ayrı kuralı vardı: -rack, -racking, eksiz ve
    // -shelving. "Bir standart" tam olarak bunun olmaması demek.
    const racking = KINDS.filter((kind) => /rack|shelv|longspan|m3/.test(kind))
    expect(racking.length).toBeGreaterThanOrEqual(5)
    for (const kind of racking) {
      expect(kind.endsWith('-rack'), `${kind}: raf ailesi "-rack" ile bitmeli`).toBe(true)
    }
  })

  test('konveyör ailesi aile adını ÖNDE taşıyor', () => {
    const conveyors = KINDS.filter((kind) => kind.includes('conveyor'))
    expect(conveyors.length).toBeGreaterThanOrEqual(7)
    for (const kind of conveyors) {
      expect(
        kind.startsWith(`${KIND_PREFIX}conveyor-`),
        `${kind}: konveyör modülü bir hattın parçası — aile adı önde olmalı`,
      ).toBe(true)
    }
  })

  test('tekiller aile eki ALMIYOR', () => {
    for (const singleton of SINGLETONS) {
      expect(KINDS).toContain(`${KIND_PREFIX}${singleton}`)
    }
  })

  test('iki kez kaydedilen kind yok', () => {
    // Host çift kind'ı üretimde THROW ediyor; burada yakalamak, uygulamayı
    // açtığında öğrenmekten iyi.
    expect(new Set(KINDS).size).toBe(KINDS.length)
  })
})
