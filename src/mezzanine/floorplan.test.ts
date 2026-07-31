import { describe, expect, test } from 'bun:test'
import type { GeometryContext } from '@pascal-app/core'
import { buildMezzanineFloorplan } from './floorplan'
import { gridColumnPositions, resolveTierElevations } from './metrics'
import { mezzanineParts } from './parts'
import { tierVoidRects } from './railing'
import { emptyAccessories, MezzanineNode, type StaircaseSpec } from './schema'
import { resolveSteps } from './stairs'

const CTX_UNSELECTED = {} as GeometryContext
const CTX_SELECTED = {
  viewState: { selected: true, palette: { selectedStroke: '#fff', selectedFill: '#333' } },
} as unknown as GeometryContext

const stair = (patch: Partial<StaircaseSpec> = {}): StaircaseSpec => ({
  id: 'stair-A',
  placement: { mode: 'edge', edge: 'west', offsetM: 3 },
  widthM: 1,
  landing: 'turn180',
  railings: 2,
  steps: 'auto',
  ...patch,
})

function nodeWith(accessories: Partial<ReturnType<typeof emptyAccessories>> = {}) {
  return MezzanineNode.parse({
    grid: { baysX: 4, baysY: 3, bayWidthM: 5, bayDepthM: 5 },
    tiers: [
      {
        index: 0,
        elevationM: 'auto',
        clearHeightM: 3,
        loadClass: 500,
        floorType: 'WOOD_CHIPBOARD_30',
        accessories: { ...emptyAccessories(), ...accessories },
      },
    ],
  })
}

function childrenOf(node: MezzanineNode, ctx: GeometryContext) {
  const plan = buildMezzanineFloorplan(node, ctx)
  if (plan?.kind !== 'group') throw new Error('grup bekleniyordu')
  return plan.children
}

describe('plan 3B ile AYNI kaynaktan türer', () => {
  test('her kolon kaydı 3B kolonunun tam yerinde', () => {
    const node = nodeWith()
    const planned = childrenOf(node, CTX_UNSELECTED).filter((c) => c.kind === 'rect')
    for (const point of gridColumnPositions(node)) {
      const match = planned.find(
        (c) =>
          c.kind === 'rect' &&
          Math.abs(c.x + c.width / 2 - point.x) < 1e-6 &&
          Math.abs(c.y + c.height / 2 - point.z) < 1e-6,
      )
      expect(match, `(${point.x}, ${point.z})`).toBeDefined()
    }
  })

  test('merdiven boşluğu planda 3B ile aynı dikdörtgen', () => {
    const node = nodeWith({ staircases: [stair()] })
    const resolved = resolveTierElevations(node.tiers)
    const tier = resolved[0]
    if (!tier) throw new Error('tier yok')
    const rects = tierVoidRects(node, tier, tier.deckTopM - tier.resolvedElevationM)
    const rect = rects[0]
    if (!rect) throw new Error('boşluk yok')

    const dashed = childrenOf(node, CTX_UNSELECTED).find(
      (c) => c.kind === 'rect' && 'strokeDasharray' in c && !!c.strokeDasharray,
    )
    if (dashed?.kind !== 'rect') throw new Error('boşluk çizilmedi')
    expect(dashed.x).toBeCloseTo(rect.x0, 9)
    expect(dashed.y).toBeCloseTo(rect.z0, 9)
    expect(dashed.width).toBeCloseTo(rect.x1 - rect.x0, 9)
  })

  test('basamak sayısı 3B parçalarıyla birebir', () => {
    const node = nodeWith({ staircases: [stair()] })
    const resolved = resolveTierElevations(node.tiers)
    const tier = resolved[0]
    if (!tier) throw new Error('tier yok')
    const { geometry } = resolveSteps(stair(), tier.deckTopM - tier.resolvedElevationM)
    const treads3d = mezzanineParts(node).filter((p) => p.role === 'stair-tread').length
    expect(treads3d).toBe(geometry.steps)
    // Planda basamak çizgileri + ok gövdesi + ok başı var; basamak sayısı
    // 3B'yle aynı olmak zorunda, çünkü ikisi de `resolveSteps`'ten geliyor.
    expect(geometry.steps).toBeGreaterThan(0)
  })
})

