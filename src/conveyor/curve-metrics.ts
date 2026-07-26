import {
  MAX_SUPPORT_SPACING_M,
  MIN_ROLLERS_UNDER_A_BOX,
  SIDE_GUIDE_THICKNESS_M,
  SIDE_PROFILE_DEPTH_M,
} from './constants'
import type { ConveyorCurveNode } from './curve-schema'

/**
 * Every figure derived from a curve module.
 *
 * The same role `./metrics` plays for the straight, and the same rule: pure
 * functions over the node, shared by the parts list, the cache key, the
 * floorplan, the ports and the tests, so the mesh and the numbers cannot
 * disagree.
 *
 * ## The frame the whole file works in
 *
 * A curve is described from its **arc centre** — the point it turns about — but
 * the node cannot sit there. The host's `floorPlaced.footprint` is a box
 * *centred on the node*, and a sector's arc centre is at one corner of its
 * bounding box, so a footprint centred there would be twice too big and half
 * empty, and every collision test would be wrong by that much.
 *
 * So the node sits at the **centre of the sector's bounding box** and the arc
 * centre is an offset from it. Everything below returns local coordinates in
 * the node's frame, with that offset already applied.
 */

const mm = (value: number): number => value / 1000

/** The formed kerb each side of a bend, which is what stands between the useful
 *  width and the frame width. */
const KERB_THICKNESS_M = SIDE_GUIDE_THICKNESS_M

/**
 * Frame width over the useful width, for the curve family: **111 mm**, where a
 * straight is 147. Mecalux publishes 600 → 711 for CNV-CRA and 600 → 747 for
 * the straights. Two constants rather than one, because they are two families
 * with differently formed side members — sharing a constant would put 18 mm of
 * imaginary steel on every bend.
 */
export const CURVE_FRAME_OVERHANG_M = mm(111)

/** The catalogue enums as numbers. The schema holds them as strings because
 *  that is what the host's enum control reads and writes; this is the only
 *  place that is undone. */
export function usefulWidthMm(curve: ConveyorCurveNode): number {
  return Number(curve.usefulWidth)
}

export function rollerPitchMm(curve: ConveyorCurveNode): number {
  return Number(curve.rollerPitch)
}

export function speedMPerMin(curve: ConveyorCurveNode): number {
  return Number(curve.speed)
}

export function zoneCount(curve: ConveyorCurveNode): number {
  return Number(curve.zones)
}

export function angleDeg(curve: ConveyorCurveNode): number {
  return Number(curve.angle)
}

export function laneWidthM(curve: ConveyorCurveNode): number {
  return usefulWidthMm(curve) / 1000
}

export function frameWidthM(curve: ConveyorCurveNode): number {
  return laneWidthM(curve) + CURVE_FRAME_OVERHANG_M
}

/** Outside of the bend, measured to the outer kerb's outer face. */
export function outerRadiusM(curve: ConveyorCurveNode): number {
  return curve.innerRadius + frameWidthM(curve)
}

/** The line a box's centre follows. What the ports sit on and what a length is
 *  measured along. */
export function centrelineRadiusM(curve: ConveyorCurveNode): number {
  return curve.innerRadius + frameWidthM(curve) / 2
}

export function angleRad(curve: ConveyorCurveNode): number {
  return (angleDeg(curve) * Math.PI) / 180
}

/**
 * Rollers across the bend.
 *
 * Derived from the pitch at the inner radius, where they are closest, then
 * rounded to a whole number so the angular step divides the arc exactly. A
 * fractional count would leave a wedge of bare frame at one end of every bend.
 */
export function rollerCount(curve: ConveyorCurveNode): number {
  const pitch = rollerPitchMm(curve) / 1000
  return Math.max(2, Math.round((angleRad(curve) * curve.innerRadius) / pitch))
}

/**
 * The angular step between rollers — and the reason a tapered roller is the
 * right hardware for a bend.
 *
 * A cone rotating on a radial axis has a surface speed proportional to its
 * radius, so a constant *angular* step puts a constant *arc* pitch at every
 * radius at once. Getting this one number right makes the outer pitch correct
 * by construction rather than by a second calculation.
 */
export function rollerStepRad(curve: ConveyorCurveNode): number {
  return angleRad(curve) / rollerCount(curve)
}

/** Arc pitch at a given radius. The inner one is what the support rule reads. */
export function pitchAtRadiusM(curve: ConveyorCurveNode, radius: number): number {
  return rollerStepRad(curve) * radius
}

/** Length a box actually travels through the bend. */
export function centrelineLengthM(curve: ConveyorCurveNode): number {
  return angleRad(curve) * centrelineRadiusM(curve)
}

