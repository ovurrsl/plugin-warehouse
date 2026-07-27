/**
 * Figures about handling equipment that nobody publishes in the form we need.
 *
 * The same split the rack and the cargo already enforce: `./catalog.ts` holds
 * what a manufacturer or a standard states, this file holds what we estimated,
 * and each estimate is named with the reasoning that produced it. A number never
 * crosses that line.
 */

/**
 * **How much room to turn a truck that does not stack: ~2.1 m. AN ESTIMATE.**
 *
 * A hand pallet truck, a powered one and an AGV carry at floor level, so no
 * stacking-aisle standard rates them — `TRUCK_EQUIPMENT` returns `null` for all
 * three, and it is right to. But a section whose whole promise is that each
 * variant carries the width it needs cannot answer "nothing" for half the fleet.
 *
 * The basis, stated so it can be argued with: a pallet truck is roughly 0.7 m
 * across the chassis and carries a 1.2 m pallet ahead of it, and an operator
 * swings it about the load rather than about the wheels — so the room it needs
 * to turn is about the pallet plus the chassis plus somewhere to stand. That is
 * an argument, not a measurement, and everything that reads this number is
 * required to say so at the point of display.
 *
 * What it is NOT: a right-angle stacking aisle. Those are derived from a truck's
 * wheelbase, load centre and turning radius under VDI 2198, and we hold none of
 * those inputs for any machine. Deriving one anyway would produce arithmetic
 * that checks an invented number against another invented number while wearing
 * the appearance of validation — worse than an uncited estimate, because it
 * would look earned.
 */
export const MANOEUVRING_WIDTH_M = 2.1

/** Said verbatim wherever the estimate is shown, so it cannot be quoted bare. */
export const MANOEUVRING_NOTE =
  'Manoeuvring width, estimated. Not a stacking aisle — this truck does not lift into racking, and no standard rates it.'
