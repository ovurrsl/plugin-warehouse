import { type AnyNodeId, useScene } from '@pascal-app/core'

import type { AccessMode, NamingStrategy, PalletRackNode, SignMountStyle } from './schema'
import { bayPitch } from './slots'

const POSITION_EPSILON = 0.005
const ELEVATION_EPSILON = 0.1
const TWO_PI = Math.PI * 2

export type BaySequenceMode = 'sequential' | 'odd' | 'even'

export interface RowNamingOptions {
  label: string
  sequenceMode?: BaySequenceMode
  startBay?: number
  bayStep?: number
  accessMode?: AccessMode
  frontAisleLabel?: string
  rearAisleLabel?: string
  namingStrategy?: NamingStrategy
  zoneCode?: string
  signMountStyle?: SignMountStyle
}

export interface AislePairLabels {
  frontAisle: string
  rearAisle: string
  signDisplay: string
}

export function normalizeAngle(angle: number): number {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI
}

export function positionKey(x: number, z: number, y: number = 0): string {
  const roundedX = Math.round(x / POSITION_EPSILON)
  const roundedZ = Math.round(z / POSITION_EPSILON)
  const roundedY = Math.round(y / ELEVATION_EPSILON)
  return `${roundedX}:${roundedZ}:y${roundedY}`
}

export function leftNeighbourPosition(rack: PalletRackNode): [number, number] {
  const [x, , z] = rack.position
  const rotationY = rack.rotation?.[1] ?? 0
  const pitch = rack.bayClearWidth + rack.uprightWidth
  return [x - pitch * Math.cos(rotationY), z + pitch * Math.sin(rotationY)]
}

export function rightNeighbourPosition(rack: PalletRackNode): [number, number] {
  const [x, , z] = rack.position
  const rotationY = rack.rotation?.[1] ?? 0
  const pitch = rack.bayClearWidth + rack.uprightWidth
  return [x + pitch * Math.cos(rotationY), z - pitch * Math.sin(rotationY)]
}

export function computeBayIndex(index: number, mode: BaySequenceMode = 'sequential'): number {
  switch (mode) {
    case 'odd':
      return index * 2 + 1
    case 'even':
      return (index + 1) * 2
    case 'sequential':
    default:
      return index + 1
  }
}

export function parseAislePairInput(input: string): AislePairLabels {
  const trimmed = input.trim()
  const parts = trimmed.split(/[\s\/\-_]+/).filter(Boolean)

  const p0 = parts[0]
  const p1 = parts[1]
  if (parts.length >= 2 && p0 && p1) {
    const front = p0.toUpperCase()
    const rear = p1.toUpperCase()
    return {
      frontAisle: front,
      rearAisle: rear,
      signDisplay: `${front} ${rear}`,
    }
  }

  const front = (p0 || 'A').toUpperCase()
  let rear: string
  const lastCharCode = front.charCodeAt(front.length - 1)
  if (lastCharCode >= 65 && lastCharCode <= 89) {
    rear = front.slice(0, -1) + String.fromCharCode(lastCharCode + 1)
  } else if (!isNaN(Number(front))) {
    rear = String(Number(front) + 1).padStart(front.length, '0')
  } else {
    rear = `${front}-2`
  }

  return {
    frontAisle: front,
    rearAisle: rear,
    signDisplay: `${front} ${rear}`,
  }
}