// ── The node's own frame ────────────────────────────────────────────────────

/**
 * The sector's extent about its arc centre, before the node's offset.
 *
 * The arc is swept from 0 to `angle` in the node's local plan frame, so its
 * bounding box is decided by which axis crossings the sweep contains — a 90°
 * bend reaches both +X and +Z at full outer radius, a 45° reaches only +X.
 * Computed rather than approximated, because this box *is* the footprint and a
 * generous one would refuse placements that fit.
 */
function sectorBounds(curve: ConveyorCurveNode): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
} {
  const outer = outerRadiusM(curve)
  const inner = curve.innerRadius
  const sweep = angleRad(curve)

  // The arc runs in plan from local +X towards local −Z, which is what a +Y
  // rotation does to a heading — the same convention every other file here
  // derives independently.
  const points: Array<[number, number]> = []
  for (const radius of [inner, outer]) {
    points.push([radius, 0])
    points.push([radius * Math.cos(sweep), -radius * Math.sin(sweep)])
  }
  // Every quarter-turn the sweep passes adds an extremum at full outer radius.
  for (let quarter = Math.PI / 2; quarter < sweep + 1e-9; quarter += Math.PI / 2) {
    points.push([outer * Math.cos(quarter), -outer * Math.sin(quarter)])
  }

  return {
    minX: Math.min(...points.map((p) => p[0])),
    maxX: Math.max(...points.map((p) => p[0])),
    minZ: Math.min(...points.map((p) => p[1])),
    maxZ: Math.max(...points.map((p) => p[1])),
  }
}

/**
 * Where the arc centre sits in the node's own frame.
 *
 * The node is at the middle of the sector's bounding box, so the centre it
 * turns about is offset by however far that middle is from it.
 */
export function arcCentreLocal(curve: ConveyorCurveNode): [number, number] {
  const bounds = sectorBounds(curve)
  return [-(bounds.minX + bounds.maxX) / 2, -(bounds.minZ + bounds.maxZ) / 2]
}

/** `[width along local X, depth along local Z]` — the box the node tiles at. */
export function footprintM(curve: ConveyorCurveNode): [number, number] {
  const bounds = sectorBounds(curve)
  return [bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ]
}

/**
 * A point on the arc, in the node's local frame.
 *
 * `handed` mirrors the sweep about local X, which is the only difference
 * between a left and a right bend — the same sector, read the other way round.
 */
export function arcPointLocal(
  curve: ConveyorCurveNode,
  radius: number,
  theta: number,
): [number, number] {
  const [ox, oz] = arcCentreLocal(curve)
  const sign = curve.handed === 'left' ? 1 : -1
  return [ox + radius * Math.cos(theta), sign * (oz - radius * Math.sin(theta))]
}

// ── Heights, shared with the straight ───────────────────────────────────────

export function frameBottomY(curve: ConveyorCurveNode): number {
  return curve.transportHeight - SIDE_PROFILE_DEPTH_M
}

export function legHeightM(curve: ConveyorCurveNode): number {
  return Math.max(0, frameBottomY(curve))
}

/**
 * Angles at which the bend is held up.
 *
 * Spaced along the centreline no further apart than a straight's supports, with
 * one at each end — a bend is short enough that this is usually two or three.
 */
export function supportAngles(curve: ConveyorCurveNode): number[] {
  const spans = Math.max(1, Math.ceil(centrelineLengthM(curve) / MAX_SUPPORT_SPACING_M))
  const step = angleRad(curve) / spans
  return Array.from({ length: spans + 1 }, (_, index) => index * step)
}

// ── What the bend can do ────────────────────────────────────────────────────

export function speedMPerSec(curve: ConveyorCurveNode): number {
  return speedMPerMin(curve) / 60
}

/**
 * Rollers under the shortest box, measured at the **outer** radius.
 *
 * Where the arc pitch is widest and so where the fewest rollers sit under a
 * box — which is the case a *minimum* count rule is about. The inner radius is
 * the tempting one, because that is where the rollers are closest together, but
 * it reports the most forgiving number and would pass a bend on which a short
 * box drops between the rollers at the very edge a curve throws it towards.
 */
export function rollersUnderShortestBox(curve: ConveyorCurveNode): number {
  return Math.floor(curve.shortestBox / pitchAtRadiusM(curve, outerRadiusM(curve))) + 1
}

export function carriesShortestBox(curve: ConveyorCurveNode): boolean {
  return rollersUnderShortestBox(curve) >= MIN_ROLLERS_UNDER_A_BOX
}

/**
 * Clear channel between the two kerbs — wider than the useful box width, which
 * is what gives a box room to swing.
 */
