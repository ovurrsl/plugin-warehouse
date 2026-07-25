import { specOf } from '../pallet/presets'
import type { PalletRackNode } from './schema'

/**
 * Pure slot geometry for a pallet racking run.
 *
 * Everything the renderer draws, the capacity panel counts, and the floorplan
 * outlines is derived here, from the node alone. No Three.js, no scene reads,
 * no host imports — which is what makes it testable, and what stops the
 * reported capacity and the drawn pallets from ever disagreeing. The version
 * this replaces computed positions inline in the renderer with a hardcoded two
 * pallets per bay, so the figure a panel would have reported and the figure you
 * could count on screen were unrelated numbers.
 */

export type SlotAddress = {
  /** 1-based back-to-back side. Always present; a single run is row 1. */
  row: number
  /** 1-based along the run. */
  bay: number
  /** 0 is the floor inside the bay; 1..n are the beam levels. */
  level: number
  /** 1-based across the bay, left to right in the rack's local +X. */
  position: number
  /** 1-based into the bay from the aisle. 1 is the front, 2 the rear of a
   *  double-deep bay. */
  depth: number
}

export type Slot = SlotAddress & {
  id: string
  /** Centre of the pallet footprint in the rack's local frame, metres. */
  localPosition: [number, number, number]
  /** Footprint the slot accepts, `[x, z]` metres, already oriented. */
  footprint: [number, number]
  /** Clear height above the slot surface before the next beam. */
  clearHeight: number
  /**
   * Whether a truck can reach this pallet without first moving another.
   *
   * False only for the rear position of a double-deep bay. Worth carrying on
   * the slot rather than recomputing: "how many locations, and how many of them
   * directly accessible" is the pair of numbers that actually describes a
   * high-density layout, and reporting only the total flatters it.
   */
  directAccess: boolean
}

/**
 * `R1-B2-L3-P1-D1`.
 *
 * Every component is always written, including the ones that are constant in a
 * simple rack. That is deliberate: a single run is row 1, a single-deep bay is
 * depth 1, so turning on `backToBack` or `depthPositions` cannot change what an
 * already-stored address means. Omitting the constant parts would save a few
 * characters and silently re-point every pallet in the scene the first time
 * somebody widened a rack.
 */
export function formatSlotAddress({ row, bay, level, position, depth }: SlotAddress): string {
  return `R${row}-B${bay}-L${level}-P${position}-D${depth}`
}

const ADDRESS_PATTERN = /^R(\d+)-B(\d+)-L(\d+)-P(\d+)-D(\d+)$/

export function parseSlotAddress(address: string): SlotAddress | null {
  const match = ADDRESS_PATTERN.exec(address)
  if (!match) return null
  const [, row, bay, level, position, depth] = match
  if (!row || !bay || !level || !position || !depth) return null
  return {
    row: Number(row),
    bay: Number(bay),
    level: Number(level),
    position: Number(position),
    depth: Number(depth),
  }
}

// ── Run geometry ────────────────────────────────────────────────────────────

/** Centre-to-centre distance between adjacent upright frames. */
export function bayPitch(rack: PalletRackNode): number {
  return rack.bayClearWidth + rack.uprightWidth
}

/** Outer width of the run, over the outermost upright faces. */
export function totalWidth(rack: PalletRackNode): number {
  return rack.bayCount * bayPitch(rack) + rack.uprightWidth
}

/** Depth of one run, including its rear position when double-deep. */
export function rowDepth(rack: PalletRackNode): number {
  return rack.depthPositions * rack.depth + (rack.depthPositions - 1) * rack.depthGap
}

/** Outer depth, counting the second run and the gap when back to back. */
export function totalDepth(rack: PalletRackNode): number {
  const single = rowDepth(rack)
  return rack.backToBack ? 2 * single + rack.backToBackGap : single
}

export function rowCount(rack: PalletRackNode): number {
  return rack.backToBack ? 2 : 1
}

/** Local Z of a row's centreline. Row 1 sits on +Z, row 2 on −Z. */
export function rowCenterZ(rack: PalletRackNode, row: number): number {
  if (!rack.backToBack) return 0
  const offset = (rowDepth(rack) + rack.backToBackGap) / 2
  return row === 1 ? offset : -offset
}

/**
 * Local Z of a depth position's centre.
 *
 * Depth 1 is the aisle side, and each row faces its own aisle: row 1 opens onto
 * +Z, row 2 onto −Z. Numbering both rows from their own aisle rather than from
 * a global axis is what makes "D1 is the one you can reach" true on both sides
 * of a back-to-back island.
 */
