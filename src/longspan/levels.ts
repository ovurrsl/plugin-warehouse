import type { LongspanLevel, LongspanNode } from './schema'
import {
  BEAM_PROFILES,
  FRONT_SLOT_PITCH,
  MS_CENTRE_MIN_DEPTH_RATIO,
  needsZtamClamp,
  SHELF_KINDS,
  SIDE_SLOT_PITCH,
  snapToSlot,
  UPRIGHT_PROFILES,
} from './standards'

/**
 * Pure derived geometry for one M7 Longspan bay.
 *
 * The single source the renderer, the plan, the panel and the tests read. No
 * Three.js, no host, no React.
 */

// ── Plan dimensions ─────────────────────────────────────────────────────────

export function uprightSection(bay: LongspanNode) {
  return UPRIGHT_PROFILES[bay.uprightProfile]
}

/**
 * Centre-to-centre distance between the bay's two frames — and, because bays
 * share frames, the spacing at which two bays abut.
 *
 * N bays stand on N+1 frames (CATALOG, and confirmed by resellers). One number
 * does both jobs so a sibling laid at this pitch lands its left frame exactly
 * where its neighbour's right frame would have been.
 */
export function bayPitch(bay: LongspanNode): number {
  return bay.bayLength + uprightSection(bay).width
}

/** Outer width over both frame faces. The footprint is the PITCH, not this. */
export function totalWidth(bay: LongspanNode): number {
  return bayPitch(bay) + uprightSection(bay).width
}

export function totalDepth(bay: LongspanNode): number {
  return bay.frameDepth
}

/** Local X of the two frame centrelines, left then right. */
export function frameCentersX(bay: LongspanNode): [number, number] {
  const half = bayPitch(bay) / 2
  return [-half, half]
}

// ── Levels ──────────────────────────────────────────────────────────────────

/**
 * Which slot pitch actually carries this level.
 *
 * The frame is punched on two faces at two pitches: the front at 50 mm for
 * beams, the side at 25 mm for HM supports. A reinforced HM shelf hangs off the
 * side slots and therefore lands on the 25 mm grid; everything else rides beams
 * on the 50 mm grid.
 *
 * Getting this wrong is not a rounding error — it puts an HM shelf at a height
 * where the upright has no hole.
 */
export function slotPitchFor(level: LongspanLevel): number {
  return level.structure === 'reinforced-hm' ? SIDE_SLOT_PITCH : FRONT_SLOT_PITCH
}

/** The level's load surface, snapped onto the face that carries it. */
export function levelElevation(level: LongspanLevel): number {
  return snapToSlot(level.elevation, slotPitchFor(level))
}

/**
 * Levels the frame actually carries, bottom to top.
 *
 * Sorted here rather than trusted from the array: the panel lets a user retype
 * an elevation, and a level that ends up below the one before it must still
 * draw in the right place — and, more to the point, the clear-height figure the
 * panel reports is the distance to the *next* level, which is meaningless if
 * the list is out of order.
 *
 * A level above the frame is dropped, the same way the selective rack drops a
 * beam level that does not fit, and the panel reports the difference.
 */
export function fittedLevels(bay: LongspanNode): LongspanLevel[] {
  return bay.levels
    .filter((level) => levelElevation(level) <= bay.frameHeight + 1e-9)
    .slice()
    .sort((a, b) => levelElevation(a) - levelElevation(b))
}

export function droppedLevelCount(bay: LongspanNode): number {
  return bay.levels.length - fittedLevels(bay).length
}

/**
 * Clear height above a level's surface, before the next level's lowest steel.
 *
 * The topmost level is bounded by the frame, not by a level above it — which is
 * the figure that decides whether a tall carton fits on the top shelf, and the
 * one a "distance between levels" reading would get wrong.
 */
export function clearAbove(bay: LongspanNode, index: number): number {
  const levels = fittedLevels(bay)
  const here = levels[index]
  if (!here) return 0
  const next = levels[index + 1]
  if (!next) return Math.max(0, bay.frameHeight - levelElevation(here))
  // The next level's steel starts below its load surface: a beam level by its
  // profile height, an HM shelf by the panel it hangs on.
  return Math.max(0, levelElevation(next) - lowestSteelOffset(bay, next) - levelElevation(here))
}

