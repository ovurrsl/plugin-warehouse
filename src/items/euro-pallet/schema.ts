import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

export const EuroPalletNode = BaseNode.extend({
  id: objectId('euro_pallet'),
  type: nodeType('warehouse:euro-pallet'),
  name: z.string().default('EUR-Pallet'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z
    .union([
      z.tuple([z.number(), z.number(), z.number()]),
      z.number().transform((ry) => [0, ry, 0] as [number, number, number]),
    ])
    .default([0, 0, 0]),
})

export type EuroPalletNode = z.infer<typeof EuroPalletNode>
