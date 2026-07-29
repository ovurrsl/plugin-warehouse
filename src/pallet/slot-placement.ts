import { occupiedSlots } from '../rack/occupancy'
import { PalletRackNode } from '../rack/schema'
import { orientedPalletFootprint, palletSlotsOf, totalDepth, totalWidth } from '../rack/slots'
import { LIFT_ALLOWANCE_M, SLOT_FOOTPRINT_TOLERANCE_M } from './cargo-constants'
import { CARGO_TYPES, type CargoTypeId, cargoHeightM } from './cargo-types'
import type { PalletPreset } from './presets'
import { specOf } from './presets'

/**
 * Putting a pallet **into a rack** rather than on the floor, and refusing to
 * when it does not belong there.
 *
 * This is the plan's control chain, and its whole point is that the refusals
 * happen before the pallet exists rather than being discovered afterwards. A
 * load that does not fit under the beam above it is not a load to be drawn
 * shorter — it is a placement that should not happen, and the alternative is a
 * warehouse whose capacity figures count positions nothing could physically go
 * into.
 *
 * ## Why the search is two-phase
 *
 * A cursor move must not enumerate every slot in the building: two thousand bays
 * at twelve positions each is twenty-four thousand slot objects and as many
 * formatted addresses, per mouse move. So the racks are indexed once per store
 * write with a bounding radius, the cursor rejects all but the two or three
 * within reach, and only those enumerate their slots.
 */

/** How close the cursor must come before a slot claims the pallet. */
export const SLOT_REACH_M = 1.2

export type SlotTarget = {
  rackId: string
  address: string
  /** World position for the pallet's origin — its own bottom centre. */
  position: [number, number, number]
  rotationY: number
  /** The fill range that actually fits under the beam above. */
  range: [number, number]
  /** Set when the range was narrowed to make the load fit. */
  clamped: boolean
}

export type SlotRefusal = 'occupied' | 'footprint' | 'clearance'

export type SlotVerdict =
  | { ok: true; range: [number, number]; clamped: boolean }
  | { ok: false; reason: SlotRefusal }

export type PalletShape = {
  preset: PalletPreset
  cargo: 'none' | CargoTypeId
  fillRange: readonly [number, number]
}

/**
 * Whether this pallet may go in this slot, and at what fill.
 *
 * The order is the plan's: what is already there, then whether it physically
 * fits the opening, then whether the load clears the beam. Each is a different
 * kind of no, and only the last one has a middle answer — a range that has been
 * narrowed until it fits.
 */
export function admitsPallet(
  rack: PalletRackNode,
  slot: { id: string; footprint: readonly [number, number]; clearHeight: number },
  shape: PalletShape,
  occupied: ReadonlySet<string>,
): SlotVerdict {
  if (occupied.has(slot.id)) return { ok: false, reason: 'occupied' }

  const spec = specOf(shape.preset)
  // The slot's footprint is what the rack was configured to hold. A pallet of a
  // different standard is refused rather than shrunk: the beams are where they
  // are, and a 1200 mm pallet on a bay pitched for 800 mm overhangs its
  // neighbour whatever the panel says.
  const footprint = orientedPalletFootprint(rack)
  const fits =
    spec.length <= Math.max(footprint[0], footprint[1]) + SLOT_FOOTPRINT_TOLERANCE_M &&
    spec.width <= Math.max(footprint[0], footprint[1]) + SLOT_FOOTPRINT_TOLERANCE_M &&
    Math.min(spec.length, spec.width) <=
      Math.min(footprint[0], footprint[1]) + SLOT_FOOTPRINT_TOLERANCE_M
  if (!fits) return { ok: false, reason: 'footprint' }

  // Deck, plus goods, plus the room a truck needs to lift the pallet off the
  // beam before it can draw it out.
  const headroom = slot.clearHeight - LIFT_ALLOWANCE_M - spec.height
  if (headroom < 0) return { ok: false, reason: 'clearance' }
  if (shape.cargo === 'none') {
    return shape.fillRange[0] === 0 && shape.fillRange[1] === 0
      ? { ok: true, range: [0, 0], clamped: false }
      : { ok: true, range: [shape.fillRange[0], shape.fillRange[1]], clamped: false }
  }

  const type = CARGO_TYPES[shape.cargo]
  const [low, high] = shape.fillRange
  const fitting = type.variants.filter(
    (variant) =>
      variant >= low - 1e-9 && variant <= high + 1e-9 && cargoHeightM(type, variant) <= headroom,
  )
  if (fitting.length === 0) return { ok: false, reason: 'clearance' }

  const narrowed: [number, number] = [Math.min(...fitting), Math.max(...fitting)]
  // Narrowed rather than clamped to a single value: the point of a range is that
  // a run of pallets varies, and squeezing it to one number would fill a whole
  // level with identical loads — the copy-paste look the seeding exists to break.
  const clamped = narrowed[0] !== low || narrowed[1] !== high
  return { ok: true, range: narrowed, clamped }
}

