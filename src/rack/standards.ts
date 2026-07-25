/**
 * Real racking catalogue data, kept as tables rather than as magic numbers
 * scattered through the geometry.
 *
 * Sources:
 *  - EN 15620 (in force 2021) clearance table for bays, via the Mecalux
 *    *Selective Pallet Racking* catalogue, p.12.
 *  - Mecalux upright, footplate and beam profile ranges, pp.10, 11, 16, 17.
 *  - Handling-equipment aisle widths and lift heights, p.4.
 *
 * These are defaults and pick-lists, not constraints: every field they feed is
 * a schema field the user can override. The point of holding them as data is
 * that "what does a real 2.7 m bay look like" has one answer in one place, and
 * that answer is checked against the manufacturer's own tables in
 * `standards.test.ts`.
 */

/**
 * Catalogue figures are published in millimetres and this package stores
 * metres, so every table entry is written through this rather than as a
 * pre-divided decimal. Keeps the tables diffable against the PDF and keeps the
 * "no bare dimension literal over 100" rule intact.
 */
const mm = (value: number): number => value / 1000

// ── Uprights ────────────────────────────────────────────────────────────────

export type UprightProfileId = '80/81' | '101' | '122' | 'A127' | 'A10'

export type UprightProfile = {
  label: string
  /** Section across the run, metres. */
  width: number
  /** Section through the frame, metres. */
  depth: number
  /** Footplate plan size, metres. `null` where the catalogue says "as per the load". */
  footplate: { width: number; depth: number } | null
}

export const UPRIGHT_PROFILES: Record<UprightProfileId, UprightProfile> = {
  '80/81': {
    label: '80/81',
    width: mm(81),
    depth: mm(69),
    footplate: { width: mm(135), depth: mm(119) },
  },
  '101': {
    label: '101',
    width: mm(101),
    depth: mm(69),
    footplate: { width: mm(155), depth: mm(119) },
  },
  '122': {
    label: '122',
    width: mm(122),
    depth: mm(69),
    footplate: { width: mm(175), depth: mm(119) },
  },
  A127: {
    label: 'A127',
    width: mm(122),
    depth: mm(80),
    footplate: { width: mm(175), depth: mm(119) },
  },
  A10: {
    label: 'A10',
    width: mm(102),
    depth: mm(123.2),
    footplate: null,
  },
}

/**
 * Uprights are punched every 50 mm, so a beam cannot sit at an arbitrary
 * height — it lands on the nearest slot. Levels that ignore this look right in
 * a render and cannot be built.
 */
export const SLOT_PITCH = mm(50)

/** Round a beam elevation up onto the next upright slot. */
export function snapUpToSlot(elevation: number): number {
  return Math.ceil(elevation / SLOT_PITCH - 1e-9) * SLOT_PITCH
}

// ── Beams ───────────────────────────────────────────────────────────────────

export type BeamProfileId =
  | 'TB80'
  | 'TB100'
  | 'TB120'
  | 'TB130'
  | '2C-S 1115'
  | '2C-S 1315'
  | '2C-S 1515'
  | '2C-S 1615'
  | '2C-S 1718'

export type BeamProfile = {
  label: string
  family: 'tubular' | '2C-S'
  /** Profile height, metres. */
  height: number
  /** Profile thickness, metres. Every catalogue beam is 50 mm. */
  thickness: number
}

export const BEAM_PROFILES: Record<BeamProfileId, BeamProfile> = {
  TB80: { label: 'TB 80', family: 'tubular', height: mm(80), thickness: mm(50) },
  TB100: { label: 'TB 100', family: 'tubular', height: mm(100), thickness: mm(50) },
  TB120: { label: 'TB 120', family: 'tubular', height: mm(120), thickness: mm(50) },
  TB130: { label: 'TB 130', family: 'tubular', height: mm(130), thickness: mm(50) },
  '2C-S 1115': { label: '2C-S 1115', family: '2C-S', height: mm(110), thickness: mm(50) },
  '2C-S 1315': { label: '2C-S 1315', family: '2C-S', height: mm(130), thickness: mm(50) },
  '2C-S 1515': { label: '2C-S 1515', family: '2C-S', height: mm(150), thickness: mm(50) },
  '2C-S 1615': { label: '2C-S 1615', family: '2C-S', height: mm(160), thickness: mm(50) },
  '2C-S 1718': { label: '2C-S 1718', family: '2C-S', height: mm(170), thickness: mm(50) },
}

