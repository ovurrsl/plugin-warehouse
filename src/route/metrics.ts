import type { TruckVariant } from '../handling/catalog'
import { type AisleBand, aisleBandForVariant } from '../handling/metrics'
import { PEDESTRIAN_WIDTH_M } from './catalog'
import type { RouteNode, RouteRole } from './schema'
import { routeLengthM } from './stripes'

/**
 * What a route is worth saying about itself.
 *
 * Everything here either measures the user's own drawing — which cannot be
 * wrong and cites nothing — or quotes a band through
 * {@link aisleBandForVariant}. Nothing computes a third number, and nothing
 * returns a verdict.
 */

/**
 * The width a freshly drawn route starts at.
 *
 * A vehicle aisle starts at the published minimum for the class it names, so the
 * ordinary gesture produces an aisle that is *exactly* wide enough and the
 * margin readout starts at zero rather than at an accident. A walkway starts at
 * the one published pedestrian width in the survey — German, labelled German.
 *
 * The only caller is the node's `defaults()` and the tile brush; nothing derives
 * a width anywhere else.
 */
export function defaultWidthM(role: RouteRole, requiredFor: TruckVariant | null): number {
  if (role !== 'vehicle') return PEDESTRIAN_WIDTH_M
  return aisleBandForVariant(requiredFor ?? 'forklift').min
}

export type RouteReading = {
  /** What the user drew, metres. */
  widthM: number
  /** Metres of centreline — the paint quantity, not the painted area. */
  lengthM: number
  /** The band this width is being read against, or `null` for a walkway. */
  band: AisleBand | null
  /**
   * `width − band.min`, metres. Negative is the finding.
   *
   * `null` for a walkway, because there is nothing published to read it
   * against: no instrument binding a Turkish user states a pedestrian-route
   * width at all, and the German table is a starting point rather than a test.
   */
  marginM: number | null
}

/**
 * The route's own numbers, in the form the panel prints them.
 *
 * The margin is returned even when the band is an ESTIMATE, and the basis comes
 * back with it — because the caller has to decide what to say, and colouring a
 * margin against an estimate would turn an argument into a compliance claim.
 */
export function routeReading(route: RouteNode): RouteReading {
  const band = route.requiredFor ? aisleBandForVariant(route.requiredFor) : null
  return {
    widthM: route.width,
    lengthM: routeLengthM(route.points),
    band,
    marginM: band ? route.width - band.min : null,
  }
}
