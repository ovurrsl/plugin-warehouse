import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

/**
 * A standalone pedestrian zebra crossing placed on the warehouse floor or across an aisle.
 *
 * Can be positioned freely or snapped directly onto a vehicle route.
 * Emits high-visibility coplanar transverse bars with monotonic depth bias.
 */
export const CrosswalkNode = BaseNode.extend({
  id: objectId('crosswalk'),
  type: nodeType('warehouse:crosswalk'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  /**
   * The vehicle route this crosswalk is bound to, if snapped to an existing route.
   */
  routeId: z.string().nullable().default(null),

  /**
   * The parametric distance (0..1) along the route polyline when attached to a route.
   */
  t: z.number().min(0).max(1).default(0.5),

  /**
   * Clear width across the corridor (bar width, transverse to travel), in metres.
   */
  width: z.number().min(0.5).max(20).default(3.5),

  /**
   * Total crosswalk length along the vehicle travel direction (longitudinal span), in metres.
   */
  length: z.number().min(0.5).max(10).default(2.5),

  /**
   * Number of transverse zebra bars.
   */
  stripeCount: z.number().int().min(2).max(20).default(6),

  /**
   * Color of the zebra bars.
   */
  stripeColor: z.string().default('#ffffff'),

  /**
   * The slab this crosswalk is painted on.
   */
  supportSlabId: z.string().nullable().default(null),
})

export type CrosswalkNode = z.infer<typeof CrosswalkNode>
