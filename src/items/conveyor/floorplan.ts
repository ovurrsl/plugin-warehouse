import type { FloorplanGeometry } from '@pascal-app/core'
import type { ConveyorNode } from './schema'

export function buildConveyorFloorplan(node: ConveyorNode): FloorplanGeometry | null {
  const { width = 3.0, depth = 0.8, height = 0.6 } = node
  const [px, , pz] = node.position ?? [0, 0, 0]
  const ry = Array.isArray(node.rotation) ? node.rotation[1] ?? 0 : (node.rotation as any) ?? 0
  const planRy = -ry

  const hw = width / 2
  const hd = depth / 2

  const footprintChildren: FloorplanGeometry[] = []

  // Main Conveyor Bed Outer Frame
  footprintChildren.push({
    kind: 'rect',
    x: -hw,
    y: -hd,
    width,
    height: depth,
    stroke: '#64748b',
    strokeWidth: 0.03,
    fill: 'rgba(100, 116, 139, 0.15)',
  })

  // Wire Mesh Belt Inner Bed
  footprintChildren.push({
    kind: 'rect',
    x: -hw,
    y: -hd + 0.04,
    width,
    height: depth - 0.08,
    stroke: '#94a3b8',
    strokeWidth: 0.015,
    strokeDasharray: '0.05 0.05',
    fill: 'rgba(148, 163, 184, 0.1)',
  })

  // Motor Unit Rect at Drive End
  footprintChildren.push({
    kind: 'rect',
    x: hw - 0.25,
    y: hd,
    width: 0.25,
    height: 0.15,
    stroke: '#1e40af',
    strokeWidth: 0.02,
    fill: '#1e40af',
  })

  // Architectural Text Label
  footprintChildren.push({
    kind: 'text',
    x: 0,
    y: 0,
    text: `Conveyor • ${width}m L × ${depth}m W (${height}m H)`,
    fontSize: 0.14,
    fill: '#334155',
    textAnchor: 'middle',
    dominantBaseline: 'middle',
    upright: true,
  })

  return {
    kind: 'group',
    transform: { translate: [px, pz], rotate: planRy },
    children: footprintChildren,
  }
}
