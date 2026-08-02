import { BaseNode, nodeType } from '@pascal-app/core'
import { z } from 'zod'
import { migratedObjectId } from '../ids'
import { PALLET_PRESET_IDS } from '../pallet/presets'

/**
 * Drive-in pallet racking — **one lane**.
 *
 * Source: Mecalux *Drive-in Pallet Racking* (en_GB, MK-00200042-09/22); page
 * references below are to that PDF.
 *
 * ## Why a lane and not a block
 *
 * The same decision the selective rack made when it became one node per bay,
 * for the same reasons. A block is a line of these nodes along local +X at
 * exactly `laneClearWidth + uprightWidth`; at that spacing adjacent lanes share
 * their upright frame line, so ten lanes stand on eleven frame lines — which is
 * how drive-in is really built.
 *
 * One node per block would re-create every problem the rack's schema v1 had:
 * sub-selection to reach a lane, a footprint that fights the host's move tool,
 * and an undo step that swallows the whole block. One node per *frame* would be
 * worse still — a frame is not a thing a user places; a lane is.
 *
 * A **double-entry block** is two blocks back to back, i.e. two rows rotated
 * 180° from each other. No field for it, exactly as back-to-back needs none in
 * the selective rack.
 *
 * ## Axis mapping
 *
 * The catalogue draws X frontal, Y into the lane, Z up. This repo is Y-up, so:
 * catalogue X → local **X** (lane width), catalogue Z → local **Y** (vertical),
 * catalogue Y → local **Z** (depth), with the **aisle face at +Z** — the same
 * convention `rack/slots.ts` uses when it puts depth position 1 at the front.
 *
 * Every dimension is metres.
 */
