import { OBQ } from './catalog'
import {
  MIN_ROLLERS_UNDER_A_BOX,
  OBLIQUE_FRAME_OVERHANG_M,
  ROLLER_DIAMETER_M,
  SIDE_PROFILE_DEPTH_M,
} from './constants'
import type { ConveyorObliqueNode } from './oblique-schema'

/**
 * Every figure derived from an oblique transfer.
 *
 * The whole file turns on one derivation: **where the branch leaves.** Nothing
 * about it is published, but nothing about it is free either — the branch has to
 * run far enough to carry its own frame clear of the main one, and the module is
 * a fixed 1500 mm, so the divergence point is whatever satisfies both. Inventing
 * it would let a shallow branch overlap the main line it just left.
 */

export function speedMPerMin(oblique: ConveyorObliqueNode): number {
  return Number(oblique.speed)
}

export function speedMPerSec(oblique: ConveyorObliqueNode): number {
  return speedMPerMin(oblique) / 60
}

export function rollerPitchMm(oblique: ConveyorObliqueNode): number {
  return Number(oblique.rollerPitch)
}

export function rollerPitchM(oblique: ConveyorObliqueNode): number {
  return rollerPitchMm(oblique) / 1000
}

export function angleDeg(oblique: ConveyorObliqueNode): number {
  return Number(oblique.angle)
}

export function angleRad(oblique: ConveyorObliqueNode): number {
  return (angleDeg(oblique) * Math.PI) / 180
}

/** Which way the branch leaves, as a sign on local Z. Local +Z is the module's
 *  left seen from above with goods travelling local +X. */
export function branchSign(oblique: ConveyorObliqueNode): number {
  return oblique.branchSide === 'left' ? 1 : -1
}

/**
 * Which end of the main line the branch leaves at, as a sign on local X.
 *
 * **The discharge end, whichever end that is.** A branch is where goods leave,
 * so on a module installed the other way round it is at the other end — built
 * fixed toward +X, a reverse-flow machine would declare an outlet at its own
 * infeed and the magnet would happily mate a line onto it that cannot run.
 */
export function flowSign(oblique: ConveyorObliqueNode): number {
  return oblique.flow === 'forward' ? 1 : -1
}

/** The main body, fixed by the catalogue in both directions. */
export function moduleLengthM(_oblique: ConveyorObliqueNode): number {
  return OBQ.lengthM
}

export function mainWidthM(_oblique: ConveyorObliqueNode): number {
  return OBQ.mainExteriorWidthM
}

export function branchWidthM(_oblique: ConveyorObliqueNode): number {
  return OBQ.branchExteriorWidthM
}

/**
 * The lane class each end carries. The main pair and the branch differ, which is
 * the whole reason a port in this package names its own.
 *
 * **Both are inferred, and the inference is named.** The catalogue publishes
 * only exterior widths for this type, so the useful widths behind them come from
 * an overhang it does not state — see `OBLIQUE_FRAME_OVERHANG_M`. Subtracting a
 * bare literal here would hide that from anyone auditing the catalogue split,
 * and would silently follow a *different* machine's figure the day that one is
 * republished.
 */
export function mainLaneMm(oblique: ConveyorObliqueNode): number {
  return Math.round((mainWidthM(oblique) - OBLIQUE_FRAME_OVERHANG_M) * 1000)
}

export function branchLaneMm(oblique: ConveyorObliqueNode): number {
  return Math.round((branchWidthM(oblique) - OBLIQUE_FRAME_OVERHANG_M) * 1000)
}

// ── Where the branch leaves ─────────────────────────────────────────────────

/**
 * How far the branch centreline must stand off the main one to be clear of it.
 *
 * Half of each frame: at less than this the two beds overlap, and the box would
 * be on both lines at once.
 */
export function branchOffsetM(oblique: ConveyorObliqueNode): number {
  return (mainWidthM(oblique) + branchWidthM(oblique)) / 2
}

/**
 * Local X of the point the branch leaves the main line at.
 *
 * Derived backwards from the module's end: the branch runs to `+length/2` and
 * has to have reached `branchOffsetM` laterally by then, so a shallower angle
 * pushes the divergence earlier — at 30° it starts *before* the module's middle
 * and at 45° well after it. That is the trade the angle buys, and it is why the
 * point is computed rather than placed.
 */
export function divergeXM(oblique: ConveyorObliqueNode): number {
  const along = moduleLengthM(oblique) / 2 - branchOffsetM(oblique) / Math.tan(angleRad(oblique))
  return flowSign(oblique) * along
}

/** How far the branch bed runs, along its own axis. */
export function branchLengthM(oblique: ConveyorObliqueNode): number {
  return branchOffsetM(oblique) / Math.sin(angleRad(oblique))
}

/** The branch's far end, in the node's local plan frame — at the discharge end
 *  of the main line, which is what `flowSign` names. */
