import { describe, expect, test } from 'bun:test'
import { PalletRackNode } from './schema'
import {
  autoPalletsPerLevel,
  autoPickingBoxesAcross,
  autoPickingBoxesDeep,
  bayCenterX,
  depthPositionZ,
  directAccessSlotCount,
  fittedLevelCount,
  formatSlotAddress,
  frameCentersX,
  hasUnsupportedPallets,
  levelBeamHeight,
  levelClearHeight,
  levelClearOpening,
  levelHasShelf,
  levelSurfaceY,
  levelTypeOf,
  orientedPalletFootprint,
  palletLevels,
  palletSlotCount,
  palletSlotsOf,
  palletSupportBarCount,
  parseSlotAddress,
  pickingBoxesAcross,
  pickingBoxesDeep,
  pickingLevelsOf,
  pickingOffsetsX,
  pickingOffsetsZ,
  pickingSlotCount,
  pickingSlotsOf,
  requiresPalletSupportBars,
  rowCenterZ,
  rowDepth,
  slotOffsetsX,
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
    // Derived, not hardcoded: the pitch is clear width plus one post, so
    // pinning a literal here just re-asserts whatever the default happens to be
    // and breaks whenever a profile default is corrected.
    const expectedPitch = r.bayClearWidth + r.uprightWidth
    const pitches = frames.slice(1).map((x, i) => x - (frames[i] ?? 0))
    for (const pitch of pitches) expect(pitch).toBeCloseTo(expectedPitch, 9)
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
    expect(palletSlotCount(r)).toBe(48)
    expect(palletSlotsOf(r)).toHaveLength(48)
  })

  test('back to back doubles the enumerated slots', () => {
    const single = rack({ bayCount: 2, levels: 2, uprightHeight: 12 })
    const twin = rack({ bayCount: 2, levels: 2, uprightHeight: 12, backToBack: true })
    expect(palletSlotCount(twin)).toBe(palletSlotCount(single) * 2)
  })

  test('dropped levels are excluded from the capacity count', () => {
    const tall = rack({ bayCount: 1, levels: 10, uprightHeight: 12 })
    const short = rack({ bayCount: 1, levels: 10, uprightHeight: 5 })
    expect(palletSlotCount(short)).toBeLessThan(palletSlotCount(tall))
    expect(palletSlotCount(short)).toBe((fittedLevelCount(short) + 1) * 3)
  })

  test('every slot id is unique and round-trips through the address parser', () => {
    const r = rack({ bayCount: 3, levels: 2, uprightHeight: 12, backToBack: true })
    const slots = palletSlotsOf(r)
    expect(new Set(slots.map((slot) => slot.id)).size).toBe(slots.length)

    for (const slot of slots) {
      const parsed = parseSlotAddress(slot.id)
      expect(parsed).toEqual({
        row: slot.row,
        bay: slot.bay,
        level: slot.level,
        position: slot.position,
        depth: slot.depth,
      })
    }
  })

  test('an address keeps its meaning when the run gains a second row', () => {
    // The row is written even for a single run precisely so this holds — a
    // pallet stored at R1-B2-L1-P1 must still mean the same shelf afterwards.
    const single = rack({ bayCount: 3, levels: 2, uprightHeight: 12 })
    const twin = rack({ bayCount: 3, levels: 2, uprightHeight: 12, backToBack: true })
    const address = formatSlotAddress({ row: 1, bay: 2, level: 1, position: 1, depth: 1 })

    const before = palletSlotsOf(single).find((slot) => slot.id === address)
    const after = palletSlotsOf(twin).find((slot) => slot.id === address)
    expect(before).toBeDefined()
    expect(after).toBeDefined()
    // X and Y are unchanged; only Z moves, because the run itself moved.
    expect(after?.localPosition[0]).toBeCloseTo(before?.localPosition[0] ?? 0, 9)
    expect(after?.localPosition[1]).toBeCloseTo(before?.localPosition[1] ?? 0, 9)
  })

  test('a malformed address is rejected rather than half-parsed', () => {
    expect(parseSlotAddress('B2-L1-P1-D1')).toBeNull()
    expect(parseSlotAddress('R1-B2-L1')).toBeNull()
    expect(parseSlotAddress('R1-B2-L1-P1')).toBeNull()
    expect(parseSlotAddress('')).toBeNull()
    expect(parseSlotAddress('R1-B2-L1-Px-D1')).toBeNull()
  })

  test('slots sit on their level surface and inside the run footprint', () => {
    const r = rack({ bayCount: 3, levels: 3, uprightHeight: 12 })
    const halfWidth = totalWidth(r) / 2
    for (const slot of palletSlotsOf(r)) {
      expect(slot.localPosition[1]).toBeCloseTo(levelSurfaceY(r, slot.level), 9)
      const [x] = slot.localPosition
      expect(Math.abs(x)).toBeLessThanOrEqual(halfWidth)
    }
  })
})

