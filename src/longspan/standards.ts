/**
 * Mecalux **M7 Longspan** catalogue tables.
 *
 * Sources, and each entry says which one it is:
 *  - `CATALOG`    — printed in the Mecalux M7 catalogue (Catalog 4, en_UN).
 *  - `RESEARCHED` — corroborated from a named reseller or the US Wide Span
 *                   equivalent, converted to metric. Real, but second-hand.
 *  - `ASSUMPTION` — chosen by us. Says so, and says why.
 *
 * Carrying the provenance into the code rather than leaving it in a briefing
 * document is the point: a figure a user reads off a panel should be traceable
 * to whoever is answerable for it, and "we picked this" is a legitimate answer
 * as long as it is the one given.
 */

/** Catalogue figures are millimetres; this package stores metres. Keeps the
 *  tables diffable against the PDF. */
const mm = (value: number): number => value / 1000

export type Provenance = 'CATALOG' | 'RESEARCHED' | 'ASSUMPTION'

// ── Frame ───────────────────────────────────────────────────────────────────

/**
 * CATALOG. Frame heights, 1.0 m to 8.0 m in half-metre steps.
 *
 * Above about 20 m the catalogue moves to walkway-served multi-tier
 * construction, which is a different product and not this kind.
 */
export const FRAME_HEIGHTS: readonly number[] = Array.from({ length: 15 }, (_, index) =>
  mm(1000 + index * 500),
)

/** CATALOG. Published bay lengths. */
export const BAY_LENGTHS: readonly number[] = [
  mm(1000),
  mm(1200),
  mm(1400),
  mm(1900),
  mm(2300),
  mm(2700),
]

/** CATALOG. Published frame depths. */
export const FRAME_DEPTHS: readonly number[] = [
  mm(500),
  mm(600),
  mm(800),
  mm(900),
  mm(1000),
  mm(1100),
  mm(1200),
]

/**
 * CATALOG. The frame is punched on two faces at two different pitches.
 *
 * The **front** face carries the beams at 50 mm; the **side** face carries HM
 * shelf supports and accessories at 25 mm. That is not trivia — it is why a
 * level's height snaps to 50 mm when it rides beams and to 25 mm when it is a
 * reinforced HM shelf hanging off the side slots. One pitch for both would put
 * half the HM positions in mid-air.
 */
export const FRONT_SLOT_PITCH = mm(50)
export const SIDE_SLOT_PITCH = mm(25)

export type UprightProfileId = 'M-7515' | 'M-7520' | 'M-80MLD' | 'M-81MLD'

export type UprightProfile = {
  label: string
  /** Section across the run (local X), metres. */
  width: number
  /** Section into the depth (local Z), metres. */
  depth: number
  provenance: Provenance
  note?: string
}

export const UPRIGHT_PROFILES: Record<UprightProfileId, UprightProfile> = {
  'M-7515': {
    label: 'M-7515',
    width: mm(50),
    depth: mm(53),
    provenance: 'ASSUMPTION',
    note: '50 mm width is CATALOG (profile models, p.12); the 53 mm depth is not printed there.',
  },
  'M-7520': {
    label: 'M-7520',
    width: mm(50),
    depth: mm(53),
    provenance: 'ASSUMPTION',
    note: 'Same section as M-7515 in every published drawing; heavier gauge.',
  },
  'M-80MLD': { label: 'M-80MLD', width: mm(80), depth: mm(69), provenance: 'CATALOG' },
  'M-81MLD': {
    label: 'M-81MLD',
    width: mm(81),
    depth: mm(69),
    provenance: 'ASSUMPTION',
    note: 'Width inferred from the model number; depth shared with M-80MLD.',
  },
}

// ── Beams ───────────────────────────────────────────────────────────────────

export type BeamProfileId = 'ZE-35' | 'ZE-55' | 'ZE-65' | 'ZS-35' | 'ZS-55' | 'ZS-65' | 'MS-65'

export type BeamProfile = {
  label: string
  /** Profile height (local Y), metres — the number in the model name. */
  height: number
  /** Front-to-back section, metres. */
  depth: number
  /** `stamped-Z` is a patented one-piece Z with an upright top flange;
   *  `welded` is the profile welded to its connectors; `flat-top` carries a
   *  shelf that overhangs the module. */
  family: 'stamped-Z' | 'welded' | 'flat-top'
  provenance: Provenance
}

/**
 * CATALOG for the heights and the families; the 30 mm section depth is
 * RESEARCHED — the US Wide Span equivalent publishes 1.18″ and the EU metric
 * figure is not printed.
 *
 * Every beam carries two safety pins (CATALOG). They are a real part and a real
 * assembly step, and the geometry draws them.
 */
