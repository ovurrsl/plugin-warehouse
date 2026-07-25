import type { NodeDefinition } from '@pascal-app/core'
import { buildToteCartFloorplan } from './floorplan'
import { toteCartParametrics } from './parametrics'
import { ToteCartNode } from './schema'

export const toteCartDefinition = {
  kind: 'warehouse:tote-cart',
  snapProfile: 'item',
  facingIndicator: true,
  schemaVersion: 1,
  schema: ToteCartNode,
  category: 'furnish',
  surfaceRole: 'furnishing',

  defaults: () => ({
    object: 'node' as const,
    name: 'Tote Cart',
    parentId: null,
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    visible: true,
    metadata: {},
    width: 0.6,
    height: 1.5,
    depth: 0.4,
    frameColor: '#334155',
    toteColor: '#2563eb',
    shelfLevels: 3,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    presettable: true,
    floorPlaced: {
      footprint: (node) => {
        const item = node as unknown as ToteCartNode
        return {
          dimensions: [item.width || 0.6, item.height || 1.5, item.depth || 0.4],
          rotation: item.rotation || [0, 0, 0],
          position: [0, (item.height || 1.5) / 2, 0],
        }
      },
      applies: () => true,
      collides: true,
    },
  },

  parametrics: toteCartParametrics as never,

  affordanceTools: {
    move: () => import('./move-tool'),
  },

  floorplan: buildToteCartFloorplan,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place cart' },
    { key: 'R / T', label: 'Rotate' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Tote Cart Trolley',
    description: 'Multi-tier wheeled order picking trolley with Euro tote bins.',
    icon: { kind: 'url', src: '/icons/shelf.webp' },
    hidden: true,
    paletteOrder: 230,
  },
} satisfies NodeDefinition<typeof ToteCartNode>
