import type { HandleDescriptor, NodeDefinition } from '@pascal-app/core'
import { buildEuroPalletFloorplan } from './floorplan'
import { euroPalletParametrics } from './parametrics'
import { EuroPalletNode } from './schema'

const GIZMO_SIDE_OFFSET = 0.3
const GIZMO_FRONT_OFFSET = 0.3
const ROTATE_RING_OFFSET = 0.06

function itemRotateHandle(): HandleDescriptor<any> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => {
      const [rx, ry, rz] = initial.rotation ?? [0, 0, 0]
      return { rotation: [rx, ry - delta, rz] }
    },
    placement: {
      position: () => {
        const w = 1.2
        const h = 0.144
        const d = 0.8
        return [w / 2 + GIZMO_SIDE_OFFSET, h / 2, d / 2 + GIZMO_FRONT_OFFSET]
      },
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      radius: () => {
        const w = 1.2
        const d = 0.8
        return Math.hypot(w / 2, d / 2) + ROTATE_RING_OFFSET
      },
      y: () => 0.144 / 2,
    },
  }
}

function itemMoveHandle(): HandleDescriptor<any> {
  return {
    kind: 'tap-action',
    shape: 'move-cross',
    cursor: 'move',
    onActivate: (node, _scene, editor) => editor.engageMoveDrag(node),
    placement: {
      position: () => {
        const w = 1.2
        const h = 0.144
        const d = 0.8
        return [-(w / 2 + GIZMO_SIDE_OFFSET), h / 2, d / 2 + GIZMO_FRONT_OFFSET]
      },
    },
  }
}

export const euroPalletDefinition = {
  kind: 'warehouse:euro-pallet',
  snapProfile: 'item',
  facingIndicator: true,
  schemaVersion: 1,
  schema: EuroPalletNode,
  category: 'furnish',
  surfaceRole: 'furnishing',

  defaults: () => ({
    object: 'node' as const,
    name: 'EUR-Pallet',
    parentId: null,
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    visible: true,
    metadata: {},
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    presettable: true,
    floorPlaced: {
      footprint: (node) => {
        const item = node as unknown as EuroPalletNode
        return {
          dimensions: [1.2, 0.144, 0.8],
          rotation: item.rotation || [0, 0, 0],
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

  floorplan: buildEuroPalletFloorplan,

  handles: () => [itemRotateHandle(), itemMoveHandle()],

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
    label: 'EUR-Pallet',
    description: 'Standard 1200mm × 800mm wooden EUR 1 storage pallet.',
    icon: { kind: 'url', src: '/icons/shelf.webp' },
    hidden: true,
    paletteOrder: 210,
  },
} satisfies NodeDefinition<typeof EuroPalletNode>
