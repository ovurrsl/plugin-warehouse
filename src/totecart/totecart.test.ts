import { beforeEach, describe, expect, test } from 'bun:test'
import { CATALOG_ITEMS, CATALOG_SECTIONS } from '../catalog'
import { clearConveyorGeometryCache } from '../conveyor/geometry-builder'
import { warehouseCatalogPanel, warehousePlugin } from '../index'
import {
  BOTTOM_TIER_M,
  CASTORS,
  DECK_PLATE_M,
  SPEC_CART_HEIGHT_M,
  SPEC_CART_LENGTH_M,
  SPEC_CART_WIDTH_M,
  TOTE_CLEARANCE_M,
  TOTE_FAMILIES,
  TOTE_FOOTPRINTS,
  toteHeightIds,
} from './catalog'
import { toteCartDefinition } from './definition'
import {
  getToteCartFrameGeometry,
  getToteGeometry,
  toteCartFrameKey,
  toteCartToteKey,
} from './geometry'
import {
  bottomTierYM,
  capacityKg,
  cartLengthM,
  cartWidthM,
  footprintM,
  loadedTiersOf,
  overallHeightM,
  tierPitchM,
  tierYM,
  tiltDipM,
  tiltRad,
  toteHeightIsExact,
  toteSizeM,
  toteSizeOf,
} from './metrics'
import { toteCartParametrics } from './parametrics'
import { type ToteCartDetail, toteCartFrameParts, toteParts } from './parts'
import { ToteCartNode } from './schema'

const cart = (overrides: Record<string, unknown> = {}) =>
  ToteCartNode.parse({ id: 'totecart_t', ...overrides })

type Shape = 'frame' | 'tote'

const GEOMETRY = { frame: getToteCartFrameGeometry, tote: getToteGeometry } as const
const KEY = { frame: toteCartFrameKey, tote: toteCartToteKey } as const

function fingerprint(node: ToteCartNode, shape: Shape, detail: ToteCartDetail): string {
  clearConveyorGeometryCache()
  const geometry = GEOMETRY[shape](node, detail)
  const position = geometry.getAttribute('position').array
  const color = geometry.getAttribute('color').array
  return `${Array.from(position).join(',')}|${Array.from(color).join(',')}`
}

// ── Kullanıcının kendi zarfı, hesaptan çıkıyor ───────────────────────────────

describe("kullanıcının spec'i hesapla yeniden üretiliyor", () => {
  /**
   * `tote-cart-spec.md`: 600 × 1500 × 400 mm. Bu paket yüksekliği bir alan
   * olarak SAKLAMIYOR, kasadan yukarı hesaplıyor — o yüzden 1500'ü tutturmak
   * bir tercih değil, modelin doğruluğunun kanıtı. Tutmazsa ya kat aralığı
   * ya en alt kat kotu yanlış demektir, ve ikisinin de ekranda belirtisi
   * olmaz: araba çizilir, sadece yanlış boyda.
   */
  const spec = cart({ tiers: 5, toteHeight: '220', toteFootprint: '600x400' })

  test('taban izi spec ile aynı — 600 × 400 kasa artı profil', () => {
    // Kasa 600 × 400 (ISO 3394 modülü), araba onun etrafında bir çerçeve.
    const [length, width] = footprintM(spec)
    expect(length).toBeGreaterThan(SPEC_CART_LENGTH_M)
    expect(width).toBeGreaterThan(SPEC_CART_WIDTH_M)
    // Ama çok değil: çerçeve iki yandan profil kalınlığı kadar taşıyor.
    expect(length - SPEC_CART_LENGTH_M).toBeLessThan(0.07)
    expect(width - SPEC_CART_WIDTH_M).toBeLessThan(0.07)
  })

  /**
   * 5 kat × 220 mm kasa 1,396 m veriyor — spec'in 1,500'ünün 10 cm altında,
   * ve bu FARK BİLİNÇLİ.
   *
   * Eski uygulama yüksekliği SABİTLEYİP rafları ona yayıyordu:
   * `shelfSpacing = (height − wheelRadius*2 − 0.2) / numLevels`, yani
   * 1,5 m'de üç kat için 400 mm aralık. 220 mm'lik bir kasanın üstünde
   * 180 mm boşluk demek bu — gerçek bir toplama arabasında olmayan bir
   * hava payı, ve tam olarak yüksekliğin bir GİRDİ olmasından çıkıyor.
   *
   * Bu model kasayı sabitleyip yüksekliği hesaplıyor, gerçek makinenin
   * boylandığı gibi (506CT ailesi "6 × 110'luk kasa → 1100 mm" diye
   * yayımlıyor). Sonuç daha kısa ve daha dürüst bir araba.
   *
   * Test yine de spec'i bir ÜST SINIR olarak tutuyor: 15 cm'i aşan bir
   * fark aralık hesabının bozulduğu anlamına gelir ve o sessiz bir hata.
   */
  test('5 kat × 220 mm kasa spec’in zarfına yakın çıkıyor', () => {
    const height = overallHeightM(spec)
    expect(height).toBeCloseTo(1.396, 3)
    expect(Math.abs(height - SPEC_CART_HEIGHT_M)).toBeLessThan(0.15)
    // Ve spec'i AŞMIYOR: eski uygulamanın arabası duran her yere bu da sığar.
    expect(height).toBeLessThan(SPEC_CART_HEIGHT_M)
  })

  test('5 kat, spec’in zarfına EN YAKIN kat sayısı', () => {
    // Varsayılanın 5 olmasının gerekçesi. 4 çok kısa, 6 spec'i aşıyor.
    const distance = (tiers: number) =>
      Math.abs(overallHeightM(cart({ tiers, toteHeight: '220' })) - SPEC_CART_HEIGHT_M)
    expect(distance(5)).toBeLessThan(distance(4))
    expect(distance(5)).toBeLessThan(distance(6))
  })

  test('katalog fırçası tam bu arabayı kuruyor', () => {
    // Fişten çıkan araba spec'in arabası olmalı; olmazsa katalog bir şey
    // gösterip başka bir şey yerleştirir.
    const tile = CATALOG_ITEMS.find((item) => item.id === 'tote-cart')
    if (tile?.brush?.kind !== 'totecart') throw new Error('tote-cart fişi bekleniyordu')
    expect(tile.brush.patch.tiers).toBe(5)
    expect(tile.brush.patch.toteHeight).toBe('220')
  })
})

