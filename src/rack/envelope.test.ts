import { describe, expect, test } from 'bun:test'
import {
  aisleEnvelopeHalfDepth,
  clearAisleBetween,
  FOOTPLATE_PROJECTION_M,
  palletOverhangM,
} from './envelope'
import { DEFAULT_MULTIPLY, rowOffsets } from './multiply'
import { PalletRackNode } from './schema'
import { rowDepth } from './slots'
import { HANDLING_EQUIPMENT } from './standards'

const rack = (patch: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_1', ...patch })

describe('a bay reaches into the aisle further than its steel does', () => {
  test('a Euro pallet short-side-out overhangs, and the overhang governs', () => {
    // 1200 mm into a 1100 mm frame is 50 mm a face — the figure `standards.ts`
    // and the floorplan test both already state.
    const node = rack()
    expect(palletOverhangM(node)).toBeCloseTo(0.05, 9)
    expect(aisleEnvelopeHalfDepth(node)).toBeCloseTo(0.6, 9)
  })

  test('turned lengthwise there is no overhang, and the footplate governs', () => {
    // The short side goes into the depth, so the steel is proud of the load —
    // and the widest thing at floor level is the plate a wheel meets first.
    const node = rack({ palletOrientation: 'long-side-out' })
    expect(palletOverhangM(node)).toBeLessThan(0)
    expect(aisleEnvelopeHalfDepth(node)).toBeCloseTo(0.55 + FOOTPLATE_PROJECTION_M, 9)
  })

  test('a frame deeper than its pallet is governed by the footplate too', () => {
    // `rack.depth` is settable from 0.4 m to 2.5 m. A constant 50 mm would be
    // wrong across most of that range.
    const node = rack({ depth: 1.4 })
    expect(palletOverhangM(node)).toBeLessThan(0)
    expect(aisleEnvelopeHalfDepth(node)).toBeCloseTo(0.7 + FOOTPLATE_PROJECTION_M, 9)
  })

  test('the envelope never shrinks below the steel', () => {
    for (const depth of [0.4, 0.8, 1.1, 1.4, 2.5]) {
      for (const palletOrientation of ['short-side-out', 'long-side-out'] as const) {
        const node = rack({ depth, palletOrientation })
        expect(aisleEnvelopeHalfDepth(node)).toBeGreaterThanOrEqual(depth / 2)
      }
    }
  })
})

describe('the aisle the multiply panel lays out is 100 mm short', () => {
  test('the default run gives 3.10 m between loads, not 3.20', () => {
    /**
     * **A verified discrepancy in shipped behaviour, written down as a test so
     * it cannot be fixed by accident or forgotten on purpose.**
     *
     * `multiply.ts` steps the row stride by `rowDepth(rack) + aisleWidth`, and
     * `rowDepth` is pure frame steel — `depthPositions * depth + gaps`, with no
     * pallet term. So the 3.2 m the panel offers is measured frame face to
     * frame face, while the pallet on each side hangs 50 mm into it.
     *
     * A truck drives between loads. `standards.ts` says so in the file that
     * publishes the figure, and the figure it publishes for a counterbalanced
     * forklift is a 3.2 m minimum — so the default layout is short by exactly
     * 100 mm, in the unsafe direction.
     *
     * This test asserts the CURRENT behaviour. It fails the day someone
     * corrects `multiply.ts`, which is exactly when the LAYOUT section needs to
     * hear about it: the paint is drawn to this datum.
     */
    const node = rack()
    const offsets = rowOffsets(node, { ...DEFAULT_MULTIPLY, rows: 2 })
    expect(offsets).toHaveLength(2)

    const stride = Math.abs((offsets[1]?.z ?? 0) - (offsets[0]?.z ?? 0))
    expect(stride).toBeCloseTo(rowDepth(node) + DEFAULT_MULTIPLY.aisleWidth, 9)

    const frameToFrame = stride - rowDepth(node)
    expect(frameToFrame).toBeCloseTo(DEFAULT_MULTIPLY.aisleWidth, 9)

    const loadToLoad = clearAisleBetween(node, node, stride)
    expect(loadToLoad).toBeCloseTo(3.1, 9)
    expect(loadToLoad).toBeLessThan(HANDLING_EQUIPMENT['counterbalanced-forklift'].aisle.min)
    expect(frameToFrame - loadToLoad).toBeCloseTo(0.1, 9)
  })

  test('the back-to-back gap is tighter than it reads, for the same reason', () => {
    // 200 mm of frame gap is 100 mm between loads. Worth stating beside the
    // aisle case because the same arithmetic governs it and the consequence is
    // a fire-code one rather than a manoeuvring one.
    const node = rack()
    const offsets = rowOffsets(node, {
      ...DEFAULT_MULTIPLY,
      rows: 2,
      backToBack: true,
    })
    const stride = Math.abs((offsets[1]?.z ?? 0) - (offsets[0]?.z ?? 0))
    expect(stride - rowDepth(node)).toBeCloseTo(DEFAULT_MULTIPLY.backToBackGap, 9)
    expect(clearAisleBetween(node, node, stride)).toBeCloseTo(0.1, 9)
  })
})
