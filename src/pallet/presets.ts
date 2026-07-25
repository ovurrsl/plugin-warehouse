/**
 * Pallet dimensions, in metres.
 *
 * Every published pallet spec is in millimetres and the host stores metres, so
 * these are the divided-by-1000 figures. Nothing in this package may write a
 * bare dimension literal greater than 100 — that is always a unit mistake.
 *
 * `length` runs along local X, `width` along local Z. Which of the two faces a
 * rack bay is `palletFace` depends on how the pallet is turned, and that is a
 * property of the rack, not of the pallet — see the rack's `palletOrientation`.
 */

/**
 * The single list of preset ids.
 *
 * Both the pallet schema and the rack schema validate against this rather than
 * repeating the literals. They were written out twice, and adding a preset then
 * updated one enum and not the other — the pallet accepted the new value and
 * the rack rejected it, which surfaces as a validation error naming a field the
 * user never touched.
 */
export const PALLET_PRESET_IDS = [
  'epal-1',
  'epal-2',
  'epal-3',
  'epal-6',
  'euro-1200x1200',
  'quarter',
  'gma-48x40',
  'plastic-euro',
] as const

export type PalletPreset = (typeof PALLET_PRESET_IDS)[number]

export type PalletSpec = {
  label: string
  /** Local X, metres. */
  length: number
  /** Local Z, metres. */
  width: number
  /** Deck height of the empty pallet, metres. */
  height: number
  /** Empty weight, kg. */
  tare: number
  /** Safe working load when moved, kg. */
  dynamicLoad: number
  /** Safe working load at rest on a flat floor, kg. */
  staticLoad: number
  /** Safe working load when supported only at its edges in racking, kg. */
  rackingLoad: number
  /** Whether the EPAL/EUR/IPPC block markings apply to this preset. */
  branded: boolean
}

export const PALLET_PRESETS: Record<PalletPreset, PalletSpec> = {
  'epal-1': {
    label: 'EPAL 1 (EUR)',
    length: 1.2,
    width: 0.8,
    height: 0.144,
    tare: 25,
    dynamicLoad: 1500,
    staticLoad: 4000,
    rackingLoad: 1000,
    branded: true,
  },
  'epal-2': {
    label: 'EPAL 2 (industrial)',
    length: 1.2,
    width: 1.0,
    height: 0.162,
    tare: 33,
    dynamicLoad: 1500,
    staticLoad: 4000,
    rackingLoad: 1250,
    branded: true,
  },
  'epal-3': {
    label: 'EPAL 3',
    length: 1.0,
    width: 1.2,
    height: 0.144,
    tare: 30,
    dynamicLoad: 1500,
    staticLoad: 4000,
    rackingLoad: 1250,
    branded: true,
  },
  'epal-6': {
    label: 'EPAL 6 (half)',
    length: 0.8,
    width: 0.6,
    height: 0.144,
    tare: 9.5,
    dynamicLoad: 500,
    staticLoad: 1500,
    rackingLoad: 500,
    branded: true,
  },
  'euro-1200x1200': {
    // Same construction standard as EPAL 1, in the largest of the three sizes
    // the catalogue lists (800, 1000 and 1200 × 1200). Square, so it is the one
    // preset where the two orientations give the same across-run footprint.
    label: 'Euro 1200×1200',
    length: 1.2,
    width: 1.2,
    height: 0.162,
    tare: 40,
    dynamicLoad: 1500,
    staticLoad: 4000,
    rackingLoad: 1250,
    branded: false,
  },
  quarter: {
    label: 'Quarter pallet',
    length: 0.6,
    width: 0.4,
    height: 0.144,
    tare: 5,
    dynamicLoad: 250,
    staticLoad: 750,
    rackingLoad: 250,
    branded: false,
  },
  'gma-48x40': {
    label: 'GMA 48×40 (US)',
    length: 1.219,
    width: 1.016,
    height: 0.152,
    tare: 17,
    dynamicLoad: 900,
    staticLoad: 2700,
    rackingLoad: 900,
    branded: false,
  },
  'plastic-euro': {
    label: 'Plastic euro',
    length: 1.2,
    width: 0.8,
    height: 0.16,
    tare: 7,
    dynamicLoad: 1250,
    staticLoad: 4000,
    rackingLoad: 700,
    branded: false,
  },
}

export const PALLET_PRESET_LIST = Object.entries(PALLET_PRESETS).map(([id, spec]) => ({
  id: id as PalletPreset,
  ...spec,
}))

export function specOf(preset: PalletPreset): PalletSpec {
  // `noUncheckedIndexedAccess` makes the lookup optional even though the record
  // is total; fall back rather than assert so a scene saved against a preset we
  // later remove still renders something.
  return PALLET_PRESETS[preset] ?? PALLET_PRESETS['epal-1']
}

/** Overall height including any load — what collision and stacking care about. */
export function unitLoadHeight(preset: PalletPreset, loadHeight: number): number {
  return specOf(preset).height + Math.max(0, loadHeight)
}
