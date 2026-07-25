import { describe, expect, test } from 'bun:test'
import { PalletRackNode } from './schema'
import {
  autoPalletsPerLevel,
  bayCenterX,
  fittedLevelCount,
  formatSlotAddress,
  frameCentersX,
  levelClearHeight,
  levelSurfaceY,
  orientedPalletFootprint,
  parseSlotAddress,
  rowCenterZ,
  slotCount,
  slotOffsetsX,
  slotsOf,
  storageLevels,
  totalDepth,
  totalWidth,
} from './slots'

const rack = (overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_test', ...overrides })

describe('run geometry', () => {
  test('bays share their upright frames', () => {
    const r = rack({ bayCount: 3, bayClearWidth: 2.7, uprightWidth: 0.12 })
    // Three bays stand on four frames, not six.
    expect(frameCentersX(r)).toHaveLength(4)
    // 3 × (2.7 + 0.12) + 0.12 — the multiply-and-forget-the-post version of
    // this returned 8.1 and left the last beam hanging off the end.
    expect(totalWidth(r)).toBeCloseTo(8.58, 6)
  })

  test('frames are evenly pitched and symmetric about the origin', () => {
    const r = rack({ bayCount: 2 })
    const frames = frameCentersX(r)
    const first = frames[0] ?? 0
    const last = frames[frames.length - 1] ?? 0
    expect(first).toBeCloseTo(-last, 9)
    const pitches = frames.slice(1).map((x, i) => x - (frames[i] ?? 0))
    for (const pitch of pitches) expect(pitch).toBeCloseTo(2.82, 9)
  })

  test('each bay centre sits midway between its two frames', () => {
    const r = rack({ bayCount: 3 })
    const frames = frameCentersX(r)
    for (let bay = 1; bay <= r.bayCount; bay++) {
      const left = frames[bay - 1] ?? 0
      const right = frames[bay] ?? 0
      expect(bayCenterX(r, bay)).toBeCloseTo((left + right) / 2, 9)
    }
  })

  test('back to back doubles depth and splits the rows about the origin', () => {
    const single = rack({ depth: 1.1 })
    expect(totalDepth(single)).toBeCloseTo(1.1, 9)
    expect(rowCenterZ(single, 1)).toBe(0)

    const twin = rack({ backToBack: true, depth: 1.1, backToBackGap: 0.2 })
    expect(totalDepth(twin)).toBeCloseTo(2.4, 9)
    expect(rowCenterZ(twin, 1)).toBeCloseTo(0.65, 9)
    expect(rowCenterZ(twin, 2)).toBeCloseTo(-0.65, 9)
    // The two runs must not overlap: the gap between their near faces is the
    // declared one.
    const nearFaceGap =
      rowCenterZ(twin, 1) - twin.depth / 2 - (rowCenterZ(twin, 2) + twin.depth / 2)
    expect(nearFaceGap).toBeCloseTo(0.2, 9)
  })
})

describe('levels', () => {
  test('beam elevations stack by clear opening plus beam height', () => {
    const r = rack({ firstLevelClear: 1.5, levelClear: 1.4, beamHeight: 0.12, uprightHeight: 12 })
    expect(levelSurfaceY(r, 0)).toBe(0)
    expect(levelSurfaceY(r, 1)).toBeCloseTo(1.62, 9)
    expect(levelSurfaceY(r, 2)).toBeCloseTo(3.14, 9)
    expect(levelSurfaceY(r, 3)).toBeCloseTo(4.66, 9)
  })

  test('levels that do not fit the upright are dropped, not drawn overhanging', () => {
    // Ten levels asked for on a 5 m upright: only those under the top survive.
    const r = rack({ levels: 10, uprightHeight: 5, firstLevelClear: 1.5, levelClear: 1.4 })
    const fitted = fittedLevelCount(r)
    expect(fitted).toBeLessThan(10)
    expect(levelSurfaceY(r, fitted)).toBeLessThanOrEqual(r.uprightHeight)
    expect(levelSurfaceY(r, fitted + 1)).toBeGreaterThan(r.uprightHeight)
  })

  test('the floor counts as a storage level only when enabled', () => {
    const withGround = rack({ levels: 3, uprightHeight: 12 })
    expect(storageLevels(withGround)).toEqual([0, 1, 2, 3])
    const without = rack({ levels: 3, uprightHeight: 12, groundLevelStorage: false })
    expect(storageLevels(without)).toEqual([1, 2, 3])
  })

  test('clear height comes from the next beam, and from the upright at the top', () => {
    const r = rack({ levels: 2, uprightHeight: 12, firstLevelClear: 1.5, levelClear: 1.4 })
    // Ground opening is the declared first clear.
    expect(levelClearHeight(r, 0)).toBeCloseTo(1.5, 9)
    expect(levelClearHeight(r, 1)).toBeCloseTo(1.4, 9)
    // Top level is bounded by the post, not by a beam that isn't there.
    expect(levelClearHeight(r, 2)).toBeCloseTo(12 - levelSurfaceY(r, 2), 9)
  })
})

describe('pallet fit', () => {
  test('orientation decides how many EPAL 1 fit a 2.7 m bay', () => {
    const short = rack({ palletOrientation: 'short-side-out', bayClearWidth: 2.7 })
    const long = rack({ palletOrientation: 'long-side-out', bayClearWidth: 2.7 })
    // 0.8 across the run vs 1.2 — the 3-versus-2 difference the whole capacity
    // figure turns on.
    expect(orientedPalletFootprint(short)).toEqual([0.8, 1.2])
    expect(orientedPalletFootprint(long)).toEqual([1.2, 0.8])
    expect(autoPalletsPerLevel(short)).toBe(3)
    expect(autoPalletsPerLevel(long)).toBe(2)
  })

  test('orientation is read from the actual dimensions, not the preset field names', () => {
    // EPAL 3 is 1.0 × 1.2 — length < width, the reverse of EPAL 1. Reading
    // `length` for "long" would flip this preset's orientation silently.
    const r = rack({ palletPreset: 'epal-3', palletOrientation: 'short-side-out' })
    expect(orientedPalletFootprint(r)).toEqual([1.0, 1.2])
    const long = rack({ palletPreset: 'epal-3', palletOrientation: 'long-side-out' })
    expect(orientedPalletFootprint(long)).toEqual([1.2, 1.0])
  })

  test('slots are centred in the bay and never exceed the clear width', () => {
    const r = rack({ bayClearWidth: 2.7, palletOrientation: 'short-side-out' })
    const offsets = slotOffsetsX(r)
    expect(offsets).toHaveLength(3)

    const sum = offsets.reduce((total, x) => total + x, 0)
    expect(sum).toBeCloseTo(0, 9)

    const [alongRun] = orientedPalletFootprint(r)
    const first = offsets[0] ?? 0
    const last = offsets[offsets.length - 1] ?? 0
    expect(first - alongRun / 2).toBeGreaterThanOrEqual(-r.bayClearWidth / 2 - 1e-9)
    expect(last + alongRun / 2).toBeLessThanOrEqual(r.bayClearWidth / 2 + 1e-9)
  })

  test('leftover width is absorbed by the clearances, leaving no end gap', () => {
    const r = rack({ bayClearWidth: 3.2, palletOrientation: 'short-side-out' })
    const offsets = slotOffsetsX(r)
    const [alongRun] = orientedPalletFootprint(r)
    const first = offsets[0] ?? 0
    const last = offsets[offsets.length - 1] ?? 0
    const leftGap = first - alongRun / 2 + r.bayClearWidth / 2
    const rightGap = r.bayClearWidth / 2 - (last + alongRun / 2)
    // Symmetric, and the whole clear width is accounted for.
    expect(leftGap).toBeCloseTo(rightGap, 9)
    const span = last - first + alongRun
    expect(span + leftGap + rightGap).toBeCloseTo(r.bayClearWidth, 9)
  })

  test('a manual override wins over the geometric fit', () => {
    const r = rack({ bayClearWidth: 2.7, palletsPerLevel: 2 })
    expect(autoPalletsPerLevel(r)).toBe(3)
    expect(slotOffsetsX(r)).toHaveLength(2)
  })

  test('an override that cannot fit still yields that many slots, unmirrored', () => {
    // Asking for 5 EPAL 1 in a 2.7 m bay is over capacity. The clearances scale
    // to zero rather than negative — negative would order the offsets backwards
    // and mirror the row about the bay centre.
    const r = rack({ bayClearWidth: 2.7, palletsPerLevel: 5 })
    const offsets = slotOffsetsX(r)
    expect(offsets).toHaveLength(5)
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i] ?? 0).toBeGreaterThan(offsets[i - 1] ?? 0)
    }
  })
})