// ── Yükseklik alan DEĞİL: kasalar birbirinin içinden geçemez ─────────────────

describe('kat aralığı kasadan TÜRÜYOR — geçişme imkânsız', () => {
  /**
   * Bu kind'ın tek büyük tasarım kararı ve tuttuğu hata tam olarak sessiz:
   * yükseklik saklansaydı, kullanıcı kat ekleyince ya da kasa boyunu
   * büyütünce aralık kasanın altına düşerdi ve kasalar bir üstteki tepsinin
   * içinden geçerdi. Hiçbir hata, hiçbir uyarı — sadece yanlış bir araba.
   */
  test('her kasa bir üstteki tepsinin ALTINDA kalıyor — bütün kombinasyonlarda', () => {
    for (const footprint of TOTE_FOOTPRINTS) {
      for (const height of toteHeightIds(footprint)) {
        for (const tiers of [1, 2, 5, 8]) {
          const node = cart({ toteFootprint: footprint, toteHeight: height, tiers })
          const toteHeight = toteSizeOf(node).heightM
          for (let tier = 0; tier + 1 < tiers; tier++) {
            const toteTop = tierYM(node, tier) + toteHeight
            const nextDeckBottom = tierYM(node, tier + 1) - DECK_PLATE_M
            expect(
              toteTop,
              `${footprint}/${height}/${tiers}: kat ${tier} kasası üsttekine giriyor`,
            ).toBeLessThanOrEqual(nextDeckBottom + 1e-9)
          }
        }
      }
    }
  })

  /**
   * EĞİMLİ araba — ve bu testin tuttuğu hata GERÇEKTEN oldu.
   *
   * İlk hâlde `tierPitchM` kasanın DİK boyunu okuyordu, oysa 15°'ye
   * eğilmiş 220 mm'lik bir Euro kasa 316 mm düşey yer kaplıyor. Sonuç:
   * kasanın uzak köşesi bir üstteki tepsinin 14 mm içinden geçiyor, yakın
   * köşesi de kendi tepsisinin 52 mm ALTINA sarkıyordu. Ekranda hiçbir
   * hata yok — sadece çeliğin içinden geçen plastik.
   */
  test('eğik kasa ne batıyor ne üsttekine giriyor — bütün kombinasyonlarda', () => {
    for (const footprint of TOTE_FOOTPRINTS) {
      for (const height of toteHeightIds(footprint)) {
        const node = cart({ toteFootprint: footprint, toteHeight: height, tilt: true, tiers: 4 })
        const theta = tiltRad(node)
        const H = toteSizeOf(node).heightM
        const W = TOTE_FAMILIES[footprint].widthM
        const dip = tiltDipM(node)

        // Döndürülmüş kutunun düşey uçları, kaldırma dahil.
        let low = Number.POSITIVE_INFINITY
        let high = Number.NEGATIVE_INFINITY
        for (const y of [0, H]) {
          for (const z of [-W / 2, W / 2]) {
            const rotated = y * Math.cos(theta) - z * Math.sin(theta)
            low = Math.min(low, rotated)
            high = Math.max(high, rotated)
          }
        }

        // Kasa eğik TEPSİNİN üstünde: ikisi aynı açıyla, aynı kat hattı
        // etrafında dönüyor, yani kasanın alçak köşesi tepsinin alçak
        // köşesiyle birebir aynı yerde. İkisi de kat hattının `dip` kadar
        // altına iniyor ve en alt kat o kadar yükseltilmiş (`bottomTierYM`).
        expect(low, `${footprint}/${height}: kasa tepsisinden ayrı düşüyor`).toBeCloseTo(-dip, 9)
        // Ve üstteki tepsinin altında kalıyor.
        expect(
          high,
          `${footprint}/${height}: eğik kasa üstteki tepsiye giriyor`,
        ).toBeLessThanOrEqual(tierPitchM(node) - DECK_PLATE_M + 1e-9)
      }
    }
  })

  test('eğim kat aralığını BÜYÜTÜYOR', () => {
    // Büyütmeseydi geçişme kaçınılmazdı.
    expect(tierPitchM(cart({ tilt: true }))).toBeGreaterThan(tierPitchM(cart({ tilt: false })))
  })

  test('eğimli arabanın zarfı da büyüyor', () => {
    // Zarf dik boyu okusaydı eğimli araba tavana girerdi.
    expect(overallHeightM(cart({ tilt: true }))).toBeGreaterThan(
      overallHeightM(cart({ tilt: false })),
    )
  })

  test('aralık kasa boyuyla birlikte büyüyor', () => {
    const short = cart({ toteHeight: '120' })
    const tall = cart({ toteHeight: '420' })
    expect(tierPitchM(tall) - tierPitchM(short)).toBeCloseTo(0.42 - 0.12, 9)
  })

  test('kat eklemek arabayı UZATIYOR, sıkıştırmıyor', () => {
    const five = cart({ tiers: 5 })
    const eight = cart({ tiers: 8 })
    expect(overallHeightM(eight)).toBeGreaterThan(overallHeightM(five))
    // Ve aralık aynı kalıyor — sıkıştırma yok.
    expect(tierPitchM(eight)).toBeCloseTo(tierPitchM(five), 9)
  })

  test('aralık = kasa + serbest yükseklik + tepsi sacı', () => {
    const node = cart({ toteHeight: '270' })
    expect(tierPitchM(node)).toBeCloseTo(0.27 + TOTE_CLEARANCE_M + DECK_PLATE_M, 9)
  })
})

