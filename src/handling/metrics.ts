import { HANDLING_EQUIPMENT } from '../rack/standards'
import { TRUCK_EQUIPMENT, type TruckVariant } from './catalog'
import { MANOEUVRING_NOTE, MANOEUVRING_WIDTH_M } from './constants'

/**
 * The width a class of truck needs, and where that width came from.
 *
 * **One function, because there is one number.** An aisle a user paints on the
 * floor and an aisle a truck needs are the same measurement read from two sides,
 * and the moment each side computes its own there are two numbers that can
 * disagree. A route calls this; the truck's own readout calls this; neither
 * derives anything.
 *
 * The direction of the read is deliberate and not symmetric: **a route reads the
 * truck's band, and the truck never reads the route.** A published figure is an
 * input to a design and never an output of one — if the truck took its band from
 * the paint, a user who drew a narrow aisle would have told the catalogue that a
 * forklift needs 2.4 m, and the catalogue would go on repeating it.
 *
 * Everything here is measured **between loads**, which is the datum
 * `standards.ts` publishes on and `rack/envelope.ts` computes to. An aisle
 * measured to the steel is wider than the truck needs.
 */

export type AisleBand = {
  /** Metres, between loads. */
  min: number
  max: number
  basis: 'published' | 'estimate'
  label: string
  /** Carried verbatim to any display. Empty for a published band. */
  note: string
}

export function aisleBandForVariant(variant: TruckVariant): AisleBand {
  const equipmentId = TRUCK_EQUIPMENT[variant]
  if (equipmentId) {
    const equipment = HANDLING_EQUIPMENT[equipmentId]
    return {
      min: equipment.aisle.min,
      max: equipment.aisle.max,
      basis: 'published',
      label: equipment.label,
      note: '',
    }
  }
  return {
    min: MANOEUVRING_WIDTH_M,
    max: MANOEUVRING_WIDTH_M,
    basis: 'estimate',
    label: 'Non-stacking truck',
    note: MANOEUVRING_NOTE,
  }
}

/**
 * How much room a drawn aisle has over the band, in metres. Negative is the
 * finding.
 *
 * Returned as a plain signed number rather than a verdict, because a verdict
 * against an ESTIMATE would launder the estimate into a compliance statement.
 * Whoever displays this has to check the basis first, and the band carries it.
 */
export function aisleMarginM(drawnWidthM: number, variant: TruckVariant): number {
  return drawnWidthM - aisleBandForVariant(variant).min
}
