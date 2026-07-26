import { describe, expect, test } from 'bun:test'
import { planBayDeletion, splitGap } from './bay-delete'
import { PalletRackNode } from './schema'
import { bayCenterX, bayPitch, totalWidth } from './slots'

const rack = (overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_delete', ...overrides })

/** Where a bay's centre sits in the world, for a node at `position` with no
 *  rotation — the figure that must not move when a *different* bay is cut. */
function worldBayCentre(node: ReturnType<typeof rack>, bay: number): number {
  return node.position[0] + bayCenterX(node, bay)
}

/** The block's world-space left and right edges. */
function edges(node: ReturnType<typeof rack>): [number, number] {
  const half = totalWidth(node) / 2
  return [node.position[0] - half, node.position[0] + half]
}

describe('the reported bug', () => {
  test('deleting one bay of two leaves a one-bay run where the survivor stood', () => {
    // The exact repro: place a rack, set bayCount 2, click a bay, Delete.
    // What happened was both bays vanishing, because the host deletes nodes and
    // a block is one node.
    const before = rack({ bayCount: 2, position: [5, 0, 3] })
    const survivorWas = worldBayCentre(before, 1)

    const plan = planBayDeletion(before, 2)
    expect(plan?.kind).toBe('shrink')
    if (plan?.kind !== 'shrink') return

    const after = rack({ ...before, ...plan.patch })
    expect(after.bayCount).toBe(1)
    expect(worldBayCentre(after, 1)).toBeCloseTo(survivorWas, 9)
  })

  test('and deleting the other one leaves the other survivor where it stood', () => {
    const before = rack({ bayCount: 2, position: [5, 0, 3] })
    const survivorWas = worldBayCentre(before, 2)

    const plan = planBayDeletion(before, 1)
    expect(plan?.kind).toBe('shrink')
    if (plan?.kind !== 'shrink') return

    const after = rack({ ...before, ...plan.patch })
    expect(after.bayCount).toBe(1)
    expect(worldBayCentre(after, 1)).toBeCloseTo(survivorWas, 9)
  })
})

describe('shrinking from an end', () => {
  test('every surviving bay stays exactly where it was', () => {
    for (const cut of [1, 6]) {
      const before = rack({ bayCount: 6, position: [-2, 0, 7] })
      const wasAt = new Map<number, number>()
      for (let bay = 1; bay <= 6; bay++) {
        if (bay !== cut) wasAt.set(bay, worldBayCentre(before, bay))
      }

      const plan = planBayDeletion(before, cut)
      if (plan?.kind !== 'shrink') throw new Error(`expected shrink for bay ${cut}`)
      const after = rack({ ...before, ...plan.patch })

      // Bay indices close up around the cut, so compare by identity rather than
      // by index: the bay that was 3 is now 2 when the first was removed.
      const survivors = [...wasAt.entries()].sort((a, b) => a[0] - b[0])
      survivors.forEach(([, x], index) => {
        expect(worldBayCentre(after, index + 1)).toBeCloseTo(x, 9)
      })
    }
  })

  test('the far edge stays put and the cut edge moves in by one pitch', () => {
    const before = rack({ bayCount: 4, position: [0, 0, 0] })
    const [leftBefore, rightBefore] = edges(before)

    const plan = planBayDeletion(before, 4)
    if (plan?.kind !== 'shrink') throw new Error('expected shrink')
    const after = rack({ ...before, ...plan.patch })
    const [leftAfter, rightAfter] = edges(after)

    expect(leftAfter).toBeCloseTo(leftBefore, 9)
    expect(rightAfter).toBeCloseTo(rightBefore - bayPitch(before), 9)
  })

  test('a rotated run shrinks along its own axis, not the world one', () => {
    const before = rack({ bayCount: 3, position: [0, 0, 0], rotation: [0, Math.PI / 2, 0] })
    const plan = planBayDeletion(before, 3)
    if (plan?.kind !== 'shrink') throw new Error('expected shrink')
    const [x, , z] = plan.patch.position as [number, number, number]
    // A quarter turn carries local +X onto world −Z, so a shift along local −X
    // lands entirely on +Z and leaves X alone.
    expect(x).toBeCloseTo(0, 9)
    expect(z).toBeCloseTo(bayPitch(before) / 2, 9)
  })
})

describe('splitting at an interior bay', () => {
  test('the two halves cover the original run minus the cut bay', () => {
    const before = rack({ bayCount: 5, position: [10, 0, 0] })
    const [leftBefore, rightBefore] = edges(before)

    const plan = planBayDeletion(before, 3)
    expect(plan?.kind).toBe('split')
    if (plan?.kind !== 'split') return

    const left = rack({ ...before, ...plan.left })
    const right = rack({ ...before, ...plan.right })
    expect(left.bayCount).toBe(2)
    expect(right.bayCount).toBe(2)

    // The pair occupies the envelope the single run did: nothing that survives
    // has moved.
    expect(edges(left)[0]).toBeCloseTo(leftBefore, 9)
    expect(edges(right)[1]).toBeCloseTo(rightBefore, 9)
  })

  test('the opening between them is the deleted bay, to the millimetre', () => {
    const before = rack({ bayCount: 5 })
    const plan = planBayDeletion(before, 3)
    if (plan?.kind !== 'split') throw new Error('expected split')
    const left = rack({ ...before, ...plan.left })
    const right = rack({ ...before, ...plan.right })

    const gap = edges(right)[0] - edges(left)[1]
    expect(gap).toBeCloseTo(splitGap(before), 9)
    expect(gap).toBeCloseTo(before.bayClearWidth, 9)
  })

  test('every surviving bay is still where it was', () => {
    const before = rack({ bayCount: 5, position: [-4, 0, 2] })
    const wasAt = [1, 2, 4, 5].map((bay) => worldBayCentre(before, bay))

    const plan = planBayDeletion(before, 3)
    if (plan?.kind !== 'split') throw new Error('expected split')
    const left = rack({ ...before, ...plan.left })
    const right = rack({ ...before, ...plan.right })

    expect(worldBayCentre(left, 1)).toBeCloseTo(wasAt[0] as number, 9)
    expect(worldBayCentre(left, 2)).toBeCloseTo(wasAt[1] as number, 9)
    expect(worldBayCentre(right, 1)).toBeCloseTo(wasAt[2] as number, 9)
    expect(worldBayCentre(right, 2)).toBeCloseTo(wasAt[3] as number, 9)
  })

  test('the frame count is unchanged — both halves keep the shared frame', () => {
    const before = rack({ bayCount: 5 })
    const plan = planBayDeletion(before, 3)
    if (plan?.kind !== 'split') throw new Error('expected split')
    const left = rack({ ...before, ...plan.left })
    const right = rack({ ...before, ...plan.right })
    expect(left.bayCount + 1 + (right.bayCount + 1)).toBe(before.bayCount + 1)
  })
})

describe('overrides follow their bay', () => {
  test('shrinking from the left renumbers what is left of it', () => {
    const before = rack({
      bayCount: 4,
      bayOverrides: {
        'R1-B1': { skipped: true },
        'R1-B3': { tunnelLevels: 1 },
        'R1-B4': { decking: 'open' },
      },
    })
    const plan = planBayDeletion(before, 1)
    if (plan?.kind !== 'shrink') throw new Error('expected shrink')
    // B1 went with its bay; B3 and B4 slid down by one.
    expect(plan.patch.bayOverrides).toEqual({
      'R1-B2': { tunnelLevels: 1 },
      'R1-B3': { decking: 'open' },
    })
  })

  test('shrinking from the right drops only the last', () => {
    const before = rack({
      bayCount: 3,
      bayOverrides: { 'R1-B1': { skipped: true }, 'R1-B3': { skipped: true } },
    })
    const plan = planBayDeletion(before, 3)
    if (plan?.kind !== 'shrink') throw new Error('expected shrink')
    expect(plan.patch.bayOverrides).toEqual({ 'R1-B1': { skipped: true } })
  })

  test('a split sends each override to the half that kept its bay', () => {
    const before = rack({
      bayCount: 5,
      rowCount: 2,
      bayOverrides: {
        'R1-B1': { decking: 'open' },
        'R2-B2': { tunnelLevels: 2 },
        'R1-B3': { skipped: true },
        'R1-B4': { levels: 1 },
        'R2-B5': { decking: 'steel' },
      },
    })
    const plan = planBayDeletion(before, 3)
    if (plan?.kind !== 'split') throw new Error('expected split')

    expect(plan.left.bayOverrides).toEqual({
      'R1-B1': { decking: 'open' },
      'R2-B2': { tunnelLevels: 2 },
    })
    // B4 and B5 become B1 and B2 of the right-hand run; B3 went with its bay.
    expect(plan.right.bayOverrides).toEqual({
      'R1-B1': { levels: 1 },
      'R2-B2': { decking: 'steel' },
    })
  })
})

describe('edges of the operation', () => {
  test('the last bay takes the node with it', () => {
    expect(planBayDeletion(rack({ bayCount: 1 }), 1)).toEqual({ kind: 'delete-node' })
  })

  test('a bay the run does not have is not a deletion', () => {
    const node = rack({ bayCount: 3 })
    expect(planBayDeletion(node, 0)).toBeNull()
    expect(planBayDeletion(node, 4)).toBeNull()
  })

  test('a two-bay run never splits — both bays are ends', () => {
    for (const bay of [1, 2]) {
      expect(planBayDeletion(rack({ bayCount: 2 }), bay)?.kind).toBe('shrink')
    }
  })
})