/** How far below a level's load surface its own steel reaches. */
export function lowestSteelOffset(bay: LongspanNode, level: LongspanLevel): number {
  if (level.structure === 'reinforced-hm') return SHELF_KINDS.hm.thickness
  const beam = BEAM_PROFILES[bay.beamProfile]
  if (level.structure === 'beam-only' || level.structure === 'hanging') return beam.height
  return beam.height + SHELF_KINDS[level.shelfKind].thickness
}

// ── Beams and shelves ───────────────────────────────────────────────────────

/**
 * Local Z of every beam run on a level.
 *
 * Two at the frame faces normally. A **double-depth chipboard** level adds a
 * third down the centre — the catalogue's MS-65, whose flat top is what lets
 * the two boards butt over it. "Double depth" is read from the geometry rather
 * than from a field: a bay twice as deep as it is long is what the rule
 * describes, and storing a flag would let the two disagree.
 */
export function beamOffsetsZ(bay: LongspanNode, level: LongspanLevel): number[] {
  const beam = BEAM_PROFILES[bay.beamProfile]
  const half = bay.frameDepth / 2 - beam.depth / 2
  if (!usesMsCentreBeam(bay, level)) return [-half, half]
  return [-half, 0, half]
}

export function usesMsCentreBeam(bay: LongspanNode, level: LongspanLevel): boolean {
  if (level.structure !== 'beam-shelf' || level.shelfKind !== 'chipboard') return false
  return bay.frameDepth >= bay.bayLength / MS_CENTRE_MIN_DEPTH_RATIO
}

/** CATALOG. Whether this level's chipboard needs the Z-TAM clamps. */
export function levelNeedsZtam(bay: LongspanNode, level: LongspanLevel): boolean {
  if (level.structure !== 'beam-shelf') return false
  return needsZtamClamp(level.shelfKind, bay.bayLength)
}

/** Panel widths across the bay, left to right. Equal shares of the clear
 *  length — a picking level carries several modules, a chipboard level one. */
export function panelWidths(bay: LongspanNode, level: LongspanLevel): number[] {
  const count = Math.max(1, level.panels)
  const each = bay.bayLength / count
  return Array.from({ length: count }, () => each)
}

// ── Capacity ────────────────────────────────────────────────────────────────

/** Shelf area a bay offers, m². The figure a picking installation is sized by. */
export function shelfAreaM2(bay: LongspanNode): number {
  let area = 0
  for (const level of fittedLevels(bay)) {
    if (level.structure === 'beam-only' || level.structure === 'hanging') continue
    area += bay.bayLength * bay.frameDepth
  }
  return area
}

/** Linear metres of hanging rail, for the garment levels. */
export function hangingLengthM(bay: LongspanNode): number {
  return fittedLevels(bay).filter((level) => level.structure === 'hanging').length * bay.bayLength
}

// ── Report-only checks ──────────────────────────────────────────────────────

/** An HM shelf's own length series is narrower than the frame's. */
export function hmLengthUnpublished(bay: LongspanNode): boolean {
  const hasHm = bay.levels.some((level) => level.structure === 'reinforced-hm')
  if (!hasHm) return false
  return !([1, 1.25, 1.4] as const).some((length) => Math.abs(length - bay.bayLength) < 1e-6)
}

/** Two levels on the same slot — a typo the panel cannot otherwise show. */
export function collidingLevels(bay: LongspanNode): number[] {
  const seen = new Map<number, number>()
  const clashes: number[] = []
  bay.levels.forEach((level, index) => {
    const key = Math.round(levelElevation(level) * 1000)
    const first = seen.get(key)
    if (first !== undefined) clashes.push(index)
    else seen.set(key, index)
  })
  return clashes
}

/**
 * CATALOG. Tall HM units need down-aisle cross-bracing.
 *
 * Reported rather than forced: the threshold is a stability calculation the
 * catalogue does not publish, so this names the condition and leaves the call
 * to the user — the same treatment every unpublished figure in this package
 * gets.
 */
export function crossBracingAdvised(bay: LongspanNode): boolean {
  if (bay.crossBracing) return false
  const hasHm = bay.levels.some((level) => level.structure === 'reinforced-hm')
  return hasHm && bay.frameHeight >= 3
}