export const BEAM_PROFILES: Record<BeamProfileId, BeamProfile> = {
  'ZE-35': {
    label: 'ZE-35',
    height: mm(35),
    depth: mm(30),
    family: 'stamped-Z',
    provenance: 'CATALOG',
  },
  'ZE-55': {
    label: 'ZE-55',
    height: mm(55),
    depth: mm(30),
    family: 'stamped-Z',
    provenance: 'CATALOG',
  },
  'ZE-65': {
    label: 'ZE-65',
    height: mm(65),
    depth: mm(30),
    family: 'stamped-Z',
    provenance: 'CATALOG',
  },
  'ZS-35': {
    label: 'ZS-35',
    height: mm(35),
    depth: mm(30),
    family: 'welded',
    provenance: 'CATALOG',
  },
  'ZS-55': {
    label: 'ZS-55',
    height: mm(55),
    depth: mm(30),
    family: 'welded',
    provenance: 'CATALOG',
  },
  'ZS-65': {
    label: 'ZS-65',
    height: mm(65),
    depth: mm(30),
    family: 'welded',
    provenance: 'CATALOG',
  },
  'MS-65': {
    label: 'MS-65',
    height: mm(65),
    depth: mm(30),
    family: 'flat-top',
    provenance: 'CATALOG',
  },
}

/** CATALOG. Safety pins per beam. */
export const SAFETY_PINS_PER_BEAM = 2

// ── Shelves ─────────────────────────────────────────────────────────────────

export type ShelfKindId = 'chipboard' | 'mesh' | 'galvanised-picking' | 'hm'

export type ShelfKind = {
  label: string
  /** Effective panel thickness, metres. */
  thickness: number
  /** How the panel is carried. */
  restsOn: 'beams' | 'side-slots'
  provenance: Provenance
  note: string
}

export const SHELF_KINDS: Record<ShelfKindId, ShelfKind> = {
  chipboard: {
    label: 'Chipboard',
    thickness: mm(22),
    restsOn: 'beams',
    provenance: 'RESEARCHED',
    note: '22 mm P2 chipboard, confirmed by UK Mecalux resellers. Sits between two ZE/ZS beams; the beam’s vertical edge conceals the front edge.',
  },
  mesh: {
    label: 'Mesh',
    // ASSUMPTION: the catalogue names the part but publishes no thickness. A
    // welded mesh mat plus its cross-ties reads about this deep.
    thickness: mm(30),
    restsOn: 'beams',
    provenance: 'ASSUMPTION',
    note: 'Electro-welded mesh on mesh cross-ties. Thickness chosen; the catalogue names the part without a section.',
  },
  'galvanised-picking': {
    label: 'Galvanised picking',
    thickness: mm(25),
    restsOn: 'beams',
    provenance: 'ASSUMPTION',
    note: 'Sheet metal with a folded edge; ~1 mm sheet reads as ~25 mm with the fold. Standard widths ~150 / 300 mm (RESEARCHED, from the US 6″/12″).',
  },
  hm: {
    label: 'HM reinforced',
    thickness: mm(25),
    restsOn: 'side-slots',
    provenance: 'CATALOG',
    note: 'One-piece folded galvanised sheet on four PK supports in the upright SIDE slots — no beams. Front channel is a label holder.',
  },
}

/** CATALOG. HM shelves come in their own length and depth series, which is
 *  narrower than the frame's. */
export const HM_LENGTHS: readonly number[] = [mm(1000), mm(1250), mm(1400)]
export const HM_DEPTHS: readonly number[] = [mm(300), mm(400), mm(500), mm(600)]

/**
 * CATALOG. A chipboard shelf this long or longer needs Z-TAM clamps.
 *
 * They hold the two beams flush against the board; without them a long span
 * lets the board lift at the edges. Derived rather than stored, so a bay
 * widened past the threshold grows them without anyone remembering to tick a
 * box — and the panel says it happened.
 */
export const ZTAM_MIN_LENGTH = mm(1900)

/**
 * CATALOG. Double-depth chipboard puts an MS-65 down the centre, with ZE/ZS at
 * the two ends. The flat top is what lets the two boards butt over it.
 */
export const MS_CENTRE_MIN_DEPTH_RATIO = 2

// ── Finish ──────────────────────────────────────────────────────────────────

/**
 * RESEARCHED. Resellers describe "orange beams … stamped ZE55"; RAL 2001 is the
 * named colour and the hex is nominal for it.
 */
export const BEAM_COLOR = '#c94f00'
/** ASSUMPTION, matched to the rest of this package's racking blue. */
export const UPRIGHT_COLOR = '#1e40af'

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Round a level elevation onto the slot pitch that actually carries it. */
export function snapToSlot(elevation: number, pitch: number): number {
  return Math.round(elevation / pitch) * pitch
}

/** CATALOG. Whether this level needs the clamps, from the two things that
 *  decide it — never stored, so it cannot go stale. */
export function needsZtamClamp(shelfKind: ShelfKindId, bayLength: number): boolean {
  return shelfKind === 'chipboard' && bayLength >= ZTAM_MIN_LENGTH - 1e-9
}

/** CATALOG. Nearest published bay length, for the panel to report against. */
export function nearestBayLength(length: number): number {
  let best = BAY_LENGTHS[0] ?? length
  for (const candidate of BAY_LENGTHS) {
    if (Math.abs(candidate - length) < Math.abs(best - length)) best = candidate
  }
  return best
}