export function depthPositionZ(rack: PalletRackNode, row: number, depth: number): number {
  const centre = rowCenterZ(rack, row)
  const fromAisle = (depth - 0.5) * rack.depth + (depth - 1) * rack.depthGap
  const outward = rowDepth(rack) / 2 - fromAisle
  return row === 1 ? centre + outward : centre - outward
}

/** Local X of every upright frame centreline, left to right. */
export function frameCentersX(rack: PalletRackNode): number[] {
  const pitch = bayPitch(rack)
  const start = -totalWidth(rack) / 2 + rack.uprightWidth / 2
  return Array.from({ length: rack.bayCount + 1 }, (_, index) => start + index * pitch)
}

/** Local X of a bay's centre. `bay` is 1-based. */
export function bayCenterX(rack: PalletRackNode, bay: number): number {
  const pitch = bayPitch(rack)
  return -totalWidth(rack) / 2 + rack.uprightWidth / 2 + (bay - 1) * pitch + pitch / 2
}

// ── Levels ──────────────────────────────────────────────────────────────────

/**
 * Beam levels that actually fit inside `uprightHeight`.
 *
 * The schema lets `levels` be set independently of the height, so this is the
 * value the geometry and the capacity count both use. Asking for ten levels on
 * a 5 m upright silently yields the number that fit rather than beams poking
 * out of the top of the frame.
 */
export function fittedLevelCount(rack: PalletRackNode): number {
  const step = rack.levelClear + rack.beamHeight
  let fitted = 0
  for (let level = 1; level <= rack.levels; level++) {
    const top = rack.firstLevelClear + rack.beamHeight + (level - 1) * step
    if (top > rack.uprightHeight) break
    fitted++
  }
  return fitted
}

/**
 * Surface height goods rest on for a storage level. Level 0 is the floor.
 * Levels are 1-based above that and return the top of the beam pair.
 */
export function levelSurfaceY(rack: PalletRackNode, level: number): number {
  if (level <= 0) return 0
  const step = rack.levelClear + rack.beamHeight
  return rack.firstLevelClear + rack.beamHeight + (level - 1) * step
}

/** Underside of a beam level, which is where its clear opening starts. */
export function beamUndersideY(rack: PalletRackNode, level: number): number {
  return levelSurfaceY(rack, level) - rack.beamHeight
}

/** Storage levels present, floor first when it is enabled. */
export function storageLevels(rack: PalletRackNode): number[] {
  const beams = Array.from({ length: fittedLevelCount(rack) }, (_, index) => index + 1)
  return rack.groundLevelStorage ? [0, ...beams] : beams
}

/**
 * Usable height above a storage level before the next obstruction.
 *
 * The topmost level is bounded by the upright rather than by a beam, which is
 * the case that decides whether a tall unit load fits on the top position.
 */
export function levelClearHeight(rack: PalletRackNode, level: number): number {
  const fitted = fittedLevelCount(rack)
  const surface = levelSurfaceY(rack, level)
  if (level >= fitted) return Math.max(0, rack.uprightHeight - surface)
  return Math.max(0, beamUndersideY(rack, level + 1) - surface)
}

// ── Pallet fit ──────────────────────────────────────────────────────────────

/**
 * Pallet footprint as the rack sees it, `[alongRun, intoDepth]`.
 *
 * Derived from min/max rather than from the preset's `length` / `width` names,
 * because those are not consistently ordered across standards — EPAL 3 is
 * 1.0 × 1.2, the other way round from EPAL 1. Using the names directly would
 * silently turn one preset's orientation inside out.
 */
export function orientedPalletFootprint(rack: PalletRackNode): [number, number] {
  const spec = specOf(rack.palletPreset)
  const short = Math.min(spec.length, spec.width)
  const long = Math.max(spec.length, spec.width)
  return rack.palletOrientation === 'short-side-out' ? [short, long] : [long, short]
}

/** How many pallets the clear width fits at the declared clearances. */
export function autoPalletsPerLevel(rack: PalletRackNode): number {
  const [alongRun] = orientedPalletFootprint(rack)
  const { bayClearWidth, clearanceToUpright: toUpright, clearanceBetweenPallets: between } = rack
  const usable = bayClearWidth - 2 * toUpright + between
  const step = alongRun + between
  if (step <= 0) return 0
  // The canonical bay divides exactly — 2.625 / 0.875 is 3 — and binary
  // floating point lands that quotient a hair either side of the integer
  // depending on the operand order. Without the epsilon a bay that fits three
  // pallets on paper reports two, and the error is invisible because every
  // figure downstream stays self-consistent.
  return Math.max(0, Math.floor(usable / step + 1e-9))
}

