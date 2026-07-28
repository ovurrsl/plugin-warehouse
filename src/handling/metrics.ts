import { HANDLING_EQUIPMENT } from '../rack/standards'
import { TRUCK_EQUIPMENT, type TruckVariant } from './catalog'
import { MANOEUVRING_NOTE, MANOEUVRING_WIDTH_M } from './constants'
import { TRUCK_MODELS, type TruckModelId } from './models'

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
 *
 * ## Two instruments, one rule
 *
 * `aisleFigureForModel` below reads a second instrument — VDI 2198 4.34, the
 * manufacturer's own turning trial for one specific machine — and the two can
 * disagree on the same screen (EN 15620 rates a small counterbalanced truck's
 * class at 3.20 m; VDI measures one model at 3.112 m). That is not a conflict
 * to resolve but two measurements to attribute, and the rule is:
 *
 * **The class band is binding. The model figure appears only in the truck's
 * own panel, as a "this machine" readout, and never enters an aisle's width
 * reading.** Which is why `ModelAisleFigure` shares no type with `AisleBand`:
 * the impossibility of substituting one for the other is bought with the
 * absence of any structural relation, not with a `scope` field TypeScript
 * would happily ignore.
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

/** The two pallet orientations VDI 2198 4.34 publishes Ast against. */
export type AstLoad = '1000x1200' | '800x1200'

/**
 * Deliberately unrelated to `AisleBand` — see "Two instruments, one rule"
 * above. `basis`/`instrument` are literal, not unions: this channel can only
 * ever carry a published VDI figure, and widening the type is how an estimate
 * would one day slip in wearing its clothes.
 */
export type ModelAisleFigure = {
  requiredM: number
  basis: 'published'
  instrument: 'VDI 2198'
  /** Brand-free: model id + orientation, e.g. `forklift-1300 · 1000×1200`. */
  label: string
  /** Carried verbatim to the panel. */
  note: string
}

/**
 * Families whose 200 mm safety margin `a` is itself published. The others
 * (forklift, powered-pallet) publish Ast without printing `a`, so their note
 * must not claim it — quoting a margin nobody printed is how a published
 * figure grows an invented appendix.
 */
const SAFETY_MARGIN_PUBLISHED: ReadonlySet<TruckVariant> = new Set(['hand-pallet', 'reach'])

/**
 * The manufacturer's own turning trial for one machine, or `null` where none
 * was published. `null` is a real answer: `tt-1600` has no VDI Ast and the
 * class band (EN 15620) is the only width that may be quoted for it.
 */
export function aisleFigureForModel(id: TruckModelId, load: AstLoad): ModelAisleFigure | null {
  const model = TRUCK_MODELS[id]
  if (!model.ast) return null
  const requiredM = load === '1000x1200' ? model.ast.load1000x1200 : model.ast.load800x1200
  const margin = SAFETY_MARGIN_PUBLISHED.has(model.variant)
    ? ' a = 200 mm güvenlik payı dahil.'
    : ''
  return {
    requiredM,
    basis: 'published',
    instrument: 'VDI 2198',
    label: `${model.id} · ${load === '1000x1200' ? '1000×1200' : '800×1200'}`,
    note: `VDI 2198 4.34.${margin}`,
  }
}
