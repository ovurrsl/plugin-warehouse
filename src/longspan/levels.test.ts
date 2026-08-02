import { describe, expect, test } from 'bun:test'
import {
  bayPitch,
  beamOffsetsZ,
  clearAbove,
  collidingLevels,
  crossBracingAdvised,
  droppedLevelCount,
  fittedLevels,
  frameCentersX,
  hangingLengthM,
  hmLengthUnpublished,
  levelElevation,
  levelNeedsZtam,
  panelWidths,
  shelfAreaM2,
  slotPitchFor,
  totalWidth,
  usesMsCentreBeam,
} from './levels'
import { type LongspanLevel, LongspanNode } from './schema'
import { BAY_LENGTHS, FRAME_HEIGHTS, nearestBayLength } from './standards'

const bay = (patch: Partial<LongspanNode> = {}) =>
  LongspanNode.parse({ id: 'longspan_probe', ...patch })

const level = (patch: Partial<LongspanLevel> = {}): LongspanLevel => ({
  elevation: 1,
  structure: 'beam-shelf',
  shelfKind: 'chipboard',
  panels: 1,
  ...patch,
})

/**
 * The two slot pitches are the spine of this file.
 *
 * The M7 frame is punched on two faces at two pitches — front 50 mm for beams,
 * side 25 mm for HM supports. Snapping every level to one of them would put
 * half the HM positions where the upright has no hole, and the failure would
 * look exactly like a level that is "a bit off".
 */

describe('slot pitch follows the face that carries the level', () => {
  test('a beam level lands on the 50 mm front pitch', () => {
    expect(slotPitchFor(level())).toBeCloseTo(0.05, 9)
    // 1.23 → 1.25 on the 50 mm grid.
    expect(levelElevation(level({ elevation: 1.23 }))).toBeCloseTo(1.25, 9)
  })

  test('an HM level lands on the 25 mm SIDE pitch', () => {
    const hm = level({ structure: 'reinforced-hm', shelfKind: 'hm' })
    expect(slotPitchFor(hm)).toBeCloseTo(0.025, 9)
    // 1.23 → 1.225 on the 25 mm grid, which the 50 mm grid cannot express.
    expect(levelElevation({ ...hm, elevation: 1.23 })).toBeCloseTo(1.225, 9)
  })

  test('the two grids genuinely differ — this is not a rounding detail', () => {
    const beamLevel = level({ elevation: 1.72 })
    const hmLevel = level({ elevation: 1.72, structure: 'reinforced-hm', shelfKind: 'hm' })
    expect(levelElevation(beamLevel)).toBeCloseTo(1.7, 9)
    expect(levelElevation(hmLevel)).toBeCloseTo(1.725, 9)
  })
})

describe('four structures in one bay', () => {
  const mixed = bay({
    frameHeight: 4,
    levels: [
      level({ elevation: 0.4, structure: 'beam-shelf', shelfKind: 'chipboard' }),
      level({ elevation: 1.2, structure: 'reinforced-hm', shelfKind: 'hm' }),
      level({ elevation: 2, structure: 'beam-only' }),
      level({ elevation: 2.8, structure: 'hanging' }),
    ],
  })

  test('all four are carried', () => {
    // This is the whole reason `levels` is an array of descriptors rather than
    // a count: a count would force every level in a bay to be the same thing.
    expect(fittedLevels(mixed).map((entry) => entry.structure)).toEqual([
      'beam-shelf',
      'reinforced-hm',
      'beam-only',
      'hanging',
    ])
  })

  test('shelf area counts only the levels that carry a panel', () => {
    // `beam-only` holds long goods across bare beams and `hanging` holds a
    // rail; neither is shelf area, and counting them would flatter the bay.
    expect(shelfAreaM2(mixed)).toBeCloseTo(2 * mixed.bayLength * mixed.frameDepth, 9)
  })

  test('hanging length is reported separately', () => {
    expect(hangingLengthM(mixed)).toBeCloseTo(mixed.bayLength, 9)
  })
})

