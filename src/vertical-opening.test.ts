import { describe, expect, test } from 'bun:test'
import { overallHeightM } from './conveyor/spiral-metrics'
import { ConveyorSpiralNode } from './conveyor/spiral-schema'
import { liftOpeningSpan } from './palletlift/levels'
import { PalletLiftNode } from './palletlift/schema'
import { circleOpening, crossesSurface, rectOpening, surfacePlaneY } from './vertical-opening'

/**
 * Bina + üç kat, yükseklikler 4/3/3 → döşeme kotları 0, 4, 7; tavan kotları
 * (bir üstün tabanı) 4, 7, 10. `palletlift.test.ts`'in sahnesiyle aynı istif,
 * kasıtlı olarak: iki dosya aynı kotları farklı sorularla yokluyor.
 */
function scene(
  machine: Record<string, unknown>,
  ownLevel = 'lvl0',
  levelPatch: Record<string, Record<string, unknown>> = {},
): Record<string, unknown> {
  const id = machine.id as string
  const level = (levelId: string, ordinal: number, height: number) => ({
    id: levelId,
    type: 'level',
    level: ordinal,
    height,
    baseElevation: 0,
    children: levelId === ownLevel ? [id] : [],
    ...(levelPatch[levelId] ?? {}),
  })
  return {
    b1: { id: 'b1', type: 'building', children: ['lvl2', 'lvl0', 'lvl1'] },
    lvl0: level('lvl0', 0, 4),
    lvl1: level('lvl1', 1, 3),
    lvl2: level('lvl2', 2, 3),
    [id]: machine,
  }
}

const lift = (overrides: Record<string, unknown> = {}, parentId = 'lvl0') =>
  PalletLiftNode.parse({ id: 'pallet-lift_t', parentId, ...overrides })

const spiral = (overrides: Record<string, unknown> = {}, parentId = 'lvl0') =>
  ConveyorSpiralNode.parse({ id: 'conveyor-spiral_t', parentId, ...overrides })

/** Bir makinenin bu sahnede deldiği yüzeyler, `kat:yüzey` biçiminde. */
function cuts(
  nodes: Record<string, unknown>,
  node: unknown,
  span: { bottom: number; top: number },
): string[] {
  const out: string[] = []
  for (const levelId of ['lvl0', 'lvl1', 'lvl2']) {
    for (const surface of ['slab', 'ceiling'] as const) {
      if (crossesSurface(nodes, node, levelId, surface, span)) out.push(`${levelId}:${surface}`)
    }
  }
  return out
}

// ── Yüzey düzlemi ────────────────────────────────────────────────────────────

describe('yüzey düzlemi', () => {
  test('döşeme katın tabanında, tavan bir üstteki katın tabanında', () => {
    const nodes = scene(lift())
    const machine = nodes['pallet-lift_t']
    expect(surfacePlaneY(nodes, machine, 'lvl0', 'slab')).toBe(0)
    expect(surfacePlaneY(nodes, machine, 'lvl1', 'slab')).toBe(4)
    expect(surfacePlaneY(nodes, machine, 'lvl2', 'slab')).toBe(7)
    // Tavanlar: lvl0'ınki lvl1'in tabanı, lvl1'inki lvl2'nin tabanı.
    expect(surfacePlaneY(nodes, machine, 'lvl0', 'ceiling')).toBe(4)
    expect(surfacePlaneY(nodes, machine, 'lvl1', 'ceiling')).toBe(7)
    // En üst katın üstünde kat yok: kendi yüksekliğinden.
    expect(surfacePlaneY(nodes, machine, 'lvl2', 'ceiling')).toBe(10)
  })

  /**
   * Sessiz tuzağın ta kendisi: host makineyi KENDİ katının kotuna yerleştirir,
   * dolayısıyla dikey aralık da kendi katına göredir. Kat kotları MUTLAK
   * okunursa lvl1'deki bir makine kendi altındaki döşemeleri delmeye başlar —
   * kotlar 4 metre kayık olduğu için "makul" görünen deliklerle.
   */
  test('kotlar makinenin KENDİ katına göre, mutlak değil', () => {
    const nodes = scene(lift({}, 'lvl1'), 'lvl1')
    const machine = nodes['pallet-lift_t']
    expect(surfacePlaneY(nodes, machine, 'lvl1', 'slab')).toBe(0)
    expect(surfacePlaneY(nodes, machine, 'lvl2', 'slab')).toBe(3)
    // Altındaki kat NEGATİF — mutlak okunsa 0 olurdu.
    expect(surfacePlaneY(nodes, machine, 'lvl0', 'slab')).toBe(-4)
  })

  test('baseElevation katı ve üstündekileri kaydırır', () => {
    const nodes = scene(lift(), 'lvl0', { lvl1: { baseElevation: 1 } })
    const machine = nodes['pallet-lift_t']
    expect(surfacePlaneY(nodes, machine, 'lvl1', 'slab')).toBe(5)
    expect(surfacePlaneY(nodes, machine, 'lvl2', 'slab')).toBe(8)
  })

  test('bina dışındaki makine hiçbir düzlem çözemez', () => {
    const nodes: Record<string, unknown> = { 'pallet-lift_t': lift({}, null as never) }
    expect(surfacePlaneY(nodes, nodes['pallet-lift_t'], 'lvl0', 'slab')).toBeNull()
  })
})

