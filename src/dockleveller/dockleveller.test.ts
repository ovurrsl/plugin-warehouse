import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CATALOG_ITEMS, CATALOG_SECTIONS } from '../catalog'
import { clearConveyorGeometryCache } from '../conveyor/geometry-builder'
import { warehouseCatalogPanel, warehousePlugin } from '../index'
import {
  EN1398_MAX_GRADIENT,
  PLATFORM_LENGTHS,
  PLATFORM_PLATE_M,
  TELESCOPIC_LIP_MAX_M,
  TELESCOPIC_LIP_MAX_SHORT_M,
  WORKING_RANGE_BANDS,
} from './catalog'
import { dockLevellerDefinition } from './definition'
import {
  dockLevellerDeckKey,
  dockLevellerFrameKey,
  dockLevellerLipKey,
  getDockLevellerDeckGeometry,
  getDockLevellerFrameGeometry,
  getDockLevellerLipGeometry,
} from './geometry'
import {
  aboveFloorHeightM,
  deckAngleRad,
  footprintM,
  gradient,
  hingedLipAngleRad,
  isStored,
  lipFullLengthM,
  lipReachM,
  platformLengthM,
  riseM,
  telescopicLipMaxM,
  widthM,
  workingRangeM,
} from './metrics'
import { dockLevellerParametrics } from './parametrics'
import {
  type DockLevellerDetail,
  dockLevellerDeckParts,
  dockLevellerFrameParts,
  dockLevellerLipParts,
} from './parts'
import { DockLevellerNode } from './schema'

const leveller = (overrides: Record<string, unknown> = {}) =>
  DockLevellerNode.parse({ id: 'dockleveller_t', ...overrides })

type Shape = 'frame' | 'deck' | 'lip'

const GEOMETRY = {
  frame: getDockLevellerFrameGeometry,
  deck: getDockLevellerDeckGeometry,
  lip: getDockLevellerLipGeometry,
} as const

const KEY = {
  frame: dockLevellerFrameKey,
  deck: dockLevellerDeckKey,
  lip: dockLevellerLipKey,
} as const

/** Mesh'in ölçülebilir parmak izi: konum + renk tamponu. */
function fingerprint(node: DockLevellerNode, shape: Shape, detail: DockLevellerDetail): string {
  clearConveyorGeometryCache()
  const geometry = GEOMETRY[shape](node, detail)
  const position = geometry.getAttribute('position').array
  const color = geometry.getAttribute('color').array
  return `${Array.from(position).join(',')}|${Array.from(color).join(',')}`
}

// ── Dinlenme konumu: kullanıcının istediği şeyin tamamı ──────────────────────

