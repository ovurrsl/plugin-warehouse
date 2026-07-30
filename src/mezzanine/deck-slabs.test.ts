import { describe, expect, test } from 'bun:test'
import { electSupportSlab } from '../placement'
import { useWarehouseStore } from '../store'
import { planDeckSlabs } from './deck-slab-system'
import {
  DECK_OWNER_KEY,
  deckOwnerOf,
  deckSlabId,
  deckSlabSpecs,
  GROUND_SUPPORT_ID,
  mezzanineContains,
} from './deck-slabs'
import {
  footprintDepthM,
  footprintWidthM,
  gridColumnPositions,
  hasCustomOutline,
  outlinePolygon,
  pointInPolygon,
  resolveTierElevations,
} from './metrics'
import { mezzanineParts } from './parts'
import { outlineEdges } from './railing'
import { emptyAccessories, MezzanineNode } from './schema'

const tier = (patch: Record<string, unknown> = {}) => ({
  index: 0,
  elevationM: 'auto',
  clearHeightM: 3,
  loadClass: 500,
  floorType: 'WOOD_CHIPBOARD_30',
  accessories: emptyAccessories(),
  ...patch,
})

const mezzanine = (patch: Record<string, unknown> = {}) =>
  MezzanineNode.parse({
    id: 'mezzanine_test',
    parentId: 'level_1',
    position: [0, 0, 0],
    grid: { baysX: 4, baysY: 3, bayWidthM: 5, bayDepthM: 5 },
    tiers: [tier()],
    ...patch,
  })

/** Kat + mezzanine — uzlaştırıcının çalışabildiği en küçük sahne. */
const scene = (mezz: ReturnType<typeof mezzanine>): Record<string, unknown> => ({
  level_1: { id: 'level_1', type: 'level', parentId: null },
  [mezz.id]: mezz,
})

/** Planı sahneye uygula — uzlaştırıcının store'a yaptığının aynısı. */
function apply(nodes: Record<string, unknown>, plan: ReturnType<typeof planDeckSlabs>) {
  const next = { ...nodes }
  for (const id of plan.deletes) delete next[id]
  for (const entry of plan.updates) {
    next[entry.id] = { ...(next[entry.id] as object), ...entry.data }
  }
  for (const entry of plan.creates) {
    next[(entry.node as { id: string }).id] = entry.node
  }
  return next
}

describe('güverte slab spec’leri', () => {
  test('her tier için bir güverte, kotu tier’in yürüme yüzeyi', () => {
    const mezz = mezzanine({ tiers: [tier(), tier({ index: 1 })] })
    const specs = deckSlabSpecs(mezz, 0)
    const resolved = resolveTierElevations(mezz.tiers)

    expect(specs).toHaveLength(2)
    expect(specs[0]?.elevation).toBeCloseTo(resolved[0]?.deckTopM ?? -1, 9)
    expect(specs[1]?.elevation).toBeCloseTo(resolved[1]?.deckTopM ?? -1, 9)
    // Kalınlık döşeme tipinden — sunta 30 mm.
    expect(specs[0]?.thickness).toBeCloseTo(0.03, 9)
  })

  test('taban kotu güverteye eklenir — mezzanine yükseltilmiş bir slab üstündeyse', () => {
    const mezz = mezzanine()
    const onGround = deckSlabSpecs(mezz, 0)[0]
    const raised = deckSlabSpecs(mezz, 2.5)[0]
    expect((raised?.elevation ?? 0) - (onGround?.elevation ?? 0)).toBeCloseTo(2.5, 9)
  })

  test('poligon taban izini sarar', () => {
    const spec = deckSlabSpecs(mezzanine(), 0)[0]
    // 4×5 = 20 genişlik, 3×5 = 15 derinlik → yarıları 10 ve 7.5.
    const xs = spec?.polygon.map((p) => p[0]) ?? []
    const zs = spec?.polygon.map((p) => p[1]) ?? []
    expect(Math.min(...xs)).toBeCloseTo(-10, 9)
    expect(Math.max(...xs)).toBeCloseTo(10, 9)
    expect(Math.min(...zs)).toBeCloseTo(-7.5, 9)
    expect(Math.max(...zs)).toBeCloseTo(7.5, 9)
  })

  test('döndürülmüş mezzanine: 90°’de genişlik ve derinlik yer değiştirir', () => {
    const spec = deckSlabSpecs(mezzanine({ rotation: [0, Math.PI / 2, 0] }), 0)[0]
    const xs = spec?.polygon.map((p) => p[0]) ?? []
    const zs = spec?.polygon.map((p) => p[1]) ?? []
    // Yerel 20×15, dünyada 15×20 olur.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(15, 9)
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(20, 9)
  })

  test('poligon mezzanine’in konumuyla ötelenir', () => {
    const spec = deckSlabSpecs(mezzanine({ position: [30, 0, -12] }), 0)[0]
    const xs = spec?.polygon.map((p) => p[0]) ?? []
    const zs = spec?.polygon.map((p) => p[1]) ?? []
    expect(Math.min(...xs)).toBeCloseTo(20, 9)
    expect(Math.min(...zs)).toBeCloseTo(-19.5, 9)
  })

  test('kimlik (mezzanine, tier) çiftinden deterministik', () => {
    const mezz = mezzanine({ tiers: [tier(), tier({ index: 1 })] })
    const specs = deckSlabSpecs(mezz, 0)
    expect(specs[0]?.id).toBe(deckSlabId(mezz.id, 0))
    expect(specs[1]?.id).toBe(deckSlabId(mezz.id, 1))
    expect(specs[0]?.id).not.toBe(specs[1]?.id)
  })
})