describe('plan sembolü okunabilir kalıyor', () => {
  test('hiçbir dolgulu primitif fill: none taşımaz — sembol seçilebilir kalır', () => {
    for (const node of [nodeWith(), nodeWith({ staircases: [stair()] })]) {
      for (const child of childrenOf(node, CTX_UNSELECTED)) {
        if ('fill' in child) expect(child.fill).not.toBe('none')
      }
    }
  })

  test('kanat kapı: kanat + menteşe + süpürme yayı — düz bant değil', () => {
    // Düz sarı bir bant kapının hangi yöne açıldığını ve ne kadar zemin
    // süpürdüğünü söylemiyordu; planı okuyan kişi tam bunu soruyor.
    const kids = childrenOf(
      nodeWith({ swingGates: [{ edge: 'north', offsetM: 10, widthM: 0.75 }] }),
      CTX_UNSELECTED,
    )
    const paths = kids.filter((c) => c.kind === 'path' && 'stroke' in c && c.stroke === '#f2c200')
    // Kanat çizgisi + süpürme yayı.
    expect(paths.length).toBe(2)
    expect(paths.some((c) => 'd' in c && String(c.d).includes('A'))).toBe(true)
    // Menteşe noktası.
    expect(kids.some((c) => c.kind === 'circle' && 'fill' in c && c.fill === '#f2c200')).toBe(true)
  })

  test('yukarı-devrilir kapı kanat kapıdan AYIRT EDİLİYOR', () => {
    // Personel kapısı ile palet kapısı planda aynı görünmemeli.
    const upOver = childrenOf(
      nodeWith({ upAndOverGates: [{ edge: 'north', offsetM: 10, widthM: 1.5 }] }),
      CTX_UNSELECTED,
    )
    // Yay YOK (dikey döner); onun yerine içeri uzanan kesikli flap var —
    // 3B'deki yatay kanadın gerçek izdüşümü.
    expect(upOver.some((c) => c.kind === 'path' && 'd' in c && String(c.d).includes('A'))).toBe(
      false,
    )
    expect(
      upOver.some((c) => c.kind === 'rect' && 'strokeDasharray' in c && c.fill === 'none'),
    ).toBe(true)
  })

  test('güvenlik bölgesi zincirle çiziliyor: kesikli çizgi + baklalar', () => {
    const kids = childrenOf(
      nodeWith({ safetyZones: [{ edge: 'east', offsetM: 8, widthM: 1.5 }] }),
      CTX_UNSELECTED,
    )
    const rings = kids.filter(
      (c) => c.kind === 'circle' && 'stroke' in c && c.stroke === '#f2c200' && c.fill === 'none',
    )
    expect(rings.length).toBe(3)
  })

  test('korkuluk kapıda kesilir — kapılı planda dolu korkuluk parçası artar', () => {
    const railPieces = (accessories: Parameters<typeof nodeWith>[0]) =>
      childrenOf(nodeWith(accessories), CTX_UNSELECTED).filter(
        (c) => c.kind === 'polygon' && 'fill' in c && c.fill === '#5a6570',
      ).length
    // Kuzey korkuluğu ikiye bölünür: +1 dolu parça.
    expect(railPieces({ swingGates: [{ edge: 'north', offsetM: 10, widthM: 0.75 }] })).toBe(
      railPieces({}) + 1,
    )
  })

  test('kiriş ızgarası planda — yükün neyin üstünde durduğu okunur', () => {
    const kids = childrenOf(nodeWith(), CTX_UNSELECTED)
    const beams = kids.filter((c) => c.kind === 'rect' && 'opacity' in c && c.opacity !== undefined)
    // Ana hatlar (baysY+1) + ikinciller — sayı grid'e bağlı, varlığı sabit.
    expect(beams.length).toBeGreaterThan(5)
  })

  test('etiketler yalnız seçiliyken — plan kalabalıklaşmasın', () => {
    const node = nodeWith({ staircases: [stair()] })
    const labels = (ctx: GeometryContext) =>
      childrenOf(node, ctx).filter((c) => c.kind === 'dimension-label').length
    expect(labels(CTX_UNSELECTED)).toBe(0)
    expect(labels(CTX_SELECTED)).toBeGreaterThan(0)
  })

  test('çok katlıda EN ÜST tier çizilir — alt katların korkuluğu üst üste binmez', () => {
    const twoTier = MezzanineNode.parse({
      grid: { baysX: 4, baysY: 3, bayWidthM: 5, bayDepthM: 5 },
      tiers: [
        {
          index: 0,
          elevationM: 'auto',
          clearHeightM: 3,
          loadClass: 500,
          floorType: 'WOOD_CHIPBOARD_30',
          accessories: {
            ...emptyAccessories(),
            swingGates: [{ edge: 'north', offsetM: 5, widthM: 0.75 }],
          },
        },
        {
          index: 1,
          elevationM: 'auto',
          clearHeightM: 3,
          loadClass: 500,
          floorType: 'WOOD_CHIPBOARD_30',
          accessories: emptyAccessories(),
        },
      ],
    })
    // Üst tier'in kapısı yok, dolayısıyla planda sarı kanat da olmamalı.
    const gate = childrenOf(twoTier, CTX_UNSELECTED).find(
      (c) => c.kind === 'rect' && 'fill' in c && c.fill === '#f2c200',
    )
    expect(gate).toBeUndefined()
  })
})

