import { type AnyNodeId, useScene } from '@pascal-app/core'

import type { PalletRackNode } from './schema'

const POSITION_EPSILON = 0.005

function positionKey(x: number, z: number): string {
  return `${Math.round(x / POSITION_EPSILON)}:${Math.round(z / POSITION_EPSILON)}`
}

function leftNeighbourPosition(rack: PalletRackNode): [number, number] {
  const [x, , z] = rack.position
  const rotationY = rack.rotation?.[1] ?? 0
  const pitch = rack.bayClearWidth + rack.uprightWidth
  return [x - pitch * Math.cos(rotationY), z + pitch * Math.sin(rotationY)]
}

function rightNeighbourPosition(rack: PalletRackNode): [number, number] {
  const [x, , z] = rack.position
  const rotationY = rack.rotation?.[1] ?? 0
  const pitch = rack.bayClearWidth + rack.uprightWidth
  return [x + pitch * Math.cos(rotationY), z - pitch * Math.sin(rotationY)]
}

/**
 * Belirli bir raftan başlayarak, aynı hizadaki birbirine yapışık tüm rafları (sırayı) bulur.
 * Rafları fiziksel diziliş sırasına göre (sol uçtan sağ uca) döndürür.
 */
export function getContiguousRackRow(
  nodes: Readonly<Record<string, unknown>>,
  startRackId: string
): string[] {
  const startNode = nodes[startRackId]
  if (!startNode || (startNode as any).type !== 'warehouse:pallet-rack') return []

  const racks = Object.values(nodes).filter(
    (n): n is PalletRackNode => (n as any)?.type === 'warehouse:pallet-rack'
  )

  // Pozisyona göre hızlı arama map'i
  const byPosition = new Map<string, PalletRackNode>()
  for (const rack of racks) {
    const [x, , z] = rack.position
    // Sadece açıları uyuşanları aynı sıradan kabul et
    const rot = Math.round((rack.rotation?.[1] ?? 0) * 1000)
    byPosition.set(`${positionKey(x, z)}:${rot}`, rack)
  }

  const findNeighbour = (pos: [number, number], rotationY: number): PalletRackNode | undefined => {
    const rot = Math.round(rotationY * 1000)
    return byPosition.get(`${positionKey(pos[0], pos[1])}:${rot}`)
  }

  // Sol uca (başlangıca) git
  let currentLeft = startNode as PalletRackNode
  while (true) {
    const leftPos = leftNeighbourPosition(currentLeft)
    const left = findNeighbour(leftPos, currentLeft.rotation?.[1] ?? 0)
    if (!left || left.id === currentLeft.id) break
    currentLeft = left
  }

  // Şimdi sol uçtan başlayıp sağa doğru diz
  const row: string[] = []
  let currentRight: PalletRackNode | undefined = currentLeft
  while (currentRight) {
    if (row.includes(currentRight.id)) break // Loop prevention
    row.push(currentRight.id)
    const rightPos = rightNeighbourPosition(currentRight)
    const right = findNeighbour(rightPos, currentRight.rotation?.[1] ?? 0)
    if (!right || right.id === currentRight.id) break
    currentRight = right
  }

  return row
}

/**
 * Belirli bir sıraya label atar ve baştan sona indexleri 1, 2, 3.. diye numaralandırır.
 */
export function applyRowLabelToContiguousRacks(startRackId: string, label: string) {
  const scene = useScene.getState()
  const rowIds = getContiguousRackRow(scene.nodes, startRackId)
  
  rowIds.forEach((id, index) => {
    scene.updateNode(id as AnyNodeId, {
      rowLabel: label,
      bayIndex: index + 1
    } as any)
  })
}