describe('kapanınca zeminle aynı seviyede', () => {
  /**
   * Kullanıcının şartı buydu: "kapanınca zeminle aynı seviyede olan liftli
   * araç yükleme rampası." Aşağıdaki dört ölçüm o cümlenin makine
   * karşılığı, ve hiçbirinin bozulduğunda ekranda bir hatası yok — rampa
   * her hâlükârda çizilir, sadece yanlış çizilir.
   */
  const stored = leveller()

  test('varsayılan düğüm DİNLENMEDE doğuyor', () => {
    expect(stored.inclination).toBe(0)
    expect(isStored(stored)).toBe(true)
  })

  test('tabla düz — menteşe açısı sıfır', () => {
    expect(deckAngleRad(stored)).toBe(0)
    expect(riseM(stored)).toBe(0)
  })

  test('zeminin üstünde yalnız tabla sacı var', () => {
    // Çerçevenin 585 mm'si zarfa girseydi rampanın üstünden geçen her şey
    // çakışık sayılırdı — oysa üstünden geçmek onun işi.
    expect(aboveFloorHeightM(stored)).toBeCloseTo(PLATFORM_PLATE_M, 9)
  })

  test('dudak dışarı uzanmıyor — iki tipte de', () => {
    expect(lipReachM(stored)).toBe(0)
    expect(lipReachM(leveller({ lip: 'telescopic', lipExtension: 1 }))).toBe(0)
  })

  test('menteşeli dudak yuvasına dik asılı — çukurun içinde', () => {
    expect(hingedLipAngleRad(stored)).toBeCloseTo(-Math.PI / 2, 9)
    expect(hingedLipAngleRad(leveller({ inclination: 0.5 }))).toBe(0)
  })

  test('kaydırıcı ne derse desin dinlenmede dudak çekili', () => {
    // Kullanıcı uzanımı 1'de bırakıp eğimi sıfırlıyor. Kaydırıcıyı okuyup
    // dudağı uzatmak, var olmayan bir makineyi çizmek olurdu.
    const contradiction = leveller({ lip: 'telescopic', lipExtension: 1, inclination: 0 })
    expect(lipReachM(contradiction)).toBe(0)
  })

  test('makinenin gövdesi zeminin ALTINDA', () => {
    // Çerçeve parçalarının hiçbiri zeminin üstüne çıkmamalı — tampon ve
    // kumanda direği hariç, ikisi de bilerek dışarıda.
    const parts = dockLevellerFrameParts(
      leveller({ hasBumpers: false, hasControlPost: false }),
      'full',
    )
    expect(parts.length).toBeGreaterThan(0)
    for (const part of parts) {
      const top = part.center[1] + part.size[1] / 2
      expect(top, `${part.role} zeminin üstüne çıkıyor`).toBeLessThanOrEqual(1e-9)
    }
  })

  test('tabla sacının ÜST yüzü tam zemin kotunda', () => {
    // Bir milimetre aşağıda kalsa döşemeyle z-savaşına girer; bir milimetre
    // yukarıda dursa "aynı seviyede" değil demektir.
    const deck = dockLevellerDeckParts(leveller(), 'full').find((part) => part.role === 'deck')
    if (!deck) throw new Error('tabla sacı bekleniyordu')
    expect(deck.center[1] + deck.size[1] / 2).toBeCloseTo(0, 9)
  })
})

// ── Yayımlanmış rakamlar ─────────────────────────────────────────────────────

describe('çalışma aralığı yayımlanmış tabloyla uyuşuyor', () => {
  test('bant uçları TAM olarak tablodaki değerler', () => {
    // Ara değerler benim, uçlar Stertil'in. Uçların kayması, yayımlanmış bir
    // rakamı sessizce değiştirmek demek.
    for (const band of WORKING_RANGE_BANDS) {
      const low = workingRangeM(leveller({ length: String(band.fromM * 1000) as never }))
      const high = workingRangeM(leveller({ length: String(band.toM * 1000) as never }))
      expect(low.aboveM).toBeCloseTo(band.aboveFromM, 9)
      expect(low.belowM).toBeCloseTo(band.belowFromM, 9)
      expect(high.aboveM).toBeCloseTo(band.aboveToM, 9)
      expect(high.belowM).toBeCloseTo(band.belowToM, 9)
    }
  })

  test('aralık boyla birlikte MONOTON büyüyor', () => {
    // Bir ara değer hatası en kolay buradan görünür: uzun tabla kısa tabladan
    // daha az erişemez.
    let previous = -1
    for (const length of PLATFORM_LENGTHS) {
      const above = workingRangeM(leveller({ length })).aboveM
      expect(above, `${length} mm`).toBeGreaterThanOrEqual(previous)
      previous = above
    }
  })

  test('yukarı ile aşağı SİMETRİK DEĞİL', () => {
    // Simetrik yapmak `inclination`'ı tek bir metreye çevirmek olurdu ve
    // makinenin yayımlanmış davranışını silerdi.
    const range = workingRangeM(leveller({ length: '2000' }))
    expect(range.aboveM).not.toBeCloseTo(range.belowM, 3)
  })

  test('eğim tabla ARTI dudak üstünden ölçülüyor', () => {
    // Yalnız tablaya bakan bir hesap kısa rampaları haksız yere EN 1398'in
    // üstünde gösterir. Uzun dudak eğimi düşürmeli.
    const short = leveller({ length: '2000', lipLength: '350', inclination: 1 })
    const long = leveller({ length: '2000', lipLength: '500', inclination: 1 })
    expect(gradient(long)).toBeLessThan(gradient(short))
    // Ve tabla-tek hesabıyla aynı olmamalı.
    expect(gradient(short)).not.toBeCloseTo(Math.abs(riseM(short)) / platformLengthM(short), 6)
  })

  test('katalog varsayılanı EN 1398 sınırının altında', () => {
    // Fişten çıkan makine standardı ihlal ediyorsa panel ilk açılışta sarı
    // yanar ve uyarı anlamını kaybeder.
    for (const inclination of [-1, -0.5, 0, 0.5, 1]) {
      const node = leveller({ inclination })
      expect(gradient(node), `eğim ${inclination}`).toBeLessThanOrEqual(EN1398_MAX_GRADIENT)
    }
  })

  test('teleskopik dudak kısa tablada 785 mm ile sınırlı', () => {
    expect(telescopicLipMaxM(leveller({ length: '2000' }))).toBeCloseTo(
      TELESCOPIC_LIP_MAX_SHORT_M,
      9,
    )
    expect(telescopicLipMaxM(leveller({ length: '2200' }))).toBeCloseTo(
      TELESCOPIC_LIP_MAX_SHORT_M,
      9,
    )
    expect(telescopicLipMaxM(leveller({ length: '2500' }))).toBeCloseTo(TELESCOPIC_LIP_MAX_M, 9)
  })
})