describe('double-deep', () => {
  test('a second depth position doubles capacity but halves direct access', () => {
    const single = rack({ bayCount: 3, levels: 2, uprightHeight: 12 })
    const deep = rack({ bayCount: 3, levels: 2, uprightHeight: 12, depthPositions: 2 })
    expect(palletSlotCount(deep)).toBe(palletSlotCount(single) * 2)
    // The trade the headline "locations" figure hides: the extra capacity is
    // bought entirely with positions nothing can reach directly.
    expect(directAccessSlotCount(deep)).toBe(palletSlotCount(single))
    expect(deep.depthPositions).toBe(2)
  })

  test('only the front position of a bay has direct access', () => {
    const deep = rack({ bayCount: 1, levels: 1, uprightHeight: 12, depthPositions: 2 })
    for (const slot of palletSlotsOf(deep)) {
      expect(slot.directAccess).toBe(slot.depth === 1)
    }
  })

  test('depth positions sit one behind the other with the declared gap', () => {
    const deep = rack({ depthPositions: 2, depth: 1.1, depthGap: 0.05 })
    const front = depthPositionZ(deep, 1, 1)
    const rear = depthPositionZ(deep, 1, 2)
    // Front is nearer the aisle (+Z for row 1), and the faces are depthGap apart.
    expect(front).toBeGreaterThan(rear)
    expect(front - deep.depth / 2 - (rear + deep.depth / 2)).toBeCloseTo(0.05, 9)
  })

  test('each row of a back-to-back island numbers depth from its own aisle', () => {
    // Row 1 opens onto +Z and row 2 onto −Z, so "D1 is the reachable one" has
    // to hold on both sides — a global axis would make D1 the buried pallet on
    // one of them.
    const twin = rack({ backToBack: true, depthPositions: 2, depth: 1.1 })
    expect(depthPositionZ(twin, 1, 1)).toBeGreaterThan(depthPositionZ(twin, 1, 2))
    expect(depthPositionZ(twin, 2, 1)).toBeLessThan(depthPositionZ(twin, 2, 2))
  })

  test('back-to-back double-deep is four pallets deep and stays inside the footprint', () => {
    const twin = rack({ backToBack: true, depthPositions: 2, depth: 1.1, depthGap: 0.05 })
    expect(rowDepth(twin)).toBeCloseTo(2.25, 9)
    expect(totalDepth(twin)).toBeCloseTo(4.7, 9)
    const half = totalDepth(twin) / 2
    for (const slot of palletSlotsOf(twin)) {
      const z = slot.localPosition[2]
      expect(Math.abs(z) + twin.depth / 2).toBeLessThanOrEqual(half + 1e-9)
    }
  })

  test('the two rows never overlap', () => {
    const twin = rack({ backToBack: true, depthPositions: 2, depth: 1.1, backToBackGap: 0.2 })
    const innerRow1 = depthPositionZ(twin, 1, 2) - twin.depth / 2
    const innerRow2 = depthPositionZ(twin, 2, 2) + twin.depth / 2
    expect(innerRow1 - innerRow2).toBeCloseTo(0.2, 9)
  })
})

describe('pallet support bars', () => {
  test('long-side-out requires bars, narrow-side-out does not', () => {
    // A Euro pallet's bottom deckboards run along its 1200 mm length: across
    // the beams when narrow-side-out, along them when turned.
    expect(requiresPalletSupportBars(rack({ palletOrientation: 'short-side-out' }))).toBe(false)
    expect(requiresPalletSupportBars(rack({ palletOrientation: 'long-side-out' }))).toBe(true)
  })

  test('bars are derived from the orientation when not declared', () => {
    expect(palletSupportBarCount(rack({ palletOrientation: 'short-side-out' }))).toBe(0)
    expect(palletSupportBarCount(rack({ palletOrientation: 'long-side-out' }))).toBe(2)
  })

  test('an explicit count overrides the derived one in both directions', () => {
    expect(
      palletSupportBarCount(rack({ palletOrientation: 'long-side-out', palletSupportBars: 3 })),
    ).toBe(3)
    expect(
      palletSupportBarCount(rack({ palletOrientation: 'short-side-out', palletSupportBars: 1 })),
    ).toBe(1)
  })

  test('removing the bars from a turned rack is reported, not silently corrected', () => {
    const unsound = rack({ palletOrientation: 'long-side-out', palletSupportBars: 0 })
    expect(hasUnsupportedPallets(unsound)).toBe(true)
    // Every other combination is sound.
    expect(hasUnsupportedPallets(rack({ palletOrientation: 'long-side-out' }))).toBe(false)
    expect(
      hasUnsupportedPallets(rack({ palletOrientation: 'short-side-out', palletSupportBars: 0 })),
    ).toBe(false)
  })

  test('a square pallet needs bars in neither orientation by geometry alone', () => {
    // 1200 × 1200 is the one preset where turning it changes nothing across the
    // run, so the requirement is driven purely by the declared orientation.
    const square = rack({ palletPreset: 'euro-1200x1200', palletOrientation: 'short-side-out' })
    expect(orientedPalletFootprint(square)).toEqual([1.2, 1.2])
    expect(requiresPalletSupportBars(square)).toBe(false)
  })
})