describe('sahiplik metadata’dan okunur, kimlikten DEĞİL', () => {
  test('metadata taşıyan düğüm sahibini verir', () => {
    const node = { metadata: { [DECK_OWNER_KEY]: { mezzanineId: 'mezzanine_a', tierIndex: 2 } } }
    expect(deckOwnerOf(node)).toEqual({ mezzanineId: 'mezzanine_a', tierIndex: 2 })
  })

  test('metadata yoksa ya da bozuksa sahip yok', () => {
    expect(deckOwnerOf({})).toBeNull()
    expect(deckOwnerOf(null)).toBeNull()
    expect(deckOwnerOf({ metadata: { [DECK_OWNER_KEY]: { mezzanineId: 5 } } })).toBeNull()
  })

  test('alt çizgili mezzanine kimliği sahipliği bozmaz', () => {
    // `83517b3c`'nin dersi: kimlik ayrıştırmak bu repoda bir kez kırıldı.
    // Kimlikte kaç alt çizgi olursa olsun sahiplik metadata'dan gelir.
    const mezz = mezzanine({ id: 'mezzanine_a_b_c' })
    const plan = planDeckSlabs(scene(mezz))
    const created = plan.creates[0]?.node as { metadata: Record<string, { mezzanineId: string }> }
    expect(created.metadata[DECK_OWNER_KEY]?.mezzanineId).toBe('mezzanine_a_b_c')
  })
})

