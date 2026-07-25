import { describe, expect, test } from 'bun:test'
import { clearRackGeometryCache, getRackGeometry, rackGeometryKey } from './geometry-builder'
import { exceedsPartBudget, PART_BUDGET, rackParts } from './parts'
import { PalletRackNode } from './schema'
import {
  anchorOffset,
  bayAt,
  centerFromAnchor,
  depthPositionZ,
  palletSlotCount,
  rowAt,
  rowCenterZ,
  rowDepth,
  rowFacing,
  rowGapBefore,
  totalDepth,
  totalWidth,
} from './slots'

const rack = (overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_rows', ...overrides })

describe('row layout', () => {
  test('one row is the whole depth and consumes neither gap', () => {
    const single = rack()
    expect(totalDepth(single)).toBeCloseTo(rowDepth(single), 9)
    expect(rowCenterZ(single, 1)).toBeCloseTo(0, 9)
    expect(rowGapBefore(single, 1)).toBe(0)
  })

  test('a back-to-back pair uses the spine gap and never an aisle', () => {
    const pair = rack({ rowCount: 2, backToBackGap: 0.2, aisleWidth: 3.2 })
    expect(rowGapBefore(pair, 2)).toBeCloseTo(0.2, 9)
    expect(totalDepth(pair)).toBeCloseTo(2 * rowDepth(pair) + 0.2, 9)
    // Symmetric about the origin, and the two rows turn their backs on each
    // other so each opens onto its own aisle.
    expect(rowCenterZ(pair, 1)).toBeCloseTo(-rowCenterZ(pair, 2), 9)
    expect(rowFacing(pair, 1)).toBe(1)
    expect(rowFacing(pair, 2)).toBe(-1)
  })

  test('four rows are two pairs with one aisle between them', () => {
    const block = rack({ rowCount: 4, backToBackGap: 0.2, aisleWidth: 3.2 })
    expect(rowGapBefore(block, 2)).toBeCloseTo(0.2, 9)
    expect(rowGapBefore(block, 3)).toBeCloseTo(3.2, 9)
    expect(rowGapBefore(block, 4)).toBeCloseTo(0.2, 9)
    expect(totalDepth(block)).toBeCloseTo(4 * rowDepth(block) + 0.2 + 3.2 + 0.2, 9)

    // Rows 2 and 3 face the aisle between them from opposite sides — that is
    // what makes one aisle serve two rows.
    expect(rowFacing(block, 2)).toBe(-1)
    expect(rowFacing(block, 3)).toBe(1)
    const between = rowCenterZ(block, 2) - rowCenterZ(block, 3)
    expect(between).toBeCloseTo(rowDepth(block) + 3.2, 9)
  })

  test('the aisle pattern gives every row its own aisle and one facing', () => {
    const block = rack({ rowCount: 3, rowPattern: 'aisle', aisleWidth: 3.5 })
    expect(rowGapBefore(block, 2)).toBeCloseTo(3.5, 9)
    expect(rowGapBefore(block, 3)).toBeCloseTo(3.5, 9)
    expect(totalDepth(block)).toBeCloseTo(3 * rowDepth(block) + 7, 9)
    for (const row of [1, 2, 3]) expect(rowFacing(block, row)).toBe(1)
  })

  test('rows are laid out from +Z toward −Z and never overlap', () => {
    const block = rack({ rowCount: 5 })
    const half = rowDepth(block) / 2
    let previousBack = Number.POSITIVE_INFINITY
    for (let row = 1; row <= 5; row++) {
      const front = rowCenterZ(block, row) + half
      expect(front).toBeLessThanOrEqual(previousBack + 1e-9)
      previousBack = rowCenterZ(block, row) - half
    }
    // And the block's own envelope contains all of them exactly.
    expect(rowCenterZ(block, 1) + half).toBeCloseTo(totalDepth(block) / 2, 9)
    expect(previousBack).toBeCloseTo(-totalDepth(block) / 2, 9)
  })

  test('depth position 1 is the aisle side of whichever row it is on', () => {
    const block = rack({ rowCount: 4, depthPositions: 2 })
    for (let row = 1; row <= 4; row++) {
      const front = depthPositionZ(block, row, 1)
      const rear = depthPositionZ(block, row, 2)
      const outward = rowFacing(block, row)
      expect((front - rear) * outward).toBeGreaterThan(0)
    }
  })

  test('slot count scales with the rows', () => {
    const single = rack({ bayCount: 2, levels: 2, uprightHeight: 12 })
    const four = rack({ bayCount: 2, levels: 2, uprightHeight: 12, rowCount: 4 })
    expect(palletSlotCount(four)).toBe(palletSlotCount(single) * 4)
  })
})

describe('hit testing across rows', () => {
  test('a point in an aisle belongs to no row', () => {
    const block = rack({ rowCount: 4, aisleWidth: 3.2 })
    const aisleZ = (rowCenterZ(block, 2) + rowCenterZ(block, 3)) / 2
    expect(rowAt(block, aisleZ)).toBeNull()
    expect(bayAt(block, 0, aisleZ)).toBeNull()
  })

  test('a row centreline resolves to that row', () => {
    const block = rack({ bayCount: 3, rowCount: 4 })
    for (let row = 1; row <= 4; row++) {
      expect(rowAt(block, rowCenterZ(block, row))).toBe(row)
      expect(bayAt(block, 0, rowCenterZ(block, row))).toEqual({ row, bay: 2 })
    }
  })
})

describe('growth anchor', () => {
  test('a centred block is its own anchor', () => {
    const block = rack({ bayAnchor: 'center', rowAnchor: 'center' })
    expect(anchorOffset(block)).toEqual([0, 0])
  })

  test('anchoring the left end holds it still as bays are added', () => {
    const three = rack({ bayCount: 3, bayAnchor: 'left' })
    const twenty = rack({ bayCount: 20, bayAnchor: 'left' })
    const leftEdgeOf = (node: ReturnType<typeof rack>) =>
      centerFromAnchor(node, 10, 0, 0)[0] - totalWidth(node) / 2
    expect(leftEdgeOf(three)).toBeCloseTo(10, 9)
    expect(leftEdgeOf(twenty)).toBeCloseTo(10, 9)
  })

  test('anchoring the front face holds it still as rows are added', () => {
    const frontEdgeOf = (node: ReturnType<typeof rack>) =>
      centerFromAnchor(node, 0, 4, 0)[1] + totalDepth(node) / 2
    expect(frontEdgeOf(rack({ rowCount: 1, rowAnchor: 'front' }))).toBeCloseTo(4, 9)
    expect(frontEdgeOf(rack({ rowCount: 6, rowAnchor: 'front' }))).toBeCloseTo(4, 9)
  })

  test('the offset turns with the block', () => {
    const block = rack({ bayCount: 4, bayAnchor: 'left', rowAnchor: 'center' })
    const [dx] = anchorOffset(block)
    // A quarter turn puts the run along Z, so the whole offset lands there —
    // negated, because a +Y rotation carries local +X onto world −Z.
    const [x, z] = centerFromAnchor(block, 0, 0, Math.PI / 2)
    expect(x).toBeCloseTo(0, 9)
    expect(z).toBeCloseTo(-dx, 9)
  })
})

describe('part budget', () => {
  test('a normal block is nowhere near it', () => {
    expect(exceedsPartBudget(rack({ bayCount: 10, rowCount: 2 }))).toBe(false)
  })

  test('a block past the budget draws its silhouette at both tiers', () => {
    clearRackGeometryCache()
    const huge = rack({ bayCount: 40, rowCount: 20, levels: 4, uprightHeight: 12 })
    expect(rackParts(huge, 'full').length).toBeGreaterThan(PART_BUDGET)
    expect(exceedsPartBudget(huge)).toBe(true)

    // Same object under both keys rather than two builds of the same mesh, and
    // the mesh it settles on is the one `simple` would have produced.
    const full = getRackGeometry(huge, 'full')
    const simple = getRackGeometry(huge, 'simple')
    expect(full).toBe(simple)
    expect(full.getAttribute('position').count).toBe(rackParts(huge, 'simple').length * 24)
  })

  test('the budget does not reach into a block that fits', () => {
    clearRackGeometryCache()
    const normal = rack({ bayCount: 6, rowCount: 2 })
    const full = getRackGeometry(normal, 'full')
    expect(full).not.toBe(getRackGeometry(normal, 'simple'))
    expect(full.getAttribute('position').count).toBe(rackParts(normal, 'full').length * 24)
  })
})

describe('row fields in the geometry key', () => {
  const keysOf = (overrides: Record<string, unknown>) => rackGeometryKey(rack(overrides), 'full')

  test('gaps only split the cache once the block actually uses them', () => {
    // One row consumes neither gap, so neither may reach the key.
    expect(keysOf({ backToBackGap: 0.9 })).toBe(keysOf({}))
    expect(keysOf({ aisleWidth: 5 })).toBe(keysOf({}))
    // A pure pair opens no aisle.
    expect(keysOf({ rowCount: 2, aisleWidth: 5 })).toBe(keysOf({ rowCount: 2 }))
    // Three rows do.
    expect(keysOf({ rowCount: 3, aisleWidth: 5 })).not.toBe(keysOf({ rowCount: 3 }))
  })

  test('the pattern reaches the key through the gaps and the facings', () => {
    expect(keysOf({ rowCount: 2, rowPattern: 'aisle' })).not.toBe(keysOf({ rowCount: 2 }))
  })
})
