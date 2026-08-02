/**
 * Drive-in pallet racking catalogue tables.
 *
 * Source: Mecalux *Drive-in Pallet Racking* (en_GB, MK-00200042-09/22). Page
 * references are to that PDF and appear on every entry — the repo's rule is
 * that a number either cites a source or says out loud that it was chosen.
 *
 * The four upright profiles this kind shares with selective racking are
 * **imported** from `../rack/standards`, not copied: two tables of the same
 * sections would agree until one of them was edited.
 */

import { UPRIGHT_PROFILES, type UprightProfileId } from '../rack/standards'

/**
 * Catalogue figures are published in millimetres and this package stores
 * metres, so every table entry is written through this rather than as a
 * pre-divided decimal. Keeps the tables diffable against the PDF and keeps the
 * "no bare dimension literal over 100" rule intact.
 */
const mm = (value: number): number => value / 1000

// ── Uprights ────────────────────────────────────────────────────────────────

/**
 * The 160 profile, which drive-in adds to the shared range.
 *
 * A block accumulating four pallets deep carries far more of them per frame
 * line than a selective bay does, and the catalogue answers that with a
 * heavier section (p.15 fig.8). The other four live in `rack/standards.ts`.
 */
export const DRIVE_IN_UPRIGHT_160 = {
  label: '160',
  width: mm(162),
  depth: mm(80),
  footplate: null,
} as const

export type DriveInUprightId = UprightProfileId | '160'

export const DRIVE_IN_UPRIGHTS = {
  ...UPRIGHT_PROFILES,
  '160': DRIVE_IN_UPRIGHT_160,
} as const

// ── Rails ───────────────────────────────────────────────────────────────────

export type RailTypeId = 'gp' | 'c'

export type RailProfile = {
  label: string
  /** Section across the lane (local X), metres. */
  width: number
  /** Section height (local Y), metres — the pallet rests on the top face. */
  height: number
  /** Whether the profile centres a pallet by its own shape. */
  selfCentring: boolean
  /**
   * Clear span between the two rails' inner noses at the catalogue's reference
   * load, metres. Fixed for GP; `null` for C, whose position follows the load.
   */
  clearSpan: number | null
  note: string
}

/**
 * p.17. Two rail families, and the choice is not cosmetic.
 *
 * GP is a triangular self-centring section: it steers a pallet onto its seat
 * as the truck lowers, at the cost of 50 mm of clear opening and the
 * requirement that every pallet in the block be the same width. C is a plain
 * 100 mm channel that takes mixed widths and centres nothing.
 */
export const RAIL_PROFILES: Record<RailTypeId, RailProfile> = {
  gp: {
    label: 'GP — self-centring',
    width: mm(104),
    height: mm(50),
    selfCentring: true,
    // p.18 frontal-dimensions table: D is 1.026 for every published entry
    // width, which is what makes the nose inset follow E rather than the load.
    clearSpan: mm(1026),
    note: 'Triangular self-centring rail. Uniform pallet width only (p.17).',
  },
  c: {
    label: 'C — channel',
    width: mm(50),
    height: mm(100),
    selfCentring: false,
    clearSpan: null,
    note: 'Plain channel. Takes mixed pallet widths, centres nothing (p.17).',
  },
}

// ── Frontal dimensions ──────────────────────────────────────────────────────

/**
 * p.18. Clear entry width E between the two upright faces.
 *
 * The published series for a GP block; the rule behind it is `load + 150`
 * (75 mm each side, p.18), which is what `laneClearWidthFor` applies for loads
 * the table does not name.
 */
export const FRONTAL_ENTRY_WIDTHS: readonly number[] = [
  mm(1350),
  mm(1400),
  mm(1450),
  mm(1500),
  mm(1550),
]

/** p.18. Side clearance between the unit load and the structure, per side. */
export const SIDE_CLEARANCE_MIN = mm(75)

/**
 * p.18 fig.2 and p.10. How much rail a pallet must actually sit on.
 *
 * Two figures, and the difference is what the pallet is doing: 30 mm is the
 * minimum bearing for a load that has been placed and displaced within its
 * seat, 20 mm the minimum while the truck is still moving it. Reported, never
 * silently corrected.
 */
