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
  /** 1-based run within the block, counting from the +Z side. A lone run is
   *  row 1. */
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
 * depth 1, so raising `rowCount` or `depthPositions` cannot change what an
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

/**
 * Clear space in front of a row, between it and the row before it.
 *
 * Zero for row 1, which has nothing in front of it inside the block. A
 * back-to-back pattern pairs the rows — (1,2), (3,4), … — so an even row closes
 * a pair and stands against its partner across the spine gap, while an odd row
 * opens the next pair across a working aisle. That alternation is the whole
 * layout: pair, aisle, pair, aisle.
 */
export function rowGapBefore(rack: PalletRackNode, row: number): number {
  if (row <= 1) return 0
  if (rack.rowPattern === 'back-to-back' && row % 2 === 0) return rack.backToBackGap
  return rack.aisleWidth
}

/** Outer depth of the block, over every row and the gaps between them. */
export function totalDepth(rack: PalletRackNode): number {
  let total = rack.rowCount * rowDepth(rack)
  for (let row = 2; row <= rack.rowCount; row++) total += rowGapBefore(rack, row)
  return total
}

/** Local Z of a row's centreline. Row 1 is the +Z-most; rows count toward −Z. */
export function rowCenterZ(rack: PalletRackNode, row: number): number {
  const single = rowDepth(rack)
  let z = totalDepth(rack) / 2
  for (let index = 1; index <= row; index++) {
    z -= rowGapBefore(rack, index)
    if (index === row) return z - single / 2
    z -= single
  }
  return 0
}

/**
 * Which way a row's aisle face looks: +1 toward +Z, −1 toward −Z.
 *
 * In a back-to-back pair the two rows turn their backs on each other and open
 * onto the aisles either side, so odd rows face +Z and even rows face −Z. Under
 * the `aisle` pattern every row has its own aisle in front of it and they all
 * face the same way.
 */
export function rowFacing(rack: PalletRackNode, row: number): 1 | -1 {
  if (rack.rowPattern !== 'back-to-back') return 1
  return row % 2 === 1 ? 1 : -1
}

/**
 * Local Z of a depth position's centre.
 *
 * Depth 1 is the aisle side of whichever row it belongs to. Numbering every row
 * from its own aisle rather than from a global axis is what makes "D1 is the one
 * you can reach" true on both sides of every pair in the block.
 */
export function depthPositionZ(rack: PalletRackNode, row: number, depth: number): number {
  const centre = rowCenterZ(rack, row)
  const fromAisle = (depth - 0.5) * rack.depth + (depth - 1) * rack.depthGap
  const outward = rowDepth(rack) / 2 - fromAisle
  return centre + rowFacing(rack, row) * outward
}

/**
 * Offset from the block's anchor point to its centre, in the rack's local frame.
 *
 * The block is always centred on the node position, because that is what the
 * host's footprint contract means: `spatial-grid-manager` and the alignment
 * anchor bridge both read `floorPlaced.footprint` as a rectangle centred on the
 * node, and the bridge ignores the optional `position` field entirely — an
 * off-centre block would collide and align against a rectangle it does not
 * occupy. So anchoring moves the node rather than the geometry, and this is the
 * vector between the two.
 */
export function anchorOffset(rack: PalletRackNode): [number, number] {
  const halfWidth = totalWidth(rack) / 2
  const halfDepth = totalDepth(rack) / 2
  const dx = rack.bayAnchor === 'left' ? halfWidth : rack.bayAnchor === 'right' ? -halfWidth : 0
  const dz = rack.rowAnchor === 'front' ? -halfDepth : rack.rowAnchor === 'back' ? halfDepth : 0
  return [dx, dz]
}

