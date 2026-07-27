import { PALLET_PRESETS, type PalletPreset, specOf } from './presets'

/**
 * What a loaded pallet is carrying.
 *
 * One record per cargo type; adding a type is a record plus a layout function,
 * and nothing else in the kind learns a new name. The two here are the two the
 * plan asks for — cartons and drums — and they differ in the one way that
 * matters to everything downstream: **what a fill percentage means.** A carton
 * pallet fills by layers and a drum pallet fills by count, so "sixty per cent"
 * resolves to a height on one and to a number of objects on the other.
 *
 * ## Why the variants are quantised
 *
 * The requirement is that fill be *random* and the geometry be *shared*, and
 * those pull against each other: one merged buffer per shape is the whole
 * performance story of this package, and a continuous fill would mint a buffer
 * per pallet. Quantising resolves it — the randomness picks among a handful of
 * prepared variants rather than producing one of its own, so ten thousand
 * pallets still resolve to a handful of buffers.
 *
 * ## Why the randomness is seeded
 *
 * `Math.random()` would give a different warehouse on every reload, break undo
 * (a rebuild would re-roll every pallet), and make two people looking at the
 * same file see different scenes. Every draw here comes from the node's own id,
 * so a scene is a function of its file.
 */

export type CargoTypeId = 'carton' | 'drum'

/** What a fill fraction resolves to for this type. */
export type FillSemantics = 'layers' | 'count'

export type CargoType = {
  id: CargoTypeId
  label: string
  /** One unit of goods, in metres: `[along X, height, along Z]`. */
  unitM: readonly [number, number, number]
  fill: FillSemantics
  /**
   * The prepared fill levels, as fractions. A drawn fraction snaps to the
   * nearest of these — which is what keeps the buffer count finite.
   */
  variants: readonly number[]
  /** Which detail elements this type is ordinarily built with. */
  defaults: { wrap: boolean; strapping: boolean; cornerBoards: boolean; label: boolean }
  /** May the load stand outside the pallet's own footprint? */
  overhang: boolean
}

/**
 * Cartons on a **300 × 400 × 250 mm Euro module**.
 *
 * The size is not arbitrary, and **neither is which way round it goes**: 300 mm
 * runs along the deck's 1200 and 400 along its 800, so a layer is four by two
 * with nothing left over. Transposed, the same carton tiles three by two and
 * leaves 200 mm of bare deck along one edge — a ragged line that reads as a
 * modelling error from every angle, which is the whole thing the Euro module
 * exists to avoid.
 */
export const CARTON: CargoType = {
  id: 'carton',
  label: 'Cartons',
  unitM: [0.3, 0.25, 0.4],
  fill: 'layers',
  /** One to five layers: 0.25 m to 1.25 m of goods. */
  variants: [0.2, 0.4, 0.6, 0.8, 1],
  defaults: { wrap: true, strapping: true, cornerBoards: true, label: true },
  overhang: false,
}

/**
 * Two-hundred-litre steel drums, Ø 585 × 880 mm.
 *
 * **How many fit is arithmetic, and it is arithmetic in two directions.** Two
 * across a Euro deck is 1170 mm against its 1200, and a third would hang over —
 * but the same drum on a 1200 × 1200 takes two by two, and on an EPAL 3
 * (1000 × 1200) it takes one by two. The count follows the deck, which is why
 * `unitsPerLayer` is asked rather than a number being written down here.
 *
 * On a quarter pallet it takes none at all: 585 mm does not fit inside 400 mm in
 * any orientation, and {@link fitsOnDeck} says so rather than rounding it up to
 * one and letting 92 mm of steel hang over both long edges.
 *
 * Wrapping is off by default: drums are strapped in practice, not filmed.
 */
export const DRUM: CargoType = {
  id: 'drum',
  label: 'Drums',
  unitM: [0.585, 0.88, 0.585],
  fill: 'count',
  /** One drum or two. */
  variants: [0.5, 1],
  defaults: { wrap: false, strapping: true, cornerBoards: false, label: true },
  overhang: false,
}

export const CARGO_TYPES: Record<CargoTypeId, CargoType> = { carton: CARTON, drum: DRUM }

export const CARGO_TYPE_IDS = ['carton', 'drum'] as const

// ── Seeded, quantised fill ──────────────────────────────────────────────────

/**
 * A pallet's own number, from its id.
 *
 * FNV-1a, the same hash the rack's LOD phase and the conveyor's stagger already
 * use. Stable across reloads, across exports and across machines, which is the
 * whole point: the fill is random to look at and deterministic to compute.
 */