export function clearChannelM(curve: ConveyorCurveNode): number {
  return frameWidthM(curve) - 2 * KERB_THICKNESS_M
}

/**
 * Inner and outer radius of that channel: what a box actually rides between,
 * and the two faces it can hit.
 *
 * Measured from the kerb's *inside* rather than from `innerRadius`, and the
 * distinction is not cosmetic: the swing calculation below is a difference of
 * squares, so shifting both radii by the kerb thickness does not cancel out.
 * `./curve-geometry` lays the bed between exactly these two, so the figure the
 * panel reports and the mesh the user sees come from one place.
 */
export function channelRadiiM(curve: ConveyorCurveNode): [number, number] {
  const inner = curve.innerRadius + KERB_THICKNESS_M
  return [inner, inner + clearChannelM(curve)]
}

/**
 * The longest box that can physically get round the bend.
 *
 * A rigid box does not follow the centreline: as it turns, its leading and
 * trailing outer corners swing wider than its centre, by an amount that grows
 * with the square of its length. So a bend has a maximum box length, it is set
 * by the radius rather than by the drive, and no amount of power fixes a box
 * that jams against the outer kerb.
 *
 * A box of width `W` riding the middle of a channel running from `Ri` to `Ro`
 * has its centre at `(Ri + Ro) / 2`, its outer face half its width beyond that,
 * and its outer corner at `hypot(that, L/2)`. That corner is what has to stay
 * inside `Ro`, and solving for `L` gives this. Worst case by default: the widest
 * box the lane is rated for.
 *
 * The figure is worth reporting rather than merely checking. At the assumed
 * 800 mm inner radius a full-width 600 mm box tops out at about 690 mm — so a
 * line carrying longer cartons needs a wider bend, and the panel can say so
 * before it is drawn rather than after it is built.
 */
export function longestBoxThroughBendM(
  curve: ConveyorCurveNode,
  boxWidth = laneWidthM(curve),
): number {
  const [inner, outer] = channelRadiiM(curve)
  const cornerRadius = (inner + outer) / 2 + boxWidth / 2
  const room = outer * outer - cornerRadius * cornerRadius
  return room <= 0 ? 0 : 2 * Math.sqrt(room)
}

/** Whether a box of the given length gets round at the widest the lane allows. */
export function boxClearsTheBend(curve: ConveyorCurveNode, boxLength: number): boolean {
  return boxLength <= longestBoxThroughBendM(curve) + 1e-9
}

/** Longest arc one stand-in box may span, in radians. Thirty degrees keeps the
 *  chord within four centimetres of the arc at every radius the schema allows. */
const COLLIDER_STEP = Math.PI / 6

/**
 * Boxes that stand in for the bend when something is clicked.
 *
 * **Not the bounding box**, which is what a single collider would have to be —
 * and a quarter annulus fills less than a third of its own square, so a bend
 * tucked into a corner would swallow clicks aimed at the rack beside it. A
 * handful of chord-length boxes following the arc is a tight picker instead, and
 * costs nothing to draw: they are mounted invisible, so three's raycaster keeps
 * hitting them while the renderer skips them entirely.
 *
 * Radially over-deep by the chord's bulge, so the segments cover the arc they
 * approximate rather than cutting its corners off.
 */
export function colliderSegments(
  curve: ConveyorCurveNode,
): Array<{ center: [number, number]; size: [number, number]; rotationY: number }> {
  const sweep = angleRad(curve)
  const count = Math.max(1, Math.ceil(sweep / COLLIDER_STEP))
  const step = sweep / count
  const outer = outerRadiusM(curve)
  const radius = (curve.innerRadius + outer) / 2
  const depth = outer - curve.innerRadius + 2 * radius * (1 - Math.cos(step / 2))
  const hand = curve.handed === 'left' ? 1 : -1

  return Array.from({ length: count }, (_, index) => {
    const mid = (index + 0.5) * step
    return {
      center: arcPointLocal(curve, radius, mid),
      size: [2 * radius * Math.sin(step / 2), depth] as [number, number],
      rotationY: hand * mid,
    }
  })
}

/** The volume the module occupies, as a box in its own local frame. */
export function localBoundsM(curve: ConveyorCurveNode): {
  min: [number, number, number]
  max: [number, number, number]
} {
  const [width, depth] = footprintM(curve)
  const top =
    curve.sideGuide === 'none'
      ? curve.transportHeight
      : curve.transportHeight + curve.sideGuideHeight
  return {
    min: [-width / 2, 0, -depth / 2],
    max: [width / 2, top, depth / 2],
  }
}