describe('slot enumeration', () => {
  test('count is rows × bays × levels × positions', () => {
    const r = rack({ bayCount: 4, levels: 3, uprightHeight: 12, bayClearWidth: 2.7 })
    // 1 row × 4 bays × (3 beam levels + floor) × 3 across
    expect(slotCount(r)).toBe(48)
    expect(slotsOf(r)).toHaveLength(48)
  })

  test('back to back doubles the enumerated slots', () => {
    const single = rack({ bayCount: 2, levels: 2, uprightHeight: 12 })
    const twin = rack({ bayCount: 2, levels: 2, uprightHeight: 12, backToBack: true })
    expect(slotCount(twin)).toBe(slotCount(single) * 2)
  })

  test('dropped levels are excluded from the capacity count', () => {
    const tall = rack({ bayCount: 1, levels: 10, uprightHeight: 12 })
    const short = rack({ bayCount: 1, levels: 10, uprightHeight: 5 })
    expect(slotCount(short)).toBeLessThan(slotCount(tall))
    expect(slotCount(short)).toBe((fittedLevelCount(short) + 1) * 3)
  })

  test('every slot id is unique and round-trips through the address parser', () => {
    const r = rack({ bayCount: 3, levels: 2, uprightHeight: 12, backToBack: true })
    const slots = slotsOf(r)
    expect(new Set(slots.map((slot) => slot.id)).size).toBe(slots.length)

    for (const slot of slots) {
      const parsed = parseSlotAddress(slot.id)
      expect(parsed).toEqual({
        row: slot.row,
        bay: slot.bay,
        level: slot.level,
        position: slot.position,
      })
    }
  })

  test('an address keeps its meaning when the run gains a second row', () => {
    // The row is written even for a single run precisely so this holds — a
    // pallet stored at R1-B2-L1-P1 must still mean the same shelf afterwards.
    const single = rack({ bayCount: 3, levels: 2, uprightHeight: 12 })
    const twin = rack({ bayCount: 3, levels: 2, uprightHeight: 12, backToBack: true })
    const address = formatSlotAddress({ row: 1, bay: 2, level: 1, position: 1 })

    const before = slotsOf(single).find((slot) => slot.id === address)
    const after = slotsOf(twin).find((slot) => slot.id === address)
    expect(before).toBeDefined()
    expect(after).toBeDefined()
    // X and Y are unchanged; only Z moves, because the run itself moved.
    expect(after?.localPosition[0]).toBeCloseTo(before?.localPosition[0] ?? 0, 9)
    expect(after?.localPosition[1]).toBeCloseTo(before?.localPosition[1] ?? 0, 9)
  })

  test('a malformed address is rejected rather than half-parsed', () => {
    expect(parseSlotAddress('B2-L1-P1')).toBeNull()
    expect(parseSlotAddress('R1-B2-L1')).toBeNull()
    expect(parseSlotAddress('')).toBeNull()
    expect(parseSlotAddress('R1-B2-L1-Px')).toBeNull()
  })

  test('slots sit on their level surface and inside the run footprint', () => {
    const r = rack({ bayCount: 3, levels: 3, uprightHeight: 12 })
    const halfWidth = totalWidth(r) / 2
    for (const slot of slotsOf(r)) {
      expect(slot.localPosition[1]).toBeCloseTo(levelSurfaceY(r, slot.level), 9)
      const [x] = slot.localPosition
      expect(Math.abs(x)).toBeLessThanOrEqual(halfWidth)
    }
  })
})
