import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import type { CrosswalkNode } from './schema'

export function buildCrosswalkFloorplan(
  node: CrosswalkNode,
  _ctx: GeometryContext,
): FloorplanGeometry | null {
  const width = node.width ?? 3.5
  const length = node.length ?? 2.5
  const count = Math.max(2, node.stripeCount ?? 6)
  const barDepth = length / (count * 2 - 1)
  const step = barDepth * 2
  const startZ = -length / 2 + barDepth / 2

  const children: FloorplanGeometry[] = []
  for (let k = 0; k < count; k++) {
    const z = startZ + k * step
    children.push({
      kind: 'polygon',
      points: [
        [-width / 2, z - barDepth / 2],
        [width / 2, z - barDepth / 2],
        [width / 2, z + barDepth / 2],
        [-width / 2, z + barDepth / 2],
      ],
      fill: node.stripeColor ?? '#ffffff',
      stroke: '#cbd5e1',
      strokeWidth: 0.02,
    })
  }

  return {
    kind: 'group',
    children,
  }
}
