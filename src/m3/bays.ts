import type { M3Level, M3ShelvingNode } from './schema'
import {
  CROSS_BRACE_ONE_SET_MAX,
  CROSS_BRACE_SECTION,
  CROSS_TIES_MIN,
  DIVIDER_MAX_DEPTH,
  DOOR_BAY_LENGTH,
  dividerHeightFor,
  MAX_FRAME_HEIGHT,
  SHELF_DEPTHS,
  SHELF_MODELS,
  snapToSlot,
  THIRD_CROSS_TIE_ABOVE,
  UPRIGHT_DEPTH,
  UPRIGHT_FRONT_FACE,
} from './standards'

/**
 * Pure derived geometry and figures for one M3 bay.
 *
 * The single source the renderer, the plan, the panel and the tests read. No
 * Three.js, no host, no React.
 */

// ── Plan dimensions ─────────────────────────────────────────────────────────

/** One section for every M3 upright. The catalogue names two upright types
 *  (6 or 12 folds) and publishes a section for neither, so there is nothing to
 *  choose between — see `standards.UPRIGHT_DEPTH`. */
export const UPRIGHT_SECTION = { width: UPRIGHT_FRONT_FACE, depth: UPRIGHT_DEPTH } as const

/**
 * Centre-to-centre distance between the bay's two frames — and, because bays
 * share frames, the spacing at which two bays abut.
 *
 * N bays stand on N+1 frames. One number does both jobs so a sibling laid at
 * this pitch lands its left frame exactly where its neighbour's right frame
 * would have been. **The footprint is this, not `totalWidth`** — the fourth
 * time this package states it, and the reason is the same every time: a
 * footprint one upright too wide makes two abutting bays a hard conflict and
 * swallows the click that places the second.
 */
export function bayPitch(bay: M3ShelvingNode): number {
  return bay.shelfLength + UPRIGHT_SECTION.width
}

/** Outer width over both frame faces. */
export function totalWidth(bay: M3ShelvingNode): number {
  return bayPitch(bay) + UPRIGHT_SECTION.width
}

export function totalDepth(bay: M3ShelvingNode): number {
  // Koridor çaprazı arka dikmelerin ARKA yüzüne cıvatalanıyor, yani rafın
  // derinlik ayak izinin dışında duruyor. Zarf onu saymazsa çapraz görünür
  // ama tıklanamaz ve komşusuyla çakıştığı görülmez — tam olarak bu paketin
  // öteki kind'larında düzeltilen sınıf.
  return bay.shelfDepth + (crossBraceSets(bay) > 0 ? CROSS_BRACE_SECTION : 0)
}

/** Local X of the two frame centrelines, left then right. */
export function frameCentersX(bay: M3ShelvingNode): [number, number] {
  const half = bayPitch(bay) / 2
  return [-half, half]
}

// ── Levels ──────────────────────────────────────────────────────────────────

/**
 * The level's load surface, on the 25 mm grid.
 *
 * One pitch for the whole system: an M3 shelf hangs off the upright's side
 * slots and there is no beam face to carry a second rule.
 */
export function levelElevation(level: M3Level): number {
  return snapToSlot(level.elevation)
}

/**
 * Levels the frame actually carries, bottom to top.
 *
 * Sorted here rather than trusted from the array: the panel lets a user retype
 * an elevation, and the clear-height figure is the distance to the *next*
 * level, which is meaningless if the list is out of order.
 */
export function fittedLevels(bay: M3ShelvingNode): M3Level[] {
  return bay.levels
    .filter((level) => levelElevation(level) <= bay.frameHeight + 1e-9)
    .slice()
    .sort((a, b) => levelElevation(a) - levelElevation(b))
}

export function droppedLevelCount(bay: M3ShelvingNode): number {
  return bay.levels.length - fittedLevels(bay).length
}

/** How far below its load surface a level's own steel reaches. Just the panel:
 *  the corner bracket's vertical leg rises into the slots and its horizontal
 *  leg sits inside the panel band, so nothing hangs below. */
export function lowestSteelOffset(level: M3Level): number {
  return SHELF_MODELS[level.model].thickness
}

/**
 * Clear height above a level's surface, before the next level's panel.
 *
 * The topmost level is bounded by the frame rather than by a level above it —
 * the figure that decides whether a tall carton fits on the top shelf, and the
 * one a plain "distance between levels" reading gets wrong.
 */
export function clearAbove(bay: M3ShelvingNode, index: number): number {
  const levels = fittedLevels(bay)
  const here = levels[index]
  if (!here) return 0
  const next = levels[index + 1]
  if (!next) return Math.max(0, bay.frameHeight - levelElevation(here))
  return Math.max(0, levelElevation(next) - lowestSteelOffset(next) - levelElevation(here))
}

/** Two levels on the same slot — a typo the panel cannot otherwise show,
 *  because 1.00 and 1.01 read as different numbers and land on one slot. */
export function collidingLevels(bay: M3ShelvingNode): number[] {
  const seen = new Set<number>()
  const clashes: number[] = []
  bay.levels.forEach((level, index) => {
    const key = Math.round(levelElevation(level) * 1000)
    if (seen.has(key)) clashes.push(index)
    else seen.add(key)
  })
  return clashes
}

// ── Bracing ─────────────────────────────────────────────────────────────────

/**
 * CATALOG. How many cross-brace sets the bay takes.
 *
 * "just one cross-brace … units of up to 2,5 m … two are used for higher
 * units", and a back panel replaces bracing altogether.
 *
 * Derived, never stored. A stored count is a number that can disagree with the
 * height and the panel that decide it, and the whole content of the rule is
 * that those two decide it.
 */
