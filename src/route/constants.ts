import { NARROW_STRIPE_M } from './catalog'

/**
 * Figures the markings need that nobody publishes.
 *
 * The split `./catalog.ts` opens with: published there, estimated here, each
 * named with the reasoning that produced it. A number never crosses the line.
 */

/**
 * The three stripe widths offered, metres.
 *
 * `narrow` is the published floor (see `./catalog.ts`). `standard` and `wide`
 * are **estimates**, and their basis is trade practice rather than a document:
 * 75 mm and 100 mm are the widths floor-marking tape is sold in, and a painted
 * line is set out to match the tape it will eventually be patched with.
 *
 * A named set rather than a number, for the reason `cargoColor` became one: the
 * stripe width moves every boundary vertex, so it enters the geometry key, and
 * a free number would mint a buffer per stop of a drag.
 */
export const LINE_WIDTHS = {
  narrow: NARROW_STRIPE_M,
  standard: 0.075,
  wide: 0.1,
} as const

export const LINE_WIDTH_IDS = ['narrow', 'standard', 'wide'] as const
export type LineWidthId = (typeof LINE_WIDTH_IDS)[number]

/**
 * **How far a mitre may run before the corner is cut off instead: 4.**
 *
 * An estimate, and the basis is what happens without it. Offsetting a polyline
 * outward puts each corner's outer vertex at `offset / sin(θ/2)` from the
 * centreline, which goes to infinity as the turn approaches a hairpin — a 10°
 * turn on a 75 mm stripe throws the mitre point 0.43 m past the corner, and the
 * paint grows a spike nobody drew.
 *
 * Four is also roughly where a marking crew stops mitring and paints the bevel,
 * which is the other reason to cut there: past that angle the drawing and the
 * floor stop agreeing.
 */
export const MITER_LIMIT = 4

/**
 * How the paint sits above the slab, in depth-buffer terms rather than metres.
 *
 * **Not a lift.** A marking is coplanar with the floor by construction, and the
 * obvious fix — raising it a millimetre or two — is wrong here for a reason the
 * pallet's own offsets hide: a metric lift is correct at exactly one distance.
 * On this renderer's `near = 0.1 / far = 1000` buffer the resolvable step grows
 * with the square of distance, so 1.5 mm reads at a metre and vanishes at fifty,
 * and a 15,000 m² floor is a box a camera routinely views from a hundred.
 *
 * `polygonOffset` biases in depth-buffer units instead, and scales that bias by
 * the polygon's own depth slope — so the grazing view down a fifty-metre aisle,
 * which is the worst case for a constant offset, automatically gets the largest
 * correction. The mechanism is already proven on this backend by the host's own
 * measurement chrome, which uses factor/units pairs of −2/−2 and −3/−3.
 *
 * Two ranks, not seven: within one route nothing is coplanar with anything else
 * (stripes sit at the edges, arrows and dividers on the axis, and the two are
 * mutually exclusive), so the only overlap is route over route. A pedestrian
 * route paints over a vehicle aisle, which is also the real-world reading order.
 */
export const DEPTH_BIAS = {
  factor: -1,
  vehicleUnits: -2,
  pedestrianUnits: -4,
} as const

/**
 * The most vertices a route may carry.
 *
 * A cap rather than none, because the centreline is quantised into the geometry
 * cache key: an unbounded polyline is an unbounded key, and a key long enough to
 * be a memory concern is a sign the shape should have been split anyway. Sixty
 * four covers a route round the whole perimeter of a 15,000 m² building with
 * room to spare.
 */
export const MAX_VERTICES = 64