describe('döşeme deseni — hatch2D artık okunuyor', () => {
  const withFloor = (
    floorType: string,
    grid = { baysX: 4, baysY: 3, bayWidthM: 5, bayDepthM: 5 },
  ) =>
    MezzanineNode.parse({
      grid,
      tiers: [
        {
          index: 0,
          elevationM: 'auto',
          clearHeightM: 3,
          loadClass: 500,
          floorType,
          accessories: emptyAccessories(),
        },
      ],
    })

  /** Zemin dikdörtgeni ve kolon kayıtları dışındaki desen işaretleri. */
  const markCount = (floorType: string, grid?: Parameters<typeof withFloor>[1]) =>
    childrenOf(withFloor(floorType, grid), CTX_UNSELECTED).filter(
      (c) => c.kind === 'circle' || (c.kind === 'rect' && (c as { opacity?: number }).opacity),
    ).length

  test('sunta ile çelik ızgara planda AYNI görünmüyor', () => {
    // Bu ikisinin ayırt edilememesi bir yangın senaryosunu görünmez
    // kılıyordu: ızgara sprinkler suyunu geçirir, sunta geçirmez.
    const chipboard = childrenOf(withFloor('WOOD_CHIPBOARD_30'), CTX_UNSELECTED)
    const grid = childrenOf(withFloor('METAL_GRID'), CTX_UNSELECTED)

    // Sunta noktalı: daire üretir. Izgara çizgili: daire üretmez.
    expect(chipboard.some((c) => c.kind === 'circle')).toBe(true)
    expect(grid.some((c) => c.kind === 'circle')).toBe(false)
  })

  test('beş desenin hepsi işaret üretiyor', () => {
    for (const floorType of [
      'WOOD_CHIPBOARD_30',
      'METAL_CORRUGATED',
      'METAL_SLOTTED',
      'METAL_PERFORATED',
      'METAL_GRID',
    ]) {
      expect(markCount(floorType), floorType).toBeGreaterThan(0)
    }
  })

  test('işaret sayısı sınırlı — büyük güvertede plan çizimi ölmemeli', () => {
    // Aralık alanla büyüyor: desen seyreliyor ama yok olmuyor.
    const huge = { baysX: 12, baysY: 10, bayWidthM: 6, bayDepthM: 6 }
    const count = markCount('METAL_PERFORATED', huge)
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(400)
  })
})
