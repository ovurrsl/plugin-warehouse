import { BaseNode, nodeType } from '@pascal-app/core'
import { z } from 'zod'
import { migratedObjectId } from '../ids'

/**
 * Mecalux **M3 Shelving for picking** — one bay.
 *
 * Source: Mecalux M3 catalogue (Catalog 9, MK-056541). Numbers are cited in
 * `standards.ts`, each with the provenance it actually has.
 *
 * ## What makes this kind different from the other four
 *
 * **There are no beams.** A shelf is a folded panel carried at its four corners
 * by supports that hook into the upright's side slots. That is why the whole
 * system lands on one 25 mm grid — M7 needs two pitches because half its levels
 * ride beams punched at 50 mm, and M3 has no such half.
 *
 * **The bracing is a consequence, not a choice.** The catalogue's rule is one
 * cross-brace set up to 2.5 m and two above it, and a back panel replaces both.
 * `crossBraceSets` derives that from the height and the panel; there is no
 * field, because a stored count could disagree with the two things that decide
 * it.
 *
 * **The loads are real.** Mecalux publishes 150 kg per level for a light-duty
 * shelf and 275 kg for a heavy-duty one. Every other racking kind in this
 * package reports a capacity somebody chose; this one reports one somebody
 * measured, and the panel says so in as many words.
 *
 * A run is a line of these nodes sharing frames: N bays stand on N+1 frames,
 * the same rule the other three racking kinds follow.
 *
 * Every dimension is metres.
 */

/**
 * What a level is.
 *
 * `drawers` is not an accessory bolted onto `shelf` — it is a level whose panel
 * carries a grid of polypropylene drawers, and the number of them is derived
 * from the bay length rather than typed. See `drawerCount`.
 */
export const M3LevelStructure = z.enum(['shelf', 'drawers'])
export type M3LevelStructure = z.infer<typeof M3LevelStructure>

export const M3ShelfModel = z.enum(['HL', 'HM'])
export type M3ShelfModel = z.infer<typeof M3ShelfModel>

/** CATALOG. MA is the 130 mm drawer, MB the 80 mm one. */
export const M3DrawerModel = z.enum(['MA', 'MB'])
export type M3DrawerModel = z.infer<typeof M3DrawerModel>

/** CATALOG. The two published widths: code 12 is 122 mm, code 24 is 246 mm. */
export const M3DrawerWidth = z.enum(['narrow', 'wide'])
export type M3DrawerWidth = z.infer<typeof M3DrawerWidth>

/**
 * One level of a bay.
 *
 * `elevation` is stored and snapped rather than accumulated from an opening,
 * which follows the M7 precedent and the catalogue's own language: "the height
 * of the shelves can be adjusted in increments of 25 mm" describes a position
 * on a grid, not a pitch to stack.
 */
export const M3Level = z.object({
  /** Load-surface height above the floor, snapped to the 25 mm slot grid. */
  elevation: z.number().min(0).max(8),
  structure: M3LevelStructure.default('shelf'),
  /** The panel under the level. A drawer level has one too — the drawers sit
   *  on it — so this applies to both structures. */
  model: M3ShelfModel.default('HL'),
  /**
   * Slotted dividers standing on the shelf.
   *
   * A count, not a height: the height is the tallest published divider that
   * fits the clear opening above, derived in `standards.dividerHeightFor`. A
   * user who lowers the shelf above should not be left holding a divider
   * taller than the gap.
   */
  dividers: z.number().int().min(0).max(12).default(0),
  drawerModel: M3DrawerModel.default('MA'),
  drawerWidth: M3DrawerWidth.default('wide'),
})
export type M3Level = z.infer<typeof M3Level>

export const M3ShelvingNode = BaseNode.extend({
  id: migratedObjectId('m3', 'm3'),
  type: nodeType('warehouse:m3-shelving'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  // ── The bay ───────────────────────────────────────────────────────────────

  /** Clear length between the two frames — the shelf's own length. CATALOG
   *  series 750 / 1.000 / 1.250 / 1.400 mm. Free between them, because a run
   *  against a wall gets cut and the panel reports the nearest published size
   *  rather than moving the bay. */
  shelfLength: z.number().min(0.5).max(2).default(1),

  /** Frame depth, which in this system **is** the shelf depth — there is no
   *  overhang series. CATALOG 300 / 400 / 500 / 600 mm. */
  shelfDepth: z.number().min(0.2).max(0.8).default(0.4),

  /** Frame height. CATALOG common series 1.5–4.0 m; the ES edition adds 1.0 /
   *  2.25 / 3.5; manufacturable to 8.0 m, above which the upright is spliced. */
  frameHeight: z.number().min(0.8).max(8).default(2),

  /** CATALOG: the frame comes in five models. The infill ones replace the
   *  diagonal, which is why this is one enum rather than a diagonal flag plus a
   *  panel flag that could contradict it. */
  frameVariant: z
    .enum(['basic', 'diagonals', 'central-panel', 'side-panel', 'mesh'])
    .default('basic'),

  // ── Levels ────────────────────────────────────────────────────────────────

  /**
   * Every level, bottom to top.
   *
   * At least one: a frame with no shelf is two posts. The default is the
   * catalogue's own lead configuration — a four-level 2 m office bay.
   */
  levels: z
    .array(M3Level)
    .min(1)
    .max(24)
    .default([
      {
        elevation: 0.3,
        structure: 'shelf',
        model: 'HL',
        dividers: 0,
        drawerModel: 'MA',
        drawerWidth: 'wide',
      },
      {
        elevation: 0.8,
        structure: 'shelf',
        model: 'HL',
        dividers: 0,
        drawerModel: 'MA',
        drawerWidth: 'wide',
      },
      {
        elevation: 1.3,
        structure: 'shelf',
        model: 'HL',
        dividers: 0,
        drawerModel: 'MA',
        drawerWidth: 'wide',
      },
      {
        elevation: 1.8,
        structure: 'shelf',
        model: 'HL',
        dividers: 0,
        drawerModel: 'MA',
        drawerWidth: 'wide',
      },
    ]),

  // ── Enclosure ─────────────────────────────────────────────────────────────

  /**
   * CATALOG: a metal or mesh back panel. It also **replaces the cross-bracing**,
   * which is why `crossBraceSets` reads this field — a bay cannot be braced
   * twice and the catalogue does not ask it to be.
   */
  backPanel: z.enum(['none', 'metal', 'mesh']).default('none'),

  /**
   * CATALOG: doors exist **only for 1,000 mm bays**, in 1,000 and 2,000 mm
   * heights, two leaves plus a lock.
   *
   * Stored as the height rather than a boolean because the two heights are two
   * different parts. A door on any other bay length is an error the panel
   * reports — not silently dropped, because the user picked it on purpose and
   * deserves to know it is not orderable.
   */
  door: z.enum(['none', 'h1000', 'h2000']).default('none'),

  // ── Finish ────────────────────────────────────────────────────────────────

  /** CATALOG: RAL 5014 Pigeon Blue on the uprights. The hex is nominal. */
  uprightColor: z.string().default('#637d96'),
  /** CATALOG: RAL 7035 Light Grey on everything else. */
  componentColor: z.string().default('#c5c7c4'),

  /** Slab the bay stands on, elected at placement time. */
  supportSlabId: z.string().nullable().default(null),
})

export type M3ShelvingNode = z.infer<typeof M3ShelvingNode>