describe('uzlaştırıcı', () => {
  test('ilk geçiş güverteyi yaratır, kat düğümünün çocuğu olarak', () => {
    const plan = planDeckSlabs(scene(mezzanine()))
    expect(plan.creates).toHaveLength(1)
    expect(plan.updates).toHaveLength(0)
    expect(plan.deletes).toHaveLength(0)
    expect(plan.creates[0]?.parentId).toBe('level_1')
    const node = plan.creates[0]?.node as { type: string; visible: boolean }
    expect(node.type).toBe('slab')
    // Görünmez: güverteyi mezzanine kendi geometrisiyle çiziyor.
    expect(node.visible).toBe(false)
  })

  test('İKİNCİ geçiş hiçbir şey yazmaz — döngü emniyeti', () => {
    // Bu testin düşmesi sonsuz döngü demektir: sistem store'a yazar,
    // yazınca `nodes` değişir, efekt yeniden koşar. Tek durak noktası
    // ikinci geçişin boş plan üretmesi.
    const nodes = scene(mezzanine())
    const settled = apply(nodes, planDeckSlabs(nodes))
    const second = planDeckSlabs(settled)
    expect(second.creates).toHaveLength(0)
    expect(second.updates).toHaveLength(0)
    expect(second.deletes).toHaveLength(0)
  })

  test('tier eklenince yeni güverte gelir, silinince eskisi gider', () => {
    const one = scene(mezzanine())
    const settled = apply(one, planDeckSlabs(one))

    const grown = { ...settled, mezzanine_test: mezzanine({ tiers: [tier(), tier({ index: 1 })] }) }
    const growPlan = planDeckSlabs(grown)
    expect(growPlan.creates).toHaveLength(1)
    expect(growPlan.deletes).toHaveLength(0)

    const settledTwo = apply(grown, growPlan)
    const shrunk = { ...settledTwo, mezzanine_test: mezzanine() }
    const shrinkPlan = planDeckSlabs(shrunk)
    expect(shrinkPlan.deletes).toEqual([deckSlabId('mezzanine_test', 1)])
  })

  test('mezzanine silinince güvertesi de silinir', () => {
    const nodes = scene(mezzanine())
    const settled = apply(nodes, planDeckSlabs(nodes))
    const orphaned = { ...settled }
    delete orphaned.mezzanine_test

    const plan = planDeckSlabs(orphaned)
    expect(plan.deletes).toEqual([deckSlabId('mezzanine_test', 0)])
  })

  test('mezzanine taşınınca güverte poligonu güncellenir', () => {
    const nodes = scene(mezzanine())
    const settled = apply(nodes, planDeckSlabs(nodes))
    const moved = { ...settled, mezzanine_test: mezzanine({ position: [10, 0, 0] }) }

    const plan = planDeckSlabs(moved)
    expect(plan.creates).toHaveLength(0)
    expect(plan.updates).toHaveLength(1)
    const polygon = plan.updates[0]?.data.polygon as [number, number][]
    expect(Math.min(...polygon.map((p) => p[0]))).toBeCloseTo(0, 9)
  })

  test('katı olmayan mezzanine atlanır', () => {
    const orphan = mezzanine({ parentId: null })
    expect(planDeckSlabs({ [orphan.id]: orphan }).creates).toHaveLength(0)
  })
})

describe('mezzanine KENDİ güvertesine tırmanamaz', () => {
  test('kendi güvertesini taşıyıcı yazan mezzanine zemine geri çivilenir', () => {
    const nodes = scene(mezzanine())
    const settled = apply(nodes, planDeckSlabs(nodes))

    // Taşıma sürüklemesi kalıcı sahibi atlar ve bırakma anında kendi eski
    // güvertesini yazabilir. Yakalanmazsa: güverte bir üst kota taşınır,
    // sonraki karede yine, ve mezzanine sonsuza kadar yükselir.
    const selfHosted = {
      ...settled,
      mezzanine_test: mezzanine({ supportSlabId: deckSlabId('mezzanine_test', 0) }),
    }

    const plan = planDeckSlabs(selfHosted)
    const reset = plan.updates.find((entry) => entry.id === 'mezzanine_test')
    expect(reset?.data.supportSlabId).toBe(GROUND_SUPPORT_ID)
  })

  test('BAŞKA bir mezzanine’in güvertesinde durmak meşru — sıfırlanmaz', () => {
    const mine = mezzanine()
    const other = mezzanine({ id: 'mezzanine_other', position: [40, 0, 0] })
    const nodes: Record<string, unknown> = {
      level_1: { id: 'level_1', type: 'level', parentId: null },
      [mine.id]: mine,
      [other.id]: other,
    }
    const settled = apply(nodes, planDeckSlabs(nodes))
    const stacked = {
      ...settled,
      [mine.id]: mezzanine({ supportSlabId: deckSlabId('mezzanine_other', 0) }),
    }

    const plan = planDeckSlabs(stacked)
    expect(plan.updates.find((entry) => entry.id === mine.id)).toBeUndefined()
  })
})

