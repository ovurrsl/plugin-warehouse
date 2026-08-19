import type { NodeDefinition } from '@pascal-app/core'
import { treeLabel } from '../tree-label'
import { buildRouteFloorplan } from './floorplan'
import { routeParametrics } from './parametrics'
import { RouteNode } from './schema'
import { outerHalfWidthM, type Point } from './stripes'

/**
 * A marked route: the pedestrian way and the vehicle aisle.
 *
 * The older editor carried this as a host `path` node, which the current host
 * no longer ships — so this is a real gap the plugin fills rather than a
 * duplication of something already there.
 */

/** The plan box a route occupies, in node-local metres. */
function localBounds(node: RouteNode): { width: number; depth: number; centre: Point } {
  const half = outerHalfWidthM(node.width, node.lineWidth)
  const origin = node.points[0] ?? [0, 0]
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const point of node.points) {
    minX = Math.min(minX, point[0] - origin[0])
    maxX = Math.max(maxX, point[0] - origin[0])
    minZ = Math.min(minZ, point[1] - origin[1])
    maxZ = Math.max(maxZ, point[1] - origin[1])
  }
  return {
    width: maxX - minX + half * 2,
    depth: maxZ - minZ + half * 2,
    centre: [(minX + maxX) / 2, (minZ + maxZ) / 2],
  }
}

export const routeDefinition = {
  kind: 'warehouse:route',
  schemaVersion: 1,
  schema: RouteNode,
  category: 'site',
  surfaceRole: 'furnishing',
  snapProfile: 'structural',

  defaults: () => {
    const { id: _id, type: _type, ...rest } = RouteNode.parse({})
    return rest
  },

  tree: {
    // İki fiş, iki rol. Sabit ad ("Yaya Yolu") araç koridoruna da yapışıyordu.
    label: treeLabel<RouteNode>((node) =>
      node.role === 'vehicle' ? 'Araç Koridoru' : 'Yaya Yolu',
    ),
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    movable: { axes: ['x', 'z'], gridSnap: true },
    snappable: {},

    floorPlaced: {
      /**
       * The box the paint occupies — and **`collides: false`**.
       *
       * Paint is not an obstruction. A route is drawn *through* the space
       * racking and conveyors occupy, and a marking that refused to overlap
       * them could not be drawn down an aisle at all. Whether something stands
       * inside a corridor is a question the route asks about the scene, not a
       * reason to refuse the drawing.
       */
      footprint: (node) => {
        const route = node as unknown as RouteNode
        const bounds = localBounds(route)
        return {
          dimensions: [bounds.width, 0.002, bounds.depth],
          rotation: route.rotation ?? [0, 0, 0],
        }
      },
      applies: () => true,
      collides: false,
    },

    dragBounds: (node) => {
      const route = node as unknown as RouteNode
      const bounds = localBounds(route)
      return { size: [bounds.width, 0.05, bounds.depth], centerY: 0.025 }
    },
  },

  parametrics: routeParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  floorplan: buildRouteFloorplan,

  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: 'Add a corner' },
    { key: 'Double click / Enter', label: 'Finish the route' },
    { key: 'Backspace', label: 'Undo the last corner' },
    { key: 'Escape', label: 'Discard' },
    { key: 'Shift', label: 'Cycle snapping mode' },
  ],

  presentation: {
    label: 'Route',
    description: 'Yaya veya araç yolu — zemine boyanmış iki şerit.',
    icon: { kind: 'iconify', name: 'lucide:route' },
    // Out of the host's auto-derived Build palette, reachable from this
    // plugin's catalog alone. With both surfaces armed, one click commits
    // twice — the host default and this plugin's tool.
    hidden: true,
  },

  mcp: {
    description:
      'A marked floor route in a warehouse — a pedestrian way or a vehicle aisle. `points` is the CENTRELINE as node-local [x, z] metres; `width` is the CLEAR width between the inside faces of the paint, and the stripes are painted outside it. `role` picks pedestrian or vehicle, `traffic` one-way or two-way. `requiredFor` names the truck class a vehicle aisle is sized for and is an id into the published aisle table — never a copy of the figure. `datum` records whether the width was measured to the load face (the default, and how aisle figures are published) or to the frame face. Dimensions are metres.',
  },
} satisfies NodeDefinition<typeof RouteNode>
