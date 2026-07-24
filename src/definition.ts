import { z } from 'zod';
import { KIND, WarehouseNodeSchema } from './schema';
import { Parametrics } from './parametrics';
import { Renderer } from './renderer';
import { Tool, Preview } from './tool';

export const definition = {
  kind: KIND,
  schemaVersion: 1,
  schema: WarehouseNodeSchema,
  parametrics: Parametrics,
  renderer: Renderer,
  tool: Tool,
  preview: Preview,
  // Equipment usually belongs to a zone or level, so 'floor' is a typical parent kind.
  parentKinds: ['floor'],
  // How it should be named in generic UI
  label: 'Warehouse Equipment',
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    duplicable: true,
  },
};