// ── Yayımlanmış rakamlar ─────────────────────────────────────────────────────

describe('yayımlanmış rakamlar korunuyor', () => {
  test('en alt kat ROLLCART’ın 170 mm’si — şase izin verdiği sürece', () => {
    expect(bottomTierYM(cart({ castorDiameter: '100' }))).toBeCloseTo(BOTTOM_TIER_M, 9)
  })

  test('büyük tekerlek 170 mm’lik katı YUKARI itiyor', () => {
    /**
     * Yayımlanmış bir değeri körü körüne kullanmak, şasenin içinden geçen
     * bir tepsi çizmek olurdu: en alt tepsi alt çevre kuşağının ÜSTÜNDE
     * olmak zorunda, ve kuşak tekerleğin bağlantı plakasına oturuyor.
     *
     * Ø125'te Blickle'ın yapı yüksekliği 150 mm, artı 30 mm kuşak = 180 mm,
     * yani 170'i aşıyor. ROLLCART kendi arabasında Ø125 ile 170 mm
     * yayımlıyor — çelişki değil: onun tekerlek takımı Blickle'ın LE-TPA'sı
     * değil ve daha alçak. İki olgu da doğru; model FİZİKSEL kısıtı tutuyor
     * ve yayımlanmış 170'i taban olarak koruyor.
     */
    for (const diameter of ['125', '160'] as const) {
      const node = cart({ castorDiameter: diameter })
      expect(bottomTierYM(node)).toBeGreaterThan(BOTTOM_TIER_M)
      expect(bottomTierYM(node)).toBeGreaterThanOrEqual(CASTORS[diameter].buildHeightM)
    }
  })

  test('en alt tepsi HER çapta alt kuşağın üstünde', () => {
    // Bu, yukarıdaki iki testin gerçekten koruduğu şey.
    for (const diameter of ['100', '125', '160'] as const) {
      const node = cart({ castorDiameter: diameter })
      const rails = toteCartFrameParts(node, 'full').filter(
        (part) => part.role === 'frame' && part.center[1] < 0.3 && part.size[1] < 0.05,
      )
      expect(rails.length).toBeGreaterThan(0)
      for (const rail of rails) {
        expect(bottomTierYM(node), `Ø${diameter}`).toBeGreaterThanOrEqual(
          rail.center[1] + rail.size[1] / 2 - 1e-9,
        )
      }
    }
  })

  test('kasa merdivenleri AİLELERİ arasında karışmıyor', () => {
    // AUER'in 600 × 400 merdiveni ile VDA'nın 400 × 300 ızgarası ayrı
    // kaynaklar; birleştirmek var olmayan bir kasa üretir.
    const auer = toteHeightIds('600x400')
    const vda = toteHeightIds('400x300')
    expect(auer).toContain('220')
    expect(auer).toContain('420')
    expect(vda).toEqual(['147', '213', '280'])
    for (const height of vda) {
      expect(auer, `${height} iki merdivende birden`).not.toContain(height)
    }
  })

  test('ailenin dışındaki bir yükseklik EN YAKINA yaslanıyor, uydurulmuyor', () => {
    // Şema tek enum taşıyor (iki alan tutmak taban değişince ötekini
    // sessizce geçersiz bırakırdı), bedeli burada ödeniyor.
    const klt = cart({ toteFootprint: '400x300', toteHeight: '420' })
    expect(toteHeightIsExact(klt)).toBe(false)
    expect(toteSizeOf(klt).height).toBe('280')
    // Ve çizilen kasa gerçekten o merdivenden.
    expect(TOTE_FAMILIES['400x300'].heights).toContain(toteSizeOf(klt))
  })

  test('iç yükseklik dış yükseklikten KÜÇÜK — her merdiven basamağında', () => {
    // Eşit ya da büyük olursa kasanın tabanı yok demektir.
    for (const family of Object.values(TOTE_FAMILIES)) {
      for (const size of family.heights) {
        expect(size.innerHeightM, `${family.id}/${size.height}`).toBeLessThan(size.heightM)
        expect(size.innerHeightM).toBeGreaterThan(0)
      }
    }
  })

  test('tekerlek kapasitesi çapla birlikte artıyor — Blickle TPA tablosu', () => {
    expect(CASTORS['100'].capacityKg).toBeLessThan(CASTORS['125'].capacityKg)
    expect(CASTORS['125'].capacityKg).toBeLessThan(CASTORS['160'].capacityKg)
  })

  test('araba kapasitesi tekerlekle gövdenin KÜÇÜĞÜ', () => {
    // Ø100: 4 × 110 = 440 > 250 gövde → gövde sınırlıyor.
    expect(capacityKg(cart({ castorDiameter: '100' }))).toBe(250)
    // Hiçbir çapta gövdenin üstüne çıkmıyor.
    for (const diameter of ['100', '125', '160'] as const) {
      expect(capacityKg(cart({ castorDiameter: diameter }))).toBeLessThanOrEqual(250)
    }
  })
})