/**
 * Belirli bir raftan başlayarak, aynı hizadaki birbirine yapışık tüm rafları (sırayı) bulur.
 * Rafları fiziksel diziliş sırasına göre (sol uçtan sağ uca) döndürür.
 * Açıyı normalleştirir ve O(1) Set kullanarak döngüleri engeller.
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

  // Pozisyona göre hızlı arama map'i (açı normalizasyonu ve Y kotu izolasyonu ile)
  const byPosition = new Map<string, PalletRackNode>()
  for (const rack of racks) {
    const [x, y, z] = rack.position
    const rot = Math.round(normalizeAngle(rack.rotation?.[1] ?? 0) * 1000)
    byPosition.set(`${positionKey(x, z, y)}:${rot}`, rack)
  }

  const findNeighbour = (
    pos: [number, number],
    y: number,
    rotationY: number,
    supportSlabId?: string | null
  ): PalletRackNode | undefined => {
    const rot = Math.round(normalizeAngle(rotationY) * 1000)
    const neighbour = byPosition.get(`${positionKey(pos[0], pos[1], y)}:${rot}`)
    if (!neighbour) return undefined
    if (
      supportSlabId &&
      neighbour.supportSlabId &&
      supportSlabId !== neighbour.supportSlabId
    ) {
      return undefined
    }
    return neighbour
  }

  // Sol uca (başlangıca) git
  let currentLeft = startNode as PalletRackNode
  const visitedLeft = new Set<string>([currentLeft.id])
  while (true) {
    const leftPos = leftNeighbourPosition(currentLeft)
    const left = findNeighbour(
      leftPos,
      currentLeft.position[1] ?? 0,
      currentLeft.rotation?.[1] ?? 0,
      currentLeft.supportSlabId
    )
    if (!left || left.id === currentLeft.id || visitedLeft.has(left.id)) break
    visitedLeft.add(left.id)
    currentLeft = left
  }

  // Şimdi sol uçtan başlayıp sağa doğru diz (O(1) Set guard ile)
  const row: string[] = []
  const visitedRight = new Set<string>()
  let currentRight: PalletRackNode | undefined = currentLeft
  while (currentRight) {
    if (visitedRight.has(currentRight.id)) break // Loop prevention
    visitedRight.add(currentRight.id)
    row.push(currentRight.id)
    const rightPos = rightNeighbourPosition(currentRight)
    const right = findNeighbour(
      rightPos,
      currentRight.position[1] ?? 0,
      currentRight.rotation?.[1] ?? 0,
      currentRight.supportSlabId
    )
    if (!right || right.id === currentRight.id) break
    currentRight = right
  }

  return row
}

/**
 * Belirli bir rafın bağlı olduğu sıranın ilk ve son raf durumunu tek geçişte döndürür.
 */
export function getEndRackStatus(
  nodes: Readonly<Record<string, unknown>>,
  rackId: string
): { isFirst: boolean; isLast: boolean } {
  const row = getContiguousRackRow(nodes, rackId)
  if (row.length === 0) return { isFirst: false, isLast: false }
  return {
    isFirst: row[0] === rackId,
    isLast: row[row.length - 1] === rackId,
  }
}

/**
 * Belirli bir rafın bağlı olduğu sıranın ilk (en sol) rafı olup olmadığını belirler.
 */
export function isFirstRackOfRow(
  nodes: Readonly<Record<string, unknown>>,
  rackId: string
): boolean {
  return getEndRackStatus(nodes, rackId).isFirst
}

/**
 * Belirli bir rafın bağlı olduğu sıranın son (en sağ) rafı olup olmadığını belirler.
 */
export function isLastRackOfRow(
  nodes: Readonly<Record<string, unknown>>,
  rackId: string
): boolean {
  return getEndRackStatus(nodes, rackId).isLast
}

/**
 * Sırt sırta yerleştirilmiş paralel partner sırayı bulur.
 */
export function findBackToBackRow(
  nodes: Readonly<Record<string, unknown>>,
  primaryRowIds: string[]
): string[] | null {
  const firstId = primaryRowIds[0]
  if (!firstId) return null
  const firstRack = nodes[firstId] as PalletRackNode | undefined
  if (!firstRack || !firstRack.position) return null

  const [x1, , z1] = firstRack.position
  const rot1 = normalizeAngle(firstRack.rotation?.[1] ?? 0)
  const targetRot = normalizeAngle(rot1 + Math.PI)
  const depth = firstRack.depth ?? 1.1

  // Arka yön vektörü (local -Z)
  const uRearX = -Math.sin(rot1)
  const uRearZ = -Math.cos(rot1)

  const minDist = depth + 0.05
  const maxDist = depth + 0.50

  const racks = Object.values(nodes).filter(
    (n): n is PalletRackNode => (n as any)?.type === 'warehouse:pallet-rack'
  )

  for (const candidate of racks) {
    if (primaryRowIds.includes(candidate.id)) continue
    // Y kotu ve destek döşemesi kontrolü
    const dy = Math.abs((candidate.position?.[1] ?? 0) - (firstRack.position?.[1] ?? 0))
    if (dy > ELEVATION_EPSILON) continue
    if (
      firstRack.supportSlabId &&
      candidate.supportSlabId &&
      firstRack.supportSlabId !== candidate.supportSlabId
    ) {
      continue
    }
    const candRot = normalizeAngle(candidate.rotation?.[1] ?? 0)
    const diff = Math.abs(candRot - targetRot)
    if (diff > 0.05 && Math.abs(diff - 2 * Math.PI) > 0.05) continue

    const dx = candidate.position[0] - x1
    const dz = candidate.position[2] - z1
    const distSpine = dx * uRearX + dz * uRearZ
    if (distSpine < minDist || distSpine > maxDist) continue

    const uRowX = Math.cos(rot1)
    const uRowZ = -Math.sin(rot1)
    const distAlongRow = dx * uRowX + dz * uRowZ

    if (distAlongRow >= -0.5 && distAlongRow <= primaryRowIds.length * bayPitch(firstRack) + 0.5) {
      const partnerRow = getContiguousRackRow(nodes, candidate.id)
      if (partnerRow.length > 0) return partnerRow
    }
  }

  return null
}

