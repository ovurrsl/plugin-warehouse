import type { HandlingEquipmentId } from '../rack/standards'

/**
 * The machines a warehouse is designed around, and the published rows they
 * resolve to.
 *
 * The vocabulary lives here rather than in a node schema because two things
 * need it and only one of them is a node: the truck kind names its own class,
 * and a floor marking names the class it was sized for. A route holds an id and
 * never a copy of the figure — the moment paint stores `3.2` a catalogue
 * correction stops propagating and the two sides can disagree forever.
 */

export const TRUCK_VARIANTS = [
  'hand-pallet',
  'powered-pallet',
  'forklift',
  'reach',
  'turret',
  'agv',
] as const

export type TruckVariant = (typeof TRUCK_VARIANTS)[number]

/**
 * Which published row rates each class, or `null` where none does.
 *
 * **The nulls are the honest half.** EN 15620's aisle bands describe trucks that
 * lift a pallet into racking, and three of these six do not: a hand pallet truck
 * and a powered one carry at floor level, and an AGV follows a route somebody
 * else decided. Filing them under a rated row would hand back a number that
 * reads as published and was invented — the same failure `standards.ts` already
 * refuses for a stacker crane, whose `handlingClass` is `null` for exactly this
 * reason.
 */
export const TRUCK_EQUIPMENT: Record<TruckVariant, HandlingEquipmentId | null> = {
  'hand-pallet': null,
  'powered-pallet': null,
  forklift: 'counterbalanced-forklift',
  reach: 'reach-truck',
  turret: 'trilateral-turret',
  agv: null,
}