// ── Geometri anahtarı: iki yönlü kapsama ─────────────────────────────────────

describe('geometri anahtarı kapsaması — iki yönlü', () => {
  beforeEach(() => {
    clearConveyorGeometryCache()
  })

  const VARIANTS: Array<
    [label: string, base: Record<string, unknown>, changed: Record<string, unknown>]
  > = [
    ['kasa tabanı', {}, { toteFootprint: '400x300' }],
    ['kasa boyu', {}, { toteHeight: '320' }],
    ['kat sayısı', {}, { tiers: 3 }],
    ['tekerlek çapı', {}, { castorDiameter: '160' }],
    ['itme kolu', {}, { hasHandle: false }],
    ['çerçeve rengi', {}, { frameColor: '#112233' }],
    ['kasa rengi', {}, { toteColor: '#445566' }],
    // POZ ve SAYIM — hiçbiri bir vertex kımıldatmıyor.
    ['eğim', {}, { tilt: true }],
    ['dolu kat sayısı', {}, { loadedTiers: 2 }],
    ['ad', {}, { name: 'Araba 2' }],
    ['konum', {}, { position: [4, 0, -2] }],
    ['dönüş', {}, { rotation: [0, Math.PI / 2, 0] }],
  ]

  /**
   * TEK KATLI taban ayrı bir eksen ve boşuna değil: bir gözden kaçırma tam
   * orada yakalandı. Tek katta ikinci tepsi yok, yani kat aralığı hiçbir
   * vertex kımıldatmıyor — ve anahtar onu koşulsuz yazdığı sürece 75 mm'lik
   * kasayla 420 mm'lik kasa birebir aynı çerçeveye iki ayrı buffer
   * bastırıyordu. Beş katlı tabanla koşan bir kapsama testi bunu asla
   * göremez.
   */
  const BASES: Array<[string, Record<string, unknown>]> = [
    ['5 kat', {}],
    ['tek kat', { tiers: 1 }],
  ]

  for (const shape of ['frame', 'tote'] as const) {
    for (const detail of ['full', 'simple'] as const) {
      for (const [baseLabel, extraBase] of BASES) {
        for (const [label, base, changed] of VARIANTS) {
          if ('tiers' in changed) continue
          test(`${shape}/${detail}/${baseLabel}: ${label} — anahtar ile mesh aynı cevabı veriyor`, () => {
            const before = cart({ ...extraBase, ...base })
            const after = cart({ ...extraBase, ...base, ...changed })

            const meshChanged =
              fingerprint(before, shape, detail) !== fingerprint(after, shape, detail)
            const keyChanged = KEY[shape](before, detail) !== KEY[shape](after, detail)

            expect(
              keyChanged,
              `${shape}/${baseLabel}/${label}: mesh ${meshChanged ? 'değişti' : 'değişmedi'}`,
            ).toBe(meshChanged)
          })
        }
      }
      for (const [label, base, changed] of VARIANTS) {
        test(`${shape}/${detail}: ${label} — anahtar ile mesh aynı cevabı veriyor`, () => {
          const before = cart(base)
          const after = cart({ ...base, ...changed })

          const meshChanged =
            fingerprint(before, shape, detail) !== fingerprint(after, shape, detail)
          const keyChanged = KEY[shape](before, detail) !== KEY[shape](after, detail)

          expect(
            keyChanged,
            `${shape}/${label}: mesh ${meshChanged ? 'değişti' : 'değişmedi'}`,
          ).toBe(meshChanged)
        })
      }
    }
  }

  test('eğim KASA anahtarında yok, ÇERÇEVE anahtarında var', () => {
    /**
     * İncelikli ve ilk hâlinde yanlış yazılmıştı.
     *
     * Kasanın KENDİSİ eğimden etkilenmiyor — eğim bir grup dönüşümü, ve
     * eğimli araba düz arabayla AYNI kasa buffer'ını paylaşmalı.
     *
     * Ama çerçeve etkileniyor: eğik kasa daha fazla düşey yer kaplıyor
     * (`H·cos θ + W·sin θ`), yani kat aralığı büyüyor ve TEPSİLER başka
     * kotlara gidiyor. Anahtar aralığı taşıdığı için bunu kendiliğinden
     * yakalıyor — ve yakalamasaydı eğimli araba düz arabanın tepsilerini
     * çizerdi.
     */
    const plain = cart()
    const tilted = cart({ tilt: true })
    for (const detail of ['full', 'simple'] as const) {
      expect(KEY.tote(tilted, detail), `tote/${detail}`).toBe(KEY.tote(plain, detail))
      expect(KEY.frame(tilted, detail), `frame/${detail}`).not.toBe(KEY.frame(plain, detail))
    }
  })

  test('dolu kat sayısı HİÇBİR anahtarda yok', () => {
    // Renderer'ın mesh SAYISI, şeklin kendisi değil.
    const plain = cart()
    for (const patch of [{ loadedTiers: 1 }, { loadedTiers: 0 }]) {
      const other = cart(patch)
      for (const shape of ['frame', 'tote'] as const) {
        for (const detail of ['full', 'simple'] as const) {
          expect(KEY[shape](other, detail), `${shape}/${detail} ${JSON.stringify(patch)}`).toBe(
            KEY[shape](plain, detail),
          )
        }
      }
    }
  })

  test('kasa buffer’ı kat sayısından BAĞIMSIZ', () => {
    // Kasayı çerçeveye kaynatsaydık her kat sayısı ayrı bir kasa kopyası
    // basardı. Ayrı tutmanın bütün kazancı bu.
    expect(toteCartToteKey(cart({ tiers: 2 }), 'full')).toBe(
      toteCartToteKey(cart({ tiers: 8 }), 'full'),
    )
    expect(toteCartFrameKey(cart({ tiers: 2 }), 'full')).not.toBe(
      toteCartFrameKey(cart({ tiers: 8 }), 'full'),
    )
  })
})

