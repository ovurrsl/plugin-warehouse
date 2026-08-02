import { describe, expect, test } from 'bun:test'
import { parseSlotAddress } from '../rack/slots'
import {
  bearingVerdict,
  boardsRunAlongRails,
  bracingConflictsWithEntry,
  centralisersUnavailable,
  depthClearanceTight,
  directAccessSlotCount,
  effectivePostPitchZ,
  fittedLevelCount,
  forkliftEnvelope,
  frameCentersX,
  lanePitch,
  orientedPalletFootprint,
  palletSlotCount,
  palletSlotsOf,
  pitchZ,
  postCentersZ,
  railBearingEachSide,
  railTopY,
  sideClearanceTight,
  slotZ,
  topBeamUndersideY,
  totalDepth,
  totalWidth,
} from './lanes'
import { DriveInRackNode } from './schema'

/**
 * The catalogue's own worked example is the spine of this file.
 *
 * Mecalux publishes H = 6.05 m for a three-level GP block on a 1.35 m load,
 * and every number that produces it is a separate field here. If the vertical
 * derivation drifts, this is what says so — the alternative is a lane that
 * looks plausible in a render and is not the structure the catalogue describes.
 */

const lane = (patch: Partial<DriveInRackNode> = {}) =>
  DriveInRackNode.parse({ id: 'drive-in-rack_probe', ...patch })

describe('worked example — catalogue defaults', () => {
  const node = lane()

  test('level pitch is exactly 1.500: clear 1.45 + GP rail 0.05, already on a slot', () => {
    expect(railTopY(node, 1)).toBeCloseTo(1.5, 9)
  })

  test('rails land at 1.5 / 3.0 / 4.5', () => {
    expect([railTopY(node, 1), railTopY(node, 2), railTopY(node, 3)]).toEqual([1.5, 3, 4.5])
  })

  test('top beam underside is the published H = 6.05', () => {
    expect(topBeamUndersideY(node)).toBeCloseTo(6.05, 9)
  })

  test('every rail fits the default 6.05 m post', () => {
    expect(fittedLevelCount(node)).toBe(3)
  })

  test('lane depth is 4 × 0.825 = 3.300', () => {
    // EPAL 1 long-side-out puts 800 mm into the depth; +25 mm clearance (p.19).
    expect(pitchZ(node)).toBeCloseTo(0.825, 9)
    expect(totalDepth(node)).toBeCloseTo(3.3, 9)
  })

  test('lane pitch is the clear width plus one upright', () => {
    expect(lanePitch(node)).toBeCloseTo(1.472, 9)
    // Outer width overhangs the footprint by the half-post each neighbour shares.
    expect(totalWidth(node)).toBeCloseTo(1.594, 9)
  })
})

describe('50 mm slot snapping', () => {
  test('an opening between slots is raised to the next one', () => {
    // 1.42 + 0.05 = 1.47 → the next slot up is 1.50.
    expect(railTopY(lane({ levelClear: 1.42 }), 1)).toBeCloseTo(1.5, 9)
  })

  test('a C rail costs its extra 50 mm of section', () => {
    // 1.45 + 0.10 = 1.55, already on a slot.
    expect(railTopY(lane({ railType: 'c' }), 1)).toBeCloseTo(1.55, 9)
  })

  test('openings accumulate per level rather than multiplying one pitch', () => {
    // A tall floor opening must not shift only the first rail — every rail
    // above it moves too, which a `first + (n-1) × step` formula gets wrong.
    const node = lane({ levelClears: [2.0, null, null], levels: 3 })
    expect(railTopY(node, 1)).toBeCloseTo(2.05, 9)
    expect(railTopY(node, 2)).toBeCloseTo(3.55, 9)
    expect(railTopY(node, 3)).toBeCloseTo(5.05, 9)
  })
})

describe('levels that do not fit are not counted', () => {
  test('a short post drops the rails it cannot carry', () => {
    expect(fittedLevelCount(lane({ levels: 6, uprightHeight: 4.6 }))).toBe(3)
  })

  test('and the slot enumeration follows the fitted count, not the declared one', () => {
    const node = lane({ levels: 6, uprightHeight: 4.6, palletsDeep: 2 })
    // Floor + 3 fitted rails = 4 storage levels × 2 deep.
    expect(palletSlotCount(node)).toBe(8)
  })
})

describe('slots', () => {
  const node = lane()

  test('count is the enumeration, never a multiplication', () => {
    // Floor + 3 rails = 4 levels × 4 deep.
    expect(palletSlotCount(node)).toBe(16)
  })

  test('only the front position of each level is directly accessible', () => {
    expect(directAccessSlotCount(node)).toBe(4)
  })

  test('depth 1 is at the aisle face (+Z)', () => {
    expect(slotZ(node, 1)).toBeGreaterThan(slotZ(node, 4))
    expect(slotZ(node, 1)).toBeCloseTo(3.3 / 2 - 0.4125, 9)
  })

  test('addresses parse with the shared rack format', () => {
    // Sharing the format is load-bearing: a `warehouse:pallet` stores its
    // `slotAddress` as a string and occupancy matches on it, so a second format
    // would strand every pallet placed in a lane.
    for (const slot of palletSlotsOf(node)) {
      const parsed = parseSlotAddress(slot.id)
      expect(parsed, `${slot.id} bir yuva adresi olarak ayrıştırılamadı`).not.toBeNull()
      expect(parsed?.position).toBe(1)
    }
  })

  test('the top level is bounded by the top beam, not by a rail above it', () => {
    const slots = palletSlotsOf(node)
    const top = slots.find((slot) => slot.level === 3)
    expect(top?.clearHeight).toBeCloseTo(6.05 - 4.5, 9)
  })
})

