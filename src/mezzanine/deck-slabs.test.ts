import { describe, expect, test } from 'bun:test'
import { planDeckSlabs } from './deck-slab-system'
import {
  DECK_OWNER_KEY,
  deckOwnerOf,
  deckSlabId,
  deckSlabSpecs,
  GROUND_SUPPORT_ID,
} from './deck-slabs'
import { resolveTierElevations } from './metrics'
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
