import { describe, expect, test } from 'bun:test'
import { buildPalletRackFloorplan, PLAN_ROLES } from './floorplan'
import { rackParts } from './parts'
import { PalletRackNode } from './schema'
import { orientedPalletFootprint, totalDepth, totalWidth } from './slots'

const rack = (overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_plan', ...overrides })

const ctx = { viewState: undefined } as never

type Rect = { kind: string; x: number; y: number; width: number; height: number }

function rects(node: ReturnType<typeof rack>): Rect[] {
  const geometry = buildPalletRackFloorplan(node, ctx)
  if (geometry?.kind !== 'group') return []
  return geometry.children.filter((child): child is Rect & typeof child => child.kind === 'rect')
}

describe('the plan is projected from the model, not recomputed', () => {
  test('every steel part appears in plan at exactly its 3D footprint', () => {
    // The invariant that makes "2D matches 3D" a fact instead of a hope. Both
    // now read one part list; this asserts the projection is faithful.
    for (const config of [
      {},
      { depthPositions: 2 },
      { hasGroundBeam: true },
      { tunnelLevels: 1 },
      { pickingLevels: 1 },
    ]) {
      const node = rack(config)
      const drawn = rects(node)
      const parts = rackParts(node, 'full').filter((part) => PLAN_ROLES.has(part.role))

      for (const part of parts) {
        const x = part.center[0] - part.size[0] / 2
        const y = part.center[2] - part.size[2] / 2
        const match = drawn.find(
          (rect) =>
            Math.abs(rect.x - x) < 1e-9 &&
            Math.abs(rect.y - y) < 1e-9 &&
            Math.abs(rect.width - part.size[0]) < 1e-9 &&
            Math.abs(rect.height - part.size[2]) < 1e-9,
        )
        expect({ config, role: part.role, found: Boolean(match) }).toEqual({
          config,
          role: part.role,
          found: true,
        })
      }
    }
  })

  test('the plan gains parts when the model does', () => {
    // A plan that ignored a structural field would still look plausible; this
    // catches the projection silently falling behind the model.
    const plain = rects(rack()).length
    expect(rects(rack({ depthPositions: 2 })).length).toBeGreaterThan(plain)
    expect(rects(rack({ hasGroundBeam: true })).length).toBeGreaterThan(plain)
    expect(rects(rack({ levels: 6, uprightHeight: 9 })).length).toBeGreaterThan(plain)
    // And loses them when the model does. A tunnel through every level leaves
    // the frames and takes the beams and the pallet positions with it.
    expect(rects(rack({ tunnelLevels: 15 })).length).toBeLessThan(plain)
  })

  test('the outline is the collision footprint', () => {
    const node = rack({ depthPositions: 2 })
    const outline = rects(node)[0]
    expect(outline?.width).toBeCloseTo(totalWidth(node), 9)
    expect(outline?.height).toBeCloseTo(totalDepth(node), 9)
    expect(outline?.x).toBeCloseTo(-totalWidth(node) / 2, 9)
  })

  test('steel stays inside the outline; pallets overhang it, as they really do', () => {
    const node = rack({ depthPositions: 2 })
    const halfWidth = totalWidth(node) / 2
    const halfDepth = totalDepth(node) / 2
    const [, palletDepth] = orientedPalletFootprint(node)
    // The catalogue pairs a 1,100 mm frame with a 1,200 mm pallet whatever the
    // pallet, so the load protrudes 50 mm front and back. That is intended, and
    // it is why aisle widths are quoted between loads rather than between
    // frames — a plan that clipped it would understate the aisle a truck needs.
    const overhang = Math.max(0, (palletDepth - node.depth) / 2)
    expect(overhang).toBeCloseTo(0.05, 9)

    for (const rect of rects(node)) {
      const isPallet = (rect as unknown as { fill?: string }).fill === 'transparent'
      const slack = isPallet ? overhang : 0
      expect(rect.x).toBeGreaterThanOrEqual(-halfWidth - 1e-9)
      expect(rect.x + rect.width).toBeLessThanOrEqual(halfWidth + 1e-9)
      expect(rect.y).toBeGreaterThanOrEqual(-halfDepth - slack - 1e-9)
      expect(rect.y + rect.height).toBeLessThanOrEqual(halfDepth + slack + 1e-9)
    }
  })

  test('the pallet positions in plan match the slot count', () => {
    const node = rack()
    const drawn = rects(node)
    const outlined = drawn.filter(
      (rect) => (rect as unknown as { fill?: string }).fill === 'transparent',
    )
    // One bay, 3 across, single depth.
    expect(outlined).toHaveLength(3)
  })
})
