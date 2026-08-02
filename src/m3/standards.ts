/**
 * Mecalux **M3 Shelving for picking** catalogue tables.
 *
 * Source: Mecalux "M3 Shelving for picking — for light and medium loads"
 * (Catalog 9, MK-056541) plus mecalux.com's M3 product page. The same three
 * provenance tags the M7 tables carry, and for the same reason: a figure a user
 * reads off a panel should be traceable to whoever is answerable for it.
 *
 *  - `CATALOG`    — printed in the M3 catalogue or on Mecalux's M3 page.
 *  - `RESEARCHED` — corroborated from a named third party, converted to metric.
 *  - `ASSUMPTION` — chosen by us. Says so, and says why.
 *
 * ## The one thing this catalogue has that the other four do not
 *
 * **Published load figures.** Mecalux states them in prose on the M3 page: a
 * bay with light-duty shelves carries 150 kg per level, with heavy-duty shelves
 * 275 kg. Every other racking kind in this package reports a capacity that was
 * chosen rather than measured — this one does not, and the panel says which.
 */

/** Catalogue figures are millimetres; this package stores metres. Keeps the
 *  tables diffable against the PDF. */
const mm = (value: number): number => value / 1000

export type Provenance = 'CATALOG' | 'RESEARCHED' | 'ASSUMPTION'

// ── Frame ───────────────────────────────────────────────────────────────────

/**
 * CATALOG. "The most common frame heights are: 1,500, 2,000, 2,500, 2,750,
 * 3,000 and 4,000 mm."
 *
 * The Spanish edition additionally lists 1,000 / 2,250 / 3,500 — carried in
 * `FRAME_HEIGHTS_ES` rather than merged, because a bay ordered at 2,250 is
 * ordered from a different sheet and a user is entitled to know that before
 * quoting it.
 */
export const FRAME_HEIGHTS: readonly number[] = [
  mm(1500),
  mm(2000),
  mm(2500),
  mm(2750),
  mm(3000),
  mm(4000),
]

/** CATALOG (ES edition only). */
export const FRAME_HEIGHTS_ES: readonly number[] = [mm(1000), mm(2250), mm(3500)]

/**
 * CATALOG. "They can be manufactured up to 8,000 mm long." Past this the frame
 * is spliced from two uprights, which is a different bill of materials.
 */
export const MAX_FRAME_HEIGHT = mm(8000)

/** CATALOG. "Length: 750, 1,000, 1,250 and 1,400 mm." */
export const SHELF_LENGTHS: readonly number[] = [mm(750), mm(1000), mm(1250), mm(1400)]

/** CATALOG. "Depth: 300, 400, 500 and 600 mm." Frame depth equals shelf depth
 *  in this system — there is no overhang series. */
export const SHELF_DEPTHS: readonly number[] = [mm(300), mm(400), mm(500), mm(600)]

/**
 * CATALOG. "The height of the shelves can be adjusted in increments of 25 mm."
 *
 * **One pitch, one face.** That is the difference from M7, whose frame is
 * punched at 50 mm on the front for beams and 25 mm on the side for HM
 * supports. An M3 shelf has no beams at all: it sits on four supports that hook
 * into the upright's side slots, so every level in the system lands on the same
 * 25 mm grid and there is no second rule to get wrong.
 */
export const SLOT_PITCH = mm(25)

/** CATALOG. The upright's front face. The one section figure the catalogue
 *  prints. */
export const UPRIGHT_FRONT_FACE = mm(30)

/**
 * ASSUMPTION. Section into the depth.
 *
 * The catalogue names two upright types — "with either 6 or 12 folds" — and
 * publishes a section for neither. Deliberately **not** a schema field: a
 * control that changes no geometry and no derived figure is the "visible,
 * adjustable and ineffective" case this package's own rule forbids. The panel
 * reports the catalogue's wording in the provenance section instead.
 */
export const UPRIGHT_DEPTH = mm(40)

/** ASSUMPTION. Cross-tie section in the frame's own plane. */
export const CROSS_TIE_SECTION = mm(20)

/**
 * CATALOG. "The minimum number [of cross ties] used is two."
 *
 * A taller frame takes a third in the middle — the threshold below is chosen,
 * the "at least two" is printed.
 */
