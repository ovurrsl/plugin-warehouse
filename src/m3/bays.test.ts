import { describe, expect, test } from 'bun:test'
import {
  bayLoadKg,
  bayPitch,
  clearAbove,
  collidingLevels,
  crossBraceSets,
  crossTieCount,
  dividerHeightAt,
  doorLengthMismatch,
  doorTallerThanFrame,
  drawerCount,
  droppedLevelCount,
  fittedLevels,
  levelElevation,
  levelLoadKg,
  shelfAreaM2,
  spliceRequired,
  totalWidth,
  UPRIGHT_SECTION,
} from './bays'
import { M3ShelvingNode } from './schema'
import { SLOT_PITCH, UPRIGHT_FRONT_FACE } from './standards'

function bay(patch: Partial<M3ShelvingNode> = {}): M3ShelvingNode {
  return M3ShelvingNode.parse({ ...patch })
}

function level(patch: Partial<M3ShelvingNode['levels'][number]> = {}) {
  return {
    elevation: 0.5,
    structure: 'shelf' as const,
    model: 'HL' as const,
    dividers: 0,
    drawerModel: 'MA' as const,
    drawerWidth: 'wide' as const,
    ...patch,
  }
}

describe('yuva ızgarası', () => {
  test('her kot 25 mm katına yapışır', () => {
    // M3'ün TEK aralığı bu. M7 iki yüzde iki aralık taşıyordu çünkü katlarının
    // yarısı 50 mm'de delikli ön yüzdeki kirişlere biniyordu; M3'te kiriş yok.
    expect(levelElevation(level({ elevation: 0.51 }))).toBeCloseTo(0.5, 9)
    expect(levelElevation(level({ elevation: 0.513 }))).toBeCloseTo(0.525, 9)
    expect(levelElevation(level({ elevation: 1.2374 }))).toBeCloseTo(1.225, 9)
  })

  test('yapışan her kot gerçekten 25 mm ızgarada', () => {
    for (const raw of [0, 0.013, 0.4, 1.111, 2.999, 7.98]) {
      const snapped = levelElevation(level({ elevation: raw }))
      expect(Math.abs(snapped / SLOT_PITCH - Math.round(snapped / SLOT_PITCH))).toBeLessThan(1e-9)
    }
  })
})

describe('göz adımı', () => {
  test('adım = net boy + bir dikme yüzü', () => {
    // Mıknatısın, ayak izinin ve çerçeve paylaşımının hepsi bu tek sayıyı okur.
    // Ayak izini dış genişlik yapmak, yan yana iki gözü sert çakışma sayar.
    const node = bay({ shelfLength: 1 })
    expect(bayPitch(node)).toBeCloseTo(1 + UPRIGHT_FRONT_FACE, 9)
    expect(totalWidth(node)).toBeCloseTo(bayPitch(node) + UPRIGHT_SECTION.width, 9)
    expect(totalWidth(node)).toBeGreaterThan(bayPitch(node))
  })
})

