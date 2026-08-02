import { BaseNode, nodeType } from '@pascal-app/core'
import { z } from 'zod'
import { migratedObjectId } from '../ids'

/**
 * Mecalux **M7 Longspan** shelving — one bay.
 *
 * Source: Mecalux M7 catalogue (Catalog 4, en_UN). Numbers are cited in
 * `standards.ts`, each with the provenance it actually has.
 *
 * ## What makes this kind different
 *
 * A selective pallet rack has uniform levels: every level is the same kind of
 * thing at a different height. **M7 does not.** One bay can carry a beam-and-
 * chipboard level, a beamless HM shelf hanging off the upright's side slots, a
 * bare beam pair for long goods, and a hanging-garment level — at the same
 * time, in any order.
 *
 * That is why `levels` here is an **array of level descriptors** rather than a
 * count plus a set of uniform dimensions. Modelling it as a count would force
 * every level in a bay to be the same, which is precisely the arrangement this
 * product exists to avoid.
 *
 * ## Why the two slot pitches matter
 *
 * The frame is punched on two faces: the **front** at 50 mm for beams, the
 * **side** at 25 mm for HM supports and accessories. A level's elevation snaps
 * to whichever face carries it, so a beam level and an HM level standing at
 * "the same" height genuinely are not — and putting both on one pitch would
 * leave half the HM positions in mid-air.
 *
 * A run is a line of these nodes sharing frames: N bays stand on N+1 frames,
 * the same rule the selective rack and the drive-in lane follow.
 *
 * Every dimension is metres.
 */

/** How a level is built. The four the catalogue names. */
export const LevelStructure = z.enum(['beam-shelf', 'reinforced-hm', 'beam-only', 'hanging'])
export type LevelStructure = z.infer<typeof LevelStructure>

export const ShelfKind = z.enum(['chipboard', 'mesh', 'galvanised-picking', 'hm'])
export type ShelfKind = z.infer<typeof ShelfKind>

/**
 * One level of a bay.
 *
 * `elevation` is the load surface, and it is stored rather than derived. That is
 * the opposite of the selective rack and the drive-in lane, and it follows from
 * the mixing: with four structures in one bay there is no single "opening + one
 * profile" rule to accumulate, and the catalogue's own configurator places
 * levels by slot rather than by pitch. The panel snaps each entry to the pitch
 * of the face that carries it, so a stored value is always a real slot.
 */
export const LongspanLevel = z.object({
  /** Load-surface height above the floor. Snapped to 50 mm on beams, 25 mm on
   *  HM side supports — see `levels.ts`. */
  elevation: z.number().min(0).max(20),
  structure: LevelStructure.default('beam-shelf'),
  /** Ignored by `beam-only` and `hanging`, which carry no panel. */
  shelfKind: ShelfKind.default('chipboard'),
  /**
   * Panels side by side across the bay.
   *
   * A galvanised picking shelf comes in ~150 / 300 mm modules, so a long bay
   * carries several of them rather than one wide panel (RESEARCHED, from the US
   * 6″ / 12″ series). Chipboard and mesh are normally one per bay.
   */
  panels: z.number().int().min(1).max(12).default(1),
})
export type LongspanLevel = z.infer<typeof LongspanLevel>

export const LongspanNode = BaseNode.extend({
  id: migratedObjectId('longspan', 'longspan'),
  type: nodeType('warehouse:longspan'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  // ── The bay ───────────────────────────────────────────────────────────────

  /** Clear length between the two frames. CATALOG series: 1.0 / 1.2 / 1.4 /
   *  1.9 / 2.3 / 2.7 m. Free between them, because a run against a wall gets
   *  cut to fit and the panel reports the nearest published length. */
  bayLength: z.number().min(0.6).max(3).default(1.9),

  /** Frame depth. CATALOG series 0.5–1.2 m. */
  frameDepth: z.number().min(0.3).max(1.4).default(0.6),

  /** Frame height. CATALOG series 1.0–8.0 m in half-metre steps. */
  frameHeight: z.number().min(1).max(8).default(2.5),

  // ── Levels ────────────────────────────────────────────────────────────────

  /**
   * Every level, bottom to top.
   *
   * At least one: a frame with no level is two posts, which the catalogue does
   * not sell and a user did not mean to place. The default is a four-level
   * picking bay — the arrangement the catalogue leads with.
   */
  levels: z
    .array(LongspanLevel)
    .min(1)
    .max(20)
    .default([
      { elevation: 0.3, structure: 'beam-shelf', shelfKind: 'chipboard', panels: 1 },
      { elevation: 0.85, structure: 'beam-shelf', shelfKind: 'chipboard', panels: 1 },
      { elevation: 1.4, structure: 'beam-shelf', shelfKind: 'chipboard', panels: 1 },
      { elevation: 1.95, structure: 'beam-shelf', shelfKind: 'chipboard', panels: 1 },
    ]),

  // ── Steel ─────────────────────────────────────────────────────────────────

  uprightProfile: z.enum(['M-7515', 'M-7520', 'M-80MLD', 'M-81MLD']).default('M-7515'),

  /**
   * Beam profile. The number is the section height in mm; ZE is the patented
   * one-piece stamped Z, ZS the welded equivalent.
   *
   * MS-65 is absent from this list on purpose: it is not a bay-wide choice but
   * a *position* — the centre beam of a double-depth chipboard level — and
   * `levels.ts` places it from the depth rather than from a field.
   */
  beamProfile: z.enum(['ZE-35', 'ZE-55', 'ZE-65', 'ZS-35', 'ZS-55', 'ZS-65']).default('ZE-55'),

  /**
   * Vertical cross-bracing in the frame plane.
   *
   * CATALOG: required for down-aisle stability on tall HM units. Off by
   * default because the catalogue's own lead configuration is a low picking
   * bay, which does not carry it.
   */
  crossBracing: z.boolean().default(false),

  // ── Finish ────────────────────────────────────────────────────────────────

  uprightColor: z.string().default('#1e40af'),
  /** RAL 2001 orange. RESEARCHED — resellers name the colour, the hex is
   *  nominal for it. */
  beamColor: z.string().default('#c94f00'),

  /** Slab the bay stands on, elected at placement time. */
  supportSlabId: z.string().nullable().default(null),
})

export type LongspanNode = z.infer<typeof LongspanNode>
