import { z } from 'zod';
import { type BaseNode, BaseNodeSchema } from '@pascal-app/core';

// Define the unique kind for our nodes
export const KIND = 'warehouse:equipment';

// Equipment presets
export const PRESETS = ['rack', 'pallet', 'forklift'] as const;
export type EquipmentPreset = (typeof PRESETS)[number];

// Our node schema extends the base node schema
export const WarehouseNodeSchema = BaseNodeSchema.extend({
  type: z.literal(KIND),
  preset: z.enum(PRESETS),
  // Add parametrics
  width: z.number().default(2),
  height: z.number().default(3),
  depth: z.number().default(1),
  color: z.string().default('#cccccc'),
});

export type WarehouseNode = z.infer<typeof WarehouseNodeSchema>;