describe('posts', () => {
  test('a lane of four positions closes with five post lines', () => {
    expect(postCentersZ(lane()).length).toBe(5)
  })

  test('the derived pitch is one post per pallet position', () => {
    expect(effectivePostPitchZ(lane())).toBeCloseTo(0.825, 9)
  })

  test('a declared pitch overrides the derivation', () => {
    expect(effectivePostPitchZ(lane({ postPitchZ: 1.1 }))).toBeCloseTo(1.1, 9)
  })

  test('the two frame lines sit one pitch apart', () => {
    const [left, right] = frameCentersX(lane())
    expect(right - left).toBeCloseTo(lanePitch(lane()), 9)
  })
})

describe('rail bearing — the figure the kind turns on', () => {
  test('defaults leave 87 mm each side, comfortably over the 30 mm minimum', () => {
    // GP publishes a fixed 1.026 m clear span, so a 1.2 m load overhangs it by
    // 87 mm each side.
    expect(railBearingEachSide(lane())).toBeCloseTo(0.087, 9)
    expect(bearingVerdict(lane())).toBe('ok')
  })

  test('a wider lane does NOT starve a GP bearing — the rails move with it', () => {
    // The published span is fixed, so widening the entry pushes the rails apart
    // and the pallet still lands on the same span. Getting this backwards would
    // report a safe lane as unsafe.
    expect(railBearingEachSide(lane({ laneClearWidth: 1.55 }))).toBeCloseTo(0.087, 9)
  })

  test('turning the pallet the other way changes what rests on the rails', () => {
    // Short-side-out puts 800 mm across the lane, which no longer reaches the
    // 1.026 m span at all.
    expect(bearingVerdict(lane({ palletOrientation: 'short-side-out' }))).toBe('insufficient')
  })

  test('a C rail is set to the load and holds the displaced minimum exactly', () => {
    expect(railBearingEachSide(lane({ railType: 'c' }))).toBeCloseTo(0.03, 9)
    expect(bearingVerdict(lane({ railType: 'c' }))).toBe('ok')
  })
})

describe('report-only checks', () => {
  test('side clearance under 75 mm is flagged', () => {
    expect(sideClearanceTight(lane())).toBe(false)
    expect(sideClearanceTight(lane({ clearanceSide: 0.05 }))).toBe(true)
  })

  test('depth clearance under 25 mm is flagged', () => {
    expect(depthClearanceTight(lane())).toBe(false)
    expect(depthClearanceTight(lane({ depthClearance: 0.02 }))).toBe(true)
  })

  test('boards parallel to the rails are flagged, not forbidden', () => {
    expect(boardsRunAlongRails(lane())).toBe(false)
    expect(boardsRunAlongRails(lane({ palletOrientation: 'short-side-out' }))).toBe(true)
  })

  test('drive-through with cs3 is the one combination ruled out', () => {
    expect(bracingConflictsWithEntry(lane({ entryMode: 'drive-through' }))).toBe(false)
    expect(
      bracingConflictsWithEntry(lane({ entryMode: 'drive-through', constructiveSystem: 'cs3' })),
    ).toBe(true)
    // Single-entry keeps cs3 — the braced plane stands at the closed end.
    expect(bracingConflictsWithEntry(lane({ constructiveSystem: 'cs3' }))).toBe(false)
  })

  test('centralisers on a C rail are flagged — nothing to centre against', () => {
    expect(centralisersUnavailable(lane())).toBe(false)
    expect(centralisersUnavailable(lane({ railType: 'c' }))).toBe(true)
  })
})

describe('forklift envelope', () => {
  const envelope = forkliftEnvelope(lane())

  test('truck body clears 75 mm each side', () => {
    expect(envelope.maxTruckWidth).toBeCloseTo(1.2, 9)
  })

  test('the mast must lift 200 mm above the top rail', () => {
    expect(envelope.requiredLift).toBeCloseTo(4.7, 9)
  })

  test('the guide gap is the entry width less 110 mm, and only when fitted', () => {
    expect(envelope.guideGap).toBeNull()
    expect(forkliftEnvelope(lane({ guideRails: true })).guideGap).toBeCloseTo(1.24, 9)
  })
})

describe('orientation', () => {
  test('long-side-out lays the 1200 mm length across the lane', () => {
    expect(orientedPalletFootprint(lane())).toEqual([1.2, 0.8])
  })

  test('short-side-out turns it into the depth', () => {
    expect(orientedPalletFootprint(lane({ palletOrientation: 'short-side-out' }))).toEqual([
      0.8, 1.2,
    ])
  })
})
