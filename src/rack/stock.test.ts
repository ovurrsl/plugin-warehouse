import { describe, expect, test } from 'bun:test'
import { PALLET_PRESET_IDS, specOf } from '../pallet/presets'
import { PalletRackNode } from './schema'
import { orientedPalletFootprint, palletSlotsOf, slotOffsetsX } from './slots'

const rack = (overrides: Record<string, unknown> = {}) =>
  PalletRackNode.parse({ id: 'pallet_rack_stock', ...overrides })

/**
 * Whether the ghost pallet has to be turned a quarter of a turn to sit in its
 * slot — the same expression `GhostStock` uses.
 *
 * The pallet mesh is built with its **length along local X** and knows nothing
 * about how a rack is loaded; `palletOrientation` lives on the rack. Nothing
 * reconciled the two, so on the default `short-side-out` bay every ghost pallet
 * was drawn a quarter turn out.
 */
const turned = (node: ReturnType<typeof rack>) =>
  Math.abs(orientedPalletFootprint(node)[0] - specOf(node.palletPreset).length) > 1e-9

/** The pallet's extents as drawn, after the turn. */
const drawn = (node: ReturnType<typeof rack>): [number, number] => {
  const spec = specOf(node.palletPreset)
  return turned(node) ? [spec.width, spec.length] : [spec.length, spec.width]
}

describe('a ghost pallet is drawn the way the slot holds it', () => {
  test('what is drawn is exactly what the slot declares, for every preset', () => {
    // The slot already reports oriented extents through `orientedPalletFootprint`
    // and `slot.footprint`; the mesh simply was not turned to match. One
    // assertion covers the whole class.
    for (const palletPreset of PALLET_PRESET_IDS) {
      for (const palletOrientation of ['short-side-out', 'long-side-out'] as const) {
        const node = rack({ palletPreset, palletOrientation })
        expect({ palletPreset, palletOrientation, drawn: drawn(node) }).toEqual({
          palletPreset,
          palletOrientation,
          drawn: orientedPalletFootprint(node),
        })
      }
    }
  })

  test('the default bay turns the pallet, and that is the case that was wrong', () => {
    // EPAL 1 is 1.2 x 0.8 and the default rack is short-side-out, so the slot
    // wants 0.8 along the run. Untured, a 1.2 m pallet was drawn on a 0.875 m
    // pitch.
    const node = rack()
    expect(turned(node)).toBe(true)
    expect(orientedPalletFootprint(node)).toEqual([0.8, 1.2])
  })

  test('pallets never overlap their neighbours along the run', () => {
    // The symptom: 1.2 m of pallet at a 0.875 m pitch overlapped both
    // neighbours by 325 mm, which is what "the pallets are thrown in sideways"
    // looks like from the aisle.
    for (const palletOrientation of ['short-side-out', 'long-side-out'] as const) {
      for (const bayClearWidth of [2.7, 3.6, 1.4]) {
        const node = rack({ palletOrientation, bayClearWidth })
        const offsets = slotOffsetsX(node)
        if (offsets.length < 2) continue
        const pitch = (offsets[1] ?? 0) - (offsets[0] ?? 0)
        const [alongRun] = drawn(node)
        expect({ palletOrientation, bayClearWidth, fits: alongRun <= pitch + 1e-9 }).toEqual({
          palletOrientation,
          bayClearWidth,
          fits: true,
        })
      }
    }
  })

  test('pallets stay inside the bay between the uprights', () => {
    const node = rack()
    const [alongRun] = drawn(node)
    const half = node.bayClearWidth / 2
    for (const offset of slotOffsetsX(node)) {
      expect(Math.abs(offset) + alongRun / 2).toBeLessThanOrEqual(half + 1e-9)
    }
  })

  test('a short-side-out pallet lands across the beams, not along them', () => {
    // This is why the orientation is not cosmetic. A Euro pallet's bottom boards
    // run along its 1200 mm length. Short-side-out puts that length into the
    // depth, so the boards cross both beams and the pallet is carried. Drawn
    // untured, the length ran along the beams instead — the pallet had nothing
    // under it and would have fallen through, which is exactly the thing a rack
    // must never be shown doing.
    const node = rack({ palletOrientation: 'short-side-out' })
    const [, intoDepth] = drawn(node)
    expect(intoDepth).toBe(specOf(node.palletPreset).length)
    // And it spans the frame, overhanging the beams rather than sitting between
    // them: a 1.2 m pallet on a 1.1 m frame reaches 50 mm past each face, which
    // is the catalogue pairing and the reason aisles are quoted between loads.
    expect(intoDepth).toBeGreaterThan(node.depth)
    expect((intoDepth - node.depth) / 2).toBeCloseTo(0.05, 9)
  })

  test('a long-side-out pallet needs the support bars the schema asks for', () => {
    // The other half of the same fact: turned the other way the boards run along
    // the beams, and the rack has to carry bars or a deck. The panel already
    // warns about this; the drawing has to agree with the warning.
    const node = rack({ palletOrientation: 'long-side-out' })
    const [alongRun] = drawn(node)
    expect(alongRun).toBe(specOf(node.palletPreset).length)
  })

  test('every ghost sits on its level surface, inside the frame depth', () => {
    const node = rack({ levels: 3, uprightHeight: 8, ghostFill: 1 })
    const [, intoDepth] = drawn(node)
    for (const slot of palletSlotsOf(node)) {
      // The slot reports the same depth the mesh will be drawn at.
      expect(slot.footprint[1]).toBeCloseTo(intoDepth, 9)
      // And it is centred on its depth position rather than pushed to one face.
      expect(Math.abs(slot.localPosition[2])).toBeLessThanOrEqual(node.depth / 2 + 1e-9)
    }
  })
})