describe('tabla RİJİT — kalkarken uzamıyor', () => {
  test('menteşe açısı asin, atan değil', () => {
    // `atan` kullanılsaydı tablanın yatay erişimi boyunda kalır, yani tabla
    // kalktıkça uzardı. Fark küçük ve tam olarak bu yüzden sessiz.
    const node = leveller({ inclination: 1, length: '2500' })
    const angle = deckAngleRad(node)
    const length = platformLengthM(node)
    expect(Math.sin(angle) * length).toBeCloseTo(riseM(node), 9)
    expect(Math.cos(angle) * length).toBeLessThan(length)
  })

  test('aşağı inince açı negatif', () => {
    expect(deckAngleRad(leveller({ inclination: -1 }))).toBeLessThan(0)
  })
})

describe('iz dudağı içermiyor', () => {
  test('açık dudak izi büyütmüyor', () => {
    // Kattığımızda rampa kapının dışındaki her şeyle çarpışırdı, ve orada
    // zaten bir tır var.
    const stored = leveller()
    const deployed = leveller({ inclination: 1 })
    expect(footprintM(deployed)).toEqual(footprintM(stored))
    expect(footprintM(stored)[0]).toBeCloseTo(platformLengthM(stored), 9)
    expect(footprintM(stored)[1]).toBeCloseTo(widthM(stored), 9)
  })

  test('zarf yalnız tabla kalkınca büyüyor, inince değil', () => {
    expect(aboveFloorHeightM(leveller({ inclination: 1 }))).toBeGreaterThan(PLATFORM_PLATE_M)
    // Aşağı inen rampa kimsenin yoluna çıkmıyor; negatif zarf host'un
    // `canPlaceOnFloor`'unu anlamsız kılardı.
    expect(aboveFloorHeightM(leveller({ inclination: -1 }))).toBeCloseTo(PLATFORM_PLATE_M, 9)
  })
})

// ── Geometri anahtarı: iki yönlü kapsama ─────────────────────────────────────

