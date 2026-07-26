import { describe, expect, test } from 'bun:test'
import { bayFromLocalHit } from './bay-focus'
import { PalletRackNode } from './schema'
import { bayCenterX, rowCenterZ, totalDepth, totalWidth } from './slots'

const rack = (overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_focus', ...overrides })

/**
 * The point the host would report for a click at a given rack-local metre
 * position — normalised against the picking collider, which is a unit cube
 * scaled to the block.
 */
const asHit = (node: ReturnType<typeof rack>, x: number, z: number): [number, number, number] => [
  x / totalWidth(node),
  0,
  z / totalDepth(node),
]

describe('bay from a click', () => {
  test('the centre of every bay resolves to that bay', () => {
    const node = rack({ bayCount: 6, rowCount: 4 })
    for (let row = 1; row <= 4; row++) {
      for (let bay = 1; bay <= 6; bay++) {
        const hit = asHit(node, bayCenterX(node, bay), rowCenterZ(node, row))
        expect(bayFromLocalHit(node, hit)).toEqual({ row, bay })
      }
    }
  })

  test('reading the point as metres would put every click in bay 1', () => {
    // The mistake this test exists for. A 17 m six-bay run reports ±0.5 for its
    // full width, so an unscaled read never leaves the middle bay — and bay 1
    // of row 1 is a plausible enough answer that nothing would look wrong.
    const node = rack({ bayCount: 6 })
    const lastBayCentre = bayCenterX(node, 6)
    expect(totalWidth(node)).toBeGreaterThan(10)
    expect(bayFromLocalHit(node, asHit(node, lastBayCentre, 0))).toEqual({ row: 1, bay: 6 })
    // Unscaled, the same click lands nowhere near bay 6.
    const unscaled = bayFromLocalHit(node, [lastBayCentre / totalWidth(node), 0, 0] as const)
    const naive = bayFromLocalHit(node, [lastBayCentre, 0, 0] as const)
    expect(unscaled).toEqual({ row: 1, bay: 6 })
    expect(naive).not.toEqual({ row: 1, bay: 6 })
  })

  test('a click in an aisle belongs to no bay', () => {
    const node = rack({ bayCount: 3, rowCount: 4, aisleWidth: 3.2 })
    const aisleZ = (rowCenterZ(node, 2) + rowCenterZ(node, 3)) / 2
    expect(bayFromLocalHit(node, asHit(node, 0, aisleZ))).toBeNull()
  })

  test('a click past the ends belongs to no bay', () => {
    const node = rack({ bayCount: 2 })
    expect(bayFromLocalHit(node, [0.6, 0, 0])).toBeNull()
    expect(bayFromLocalHit(node, [-0.6, 0, 0])).toBeNull()
  })

  test('the block turning does not change the answer', () => {
    // `localPosition` is already in the hit object's frame, so the rack's own
    // rotation is divided out before this ever sees it. A bay index that moved
    // when the rack was turned would mean the click was being read in world
    // space somewhere upstream.
    const upright = rack({ bayCount: 4 })
    const turned = rack({ bayCount: 4, rotation: [0, Math.PI / 2, 0] })
    const hit = asHit(upright, bayCenterX(upright, 3), 0)
    expect(bayFromLocalHit(upright, hit)).toEqual({ row: 1, bay: 3 })
    expect(bayFromLocalHit(turned, hit)).toEqual({ row: 1, bay: 3 })
  })
})
