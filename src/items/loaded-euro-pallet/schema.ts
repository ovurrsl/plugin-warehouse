import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

export const LoadedEuroPalletNode = BaseNode.extend({
  id: objectId('loaded_euro_pallet'),
  type: nodeType('warehouse:loaded-euro-pallet'),
  name: z.string().default('Loaded EUR-Pallet'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z
    .union([
      z.tuple([z.number(), z.number(), z.number()]),
      z.number().transform((ry) => [0, ry, 0] as [number, number, number]),
    ])
    .default([0, 0, 0]),

  width: z.number().default(1.2),
  height: z.number().default(1.15),
  depth: z.number().default(0.8),

  cargoType: z.enum(['boxes', 'drums', 'totes']).default('boxes'),
  wrapPlastic: z.boolean().default(true),
  cornerGuards: z.boolean().default(true),
  boxColor: z.string().default('#cda27b'),
})

export type LoadedEuroPalletNode = z.infer<typeof LoadedEuroPalletNode>