// ── Kasa gerçekten kap — dolu blok değil ─────────────────────────────────────

describe('kasa açık bir kap', () => {
  test('tabanı ve dört duvarı var, üstü açık', () => {
    const parts = toteParts(cart(), 'simple')
    expect(parts.filter((part) => part.role === 'tote-inner').length).toBe(1)
    expect(parts.filter((part) => part.role === 'tote').length).toBe(4)
  })

  test('duvarların tepesi kasanın tepesinde — daha aşağı bir duvar kap değil', () => {
    const node = cart({ toteHeight: '320' })
    const height = toteSizeOf(node).heightM
    for (const wall of toteParts(node, 'simple').filter((part) => part.role === 'tote')) {
      expect(wall.center[1] + wall.size[1] / 2).toBeCloseTo(height, 9)
    }
  })

  test('duvarlar dış zarfın İÇİNDE — dışarı taşan bir kasa yanlış yer kaplar', () => {
    const node = cart()
    const [length, , width] = toteSizeM(node)
    for (const part of toteParts(node, 'full')) {
      expect(Math.abs(part.center[0]) + part.size[0] / 2).toBeLessThanOrEqual(length / 2 + 1e-9)
      expect(Math.abs(part.center[2]) + part.size[2] / 2).toBeLessThanOrEqual(width / 2 + 1e-9)
      expect(part.center[1] + part.size[1] / 2).toBeLessThanOrEqual(toteSizeOf(node).heightM + 1e-9)
    }
  })
})

