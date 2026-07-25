import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

export const ToteCartNode = BaseNode.extend({
  id: objectId('tote_cart'),
  type: nodeType('warehouse:tote-cart'),
  name: z.string().default('Tote Cart'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z
    .union([
      z.tuple([z.number(), z.number(), z.number()]),
      z.number().transform((ry) => [0, ry, 0] as [number, number, number]),
    ])
    .default([0, 0, 0]),

  width: z.number().default(0.6),
  height: z.number().default(1.5),
  depth: z.number().default(0.4),

  frameColor: z.string().default('#334155'),
  toteColor: z.string().default('#2563eb'),
  shelfLevels: z.number().int().default(3),
})

export type ToteCartNode = z.infer<typeof ToteCartNode>
