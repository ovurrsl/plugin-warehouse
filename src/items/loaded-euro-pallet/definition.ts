import type { NodeDefinition } from '@pascal-app/core'
import { buildLoadedEuroPalletFloorplan } from './floorplan'
import { loadedEuroPalletParametrics } from './parametrics'
import { LoadedEuroPalletNode } from './schema'

export const loadedEuroPalletDefinition = {
  kind: 'warehouse:loaded-euro-pallet',
  snapProfile: 'item',
  facingIndicator: true,
  schemaVersion: 1,
  schema: LoadedEuroPalletNode,
  category: 'furnish',
  surfaceRole: 'furnishing',

  defaults: () => ({
    object: 'node' as const,
    name: 'Loaded EUR-Pallet',
    parentId: null,
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    visible: true,
    metadata: {},
    width: 1.2,
    height: 1.15,
    depth: 0.8,
    cargoType: 'boxes' as const,
    wrapPlastic: true,
    cornerGuards: true,
    boxColor: '#cda27b',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    presettable: true,
    floorPlaced: {
      footprint: (node) => {
        const item = node as unknown as LoadedEuroPalletNode
        return {
          dimensions: [item.width || 1.2, item.height || 1.15, item.depth || 0.8],
          rotation: item.rotation || [0, 0, 0],
          position: [0, (item.height || 1.15) / 2, 0],
        }
      },
      applies: () => true,
      collides: true,
    },
  },

  affordanceTools: {
    move: () => import('./move-tool'),
  },

  parametrics: {
    groups: [],
    customPanel: () => import('./panel'),
  } as never,

  floorplan: buildLoadedEuroPalletFloorplan,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place item' },
    { key: 'R / T', label: 'Rotate' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Loaded EUR-Pallet',
    description: 'EUR 1 wooden pallet loaded with boxes/cargo and stretch foil wrap.',
    icon: { kind: 'url', src: '/icons/shelf.webp' },
    hidden: true,
    paletteOrder: 211,
  },
} satisfies NodeDefinition<typeof LoadedEuroPalletNode>