describe('levels are ordered by height, not by array position', () => {
  test('a retyped elevation still reads in order', () => {
    // The panel lets a user retype a height, and the clear-height figure is the
    // distance to the NEXT level — meaningless if the list is out of order.
    const node = bay({
      frameHeight: 4,
      levels: [level({ elevation: 2 }), level({ elevation: 0.5 }), level({ elevation: 1.2 })],
    })
    expect(fittedLevels(node).map((entry) => entry.elevation)).toEqual([0.5, 1.2, 2])
  })
})

describe('levels above the frame are dropped', () => {
  test('and counted, so the panel can say so', () => {
    const node = bay({
      frameHeight: 2,
      levels: [level({ elevation: 0.5 }), level({ elevation: 1.5 }), level({ elevation: 3 })],
    })
    expect(fittedLevels(node).length).toBe(2)
    expect(droppedLevelCount(node)).toBe(1)
  })
})

describe('clear height above a level', () => {
  const node = bay({
    frameHeight: 3,
    beamProfile: 'ZE-55',
    levels: [level({ elevation: 0.5 }), level({ elevation: 1.5 })],
  })

  test('stops at the next level’s STEEL, not at its load surface', () => {
    // The next level's beam and board hang below its surface; a "distance
    // between surfaces" reading would promise headroom that is not there.
    // 1.5 − (0.055 beam + 0.022 board) − 0.5 = 0.923
    expect(clearAbove(node, 0)).toBeCloseTo(0.923, 9)
  })

  test('the topmost level is bounded by the frame', () => {
    expect(clearAbove(node, 1)).toBeCloseTo(1.5, 9)
  })
})

describe('the MS-65 centre beam', () => {
  test('appears on a double-depth chipboard level', () => {
    // Read from the geometry, not from a field: a bay at least half as deep as
    // it is long is what the catalogue's rule describes, and a stored flag
    // could disagree with the shape.
    const deep = bay({ bayLength: 1.2, frameDepth: 0.8 })
    expect(usesMsCentreBeam(deep, level())).toBe(true)
    expect(beamOffsetsZ(deep, level()).length).toBe(3)
  })

  test('does not appear on a shallow bay', () => {
    const shallow = bay({ bayLength: 2.7, frameDepth: 0.6 })
    expect(usesMsCentreBeam(shallow, level())).toBe(false)
    expect(beamOffsetsZ(shallow, level()).length).toBe(2)
  })

  test('nor on a mesh level — the rule is about chipboard', () => {
    const deep = bay({ bayLength: 1.2, frameDepth: 0.8 })
    expect(usesMsCentreBeam(deep, level({ shelfKind: 'mesh' }))).toBe(false)
  })
})

describe('Z-TAM clamps', () => {
  test('are required at 1.9 m of chipboard and not below it', () => {
    expect(levelNeedsZtam(bay({ bayLength: 1.9 }), level())).toBe(true)
    expect(levelNeedsZtam(bay({ bayLength: 1.4 }), level())).toBe(false)
  })

  test('are a chipboard rule — mesh at the same length does not take them', () => {
    expect(levelNeedsZtam(bay({ bayLength: 2.7 }), level({ shelfKind: 'mesh' }))).toBe(false)
  })

  test('and an HM level has no beams to clamp', () => {
    expect(
      levelNeedsZtam(
        bay({ bayLength: 2.7 }),
        level({ structure: 'reinforced-hm', shelfKind: 'hm' }),
      ),
    ).toBe(false)
  })
})

describe('plan dimensions', () => {
  test('bays share frames: the pitch is the length plus one upright', () => {
    const node = bay()
    expect(bayPitch(node)).toBeCloseTo(node.bayLength + 0.05, 9)
    expect(totalWidth(node)).toBeCloseTo(bayPitch(node) + 0.05, 9)
    const [left, right] = frameCentersX(node)
    expect(right - left).toBeCloseTo(bayPitch(node), 9)
  })
})