/** Where the block's centre lands when its anchor point sits at `(x, z)`. */
export function centerFromAnchor(
  rack: PalletRackNode,
  x: number,
  z: number,
  rotationY: number,
): [number, number] {
  const [dx, dz] = anchorOffset(rack)
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  return [x + dx * cos + dz * sin, z - dx * sin + dz * cos]
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

// ── Bays ────────────────────────────────────────────────────────────────────

export type BayOverride = NonNullable<PalletRackNode['bayOverrides'][string]>

/** `R1-B3`. Same form the slot addresses use, so a bay key and a slot address
 *  name the same bay and both survive a change to the row count. */
export function formatBayAddress(row: number, bay: number): string {
  return `R${row}-B${bay}`
}

const BAY_ADDRESS = /^R(\d+)-B(\d+)$/

export function parseBayAddress(address: string): { row: number; bay: number } | null {
  const match = BAY_ADDRESS.exec(address)
  if (!match) return null
  const [, row, bay] = match
  if (!row || !bay) return null
  return { row: Number(row), bay: Number(bay) }
}

export function bayOverrideOf(rack: PalletRackNode, row: number, bay: number): BayOverride {
  return rack.bayOverrides[formatBayAddress(row, bay)] ?? {}
}

/** A skipped bay is a deliberate gap — for a column, a doorway — so the run
 *  keeps its length and only this bay's contents are omitted. */
export function isBaySkipped(rack: PalletRackNode, row: number, bay: number): boolean {
  return bayOverrideOf(rack, row, bay).skipped === true
}

/** Lowest levels of a bay left open as a walkway. The frames stay: they carry
 *  the levels above. */
export function bayTunnelLevels(rack: PalletRackNode, row: number, bay: number): number {
  return Math.max(0, bayOverrideOf(rack, row, bay).tunnelLevels ?? 0)
}

/** Beam levels present in a bay, never more than the run's own fitted count. */
export function bayLevelCount(rack: PalletRackNode, row: number, bay: number): number {
  const override = bayOverrideOf(rack, row, bay).levels
  const fitted = fittedLevelCount(rack)
  return override === undefined ? fitted : Math.max(0, Math.min(fitted, override))
}

/** Storage levels actually present in a bay, floor first when enabled. */
export function bayStorageLevels(rack: PalletRackNode, row: number, bay: number): number[] {
  if (isBaySkipped(rack, row, bay)) return []
  const tunnel = bayTunnelLevels(rack, row, bay)
  return storageLevels(rack).filter(
    (level) => level >= tunnel && level <= bayLevelCount(rack, row, bay),
  )
}

/** Decking for a bay, falling back to the run's. */
export function bayDecking(
  rack: PalletRackNode,
  row: number,
  bay: number,
): PalletRackNode['decking'] {
  return bayOverrideOf(rack, row, bay).decking ?? rack.decking
}

/**
 * Whether an upright frame is worth erecting.
 *
 * Frames are shared, so frame `index` stands between bay `index` and bay
 * `index + 1`. It is needed when either neighbour is present — which means a
 * skipped bay in the middle of a run keeps both its frames (they carry the bays
 * either side), while a skipped bay at the end takes the outermost frame with
 * it. Erecting all of them regardless would leave a post standing in the gap
 * the skip was cut for.
 */
export function isFramePresent(rack: PalletRackNode, row: number, index: number): boolean {
  const left = index >= 1 && !isBaySkipped(rack, row, index)
  const right = index + 1 <= rack.bayCount && !isBaySkipped(rack, row, index + 1)
  return left || right
}

/** Bays that are actually built, 1-based. */
export function presentBays(rack: PalletRackNode, row: number): number[] {
  const bays: number[] = []
  for (let bay = 1; bay <= rack.bayCount; bay++) {
    if (!isBaySkipped(rack, row, bay)) bays.push(bay)
  }
  return bays
}

/** The row a local Z falls in, or null for an aisle between rows. */
export function rowAt(rack: PalletRackNode, localZ: number): number | null {
  const half = rowDepth(rack) / 2
  for (let row = 1; row <= rack.rowCount; row++) {
    if (Math.abs(localZ - rowCenterZ(rack, row)) <= half) return row
  }
  return null
}

/**
 * The bay a point in the rack's local frame falls in, or null for the aisles
 * between rows and beyond the ends.
 *
 * This is what makes per-bay selection cost nothing. The host has no sub-node
 * selection, and the alternative — one child node per bay, the way cabinet
 * modules work — is one more draw call per bay, so a twenty-bay run in a
 * thousand-rack warehouse would add twenty thousand. A click already carries
 * its hit point in the node's local frame, so the bay is arithmetic.
 */
export function bayAt(
  rack: PalletRackNode,
  localX: number,
  localZ: number,
): { row: number; bay: number } | null {
  const row = rowAt(rack, localZ)
  if (row === null) return null

  const pitch = bayPitch(rack)
  const fromLeft = localX + totalWidth(rack) / 2 - rack.uprightWidth / 2
  const bay = Math.floor(fromLeft / pitch) + 1
  if (bay < 1 || bay > rack.bayCount) return null
  return { row, bay }
}

// ── Levels ──────────────────────────────────────────────────────────────────

export type LevelType = 'pallet' | 'picking'

/**
 * What a level holds. Level 0 is the floor inside the bay.
 *
 * The explicit `levelTypes` list wins when present; otherwise the lowest
 * `pickingLevels` levels are picked by hand and everything above them holds
 * pallets, which is how a mixed rack is actually arranged.
 */
export function levelTypeOf(rack: PalletRackNode, level: number): LevelType {
  const explicit = rack.levelTypes?.[level]
  if (explicit) return explicit
  return level < rack.pickingLevels ? 'picking' : 'pallet'
}

/** Beam profile carrying a level. Picking levels ride a shallower section. */
export function levelBeamHeight(rack: PalletRackNode, level: number): number {
  return levelTypeOf(rack, level) === 'picking' ? rack.pickingBeamHeight : rack.beamHeight
}

/**
 * Clear opening above a level's surface, before the next beam.
 *
 * Level 0 takes `firstLevelClear` when it holds pallets, because the ground
 * opening is usually set by the truck rather than by the goods. A ground
 * picking level takes the picking opening instead — otherwise setting
 * `pickingLevels` would leave the bottom level sized for a pallet it will never
 * hold, and quietly cost a level's worth of height up the whole frame.
 */
export function levelClearOpening(rack: PalletRackNode, level: number): number {
  const type = levelTypeOf(rack, level)
  if (type === 'picking') return rack.pickingLevelClear
  return level <= 0 ? rack.firstLevelClear : rack.levelClear
}

/**
 * Surface height goods rest on. Level 0 is the floor; levels above it return
 * the top of that level's beam pair.
 *
 * Accumulated rather than multiplied. A uniform pitch is only correct while
 * every level is the same kind — as soon as a rack mixes picking and pallet
 * levels the openings and the beam sections both differ per level, and a
 * `first + (n-1) × step` formula puts every level above the mix at the wrong
 * height.
 */
export function levelSurfaceY(rack: PalletRackNode, level: number): number {
  if (level <= 0) return 0
  let y = 0
  for (let index = 1; index <= level; index++) {
    y += levelClearOpening(rack, index - 1) + levelBeamHeight(rack, index)
  }
  return y
}

/** Underside of a beam level, which is where its clear opening starts. */
export function beamUndersideY(rack: PalletRackNode, level: number): number {
  return levelSurfaceY(rack, level) - levelBeamHeight(rack, level)
}

/**
 * Beam levels that actually fit inside `uprightHeight`.
 *
 * The schema lets `levels` be set independently of the height, so this is the
 * value the geometry and the capacity count both use. Asking for ten levels on
 * a 5 m upright silently yields the number that fit rather than beams poking
 * out of the top of the frame.
 */
export function fittedLevelCount(rack: PalletRackNode): number {
  let fitted = 0
  for (let level = 1; level <= rack.levels; level++) {
    if (levelSurfaceY(rack, level) > rack.uprightHeight) break
    fitted++
  }
  return fitted
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

/**
 * Levels of each kind that are actually present.
 *
 * Split rather than combined because the two are counted in different units —
 * a picking level holds containers, not pallets — and a single "levels" figure
 * would invite adding them together.
 */
export function palletLevels(rack: PalletRackNode): number[] {
  return storageLevels(rack).filter((level) => levelTypeOf(rack, level) === 'pallet')
}

export function pickingLevelsOf(rack: PalletRackNode): number[] {
  return storageLevels(rack).filter((level) => levelTypeOf(rack, level) === 'picking')
}

/**
 * Levels that carry a beam pair.
 *
 * The floor is a storage level but normally carries no beam, so this is not the
 * same list as `storageLevels`. Shared by the geometry builder and its cache key
 * so the two can never disagree about which levels exist — a key derived from
 * the wider list reports a difference the mesh does not have, and splits the
 * cache between racks whose geometry is byte-identical.
 */
export function beamedLevels(rack: PalletRackNode): number[] {
  return storageLevels(rack).filter((level) => level > 0 || rack.hasGroundBeam)
}

/** A picking level always carries a shelf — containers cannot sit on beams. */
export function levelHasShelf(rack: PalletRackNode, level: number): boolean {
  if (level <= 0) return false
  return levelTypeOf(rack, level) === 'picking' || rack.decking !== 'open'
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
/**
 * Centres of `count` items of `size` laid across `span`, symmetric about zero.
 *
 * Shared by pallets across a bay and containers across a picking shelf, so both
 * absorb leftover space the same way and neither can bunch to one end. Split
 * out when picking arrived rather than copied — a second copy would be a second
 * place for the clearance-scaling rule to have to be corrected.
 */
export function distributeAcross({
  betweenGap,
  count,
  edgeGap,
  size,
  span,
}: {
  betweenGap: number
  count: number
  edgeGap: number
  size: number
  span: number
}): number[] {
  if (count <= 0) return []
  const minClearance = 2 * edgeGap + (count - 1) * betweenGap
  const leftover = span - count * size
  // A manual override can ask for more items than fit; keep the declared count
  // and let them touch rather than scaling the clearance negative, which would
  // order the offsets backwards and mirror the row about the centre.
  const scale = minClearance > 0 ? Math.max(0, leftover / minClearance) : 0
  const start = -span / 2 + edgeGap * scale + size / 2
  return Array.from({ length: count }, (_, index) => start + index * (size + betweenGap * scale))
}

/** How many items of `size` fit across `span` at the declared clearances. */
export function fitAcross({
  betweenGap,
  edgeGap,
  size,
  span,
}: {
  betweenGap: number
  edgeGap: number
  size: number
  span: number
}): number {
  const step = size + betweenGap
  if (step <= 0) return 0
  // Epsilon because the catalogue cases divide exactly — 2.625 / 0.875 is 3 —
  // and binary floating point lands such quotients either side of the integer
  // depending on operand order. Losing one is invisible, because every figure
  // downstream stays self-consistent.
  return Math.max(0, Math.floor((span - 2 * edgeGap + betweenGap) / step + 1e-9))
}

export function slotOffsetsX(rack: PalletRackNode): number[] {
  const [alongRun] = orientedPalletFootprint(rack)
  return distributeAcross({
    betweenGap: rack.clearanceBetweenPallets,
    count: palletsPerLevel(rack),
    edgeGap: rack.clearanceToUpright,
    size: alongRun,
    span: rack.bayClearWidth,
  })
}

// ── Picking containers ──────────────────────────────────────────────────────

/** Containers across the shelf width at the declared gaps. */
export function autoPickingBoxesAcross(rack: PalletRackNode): number {
  return fitAcross({
    betweenGap: rack.pickingBoxGap,
    edgeGap: rack.pickingBoxGap,
    size: rack.pickingBoxWidth,
    span: rack.bayClearWidth,
  })
}

/** Containers into the shelf depth at the declared gaps. */
export function autoPickingBoxesDeep(rack: PalletRackNode): number {
  return fitAcross({
    betweenGap: rack.pickingBoxGap,
    edgeGap: rack.pickingBoxGap,
    size: rack.pickingBoxDepth,
    span: rack.depth,
  })
}

export function pickingBoxesAcross(rack: PalletRackNode): number {
  return rack.pickingBoxesAcross ?? autoPickingBoxesAcross(rack)
}

export function pickingBoxesDeep(rack: PalletRackNode): number {
  return rack.pickingBoxesDeep ?? autoPickingBoxesDeep(rack)
}

export function pickingOffsetsX(rack: PalletRackNode): number[] {
  return distributeAcross({
    betweenGap: rack.pickingBoxGap,
    count: pickingBoxesAcross(rack),
    edgeGap: rack.pickingBoxGap,
    size: rack.pickingBoxWidth,
    span: rack.bayClearWidth,
  })
}

/** Container centres into the depth, relative to the shelf centre. Index 0 is
 *  the aisle side. */
export function pickingOffsetsZ(rack: PalletRackNode): number[] {
  return distributeAcross({
    betweenGap: rack.pickingBoxGap,
    count: pickingBoxesDeep(rack),
    edgeGap: rack.pickingBoxGap,
    size: rack.pickingBoxDepth,
    span: rack.depth,
  })
}

// ── Slot enumeration ────────────────────────────────────────────────────────

/** Every pallet position in the run, in a stable order. Picking levels hold
 *  containers instead and are enumerated by `pickingSlotsOf`. */
export function palletSlotsOf(rack: PalletRackNode): Slot[] {
  const offsets = slotOffsetsX(rack)
  const levels = palletLevels(rack)
  const footprint = orientedPalletFootprint(rack)
  const slots: Slot[] = []

  for (let row = 1; row <= rack.rowCount; row++) {
    for (let bay = 1; bay <= rack.bayCount; bay++) {
      // A skipped bay holds nothing, and a tunnel's open levels hold nothing —
      // counting them would report capacity the rack does not have.
      const present = new Set(bayStorageLevels(rack, row, bay))
      if (present.size === 0) continue
      const centreX = bayCenterX(rack, bay)
      for (const level of levels) {
        if (!present.has(level)) continue
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

/** Total pallet positions — the denominator of every pallet occupancy figure. */
export function palletSlotCount(rack: PalletRackNode): number {
  // Counted from the enumeration rather than multiplied out. The moment bays
  // can differ — a skip here, a tunnel there — a product of totals stops
  // describing the rack, and it fails silently: the figure stays plausible.
  return palletSlotsOf(rack).length
}

/**
 * Pallet positions a truck can reach without relocating another pallet.
 *
 * Reported alongside the total because a double-deep layout buys capacity by
 * spending accessibility, and a single "locations" figure hides the trade
 * entirely.
 */
export function directAccessSlotCount(rack: PalletRackNode): number {
  return palletSlotCount(rack) / rack.depthPositions
}

/**
 * Every container position on the run's picking levels.
 *
 * Addresses share the pallet format, and the components keep their meaning: P
 * still counts across the bay, D still counts into the depth. Only the unit
 * changes with the level's type, which is why a single address parser serves
 * both and a stored location never has to say which kind it was.
 */
export function pickingSlotsOf(rack: PalletRackNode): Slot[] {
  const offsetsX = pickingOffsetsX(rack)
  const offsetsZ = pickingOffsetsZ(rack)
  const levels = pickingLevelsOf(rack)
  const footprint: [number, number] = [rack.pickingBoxWidth, rack.pickingBoxDepth]
  const slots: Slot[] = []

  for (let row = 1; row <= rack.rowCount; row++) {
    for (let bay = 1; bay <= rack.bayCount; bay++) {
      const centreX = bayCenterX(rack, bay)
      for (const level of levels) {
        // Containers stand on the shelf panel, not on the beam top.
        const y = levelSurfaceY(rack, level) + (level > 0 ? rack.pickingShelfThickness : 0)
        const clearHeight = levelClearHeight(rack, level)
        for (let depth = 1; depth <= offsetsZ.length; depth++) {
          // Row 1 faces +Z, row 2 faces −Z, and index 1 is the aisle side of
          // whichever row it belongs to — the same convention pallet depth
          // positions use, so "D1 is the one you reach first" holds throughout.
          const offsetZ = offsetsZ[offsetsZ.length - depth] ?? 0
          const z = rowCenterZ(rack, row) + (row === 1 ? offsetZ : -offsetZ)
          offsetsX.forEach((offset, index) => {
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

/** Total container positions across every picking level. */
export function pickingSlotCount(rack: PalletRackNode): number {
  return pickingSlotsOf(rack).length
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
  return palletSlotsOf(rack).find((slot) => slot.id === address) ?? null
}
