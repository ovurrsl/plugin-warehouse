import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

export const ConveyorNode = BaseNode.extend({
  id: objectId('conveyor'),
  type: nodeType('warehouse:conveyor'),
  name: z.string().default('Flat Wire Mesh Conveyor'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z
    .union([
      z.tuple([z.number(), z.number(), z.number()]),
      z.number().transform((ry) => [0, ry, 0] as [number, number, number]),
    ])
    .default([0, 0, 0]),

  width: z.number().default(3.0),
  height: z.number().default(0.6),
  depth: z.number().default(0.8),

  frameColor: z.string().default('#64748b'),
  beltColor: z.string().default('#94a3b8'),
  hasSideRails: z.boolean().default(true),
})

export type ConveyorNode = z.infer<typeof ConveyorNode>
