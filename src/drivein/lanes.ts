import { specOf } from '../pallet/presets'
import { formatSlotAddress, type Slot } from '../rack/slots'
import { snapUpToSlot } from '../rack/standards'
import type { DriveInRackNode } from './schema'
import {
  BEARING_MIN_DISPLACED,
  BEARING_MIN_IN_MOTION,
  DEPTH_CLEARANCE_MIN,
  guideGapFor,
  MAST_CLEAR_ABOVE_TOP_RAIL,
  RAIL_PROFILES,
  railNoseInset,
  SIDE_CLEARANCE_MIN,
  TRUCK_SIDE_CLEARANCE,
} from './standards'

/**
 * Pure derived geometry for one drive-in lane.
 *
 * The single source the renderer, the plan, the panel and the tests all read —
 * the same discipline `rack/slots.ts` enforces, and for the same reason: before
 * the rack had one, the plan and the model each computed their own frame
 * positions from the same inputs, which agrees right up until one of them is
 * edited.
 *
 * No Three.js, no host, no React. Everything here is a function of the node.
 */

// ── Plan dimensions ─────────────────────────────────────────────────────────

/**
 * Centre-to-centre distance between the lane's two upright frame lines — and,
 * because lanes share their frames, the spacing at which two lanes abut.
 *
 * One number doing both jobs is the point: a sibling laid down at exactly this
 * pitch lands its left frame line where its neighbour's right line would have
 * been, which is what lets the neighbour omit that line and the two show one
 * row of posts.
 */
export function lanePitch(lane: DriveInRackNode): number {
  return lane.laneClearWidth + lane.uprightWidth
}

/**
 * Outer width over the two upright faces — the lane with both its frame lines.
 *
 * Wider than `lanePitch` by one upright, which is the half-post each side a
 * neighbour would have shared. The **footprint is the pitch, not this**: the
 * selective rack documents the red-box bug that follows from confusing them.
 */
export function totalWidth(lane: DriveInRackNode): number {
  return lanePitch(lane) + lane.uprightWidth
}

/** `[across the lane, into the depth]` for the load as it is turned. */
export function orientedPalletFootprint(lane: DriveInRackNode): [number, number] {
  const spec = specOf(lane.palletPreset)
  const short = Math.min(spec.length, spec.width)
  const long = Math.max(spec.length, spec.width)
  return lane.palletOrientation === 'short-side-out' ? [short, long] : [long, short]
}

/** Depth consumed by one pallet position, load plus its clearance (p.19 fig.4). */
export function pitchZ(lane: DriveInRackNode): number {
  const [, intoDepth] = orientedPalletFootprint(lane)
  return intoDepth + lane.depthClearance
}

/** Lane depth: every position, back to back. */
export function totalDepth(lane: DriveInRackNode): number {
  return lane.palletsDeep * pitchZ(lane)
}

/** Local X of the two upright frame lines, left then right. */
export function frameCentersX(lane: DriveInRackNode): [number, number] {
  const half = lanePitch(lane) / 2
  return [-half, half]
}

/**
 * Post spacing into the depth — declared, or one post per pallet position.
 *
 * The derivation is an ASSUMPTION and the schema says so: the catalogue ties
 * frame depth to "aisle dimensions and pallet size" (p.17) without publishing a
 * table, and the p.16 render shows a post at each position.
 */
export function effectivePostPitchZ(lane: DriveInRackNode): number {
  return lane.postPitchZ ?? pitchZ(lane)
}

/**
 * Local Z of every post in one frame line, from the aisle face rearward.
 *
 * `palletsDeep + 1` posts, because a lane of four positions is closed by a post
 * at each end as well as between them — the same reason a fence of four panels
 * has five posts.
 */
export function postCentersZ(lane: DriveInRackNode): number[] {
  const pitch = effectivePostPitchZ(lane)
  const front = totalDepth(lane) / 2
  const count = Math.max(2, Math.round(totalDepth(lane) / pitch) + 1)
  return Array.from({ length: count }, (_, index) => front - index * pitch)
}

/** Local Z of a depth position's centre. Position 1 is the aisle face. */
export function slotZ(lane: DriveInRackNode, depth: number): number {
  return totalDepth(lane) / 2 - (depth - 0.5) * pitchZ(lane)
}