describe('picking levels', () => {
  test('a rack with no picking levels is unchanged', () => {
    // Regression guard for the accumulate rewrite: the uniform case has to keep
    // producing exactly the elevations the multiply formula did.
    const r = rack({ levels: 3, uprightHeight: 12, firstLevelClear: 1.5, levelClear: 1.4 })
    expect(r.pickingLevels).toBe(0)
    expect(levelSurfaceY(r, 1)).toBeCloseTo(1.62, 9)
    expect(levelSurfaceY(r, 2)).toBeCloseTo(3.14, 9)
    expect(levelSurfaceY(r, 3)).toBeCloseTo(4.66, 9)
    expect(pickingSlotCount(r)).toBe(0)
  })

  test('the lowest levels become picking levels, counted from the floor', () => {
    const r = rack({ levels: 3, uprightHeight: 12, pickingLevels: 2 })
    expect(levelTypeOf(r, 0)).toBe('picking')
    expect(levelTypeOf(r, 1)).toBe('picking')
    expect(levelTypeOf(r, 2)).toBe('pallet')
    expect(levelTypeOf(r, 3)).toBe('pallet')
    expect(pickingLevelsOf(r)).toEqual([0, 1])
    expect(palletLevels(r)).toEqual([2, 3])
  })

  test('an explicit level list overrides the derived split', () => {
    const r = rack({
      levels: 3,
      uprightHeight: 12,
      pickingLevels: 2,
      levelTypes: ['pallet', 'pallet', 'picking', 'picking'],
    })
    expect(pickingLevelsOf(r)).toEqual([2, 3])
    expect(palletLevels(r)).toEqual([0, 1])
  })

  test('picking levels ride a shallower beam and a shorter opening', () => {
    const r = rack({ levels: 3, uprightHeight: 12, pickingLevels: 2 })
    expect(levelBeamHeight(r, 1)).toBeCloseTo(r.pickingBeamHeight, 9)
    expect(levelBeamHeight(r, 2)).toBeCloseTo(r.beamHeight, 9)
    expect(levelClearOpening(r, 0)).toBeCloseTo(r.pickingLevelClear, 9)
    expect(levelClearOpening(r, 2)).toBeCloseTo(r.levelClear, 9)
  })

  test('mixing level kinds moves every level above the mix', () => {
    // The whole reason elevations accumulate. A uniform pitch would leave the
    // pallet levels sitting where an all-pallet rack put them, floating above
    // the short picking levels underneath.
    const mixed = rack({ levels: 3, uprightHeight: 12, pickingLevels: 2 })
    expect(levelSurfaceY(mixed, 1)).toBeCloseTo(0.66, 9)
    expect(levelSurfaceY(mixed, 2)).toBeCloseTo(1.38, 9)
    expect(levelSurfaceY(mixed, 3)).toBeCloseTo(2.9, 9)

    const uniform = rack({ levels: 3, uprightHeight: 12 })
    expect(levelSurfaceY(mixed, 3)).toBeLessThan(levelSurfaceY(uniform, 3))
  })

  test('shorter picking levels let more levels fit the same upright', () => {
    const uniform = rack({ levels: 10, uprightHeight: 6 })
    const mixed = rack({ levels: 10, uprightHeight: 6, pickingLevels: 3 })
    expect(fittedLevelCount(mixed)).toBeGreaterThan(fittedLevelCount(uniform))
  })

  test('a picking level always carries a shelf, even with open decking', () => {
    // `pickingLevels` counts from the floor, so 2 makes level 0 (the floor) and
    // level 1 picking. The floor never carries a shelf — it is the floor.
    const r = rack({ levels: 2, uprightHeight: 12, pickingLevels: 2, decking: 'open' })
    expect(levelHasShelf(r, 0)).toBe(false)
    expect(levelHasShelf(r, 1)).toBe(true)
    expect(levelHasShelf(r, 2)).toBe(false)
  })
})

