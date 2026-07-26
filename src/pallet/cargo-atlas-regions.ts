/**
 * Where every cargo texture lives on the atlas — **the one place that knows.**
 *
 * The empty pallet's atlas (`./epal-textures`) writes each sub-rectangle twice:
 * once as canvas pixels inside the drawing code, and again as hand-computed UV
 * fractions in its `ATLAS` table, with the pixel figures repeated in comments.
 * That works exactly until someone nudges a drawing, at which point the UVs go
 * on pointing at where the mark used to be and the mesh samples its neighbour.
 * Nothing fails; the wrong pixels simply appear, which is the hardest kind of
 * texture bug to see and the easiest to introduce.
 *
 * So this module owns the geometry of the sheet and hands it out in whichever
 * form the caller needs — pixels to the drawer, UVs to the geometry builder.
 * Neither can be edited into disagreement with the other because neither holds
 * a number of its own.
 *
 * ## Why the positions are computed rather than written down
 *
 * A table of literal coordinates is auditable but hand-maintained: add a region
 * and you re-derive every position after it, and an arithmetic slip overlaps two
 * regions or pushes one off the sheet. Both failures are silent. Shelf-packing
 * the declared sizes makes overlap and overflow *unrepresentable* instead of
 * merely unlikely, and the debug atlas (`./cargo-atlas`) makes the result
 * visible when you want to see it.
 */

/**
 * The sheet is 2048², and the pallet's own 1024² atlas is left alone.
 *
 * Separate rather than enlarged: the empty pallet's texture is loaded by every
 * scene that has a pallet in it, and a scene with no *loaded* pallets should not
 * pay for cargo it never draws.
 */
export const ATLAS_SIZE = 2048

/**
 * **Space between regions: 24 px.**
 *
 * Mip levels are the reason. At mip 5 a 24 px gutter is down to well under a
 * texel, and any two regions closer than that start averaging into each other as
 * the camera pulls back — a kraft carton picks up the drum's blue at fifteen
 * metres and nobody can say why. The plan's range is 16–32; 24 sits in the
 * middle and costs 3% of the sheet.
 */
export const GUTTER_PX = 24

/**
 * **How far inside its own region a UV starts: 3 px.**
 *
 * The gutter stops a region bleeding into its neighbour; this stops it bleeding
 * into the gutter. Bilinear sampling at the exact edge of a rectangle reaches
 * half a texel past it, so a UV placed on the boundary fetches gutter colour
 * along every edge of every quad — a pale hairline frame around each carton.
 */
export const INSET_PX = 3

/**
 * How many cartons the `cartonRow` region is drawn as.
 *
 * Named here rather than in the drawer because the geometry has to narrow its
 * UVs to a fraction of the row, and a face that took the wrong fraction would
 * paint the wrong number of cartons — the drawer and the mapper disagreeing
 * about the same picture, which is exactly what this module exists to prevent.
 */
export const CARTON_ROW_CELLS = 4

export type PixelRect = { x: number; y: number; w: number; h: number }
export type UVRect = { uMin: number; uMax: number; vMin: number; vMax: number }

/**
 * Every region, in draw order, with the size it needs and why it needs it.
 *
 * Sizes are chosen from how the region is *sampled*, not from tidiness: a face
 * seen square-on wants a square region, and one wrapped around a cylinder wants
 * its circumference's worth of width or the texels stretch on the way round.
 */
const DECLARED = [
  /** A carton's plain side: kraft liner, flute shadow, darkened edges. */
  { id: 'cartonFace', w: 480, h: 480 },
  /** The same face with a tape seam — the side of the stack that was sealed. */
  { id: 'cartonFaceTaped', w: 480, h: 480 },
  /** Looking down on a carton: four flaps meeting, tape across the join. */
  { id: 'cartonTop', w: 480, h: 480 },
  /**
   * The far tier's stack face: **one layer of four cartons, seams and all**,
   * drawn as texture instead of built as geometry so a distant pallet costs one
   * box rather than forty.
   *
   * One row rather than a whole grid, because the grid's height is the fill
   * variant and baking it would need a region per variant. The builder repeats
   * this band once per layer. It serves the short face too: two across instead
   * of four is a sub-range of the same row, and the cartons are identical.
   */
  { id: 'cartonRow', w: 480, h: 100 },

  /**
   * A drum's side, sized to what it wraps rather than to a round number:
   * π × 585 mm is 1838 mm of circumference against 880 mm of height, which is
   * 2.088 : 1, and 1000 × 480 is 2.083 : 1. The obvious 2:1 would have been 4%
   * out — invisible, but being right costs nothing here.
   */
  { id: 'drumBody', w: 1000, h: 480 },
  /** The lid: rolled rim, bung ring, two bungs. */
  { id: 'drumLid', w: 480, h: 480 },

  /**
   * Stretch film. Wrinkle and sheen only — the film's colour is what shows
   * through it, so this region carries almost no hue of its own.
   */
  { id: 'film', w: 480, h: 480 },

  /** Kraft L-profile stock for the corner boards. Tall, because it is cut to
   *  the load's height. */
  { id: 'cornerBoard', w: 240, h: 480 },

  /**
   * The shipping label, at A5's own proportions.
   *
   * 256 × 364 is 1 : 1.422 against A5's 148 : 210 = 1 : 1.419. A square region
   * would have been tidier and would have stretched the barcode, which is the
   * one thing on a pallet a person tries to read.
   */
  { id: 'label', w: 256, h: 364 },

  /** PET strapping: a long thin strip, sampled along its length. */
  { id: 'strap', w: 480, h: 48 },
] as const

