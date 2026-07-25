import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

/**
 * Adjustable pallet racking — a single continuous run of bays.
 *
 * Bays in a run **share their upright frames**: `bayCount` bays stand on
 * `bayCount + 1` frames. That is how racking is actually built, and it is the
 * difference between a rack whose beams land on the posts and one whose beams
 * float — the version this replaces multiplied `bayCount × bayWidth` and
 * ignored the upright entirely, so the frames and the footprint disagreed by
 * one post width per bay.
 *
 * Every dimension is metres.
 */
export const PalletRackNode = BaseNode.extend({
  id: objectId('pallet_rack'),
  type: nodeType('warehouse:pallet-rack'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  // ── Run layout ────────────────────────────────────────────────────────────

  /** Bays along the run. Frames are shared, so this is one fewer than frames. */
  bayCount: z.number().int().min(1).max(40).default(3),

  /** Clear entry width of one bay, measured between the two uprights. */
  bayClearWidth: z.number().min(0.6).max(6).default(2.7),

  /** Frame depth, front upright face to rear upright face. */
  depth: z.number().min(0.4).max(2.5).default(1.1),

  /** Total post height. Caps how many beam levels actually fit. */
  uprightHeight: z.number().min(1).max(20).default(5),

  /**
   * Two runs stood back to back, sharing an aisle on each outer face — the
   * standard double-sided island. Doubles depth; the runs do not share frames.
   */
  backToBack: z.boolean().default(false),
  backToBackGap: z.number().min(0).max(1.5).default(0.2),

  // ── Levels ────────────────────────────────────────────────────────────────

  /**
   * Beam levels above the floor. The floor itself is also a storage position
   * when `groundLevelStorage` is set, so storage levels total `levels + 1`.
   */
  levels: z.number().int().min(0).max(15).default(3),

  /** Clear height under the first beam level. */
  firstLevelClear: z.number().min(0.2).max(6).default(1.5),

  /** Clear height between one beam level's top and the next beam's underside. */
  levelClear: z.number().min(0.2).max(6).default(1.4),

  /** Whether goods stand on the floor inside the bay as well as on the beams. */
  groundLevelStorage: z.boolean().default(true),

  /** Rated load per beam level, kg. Reported by the capacity panel. */
  levelCapacity: z.number().min(0).max(20_000).default(3000),

  // ── Steel profiles ────────────────────────────────────────────────────────

  /** Upright section across the run (local X). Defaults to the A127 profile. */
  uprightWidth: z.number().min(0.05).max(0.25).default(0.122),
  /** Upright section through the frame (local Z). */
  uprightDepth: z.number().min(0.05).max(0.25).default(0.08),
  /** Beam profile height. */
  beamHeight: z.number().min(0.06).max(0.25).default(0.12),
  /** Beam profile thickness. */
  beamThickness: z.number().min(0.02).max(0.15).default(0.05),

  bracing: z.enum(['z-bracing', 'x-bracing', 'open']).default('z-bracing'),
  decking: z.enum(['wire-mesh', 'steel', 'timber', 'open']).default('wire-mesh'),

  // ── Slots ─────────────────────────────────────────────────────────────────

  /** Pallet standard the slots are laid out for. */
  palletPreset: z
    .enum(['epal-1', 'epal-2', 'epal-3', 'epal-6', 'quarter', 'gma-48x40', 'plastic-euro'])
    .default('epal-1'),

  /**
   * Which pallet face looks at the aisle.
   *
   * This is the single most consequential figure in the whole node: on a 2.7 m
   * bay an EPAL 1 turned short-side-out gives three positions and long-side-out
   * gives two — a 50% swing in the capacity the panel reports. It belongs to
   * the rack rather than the pallet, because it describes how the rack is
   * loaded, and the same pallet can be turned either way in two different runs.
   */
  palletOrientation: z.enum(['short-side-out', 'long-side-out']).default('short-side-out'),

  /**
   * Force a slot count per level instead of deriving it from the clear width.
   *
   * Real racks are sometimes loaded below their geometric capacity for handling
   * reasons. Null means "compute it", which is what the geometry supports.
   */
  palletsPerLevel: z.number().int().min(1).max(12).nullable().default(null),

  /**
   * Side clearance between an outer pallet and the upright, per side.
   *
   * 75 mm here and between pallets is what makes the canonical bay work: three
   * 800 mm EPAL 1 across a 2.7 m clear width is 2400 mm of pallet and exactly
   * 300 mm of clearance, split four ways. Raising either default to 100 mm
   * costs the third pallet — the bay then needs 2.75 m — which is a 33% cut in
   * the capacity this rack reports.
   */
  clearanceToUpright: z.number().min(0).max(0.4).default(0.075),
  /** Clearance between two adjacent pallets in the same level. */
  clearanceBetweenPallets: z.number().min(0).max(0.4).default(0.075),

  // ── Illustrative fill ─────────────────────────────────────────────────────

  /**
   * Fraction of otherwise-empty slots drawn as a lightweight ghost load.
   *
   * Deliberately 0 by default: placing a rack should give a rack, not phantom
   * inventory nobody put there. A slot holding a real `warehouse:pallet` node
   * never draws a ghost on top of it, and the capacity panel counts only real
   * pallets — the ghosts are scenery and are reported separately.
   */
  ghostFill: z.number().min(0).max(1).default(0),

  // ── Finish ────────────────────────────────────────────────────────────────

  uprightColor: z.string().default('#1e40af'),
  beamColor: z.string().default('#f97316'),

  /** Slab the rack stands on, elected at placement time. */
  supportSlabId: z.string().nullable().default(null),
})

export type PalletRackNode = z.infer<typeof PalletRackNode>
