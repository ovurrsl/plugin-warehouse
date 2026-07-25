import type { HandleDescriptor, NodeDefinition } from '@pascal-app/core'
import { buildPalletRackFloorplan } from './floorplan'
import { palletRackParametrics } from './parametrics'
import { PalletRackNode } from './schema'

export type PalletRackDefinition = NodeDefinition<typeof PalletRackNode> & Record<string, unknown>

// 3D Interactive Handles — Dragging X edge adds/removes continuous bays
function palletRackWidthHandle(): HandleDescriptor<PalletRackNode> {
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: 'min',
    min: 1,
    currentValue: (n) => n.columns,
    apply: (initial, newColumns) => {
      const columns = Math.max(1, Math.min(20, Math.round(newColumns)))
      return { columns }
    },
    placement: {
      position: (n) => [(n.columns * n.bayWidth) / 2, n.uprightHeight / 2, 0],
    },
  }
}

// 3D Interactive Handles — Dragging top edge changes height and tiers
function palletRackHeightHandle(): HandleDescriptor<PalletRackNode> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: 1.5,
    currentValue: (n) => n.uprightHeight,
    apply: (initial, newHeight) => {
      const uprightHeight = Math.max(1.5, Math.min(12.0, newHeight))
      const levels = Math.max(1, Math.min(8, Math.round((uprightHeight - 0.3) / (initial.tierHeight ?? 1.1))))
      return { uprightHeight, levels }
    },
    placement: {
      position: (n) => [0, n.uprightHeight, 0],
    },
  }
}

const palletRackHandles: HandleDescriptor<PalletRackNode>[] = [
  palletRackWidthHandle(),
  palletRackHeightHandle(),
]

export const palletRackDefinition = {
  kind: 'warehouse:pallet-rack',
  snapProfile: 'item',
  facingIndicator: true,
  schemaVersion: 1,
  schema: PalletRackNode,
  category: 'furnish',
  surfaceRole: 'furnishing',

  defaults: () => ({
    object: 'node' as const,
    name: 'Pallet Rack',
    parentId: null,
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    visible: true,
    metadata: {},
    columns: 1,
    levels: 4,
    tierHeight: 1.1,
    bayWidth: 2.7,
    depth: 1.1,
    uprightHeight: 4.5,
    isBackToBack: false,
    rowSpacerDistance: 0.3,
    beamThickness: 0.05,
    beamHeight: 0.12,
    beamProfile: 'step-beam' as const,
    uprightWidth: 0.08,
    uprightThickness: 0.08,
    bracingType: 'z-bracing' as const,
    footplateType: 'heavy-duty' as const,
    deckType: 'wire-mesh' as const,
    wireMeshDensity: 'standard-mesh' as const,
    finishStyle: 'brand-new' as const,
    capacitySignage: true,
    showBarcodes: true,
    cornerProtectors: true,
    backMesh: false,
    cargoType: 'pallet' as const,
    palletStyle: 'eur-pallet' as const,
    cargoDistribution: 'random-realistic' as const,
    fillRate: 75,
    uprightColor: '#1e40af',
    beamColor: '#f97316',
    hasPallets: true,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    presettable: true,
    floorPlaced: {
      footprint: (node) => {
        const item = node as unknown as PalletRackNode
        const totalWidth = (item.columns || 1) * (item.bayWidth || 2.7)
        return {
          dimensions: [totalWidth, item.uprightHeight || 4.5, item.depth || 1.1],
          rotation: item.rotation || [0, 0, 0],
          position: [0, (item.uprightHeight || 4.5) / 2, 0],
        }
      },
      applies: () => true,
      collides: true,
    },
  },

  parametrics: palletRackParametrics as never,
  handles: palletRackHandles as never,

  affordanceTools: {
    move: () => import('./move-tool'),
  },

  floorplan: buildPalletRackFloorplan,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Place rack' },
    { key: 'R / T', label: 'Rotate' },
    { key: 'Shift', label: 'Cycle snapping mode' },
    { key: 'Alt', label: 'Force place' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Pallet Rack',
    description: 'Heavy-duty industrial pallet storage rack unit.',
    icon: { kind: 'url', src: '/icons/shelf.webp' },
    hidden: true,
    paletteOrder: 200,
  },

  mcp: {
    description:
      'High-precision industrial pallet racking unit for warehouse storage with configurable tier heights, back-to-back twin rows, beam/upright dimensions, Z-bracing, anchor shoes, and cargo product types (pallets, boxes, steel drums, totes).',
  },
} satisfies NodeDefinition<typeof PalletRackNode>
