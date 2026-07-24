import type { Plugin, AnyNodeDefinition } from '@pascal-app/core';
import { definition } from './definition';

export const warehousePlugin: Plugin = {
  id: 'pascal:warehouse',
  apiVersion: 1,
  nodes: [definition as unknown as AnyNodeDefinition],
};

// Panel configuration for the editor's left rail
export const warehouseHostPanel = {
  id: 'pascal:warehouse:panel',
  label: 'Warehouse',
  icon: { kind: 'url', src: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/warehouse.svg' }, // Example icon
  component: () => import('./presets-panel'),
  pluginId: warehousePlugin.id,
  description: 'Logistics and warehouse equipment.',
  creator: {
    name: 'Pascal',
    url: 'https://github.com/pascalorg',
  },
  pluginUrl: 'https://github.com/pascalorg/plugin-warehouse',
  defaultInstalled: true,
};

export { definition };
export * from './schema';