describe('geometri anahtarı kapsaması — iki yönlü', () => {
  beforeEach(() => {
    clearConveyorGeometryCache()
  })

  /**
   * Her satır bir alanı oynatıyor; test hangi yöne düşeceğini VARSAYMIYOR.
   * Mesh ölçülüyor, anahtarla karşılaştırılıyor ve ikisinin AYNI cevabı
   * vermesi şart koşuluyor: eksik rapor iki rampanın tek buffer'ı
   * paylaşması, aşırı rapor paylaşımın bedelsiz bölünmesi.
   */
  const VARIANTS: Array<
    [label: string, base: Record<string, unknown>, changed: Record<string, unknown>]
  > = [
    ['genişlik', {}, { width: '2250' }],
    ['tabla boyu', {}, { length: '3500' }],
    ['çerçeve yüksekliği', {}, { frameHeight: '700' }],
    ['dudak boyu', {}, { lipLength: '500' }],
    ['dudak tipi', {}, { lip: 'telescopic' }],
    ['tampon', {}, { hasBumpers: false }],
    ['kumanda direği', {}, { hasControlPost: false }],
    ['çerçeve rengi', {}, { frameColor: '#112233' }],
    ['tabla rengi', {}, { deckColor: '#445566' }],
    // POZ — hiçbiri hiçbir vertex kımıldatmıyor. Anahtara girerlerse
    // kaydırıcının her adımı yeni bir merged buffer basar.
    ['eğim', {}, { inclination: 0.75 }],
    ['eğim (aşağı)', {}, { inclination: -1 }],
    ['dudak uzanımı', { lip: 'telescopic' }, { lipExtension: 0.4 }],
    ['kapasite', {}, { capacity: '100' }],
    ['ad', {}, { name: 'Rampa 2' }],
    ['konum', {}, { position: [4, 0, -2] }],
    ['dönüş', {}, { rotation: [0, Math.PI / 2, 0] }],
  ]

  for (const shape of ['frame', 'deck', 'lip'] as const) {
    for (const detail of ['full', 'simple'] as const) {
      for (const [label, base, changed] of VARIANTS) {
        test(`${shape}/${detail}: ${label} — anahtar ile mesh aynı cevabı veriyor`, () => {
          const before = leveller(base)
          const after = leveller({ ...base, ...changed })

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

  test('eğim HİÇBİR anahtarda geçmiyor — kaydırıcı buffer basmıyor', () => {
    // Yukarıdaki kapsama bunu zaten yakalar, ama bu testin söylediği şey
    // farklı: tasarımın kendisi. Eğim bir poz, bir şekil değil.
    const flat = leveller()
    for (const inclination of [-1, -0.3, 0.25, 1]) {
      const tilted = leveller({ inclination })
      for (const shape of ['frame', 'deck', 'lip'] as const) {
        for (const detail of ['full', 'simple'] as const) {
          expect(KEY[shape](tilted, detail), `${shape}/${detail} @ ${inclination}`).toBe(
            KEY[shape](flat, detail),
          )
        }
      }
    }
  })

  test('teleskopik dudak TAM boyunda inşa ediliyor — uzanım cebin dışı', () => {
    // Kısaltarak inşa etseydik uzanım kaydırıcısı adım başına bir buffer
    // basardı; kaydırarak inşa etmek makinenin gerçek çalışma biçimi de.
    const retracted = leveller({ lip: 'telescopic', lipExtension: 0.2, inclination: 1 })
    const extended = leveller({ lip: 'telescopic', lipExtension: 1, inclination: 1 })
    expect(lipFullLengthM(retracted)).toBe(lipFullLengthM(extended))
    expect(dockLevellerLipKey(retracted, 'full')).toBe(dockLevellerLipKey(extended, 'full'))
    expect(lipReachM(retracted)).toBeLessThan(lipReachM(extended))
  })
})

// ── Ayak koruma eteği ────────────────────────────────────────────────────────

describe('ayak koruma eteği tablanın altında', () => {
  test('etek dinlenmede zeminin altında kalıyor', () => {
    // Göründüğü an, tam da yanda makas boşluğunun açıldığı an. Tablanın
    // üstüne çıksaydı forkliftin geçtiği yüzeyde bir set olurdu.
    const guards = dockLevellerDeckParts(leveller(), 'full').filter((part) => part.role === 'guard')
    expect(guards.length).toBe(2)
    for (const guard of guards) {
      expect(guard.center[1] + guard.size[1] / 2).toBeLessThanOrEqual(-PLATFORM_PLATE_M + 1e-9)
    }
  })

  test('etekler tablanın İÇİNDE — yanlardan taşmıyor', () => {
    const node = leveller()
    const half = widthM(node) / 2
    for (const guard of dockLevellerDeckParts(node, 'full').filter((p) => p.role === 'guard')) {
      expect(Math.abs(guard.center[2]) + guard.size[2] / 2).toBeLessThanOrEqual(half + 1e-9)
    }
  })

  test('uzak katmanda da var — güvenlik parçası detay değil', () => {
    const guards = dockLevellerDeckParts(leveller(), 'simple').filter((p) => p.role === 'guard')
    expect(guards.length).toBe(2)
  })
})

describe('dudak ucundaki pah', () => {
  test('uç bloğu ana sactan İNCE — basamak değil rampa', () => {
    const parts = dockLevellerLipParts(leveller({ lipLength: '500' }), 'full')
    expect(parts.length).toBe(2)
    const [body, tip] = parts
    if (!body || !tip) throw new Error('iki parça bekleniyordu')
    expect(tip.size[1]).toBeLessThan(body.size[1])
    expect(tip.center[0]).toBeGreaterThan(body.center[0])
  })

  test('uzak katmanda tek blok', () => {
    expect(dockLevellerLipParts(leveller(), 'simple').length).toBe(1)
  })
})

// ── Uyarılar ─────────────────────────────────────────────────────────────────

describe('uyarılar var olan durumları anlatıyor', () => {
  const issuesOf = (node: DockLevellerNode) =>
    (dockLevellerParametrics.invariants ?? []).flatMap((check) => check(node))

  test('katalog varsayılanı sessiz', () => {
    // Kutudan çıkan makine uyarı basıyorsa uyarılar görünmez olur.
    expect(issuesOf(leveller())).toEqual([])
  })

  test('menteşeli + 100 kN yayımlanmamış bir makine', () => {
    const issues = issuesOf(leveller({ lip: 'hinged', capacity: '100' }))
    expect(issues.some((issue) => issue.field === 'capacity')).toBe(true)
  })

  test('kısa tablada tam teleskopik dudak uyarıyor', () => {
    const issues = issuesOf(leveller({ length: '2000', lip: 'telescopic', lipExtension: 1 }))
    expect(issues.some((issue) => issue.field === 'lipExtension')).toBe(true)
    // Uzun tablada aynı ayar sessiz.
    expect(
      issuesOf(leveller({ length: '3000', lip: 'telescopic', lipExtension: 1 })).some(
        (issue) => issue.field === 'lipExtension',
      ),
    ).toBe(false)
  })

  test('dinlenmede uzatılmış dudak kaydırıcısı açıklanıyor', () => {
    const issues = issuesOf(leveller({ lip: 'telescopic', lipExtension: 1, inclination: 0 }))
    expect(issues.some((issue) => issue.field === 'inclination')).toBe(true)
  })

  test('uyarı metinleri boş değil', () => {
    // Alanı olup mesajı olmayan bir uyarı panelde boş bir satır çiziyor.
    for (const issue of issuesOf(leveller({ lip: 'hinged', capacity: '100' }))) {
      expect(issue.msg.length).toBeGreaterThan(20)
    }
  })
})

// ── Kayıt ────────────────────────────────────────────────────────────────────

describe('tanım ve manifest', () => {
  test('manifest kind’ı taşıyor', () => {
    const kinds = (warehousePlugin.nodes ?? []).map((node) => (node as { kind: string }).kind)
    expect(kinds).toContain('warehouse:dock-leveller')
  })

  test('panel kind listesi manifestle aynı fikirde', () => {
    expect(warehouseCatalogPanel.kinds).toContain('warehouse:dock-leveller')
  })

  test('katalog fişleri var ve bölümleri gerçek', () => {
    const tiles = CATALOG_ITEMS.filter((item) => item.kind === 'warehouse:dock-leveller')
    expect(tiles.length).toBe(2)
    const sections = new Set(CATALOG_SECTIONS.map((section) => section.id))
    for (const tile of tiles) expect(sections.has(tile.sectionId)).toBe(true)
  })

  test('varsayılanlar şemadan geliyor ve ad taşıyor', () => {
    const defaults = dockLevellerDefinition.defaults() as Record<string, unknown>
    expect(defaults.name).toBe('Dock leveller')
    expect(defaults.inclination).toBe(0)
  })

  test('dönüş adımı 90° — rampa duvarın içindeki kapıya oturuyor', () => {
    const angles = dockLevellerDefinition.capabilities.rotatable.snapAngles
    expect(angles.length).toBe(4)
    expect(angles[1]).toBeCloseTo(Math.PI / 2, 9)
  })
})

/**
 * BEKÇİ: her katalog fırçasının bir uygulayıcısı var.
 *
 * Tezgâhın altı fişi bu boşluktan düştü: `CatalogItem.brush` birliğine
 * `bench` kolu eklendi, fişler o kolu taşıdı, ama `catalog-panel.tsx`'te onu
 * mağazaya yazan satır yazılmadı. Sonuç: katalog altı farklı masa gösterip
 * altısında da varsayılanı (`processing`) yerleştiriyordu. TypeScript sustu
 * — birliğe bakan `if` zinciri eksiksiz olmak zorunda değil — ve fark yalnız
 * gözle görülüyordu.
 */
describe('katalog fırçasının her kolu mağazaya yazılıyor', () => {
  const source = readFileSync(join(import.meta.dir, '..', 'panels', 'catalog-panel.tsx'), 'utf8')
  const catalogSource = readFileSync(join(import.meta.dir, '..', 'catalog.ts'), 'utf8')

  /**
   * YALNIZ `arm` gövdesi taranıyor.
   *
   * Dosyanın başında aynı ifadeyi kullanan ikinci bir yer var — hangi fişin
   * YANDIĞINI seçen okuma. Bütün dosyayı tarayınca o okuma, mağazaya hiçbir
   * şey yazmadığı hâlde "uygulanıyor" sayılıyordu: bekçi, kaldırdığım
   * uygulayıcıyı bulamayınca bile yeşil kaldı. Kendi mutasyon denemesinde
   * yakalandı, ve tam olarak bu yüzden bir bekçi kırmızıya çevrilerek
   * sınanmalı.
   *
   * Rakam da serbest (`m3`) — ilk desen rakam kabul etmiyordu ve yanlış
   * alarm veriyordu. Yanlış alarm, susmak kadar zararlı.
   */
  const ARM_BODY = source.slice(source.indexOf('const arm = '), source.indexOf('editor.setTool('))
  const ARMS = [...ARM_BODY.matchAll(/item\.brush\?\.kind === '([a-z0-9-]+)'/g)].map(
    ([, kind]) => kind,
  )

  test('gövde gerçekten bulundu — bekçinin kendini kandırma biçimi', () => {
    expect(ARM_BODY.length).toBeGreaterThan(400)
  })
  const DECLARED = [...catalogSource.matchAll(/\|\s*\{\s*\n?\s*kind: '([a-z0-9-]+)'/g)].map(
    ([, kind]) => kind,
  )

  test('birlik gerçekten okundu', () => {
    expect(DECLARED.length).toBeGreaterThan(8)
  })

  for (const kind of DECLARED) {
    test(`${kind} fırçası uygulanıyor`, () => {
      expect(
        ARMS.includes(kind),
        `${kind}: fişler bu fırçayı taşıyor ama panel onu mağazaya hiç yazmıyor — fiş varsayılanı yerleştirir`,
      ).toBe(true)
    })
  }
})