describe('picking containers', () => {
  test('the default 600 x 400 container grids a 2.7 m bay four by two', () => {
    const r = rack({ bayClearWidth: 2.7, depth: 1.1 })
    expect(autoPickingBoxesAcross(r)).toBe(4)
    expect(autoPickingBoxesDeep(r)).toBe(2)
  })

  test('container offsets are centred and stay inside the shelf', () => {
    const r = rack({ bayClearWidth: 2.7, depth: 1.1, pickingLevels: 1 })
    const across = pickingOffsetsX(r)
    const deep = pickingOffsetsZ(r)
    expect(across.reduce((total, x) => total + x, 0)).toBeCloseTo(0, 9)
    expect(deep.reduce((total, z) => total + z, 0)).toBeCloseTo(0, 9)

    const lastAcross = across[across.length - 1] ?? 0
    expect(lastAcross + r.pickingBoxWidth / 2).toBeLessThanOrEqual(r.bayClearWidth / 2 + 1e-9)
    const lastDeep = deep[deep.length - 1] ?? 0
    expect(lastDeep + r.pickingBoxDepth / 2).toBeLessThanOrEqual(r.depth / 2 + 1e-9)
  })

  test('an override wins over the derived grid', () => {
    const r = rack({ pickingLevels: 1, pickingBoxesAcross: 6, pickingBoxesDeep: 1 })
    expect(pickingBoxesAcross(r)).toBe(6)
    expect(pickingBoxesDeep(r)).toBe(1)
    expect(pickingOffsetsX(r)).toHaveLength(6)
  })

  test('pallets and containers are counted separately, never both on one level', () => {
    const r = rack({ bayCount: 3, levels: 3, uprightHeight: 12, pickingLevels: 2 })
    // 3 bays x 2 pallet levels x 3 across
    expect(palletSlotCount(r)).toBe(18)
    // 3 bays x 2 picking levels x 4 across x 2 deep
    expect(pickingSlotCount(r)).toBe(48)
    expect(palletSlotsOf(r)).toHaveLength(18)
    expect(pickingSlotsOf(r)).toHaveLength(48)

    const palletLevelSet = new Set(palletSlotsOf(r).map((slot) => slot.level))
    const pickingLevelSet = new Set(pickingSlotsOf(r).map((slot) => slot.level))
    for (const level of palletLevelSet) expect(pickingLevelSet.has(level)).toBe(false)
  })

  test('container addresses parse with the same reader as pallet addresses', () => {
    const r = rack({ bayCount: 2, levels: 2, uprightHeight: 12, pickingLevels: 1 })
    const slots = pickingSlotsOf(r)
    expect(slots.length).toBeGreaterThan(0)
    expect(new Set(slots.map((slot) => slot.id)).size).toBe(slots.length)
    for (const slot of slots) {
      expect(parseSlotAddress(slot.id)).toEqual({
        row: slot.row,
        bay: slot.bay,
        level: slot.level,
        position: slot.position,
        depth: slot.depth,
      })
    }
  })

  test('containers stand on the shelf panel, not on the beam top', () => {
    const r = rack({ levels: 2, uprightHeight: 12, pickingLevels: 0, levelTypes: null })
    const withPicking = rack({ levels: 2, uprightHeight: 12, pickingLevels: 2 })
    const slot = pickingSlotsOf(withPicking).find((entry) => entry.level === 1)
    expect(slot).toBeDefined()
    expect(slot?.localPosition[1]).toBeCloseTo(
      levelSurfaceY(withPicking, 1) + withPicking.pickingShelfThickness,
      9,
    )
    expect(r.pickingShelfThickness).toBeGreaterThan(0)
  })

  test('container depth index 1 is the aisle side of whichever row it is on', () => {
    const twin = rack({ backToBack: true, levels: 1, uprightHeight: 12, pickingLevels: 1 })
    const slots = pickingSlotsOf(twin).filter((slot) => slot.bay === 1 && slot.position === 1)
    const row1 = slots.filter((slot) => slot.row === 1).sort((a, b) => a.depth - b.depth)
    const row2 = slots.filter((slot) => slot.row === 2).sort((a, b) => a.depth - b.depth)
    // Row 1 opens onto +Z, row 2 onto -Z, so D1 is the outermost on each side.
    expect(row1[0]?.localPosition[2] ?? 0).toBeGreaterThan(row1[1]?.localPosition[2] ?? 0)
    expect(row2[0]?.localPosition[2] ?? 0).toBeLessThan(row2[1]?.localPosition[2] ?? 0)
    expect(row1[0]?.directAccess).toBe(true)
    expect(row1[1]?.directAccess).toBe(false)
  })
})