/**
 * Karşı koridordaki yüz yüze bakan raf sırasını bulur.
 */
export function findFacingAisleRow(
  nodes: Readonly<Record<string, unknown>>,
  primaryRowIds: string[]
): string[] | null {
  const firstId = primaryRowIds[0]
  if (!firstId) return null
  const firstRack = nodes[firstId] as PalletRackNode | undefined
  if (!firstRack || !firstRack.position) return null

  const [x1, , z1] = firstRack.position
  const rot1 = normalizeAngle(firstRack.rotation?.[1] ?? 0)
  const targetRot = normalizeAngle(rot1 + Math.PI)
  const depth = firstRack.depth ?? 1.1

  // Ön yön vektörü (local +Z)
  const uFrontX = Math.sin(rot1)
  const uFrontZ = Math.cos(rot1)

  const minAisle = depth + 1.0
  const maxAisle = depth + 6.0

  const racks = Object.values(nodes).filter(
    (n): n is PalletRackNode => (n as any)?.type === 'warehouse:pallet-rack'
  )

  for (const candidate of racks) {
    if (primaryRowIds.includes(candidate.id)) continue
    // Y kotu ve destek döşemesi kontrolü
    const dy = Math.abs((candidate.position?.[1] ?? 0) - (firstRack.position?.[1] ?? 0))
    if (dy > ELEVATION_EPSILON) continue
    if (
      firstRack.supportSlabId &&
      candidate.supportSlabId &&
      firstRack.supportSlabId !== candidate.supportSlabId
    ) {
      continue
    }
    const candRot = normalizeAngle(candidate.rotation?.[1] ?? 0)
    const diff = Math.abs(candRot - targetRot)
    if (diff > 0.05 && Math.abs(diff - 2 * Math.PI) > 0.05) continue

    const dx = candidate.position[0] - x1
    const dz = candidate.position[2] - z1
    const distAisle = dx * uFrontX + dz * uFrontZ
    if (distAisle < minAisle || distAisle > maxAisle) continue

    const partnerRow = getContiguousRackRow(nodes, candidate.id)
    if (partnerRow.length > 0) return partnerRow
  }

  return null
}

/**
 * Sırt sırta sıralarda göz numaralarının aynı koridor ağzından başlaması için sıralar.
 */
export function alignBackToBackBays(
  nodes: Readonly<Record<string, unknown>>,
  row1Ids: string[],
  row2Ids: string[]
): { alignedRow1: string[]; alignedRow2: string[] } {
  if (row1Ids.length === 0 || row2Ids.length === 0) {
    return { alignedRow1: row1Ids, alignedRow2: row2Ids }
  }

  const firstId = row1Ids[0]
  if (!firstId) {
    return { alignedRow1: row1Ids, alignedRow2: row2Ids }
  }
  const r1Start = nodes[firstId] as PalletRackNode | undefined
  if (!r1Start || !r1Start.position) {
    return { alignedRow1: row1Ids, alignedRow2: row2Ids }
  }

  const rot1 = r1Start.rotation?.[1] ?? 0
  const uRowX = Math.cos(rot1)
  const uRowZ = -Math.sin(rot1)

  const sortedRow2 = [...row2Ids].sort((aId, bId) => {
    const a = nodes[aId] as PalletRackNode | undefined
    const b = nodes[bId] as PalletRackNode | undefined
    const projA = a?.position ? a.position[0] * uRowX + a.position[2] * uRowZ : 0
    const projB = b?.position ? b.position[0] * uRowX + b.position[2] * uRowZ : 0
    return projA - projB
  })

  return {
    alignedRow1: row1Ids,
    alignedRow2: sortedRow2,
  }
}

/**
 * Sıraya genel isimlendirme stratejisi uygular (sequential, odd, even, face-split, aisle-pairs).
 */