// ── EN 15620 bay clearances ─────────────────────────────────────────────────

/**
 * Handling class, which is what actually sets the clearances.
 *
 * `400` — counterbalanced forklifts and reach trucks.
 * `300A` — man-up trilateral turret trucks (operator rises with the load).
 * `300B` — man-down trilateral turret trucks (operator stays at floor level).
 *
 * 300A keeps 75/75 all the way up because the operator is at the load; the
 * other two need progressively more room the higher the level, since the
 * further the forks are from the operator's eye the worse the placing accuracy.
 */
export type HandlingClass = '400' | '300A' | '300B'

export type BayClearance = {
  /** X — minimum clearance between adjacent pallets or loads, and to uprights. */
  x: number
  /** Y — clear height between the load top and the underside of the beam above. */
  y: number
}

type ClearanceBand = {
  /** Upper bound of the band, metres. `Infinity` for the open top band. */
  maxHeight: number
  byClass: Record<HandlingClass, BayClearance | null>
}

const clearance = (x: number, y: number): BayClearance => ({ x: mm(x), y: mm(y) })

/**
 * EN 15620 clearance table, banded by the height of the level above the floor.
 *
 * A null entry is the catalogue's "–": that class is not rated at that height,
 * because the equipment cannot reach it. Modelled as null rather than as a
 * silent fallback so a rack configured beyond its equipment's reach can be
 * reported instead of quietly rendered.
 */
export const EN15620_CLEARANCES: ClearanceBand[] = [
  {
    maxHeight: 3,
    byClass: { '400': clearance(75, 75), '300A': clearance(75, 75), '300B': clearance(75, 75) },
  },
  {
    maxHeight: 6,
    byClass: { '400': clearance(75, 100), '300A': clearance(75, 75), '300B': clearance(75, 100) },
  },
  {
    maxHeight: 9,
    byClass: { '400': clearance(75, 125), '300A': clearance(75, 75), '300B': clearance(75, 125) },
  },
  {
    maxHeight: 12,
    byClass: { '400': clearance(100, 150), '300A': clearance(75, 75), '300B': clearance(100, 150) },
  },
  {
    maxHeight: 15,
    byClass: { '400': clearance(100, 175), '300A': clearance(75, 75), '300B': clearance(100, 175) },
  },
  {
    maxHeight: Number.POSITIVE_INFINITY,
    byClass: { '400': null, '300A': clearance(75, 75), '300B': null },
  },
]

/**
 * Required clearances at a level height, or null when the class is not rated
 * that high. Height is the level's elevation above the floor, metres.
 */
export function en15620Clearance(height: number, handling: HandlingClass): BayClearance | null {
  const band = EN15620_CLEARANCES.find((entry) => height <= entry.maxHeight)
  return band?.byClass[handling] ?? null
}

/**
 * Level pitch the standard asks for: load height + beam + clearance, rounded up
 * to the 50 mm slot pitch. Returns null when the class cannot reach.
 */
export function requiredLevelPitch({
  beamHeight,
  handling,
  height,
  unitLoadHeight,
}: {
  beamHeight: number
  handling: HandlingClass
  /** Elevation of the level being sized, metres. */
  height: number
  /** Pallet plus its load, metres. */
  unitLoadHeight: number
}): number | null {
  const required = en15620Clearance(height, handling)
  if (!required) return null
  return snapUpToSlot(unitLoadHeight + beamHeight + required.y)
}

// ── Handling equipment ──────────────────────────────────────────────────────

export type HandlingEquipmentId =
  | 'pallet-stacker'
  | 'counterbalanced-forklift'
  | 'reach-truck'
  | 'bilateral-turret'
  | 'trilateral-turret'
  | 'automatic-trilateral-crane'
  | 'stacker-crane'

