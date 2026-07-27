import { LINE_WIDTHS, type LineWidthId, MITER_LIMIT } from './constants'

/**
 * Where the paint goes, given a centreline and a clear width.
 *
 * **One module, because `width` means the CLEAR width** — inside face of paint
 * to inside face of paint — and three different consumers need three different
 * extents from that one number. If the geometry builder, the plan symbol and the
 * intrusion check each derived their own, the schema's datum would be fiction
 * within a release, which is exactly what `rack/envelope.ts` was written to stop
 * happening one axis over.
 *
 * The paint sits OUTSIDE the clear width. A 3.2 m aisle with 75 mm stripes is
 * 3.2 m of usable floor between two lines whose centres are 3.275 m apart and
 * whose outer edges are 3.35 m apart. Getting that inside-out is a 150 mm error
 * that looks correct in every screenshot.
 */

export type Point = readonly [number, number]

/** The clear floor, from the axis. */
export function clearHalfWidthM(widthM: number): number {
  return widthM / 2
}

/** Where a stripe's own centreline runs — what the geometry offsets to. */
export function stripeCentreOffsetM(widthM: number, lineWidth: LineWidthId): number {
  return (widthM + LINE_WIDTHS[lineWidth]) / 2
}

/** The outer edge of the paint, for bounds and for the plan symbol. */
export function outerHalfWidthM(widthM: number, lineWidth: LineWidthId): number {
  return widthM / 2 + LINE_WIDTHS[lineWidth]
}

const EPSILON = 1e-9

/**
 * Coincident vertices dropped before anything is offset.
 *
 * **This is not tidiness; it is what keeps the mitre alive.** A zero-length leg
 * makes `direction()` return `null`, which sends both of its endpoints down the
 * end-vertex branch below — so each is offset along its own segment's normal
 * instead of along the shared bisector, and the corner comes out chamfered:
 * an unpainted wedge outside the bend and a crossed, short stripe inside it.
 * That is precisely the failure this module exists to prevent, arriving through
 * the back door.
 *
 * Duplicates are not hypothetical. Any click path that fires twice for one
 * physical click produces them, and a hand-drawn polyline can carry one from a
 * double click. Cleaning here means no caller has to remember.
 */
function withoutRepeats(points: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const point of points) {
    const previous = out.at(-1)
    if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 1e-6) continue
    out.push([point[0], point[1]])
  }
  return out
}

function direction(from: Point, to: Point): Point | null {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const length = Math.hypot(dx, dz)
  if (length < EPSILON) return null
  return [dx / length, dz / length]
}

/** A direction turned a quarter turn, so a positive offset is consistently one
 *  side of the run and a negative one the other. */
function normalOf(d: Point): Point {
  return [-d[1], d[0]]
}

/**
 * The centreline pushed sideways by `offset`, mitred at the corners.
 *
 * Each vertex moves along the **angle bisector**, not along either segment's own
 * normal, and by `offset / sin(θ/2)` rather than by `offset` — which is what
 * keeps both offset segments parallel to their originals and makes them actually
 * meet. Offsetting each segment independently and joining the results leaves a
 * notch on the inside of every bend and a gap on the outside.
 *
 * Past {@link MITER_LIMIT} the mitre is cut back to a bevel. Without that a
 * hairpin throws the outer vertex arbitrarily far past the corner — the paint
 * grows a spike nobody drew, and the sharper the turn the longer the spike.
 */
export function offsetCentreline(points: readonly Point[], offset: number): Point[] {
  const cleaned = withoutRepeats(points)
  if (cleaned.length < 2) return cleaned.map((p) => [p[0], p[1]] as Point)

  const points_ = cleaned
  const result: Point[] = []
  for (let i = 0; i < points_.length; i++) {
    const here = points_[i]
    if (!here) continue

    const before = i > 0 ? points_[i - 1] : undefined
    const after = i < points_.length - 1 ? points_[i + 1] : undefined
    const incoming = before ? direction(before, here) : null
    const outgoing = after ? direction(here, after) : null

    // An end vertex has one direction, so its own normal is the bisector.
    const dPrev = incoming ?? outgoing
    const dNext = outgoing ?? incoming
    if (!dPrev || !dNext) {
      result.push([here[0], here[1]])
      continue
    }

    const nPrev = normalOf(dPrev)
    const nNext = normalOf(dNext)
    let mx = nPrev[0] + nNext[0]
    let mz = nPrev[1] + nNext[1]
    const mLength = Math.hypot(mx, mz)

    // A doubling-back segment has opposing normals that cancel. There is no
    // bisector to follow, so the incoming normal is the only honest answer.
    if (mLength < EPSILON) {
      result.push([here[0] + nPrev[0] * offset, here[1] + nPrev[1] * offset])
      continue
    }

    mx /= mLength
    mz /= mLength
    const alignment = mx * nPrev[0] + mz * nPrev[1]
    const scale = Math.min(MITER_LIMIT, 1 / Math.max(Math.abs(alignment), 1 / MITER_LIMIT))
    result.push([here[0] + mx * offset * scale, here[1] + mz * offset * scale])
  }
  return result
}

/** Total run of a centreline, metres. */
export function routeLengthM(points: readonly Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (!a || !b) continue
    total += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return total
}
