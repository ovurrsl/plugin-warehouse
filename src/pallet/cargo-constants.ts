/**
 * Figures the cargo is drawn from that no supplier publishes.
 *
 * The same split the conveyor enforces between `catalog.ts` and `constants.ts`,
 * applied to a load: a pallet's own dimensions are standards with numbers behind
 * them, and everything a load is *wrapped and strapped with* is read off
 * photographs. Keeping them in a separate file is what stops the second kind
 * being mistaken for the first.
 *
 * Millimetres divided by 1000 at this boundary; nothing downstream may write a
 * bare length literal above 100.
 */

const mm = (value: number): number => value / 1000

/**
 * **The gap between cartons.**
 *
 * Four millimetres, and it is the difference between a stack of cartons and a
 * single brown block. At the two-to-twenty metre range a layout is read at, the
 * seam lines are the only thing that says how the load is made up — a flush
 * stack reads as one extruded box and the layer count becomes invisible.
 */
export const CARTON_GAP_M = mm(4)

/**
 * **PET strapping: 16 mm wide, drawn 2 mm thick.**
 *
 * The real band is 0.8 mm and drawing it at that shimmers — a sub-pixel edge at
 * any sensible distance, which reads as a crawling artefact rather than as a
 * strap. Two millimetres is the smallest thickness that stays still.
 */
export const STRAP_WIDTH_M = mm(16)
export const STRAP_THICKNESS_M = mm(2)

/**
 * How far a strap stands off the goods it holds.
 *
 * A millimetre and a half, and it is not slack: two coplanar surfaces z-fight,
 * and a strap lying exactly on a carton face flickers along its whole length as
 * the camera moves. Everything that sits on top of something else in this file
 * carries an offset for the same reason.
 */
export const STRAP_OFFSET_M = mm(1.5)

/** Two vertical bands over the load, at these fractions along the deck. */
export const STRAP_POSITIONS = [0.3, 0.7] as const

/**
 * **Corner boards: kraft L-profile, 50 × 50 × 3 mm.**
 *
 * Fitted from about sixty per cent fill upward, which is where a stack becomes
 * tall enough for a strap to crush its corners. Below that they are not used and
 * drawing them would be drawing a part the load does not have.
 */
export const CORNER_BOARD_M = mm(50)
export const CORNER_BOARD_THICKNESS_M = mm(3)
export const CORNER_BOARD_MIN_FILL = 0.6

/**
 * **The shipping label: A5, floating a millimetre off the film.**
 *
 * One quad. The offset is the same z-fight rule as the strapping, and the extra
 * millimetre over the strap's is deliberate: a label is applied last, on top of
 * everything, and drawing it level with the film puts it underneath in half the
 * viewing angles.
 */
export const LABEL_M = [mm(148), mm(210)] as const
export const LABEL_OFFSET_M = mm(1)

/**
 * **Stretch film: how far it stands off the load and how far down the pallet it
 * reaches.**
 *
 * A wrapped load is not a box with a skin on it — the film pulls in between the
 * cartons and laps down over the pallet's top boards to tie the two together,
 * which is the whole reason a wrapped pallet can be lifted at all. Both figures
 * are read off photography.
 */
export const FILM_CLEARANCE_M = mm(15)
export const FILM_SKIRT_M = mm(120)
/** How far the film pulls in at mid-height, as a fraction of the load's width. */
export const FILM_WAIST = 0.015

/**
 * The palette. Approximate, from catalogue and warehouse photography.
 *
 * Kraft is the only one a user would plausibly want to change, so it is a node
 * field with this as its default; the rest are fixed hardware.
 */
export const CARGO_PALETTE = {
  /** Corrugated board, and the corner boards cut from the same stock. */
  kraft: '#c8a06a',
  /** Steel drum, before the per-instance tint that stops ten thousand of them
   *  reading as one object copied. */
  drumBlue: '#2f5f9e',
  drumLid: '#8a9199',
  /** PET strapping. */
  strapGreen: '#2f8b57',
  /** The label plate. */
  labelWhite: '#f4f5f6',
  /** Stretch film, which is a tint on what is behind it rather than a colour. */
  film: '#dfe6ea',
} as const

/**
 * **How far a pallet's tint may wander from the type's colour: six per cent.**
 *
 * Ten thousand identical loads standing in a rack read as one object pasted ten
 * thousand times, and the eye catches that long before it catches any single
 * pallet being wrong. Six per cent is enough to break the pattern and small
 * enough that no pallet looks like a different product.
 */
export const TINT_SPREAD = 0.06