// ── Kapsayıcılık ─────────────────────────────────────────────────────────────

describe('aralık kapsayıcılığı', () => {
  /**
   * Alt uç DIŞLAYICI: makinenin üstünde durduğu döşeme delinmez. Kapsayıcı
   * yapılsaydı her makine kendi ayağının altındaki zemini keserdi ve nesne
   * boşlukta asılı görünürdü — hata vermeyen, yalnız yanlış görünen bir sonuç.
   */
  test('oturduğu döşemeyi delmez', () => {
    const nodes = scene(lift())
    expect(
      crossesSurface(nodes, nodes['pallet-lift_t'], 'lvl0', 'slab', { bottom: 0, top: 7 }),
    ).toBe(false)
  })

  /**
   * Üst uç KAPSAYICI: vardığı döşeme delinir. Dışlayıcı yapılsaydı asansör
   * hedef katın döşemesine çarpar, yani en üst durakta kapalı bir tavana
   * açılırdı.
   */
  test('vardığı döşemeyi deler', () => {
    const nodes = scene(lift())
    expect(
      crossesSurface(nodes, nodes['pallet-lift_t'], 'lvl2', 'slab', { bottom: 0, top: 7 }),
    ).toBe(true)
  })

  test('üstünde kalan döşemeyi delmez', () => {
    const nodes = scene(lift())
    // lvl1 döşemesine (4) varan bir aralık lvl2'yi (7) görmemeli.
    expect(
      crossesSurface(nodes, nodes['pallet-lift_t'], 'lvl2', 'slab', { bottom: 0, top: 4 }),
    ).toBe(false)
  })
})

// ── Palet asansörü ───────────────────────────────────────────────────────────

describe('palet asansörü kuyusu', () => {
  test('bütün istifi servis edince aradaki ve varılan yüzeyleri deler', () => {
    const nodes = scene(lift())
    const span = liftOpeningSpan(nodes, nodes['pallet-lift_t'] as never)
    expect(span).toEqual({ bottom: 0, top: 7 })
    // Döşemeler: lvl1 ve lvl2 (lvl0 hariç). Tavanlar: lvl0 (4) ve lvl1 (7).
    expect(cuts(nodes, nodes['pallet-lift_t'], span!)).toEqual([
      'lvl0:ceiling',
      'lvl1:slab',
      'lvl1:ceiling',
      'lvl2:slab',
    ])
  })

  /**
   * Kelepçe gerçekten kesmeli. Aralık yok sayılsaydı 0-1 katlarına ayarlanmış
   * bir asansör 2. katın döşemesini de deler ve kimse fark etmezdi: delik
   * asansörün üstünde, görüş alanının dışında kalır.
   */
  test('from/to kelepçesi üstteki katı korur', () => {
    const nodes = scene(lift({ fromLevelId: 'lvl0', toLevelId: 'lvl1' }))
    const span = liftOpeningSpan(nodes, nodes['pallet-lift_t'] as never)
    expect(span).toEqual({ bottom: 0, top: 4 })
    expect(cuts(nodes, nodes['pallet-lift_t'], span!)).toEqual(['lvl0:ceiling', 'lvl1:slab'])
  })

  /**
   * `resolveLiftLevels` iki kattan azı çözülünce SENTETİK bir yedek döner
   * (`fallbackTravelM` kadar). O yedek çizim içindir; onu delik aralığı diye
   * kullanmak, tek kata kelepçelenmiş ya da bina dışına konmuş bir asansörün
   * altından geçmediği döşemeleri kesmesi demekti.
   */
  test('tek kata kelepçelenince hiçbir şey delmez', () => {
    const nodes = scene(lift({ fromLevelId: 'lvl1', toLevelId: 'lvl1' }))
    expect(liftOpeningSpan(nodes, nodes['pallet-lift_t'] as never)).toBeNull()
  })

  test('bina dışındaki asansör hiçbir şey delmez', () => {
    const nodes: Record<string, unknown> = { 'pallet-lift_t': lift({}, null as never) }
    expect(liftOpeningSpan(nodes, nodes['pallet-lift_t'] as never)).toBeNull()
  })
})