describe('çerçeve arabayı gerçekten taşıyor', () => {
  test('dikmeler en üst tepsiye kadar çıkıyor', () => {
    const node = cart({ tiers: 6 })
    const posts = toteCartFrameParts(node, 'full').filter(
      (part) => part.role === 'frame' && part.size[1] > 0.5,
    )
    expect(posts.length).toBe(4)
    for (const post of posts) {
      expect(post.center[1] + post.size[1] / 2).toBeGreaterThanOrEqual(
        tierYM(node, node.tiers - 1) - 1e-9,
      )
    }
  })

  test('hiçbir parça zeminin ALTINA inmiyor', () => {
    for (const diameter of ['100', '125', '160'] as const) {
      for (const part of toteCartFrameParts(cart({ castorDiameter: diameter }), 'full')) {
        expect(
          part.center[1] - part.size[1] / 2,
          `Ø${diameter} ${part.role}`,
        ).toBeGreaterThanOrEqual(-1e-9)
      }
    }
  })

  test('tekerlekler zemine değiyor — havada duran araba yok', () => {
    for (const diameter of ['100', '125', '160'] as const) {
      const tyres = toteCartFrameParts(cart({ castorDiameter: diameter }), 'full').filter(
        (part) => part.role === 'tyre',
      )
      expect(tyres.length).toBe(4)
      for (const tyre of tyres) {
        expect(tyre.center[1] - tyre.size[1] / 2).toBeCloseTo(0, 9)
      }
    }
  })

  test('kolsuz arabada kol parçası hiç üretilmiyor', () => {
    const withHandle = toteCartFrameParts(cart({ hasHandle: true }), 'full').length
    const without = toteCartFrameParts(cart({ hasHandle: false }), 'full').length
    expect(without).toBeLessThan(withHandle)
  })

  test('kolsuz arabanın dikmeleri kol kotuna KADAR çıkmıyor', () => {
    /**
     * Sessiz hata: `frameTop` kol kotunu koşulsuz okuyordu, yani kolsuz
     * bir araba hiçbir işe yaramayan dört çıplak direk taşıyordu — ve zarf
     * kolsuzken kol kotunu saymadığı için o direkler çarpışma kutusunun
     * DIŞINDA kalıyordu. Yani ekranda görünen ama çarpışmayan çelik.
     */
    const node = cart({ hasHandle: false, tiers: 2, toteHeight: '220' })
    const envelope = overallHeightM(node)
    for (const part of toteCartFrameParts(node, 'full')) {
      expect(part.center[1] + part.size[1] / 2, `${part.role} zarfın dışında`).toBeLessThanOrEqual(
        envelope + 1e-9,
      )
    }
  })

  test('tekerlekler taban izinin İÇİNDE — her çapta', () => {
    // Ø160'ın yarıçapı 80 mm, seçilmiş kaçıklık 70 mm: kaçıklık yarıçapa
    // yükseltilmeseydi tekerlek izin 10 mm dışına taşardı ve çarpışma
    // kutusu onu görmezdi.
    for (const diameter of ['100', '125', '160'] as const) {
      const node = cart({ castorDiameter: diameter })
      const [length, width] = footprintM(node)
      for (const part of toteCartFrameParts(node, 'full').filter((p) => p.role === 'tyre')) {
        expect(Math.abs(part.center[0]) + part.size[0] / 2, `Ø${diameter} X`).toBeLessThanOrEqual(
          length / 2 + 1e-9,
        )
        expect(Math.abs(part.center[2]) + part.size[2] / 2, `Ø${diameter} Z`).toBeLessThanOrEqual(
          width / 2 + 1e-9,
        )
      }
    }
  })

  test('bordür kasanın DIŞINDA — plastiğin içinden geçmiyor', () => {
    /**
     * Sessiz hata: tepsi tam kasa ölçüsündeyken bordür kasanın duvarının
     * İÇİNDE kalıyordu — 588 × 7 × 3 mm'lik bir çelik parçası plastiğin
     * içinde, ve dışardan bakınca hiçbir şey görünmüyor. Tepsiye kasanın
     * düşebilmesi için zaten gereken pay bunu da çözüyor.
     */
    for (const footprint of TOTE_FOOTPRINTS) {
      const node = cart({ toteFootprint: footprint })
      const [toteLength, , toteWidth] = toteSizeM(node)
      const lips = toteCartFrameParts(node, 'full').filter(
        (part) => part.role === 'deck' && part.size[1] > DECK_PLATE_M,
      )
      expect(lips.length).toBeGreaterThan(0)
      for (const lip of lips) {
        const insideX = Math.abs(lip.center[0]) + lip.size[0] / 2 <= toteLength / 2 + 1e-9
        const insideZ = Math.abs(lip.center[2]) + lip.size[2] / 2 <= toteWidth / 2 + 1e-9
        expect(insideX && insideZ, `${footprint}: bordür kasanın içinde`).toBe(false)
      }
    }
  })

  test('eğimli arabada TEPSİ de eğik — kasa havada asılı değil', () => {
    // İlk hâlde yalnız kasa dönüyordu: eğik kasa düz bir tepsinin üstünde
    // duruyor, yani iki köşesi havada, iki köşesi sacın içinde kalıyordu.
    const decks = toteCartFrameParts(cart({ tilt: true }), 'full').filter(
      (part) => part.role === 'deck',
    )
    expect(decks.length).toBeGreaterThan(0)
    for (const deck of decks) {
      expect(deck.tiltX ?? 0).toBeCloseTo(tiltRad(cart({ tilt: true })), 9)
    }
    // Düz arabada hiçbir tepsi dönmüyor.
    for (const deck of toteCartFrameParts(cart(), 'full').filter((p) => p.role === 'deck')) {
      expect(deck.tiltX ?? 0).toBe(0)
    }
  })
})