describe('panels across the bay', () => {
  test('divide the clear length evenly', () => {
    const node = bay({ bayLength: 1.8 })
    const widths = panelWidths(node, level({ shelfKind: 'galvanised-picking', panels: 6 }))
    expect(widths.length).toBe(6)
    expect(widths[0]).toBeCloseTo(0.3, 9)
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(1.8, 9)
  })
})

describe('report-only checks', () => {
  test('two levels on the same slot are flagged', () => {
    const node = bay({ levels: [level({ elevation: 1 }), level({ elevation: 1.02 })] })
    // Both snap to 1.00 on the 50 mm grid — a typo the panel could not
    // otherwise show, because the two entries read as different numbers.
    expect(collidingLevels(node)).toEqual([1])
  })

  test('an HM shelf outside its own length series is flagged', () => {
    // The HM series is narrower than the frame's: 1.0 / 1.25 / 1.4.
    const ok = bay({
      bayLength: 1.4,
      levels: [level({ structure: 'reinforced-hm', shelfKind: 'hm' })],
    })
    const off = bay({
      bayLength: 1.9,
      levels: [level({ structure: 'reinforced-hm', shelfKind: 'hm' })],
    })
    expect(hmLengthUnpublished(ok)).toBe(false)
    expect(hmLengthUnpublished(off)).toBe(true)
  })

  test('a bay with no HM level is never flagged for it', () => {
    expect(hmLengthUnpublished(bay({ bayLength: 1.9 }))).toBe(false)
  })

  test('tall HM units are advised to take cross-bracing', () => {
    const tall = bay({
      frameHeight: 4,
      levels: [level({ structure: 'reinforced-hm', shelfKind: 'hm' })],
    })
    expect(crossBracingAdvised(tall)).toBe(true)
    // Advice, not enforcement: ticking the box silences it.
    expect(crossBracingAdvised({ ...tall, crossBracing: true })).toBe(false)
  })
})

describe('catalogue series', () => {
  test('frame heights run 1.0 to 8.0 in half-metre steps', () => {
    expect(FRAME_HEIGHTS[0]).toBeCloseTo(1, 9)
    expect(FRAME_HEIGHTS[FRAME_HEIGHTS.length - 1]).toBeCloseTo(8, 9)
    expect(FRAME_HEIGHTS.length).toBe(15)
  })

  test('bay lengths are the published six', () => {
    expect(BAY_LENGTHS.map((value) => Math.round(value * 1000))).toEqual([
      1000, 1200, 1400, 1900, 2300, 2700,
    ])
  })

  test('a cut-to-fit bay reports the nearest published length', () => {
    // A run against a wall gets cut, and the panel names what it is closest to
    // rather than pretending the odd length is a catalogue item.
    expect(Math.round(nearestBayLength(1.85) * 1000)).toBe(1900)
    expect(Math.round(nearestBayLength(1.08) * 1000)).toBe(1000)
    expect(Math.round(nearestBayLength(2.5) * 1000)).toBe(2300)
  })

  test('an exact tie is broken arbitrarily but never wrongly', () => {
    /**
     * 1.1 m sits exactly between 1.0 and 1.2, and binary floating point breaks
     * that tie one way or the other depending on the subtraction order — here
     * it lands on 1.2, because `1.2 − 1.1` is a hair smaller than `1.1 − 1.0`.
     *
     * Asserted rather than avoided: the answer is a *report*, not a
     * constraint — the panel says "closest published length" and either
     * neighbour is an honest answer. Pinning it stops a future reader from
     * reading the arbitrary choice as a rule.
     */
    const tie = nearestBayLength(1.1)
    expect([1000, 1200]).toContain(Math.round(tie * 1000))
  })
})