export const BEARING_MIN_DISPLACED = mm(30)
export const BEARING_MIN_IN_MOTION = mm(20)

/** p.19 fig.4. Clearance per unit load into the lane depth. */
export const DEPTH_CLEARANCE_MIN = mm(25)

// ── Vertical stack ──────────────────────────────────────────────────────────

/**
 * p.19 fig.3 (GP) and p.21 fig.6 (C). Level pitch F above the unit load.
 *
 * The rail costs its own height on top of this, which is why `lanes.ts` stores
 * *clear openings* rather than pitches — see the derivation there.
 */
export const LEVEL_PITCH_ALLOWANCE: Record<RailTypeId, number> = {
  gp: mm(150),
  c: mm(300),
}

/** p.19. Clear G above the top rail's load, before the top beam. */
export const TOP_CLEAR_ALLOWANCE = mm(200)

// ── Guide rails ─────────────────────────────────────────────────────────────

export type GuideVariantId = 'lpn50' | 'vgpc' | 'single' | 'u-profile'

export const GUIDE_VARIANTS: Record<GuideVariantId, { label: string; note: string }> = {
  lpn50: { label: 'LPN50', note: 'Bolted floor angle, the catalogue default (p.22).' },
  vgpc: { label: 'VGPC', note: 'Heavier guide for long lanes (p.22).' },
  single: { label: 'Single-sided', note: 'One side only, where a wall guides the other (p.23).' },
  'u-profile': { label: 'U profile', note: 'Channel guide, deep lanes (p.23).' },
}

/**
 * p.23 table. Clear gap Y between the two guide faces, given the entry width X.
 *
 * A truck steers between the guides rather than between the uprights, so the
 * gap is narrower than the lane by a fixed 110 mm.
 */
export const GUIDE_GAP_INSET = mm(110)

export function guideGapFor(laneClearWidth: number): number {
  return laneClearWidth - GUIDE_GAP_INSET
}

// ── Forklift fit ────────────────────────────────────────────────────────────

/**
 * p.19. How far the mast must lift above the top rail to place on it.
 *
 * Same figure as the top clear allowance and that is not a coincidence: the
 * load has to clear the rail it is being set on by the same margin the
 * structure leaves above it.
 */
export const MAST_CLEAR_ABOVE_TOP_RAIL = mm(200)

/** p.19. Truck body clearance per side inside the lane. */
export const TRUCK_SIDE_CLEARANCE = mm(75)

// ── Derived helpers ─────────────────────────────────────────────────────────

/**
 * p.18. Entry width for a load, snapped up to the published series.
 *
 * Returns the rule's figure when the load is wider than every published entry
 * rather than clamping: a block for a 1.6 m load is buildable, it is simply not
 * in the table, and reporting the table's largest value would be a quiet lie
 * about a structure that would not fit the pallet.
 */
export function laneClearWidthFor(loadWidth: number): number {
  const required = loadWidth + 2 * SIDE_CLEARANCE_MIN
  for (const entry of FRONTAL_ENTRY_WIDTHS) {
    if (entry >= required - 1e-9) return entry
  }
  return required
}

/**
 * p.18 table. How far each rail's inner nose sits in from the upright face.
 *
 * GP publishes a fixed clear span D, so the inset follows the entry width:
 * a wider lane pushes the rails apart and the pallet still lands on the same
 * 1.026 m span. C has no published span — its rails are set to the load — so
 * the inset is derived from the load and the bearing instead.
 */
export function railNoseInset(railType: RailTypeId, laneClearWidth: number, loadAcross: number) {
  const profile = RAIL_PROFILES[railType]
  if (profile.clearSpan !== null) return (laneClearWidth - profile.clearSpan) / 2
  // A C rail is placed so the load overhangs each rail by the displaced-pallet
  // minimum — the tightest arrangement the catalogue permits (p.10, p.18).
  const span = Math.max(0, loadAcross - 2 * BEARING_MIN_DISPLACED)
  return (laneClearWidth - span) / 2
}