describe('zarf her şeyi kapsıyor', () => {
  test('alçak arabada KOL en yüksek nokta ve zarfa giriyor', () => {
    // Tek katlı bir arabada üst kasa kolun altında kalıyor. Zarfı yalnız
    // kasaya bağlamak kolu çarpışma denetiminin dışında bırakırdı ve
    // araba kolunu duvara sokardı.
    const low = cart({ tiers: 1, toteHeight: '120' })
    const stack = tierYM(low, 0) + toteSizeOf(low).heightM
    expect(overallHeightM(low)).toBeGreaterThan(stack)
  })

  test('yüksek arabada ÜST KASA en yüksek nokta', () => {
    const tall = cart({ tiers: 6, toteHeight: '320' })
    expect(overallHeightM(tall)).toBeCloseTo(tierYM(tall, 5) + toteSizeOf(tall).heightM, 9)
  })

  test('kol kapatılınca zarf kasa yığınına iniyor', () => {
    const low = cart({ tiers: 1, toteHeight: '120', hasHandle: false })
    expect(overallHeightM(low)).toBeCloseTo(tierYM(low, 0) + toteSizeOf(low).heightM, 9)
  })

  test('zarf sürükleme sınırıyla AYNI', () => {
    // İkisi ayrışırsa sürükleme kutusu ile çarpışma kutusu farklı yerlerde
    // olur ve kullanıcı yeşil kutuyu duvara sokabilir.
    const node = cart({ tiers: 4 })
    const bounds = toteCartDefinition.capabilities.dragBounds(node as never)
    expect(bounds.size).toEqual([cartLengthM(node), overallHeightM(node), cartWidthM(node)])
    expect(bounds.centerY).toBeCloseTo(overallHeightM(node) / 2, 9)
  })
})

