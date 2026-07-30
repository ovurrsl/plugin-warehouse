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

  test('kapı planda kendi rengiyle çizilir', () => {
    const node = nodeWith({ swingGates: [{ edge: 'north', offsetM: 10, widthM: 0.75 }] })
    const gate = childrenOf(node, CTX_UNSELECTED).find(
      (c) => c.kind === 'rect' && 'fill' in c && c.fill === '#f2c200',
    )
    expect(gate).toBeDefined()
  })

  test('korkuluk kapıda kesilir — planda iki ayrı parça', () => {
    const plain = childrenOf(nodeWith(), CTX_UNSELECTED).length
    const gated = childrenOf(
      nodeWith({ swingGates: [{ edge: 'north', offsetM: 10, widthM: 0.75 }] }),
      CTX_UNSELECTED,
    ).length
    // Kuzey korkuluğu ikiye bölünür (+1) ve kapı kanadı eklenir (+1).
    expect(gated).toBe(plain + 2)
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