export function crossBraceSets(bay: M3ShelvingNode): 0 | 1 | 2 {
  if (bay.backPanel !== 'none') return 0
  return bay.frameHeight <= CROSS_BRACE_ONE_SET_MAX + 1e-9 ? 1 : 2
}

/** CATALOG: "the minimum number used is two". A taller frame takes a third at
 *  mid-height — the threshold is ours, the floor of two is printed. */
export function crossTieCount(bay: M3ShelvingNode): number {
  return bay.frameHeight > THIRD_CROSS_TIE_ABOVE ? CROSS_TIES_MIN + 1 : CROSS_TIES_MIN
}

// ── Drawers ─────────────────────────────────────────────────────────────────

/** CATALOG. The two published drawer widths, metres. */
export function drawerWidthM(level: M3Level): number {
  return level.drawerWidth === 'wide' ? 0.246 : 0.122
}

/** CATALOG. MA is 130 mm tall, MB 80 mm. */
export function drawerHeightM(level: M3Level): number {
  return level.drawerModel === 'MA' ? 0.13 : 0.08
}

/**
 * CATALOG. How many drawers a level holds.
 *
 * The catalogue publishes two rows — a 1,000 mm level takes 4 wide or 8 narrow,
 * a 1,250 mm level 5 or 10 — and **both are exactly `floor(length / width)`**.
 * That is worth deriving rather than tabulating: the same division answers for
 * the 750 and 1,400 mm lengths, which the catalogue leaves out, and for a bay
 * cut to fit a wall, which it could not have listed. `bays.test.ts` pins the
 * derivation against both published rows so a change that breaks them fails.
 */
export function drawerCount(bay: M3ShelvingNode, level: M3Level): number {
  return Math.max(0, Math.floor(bay.shelfLength / drawerWidthM(level) + 1e-9))
}

/** Drawer depth follows the shelf, less a little for the runners. */
export function drawerDepthM(bay: M3ShelvingNode): number {
  return Math.max(0.1, bay.shelfDepth - 0.03)
}

// ── Dividers ────────────────────────────────────────────────────────────────

/**
 * The divider height on a level, or `null` when nothing published fits.
 *
 * Derived from the clear opening rather than stored: a user who lowers the
 * shelf above must not be left with a divider taller than the gap, and only
 * the catalogue series is orderable.
 */
export function dividerHeightAt(bay: M3ShelvingNode, index: number): number | null {
  const level = fittedLevels(bay)[index]
  if (level?.structure !== 'shelf' || level.dividers <= 0) return null
  return dividerHeightFor(clearAbove(bay, index))
}

/** CATALOG. The divider series stops at 500 mm deep, so a 600 mm shelf carries
 *  the 500 and leaves the back 100 mm open. Reported, not corrected. */
export function dividerDepth(bay: M3ShelvingNode): number {
  return Math.min(bay.shelfDepth, DIVIDER_MAX_DEPTH)
}

// ── Capacity ────────────────────────────────────────────────────────────────

/**
 * CATALOG. Load per level, kilograms.
 *
 * **This is a published number**, and the only one of its kind in this package:
 * Mecalux states 150 kg for a light-duty shelf and 275 kg for a heavy-duty one.
 * The other racking kinds here report a capacity that was chosen because no
 * catalogue in the set publishes a load table — the panel says which is which
 * rather than letting the two look alike.
 */
export function levelLoadKg(level: M3Level): number {
  return SHELF_MODELS[level.model].loadKg
}

/** Rated load for the whole bay — the sum over the levels that fit. */
export function bayLoadKg(bay: M3ShelvingNode): number {
  return fittedLevels(bay).reduce((total, level) => total + levelLoadKg(level), 0)
}

/** Shelf area the bay offers, m². The figure a picking installation is sized
 *  by. A drawer level counts: its panel is still a shelf. */
export function shelfAreaM2(bay: M3ShelvingNode): number {
  return fittedLevels(bay).length * bay.shelfLength * bay.shelfDepth
}

// ── Report-only checks ──────────────────────────────────────────────────────

/**
 * CATALOG. A door exists only for the 1,000 mm bay.
 *
 * Reported rather than enforced, and deliberately: the user picked the door on
 * purpose, and silently dropping it would leave them believing they had one.
 * The panel names the length the door needs.
 */
export function doorLengthMismatch(bay: M3ShelvingNode): boolean {
  return bay.door !== 'none' && Math.abs(bay.shelfLength - DOOR_BAY_LENGTH) > 1e-9
}

/** The door's own height, metres, or `null` when there is no door. */
export function doorHeight(bay: M3ShelvingNode): number | null {
  if (bay.door === 'none') return null
  return bay.door === 'h1000' ? 1 : 2
}

/** CATALOG. A door taller than the frame it hangs on. */
export function doorTallerThanFrame(bay: M3ShelvingNode): boolean {
  const height = doorHeight(bay)
  return height !== null && height > bay.frameHeight + 1e-9
}

/** CATALOG. Above 8 m the upright is spliced from two — a different bill of
 *  materials, so the panel names it rather than drawing a taller single post
 *  and saying nothing. */
export function spliceRequired(bay: M3ShelvingNode): boolean {
  return bay.frameHeight > MAX_FRAME_HEIGHT + 1e-9
}

export function depthPublished(bay: M3ShelvingNode): boolean {
  return SHELF_DEPTHS.some((depth) => Math.abs(depth - bay.shelfDepth) < 1e-9)
}