describe('kısmen toplanmış araba', () => {
  test('dolu kat sayısı kat sayısını aşamaz', () => {
    expect(loadedTiersOf(cart({ tiers: 3, loadedTiers: 7 }))).toBe(3)
  })

  test('boş bırakılırsa hepsi dolu', () => {
    expect(loadedTiersOf(cart({ tiers: 4 }))).toBe(4)
  })

  test('sıfır kasa geçerli — boş araba', () => {
    expect(loadedTiersOf(cart({ tiers: 4, loadedTiers: 0 }))).toBe(0)
  })
})

// ── Uyarılar ─────────────────────────────────────────────────────────────────

describe('uyarılar var olan durumları anlatıyor', () => {
  const issuesOf = (node: ToteCartNode) =>
    (toteCartParametrics.invariants ?? []).flatMap((check) => check(node))

  test('katalog varsayılanı sessiz', () => {
    expect(issuesOf(cart())).toEqual([])
  })

  test('ailenin merdiveninde olmayan kasa uyarıyor', () => {
    const issues = issuesOf(cart({ toteFootprint: '400x300', toteHeight: '420' }))
    expect(issues.some((issue) => issue.field === 'toteHeight')).toBe(true)
  })

  test('itilemeyecek kadar yüksek araba uyarıyor', () => {
    const issues = issuesOf(cart({ tiers: 8, toteHeight: '320' }))
    expect(issues.some((issue) => issue.field === 'tiers')).toBe(true)
  })

  test('fazla dolu kat uyarıyor', () => {
    const issues = issuesOf(cart({ tiers: 2, loadedTiers: 5 }))
    expect(issues.some((issue) => issue.field === 'loadedTiers')).toBe(true)
  })

  test('uyarı metinleri boş değil', () => {
    for (const issue of issuesOf(cart({ tiers: 8, toteHeight: '420' }))) {
      expect(issue.msg.length).toBeGreaterThan(20)
    }
  })
})

// ── Kayıt ────────────────────────────────────────────────────────────────────

describe('tanım ve manifest', () => {
  test('manifest kind’ı taşıyor', () => {
    const kinds = (warehousePlugin.nodes ?? []).map((node) => (node as { kind: string }).kind)
    expect(kinds).toContain('warehouse:tote-cart')
  })

  test('panel kind listesi manifestle aynı fikirde', () => {
    expect(warehouseCatalogPanel.kinds).toContain('warehouse:tote-cart')
  })

  test('katalog fişleri var ve bölümleri gerçek', () => {
    const tiles = CATALOG_ITEMS.filter((item) => item.kind === 'warehouse:tote-cart')
    expect(tiles.length).toBe(2)
    const sections = new Set(CATALOG_SECTIONS.map((section) => section.id))
    for (const tile of tiles) expect(sections.has(tile.sectionId)).toBe(true)
  })

  test('varsayılanlar şemadan geliyor ve ad taşıyor', () => {
    const defaults = toteCartDefinition.defaults() as Record<string, unknown>
    expect(defaults.name).toBe('Tote cart')
    expect(defaults.tiers).toBe(5)
    expect(defaults.toteHeight).toBe('220')
  })

  test('şemada `height` diye bir alan YOK', () => {
    // Bu kind'ın tasarımı. Alan eklenirse kat aralığı ondan türetilmeye
    // başlar ve geçişme kapısı açılır.
    const parsed = cart() as Record<string, unknown>
    expect('height' in parsed).toBe(false)
    expect('overallHeight' in parsed).toBe(false)
  })
})