describe('çekmece sayısı — katalogun iki satırı', () => {
  /**
   * Bu testin varlık sebebi: katalog yalnız iki boy için sayı basıyor, ama
   * ikisi de `floor(boy / genişlik)`. Türetme onları üretemezse tablo yerine
   * uydurma yapıyoruz demektir.
   */
  test('1.000 mm kat: 4 geniş veya 8 dar (KATALOG)', () => {
    const node = bay({ shelfLength: 1 })
    expect(drawerCount(node, level({ drawerWidth: 'wide' }))).toBe(4)
    expect(drawerCount(node, level({ drawerWidth: 'narrow' }))).toBe(8)
  })

  test('1.250 mm kat: 5 geniş veya 10 dar (KATALOG)', () => {
    const node = bay({ shelfLength: 1.25 })
    expect(drawerCount(node, level({ drawerWidth: 'wide' }))).toBe(5)
    expect(drawerCount(node, level({ drawerWidth: 'narrow' }))).toBe(10)
  })

  test('katalogda olmayan boylar da tutarlı çıkıyor', () => {
    // 750 ve 1.400 mm katalogda satır olarak yok; aynı bölme cevap veriyor.
    expect(drawerCount(bay({ shelfLength: 0.75 }), level({ drawerWidth: 'wide' }))).toBe(3)
    expect(drawerCount(bay({ shelfLength: 1.4 }), level({ drawerWidth: 'narrow' }))).toBe(11)
  })

  test('çekmece sığmayacak kadar dar göz sıfır verir', () => {
    expect(drawerCount(bay({ shelfLength: 0.5 }), level({ drawerWidth: 'wide' }))).toBe(2)
    // Şemanın taban sınırının altı — kural yine de sıfır vermeli, negatif değil.
    expect(drawerCount({ ...bay(), shelfLength: 0.2 }, level({ drawerWidth: 'wide' }))).toBe(0)
  })
})

describe('çapraz bağ — türetiliyor, saklanmıyor', () => {
  test('2,5 m ve altı tek takım (KATALOG)', () => {
    expect(crossBraceSets(bay({ frameHeight: 2 }))).toBe(1)
    expect(crossBraceSets(bay({ frameHeight: 2.5 }))).toBe(1)
  })

  test('2,5 m üstü iki takım (KATALOG)', () => {
    expect(crossBraceSets(bay({ frameHeight: 2.75 }))).toBe(2)
    expect(crossBraceSets(bay({ frameHeight: 4 }))).toBe(2)
  })

  test('arka panel çapraz bağın yerini alır — hangi yükseklikte olursa', () => {
    expect(crossBraceSets(bay({ frameHeight: 4, backPanel: 'metal' }))).toBe(0)
    expect(crossBraceSets(bay({ frameHeight: 2, backPanel: 'mesh' }))).toBe(0)
  })

  test('çerçeve bağı sayısı yükseklikle artıyor', () => {
    expect(crossTieCount(bay({ frameHeight: 2 }))).toBe(2)
    expect(crossTieCount(bay({ frameHeight: 2.5 }))).toBe(3)
  })
})

describe('katlar', () => {
  test('sıra bozuk girilse de alttan üste sıralanıyor', () => {
    const node = bay({
      levels: [level({ elevation: 1.5 }), level({ elevation: 0.5 }), level({ elevation: 1 })],
    })
    expect(fittedLevels(node).map(levelElevation)).toEqual([0.5, 1, 1.5])
  })

  test('çerçevenin üstünde kalan kat düşüyor ve sayılıyor', () => {
    const node = bay({
      frameHeight: 1,
      levels: [level({ elevation: 0.5 }), level({ elevation: 1.8 })],
    })
    expect(fittedLevels(node)).toHaveLength(1)
    expect(droppedLevelCount(node)).toBe(1)
  })

  test('en üstteki katın açıklığı çerçeveyle sınırlı', () => {
    const node = bay({
      frameHeight: 2,
      levels: [level({ elevation: 0.5 }), level({ elevation: 1.5 })],
    })
    expect(clearAbove(node, 1)).toBeCloseTo(0.5, 9)
  })

  test('alttaki katın açıklığı üstteki rafın ALT yüzüne kadar', () => {
    const node = bay({ levels: [level({ elevation: 0.5 }), level({ elevation: 1, model: 'HM' })] })
    // HM paneli 30 mm; açıklık 0.5 değil 0.47.
    expect(clearAbove(node, 0)).toBeCloseTo(0.47, 9)
  })

  test('aynı yuvaya düşen iki kat yakalanıyor', () => {
    // 1.00 ve 1.01 panelde FARKLI okunuyor, aynı 25 mm yuvaya iniyor.
    const node = bay({ levels: [level({ elevation: 1 }), level({ elevation: 1.01 })] })
    expect(collidingLevels(node)).toEqual([1])
  })
})