export function applyRowNamingStrategy(
  startRackId: string,
  options: RowNamingOptions | string
) {
  const opts: RowNamingOptions = typeof options === 'string' ? { label: options } : options
  const scene = useScene.getState()
  const rowIds = getContiguousRackRow(scene.nodes, startRackId)
  if (rowIds.length === 0) return

  const seqMode = opts.sequenceMode ?? 'sequential'

  rowIds.forEach((id, index) => {
    const existing = (scene.nodes as Record<string, any>)[id] as PalletRackNode | undefined
    const pos = existing?.position ?? [0, 0, 0]
    const bayIdx = computeBayIndex(index, seqMode)

    const update: Record<string, any> = {
      rowLabel: opts.label,
      bayIndex: bayIdx,
      position: [pos[0], pos[1], pos[2]],
    }

    if (opts.frontAisleLabel !== undefined) update.frontAisleLabel = opts.frontAisleLabel
    if (opts.rearAisleLabel !== undefined) update.rearAisleLabel = opts.rearAisleLabel
    if (opts.accessMode !== undefined) update.accessMode = opts.accessMode
    if (opts.namingStrategy !== undefined) update.namingStrategy = opts.namingStrategy
    if (opts.zoneCode !== undefined) update.zoneCode = opts.zoneCode
    if (opts.signMountStyle !== undefined) update.signMountStyle = opts.signMountStyle

    scene.updateNode(id as AnyNodeId, update as any)
  })
}

/**
 * Belirli bir sıraya label atar ve baştan sona indexleri 1, 2, 3.. diye numaralandırır.
 */
export function applyRowLabelToContiguousRacks(startRackId: string, label: string) {
  applyRowNamingStrategy(startRackId, { label, sequenceMode: 'sequential' })
}

/**
 * Çift taraflı (dual-facing / pass-through) bir sıraya ön ve arka koridor etiketlerini atar.
 */
export function applyFaceSplitNaming(
  startRackId: string,
  frontAisle: string,
  rearAisle?: string,
  options?: {
    sequenceMode?: BaySequenceMode
    zoneCode?: string
    signMountStyle?: SignMountStyle
  }
) {
  const scene = useScene.getState()
  const rowIds = getContiguousRackRow(scene.nodes, startRackId)
  if (rowIds.length === 0) return

  const parsed = parseAislePairInput(rearAisle ? `${frontAisle} ${rearAisle}` : frontAisle)
  const mode = options?.sequenceMode ?? 'sequential'

  rowIds.forEach((id, index) => {
    const existing = (scene.nodes as Record<string, any>)[id] as PalletRackNode | undefined
    const pos = existing?.position ?? [0, 0, 0]
    const bayIdx = computeBayIndex(index, mode)

    scene.updateNode(id as AnyNodeId, {
      rowLabel: parsed.signDisplay,
      frontAisleLabel: parsed.frontAisle,
      rearAisleLabel: parsed.rearAisle,
      accessMode: 'dual-facing',
      namingStrategy: 'face-split',
      bayIndex: bayIdx,
      zoneCode: options?.zoneCode ?? existing?.zoneCode ?? '',
      signMountStyle: options?.signMountStyle ?? existing?.signMountStyle ?? 'flag',
      position: [pos[0], pos[1], pos[2]],
    } as any)
  })
}

/**
 * Sırt sırta (back-to-back) iki sıraya koridor çifti etiketlerini atar ve gözleri hizalar.
 */