export const CROSS_TIES_MIN = 2
/** ASSUMPTION. Above this a third cross-tie goes in at mid-height. */
export const THIRD_CROSS_TIE_ABOVE = mm(2000)

// ── Frame models ────────────────────────────────────────────────────────────

export type FrameVariantId = 'basic' | 'diagonals' | 'central-panel' | 'side-panel' | 'mesh'

export type FrameVariant = {
  label: string
  /** Does the frame carry its own diagonal in the depth plane? */
  diagonal: boolean
  /** Sheet or mesh infill, and how much of the frame it covers. `null` = none. */
  infill: null | { coverage: 'central' | 'full'; pattern: 'sheet' | 'mesh' }
  provenance: Provenance
}

/** CATALOG (p.2): "Basic components: 1. Frame (5 models)". The five. */
export const FRAME_VARIANTS: Record<FrameVariantId, FrameVariant> = {
  basic: { label: 'Düz', diagonal: false, infill: null, provenance: 'CATALOG' },
  diagonals: { label: 'Çaprazlı', diagonal: true, infill: null, provenance: 'CATALOG' },
  'central-panel': {
    label: 'Orta panel',
    diagonal: false,
    infill: { coverage: 'central', pattern: 'sheet' },
    provenance: 'CATALOG',
  },
  'side-panel': {
    label: 'Yan panel',
    diagonal: false,
    infill: { coverage: 'full', pattern: 'sheet' },
    provenance: 'CATALOG',
  },
  mesh: {
    label: 'Tel panel',
    diagonal: false,
    infill: { coverage: 'full', pattern: 'mesh' },
    provenance: 'CATALOG',
  },
}

// ── Shelves ─────────────────────────────────────────────────────────────────

export type ShelfModelId = 'HL' | 'HM'

export type ShelfModel = {
  label: string
  /** Effective panel thickness including the folded edge, metres. */
  thickness: number
  /** CATALOG. Maximum load per level, kilograms. */
  loadKg: number
  /** Whether the model takes a central reinforcer under the panel. */
  reinforcer: boolean
  provenance: Provenance
  note: string
}

/**
 * CATALOG for the loads, ASSUMPTION for the thicknesses.
 *
 * Mecalux's M3 page: "M3 light duty racking systems configured with light-duty
 * shelves can support a maximum weight of 150 kg per level. With heavy-duty
 * shelves … the maximum load capacity increases to 275 kg per level."
 *
 * That is a **published, per-level, unconditional** figure — not a table keyed
 * on length and depth, which Mecalux does not publish for this system either.
 * So the number is real and the *shape* of the number is the catalogue's own:
 * one figure per shelf model, whatever the bay measures.
 */
export const SHELF_MODELS: Record<ShelfModelId, ShelfModel> = {
  HL: {
    label: 'HL hafif',
    thickness: mm(25),
    loadKg: 150,
    reinforcer: false,
    provenance: 'CATALOG',
    note: '150 kg/kat Mecalux tarafından yayımlanıyor. 25 mm kalınlık kıvrımlı sacın okunuşu — kesit basılı değil.',
  },
  HM: {
    label: 'HM orta/ağır',
    thickness: mm(30),
    loadKg: 275,
    reinforcer: true,
    provenance: 'CATALOG',
    note: '275 kg/kat Mecalux tarafından yayımlanıyor. Altında merkezî takviye var; 30 mm kalınlık onunla birlikte okunuşu.',
  },
}

/** ASSUMPTION. The L bracket under each shelf corner, hooked into the side
 *  slots. Four per shelf (CATALOG names the part, not its size). */
export const SHELF_SUPPORT_SIZE = mm(50)

// ── Cross-bracing ───────────────────────────────────────────────────────────

/**
 * CATALOG (p.13): "just one cross-brace … units of up to 2,5 m … two are used
 * for higher units."
 *
 * Derived rather than stored — see `crossBraceSets`. A stored count could
 * disagree with the height that decides it, and the whole point of the rule is
 * that the height decides it.
 */
export const CROSS_BRACE_ONE_SET_MAX = mm(2500)
/** ASSUMPTION. Brace section. */
export const CROSS_BRACE_SECTION = mm(18)

// ── Back panels ─────────────────────────────────────────────────────────────

export type BackPanelId = 'none' | 'metal' | 'mesh'

/** ASSUMPTION. Panel thickness; the catalogue names sheet and mesh without a
 *  section for either. */
