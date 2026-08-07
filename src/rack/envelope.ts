import type { PalletRackNode } from './schema'
import { orientedPalletFootprint } from './slots'

/**
 * How far a bay actually reaches into the aisle.
 *
 * **Not the frame.** `standards.ts` states the rule twice in the file that
 * publishes the numbers: aisle widths are quoted between LOADS, because the
 * pallet overhangs the beams and an aisle measured to the steel is wider than
 * the truck needs. A drawn aisle, a clash test and a capacity figure that
 * disagree about which face they measure to are three different buildings.
 *
 * This is the datum the LAYOUT section paints to and the datum
 * `aisleBandForVariant` already quotes against, so it lives here rather than
 * inside either of them: one function, two readers, nothing to drift.
 */

/**
 * **How far a footplate stands proud of its own post: 19.5 mm.**
 *
 * From the catalogue plate `standards.ts` publishes — 175 × 119 mm under a
 * 122 × 80 upright — 39 mm of depth overhang, half of it reaching each face.
 * The plate is no longer *drawn* (`parts.ts`, sadelik kararı 2026-08-07), but
 * this figure guards the aisle against the real equipment, not the mesh: the
 * steel plate is still bolted to the real floor whether or not we spend four
 * boxes on it.
 *
 * It matters because it is what governs when the pallet does not: a bay turned
 * long-side-out, or a frame set as deep as its pallet, has no overhang at all,
 * and the widest thing at floor level is then the plate a forklift's wheel
 * meets first.
 */
export const FOOTPLATE_PROJECTION_M = 0.0195

/**
 * How far the pallet hangs past the frame, per face. Zero or negative when the
 * frame is as deep as the load, which is legal and common — a lengthwise bay
 * sets the pallet's short side into the depth and the steel is flush or proud.
 */
export function palletOverhangM(rack: PalletRackNode): number {
  const intoDepth = orientedPalletFootprint(rack)[1]
  return (intoDepth - rack.depth) / 2
}

/**
 * Half the depth of everything this bay puts in the aisle's way, measured from
 * the bay's own centre.
 *
 * A `max` of three terms rather than the 50 mm an EPAL 1 on a default frame
 * happens to give, because two of the three vanish over large parts of the
 * legal input space: `rack.depth` is user-settable from 0.4 m to 2.5 m, and a
 * long-side-out bay puts the pallet's short side into the depth. Hardcoding the
 * overhang would be wrong for most of the range and silently wrong at the
 * default, which is the worst combination.
 *
 * The third term — cargo hanging past the pallet — is **zero today and named
 * anyway**, because the loaded pallet confines its goods to the deck within a
 * 15 mm placement tolerance, so the pallet face is the load face. EN 15620
 * specifies its clearances against the unit-load envelope rather than the
 * pallet, so the day a carton is allowed to overhang, the paint moves and this
 * is the function that has to know.
 */
export function aisleEnvelopeHalfDepth(rack: PalletRackNode): number {
  return rack.depth / 2 + Math.max(0, palletOverhangM(rack), FOOTPLATE_PROJECTION_M)
}

/** Clear distance between two bays standing face to face at this row stride. */
export function clearAisleBetween(
  near: PalletRackNode,
  far: PalletRackNode,
  rowStride: number,
): number {
  return rowStride - aisleEnvelopeHalfDepth(near) - aisleEnvelopeHalfDepth(far)
}
