import { describe, expect, test } from 'bun:test'
import {
  ATLAS_SIZE,
  CARGO_REGION_IDS,
  CARGO_REGIONS,
  GUTTER_PX,
  INSET_PX,
  type PixelRect,
  pixelOf,
  rectOn,
  uvOf,
} from './cargo-atlas-regions'

/** Positive when the two rectangles are apart on this axis; the gap between
 *  them. Negative when they overlap. */
function gap(a: PixelRect, b: PixelRect, axis: 'x' | 'y'): number {
  const size = axis === 'x' ? 'w' : 'h'
  return Math.max(b[axis] - (a[axis] + a[size]), a[axis] - (b[axis] + b[size]))
}

describe('the sheet is laid out so a region cannot bleed into its neighbour', () => {
  test('no two regions overlap, and every pair is a full gutter apart', () => {
    // Both failures are silent at runtime — overlap paints one region over
    // another, and a thin gap averages two regions together at mip levels the
    // camera reaches by fifteen metres. Neither throws, and neither is visible
    // on the sheet itself; only in the render, as a colour nobody can source.
    const placed = CARGO_REGION_IDS.map((id) => ({ id, rect: CARGO_REGIONS[id] }))
    const tooClose: string[] = []
    for (const [index, first] of placed.entries()) {
      for (const second of placed.slice(index + 1)) {
        const apart = Math.max(gap(first.rect, second.rect, 'x'), gap(first.rect, second.rect, 'y'))
        if (apart < GUTTER_PX) tooClose.push(`${first.id} / ${second.id}: ${apart} px`)
      }
    }
    expect(tooClose).toEqual([])
  })

  test('every region keeps a gutter from the edge of the sheet', () => {
    // A region flush with the edge has nothing to inset into on that side, and
    // wraps its sampling onto the opposite edge under repeat addressing.
    for (const id of CARGO_REGION_IDS) {
      const region = CARGO_REGIONS[id]
      expect(region.x).toBeGreaterThanOrEqual(GUTTER_PX)
      expect(region.y).toBeGreaterThanOrEqual(GUTTER_PX)
      expect(region.x + region.w + GUTTER_PX).toBeLessThanOrEqual(ATLAS_SIZE)
      expect(region.y + region.h + GUTTER_PX).toBeLessThanOrEqual(ATLAS_SIZE)
    }
  })

  test('every region survives its own inset', () => {
    for (const id of CARGO_REGION_IDS) {
      const region = CARGO_REGIONS[id]
      expect(region.w).toBeGreaterThan(INSET_PX * 2)
      expect(region.h).toBeGreaterThan(INSET_PX * 2)
    }
  })
})

describe('the flip is a round trip, not a claim in a comment', () => {
  test('V counts up from the bottom: vMax is the region’s TOP row', () => {
    // The one part of an atlas that looking at the atlas cannot check. A region
    // drawn correctly and sampled upside down is indistinguishable on the sheet
    // — you find out when the shipping label reads bottom-to-top, and it reads
    // as a modelling mistake rather than as a UV one.
    for (const id of CARGO_REGION_IDS) {
      const region = CARGO_REGIONS[id]
      const uv = uvOf(id)

      const topLeft = pixelOf(uv.uMin, uv.vMax)
      expect(topLeft.x).toBeCloseTo(region.x + INSET_PX, 6)
      expect(topLeft.y).toBeCloseTo(region.y + INSET_PX, 6)

      const bottomRight = pixelOf(uv.uMax, uv.vMin)
      expect(bottomRight.x).toBeCloseTo(region.x + region.w - INSET_PX, 6)
      expect(bottomRight.y).toBeCloseTo(region.y + region.h - INSET_PX, 6)
    }
  })

  test('a region drawn higher on the canvas samples higher in V', () => {
    const highest = CARGO_REGION_IDS.reduce((best, id) =>
      CARGO_REGIONS[id].y < CARGO_REGIONS[best].y ? id : best,
    )
    const lowest = CARGO_REGION_IDS.reduce((best, id) =>
      CARGO_REGIONS[id].y > CARGO_REGIONS[best].y ? id : best,
    )
    expect(CARGO_REGIONS[highest].y).toBeLessThan(CARGO_REGIONS[lowest].y)
    expect(uvOf(highest).vMin).toBeGreaterThan(uvOf(lowest).vMax)
  })

  test('every UV lands inside the unit square', () => {
    for (const id of CARGO_REGION_IDS) {
      const uv = uvOf(id)
      expect(uv.uMin).toBeGreaterThan(0)
      expect(uv.vMin).toBeGreaterThan(0)
      expect(uv.uMax).toBeLessThan(1)
      expect(uv.vMax).toBeLessThan(1)
      expect(uv.uMax).toBeGreaterThan(uv.uMin)
      expect(uv.vMax).toBeGreaterThan(uv.vMin)
    }
  })
})

describe('one table serves both sheets', () => {
  test('the half-resolution sheet stays in register with the full one', () => {
    // Roughness and metalness are drawn at 1024 while albedo is drawn at 2048,
    // and one set of UVs addresses both. A second coordinate table for the
    // smaller sheet is exactly the duplication the module exists to prevent, so
    // the scaling has to be exact rather than approximately right.
    for (const id of CARGO_REGION_IDS) {
      const full = CARGO_REGIONS[id]
      const half = rectOn(id, ATLAS_SIZE / 2)
      expect(half.x * 2).toBeCloseTo(full.x, 9)
      expect(half.y * 2).toBeCloseTo(full.y, 9)
      expect(half.w * 2).toBeCloseTo(full.w, 9)
      expect(half.h * 2).toBeCloseTo(full.h, 9)
    }
    expect(rectOn('cartonFace', ATLAS_SIZE)).toEqual(CARGO_REGIONS.cartonFace)
  })
})

describe('a region’s shape follows how it is sampled', () => {
  test('the label carries A5’s proportions, so the barcode is not stretched', () => {
    // The one thing on a pallet a person tries to read. A square region would
    // have been tidier and would have stretched it.
    const label = CARGO_REGIONS.label
    expect(label.w / label.h).toBeCloseTo(148 / 210, 2)
  })

  test('the drum’s side is as wide as the drum is round', () => {
    // 585 mm across is 1838 mm of circumference against 880 mm of height. Wrap
    // a square region round that and the texels stretch on the way past.
    const body = CARGO_REGIONS.drumBody
    const wrapped = (Math.PI * 0.585) / 0.88
    expect(body.w / body.h).toBeCloseTo(wrapped, 1)
  })

  test('the carton row is four cartons wide and one deep', () => {
    // 4 × 300 mm across against 250 mm of height.
    const row = CARGO_REGIONS.cartonRow
    expect(row.w / row.h).toBeCloseTo((4 * 0.3) / 0.25, 1)
  })
})
