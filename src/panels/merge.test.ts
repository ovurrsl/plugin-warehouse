import { describe, expect, test } from 'bun:test'
import { CATALOG_ITEMS, CATALOG_SECTIONS, itemsInSection } from '../catalog'
import { NEW_SAFETY_ZONE_WIDTH_M } from '../mezzanine/catalog'
import { mezzanineParametrics } from '../mezzanine/parametrics'
import { MezzanineNode } from '../mezzanine/schema'
import { palletRackParametrics } from '../rack/parametrics'
import { PalletRackNode } from '../rack/schema'
import { nextLevelTypes, palletSupportBarsPossible } from '../rack/slots'

/**
 * Aşama 2'nin davranış değişiklikleri — "içi içe giren ayarlar" birleştirmesi.
 *
 * Buradaki her test, denetimde bulunan somut bir kusuru kilitliyor. Panelin
 * GÖRÜNÜŞÜ test edilmiyor (bir React ağacını doğrulamak, hizalamayı kanıtlamaz);
 * test edilen şey, panelin arkasındaki KURALLAR: bir kontrol etkisiz olamaz, bir
 * uyarı düzeltilemez olamaz, bir bölüm boş olamaz.
 */

const rack = (patch: Partial<PalletRackNode> = {}) =>
  PalletRackNode.parse({ id: 'pallet-rack_probe', ...patch })

describe('B — levelTypes türetilmiş desene dönünce diziyi bırakır', () => {
  test('bir katı toplama yapmak açık dizi yazar', () => {
    const node = rack({ levels: 3, pickingLevels: 0 })
    const next = nextLevelTypes(node, 1, 'picking')
    expect(next).toEqual(['pallet', 'picking', 'pallet', 'pallet'])
  })

  test('geri almak diziyi NULL yapar — mesh paylaşımı geri gelir', () => {
    // Şemanın kendi uyarısı: açık `levelTypes` geometri anahtarını
    // benzersizleştiriyor, "elli raf elli mesh" olur. Eski panel diziyi her
    // dokunuşta dolduruyordu, yani tek tık geri dönüşsüzdü.
    const touched = rack({
      levels: 3,
      pickingLevels: 0,
      levelTypes: ['pallet', 'picking', 'pallet', 'pallet'],
    })
    expect(nextLevelTypes(touched, 1, 'pallet')).toBeNull()
  })

  test('pickingLevels deseniyle örtüşen yazım da NULL', () => {
    // `pickingLevels: 2` → 0 ve 1 toplama. Kullanıcı 1'i toplama yaparsa
    // türetilmiş desenden farklı bir şey söylememiş olur.
    const node = rack({ levels: 3, pickingLevels: 2 })
    expect(nextLevelTypes(node, 1, 'picking')).toBeNull()
  })

  test('yalnız dokunulan satır değişir — diğerleri açık dizideki değerini korur', () => {
    const node = rack({
      levels: 3,
      pickingLevels: 0,
      levelTypes: ['pallet', 'picking', 'picking', 'pallet'],
    })
    expect(nextLevelTypes(node, 3, 'picking')).toEqual(['pallet', 'picking', 'picking', 'picking'])
  })
})

describe('C — çubuk kontrolü yalnız çubuk çizilebiliyorken görünür', () => {
  const barsField = palletRackParametrics.groups
    .flatMap((group) => group.fields)
    .find((field) => String(field.key) === 'palletSupportBars')

  test('alan gerçekten `visibleIf` taşıyor', () => {
    expect(barsField).toBeDefined()
    expect(typeof (barsField as { visibleIf?: unknown }).visibleIf).toBe('function')
  })

  test('tel döşemeli raf: her kirişin üstünde panel var, çubuk çizilemez', () => {
    // Eski koşul `|| requiresPalletSupportBars(node)` idi ve kontrolü tam da
    // burada açıyordu: kullanıcı 0'dan 3'e sürüklüyor, rafta hiçbir şey
    // değişmiyordu.
    const decked = rack({ decking: 'wire-mesh', palletOrientation: 'long-side-out' })
    expect(palletSupportBarsPossible(decked)).toBe(false)
    expect((barsField as { visibleIf: (n: PalletRackNode) => boolean }).visibleIf(decked)).toBe(
      false,
    )
  })

  test('açık raf: kirişin üstünde panel yok, çubuk çizilebilir', () => {
    const open = rack({ decking: 'open', palletOrientation: 'long-side-out' })
    expect(palletSupportBarsPossible(open)).toBe(true)
    expect((barsField as { visibleIf: (n: PalletRackNode) => boolean }).visibleIf(open)).toBe(true)
  })

  test('sayı sıfırken de görünür — kontrol, sıfırı üçe çıkarmanın yolu', () => {
    // `palletSupportBarsDrawn`'a bağlamak kilitli bir kapı olurdu: çubuk yokken
    // kontrol gizlenir, kontrol gizliyken çubuk eklenemez.
    const open = rack({ decking: 'open', palletSupportBars: 0 })
    expect(palletSupportBarsPossible(open)).toBe(true)
  })
})

