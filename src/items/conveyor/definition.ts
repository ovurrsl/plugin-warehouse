import type { NodeDefinition } from '@pascal-app/core'
import { buildConveyorFloorplan } from './floorplan'
import { conveyorParametrics } from './parametrics'
import { ConveyorNode } from './schema'

export const conveyorDefinition = {
  kind: 'warehouse:conveyor',
  snapProfile: 'item',
  facingIndicator: true,
  schemaVersion: 1,
  schema: ConveyorNode,
  category: 'furnish',
  surfaceRole: 'furnishing',

  defaults: () => ({
    object: 'node' as const,
    name: 'Flat Wire Mesh Conveyor',
    parentId: null,
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    visible: true,
    metadata: {},
    width: 3.0,
    height: 0.6,
    depth: 0.8,
    frameColor: '#64748b',
    beltColor: '#94a3b8',
    hasSideRails: true,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    presettable: true,
    floorPlaced: {
      footprint: (node) => {
        const item = node as unknown as ConveyorNode
        return {
          dimensions: [item.width || 3.0, item.height || 0.6, item.depth || 0.8],
          rotation: item.rotation || [0, 0, 0],
          position: [0, (item.height || 0.6) / 2, 0],
        }
      },
      applies: () => true,
      collides: true,
    },
  },

  parametrics: conveyorParametrics as never,

  affordanceTools: {
    move: () => import('./move-tool'),
  },

  floorplan: buildConveyorFloorplan,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place conveyor' },
    { key: 'R / T', label: 'Rotate' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Wire Mesh Conveyor',
    description: 'Modular motorized flat wire mesh package conveyor belt.',
    icon: { kind: 'url', src: '/icons/shelf.webp' },
    hidden: true,
    paletteOrder: 220,
  },
} satisfies NodeDefinition<typeof ConveyorNode>
