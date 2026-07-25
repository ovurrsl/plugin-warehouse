import type { FloorplanGeometry } from '@pascal-app/core'
import type { LoadedEuroPalletNode } from './schema'

/**
 * 1:1 Official Loaded EPAL EUR-Pallet 2D Floorplan Architectural Geometry
 * Standard: PALETTE EUR-EPAL © Base + FEFCO Cartons & Stretch Film Packaging
 */
export function buildLoadedEuroPalletFloorplan(node: LoadedEuroPalletNode): FloorplanGeometry | null {
  const { width = 1.2, depth = 0.8, height = 1.15, cargoType = 'boxes' } = node
  const [px, , pz] = node.position ?? [0, 0, 0]
  const ry = Array.isArray(node.rotation) ? node.rotation[1] ?? 0 : (node.rotation as any) ?? 0
  const planRy = -ry

  const hw = width / 2
  const hd = depth / 2

  const footprintChildren: FloorplanGeometry[] = []

  // 1. EPAL Base Polygon with Corner Chamfers
  const c = 0.02
  const basePolygonPoints: [number, number][] = [
    [-hw + c, -hd],
    [hw - c, -hd],
    [hw, -hd + c],
    [hw, hd - c],
    [hw - c, hd],
    [-hw + c, hd],
    [-hw, hd - c],
    [-hw, -hd + c],
  ]

  footprintChildren.push({
    kind: 'polygon',
    points: basePolygonPoints,
    stroke: '#e69a47',
    strokeWidth: 0.02,
    fill: 'rgba(254, 235, 208, 0.5)',
  })

  // 2. Outer Stretch Wrap Plastic Envelope Box
  footprintChildren.push({
    kind: 'rect',
    x: -hw - 0.01,
    y: -hd - 0.01,
    width: width + 0.02,
    height: depth + 0.02,
    stroke: '#94a3b8',
    strokeWidth: 0.015,
    strokeDasharray: '0.04 0.04',
    fill: 'rgba(205, 162, 123, 0.25)',
  })

  // 3. 2x2 Cargo Box Grid Lines
  footprintChildren.push({
    kind: 'line',
    x1: 0,
    y1: -hd,
    x2: 0,
    y2: hd,
    stroke: '#8c5a2b',
    strokeWidth: 0.015,
  })
  footprintChildren.push({
    kind: 'line',
    x1: -hw,
    y1: 0,
    x2: hw,
    y2: 0,
    stroke: '#8c5a2b',
    strokeWidth: 0.015,
  })

  // 4. Black V-Board Corner Protector L-indicators
  const gLen = 0.08
  footprintChildren.push({ kind: 'line', x1: -hw, y1: -hd, x2: -hw + gLen, y2: -hd, stroke: '#0f172a', strokeWidth: 0.03 })
  footprintChildren.push({ kind: 'line', x1: -hw, y1: -hd, x2: -hw, y2: -hd + gLen, stroke: '#0f172a', strokeWidth: 0.03 })
  footprintChildren.push({ kind: 'line', x1: hw - gLen, y1: -hd, x2: hw, y2: -hd, stroke: '#0f172a', strokeWidth: 0.03 })
  footprintChildren.push({ kind: 'line', x1: hw, y1: -hd, x2: hw, y2: -hd + gLen, stroke: '#0f172a', strokeWidth: 0.03 })
  footprintChildren.push({ kind: 'line', x1: -hw, y1: hd, x2: -hw + gLen, y2: hd, stroke: '#0f172a', strokeWidth: 0.03 })
  footprintChildren.push({ kind: 'line', x1: -hw, y1: hd, x2: -hw, y2: hd - gLen, stroke: '#0f172a', strokeWidth: 0.03 })
  footprintChildren.push({ kind: 'line', x1: hw - gLen, y1: hd, x2: hw, y2: hd, stroke: '#0f172a', strokeWidth: 0.03 })
  footprintChildren.push({ kind: 'line', x1: hw, y1: hd, x2: hw, y2: hd - gLen, stroke: '#0f172a', strokeWidth: 0.03 })

  // 5. Architectural Text Label
  footprintChildren.push({
    kind: 'text',
    x: 0,
    y: 0,
    text: `EPAL 1 Loaded • ${cargoType.toUpperCase()} (${height}m)`,
    fontSize: 0.09,
    fill: '#451a03',
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
