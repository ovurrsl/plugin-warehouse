import type { FloorplanGeometry } from '@pascal-app/core'
import type { PalletRackNode } from './schema'

export function buildPalletRackFloorplan(node: PalletRackNode): FloorplanGeometry | null {
  const {
    columns = 1,
    bayWidth = 2.7,
    depth = 1.1,
    uprightHeight = 4.5,
    levels = 4,
    isBackToBack = false,
    rowSpacerDistance = 0.3,
    uprightWidth = 0.08,
    uprightThickness = 0.08,
  } = node

  const [px, , pz] = node.position ?? [0, 0, 0]
  const ry = Array.isArray(node.rotation) ? node.rotation[1] ?? 0 : (node.rotation as any) ?? 0
  const planRy = -ry

  const totalWidth = columns * bayWidth
  const hw = totalWidth / 2
  const hd = depth / 2

  const buildSingleRowGeometry = (offsetY: number): FloorplanGeometry => {
    const children: FloorplanGeometry[] = []

    // 1. Outer Bounding Rectangle of Rack Footprint
    children.push({
      kind: 'rect',
      x: -hw,
      y: -hd + offsetY,
      width: totalWidth,
      height: depth,
      stroke: '#f97316',
      strokeWidth: 0.03,
      fill: 'rgba(249, 115, 22, 0.12)',
    })

    // 2. Upright Steel Posts (Front and Rear Column Lines)
    for (let c = 0; c <= columns; c++) {
      const xPos = -hw + c * bayWidth - uprightWidth / 2

      // Front Post 2D Rect
      children.push({
        kind: 'rect',
        x: xPos,
        y: hd - uprightThickness + offsetY,
        width: uprightWidth,
        height: uprightThickness,
        stroke: '#1e40af',
        strokeWidth: 0.02,
        fill: '#1e40af',
      })

      // Rear Post 2D Rect
      children.push({
        kind: 'rect',
        x: xPos,
        y: -hd + offsetY,
        width: uprightWidth,
        height: uprightThickness,
        stroke: '#1e40af',
        strokeWidth: 0.02,
        fill: '#1e40af',
      })
    }

    // 3. Bay Divider Lines
    for (let c = 1; c < columns; c++) {
      const xPos = -hw + c * bayWidth
      children.push({
        kind: 'line',
        x1: xPos,
        y1: -hd + offsetY,
        x2: xPos,
        y2: hd + offsetY,
        stroke: 'rgba(249, 115, 22, 0.5)',
        strokeWidth: 0.02,
        strokeDasharray: '0.05 0.05',
      })
    }

    // 4. Cross Bracing X Lines across bay ends
    children.push({
      kind: 'line',
      x1: -hw,
      y1: -hd + offsetY,
      x2: -hw + uprightWidth,
      y2: hd + offsetY,
      stroke: '#94a3b8',
      strokeWidth: 0.015,
    })
    children.push({
      kind: 'line',
      x1: hw - uprightWidth,
      y1: -hd + offsetY,
      x2: hw,
      y2: hd + offsetY,
      stroke: '#94a3b8',
      strokeWidth: 0.015,
    })

    return {
      kind: 'group',
      children,
    }
  }

  const allChildren: FloorplanGeometry[] = []

  if (isBackToBack) {
    const halfSpacer = (depth + rowSpacerDistance) / 2
    // Front Row
    allChildren.push(buildSingleRowGeometry(halfSpacer))
    // Rear Row
    allChildren.push(buildSingleRowGeometry(-halfSpacer))

    // 2D Row Spacer Connecting Ties between twin rows
    for (let c = 0; c <= columns; c++) {
      const xPos = -hw + c * bayWidth
      allChildren.push({
        kind: 'line',
        x1: xPos,
        y1: -rowSpacerDistance / 2,
        x2: xPos,
        y2: rowSpacerDistance / 2,
        stroke: '#475569',
        strokeWidth: 0.04,
      })
    }
  } else {
    allChildren.push(buildSingleRowGeometry(0))
  }

  // 2D Architectural Text Label (Bay Count & Height Specification)
  allChildren.push({
    kind: 'text',
    x: 0,
    y: 0,
    text: `${columns} Bay(s) • ${levels} Tiers (${uprightHeight}m)`,
    fontSize: 0.18,
    fill: '#f8fafc',
    textAnchor: 'middle',
    dominantBaseline: 'middle',
    upright: true,
  })

  return {
    kind: 'group',
    transform: { translate: [px, pz], rotate: planRy },
    children: allChildren,
  }
}
