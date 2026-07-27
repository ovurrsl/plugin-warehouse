import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
import { TRUCK_VARIANTS } from '../handling/catalog'
import { PEDESTRIAN_WIDTH_M } from './catalog'
import { LINE_WIDTH_IDS, MAX_VERTICES } from './constants'

/**
 * A marked route across the floor: a pedestrian way or a vehicle aisle.
 *
 * One kind for both, and two catalog tiles, because a walkway and an aisle are
 * the same object wearing a different role — a polyline with a width, painted at
 * its edges — while being two different things to *place*. That split is the one
 * the loaded pallet already uses for its empty and loaded tiles.
 *
 * The older editor shipped this as a host `path` node, which the current host no
 * longer has. Its defects are listed against the fields that replace them.
 */

export const ROUTE_ROLES = ['pedestrian', 'vehicle'] as const
export const ROUTE_TRAFFIC = ['one-way', 'two-way'] as const
export const ROUTE_DATUMS = ['load-face', 'frame-face'] as const

export const RouteNode = BaseNode.extend({
  id: objectId('route'),
  type: nodeType('warehouse:route'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  /**
   * The centreline, node-local, in metres on the XZ plane.
   *
   * **Named `points`, never `polygon`.** The older editor called an open
   * polyline `polygon` — its own comment admitting it was "named 'polygon' to
   * reuse all polygon-editing handles" — and those handles demand three vertices
   * before they will commit, so dragging either end of a straight two-point run
   * silently snapped back on release. A name that lies about what something is
   * eventually makes the thing behave like the lie.
   *
   * The tool keeps the first vertex at the origin so a route's position is its
   * start, but nothing depends on that: the geometry reads every vertex relative
   * to the first, so a hand-edited file with an offset first point still draws
   * correctly and still shares its buffer with an identical run elsewhere.
   */
  points: z
    .array(z.tuple([z.number(), z.number()]))
    .min(2)
    .max(MAX_VERTICES)
    .default([
      [0, 0],
      [5, 0],
    ]),

  role: z.enum(ROUTE_ROLES).default('pedestrian'),

  /**
   * One-way or two-way, and **not cosmetic**.
   *
   * In the older editor `direction` toggled a scrolling stripe animation that
   * the vehicle branch silently dropped anyway, so half the time it did nothing
   * at all. Here it selects the marking — arrows when one-way, a dashed lane
   * divider on a two-way vehicle aisle — and it qualifies the aisle readout,
   * because a published stacking-aisle band describes a single truck working
   * alone and says nothing about two meeting.
   */
  traffic: z.enum(ROUTE_TRAFFIC).default('two-way'),

  /**
   * **The clear width: inside face of paint to inside face of paint, metres.**
   *
   * The one number of the join. It means exactly what `aisleBandForVariant`
   * returns, so comparing the two is subtraction rather than interpretation.
   * The paint sits outside it — see `./stripes`.
   */
  width: z.number().min(0.3).max(20).default(PEDESTRIAN_WIDTH_M),

  /** The painted stripe itself. A named set rather than a number, because it
   *  moves every boundary vertex and so enters the geometry key. */
  lineWidth: z.enum(LINE_WIDTH_IDS).default('standard'),

  /**
   * The truck class this aisle was sized for, or `null` for a walkway.
   *
   * **An id, never a copy of the band.** The moment paint stores `3.2` a
   * catalogue correction stops propagating and the two sides can disagree
   * forever. The vocabulary is the handling section's, so both speak one
   * language.
   */
  requiredFor: z.enum(TRUCK_VARIANTS).nullable().default(null),

  /**
   * Which face the width was measured to.
   *
   * `'load-face'` is the default and the honest one: a pallet overhangs its
   * frame, EU law describes the stripes as declaring the distance to *"any
   * object which may be near by"*, and `rack/standards.ts` publishes its aisle
   * figures between loads. `'frame-face'` is the setting-out line an installer
   * works the steel to, and it is a labelled choice with its own readout —
   * never a silent default.
   *
   * Geometrically inert once drawn: it steers the snap while drawing and labels
   * the reading afterwards, so moving a rack later never silently moves paint.
   */
  datum: z.enum(ROUTE_DATUMS).default('load-face'),

  /** The slab this route is painted on, elected at commit. Pins the vertical
   *  datum so a run clipping a mezzanine corner does not float onto the deck. */
  supportSlabId: z.string().nullable().default(null),
})

export type RouteNode = z.infer<typeof RouteNode>
export type RouteRole = (typeof ROUTE_ROLES)[number]