// ── Sarmal konveyör ──────────────────────────────────────────────────────────

describe('sarmal konveyör deliği', () => {
  test('bir üst kata çıkan sarmal o katın döşemesini deler', () => {
    const nodes = scene(spiral({ travelHeight: 5 }))
    const node = nodes['conveyor-spiral_t'] as ConveyorSpiralNode
    // Toplam boy = entryHeight (0,75) + travelHeight (5) + pay (0,3) = 6,05.
    const span = { bottom: 0, top: overallHeightM(node) }
    expect(span.top).toBeCloseTo(6.05, 6)
    // lvl1 döşemesi 4'te — delinir. lvl2 döşemesi 7'de — delinmez.
    expect(cuts(nodes, node, span)).toEqual(['lvl0:ceiling', 'lvl1:slab'])
  })

  /**
   * Kat altında kalan bir sarmal hiçbir döşeme delmemeli. Aralık `travelHeight`
   * yerine sabit bir "katlar arası" varsayımına bağlansaydı, 2 metrelik bir
   * yükseltici de üstündeki döşemeyi keserdi.
   */
  test('kat yüksekliğinin altında kalan sarmal hiçbir şey delmez', () => {
    const nodes = scene(spiral({ travelHeight: 2 }))
    const node = nodes['conveyor-spiral_t'] as ConveyorSpiralNode
    expect(cuts(nodes, node, { bottom: 0, top: overallHeightM(node) })).toEqual([])
  })

  test('iki kat çıkan sarmal iki döşemeyi birden deler', () => {
    const nodes = scene(spiral({ travelHeight: 8 }))
    const node = nodes['conveyor-spiral_t'] as ConveyorSpiralNode
    // 0,75 + 8 + 0,3 = 9,05 → lvl1 (4) ve lvl2 (7) döşemeleri.
    expect(cuts(nodes, node, { bottom: 0, top: overallHeightM(node) })).toEqual([
      'lvl0:ceiling',
      'lvl1:slab',
      'lvl1:ceiling',
      'lvl2:slab',
    ])
  })
})

// ── Poligonlar ───────────────────────────────────────────────────────────────

describe('delik poligonları', () => {
  test('dikdörtgen düğümün dünya konumunda ve sapmasında', () => {
    const flat = rectOpening([10, 0, 20], 0, 1, 0.5)
    expect(flat).toEqual([
      [9, 19.5],
      [11, 19.5],
      [11, 20.5],
      [9, 20.5],
    ])
  })

  /**
   * 90° sapmada X ve Z uzanımları YER DEĞİŞTİRİR. Sapma yok sayılırsa delik
   * dönmüş bir asansörün kuyusuna dar kenarından oturur ve mast delikten
   * geçmez — ama delik yine "var" olduğu için hiçbir şey hata vermez.
   */
  test('sapma uzanımları takas eder', () => {
    const turned = rectOpening([0, 0, 0], Math.PI / 2, 1, 0.5)
    const xs = turned.map(([x]) => x)
    const zs = turned.map(([, z]) => z)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 6)
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2, 6)
  })

  test('daire istenen yarıçapta ve kenar sayısında', () => {
    const ring = circleOpening([3, 0, -2], 1.5, 16)
    expect(ring).toHaveLength(16)
    for (const [x, z] of ring) {
      expect(Math.hypot(x - 3, z + 2)).toBeCloseTo(1.5, 6)
    }
  })
})