export type CargoRegionId = (typeof DECLARED)[number]['id']

export const CARGO_REGION_IDS = DECLARED.map((entry) => entry.id) as readonly CargoRegionId[]

function pack(): Record<CargoRegionId, PixelRect> {
  const packed = {} as Record<CargoRegionId, PixelRect>
  let x = GUTTER_PX
  let y = GUTTER_PX
  let rowHeight = 0

  for (const region of DECLARED) {
    // The trailing `GUTTER_PX` is the right margin: a region flush with the
    // sheet's edge has nothing to inset into on that side, and wraps its
    // sampling onto the opposite edge under repeat addressing.
    if (x + region.w + GUTTER_PX > ATLAS_SIZE) {
      x = GUTTER_PX
      y += rowHeight + GUTTER_PX
      rowHeight = 0
    }
    packed[region.id] = { x, y, w: region.w, h: region.h }
    x += region.w + GUTTER_PX
    rowHeight = Math.max(rowHeight, region.h)
  }

  const used = y + rowHeight + GUTTER_PX
  if (used > ATLAS_SIZE) {
    // Thrown at import rather than left to the canvas, which would silently
    // clip the overflowing regions to nothing and render them as blank.
    throw new Error(`cargo atlas overflows: ${used} px of ${ATLAS_SIZE} used`)
  }
  return packed
}

export const CARGO_REGIONS: Readonly<Record<CargoRegionId, PixelRect>> = Object.freeze(pack())

/**
 * The region a mesh should sample, in UV space.
 *
 * ## The flip
 *
 * `THREE.CanvasTexture` uploads with `flipY = true`, so the canvas's first row
 * arrives at the *top* of the texture and V counts upward from the bottom. A
 * region drawn at canvas rows `y … y+h` is therefore reachable at V
 * `1-(y+h)/size … 1-y/size`, inverted, and every consumer that derived this for
 * itself would have a chance to get it backwards — the failure being an
 * upside-down label, which reads as a modelling mistake rather than as a UV one.
 * It is derived here, once.
 */
export function uvOf(id: CargoRegionId): UVRect {
  const region = CARGO_REGIONS[id]
  const left = region.x + INSET_PX
  const right = region.x + region.w - INSET_PX
  const top = region.y + INSET_PX
  const bottom = region.y + region.h - INSET_PX
  return {
    uMin: left / ATLAS_SIZE,
    uMax: right / ATLAS_SIZE,
    vMin: 1 - bottom / ATLAS_SIZE,
    vMax: 1 - top / ATLAS_SIZE,
  }
}

/**
 * The canvas pixel a UV lands on — the inverse of {@link uvOf}.
 *
 * Exported for the tests, which is the point: a convention nothing can check is
 * a convention that drifts. With both directions available the flip is a
 * round-trip assertion instead of a claim in a comment.
 */
export function pixelOf(u: number, v: number): { x: number; y: number } {
  return { x: u * ATLAS_SIZE, y: (1 - v) * ATLAS_SIZE }
}

/**
 * A region's rectangle on a canvas of some other size.
 *
 * The roughness/metalness sheet is drawn at half resolution — it carries no text
 * and no barcode, and a surface property does not need albedo's detail — but it
 * must stay in register with the albedo sheet, because one set of UVs addresses
 * both. Scaling at the point of drawing keeps every declared coordinate in one
 * space; the alternative, a second table at 1024, is the duplication this whole
 * module exists to prevent.
 */
export function rectOn(id: CargoRegionId, canvasSize: number): PixelRect {
  const region = CARGO_REGIONS[id]
  const scale = canvasSize / ATLAS_SIZE
  return {
    x: region.x * scale,
    y: region.y * scale,
    w: region.w * scale,
    h: region.h * scale,
  }
}