// ── Vertical stack ──────────────────────────────────────────────────────────

/** p.17. The rail's own section height — the pallet rests on its top face. */
export function railHeight(lane: DriveInRackNode): number {
  return RAIL_PROFILES[lane.railType].height
}

/**
 * Clear opening under level `index`, where 0 is the floor.
 *
 * The per-level override wins over the default, exactly as it does on the
 * selective rack — and exactly one function resolves it, which is what keeps
 * the geometry, the slots and the panel from disagreeing.
 */
export function clearOpening(lane: DriveInRackNode, index: number): number {
  return lane.levelClears?.[index] ?? lane.levelClear
}

/**
 * Height of rail level `k`'s top face, where the pallet sits. Level 0 is the
 * floor and returns 0.
 *
 * ## The derivation
 *
 * The catalogue publishes a *pitch* (p.19 fig.3 GP, p.21 fig.6 C):
 * F = unit load + 150 (GP) / + 300 (C), every step a multiple of 50 mm because
 * that is the upright's slot pitch. This package stores *clear openings*
 * instead, the way the selective rack does, so the two kinds read alike — and
 * the rail costs its own section on top of the opening:
 *
 *     pitch(i) = snapUpToSlot(clearOpening(i) + railHeight)
 *
 * Accumulated rather than multiplied, because the openings are per level: a
 * `first + (n−1) × step` formula puts every level above a customised one at the
 * wrong height, and does it silently.
 *
 * Worked check against the catalogue's own example (defaults, GP): the pitch is
 * 1.45 + 0.05 = 1.500 exactly, so rails land at 1.5 / 3.0 / 4.5 and the top
 * beam sits at 4.5 + 1.55 = 6.05 — the published H.
 */
export function railTopY(lane: DriveInRackNode, level: number): number {
  if (level <= 0) return 0
  const rail = railHeight(lane)
  let y = 0
  for (let index = 0; index < level; index++) {
    y += snapUpToSlot(clearOpening(lane, index) + rail)
  }
  return y
}

/**
 * Rail levels that actually fit inside `uprightHeight`.
 *
 * The schema lets `levels` be set independently of the height, so this is the
 * figure the geometry and the capacity count both use: asking for ten levels on
 * a 6 m post silently yields the number that fit rather than rails poking out
 * of the top of the frame. The panel reports the difference.
 */
export function fittedLevelCount(lane: DriveInRackNode): number {
  let fitted = 0
  for (let level = 1; level <= lane.levels; level++) {
    if (railTopY(lane, level) > lane.uprightHeight) break
    fitted++
  }
  return fitted
}

/** Underside of the top beam: the catalogue's G above the topmost rail. */
export function topBeamUndersideY(lane: DriveInRackNode): number {
  return railTopY(lane, fittedLevelCount(lane)) + snapUpToSlot(lane.topClear)
}

/** Storage levels the lane really has: the floor, then every fitted rail. */
export function storageLevels(lane: DriveInRackNode): number[] {
  return Array.from({ length: fittedLevelCount(lane) + 1 }, (_, index) => index)
}

// ── Slots ───────────────────────────────────────────────────────────────────

/**
 * Every pallet position in the lane.
 *
 * The address format is `rack/slots.ts`'s, UNCHANGED — `R1-B1-L{level}-P1-D{d}`.
 * Position P is always 1 because a lane is one pallet wide; depth D runs from
 * the aisle rearward. Sharing the format is not cosmetic: a `warehouse:pallet`
 * carries `slotAddress` as a string and `occupancy` matches on it, so a second
 * format would mean a pallet placed in a drive-in lane could never be found
 * again.
 *
 * `directAccess` is `depth === 1`, and that is a statement about geometry, not
 * about stock: in LIFO terms only the frontmost *occupied* position is
 * reachable, but which one that is belongs to occupancy, not here.
 */
