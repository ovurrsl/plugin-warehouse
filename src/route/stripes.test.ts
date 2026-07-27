import { describe, expect, test } from 'bun:test'
import { LINE_WIDTHS, MITER_LIMIT } from './constants'
import {
  clearHalfWidthM,
  offsetCentreline,
  outerHalfWidthM,
  type Point,
  routeLengthM,
  stripeCentreOffsetM,
} from './stripes'

describe('the paint sits outside the clear width', () => {
  test('a 3.2 m aisle with standard stripes measures 3.2 m between the paint', () => {
    // The inside-out error is a 150 mm mistake that looks correct in every
    // screenshot: the clear width is what a truck drives through, and the
    // stripes are painted beyond it, not inside it.
    const width = 3.2
    expect(clearHalfWidthM(width)).toBeCloseTo(1.6, 9)
    expect(stripeCentreOffsetM(width, 'standard')).toBeCloseTo(1.6375, 9)
    expect(outerHalfWidthM(width, 'standard')).toBeCloseTo(1.675, 9)

    const clear = 2 * clearHalfWidthM(width)
    const paintToPaint = 2 * stripeCentreOffsetM(width, 'standard') - LINE_WIDTHS.standard
    expect(paintToPaint).toBeCloseTo(clear, 9)
  })

  test('a wider stripe moves the paint out, never in', () => {
    const width = 3.2
    for (const id of ['narrow', 'standard', 'wide'] as const) {
      expect(clearHalfWidthM(width)).toBeCloseTo(1.6, 9)
      expect(stripeCentreOffsetM(width, id)).toBeGreaterThan(clearHalfWidthM(width))
      expect(outerHalfWidthM(width, id)).toBeGreaterThan(stripeCentreOffsetM(width, id))
    }
    expect(stripeCentreOffsetM(width, 'wide')).toBeGreaterThan(stripeCentreOffsetM(width, 'narrow'))
  })
})

describe('the corners mitre, and stop mitring before they spike', () => {
  test('a right angle puts the outer corner at offset times root two', () => {
    // **The one number that proves the bisector is being followed.** Offsetting
    // each segment on its own normal and joining the results would leave the
    // corner at `offset`, with a notch inside the bend and a gap outside it.
    const corner: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ]
    const offset = 1
    const out = offsetCentreline(corner, offset)
    const middle = out[1]
    if (!middle) throw new Error('expected three points')

    const distance = Math.hypot(middle[0] - 10, middle[1] - 0)
    expect(distance).toBeCloseTo(Math.SQRT2 * offset, 6)
  })

  test('a straight run just moves sideways', () => {
    const straight: Point[] = [
      [0, 0],
      [5, 0],
      [10, 0],
    ]
    for (const point of offsetCentreline(straight, 0.5)) {
      expect(Math.abs(point[1])).toBeCloseTo(0.5, 9)
    }
  })

  test('both offsets stay parallel to the run they came from', () => {
    // What mitring is FOR: the offset segments must be parallel to the
    // originals, or the clear width is not constant along the route and the
    // number the schema publishes is only true at the vertices.
    const path: Point[] = [
      [0, 0],
      [8, 0],
      [8, 6],
    ]
    const left = offsetCentreline(path, 0.9)
    const right = offsetCentreline(path, -0.9)
    const a = left[0]
    const b = left[1]
    const c = right[0]
    const d = right[1]
    if (!a || !b || !c || !d) throw new Error('expected offsets')

    // First segment ran along +X, so both offsets must too.
    expect(b[1] - a[1]).toBeCloseTo(0, 9)
    expect(d[1] - c[1]).toBeCloseTo(0, 9)
    // And they must be a full width apart.
    expect(Math.abs(a[1] - c[1])).toBeCloseTo(1.8, 9)
  })

  test('a hairpin is cut off rather than allowed to spike', () => {
    // Without the limit the outer vertex goes as offset / sin(theta/2), which
    // runs away as the turn tightens — paint growing a spike nobody drew.
    const hairpin: Point[] = [
      [0, 0],
      [10, 0],
      [0, 0.4],
    ]
    const offset = 0.5
    const out = offsetCentreline(hairpin, offset)
    const middle = out[1]
    if (!middle) throw new Error('expected three points')

    const distance = Math.hypot(middle[0] - 10, middle[1])
    expect(distance).toBeLessThanOrEqual(offset * MITER_LIMIT + 1e-9)
  })

  test('a doubled-back segment does not produce a NaN', () => {
    // Opposing normals cancel, so there is no bisector to normalise. The old
    // editor's offset helper divided by that zero and put the whole route at
    // NaN, which renders as nothing at all.
    const doubled: Point[] = [
      [0, 0],
      [5, 0],
      [0, 0],
    ]
    for (const point of offsetCentreline(doubled, 0.5)) {
      expect(Number.isFinite(point[0])).toBe(true)
      expect(Number.isFinite(point[1])).toBe(true)
    }
  })

  test('every vertex survives the offset', () => {
    const path: Point[] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [8, 4],
    ]
    expect(offsetCentreline(path, 0.6)).toHaveLength(path.length)
  })

  test('a duplicated corner is still mitred, not chamfered', () => {
    /**
     * **The defect that hid behind "does not produce a NaN".**
     *
     * A zero-length leg has no direction, so both of its endpoints fall to the
     * end-vertex branch and get offset along their own segment's normal rather
     * than along the shared bisector — an unpainted wedge outside the bend and
     * a crossed, short stripe inside it. Exactly the failure this module was
     * written to prevent, arriving through the back door.
     *
     * The duplicates were not hypothetical: the drawing tool subscribed to a
     * click path that fired twice per physical click, so every corner of every
     * route ever drawn carried one.
     */
    const clean: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ]
    const duplicated: Point[] = [
      [0, 0],
      [10, 0],
      [10, 0],
      [10, 10],
    ]
    const offset = 1
    const expected = offsetCentreline(clean, offset)[1]
    const actual = offsetCentreline(duplicated, offset)[1]
    if (!expected || !actual) throw new Error('expected a corner')

    expect(actual[0]).toBeCloseTo(expected[0], 9)
    expect(actual[1]).toBeCloseTo(expected[1], 9)
    // And it is the mitre, not the chamfer: root two out, not one.
    expect(Math.hypot(actual[0] - 10, actual[1])).toBeCloseTo(Math.SQRT2 * offset, 6)
  })

  test('a repeated vertex does not break the run', () => {
    // A hand-drawn polyline can carry a duplicate from a double click.
    const repeated: Point[] = [
      [0, 0],
      [5, 0],
      [5, 0],
      [5, 5],
    ]
    // Three distinct corners come back, because the duplicate is dropped
    // rather than carried — see the mitre test above.
    const out = offsetCentreline(repeated, 0.5)
    expect(out).toHaveLength(3)
    for (const point of out) {
      expect(Number.isFinite(point[0])).toBe(true)
      expect(Number.isFinite(point[1])).toBe(true)
    }
  })
})

describe('length is the paint quantity, measured on the axis', () => {
  test('an L adds its legs', () => {
    expect(
      routeLengthM([
        [0, 0],
        [3, 0],
        [3, 4],
      ]),
    ).toBeCloseTo(7, 9)
  })

  test('a single point has no length', () => {
    expect(routeLengthM([[1, 1]])).toBe(0)
  })
})