export type HandlingEquipment = {
  label: string
  /**
   * Null where EN 15620's bay-clearance classes do not describe the equipment.
   *
   * The classes cover counterbalanced, reach and turret trucks only. An AS/RS
   * stacker crane is a different machine under a different design case, and
   * its 45 m reach is three times the table's top band — filing it under a
   * class would hand back 175 mm clearances for a rack the table never rated,
   * which reads as authoritative and is invented.
   */
  handlingClass: HandlingClass | null
  /** Clear aisle between loads, metres. The catalogue gives a range. */
  aisle: { min: number; max: number }
  /** Maximum lifting height, metres. */
  maxLift: number
}

/**
 * Aisle widths are between *loads*, not between frames — the pallet overhangs
 * the frame, so an aisle measured to the steel is wider than the truck needs
 * and the layout silently loses floor area.
 */
export const HANDLING_EQUIPMENT: Record<HandlingEquipmentId, HandlingEquipment> = {
  'pallet-stacker': {
    label: 'Pallet stacker',
    handlingClass: '400',
    aisle: { min: mm(2200), max: mm(2300) },
    maxLift: mm(5200),
  },
  'counterbalanced-forklift': {
    label: 'Counterbalanced forklift',
    handlingClass: '400',
    aisle: { min: mm(3200), max: mm(3500) },
    maxLift: mm(7000),
  },
  'reach-truck': {
    label: 'Reach truck',
    handlingClass: '400',
    aisle: { min: mm(2600), max: mm(2900) },
    maxLift: mm(12_000),
  },
  'bilateral-turret': {
    label: 'Bilateral turret truck',
    handlingClass: '300B',
    aisle: { min: mm(1500), max: mm(1600) },
    maxLift: mm(13_500),
  },
  'trilateral-turret': {
    label: 'Trilateral turret truck',
    handlingClass: '300A',
    aisle: { min: mm(1700), max: mm(1900) },
    maxLift: mm(14_500),
  },
  'automatic-trilateral-crane': {
    label: 'Automatic trilateral stacker crane',
    handlingClass: '300A',
    aisle: { min: mm(1700), max: mm(1900) },
    maxLift: mm(14_500),
  },
  'stacker-crane': {
    label: 'Stacker crane',
    handlingClass: null,
    aisle: { min: mm(1500), max: mm(1650) },
    maxLift: mm(45_000),
  },
}

// ── Catalogue beam lengths ──────────────────────────────────────────────────

/**
 * Standard clear beam lengths, by pallet width across the run and how many fit.
 * Straight from the catalogue's beam table. Used to offer real bay widths
 * rather than arbitrary ones, and as the fixture the slot maths is checked
 * against — the derived fit must reproduce every row.
 */
export const CATALOGUE_BEAM_LENGTHS: Array<{
  /** Pallet dimension facing across the run, metres. */
  palletAcross: number
  pallets: number
  /** Clear beam length, metres. */
  beamLength: number
}> = [
  { palletAcross: mm(800), pallets: 2, beamLength: mm(1825) },
  { palletAcross: mm(1000), pallets: 2, beamLength: mm(2225) },
  { palletAcross: mm(1200), pallets: 2, beamLength: mm(2625) },
  { palletAcross: mm(800), pallets: 3, beamLength: mm(2700) },
  { palletAcross: mm(1000), pallets: 3, beamLength: mm(3300) },
  { palletAcross: mm(1200), pallets: 3, beamLength: mm(3900) },
]

/**
 * Frame depth the catalogue pairs with a pallet.
 *
 * Handled from the narrow side the frame is 1,100 mm whatever the pallet, and
 * a 1,200 mm deep pallet therefore **overhangs the frame by 50 mm front and
 * back** — that is intended, and it is why aisle widths are quoted between
 * loads. Handled lengthwise the frame matches the pallet's across-run size.
 */
export function catalogueFrameDepth(palletIntoDepth: number, lengthwise: boolean): number {
  return lengthwise ? palletIntoDepth : mm(1100)
}
