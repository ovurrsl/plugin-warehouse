import type { FloorplanGeometry } from '@pascal-app/core'
import type { ToteCartNode } from './schema'

export function buildToteCartFloorplan(node: ToteCartNode): FloorplanGeometry | null {
  const { width = 0.6, depth = 0.4, shelfLevels = 3 } = node
  const [px, , pz] = node.position ?? [0, 0, 0]
  const ry = Array.isArray(node.rotation) ? node.rotation[1] ?? 0 : (node.rotation as any) ?? 0
  const planRy = -ry

  const hw = width / 2
  const hd = depth / 2

  const footprintChildren: FloorplanGeometry[] = []

  // Outer Trolley Tube Frame Rectangle
  footprintChildren.push({
    kind: 'rect',
    x: -hw,
    y: -hd,
    width,
    height: depth,
    stroke: '#334155',
    strokeWidth: 0.025,
    fill: 'rgba(51, 65, 85, 0.2)',
  })

  // Plastic Euro Tote Bin Inside Frame
  footprintChildren.push({
    kind: 'rect',
    x: -hw + 0.03,
    y: -hd + 0.03,
    width: width - 0.06,
    height: depth - 0.06,
    stroke: '#2563eb',
    strokeWidth: 0.02,
    fill: 'rgba(37, 99, 235, 0.3)',
  })

  // 4 Castor Wheel Circles at Corners
  const wheelR = 0.04
  const cXs = [-hw + 0.06, hw - 0.06]
  const cZs = [-hd + 0.06, hd - 0.06]
  for (const cx of cXs) {
    for (const cz of cZs) {
      footprintChildren.push({
        kind: 'circle',
        cx,
        cy: cz,
        r: wheelR,
        stroke: '#0f172a',
        strokeWidth: 0.015,
        fill: '#0f172a',
      })
    }
  }

  // Push Handle Bar Line at Right End
  footprintChildren.push({
    kind: 'line',
    x1: hw + 0.02,
    y1: -hd,
    x2: hw + 0.02,
    y2: hd,
    stroke: '#0f172a',
    strokeWidth: 0.03,
  })

  // Architectural Text Label
  footprintChildren.push({
    kind: 'text',
    x: 0,
    y: 0,
    text: `Tote Cart • ${shelfLevels} Tiers`,
    fontSize: 0.09,
    fill: '#1e3a8a',
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