export function palletSlotsOf(lane: DriveInRackNode): Slot[] {
  const [acrossLane, intoDepth] = orientedPalletFootprint(lane)
  const slots: Slot[] = []

  for (const level of storageLevels(lane)) {
    const surface = railTopY(lane, level)
    const clear =
      level === fittedLevelCount(lane)
        ? topBeamUndersideY(lane) - surface
        : railTopY(lane, level + 1) - railHeight(lane) - surface

    for (let depth = 1; depth <= lane.palletsDeep; depth++) {
      const address = { row: 1, bay: 1, level, position: 1, depth }
      slots.push({
        ...address,
        id: formatSlotAddress(address),
        localPosition: [0, surface, slotZ(lane, depth)],
        footprint: [acrossLane, intoDepth],
        clearHeight: clear,
        directAccess: depth === 1,
      })
    }
  }
  return slots
}

export function palletSlotCount(lane: DriveInRackNode): number {
  return palletSlotsOf(lane).length
}

/**
 * Positions a truck can reach without first moving another pallet.
 *
 * Reported beside the total because a drive-in block flatters itself worse than
 * any other kind: a four-deep lane advertises four positions per level and
 * offers one.
 */
export function directAccessSlotCount(lane: DriveInRackNode): number {
  return palletSlotsOf(lane).filter((slot) => slot.directAccess).length
}

// ── Report-only checks ──────────────────────────────────────────────────────

/**
 * How much rail each side of the pallet actually rests on.
 *
 * The figure the whole kind turns on, and the one a plausible-looking set of
 * numbers can quietly destroy: widen the lane without moving the rails and the
 * pallet ends up bridging a span it no longer reaches.
 */
export function railBearingEachSide(lane: DriveInRackNode): number {
  const [acrossLane] = orientedPalletFootprint(lane)
  const inset = railNoseInset(lane.railType, lane.laneClearWidth, acrossLane)
  const clearSpan = lane.laneClearWidth - 2 * inset
  return (acrossLane - clearSpan) / 2
}

export type BearingVerdict = 'ok' | 'in-motion-only' | 'insufficient'

/** p.18 fig.2 / p.10. 30 mm placed-and-displaced, 20 mm while still moving. */
export function bearingVerdict(lane: DriveInRackNode): BearingVerdict {
  const bearing = railBearingEachSide(lane)
  if (bearing >= BEARING_MIN_DISPLACED) return 'ok'
  if (bearing >= BEARING_MIN_IN_MOTION) return 'in-motion-only'
  return 'insufficient'
}

/** p.18. Side clearance below the catalogue minimum. */
export function sideClearanceTight(lane: DriveInRackNode): boolean {
  return lane.clearanceSide < SIDE_CLEARANCE_MIN - 1e-9
}

/** p.19 fig.4. Depth clearance below the catalogue minimum. */
export function depthClearanceTight(lane: DriveInRackNode): boolean {
  return lane.depthClearance < DEPTH_CLEARANCE_MIN - 1e-9
}

/**
 * p.8 fig.1. Bottom boards running along the rails instead of across them.
 *
 * An EPAL 1's three bottom boards run along its 1200 mm length. Turning that
 * length across the lane lays them over both rails; turning it into the depth
 * lays them parallel to the rails with nothing under the middle. Legal for a
 * rigid pallet, which is why this reports rather than forbids.
 */
export function boardsRunAlongRails(lane: DriveInRackNode): boolean {
  return lane.palletOrientation === 'short-side-out'
}

/** p.13. The one combination the catalogue rules out outright. */
export function bracingConflictsWithEntry(lane: DriveInRackNode): boolean {
  return lane.entryMode === 'drive-through' && lane.constructiveSystem === 'cs3'
}

/** p.24. Centralisers are a GP fitting; a C rail centres nothing to assist. */
export function centralisersUnavailable(lane: DriveInRackNode): boolean {
  return lane.centralisers && lane.railType !== 'gp'
}

/** p.19. Narrowest truck body the lane admits, and the lift its mast needs. */
export function forkliftEnvelope(lane: DriveInRackNode): {
  maxTruckWidth: number
  requiredLift: number
  guideGap: number | null
} {
  return {
    maxTruckWidth: lane.laneClearWidth - 2 * TRUCK_SIDE_CLEARANCE,
    requiredLift: railTopY(lane, fittedLevelCount(lane)) + MAST_CLEAR_ABOVE_TOP_RAIL,
    guideGap: lane.guideRails ? guideGapFor(lane.laneClearWidth) : null,
  }
}
