import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { CARGO_COLOR_IDS } from './cargo-constants'
import { PALLET_PRESET_IDS } from './presets'

/**
 * One kind covers both the empty pallet and an occupied rack position:
 * `loadHeight: 0` is a bare pallet, anything above it carries a unit load. The
 * fork this replaces shipped `euro-pallet` and `loaded-euro-pallet` as separate
 * kinds with the deck geometry duplicated verbatim between them, so every spec
 * fix had to be made twice.
 *
 * Everything the capacity maths needs lives here rather than in the host's
 * untyped `metadata` blob. That is what makes the stats panel's figures
 * defensible: the fork read `metadata.bayCount ?? 1` from data nothing
 * validated, and a hand-edited scene produced NaN with no complaint.
 */
export const PalletNode = BaseNode.extend({
  id: objectId('pallet'),
  type: nodeType('warehouse:pallet'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  preset: z.enum(PALLET_PRESET_IDS).default('epal-1'),

  /** Height of the goods stacked on the deck, metres. 0 is an empty pallet.
   *  Read only while `cargo` is `'none'` — a typed load derives its height from
   *  the variant its seed resolves to. */
  loadHeight: z.number().min(0).max(2.4).default(0),

  // ── The load ──────────────────────────────────────────────────────────────

  /**
   * What the pallet is carrying, or `'none'` for the plain block this kind has
   * always drawn.
   *
   * **`'none'` is the default and that is a compatibility decision, not a
   * preference.** Every scene saved before this field existed parses without it,
   * defaults to `'none'`, and renders exactly as it did — no migration, and no
   * pallet quietly changing height because a continuous `loadHeight` was snapped
   * to the nearest prepared variant.
   */
  cargo: z.enum(['none', 'carton', 'drum']).default('none'),

  /**
   * The fill range the placement panel was set to, as fractions.
   *
   * **The range is stored and the fill is not.** A pallet's actual fill is
   * `resolveVariant(type, id, range)` — a pure function of its own id — so the
   * scene is a function of its file: reload, export, re-import and undo all
   * reproduce it exactly, where a stored roll would have to be preserved through
   * every one of those paths and a re-rolled one would change the warehouse
   * under the user.
   */
  fillRange: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).default([0.4, 1]),

  /** Detail elements. Defaulted per type at placement time — a carton pallet is
   *  filmed and a drum pallet is not — and overridable after. */
  wrapped: z.boolean().default(true),
  strapped: z.boolean().default(true),
  labelled: z.boolean().default(true),

  /**
   * The goods' own colour, chosen from a prepared set rather than typed as a
   * hex.
   *
   * **Named because the geometry cache is keyed on it.** Hue is carried on the
   * vertices, not by the per-instance tint, so a free-form colour would mint a
   * merged buffer per stop of a colour picker's drag. Each pallet still takes a
   * small seeded tint off whichever of these it names, so a rack full of them
   * does not read as one object pasted a thousand times.
   */
  cargoColor: z.enum(CARGO_COLOR_IDS).default('kraft'),

  /**
   * Slot this pallet occupies, as `bay-level-position`, or null when it is
   * standing on the floor. Stored rather than derived: occupancy is the
   * headline figure of the stats panel, and a stored address survives the
   * pallet being nudged, where a geometric test would start guessing.
   */
  slotAddress: z.string().nullable().default(null),

  /** Rack the slot belongs to. Meaningless without `slotAddress`. */
  slotRackId: z.string().nullable().default(null),

  /**
   * Slab the pallet stands on, elected at placement time. Lets the stats panel
   * scope by slab with a field comparison instead of a polygon test per pallet
   * per recompute.
   */
  supportSlabId: z.string().nullable().default(null),
})

export type PalletNode = z.infer<typeof PalletNode>