describe('D — pickingBoxHeight artık bir sonuç üretiyor', () => {
  const check = (node: PalletRackNode) =>
    palletRackParametrics.invariants?.flatMap((fn) => fn(node)) ?? []

  test('açıklığa sığmayan kap uyarı üretir', () => {
    // Alan denetimde ÖLÜ bulundu: şemada tanımlı, panelde slider'ı var, kodun
    // hiçbir yeri okumuyordu. Silmek yerine sonuç bağlandı.
    const node = rack({
      levels: 3,
      pickingLevels: 2,
      pickingLevelClear: 0.3,
      pickingBoxHeight: 0.9,
    })
    const issue = check(node).find((entry) => entry.field === 'pickingBoxHeight')
    expect(issue?.severity).toBe('warning')
    expect(issue?.msg).toContain('900 mm')
  })

  test('sığan kap sessizdir', () => {
    const node = rack({
      levels: 3,
      pickingLevels: 2,
      pickingLevelClear: 0.6,
      pickingBoxHeight: 0.22,
    })
    expect(check(node).some((entry) => entry.field === 'pickingBoxHeight')).toBe(false)
  })

  test('toplama katı yoksa hiç sorulmaz', () => {
    const node = rack({ levels: 3, pickingLevels: 0, pickingBoxHeight: 0.9 })
    expect(check(node).some((entry) => entry.field === 'pickingBoxHeight')).toBe(false)
  })
})

describe('G — güvenlik bölgesi düğmesi düzeltilemez uyarı doğurmaz', () => {
  /** `+ Güvenlik bölgesi`'nin ürettiği düğüm — düğmenin yazdığı değerlerle. */
  const withZone = (widthM: number) => {
    const base = MezzanineNode.parse({ id: 'mezzanine_probe' })
    const tier = base.tiers[0]
    if (!tier) throw new Error('şema en az bir tier garanti ediyor')
    return MezzanineNode.parse({
      id: 'mezzanine_probe',
      tiers: [
        {
          ...tier,
          accessories: { ...tier.accessories, safetyZones: [{ edge: 'east', offsetM: 5, widthM }] },
        },
      ],
    })
  }

  const zoneIssues = (node: ReturnType<typeof withZone>) =>
    (mezzanineParametrics.invariants?.flatMap((fn) => fn(node)) ?? []).filter((issue) =>
      issue.msg.includes('güvenlik bölgesi'),
    )

  test('düğmenin bıraktığı bölge SESSİZ doğar', () => {
    /**
     * Kusur şuydu: `+ Safety zone` 1.5 m yazıyor, invariant 1.2 m'yi aşanı
     * uyarıyor, ve `widthM`'in hiçbir kontrolü yoktu — yani yeni konan her
     * aksesuar, kullanıcının kapatamayacağı sarı bir uyarıyla doğuyordu.
     *
     * Test sabiti sabitle karşılaştırmıyor (o, kendini doğrulayan bir ifade
     * olurdu); düğmenin değerini GERÇEK invariant'tan geçiriyor.
     */
    expect(zoneIssues(withZone(NEW_SAFETY_ZONE_WIDTH_M))).toEqual([])
  })

  test('eski varsayılan (1.5 m) uyarıyı hâlâ üretiyor — kural kaldırılmadı', () => {
    // Uyarı doğru ve yerinde: kaldırılan şey uyarı değil, onu kaçınılmaz kılan
    // düğme varsayılanıydı.
    expect(zoneIssues(withZone(1.5)).length).toBe(1)
  })
})

describe('I — katalogda boş bölüm yok', () => {
  test('her bölümün en az bir fişi var', () => {
    /**
     * `stations` bölümü ("Packing, dispatch, and processing benches") sıfır
     * fişle ilan edilmişti: her açılışta başlık, açıklama ve "Nothing here yet."
     * kutusu çiziliyordu — var olmayan bir yeteneğin kalıcı reklamı.
     *
     * Bölüm kaldırıldı; bu test ikinci kez sessizce eklenmesini engelliyor.
     */
    const empty = CATALOG_SECTIONS.filter((section) => itemsInSection(section.id).length === 0)
    expect(empty.map((section) => section.id)).toEqual([])
  })

  test('her fiş var olan bir bölüme ait', () => {
    // Ters yön: bölümü silmek, fişlerini görünmez bırakmamalı.
    const ids = new Set(CATALOG_SECTIONS.map((section) => section.id))
    const orphans = CATALOG_ITEMS.filter((item) => !ids.has(item.sectionId))
    expect(orphans.map((item) => item.id)).toEqual([])
  })
})
