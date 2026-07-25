import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

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

  preset: z
    .enum(['epal-1', 'epal-2', 'epal-3', 'epal-6', 'quarter', 'gma-48x40', 'plastic-euro'])
    .default('epal-1'),

  /** Height of the goods stacked on the deck, metres. 0 is an empty pallet. */
  loadHeight: z.number().min(0).max(2.4).default(0),

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