describe('hedef güverte seçimi — nişan alarak yapılamıyor', () => {
  test('seçili güverte taban izi İÇİNDE taşıyıcı olur', () => {
    const mezz = mezzanine()
    useWarehouseStore.getState().setActiveDeck({ mezzanineId: mezz.id, tierIndex: 0 })
    const scene = { level_1: { id: 'level_1', type: 'level' }, [mezz.id]: mezz }

    expect(electSupportSlab(scene, 'level_1', 0, 0)).toBe(deckSlabId(mezz.id, 0))
    useWarehouseStore.getState().setActiveDeck(null)
  })

  test('taban izinin DIŞINDA seçim yok sayılır', () => {
    // Aksi hâlde binanın öbür ucuna konan bir palet de güverteye uçardı.
    const mezz = mezzanine()
    useWarehouseStore.getState().setActiveDeck({ mezzanineId: mezz.id, tierIndex: 0 })
    const scene = { level_1: { id: 'level_1', type: 'level' }, [mezz.id]: mezz }

    expect(electSupportSlab(scene, 'level_1', 200, 200)).not.toBe(deckSlabId(mezz.id, 0))
    useWarehouseStore.getState().setActiveDeck(null)
  })

  test('seçim yokken zemin davranışı değişmez', () => {
    const mezz = mezzanine()
    const scene = { level_1: { id: 'level_1', type: 'level' }, [mezz.id]: mezz }
    expect(electSupportSlab(scene, 'level_1', 0, 0)).toBeNull()
  })

  test('ALT tier de seçilebiliyor — hatanın kendisi buydu', () => {
    // İki katlı mezzanine'de üstteki güverte ışını her zaman önce kesiyor,
    // yani alttakine nişan alınamıyordu. Açık seçim bunu aşıyor.
    const mezz = mezzanine({ tiers: [tier(), tier({ index: 1 })] })
    const scene = { level_1: { id: 'level_1', type: 'level' }, [mezz.id]: mezz }

    useWarehouseStore.getState().setActiveDeck({ mezzanineId: mezz.id, tierIndex: 0 })
    expect(electSupportSlab(scene, 'level_1', 0, 0)).toBe(deckSlabId(mezz.id, 0))

    useWarehouseStore.getState().setActiveDeck({ mezzanineId: mezz.id, tierIndex: 1 })
    expect(electSupportSlab(scene, 'level_1', 0, 0)).toBe(deckSlabId(mezz.id, 1))
    useWarehouseStore.getState().setActiveDeck(null)
  })

  test('kapsama testi dönüşü hesaba katıyor', () => {
    const rotated = mezzanine({ rotation: [0, Math.PI / 2, 0] })
    // Taban izi 20×15; 90° dönünce dünyada 15×20 olur.
    expect(mezzanineContains(rotated, 0, 9)).toBe(true)
    expect(mezzanineContains(rotated, 9, 0)).toBe(false)
  })
})