describe('yük — bu paketteki tek YAYIMLANMIŞ kapasite', () => {
  test('HL 150 kg, HM 275 kg (KATALOG)', () => {
    expect(levelLoadKg(level({ model: 'HL' }))).toBe(150)
    expect(levelLoadKg(level({ model: 'HM' }))).toBe(275)
  })

  test('göz kapasitesi sığan katların toplamı', () => {
    const node = bay({
      frameHeight: 2,
      levels: [
        level({ elevation: 0.5 }),
        level({ elevation: 1, model: 'HM' }),
        level({ elevation: 3 }),
      ],
    })
    // Üçüncü kat çerçevenin üstünde: kapasiteye girmiyor.
    expect(bayLoadKg(node)).toBe(150 + 275)
  })

  test('raf alanı sığan kat sayısıyla ölçekleniyor', () => {
    const node = bay({ shelfLength: 1, shelfDepth: 0.4 })
    expect(shelfAreaM2(node)).toBeCloseTo(4 * 0.4, 9)
  })
})

describe('bölücü yüksekliği açıklıktan türetiliyor', () => {
  test('açıklığa sığan en büyük katalog boyu seçiliyor', () => {
    // 0.5 m açıklık: seride 500 mm var, 550 yok.
    const node = bay({
      frameHeight: 3,
      levels: [level({ elevation: 0.5, dividers: 2 }), level({ elevation: 1.025 })],
    })
    expect(clearAbove(node, 0)).toBeCloseTo(0.5, 9)
    expect(dividerHeightAt(node, 0)).toBeCloseTo(0.5, 9)
  })

  test('hiçbir katalog boyu sığmıyorsa bölücü yok', () => {
    const node = bay({
      levels: [level({ elevation: 0.5, dividers: 3 }), level({ elevation: 0.575 })],
    })
    expect(dividerHeightAt(node, 0)).toBeNull()
  })

  test('bölücü istenmemişse boy hesaplanmıyor', () => {
    const node = bay({ levels: [level({ elevation: 0.5, dividers: 0 })] })
    expect(dividerHeightAt(node, 0)).toBeNull()
  })

  test('çekmeceli katta bölücü yok — ikisi aynı yüzeyi paylaşamaz', () => {
    const node = bay({
      frameHeight: 3,
      levels: [
        level({ elevation: 0.5, structure: 'drawers', dividers: 4 }),
        level({ elevation: 1.025 }),
      ],
    })
    expect(dividerHeightAt(node, 0)).toBeNull()
  })
})

describe('kapı — katalog kısıtı', () => {
  test('1.000 mm dışındaki gözde kapı bildiriliyor', () => {
    expect(doorLengthMismatch(bay({ shelfLength: 1, door: 'h1000' }))).toBe(false)
    expect(doorLengthMismatch(bay({ shelfLength: 1.25, door: 'h1000' }))).toBe(true)
  })

  test('kapı yokken uyarı da yok', () => {
    expect(doorLengthMismatch(bay({ shelfLength: 1.25, door: 'none' }))).toBe(false)
  })

  test('çerçeveden uzun kapı yakalanıyor', () => {
    expect(doorTallerThanFrame(bay({ frameHeight: 1.5, door: 'h2000' }))).toBe(true)
    expect(doorTallerThanFrame(bay({ frameHeight: 2.5, door: 'h2000' }))).toBe(false)
  })
})

describe('ek gerektiren yükseklik', () => {
  test('8 m üstü dikme eki istiyor (KATALOG)', () => {
    expect(spliceRequired(bay({ frameHeight: 8 }))).toBe(false)
    // Şema 8 m'de tavanlı; kural yine de kodda duruyor çünkü sınır katalogun,
    // şemanın değil.
    expect(spliceRequired({ ...bay(), frameHeight: 8.5 })).toBe(true)
  })
})