export const BACK_PANEL_THICKNESS = mm(15)

/** CATALOG. A meshed panel is electro-welded on a 50 × 50 mm grid — printed
 *  because it is the figure a sprinkler calculation needs. */
export const MESH_APERTURE = mm(50)

// ── Doors ───────────────────────────────────────────────────────────────────

/**
 * CATALOG. "Doors … for units 1,000 mm in length", in 1,000 and 2,000 mm
 * heights, two leaves plus top and bottom beams and a lock.
 *
 * The length restriction is the reason this is a validation rule rather than a
 * free choice: a door ordered for a 1,250 mm bay does not exist.
 */
export const DOOR_BAY_LENGTH = mm(1000)
export const DOOR_HEIGHTS: readonly number[] = [mm(1000), mm(2000)]
export const DOOR_LEAVES = 2
/** ASSUMPTION. Leaf thickness. */
export const DOOR_LEAF_THICKNESS = mm(20)

// ── Dividers ────────────────────────────────────────────────────────────────

/**
 * CATALOG. Slotted shelf divider heights. 100 mm exists only in the M3 divider
 * and attaches to the lower shelf alone — it is too short to reach the one
 * above, which is why it is a different fixing rather than a shorter version of
 * the same part.
 */
export const DIVIDER_HEIGHTS: readonly number[] = [
  mm(100),
  mm(225),
  mm(300),
  mm(400),
  mm(500),
  mm(550),
]
/** CATALOG. The divider series is published to 500 mm depth; a 600 mm bay
 *  carries the 500 mm divider with the back 100 mm open. */
export const DIVIDER_MAX_DEPTH = mm(500)
/** ASSUMPTION. Divider sheet thickness. */
export const DIVIDER_THICKNESS = mm(3)
/** CATALOG. Below this height the divider fixes to the lower shelf only. */
export const DIVIDER_LOWER_ONLY_MAX = mm(100)

// ── Footplate ───────────────────────────────────────────────────────────────

/** ASSUMPTION. The catalogue names two footplate models (plastic and metal)
 *  and publishes no plan size for either. One geometry serves both; the
 *  material is not a schema field because nothing downstream reads it. */
export const FOOTPLATE_THICKNESS = mm(10)

// ── Finish ──────────────────────────────────────────────────────────────────

/**
 * CATALOG (p.30): "Blue Ral 5014 (frame uprights) and Grey Ral 7035 (other
 * components)".
 *
 * RESEARCHED for the hex: RAL numbers are physical colour standards, not sRGB
 * values, and independent converters disagree in the last digit. These are
 * nominal — a job that has to match a physical sample needs the sample.
 */
export const UPRIGHT_COLOR = '#637d96'
export const COMPONENT_COLOR = '#c5c7c4'

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Round a level elevation onto the 25 mm slot grid. Every level in this
 *  system, with no second face and no second rule. */
export function snapToSlot(elevation: number): number {
  return Math.round(elevation / SLOT_PITCH) * SLOT_PITCH
}

/** CATALOG. Nearest published shelf length, for the panel to report against. */
export function nearestShelfLength(length: number): number {
  let best = SHELF_LENGTHS[0] ?? length
  for (const candidate of SHELF_LENGTHS) {
    if (Math.abs(candidate - length) < Math.abs(best - length)) best = candidate
  }
  return best
}

/** Whether a height appears in either published series. */
export function frameHeightPublished(height: number): 'common' | 'es-only' | 'unlisted' {
  if (FRAME_HEIGHTS.some((h) => Math.abs(h - height) < 1e-9)) return 'common'
  if (FRAME_HEIGHTS_ES.some((h) => Math.abs(h - height) < 1e-9)) return 'es-only'
  return 'unlisted'
}

/**
 * CATALOG. The tallest published divider that fits in a clear opening.
 *
 * Derived from the space rather than stored per level: a user who lowers the
 * shelf above should not be left with a divider taller than the gap, and the
 * catalogue's series is what is orderable. Returns `null` when nothing in the
 * series fits — a 90 mm opening takes no divider at all.
 */
export function dividerHeightFor(clearHeight: number): number | null {
  let best: number | null = null
  for (const candidate of DIVIDER_HEIGHTS) {
    if (candidate <= clearHeight + 1e-9 && (best === null || candidate > best)) best = candidate
  }
  return best
}