export const DriveInRackNode = BaseNode.extend({
  id: migratedObjectId('drive-in-rack', 'drive_in_rack'),
  type: nodeType('warehouse:drive-in-rack'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  // ── The lane ──────────────────────────────────────────────────────────────

  /**
   * Clear entry width E between the two upright faces.
   *
   * p.18: E = load width + 150 (75 mm each side, increased for tall pallets).
   * The default is the table's first row — a flush 1200 mm load long-side-out.
   */
  laneClearWidth: z.number().min(0.9).max(2.2).default(1.35),

  /** Pallet positions one behind another into local −Z. */
  palletsDeep: z.number().int().min(1).max(16).default(4),

  /** Gap per unit load into the depth. p.19 fig.4: 25 mm minimum. */
  depthClearance: z.number().min(0.01).max(0.2).default(0.025),

  /**
   * Both ends open instead of one aisle face.
   *
   * The difference is the stock rule, not the steel: one open end accumulates
   * LIFO, two open ends let a lane be loaded at one face and picked at the
   * other, which is FIFO. p.13 forbids constructive system 3 with it, because
   * that system's bracing stands across the far end.
   */
  entryMode: z.enum(['drive-in', 'drive-through']).default('drive-in'),

  // ── Levels ────────────────────────────────────────────────────────────────

  /**
   * Rail levels above the floor.
   *
   * The floor is always a storage level in a drive-in lane — a truck drives in
   * over it — so there is no `groundLevelStorage` switch to mirror.
   */
  levels: z.number().int().min(0).max(10).default(3),

  /**
   * Clear opening under a rail level: floor to the first rail's underside, then
   * load-top to the next rail's underside.
   *
   * Stored as a clear opening rather than a pitch, the way the selective rack
   * stores it, so the two kinds read the same way. The catalogue publishes the
   * pitch F = unit load + 150 (GP) / + 300 (C) and the rail costs its own
   * height on top; `lanes.ts` carries the derivation.
   */
  levelClear: z.number().min(0.3).max(4).default(1.45),

  /**
   * Per-level overrides, index 0 = the floor opening. `null` leaves every level
   * on the default — which is the state every saved scene starts in.
   *
   * Same single-reader contract as `rack.levelClears`: exactly one function
   * resolves it, so geometry, slots, plan and panel cannot disagree.
   */
  levelClears: z.array(z.number().min(0.3).max(4).nullable()).max(11).nullable().default(null),

  /** Clear above the top rail's load before the top beam. p.19: G = load + 200. */
  topClear: z.number().min(0.3).max(4).default(1.55),

  /**
   * Total post height. Caps how many rail levels actually fit, the way
   * `uprightHeight` does on the selective rack.
   *
   * The default is the catalogue's own worked example: 3 × 1.5 + 1.55 = 6.05.
   */
  uprightHeight: z.number().min(1).max(20).default(6.05),

  // ── Rails ─────────────────────────────────────────────────────────────────

  /** p.17. GP self-centres and needs uniform pallets; C takes mixed widths. */
  railType: z.enum(['gp', 'c']).default('gp'),

  // ── Steel ─────────────────────────────────────────────────────────────────

  /** Upright section across the block (local X). Default A127 (p.15 fig.8). */
  uprightWidth: z.number().min(0.05).max(0.25).default(0.122),
  /** Upright section into the depth (local Z). */
  uprightDepth: z.number().min(0.05).max(0.25).default(0.08),

  /**
   * Post spacing along the lane depth. `null` derives one post per pallet
   * position.
   *
   * CHOSEN DEFAULT, and the reason is a gap in the source: the catalogue ties
   * frame depth to "aisle dimensions and pallet size" (p.17) without publishing
   * a table, while the p.16 render shows a post at each position. The field
   * exists so a real frame table can override the derivation the day one
   * arrives, rather than the derivation being buried in the geometry.
   */
  postPitchZ: z.number().min(0.5).max(3).nullable().default(null),

  /**
   * Top beam profile height. CHOSEN DEFAULT — the catalogue names the part
   * (p.16 #2) but publishes no section.
   */
  topBeamHeight: z.number().min(0.06).max(0.3).default(0.12),

  /**
   * p.12–13. What holds the block up sideways.
   *
   * cs1 is base bracing only; cs2 adds rigidising lanes and upper cross braces;
   * cs3 puts a vertical braced plane at the back of a single-entry block (or
   * the centre of a double-entry one) — which is why it cannot coexist with
   * drive-through, where that plane would stand across the far entrance.
   */
  constructiveSystem: z.enum(['cs1', 'cs2', 'cs3']).default('cs2'),

  // ── Guidance & accessories ────────────────────────────────────────────────

  /** p.22–23. Floor guides for the truck. Recommended on deep lanes. */
  guideRails: z.boolean().default(false),
  guideVariant: z.enum(['lpn50', 'vgpc', 'single', 'u-profile']).default('lpn50'),

  /** p.24. GP entrance centralisers — meaningless on a C rail, which centres
   *  nothing by design. */
  centralisers: z.boolean().default(true),

  /** p.25. Impact reinforcer on the first post of the aisle face. */
  uprightReinforcer: z.boolean().default(true),

  // ── Unit load ─────────────────────────────────────────────────────────────

  palletPreset: z.enum(PALLET_PRESET_IDS).default('epal-1'),

  /**
   * Which pallet face looks at the aisle.
   *
   * Long-side-out by default, and this is the reverse of the selective rack's
   * default for a physical reason: an EPAL 1's bottom boards run along its
   * 1200 mm length, so turning that length across the lane lays them **across**
   * both rails (p.8 fig.1 "YES"). Short-side-out lays them along the rails with
   * nothing under the middle — allowed for rigid pallets, so the panel warns
   * rather than forbids.
   */
  palletOrientation: z.enum(['short-side-out', 'long-side-out']).default('long-side-out'),

  /** Side clearance load ↔ structure, per side. p.18: 75 mm minimum. */
  clearanceSide: z.number().min(0.03).max(0.3).default(0.075),

  // ── Illustrative fill & finish ────────────────────────────────────────────

  /**
   * Fraction of empty positions drawn as lightweight ghost stock.
   *
   * Zero by default for the reason the selective rack gives: placing a lane
   * should give a lane, not phantom inventory nobody put there.
   */
  ghostFill: z.number().min(0).max(1).default(0),

  uprightColor: z.string().default('#1e40af'),
  beamColor: z.string().default('#f97316'),
  /** Galvanised. PHOTO-ESTIMATED from the catalogue renders — no RAL published. */
  railColor: z.string().default('#b3b8bc'),

  /** Slab the lane stands on, elected at placement time. */
  supportSlabId: z.string().nullable().default(null),
})

export type DriveInRackNode = z.infer<typeof DriveInRackNode>