// ── Finding one ─────────────────────────────────────────────────────────────

type RackEntry = {
  id: string
  rack: PalletRackNode
  parentId: string | null
  x: number
  z: number
  rotationY: number
  /** Plan-radius of the bay, so the cursor can reject it with one comparison. */
  radius: number
}

let indexedFrom: unknown = null
let entries: RackEntry[] = []

function rackIndex(nodes: Readonly<Record<string, unknown>>): RackEntry[] {
  if (indexedFrom === nodes) return entries
  indexedFrom = nodes
  const next: RackEntry[] = []
  for (const value of Object.values(nodes)) {
    const record = value as { type?: unknown; parentId?: unknown } | null
    if (record?.type !== 'warehouse:pallet-rack') continue
    const parsed = PalletRackNode.safeParse(value)
    if (!parsed.success) continue
    const rack = parsed.data
    next.push({
      id: rack.id,
      rack,
      parentId: typeof record.parentId === 'string' ? record.parentId : null,
      x: rack.position[0],
      z: rack.position[2],
      rotationY: rack.rotation[1],
      radius: Math.hypot(totalWidth(rack), totalDepth(rack)) / 2 + SLOT_REACH_M,
    })
  }
  entries = next
  return entries
}

/** Drops the memo. Tests only — the same contract the occupancy index has. */
export function resetRackIndex(): void {
  indexedFrom = null
  entries = []
}

/** Bir istasyon adayı: raf, dünya konumu ve plan dönüşü. */
export type RackNearby = {
  id: string
  rack: PalletRackNode
  parentId: string | null
  x: number
  z: number
  rotationY: number
}

/**
 * Verilen noktanın yakınındaki raflar — MEVCUT memoize indeksten.
 *
 * Filo istasyon seçimi bunu okur. İkinci bir indeks kurmak bu dosyanın var
 * oluş gerekçesini bozardı ("bin raf × on bin düğüm" — occupancy'nin doküman
 * bloğu); aynı `nodes` kimliğine aynı tarama, sahne başına bir kez.
 */
export function racksNear(
  nodes: Readonly<Record<string, unknown>>,
  x: number,
  z: number,
  radiusM: number,
): RackNearby[] {
  return rackIndex(nodes)
    .filter((entry) => Math.hypot(entry.x - x, entry.z - z) <= radiusM + entry.radius)
    .map(({ id, rack, parentId, x: rx, z: rz, rotationY }) => ({
      id,
      rack,
      parentId,
      x: rx,
      z: rz,
      rotationY,
    }))
}

/**
 * The slot the cursor is asking for, or `null` for the floor.
 *
 * Nearest wins, and only among slots that would actually admit this pallet —
 * so a cursor over a full bay falls through to the floor rather than snapping to
 * a slot it would then refuse to place into. A refusal the user cannot act on is
 * worse than no snap at all.
 */
export function findSlotTarget(
  nodes: Readonly<Record<string, unknown>>,
  levelId: string | null,
  x: number,
  z: number,
  shape: PalletShape,
): SlotTarget | null {
  let best: SlotTarget | null = null
  let bestDistance = SLOT_REACH_M

  for (const entry of rackIndex(nodes)) {
    if (levelId && entry.parentId && entry.parentId !== levelId) continue
    const dx = x - entry.x
    const dz = z - entry.z
    if (Math.hypot(dx, dz) > entry.radius) continue

    const occupied = occupiedSlots(nodes, entry.id)
    const cos = Math.cos(entry.rotationY)
    const sin = Math.sin(entry.rotationY)
    const footprint = orientedPalletFootprint(entry.rack)
    const spec = specOf(shape.preset)
    // The rack decides which way its pallets face; the pallet turns to match.
    const turned = Math.abs(footprint[0] - spec.width) < Math.abs(footprint[0] - spec.length)

    for (const slot of palletSlotsOf(entry.rack)) {
      const verdict = admitsPallet(entry.rack, slot, shape, occupied)
      if (!verdict.ok) continue
      const worldX = entry.x + slot.localPosition[0] * cos + slot.localPosition[2] * sin
      const worldZ = entry.z - slot.localPosition[0] * sin + slot.localPosition[2] * cos
      const distance = Math.hypot(x - worldX, z - worldZ)
      if (distance >= bestDistance) continue
      bestDistance = distance
      best = {
        rackId: entry.id,
        address: slot.id,
        position: [worldX, slot.localPosition[1], worldZ],
        rotationY: entry.rotationY + (turned ? Math.PI / 2 : 0),
        range: verdict.range,
        clamped: verdict.clamped,
      }
    }
  }

  return best
}