export function fillSeed(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Mulberry32, one draw.
 *
 * A named generator rather than `seed % n`, because the low bits of a hash are
 * not uniform and a modulo of them clusters — with five variants and a modulo,
 * ids ending in the same character would tend to the same fill, which is
 * exactly the "copy-paste" look the seeding exists to break.
 */
export function draw(seed: number): number {
  let state = (seed + 0x6d2b79f5) | 0
  state = Math.imul(state ^ (state >>> 15), state | 1)
  state ^= state + Math.imul(state ^ (state >>> 7), state | 61)
  return ((state ^ (state >>> 14)) >>> 0) / 4294967296
}

/**
 * The variant a pallet resolves to, given its id and the range the placement
 * panel was set to.
 *
 * Snapped to the nearest prepared level rather than clamped into it: a range of
 * 0.4–1.0 against carton variants [0.2 … 1.0] should be able to produce 0.4, and
 * clamping a draw into the range and then rounding would bias the ends.
 */
export function resolveVariant(
  type: CargoType,
  id: string,
  range: readonly [number, number],
): number {
  const [low, high] = range
  const wanted = low + draw(fillSeed(id)) * Math.max(0, high - low)
  let best = type.variants[0] ?? 1
  let bestGap = Number.POSITIVE_INFINITY
  for (const variant of type.variants) {
    const gap = Math.abs(variant - wanted)
    if (gap < bestGap) {
      bestGap = gap
      best = variant
    }
  }
  return best
}

// ── What a variant means, per type ──────────────────────────────────────────

/**
 * Units across the deck in one layer, and how they are arranged.
 *
 * **Zero is a legal answer and is not clamped away.** The obvious guard —
 * `Math.max(1, …)` so a layer is never empty — is wrong for a unit larger than
 * the deck: it reported one drum on a 400 mm quarter pallet and the builder duly
 * drew 585 mm of steel hanging 92 mm over both long edges. Worse, the footprint
 * and the clash box are both built from the pallet's own dimensions, so the
 * overhang passed straight through collision. The honest answer for a unit that
 * does not fit is none, and {@link fitsOnDeck} is what the callers ask.
 */
export function unitsPerLayer(
  type: CargoType,
  preset: PalletPreset,
): { alongX: number; alongZ: number } {
  const spec = PALLET_PRESETS[preset]
  return {
    alongX: Math.floor(spec.length / type.unitM[0] + 1e-6),
    alongZ: Math.floor(spec.width / type.unitM[2] + 1e-6),
  }
}

/**
 * Whether this cargo can stand on this deck at all.
 *
 * The consumer `overhang` was declared for and never had. A type that may not
 * leave the footprint and does not fit inside it is not a load to be drawn
 * smaller — it is a combination that does not exist, and the panel says so.
 */
export function fitsOnDeck(type: CargoType, preset: PalletPreset): boolean {
  if (type.overhang) return true
  const perLayer = unitsPerLayer(type, preset)
  return perLayer.alongX >= 1 && perLayer.alongZ >= 1
}

/**
 * How many units a variant puts on the pallet.
 *
 * The two semantics diverge here and nowhere else: layers multiplies by the
 * deck's tiling, count does not. Everything downstream — the geometry, the
 * height, the panel — reads this rather than branching on the type again.
 */
export function unitCount(type: CargoType, preset: PalletPreset, variant: number): number {
  const perLayer = unitsPerLayer(type, preset)
  const most = perLayer.alongX * perLayer.alongZ
  if (most <= 0) return 0
  if (type.fill === 'layers') {
    const layers = Math.max(1, Math.round(variant * type.variants.length))
    return layers * most
  }
  return Math.max(1, Math.round(variant * most))
}

/**
 * **How tall the goods on this pallet are — the one answer everything else asks
 * for.**
 *
 * A pallet carrying cargo has two candidate heights: the `loadHeight` field a
 * user typed, and the height the resolved variant actually builds to. They are
 * not the same number, and letting each caller pick meant collision testing one
 * while the renderer drew the other — a load that clashes with the beam above it
 * and reports itself clear, which is precisely the failure the whole clash
 * system exists to prevent.
 *
 * So: cargo, when set, wins. `loadHeight` stays the answer for the plain block a
 * pallet has always been able to carry, which is why nothing about a scene saved
 * before cargo existed changes.
 */
export function loadHeightOf(node: {
  id: string
  cargo: 'none' | CargoTypeId
  preset: PalletPreset
  fillRange: readonly [number, number]
  loadHeight: number
}): number {
  if (node.cargo === 'none') return Math.max(0, node.loadHeight)
  const type = CARGO_TYPES[node.cargo]
  // A cargo that does not fit its deck is not drawn, so it must not reserve
  // height either — a collision box standing a metre taller than the pallet it
  // describes is the same renderer/collider disagreement in the other axis.
  if (!fitsOnDeck(type, node.preset)) return Math.max(0, node.loadHeight)
  return cargoHeightM(type, resolveVariant(type, node.id, node.fillRange))
}

/**
 * Deck plus load — what collision, the drag box and the placement cursor are
 * all actually about.
 *
 * One helper rather than `specOf(preset).height + loadHeightOf(node)` written
 * out at each of five call sites, because the term that gets forgotten in that
 * expression is always the deck.
 */
export function unitLoadHeightOf(node: Parameters<typeof loadHeightOf>[0]): number {
  return specOf(node.preset).height + loadHeightOf(node)
}

/** Height of the goods alone, metres. The pallet's own deck is not in it. */
export function cargoHeightM(type: CargoType, variant: number): number {
  if (type.fill === 'layers') {
    return Math.max(1, Math.round(variant * type.variants.length)) * type.unitM[1]
  }
  // A count-filled type stands one high whatever the count: two drums side by
  // side are two drums, not a drum on a drum.
  return type.unitM[1]
}