/** Declared count when the override is set, otherwise the geometric fit. */
export function palletsPerLevel(rack: PalletRackNode): number {
  return rack.palletsPerLevel ?? autoPalletsPerLevel(rack)
}

/**
 * Slot centres across a bay, local X relative to the bay centre.
 *
 * Leftover width is distributed back into the clearances in proportion, so a
 * bay never renders its pallets bunched to one side with a visible gap at the
 * end. Straight from the rack spec's clearance-scaling rule.
 */
export function slotOffsetsX(rack: PalletRackNode): number[] {
  const count = palletsPerLevel(rack)
  if (count <= 0) return []
  const [alongRun] = orientedPalletFootprint(rack)
  const { bayClearWidth, clearanceToUpright: toUpright, clearanceBetweenPallets: between } = rack

  const minClearance = 2 * toUpright + (count - 1) * between
  const leftover = bayClearWidth - count * alongRun
  // A manual override can ask for more pallets than fit; keep the declared
  // count and let them touch rather than scaling the clearance negative, which
  // would mirror the row about the bay centre.
  const scale = minClearance > 0 ? Math.max(0, leftover / minClearance) : 0
  const actualToUpright = toUpright * scale
  const actualBetween = between * scale

  const start = -bayClearWidth / 2 + actualToUpright + alongRun / 2
  return Array.from({ length: count }, (_, index) => start + index * (alongRun + actualBetween))
}

// ── Slot enumeration ────────────────────────────────────────────────────────

/** Every storage position in the run, in a stable order. */
export function slotsOf(rack: PalletRackNode): Slot[] {
  const offsets = slotOffsetsX(rack)
  const levels = storageLevels(rack)
  const footprint = orientedPalletFootprint(rack)
  const slots: Slot[] = []

  for (let row = 1; row <= rowCount(rack); row++) {
    for (let bay = 1; bay <= rack.bayCount; bay++) {
      const centreX = bayCenterX(rack, bay)
      for (const level of levels) {
        const y = levelSurfaceY(rack, level)
        const clearHeight = levelClearHeight(rack, level)
        for (let depth = 1; depth <= rack.depthPositions; depth++) {
          const z = depthPositionZ(rack, row, depth)
          offsets.forEach((offset, index) => {
            const address = { row, bay, level, position: index + 1, depth }
            slots.push({
              ...address,
              id: formatSlotAddress(address),
              localPosition: [centreX + offset, y, z],
              footprint,
              clearHeight,
              directAccess: depth === 1,
            })
          })
        }
      }
    }
  }
  return slots
}

/** Total storage positions — the denominator of every occupancy figure. */
export function slotCount(rack: PalletRackNode): number {
  return (
    rowCount(rack) *
    rack.bayCount *
    storageLevels(rack).length *
    palletsPerLevel(rack) *
    rack.depthPositions
  )
}

/**
 * Positions a truck can reach without relocating another pallet.
 *
 * Reported alongside the total because a double-deep layout buys capacity by
 * spending accessibility, and a single "locations" figure hides the trade
 * entirely.
 */
export function directAccessSlotCount(rack: PalletRackNode): number {
  return slotCount(rack) / rack.depthPositions
}

// ── Pallet support bars ─────────────────────────────────────────────────────

/**
 * Whether the pallets need bars under them to sit safely on the beams.
 *
 * A Euro pallet's three bottom deckboards run along its 1200 mm length. Stored
 * narrow-side-out those boards cross the beams and carry the load. Turned
 * long-side-out they lie *along* the beams, so the pallet is supported only at
 * its two outer boards with nothing under the middle — which is why the
 * catalogue makes support bars a requirement for that orientation rather than
 * an accessory.
 */
export function requiresPalletSupportBars(rack: PalletRackNode): boolean {
  return rack.palletOrientation === 'long-side-out'
}

/** Bars per pallet when the schema leaves it to be derived. */
export function autoPalletSupportBars(rack: PalletRackNode): number {
  return requiresPalletSupportBars(rack) ? 2 : 0
}

/** Declared bar count when set, otherwise the derived one. */
export function palletSupportBarCount(rack: PalletRackNode): number {
  return rack.palletSupportBars ?? autoPalletSupportBars(rack)
}

/**
 * A rack turned long-side-out with the bars explicitly removed. Surfaced rather
 * than silently corrected: the user may be modelling a rack that really is
 * built that way, but nothing should report it as a sound configuration.
 */
export function hasUnsupportedPallets(rack: PalletRackNode): boolean {
  return requiresPalletSupportBars(rack) && palletSupportBarCount(rack) === 0
}

export function slotById(rack: PalletRackNode, address: string): Slot | null {
  return slotsOf(rack).find((slot) => slot.id === address) ?? null
}