export function applyBackToBackPairNaming(
  startRackId: string,
  aislePairInput: string,
  partnerStartRackId?: string,
  options?: {
    zoneCode?: string
    sequenceMode?: BaySequenceMode
    signMountStyle?: SignMountStyle
  }
) {
  const scene = useScene.getState()
  const row1Ids = getContiguousRackRow(scene.nodes, startRackId)
  if (row1Ids.length === 0) return

  const parsed = parseAislePairInput(aislePairInput)
  const mode = options?.sequenceMode ?? 'sequential'

  let row2Ids: string[] = []
  if (partnerStartRackId) {
    row2Ids = getContiguousRackRow(scene.nodes, partnerStartRackId)
  } else {
    row2Ids = findBackToBackRow(scene.nodes, row1Ids) ?? []
  }

  // Row 1
  row1Ids.forEach((id, index) => {
    const existing = (scene.nodes as Record<string, any>)[id] as PalletRackNode | undefined
    const pos = existing?.position ?? [0, 0, 0]
    scene.updateNode(id as AnyNodeId, {
      rowLabel: parsed.signDisplay,
      frontAisleLabel: parsed.frontAisle,
      bayIndex: computeBayIndex(index, mode),
      namingStrategy: 'aisle-pairs',
      accessMode: 'single-face',
      zoneCode: options?.zoneCode ?? existing?.zoneCode ?? '',
      signMountStyle: options?.signMountStyle ?? existing?.signMountStyle ?? 'flag',
      position: [pos[0], pos[1], pos[2]],
    } as any)
  })

  // Row 2 (aligned)
  if (row2Ids.length > 0) {
    const { alignedRow2 } = alignBackToBackBays(scene.nodes, row1Ids, row2Ids)
    alignedRow2.forEach((id, index) => {
      const existing = (scene.nodes as Record<string, any>)[id] as PalletRackNode | undefined
      const pos = existing?.position ?? [0, 0, 0]
      scene.updateNode(id as AnyNodeId, {
        rowLabel: parsed.signDisplay,
        frontAisleLabel: parsed.rearAisle,
        bayIndex: computeBayIndex(index, mode),
        namingStrategy: 'aisle-pairs',
        accessMode: 'single-face',
        zoneCode: options?.zoneCode ?? existing?.zoneCode ?? '',
        signMountStyle: options?.signMountStyle ?? existing?.signMountStyle ?? 'flag',
        position: [pos[0], pos[1], pos[2]],
      } as any)
    })
  }
}

/**
 * Karşılıklı bakan sıralara aynı koridor etiketi altında tek ve çift bay numaralandırması uygular.
 */
export function applyAisleOddEvenNaming(
  aisleLabel: string,
  oddRowStartId: string,
  evenRowStartId?: string,
  options?: {
    zoneCode?: string
    signMountStyle?: SignMountStyle
  }
) {
  const scene = useScene.getState()
  const oddRowIds = getContiguousRackRow(scene.nodes, oddRowStartId)
  if (oddRowIds.length === 0) return

  let evenRowIds: string[] = []
  if (evenRowStartId) {
    evenRowIds = getContiguousRackRow(scene.nodes, evenRowStartId)
  } else {
    evenRowIds = findFacingAisleRow(scene.nodes, oddRowIds) ?? []
  }

  // 1. Odd Row
  oddRowIds.forEach((id, index) => {
    const existing = (scene.nodes as Record<string, any>)[id] as PalletRackNode | undefined
    const pos = existing?.position ?? [0, 0, 0]
    scene.updateNode(id as AnyNodeId, {
      rowLabel: aisleLabel,
      frontAisleLabel: aisleLabel,
      bayIndex: computeBayIndex(index, 'odd'),
      namingStrategy: 'odd-even',
      accessMode: 'single-face',
      zoneCode: options?.zoneCode ?? existing?.zoneCode ?? '',
      signMountStyle: options?.signMountStyle ?? existing?.signMountStyle ?? 'flag',
      position: [pos[0], pos[1], pos[2]],
    } as any)
  })

  // 2. Even Row
  if (evenRowIds.length > 0) {
    const { alignedRow2 } = alignBackToBackBays(scene.nodes, oddRowIds, evenRowIds)
    alignedRow2.forEach((id, index) => {
      const existing = (scene.nodes as Record<string, any>)[id] as PalletRackNode | undefined
      const pos = existing?.position ?? [0, 0, 0]
      scene.updateNode(id as AnyNodeId, {
        rowLabel: aisleLabel,
        frontAisleLabel: aisleLabel,
        bayIndex: computeBayIndex(index, 'even'),
        namingStrategy: 'odd-even',
        accessMode: 'single-face',
        zoneCode: options?.zoneCode ?? existing?.zoneCode ?? '',
        signMountStyle: options?.signMountStyle ?? existing?.signMountStyle ?? 'flag',
        position: [pos[0], pos[1], pos[2]],
      } as any)
    })
  }
}

/**
 * Belirli bir sıradaki tüm raflara tabela montaj stilini ('flag' | 'flush') uygular.
 */
export function applySignMountStyleToContiguousRacks(
  startRackId: string,
  style: SignMountStyle
) {
  const scene = useScene.getState()
  const rowIds = getContiguousRackRow(scene.nodes, startRackId)

  if (rowIds.length === 0) {
    scene.updateNode(startRackId as AnyNodeId, {
      signMountStyle: style,
    } as any)
    return
  }

  rowIds.forEach((id) => {
    scene.updateNode(id as AnyNodeId, {
      signMountStyle: style,
    } as any)
  })
}