export function branchEndLocal(oblique: ConveyorObliqueNode): [number, number] {
  return [
    (flowSign(oblique) * moduleLengthM(oblique)) / 2,
    branchSign(oblique) * branchOffsetM(oblique),
  ]
}

/** The middle of the branch bed, in the node's local plan frame. */
export function branchCentreLocal(oblique: ConveyorObliqueNode): [number, number] {
  const [endX, endZ] = branchEndLocal(oblique)
  return [(divergeXM(oblique) + endX) / 2, endZ / 2]
}

/**
 * The branch's heading in plan, as a rotation about Y.
 *
 * Mirrored on both axes: the hand decides which side it leaves by, and the flow
 * decides which end — a reverse-flow branch runs back along −X, so its heading
 * is the forward one turned through half a circle.
 */
export function branchHeadingRad(oblique: ConveyorObliqueNode): number {
  const forward = -branchSign(oblique) * angleRad(oblique)
  return flowSign(oblique) > 0 ? forward : Math.PI - forward
}

// ── Heights ─────────────────────────────────────────────────────────────────

export function rollerAxisY(oblique: ConveyorObliqueNode): number {
  return oblique.transportHeight - ROLLER_DIAMETER_M / 2
}

export function frameBottomY(oblique: ConveyorObliqueNode): number {
  return oblique.transportHeight - SIDE_PROFILE_DEPTH_M
}

export function legHeightM(oblique: ConveyorObliqueNode): number {
  return Math.max(0, frameBottomY(oblique))
}

/** Local X of each main-line support station: one at each end, which is what
 *  lets this share a support at a seam like a straight. The branch carries its
 *  own pair at its far end. */
export function supportOffsetsX(oblique: ConveyorObliqueNode): number[] {
  const length = moduleLengthM(oblique)
  return [-length / 2, length / 2]
}

// ── Load ────────────────────────────────────────────────────────────────────

export function rollersUnderShortestBox(oblique: ConveyorObliqueNode): number {
  return Math.floor(oblique.shortestBox / rollerPitchM(oblique)) + 1
}

export function carriesShortestBox(oblique: ConveyorObliqueNode): boolean {
  return rollersUnderShortestBox(oblique) >= MIN_ROLLERS_UNDER_A_BOX
}

/**
 * The widest box that fits the **branch**, which is the narrower of the two
 * lanes and therefore what R11 binds on.
 *
 * Reported rather than merely checked: the point of the rule is that a line's
 * accepted box narrows at its junctions, and this is the junction that does it.
 */
export function branchBoxWidthM(oblique: ConveyorObliqueNode): number {
  return branchLaneMm(oblique) / 1000
}

// ── Placement ───────────────────────────────────────────────────────────────

/** Every corner of both beds, in the node's local plan frame. What the footprint
 *  is measured from — computed rather than approximated, because a generous box
 *  would refuse placements that fit. */
function corners(oblique: ConveyorObliqueNode): Array<[number, number]> {
  const half = moduleLengthM(oblique) / 2
  const mainHalf = mainWidthM(oblique) / 2
  const points: Array<[number, number]> = [
    [-half, -mainHalf],
    [-half, mainHalf],
    [half, -mainHalf],
    [half, mainHalf],
  ]

  const heading = branchHeadingRad(oblique)
  const cos = Math.cos(heading)
  const sin = Math.sin(heading)
  const [cx, cz] = branchCentreLocal(oblique)
  const bx = branchLengthM(oblique) / 2
  const bz = branchWidthM(oblique) / 2

  for (const [ox, oz] of [
    [-bx, -bz],
    [-bx, bz],
    [bx, -bz],
    [bx, bz],
  ] as const) {
    points.push([cx + ox * cos + oz * sin, cz - ox * sin + oz * cos])
  }
  return points
}

/** `[width along the main line, depth across it]` — the box the node tiles at. */
export function footprintM(oblique: ConveyorObliqueNode): [number, number] {
  const points = corners(oblique)
  const xs = points.map((point) => point[0])
  const zs = points.map((point) => point[1])
  return [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)]
}

/**
 * How far the footprint's middle sits from the node.
 *
 * The branch leaves one side only, so the steel is not centred on the node — the
 * same problem the launcher has with its arm, and the host's
 * `floorPlaced.footprint` is a box *centred on the node*, so the offset is
 * carried separately.
 */
export function footprintCentreZM(oblique: ConveyorObliqueNode): number {
  const zs = corners(oblique).map((point) => point[1])
  return (Math.max(...zs) + Math.min(...zs)) / 2
}

/** The volume the module occupies, floor to roller top: legs included, because
 *  what fits under a rack's tunnel has to fit with them. */
export function localBoundsM(oblique: ConveyorObliqueNode): {
  min: [number, number, number]
  max: [number, number, number]
} {
  const [width, depth] = footprintM(oblique)
  const centreZ = footprintCentreZM(oblique)
  return {
    min: [-width / 2, 0, centreZ - depth / 2],
    max: [width / 2, oblique.transportHeight, centreZ + depth / 2],
  }
}