describe('özel şekil — slab gibi poligon', () => {
  /** L şekli: 20×15 dikdörtgenin sağ-üst çeyreği kesilmiş. */
  const lShape: [number, number][] = [
    [-10, -7.5],
    [0, -7.5],
    [0, 0],
    [10, 0],
    [10, 7.5],
    [-10, 7.5],
  ]

  test('poligon yoksa ızgaradan dikdörtgen çıkar — eski sahneler aynen çalışır', () => {
    const rect = outlinePolygon(mezzanine())
    expect(rect).toHaveLength(4)
    expect(Math.min(...rect.map(([x]) => x))).toBeCloseTo(-10, 9)
    expect(Math.max(...rect.map(([, z]) => z))).toBeCloseTo(7.5, 9)
    expect(hasCustomOutline(mezzanine())).toBe(false)
  })

  test('güverte slab’ı gerçek şekli taşıyor', () => {
    const spec = deckSlabSpecs(mezzanine({ polygon: lShape }), 0)[0]
    expect(spec?.polygon).toHaveLength(6)
  })

  test('çentiğe tıklamak güverteyi hedeflemiyor — orada güverte YOK', () => {
    const mezz = mezzanine({ polygon: lShape })
    // Kesilen çeyreğin ortası: sınır kutusunun içinde ama poligonun dışında.
    expect(mezzanineContains(mezz, 5, -4)).toBe(false)
    // Dolu tarafın ortası.
    expect(mezzanineContains(mezz, -5, 4)).toBe(true)
  })

  test('kolonlar poligonun dışına çıkmıyor', () => {
    const mezz = mezzanine({ polygon: lShape })
    const points = gridColumnPositions(mezz)
    expect(points.length).toBeGreaterThan(0)
    for (const point of points) {
      expect(pointInPolygon(point.x, point.z, lShape), `(${point.x}, ${point.z})`).toBe(true)
    }
    // Dikdörtgenden AZ kolon: çentik boşaldı.
    expect(points.length).toBeLessThan(gridColumnPositions(mezzanine()).length)
  })

  test('döşeme panelleri çentiğe basmıyor', () => {
    const custom = mezzanineParts(mezzanine({ polygon: lShape })).filter((p) => p.role === 'floor')
    const full = mezzanineParts(mezzanine()).filter((p) => p.role === 'floor')
    expect(custom.length).toBeGreaterThan(0)
    expect(custom.length).toBeLessThan(full.length)
    for (const panel of custom) {
      expect(pointInPolygon(panel.center[0], panel.center[2], lShape)).toBe(true)
    }
  })

  test('sınır kutusu poligondan okunuyor', () => {
    const narrow = mezzanine({
      polygon: [
        [-2, -3],
        [2, -3],
        [2, 3],
        [-2, 3],
      ],
    })
    expect(footprintWidthM(narrow)).toBeCloseTo(4, 9)
    expect(footprintDepthM(narrow)).toBeCloseTo(6, 9)
  })

  test('iki köşeli poligon reddedilir — alan tarif etmiyor', () => {
    expect(() =>
      MezzanineNode.parse({
        polygon: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toThrow()
  })
})

describe('korkuluk anahatı takip ediyor', () => {
  const lShape: [number, number][] = [
    [-10, -7.5],
    [0, -7.5],
    [0, 0],
    [10, 0],
    [10, 7.5],
    [-10, 7.5],
  ]

  test('dikdörtgende dört kenar, her kardinalin tek temsilcisi', () => {
    const edges = outlineEdges(mezzanine())
    expect(edges).toHaveLength(4)
    expect(edges.every((e) => e.representative)).toBe(true)
    expect(new Set(edges.map((e) => e.cardinal)).size).toBe(4)
  })

  test('L şeklinde altı kenar ve korkuluk çentiği dönüyor', () => {
    const edges = outlineEdges(mezzanine({ polygon: lShape }))
    expect(edges).toHaveLength(6)
    // Çentik iki fazla kenar getiriyor; korkuluk artık oraları da sarıyor.
    const rails = mezzanineParts(mezzanine({ polygon: lShape })).filter((p) => p.role === 'railing')
    expect(rails.length).toBeGreaterThan(0)
  })

  test('dış normal poligondan çıkıyor, sarımdan DEĞİL', () => {
    // Sarımı ters çevirmek normalleri döndürmemeli; yoksa çizim aracının
    // normalleştirmesi bir gün değişirse korkuluk sessizce içe döner.
    const forward = outlineEdges(mezzanine({ polygon: lShape }))
    const reversed = outlineEdges(mezzanine({ polygon: [...lShape].reverse() }))
    for (const edge of [...forward, ...reversed]) {
      // Normal boyunca bir adım POLİGONUN DIŞINA düşmeli.
      const midX = (edge.a[0] + edge.b[0]) / 2 + edge.outward[0] * 0.2
      const midZ = (edge.a[1] + edge.b[1]) / 2 + edge.outward[1] * 0.2
      expect(pointInPolygon(midX, midZ, lShape)).toBe(false)
    }
  })

  test('aynı kardinale bakan iki kenardan yalnız biri açıklık kesiyor', () => {
    // `edge: 'north'` diyen bir kapı kuzeye bakan HER kenarda açılamaz —
    // bir kapı bir yerdedir.
    const edges = outlineEdges(mezzanine({ polygon: lShape }))
    const byCardinal = new Map<string, number>()
    for (const edge of edges) {
      if (!edge.representative) continue
      byCardinal.set(edge.cardinal, (byCardinal.get(edge.cardinal) ?? 0) + 1)
    }
    for (const count of byCardinal.values()) expect(count).toBe(1)
  })
})
