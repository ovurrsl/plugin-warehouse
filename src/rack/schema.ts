import { BaseNode, nodeType } from '@pascal-app/core'
import { z } from 'zod'
import { migratedObjectId } from '../ids'
import { PALLET_PRESET_IDS } from '../pallet/presets'

/**
 * Adjustable pallet racking — **one bay**.
 *
 * A run is not one node with a bay count; it is a line of these, each its own
 * node. That is the whole shape of this kind, and everything else follows from
 * it: a bay can be selected, moved, copied, deleted and multi-selected with the
 * host's own machinery, and none of it needs a sub-selection system.
 *
 * The trade is draw calls — a twenty-bay run is twenty meshes rather than one.
 * It is a deliberate choice in favour of every bay being an ordinary object.
 *
 * **Bays still share their upright frames.** A bay always builds its left
 * frame and builds its right frame only when nothing abuts it (see
 * `./neighbours`), so two bays standing at one bay pitch show one post between
 * them, exactly as racking is really built — and a bay dragged clear grows its
 * own closing frame.
 *
 * Every dimension is metres.
 */
export const PalletRackNode = BaseNode.extend({
  id: migratedObjectId('pallet-rack', 'pallet_rack'),
  type: nodeType('warehouse:pallet-rack'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  // ── The bay ───────────────────────────────────────────────────────────────

  /** Clear entry width of the bay, measured between the two uprights. */
  bayClearWidth: z.number().min(0.6).max(6).default(2.7),

  /** Frame depth, front upright face to rear upright face. */
  depth: z.number().min(0.4).max(2.5).default(1.1),

  /** Total post height. Caps how many beam levels actually fit. */
  uprightHeight: z.number().min(1).max(20).default(5),

  /**
   * Pallets stored one behind another on the same accessible face.
   *
   * Not the same thing as standing two bays back to back, and the difference is
   * the aisle: back to back is two bays each served from its own aisle, every
   * position directly reachable. Double-deep is two positions served from *one*
   * aisle, so the rear pallet cannot be reached until the front one is moved. It
   * needs telescopic double-depth forks and suits SKUs held several pallets
   * deep.
   *
   * This is a property of the bay, which is why it survived the move to one node
   * per bay while rows did not: a second row is a second node, a second depth
   * position is not.
   */
  depthPositions: z.number().int().min(1).max(2).default(1),

  /** Gap between the front and rear pallet positions of a double-deep bay. */
  depthGap: z.number().min(0).max(0.5).default(0.05),

  // ── Levels ────────────────────────────────────────────────────────────────

  /**
   * Beam levels above the floor. The floor itself is also a storage position
   * when `groundLevelStorage` is set, so storage levels total `levels + 1`.
   */
  levels: z.number().int().min(0).max(15).default(3),

  /**
   * Kat başına açıklık geçersiz kılmaları, metre. İndeks = kat (0 = zemin
   * açıklığı). `null` eleman o katı varsayılanına bırakır (`firstLevelClear` /
   * `levelClear` / picking açıklığı); dizinin kendisi `null` iken hiçbir kat
   * geçersiz kılınmaz — kaydedilmiş her eski sahne o hâldedir.
   *
   * Tek okuyucusu `levelClearOpening`: yükseklik hesabına giren TEK kapı
   * orası olduğu için geometri, yuvalar, hayalet stok ve plan aynı anda ve
   * kendiliğinden doğru kalır.
   */
  levelClears: z.array(z.number().min(0.3).max(6).nullable()).max(16).nullable().default(null),

  /** Clear height under the first beam level. */
  firstLevelClear: z.number().min(0.2).max(6).default(1.5),

  /** Clear height between one beam level's top and the next beam's underside. */
  levelClear: z.number().min(0.2).max(6).default(1.4),

  /** Whether goods stand on the floor inside the bay as well as on the beams. */
  groundLevelStorage: z.boolean().default(true),

  /** Rated load per beam level, kg. Reported by the capacity panel. */
  levelCapacity: z.number().min(0).max(20_000).default(3000),

  /**
   * Lowest N levels left open as a walkway through the bay.
   *
   * A safety passageway, which regulations require through long blocks. The
   * frames stay — they carry the levels above — but the beams and everything on
   * them are omitted below this height.
   *
   * A node field rather than a per-bay override, because a bay *is* a node now:
   * a fire route through a twenty-bay run is `tunnelLevels` set on the two bays
   * it crosses.
   */
  tunnelLevels: z.number().int().min(0).max(15).default(0),

  // ── Picking levels ────────────────────────────────────────────────────────

  /**
   * How many of the lowest storage levels are picked by hand rather than
   * holding pallets.
   *
   * Counted from the floor because that is where picking physically happens —
   * an operator on foot reaches the bottom one or two levels, and the pallets
   * above replenish them. A count covers that case in one field and keeps every
   * rack in a run identical, which is what lets them share geometry.
   */
  pickingLevels: z.number().int().min(0).max(15).default(0),

  /**
   * Explicit type per level, index 0 being the floor. Null derives from
   * `pickingLevels`.
   *
   * The escape hatch for a rack that is genuinely mixed out of order. Use it
   * sparingly: an explicit list makes the rack's geometry unique, so a run of
   * fifty racks that would otherwise share one mesh becomes fifty meshes.
   */
  levelTypes: z
    .array(z.enum(['pallet', 'picking']))
    .nullable()
    .default(null),

  /** Clear opening above a picking level. */
  pickingLevelClear: z.number().min(0.15).max(3).default(0.6),

  /** Picking beam profile height — the ZS-60P is a 60 mm section, half a
   *  pallet beam, because it carries shelves rather than unit loads. */
  pickingBeamHeight: z.number().min(0.04).max(0.2).default(0.06),

  /** Shelf panel thickness on a picking level. */
  pickingShelfThickness: z.number().min(0.005).max(0.06).default(0.025),

  /** Container size. Defaults to the 600 × 400 Euro footprint, which tiles an
   *  EPAL 1 deck exactly four to a layer. */
  pickingBoxWidth: z.number().min(0.1).max(1.5).default(0.6),
  pickingBoxDepth: z.number().min(0.1).max(1.5).default(0.4),
  pickingBoxHeight: z.number().min(0.05).max(1).default(0.22),

  /** Clearance at the shelf edges and between containers. */
  pickingBoxGap: z.number().min(0).max(0.2).default(0.02),

  /** Overrides for the derived container grid. Null computes it from the size. */
  pickingBoxesAcross: z.number().int().min(1).max(30).nullable().default(null),
  pickingBoxesDeep: z.number().int().min(1).max(10).nullable().default(null),

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

  /**
   * A beam pair at floor level.
   *
   * Off by default because it obstructs the ground position: a truck placing a
   * pallet on the floor of the bay has to clear it. Racks that carry nothing on
   * the floor use it as a bottom tie.
   */
  hasGroundBeam: z.boolean().default(false),

  /**
   * Bars fitted perpendicular to the beams, under each pallet.
   *
   * Needed when the pallet's bottom deckboards run *parallel* to the beams
   * instead of across them, which is exactly what turning a Euro pallet
   * long-side-out does: its three bottom boards run along the 1200 mm length,
   * so long-side-out leaves them lying on the beams lengthwise with nothing
   * under the middle. The catalogue calls for one to three bars per pallet
   * depending on pallet quality and weight.
   *
   * Null derives it from the orientation, which is the case that actually
   * matters — a user who flips to long-side-out for picking should not have to
   * know this rule to get a rack that would stand up.
   */
  palletSupportBars: z.number().int().min(0).max(3).nullable().default(null),

  // ── Slots ─────────────────────────────────────────────────────────────────

  /** Pallet standard the slots are laid out for. */
  palletPreset: z.enum(PALLET_PRESET_IDS).default('epal-1'),

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
