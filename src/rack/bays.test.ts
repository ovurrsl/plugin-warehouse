import { describe, expect, test } from 'bun:test'
import { rackParts } from './parts'
import { PalletRackNode } from './schema'
import {
  bayAt,
  bayCenterX,
  bayLevelCount,
  bayStorageLevels,
  formatBayAddress,
  isBaySkipped,
  isFramePresent,
  palletSlotCount,
  parseBayAddress,
  presentBays,
  rowCenterZ,
  totalWidth,
} from './slots'

const rack = (overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_bays', ...overrides })

const uprights = (node: ReturnType<typeof rack>) =>
  rackParts(node, 'simple').filter((part) => part.role === 'upright')

describe('bay addressing', () => {
  test('a bay key round-trips and matches the slot address form', () => {
    expect(formatBayAddress(1, 3)).toBe('R1-B3')
    expect(parseBayAddress('R1-B3')).toEqual({ row: 1, bay: 3 })
    expect(parseBayAddress('R1-B3-L1-P1-D1')).toBeNull()
    expect(parseBayAddress('B3')).toBeNull()
  })
})

describe('skipped bays', () => {
  test('a skipped bay holds nothing and the run keeps its length', () => {
    const plain = rack({ bayCount: 4 })
    const gapped = rack({ bayCount: 4, bayOverrides: { 'R1-B2': { skipped: true } } })

    expect(isBaySkipped(gapped, 1, 2)).toBe(true)
    expect(presentBays(gapped, 1)).toEqual([1, 3, 4])
    // A skip is a gap cut for a column or a doorway, not a shortening.
    expect(totalWidth(gapped)).toBeCloseTo(totalWidth(plain), 9)
    expect(bayCenterX(gapped, 3)).toBeCloseTo(bayCenterX(plain, 3), 9)
  })

  test('capacity drops by exactly one bay', () => {
    const plain = rack({ bayCount: 4, uprightHeight: 12 })
    const gapped = rack({
      bayCount: 4,
      uprightHeight: 12,
      bayOverrides: { 'R1-B2': { skipped: true } },
    })
    expect(palletSlotCount(gapped)).toBe((palletSlotCount(plain) / 4) * 3)
  })

  test('a middle skip keeps both its frames, an end skip drops the outer one', () => {
    // The frames either side of a middle gap still carry the bays beyond it.
    const middle = rack({ bayCount: 4, bayOverrides: { 'R1-B2': { skipped: true } } })
    expect(isFramePresent(middle, 1, 1)).toBe(true)
    expect(isFramePresent(middle, 1, 2)).toBe(true)

    // At the end there is nothing beyond, so the outermost post would be left
    // standing alone in the gap the skip was cut for.
    const end = rack({ bayCount: 4, bayOverrides: { 'R1-B4': { skipped: true } } })
    expect(isFramePresent(end, 1, 4)).toBe(false)
    expect(isFramePresent(end, 1, 3)).toBe(true)
  })

  test('the dropped frame is actually absent from the built parts', () => {
    const plain = uprights(rack({ bayCount: 4 })).length
    const end = uprights(rack({ bayCount: 4, bayOverrides: { 'R1-B4': { skipped: true } } })).length
    const middle = uprights(
      rack({ bayCount: 4, bayOverrides: { 'R1-B2': { skipped: true } } }),
    ).length
    expect(end).toBeLessThan(plain)
    expect(middle).toBe(plain)
  })

  test('every bay skipped leaves no frames at all', () => {
    const none = rack({
      bayCount: 2,
      bayOverrides: { 'R1-B1': { skipped: true }, 'R1-B2': { skipped: true } },
    })
    expect(uprights(none)).toHaveLength(0)
    expect(palletSlotCount(none)).toBe(0)
  })
})

describe('tunnels', () => {
  test('a tunnel opens the lowest levels of one bay only', () => {
    const node = rack({
      bayCount: 3,
      levels: 3,
      uprightHeight: 12,
      bayOverrides: { 'R1-B2': { tunnelLevels: 2 } },
    })
    // Levels 0 and 1 are the walkway; 2 and 3 still store.
    expect(bayStorageLevels(node, 1, 2)).toEqual([2, 3])
    expect(bayStorageLevels(node, 1, 1)).toEqual([0, 1, 2, 3])
  })

  test('the frames stay — they carry the levels above the walkway', () => {
    const node = rack({ bayCount: 3, bayOverrides: { 'R1-B2': { tunnelLevels: 2 } } })
    for (let frame = 0; frame <= node.bayCount; frame++) {
      expect(isFramePresent(node, 1, frame)).toBe(true)
    }
  })

  test('a tunnel removes capacity without removing the bay', () => {
    const plain = rack({ bayCount: 3, levels: 3, uprightHeight: 12 })
    const tunnelled = rack({
      bayCount: 3,
      levels: 3,
      uprightHeight: 12,
      bayOverrides: { 'R1-B2': { tunnelLevels: 2 } },
    })
    expect(palletSlotCount(tunnelled)).toBeLessThan(palletSlotCount(plain))
    expect(presentBays(tunnelled, 1)).toEqual([1, 2, 3])
  })
})

describe('per-bay level count', () => {
  test('a bay can stop short but never exceed what the frame carries', () => {
    const node = rack({
      levels: 3,
      uprightHeight: 12,
      bayOverrides: { 'R1-B1': { levels: 1 }, 'R1-B2': { levels: 15 } },
    })
    expect(bayLevelCount(node, 1, 1)).toBe(1)
    // An override above the run's fitted count is clamped: a bay cannot gain a
    // level the uprights do not reach. 15 is the schema's ceiling; this frame
    // only carries 3.
    expect(bayLevelCount(node, 1, 2)).toBe(3)
    expect(bayLevelCount(node, 1, 2)).toBe(bayLevelCount(node, 1, 3))
  })
})

describe('hit testing a bay', () => {
  test('a point in each bay resolves to that bay', () => {
    const node = rack({ bayCount: 5 })
    for (let bay = 1; bay <= node.bayCount; bay++) {
      expect(bayAt(node, bayCenterX(node, bay), 0)).toEqual({ row: 1, bay })
    }
  })

  test('points beyond the run resolve to nothing', () => {
    const node = rack({ bayCount: 3 })
    const half = totalWidth(node) / 2
    expect(bayAt(node, -half - 0.5, 0)).toBeNull()
    expect(bayAt(node, half + 0.5, 0)).toBeNull()
    // And the aisle-side gap between the two runs of an island.
    const twin = rack({ bayCount: 3, rowCount: 2, backToBackGap: 0.6 })
    expect(bayAt(twin, 0, 0)).toBeNull()
  })

  test('each row of an island resolves to its own side', () => {
    const twin = rack({ bayCount: 3, rowCount: 2 })
    expect(bayAt(twin, bayCenterX(twin, 2), rowCenterZ(twin, 1))).toEqual({ row: 1, bay: 2 })
    expect(bayAt(twin, bayCenterX(twin, 2), rowCenterZ(twin, 2))).toEqual({ row: 2, bay: 2 })
  })

  test('bay boundaries fall on the frame centrelines', () => {
    // The seam between two bays is the shared post, so a click either side of
    // it must land in the neighbouring bays rather than both in one.
    const node = rack({ bayCount: 3 })
    const seam = (bayCenterX(node, 1) + bayCenterX(node, 2)) / 2
    expect(bayAt(node, seam - 0.01, 0)?.bay).toBe(1)
    expect(bayAt(node, seam + 0.01, 0)?.bay).toBe(2)
  })
})
