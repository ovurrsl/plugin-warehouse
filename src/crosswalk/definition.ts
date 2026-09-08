import type { NodeDefinition } from '@pascal-app/core'
import { clashGuardedMove } from '../clash'
import { treeLabel } from '../tree-label'
import { buildCrosswalkFloorplan } from './floorplan'
import { crosswalkParametrics } from './parametrics'
import { CrosswalkNode } from './schema'

export const crosswalkDefinition = {
  kind: 'warehouse:crosswalk',
  schemaVersion: 1,
  schema: CrosswalkNode,
  category: 'furnish',
  surfaceRole: 'furnishing',
  snapProfile: 'item',
  facingIndicator: true,

  defaults: () => {
    const { id: _id, type: _type, ...rest } = CrosswalkNode.parse({})
    return rest
  },

  tree: {
    label: treeLabel<CrosswalkNode>(() => 'Yaya Geçidi'),
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    movable: { axes: ['x', 'z'], gridSnap: true, ...clashGuardedMove() },
    rotatable: { axes: ['y'] },
    snappable: {},

    floorPlaced: {
      footprint: (node) => {
        const cw = node as unknown as CrosswalkNode
        const w = cw.width ?? 3.5
        const l = cw.length ?? 2.5
        return {
          dimensions: [w, 0.002, l],
          rotation: cw.rotation ?? [0, 0, 0],
        }
      },
    },
  },

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  floorplan: buildCrosswalkFloorplan,
  parametrics: crosswalkParametrics,
  tool: () => import('./tool'),
} satisfies NodeDefinition<typeof CrosswalkNode>
