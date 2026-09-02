/**
 * Zero Defect Start-up (ZDSU) Pure Calculation Engine.
 *
 * Grounded in NFPA 13/230, EN 15635, EN 15620, FEM 10.2.02, OSHA 1910.176/178, ANSI B56.1,
 * WERC, TSE, BYKHY, and İSG standards.
 * Pure mathematical functions for zone geometry, capacity, floor utilization, aisle clearances,
 * dock staging ratios, defect detection, and readiness score calculation.
 */

import type { AnyNode, AnyNodeId, ZoneNode } from '@pascal-app/core'
import { pointInPolygon2D } from '@pascal-app/core'
import {
  type FacilityZDSUReport,
  type RegulatoryStandardId,
  type ZDSUClearancePillar,
  type ZDSUDefect,
  type ZDSUGeometryPillar,
  type ZDSUReadinessPillar,
  type ZDSUStagingPillar,
  type ZDSUStatus,
  type ZDSUStoragePillar,
  type ZDSUUtilizationHealth,
  type ZDSUUtilizationPillar,
  type ZDSUZoneRole,
  type ZoneZDSUAudit,
} from './zero-defect-types'
import { getStandardProfile } from './zero-defect-standards'
import { calculateWarehouseZoneTakeoff } from '../takeoff/zone-takeoff'
import type { PalletRackNode } from '../rack/schema'
import { fittedLevelCount, levelClearOpening, levelSurfaceY } from '../rack/slots'
import type { MezzanineNode, MezzanineTier } from '../mezzanine/schema'

// ── Point & Geometry Calculations ───────────────────────────────────────────

export type Point2D = [number, number]

const POINT_TOLERANCE = 0.5

function getPointToSegmentDistance(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSq = dx * dx + dz * dz
  if (lengthSq === 0) return Math.hypot(point[0] - start[0], point[1] - start[1])

  const rawT = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSq
  const t = Math.max(0, Math.min(1, rawT))
  const projected: Point2D = [start[0] + t * dx, start[1] + t * dz]
  return Math.hypot(point[0] - projected[0], point[1] - projected[1])
}

export function pointInPolygonWithTolerance(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false
  if (pointInPolygon2D(point, polygon, { includeBoundary: true })) return true
  return polygon.some((start, index) => {
    const end = polygon[(index + 1) % polygon.length]
    return end ? getPointToSegmentDistance(point, start, end) <= POINT_TOLERANCE : false
  })
}

/**
 * Calculates net polygon area using the Shoelace formula (m²).
 */
export function polygonArea(points: readonly (readonly [number, number])[]): number {
  if (points.length < 3) return 0
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    const pi = points[i]
    const pj = points[j]
    if (pi && pj) {
      area += pi[0] * pj[1] - pj[0] * pi[1]
    }
  }
  return Math.abs(area) / 2
}

/**
 * Calculates continuous closed polygon perimeter (m).
 */
export function polygonPerimeter(points: readonly (readonly [number, number])[]): number {
  if (points.length < 2) return 0
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    const p1 = points[i]
    const p2 = points[j]
    if (p1 && p2) {
      total += Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    }
  }
  return total
}

/**
 * Collects object IDs parented to the same level whose position falls within the zone polygon.
 */
export function collectZoneContentIds(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  zone: ZoneNode,
): AnyNodeId[] {
  const levelId = zone.parentId
  if (!levelId) return []

  const footprint = zone.polygon.map((p) => [p[0], p[1]] as Point2D)
  const fabric = new Set(['wall', 'slab', 'ceiling', 'zone'])

  return Object.values(nodes)
    .filter((node) => {
      const n = node as unknown as Record<string, unknown>
      if (n.parentId !== levelId) return false
      if (typeof n.type === 'string' && fabric.has(n.type)) return false
      const position = n.position
      if (!Array.isArray(position) || position.length < 3) return false
      const [x, , z] = position as number[]
      if (typeof x !== 'number' || typeof z !== 'number') return false
      return pointInPolygonWithTolerance([x, z], footprint)
    })
    .map((node) => (node as unknown as { id: AnyNodeId }).id)
}

// ── Zone Role & Content Classification ──────────────────────────────────────

export function inferZoneRole(
  zone: ZoneNode,
  takeoff: ReturnType<typeof calculateWarehouseZoneTakeoff> | null,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  contentIds: AnyNodeId[],
): ZDSUZoneRole {
  // 1. Explicit metadata override
  const metaRole = (zone.metadata as Record<string, unknown> | undefined)?.role as
    | ZDSUZoneRole
    | undefined
  if (metaRole) return metaRole

  const nameLower = (zone.name || '').toLowerCase()

  // 2. Keyword heuristic on name
  if (nameLower.includes('inbound') || nameLower.includes('receiving') || nameLower.includes('dock in')) {
    return 'staging-inbound'
  }
  if (
    nameLower.includes('outbound') ||
    nameLower.includes('shipping') ||
    nameLower.includes('dispatch') ||
    nameLower.includes('marshalling') ||
    nameLower.includes('dock out')
  ) {
    return 'staging-outbound'
  }
  if (nameLower.includes('pick') || nameLower.includes('forward') || nameLower.includes('order')) {
    return 'picking'
  }
  if (
    nameLower.includes('pack') ||
    nameLower.includes('vas') ||
    nameLower.includes('kitting') ||
    nameLower.includes('assembly') ||
    nameLower.includes('workstation')
  ) {
    return 'vas-packing'
  }
  if (nameLower.includes('drive-in') || nameLower.includes('drivein') || nameLower.includes('drive through')) {
    return 'storage-drivein'
  }
  if (nameLower.includes('live') || nameLower.includes('flow') || nameLower.includes('gravity')) {
    return 'storage-live'
  }
  if (
    nameLower.includes('high-bay') ||
    nameLower.includes('high bay') ||
    nameLower.includes('bulk') ||
    nameLower.includes('reserve') ||
    nameLower.includes('selective') ||
    nameLower.includes('rack')
  ) {
    return 'storage-selective'
  }
  if (nameLower.includes('conveyor') || nameLower.includes('sorter')) {
    return 'conveyor-corridor'
  }
  if (nameLower.includes('aisle') || nameLower.includes('traffic') || nameLower.includes('transit') || nameLower.includes('walkway')) {
    return 'traffic-aisle'
  }
  if (nameLower.includes('quarantine') || nameLower.includes('qa') || nameLower.includes('reject') || nameLower.includes('return')) {
    return 'quarantine'
  }

  // 3. Equipment content heuristic
  let dockCount = 0
  let selectiveCount = 0
  let driveInCount = 0
  let liveCount = 0
  let pickingShelvingCount = 0
  let benchCount = 0
  let conveyorCount = 0
  let routeCount = 0

  for (const id of contentIds) {
    const node = nodes[id]
    if (!node) continue
    const n = node as unknown as Record<string, unknown>
    const type = typeof n.type === 'string' ? n.type : ''
    if (type === 'warehouse:dock-leveller') dockCount++
    else if (type === 'warehouse:pallet-rack') selectiveCount++
    else if (type === 'warehouse:drive-in-rack') driveInCount++
    else if (type === 'warehouse:live-rack') liveCount++
    else if (type === 'warehouse:m3-rack' || type === 'warehouse:longspan-rack' || type === 'warehouse:tote-cart') {
      pickingShelvingCount++
    } else if (type === 'warehouse:bench') benchCount++
    else if (type.startsWith('warehouse:conveyor-')) conveyorCount++
    else if (type === 'warehouse:route') routeCount++
  }

  if (dockCount > 0) return 'staging-inbound'
  if (driveInCount > 0) return 'storage-drivein'
  if (liveCount > 0) return 'storage-live'
  if (selectiveCount > 0) return 'storage-selective'
  if (pickingShelvingCount > 0) return 'picking'
  if (benchCount > 0) return 'vas-packing'
  if (conveyorCount > 0) return 'conveyor-corridor'
  if (routeCount > 0) return 'traffic-aisle'

  return 'generic'
}

// ── Equipment Footprint & Space Utilization ─────────────────────────────────

export function calculateEquipmentFootprint(
  contentIds: AnyNodeId[],
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): number {
  let totalM2 = 0

  for (const id of contentIds) {
    const node = nodes[id]
    if (!node) continue
    const n = node as unknown as Record<string, unknown>
    const type = typeof n.type === 'string' ? n.type : ''

    switch (type) {
      case 'warehouse:pallet-rack': {
        const clearWidth = typeof n.bayClearWidth === 'number' ? n.bayClearWidth : 2.7
        const depth = typeof n.depth === 'number' ? n.depth : 1.1
        totalM2 += (clearWidth + 0.1) * depth
        break
      }
      case 'warehouse:drive-in-rack': {
        const laneWidth = typeof n.laneClearWidth === 'number' ? n.laneClearWidth : 1.35
        const depthPositions = typeof n.palletDepthPositions === 'number' ? n.palletDepthPositions : 4
        totalM2 += (laneWidth + 0.1) * (depthPositions * 1.2)
        break
      }
      case 'warehouse:live-rack': {
        const width = typeof n.widthM === 'number' ? n.widthM : 3.0
        const depth = typeof n.depthM === 'number' ? n.depthM : 6.0
        totalM2 += width * depth
        break
      }
      case 'warehouse:longspan-rack': {
        const width = typeof n.bayClearWidth === 'number' ? n.bayClearWidth : 2.0
        const depth = typeof n.depth === 'number' ? n.depth : 0.8
        totalM2 += width * depth
        break
      }
      case 'warehouse:m3-rack': {
        const width = typeof n.bayClearWidth === 'number' ? n.bayClearWidth : 1.0
        const depth = typeof n.depth === 'number' ? n.depth : 0.5
        totalM2 += width * depth
        break
      }
      case 'warehouse:mezzanine': {
        const outline = n.outlinePolygon
        if (Array.isArray(outline) && outline.length >= 3) {
          totalM2 += polygonArea(outline as readonly (readonly [number, number])[])
        } else {
          totalM2 += 25.0 // Nominal mezzanine default
        }
        break
      }
      case 'warehouse:conveyor-roller':
      case 'warehouse:conveyor-curve':
      case 'warehouse:conveyor-spiral':
      case 'warehouse:conveyor-telescopic':
      case 'warehouse:conveyor-booster':
      case 'warehouse:conveyor-launcher':
      case 'warehouse:conveyor-oblique':
      case 'warehouse:conveyor-transfer': {
        const length =
          typeof n.length === 'number'
            ? n.length
            : typeof n.lengthM === 'number'
              ? n.lengthM
              : typeof n.travelHeight === 'number'
                ? n.travelHeight
                : 3.0
        totalM2 += length * 0.8 // Standard 800mm conveyor width
        break
      }
      case 'warehouse:bench': {
        totalM2 += 2.0 * 1.0 // Standard packing bench: 2.0m x 1.0m
        break
      }
      case 'warehouse:dock-leveller': {
        totalM2 += 2.0 * 2.5 // Standard dock leveller: 2.0m x 2.5m
        break
      }
      case 'warehouse:pallet': {
        const slotRackId = n.slotRackId
        if (!slotRackId) {
          // Staged floor pallet (1.2m x 0.8m)
          totalM2 += 0.96
        }
        break
      }
      case 'warehouse:pallet-lift': {
        totalM2 += 2.2 * 2.2 // VRC shaft footprint
        break
      }
      case 'warehouse:truck': {
        totalM2 += 2.5 * 1.2 // MHE truck footprint
        break
      }
      case 'warehouse:tote-cart': {
        totalM2 += 1.0 * 0.6 // Picking cart footprint
        break
      }
      default:
        break
    }
  }

  return Math.round(totalM2 * 100) / 100
}

export function getOptimalUtilizationRange(role: ZDSUZoneRole): [number, number] {
  switch (role) {
    case 'storage-selective':
      return [45, 65]
    case 'storage-drivein':
    case 'storage-live':
      return [55, 75]
    case 'staging-inbound':
    case 'staging-outbound':
      return [25, 45]
    case 'picking':
      return [30, 50]
    case 'vas-packing':
      return [25, 45]
    case 'conveyor-corridor':
      return [20, 40]
    case 'traffic-aisle':
      return [10, 30]
    case 'quarantine':
    case 'generic':
    default:
      return [30, 60]
  }
}

export function evaluateUtilizationHealth(
  utilizationPct: number,
  role: ZDSUZoneRole,
  hasEquipment: boolean,
): ZDSUUtilizationHealth {
  if (!hasEquipment && utilizationPct === 0) return 'optimal'
  const [minOpt, maxOpt] = getOptimalUtilizationRange(role)

  if (utilizationPct > maxOpt + 10) {
    return 'severe-congestion'
  }
  if (utilizationPct > maxOpt) {
    return 'congested'
  }
  if (utilizationPct < minOpt && hasEquipment) {
    return 'sparse'
  }
  return 'optimal'
}

// ── Complete Zone Audit Calculation Engine ──────────────────────────────────

export interface CalculateZoneZDSUAuditOptions {
  contentIds?: AnyNodeId[]
  ceilingHeightOverride?: number
  defaultMheClass?: 'counterbalance' | 'reach' | 'vna'
  standardId?: RegulatoryStandardId | null
}

/**
 * Calculates a complete Zero Defect Start-up audit for a single warehouse zone.
 */
export function calculateZoneZDSUAudit(
  zone: ZoneNode,
  takeoff: ReturnType<typeof calculateWarehouseZoneTakeoff> | null,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  options: CalculateZoneZDSUAuditOptions = {},
): ZoneZDSUAudit {
  const standardId = options.standardId ?? null
  const standardProfile = standardId ? getStandardProfile(standardId) : null
  const thresholds = standardProfile ? standardProfile.thresholds : null

  // Resolve architectural floor / level information
  const parentLevel = zone.parentId
    ? ((nodes as Record<string, unknown>)[zone.parentId] as unknown as { id?: string; name?: string; level?: number })
    : null
  const levelId = zone.parentId ?? null
  const floorName =
    parentLevel?.name ||
    (parentLevel && typeof parentLevel.level === 'number'
      ? `Level ${parentLevel.level}`
      : 'General Floor')

  const contentIds = options.contentIds ?? collectZoneContentIds(nodes, zone)

  // 1. Pillar 1: Geometry & Spatial Envelope
  const rawPolygon = zone.polygon || []
  const areaM2 = polygonArea(rawPolygon)
  const perimeterM = polygonPerimeter(rawPolygon)
  const clearHeightM =
    options.ceilingHeightOverride ??
    (typeof zone.ceilingHeight === 'number' && zone.ceilingHeight > 0
      ? zone.ceilingHeight
      : 2.7)
  const volumeM3 = Math.round(areaM2 * clearHeightM * 100) / 100
  const vertexCount = rawPolygon.length
  const isValidPolygon = vertexCount >= 3 && areaM2 > 0

  // Infer Zone Role
  const role = inferZoneRole(zone, takeoff, nodes, contentIds)

  // 2. Pillar 2: Storage Capacity & Selectivity
  let selectivePallets = 0
  let selectiveDirect = 0
  let driveInPallets = 0
  let driveInDirect = 0
  let livePallets = 0
  let liveDirect = 0
  let floorPallets = 0
  let pickingSlots = 0
  let shelfAreaM2 = 0

  let maxRackHeight = 0
  let topOffendingRackId: string | undefined
  let topOffendingRackName: string | undefined
  let topOffendingRackLevel: number | undefined
  let minMeasuredFlueSpace = 0.1 // 100mm default
  let flueOffendingRackId: string | undefined
  let flueOffendingRackName: string | undefined
  const mheClassesSet = new Set<string>()
  let dockCount = 0
  let routeCount = 0
  let hasEmergencyRoute = false

  // Deep inspection records
  const deepDefects: ZDSUDefect[] = []

  for (const id of contentIds) {
    const node = nodes[id]
    if (!node) continue
    const n = node as unknown as Record<string, unknown>
    const type = typeof n.type === 'string' ? n.type : ''
    const nodeName = typeof n.name === 'string' ? n.name : undefined

    if (type === 'warehouse:pallet-rack') {
      const rackNode = n as unknown as PalletRackNode
      const levels = typeof n.levels === 'number' ? n.levels : 4
      const positionsPerLevel = 3
      const palletSlots = levels * positionsPerLevel
      selectivePallets += palletSlots
      selectiveDirect += palletSlots
      if (Array.isArray(n.pickingSlots)) {
        pickingSlots += n.pickingSlots.length
      }

      const rackH = typeof n.height === 'number' ? n.height : levels * 1.5
      if (rackH > maxRackHeight) {
        maxRackHeight = rackH
        topOffendingRackId = id
        topOffendingRackName = nodeName || `Selective Rack (${id})`
        topOffendingRackLevel = levels
      }

      const gap = n.depthGap
      if (typeof gap === 'number' && gap < minMeasuredFlueSpace) {
        minMeasuredFlueSpace = gap
        flueOffendingRackId = id
        flueOffendingRackName = nodeName || `Selective Rack (${id})`
      }

      // Deep level-by-level inspection for pallet rack
      const fittedCount = fittedLevelCount(rackNode)
      for (let lvl = 1; lvl <= levels; lvl++) {
        let opening = levelClearOpening(rackNode, lvl - 1)
        if (typeof n.beamLevelSpacing === 'number') {
          const beamThick = typeof n.beamThickness === 'number' ? (n.beamThickness as number) : 0.1
          opening = (n.beamLevelSpacing as number) - beamThick
        }
        if (Array.isArray(n.levelClears) && typeof n.levelClears[lvl - 1] === 'number') {
          opening = n.levelClears[lvl - 1] as number
        } else if (typeof n.levelClear === 'number') {
          opening = n.levelClear as number
        }
        const surfY = levelSurfaceY(rackNode, lvl)

        // Check if individual beam clear opening is critically restricted (< 0.60m)
        if (opening < 0.6) {
          deepDefects.push({
            code: 'ZDSU-R02',
            title: 'Restricted Rack Beam Level Opening',
            message: `Beam Level ${lvl} clear opening (${opening.toFixed(2)}m) is severely restricted.`,
            severity: 'warning',
            pillar: 'clearance',
            standardRef: standardProfile?.citations.racking ?? 'TS EN 15620 / ANSI MH16.1',
            targetNodeId: id,
            targetNodeName: nodeName || `Selective Rack (${id})`,
            targetLevel: lvl,
            targetLayer: `Level ${lvl}`,
            floorName,
          })
        }

        // If top level surface approaches ceiling clearance
        if (lvl === fittedCount && clearHeightM - surfY < (thresholds?.sprinklerClearanceM ?? 0.5)) {
          // Top storage level clearance recorded for deep inspection
          topOffendingRackId = id
          topOffendingRackName = nodeName || `Selective Rack (${id})`
          topOffendingRackLevel = lvl
        }
      }
    } else if (type === 'warehouse:drive-in-rack') {
      const lanes = 1
      const levels = typeof n.storageLevels === 'number' ? n.storageLevels : 4
      const depth = typeof n.palletDepthPositions === 'number' ? n.palletDepthPositions : 4
      const slots = lanes * levels * depth
      driveInPallets += slots
      driveInDirect += lanes * levels

      const laneH = levels * 1.6
      if (laneH > maxRackHeight) {
        maxRackHeight = laneH
        topOffendingRackId = id
        topOffendingRackName = nodeName || `Drive-In Rack (${id})`
        topOffendingRackLevel = levels
      }
    } else if (type === 'warehouse:live-rack') {
      const levels = typeof n.levels === 'number' ? n.levels : 3
      const channels = typeof n.channels === 'number' ? n.channels : 2
      const depth = typeof n.depthPositions === 'number' ? n.depthPositions : 5
      const slots = levels * channels * depth
      livePallets += slots
      liveDirect += levels * channels

      const liveH = levels * 1.6
      if (liveH > maxRackHeight) {
        maxRackHeight = liveH
        topOffendingRackId = id
        topOffendingRackName = nodeName || `Live Rack (${id})`
        topOffendingRackLevel = levels
      }
    } else if (type === 'warehouse:pallet') {
      const slotRackId = n.slotRackId
      if (!slotRackId) {
        floorPallets += 1
      }
    } else if (type === 'warehouse:longspan-rack') {
      const levels = typeof n.levels === 'number' ? n.levels : 3
      const bayW = typeof n.bayClearWidth === 'number' ? n.bayClearWidth : 2.0
      const depth = typeof n.depth === 'number' ? n.depth : 0.8
      shelfAreaM2 += levels * (bayW * depth)
    } else if (type === 'warehouse:m3-rack') {
      const levels = typeof n.levels === 'number' ? n.levels : 4
      const bayW = typeof n.bayClearWidth === 'number' ? n.bayClearWidth : 1.0
      const depth = typeof n.depth === 'number' ? n.depth : 0.5
      shelfAreaM2 += levels * (bayW * depth)
      const drawers = typeof n.drawerCount === 'number' ? n.drawerCount : 0
      pickingSlots += drawers
    } else if (type === 'warehouse:totecart') {
      pickingSlots += typeof n.capacity === 'number' ? n.capacity : 6
    } else if (type === 'warehouse:dock-leveller') {
      dockCount += 1
    } else if (type === 'warehouse:truck') {
      const model = typeof n.model === 'string' ? n.model : 'counterbalance'
      mheClassesSet.add(model)
    } else if (type === 'warehouse:route') {
      routeCount += 1
      const routeRole = n.role
      if (routeRole === 'pedestrian' || routeRole === 'escape' || routeRole === 'egress') {
        hasEmergencyRoute = true
      }
    } else if (type === 'warehouse:mezzanine') {
      const mezzNode = n as unknown as MezzanineNode
      if (Array.isArray(mezzNode.tiers)) {
        for (const tier of mezzNode.tiers) {
          const minHeadroom = thresholds?.mezzanineMinHeadroomM ?? 2.0
          if (typeof tier.clearHeightM === 'number' && tier.clearHeightM < minHeadroom) {
            deepDefects.push({
              code: 'ZDSU-R01',
              title: 'Insufficient Mezzanine Headroom Clearance',
              message: `Mezzanine Tier ${tier.index} clear headroom is ${tier.clearHeightM.toFixed(2)}m (standard requires ≥ ${minHeadroom.toFixed(2)}m).`,
              severity: 'blocking',
              pillar: 'safety',
              standardRef: standardProfile?.citations.mezzanine ?? 'EN ISO 14122-2 / OSHA 1910.28',
              targetNodeId: id,
              targetNodeName: nodeName || `Mezzanine (${id})`,
              targetLevel: tier.index,
              targetLayer: `Tier ${tier.index} Deck`,
              floorName,
            })
          }
        }
      }
    }
  }

  const totalPalletPositions = selectivePallets + driveInPallets + livePallets + floorPallets
  const directAccessPositions = selectiveDirect + driveInDirect + liveDirect + floorPallets
  const selectivityIndex =
    totalPalletPositions > 0 ? Math.round((directAccessPositions / totalPalletPositions) * 100) : 100
  const palletDensityPerM2 = areaM2 > 0 ? Math.round((totalPalletPositions / areaM2) * 100) / 100 : 0

  // 3. Pillar 3: Floor Utilization
  const equipmentFootprintM2 = calculateEquipmentFootprint(contentIds, nodes)
  const floorUtilizationPct = areaM2 > 0 ? Math.round((equipmentFootprintM2 / areaM2) * 1000) / 10 : 0
  const optimalRange = getOptimalUtilizationRange(role)
  const health = evaluateUtilizationHealth(floorUtilizationPct, role, contentIds.length > 0)

  // 4. Pillar 4: Clearance & Equipment Matching
  const minSprinklerReq = thresholds?.sprinklerClearanceM ?? 0.5
  const minFlueReq = thresholds?.minFlueSpaceM ?? 0.075

  const sprinklerClearanceM =
    maxRackHeight > 0 ? Math.max(0, Math.round((clearHeightM - maxRackHeight) * 100) / 100) : clearHeightM
  const sprinklerCompliant = sprinklerClearanceM >= minSprinklerReq
  const flueSpaceCompliant = minMeasuredFlueSpace >= minFlueReq

  const mheClassesPresent = Array.from(mheClassesSet)
  const requiredAisleWidthM = mheClassesPresent.includes('vna-turret')
    ? (thresholds?.aisleWidths.vnaTurret.min ?? 1.65)
    : mheClassesPresent.includes('reach')
      ? (thresholds?.aisleWidths.reach.min ?? 2.7)
      : (thresholds?.aisleWidths.counterbalance.min ?? 3.5) // Counterbalance standard
  const estimatedAisleWidthM = areaM2 > 0 && selectivePallets > 0 ? 3.1 : undefined

  // 5. Pillar 5: Staging Buffer & Dock Ratios
  const stagingAreaPerDockM2 = dockCount > 0 && areaM2 > 0 ? Math.round((areaM2 / dockCount) * 10) / 10 : null
  const trailerBufferCapacityPallets = floorPallets + selectivePallets + driveInPallets + livePallets
  const trailerRatio = dockCount > 0 ? Math.round((trailerBufferCapacityPallets / (dockCount * 33)) * 100) / 100 : null

  // 6. Defect Rule Engine Checks (ZDSU-R01 to ZDSU-R12)
  const defects: ZDSUDefect[] = []

  // Add any deep element defects discovered
  for (const dd of deepDefects) {
    defects.push(dd)
  }

  // ZDSU-R01: Sprinkler Clearance (< minSprinklerReq)
  if (maxRackHeight > 0 && sprinklerClearanceM < minSprinklerReq) {
    const isUSorDefault = !standardId || standardId === 'US'
    const standardNameShort = standardProfile ? standardProfile.name.split(' ')[0] : 'NFPA 13'
    const reqNote = isUSorDefault
      ? `NFPA 13 requires ≥ ${minSprinklerReq.toFixed(2)}m / 18"`
      : `${standardNameShort} requires ≥ ${minSprinklerReq.toFixed(2)}m`

    defects.push({
      code: 'ZDSU-R01',
      title: 'Insufficient Sprinkler Head Clearance',
      message: `Top of storage to ceiling clear height is ${sprinklerClearanceM.toFixed(2)}m (${reqNote}).`,
      severity: 'blocking',
      pillar: 'safety',
      standardRef: standardProfile?.citations.sprinkler ?? 'NFPA 13 §20.6 / FM Global 8-9',
      targetNodeId: topOffendingRackId,
      targetNodeName: topOffendingRackName,
      targetLevel: topOffendingRackLevel,
      targetLayer: topOffendingRackLevel ? `Level ${topOffendingRackLevel}` : undefined,
      floorName,
    })
  }

  // ZDSU-R02: Severe Aisle Width Restriction
  if (estimatedAisleWidthM !== undefined && estimatedAisleWidthM < requiredAisleWidthM - 0.2) {
    defects.push({
      code: 'ZDSU-R02',
      title: 'Severe Operating Aisle Restriction',
      message: `Estimated aisle width (${estimatedAisleWidthM.toFixed(2)}m) is below the minimum required turning clearance (${requiredAisleWidthM.toFixed(2)}m).`,
      severity: 'blocking',
      pillar: 'clearance',
      standardRef: standardProfile?.citations.aisles ?? 'ANSI B56.1 / OSHA 1910.176(a)',
      floorName,
    })
  }

  // ZDSU-R03: Critical Staging Buffer Deficit
  const criticalBufferDeficit = thresholds?.criticalStagingBufferDeficitM2 ?? 25.0
  const recommendedBuffer = thresholds?.stagingAreaPerDockM2 ?? 35.0
  if (dockCount > 0 && stagingAreaPerDockM2 !== null && stagingAreaPerDockM2 < criticalBufferDeficit) {
    defects.push({
      code: 'ZDSU-R03',
      title: 'Critical Staging Buffer Deficit',
      message: `Staging buffer area is ${stagingAreaPerDockM2.toFixed(1)} m²/dock door (WERC minimum is ${criticalBufferDeficit.toFixed(1)} m²/dock, recommended ≥ ${recommendedBuffer.toFixed(0)} m²).`,
      severity: 'blocking',
      pillar: 'staging',
      standardRef: standardProfile?.citations.staging ?? 'WERC Warehouse Benchmarks',
      floorName,
    })
  }

  // ZDSU-R04: Severe Floor Over-Congestion (>70% storage, >55% staging/picking)
  const severeCongestionLimit = role.startsWith('storage')
    ? (thresholds?.maxStorageUtilizationPct ?? 70)
    : (thresholds?.maxStagingUtilizationPct ?? 55)
  if (floorUtilizationPct > severeCongestionLimit) {
    defects.push({
      code: 'ZDSU-R04',
      title: 'Severe Floor Over-Congestion',
      message: `Floor utilization is ${floorUtilizationPct.toFixed(1)}%, exceeding the safety threshold (${severeCongestionLimit}%). Forklift maneuvering is compromised.`,
      severity: 'blocking',
      pillar: 'utilization',
      standardRef: standardProfile?.citations.floorUtilization ?? 'FEM 10.2.02 / Lean Logistics',
      floorName,
    })
  }

  // ZDSU-R05: Blocked Emergency Egress Corridor
  if (contentIds.length > 8 && areaM2 > 200 && !hasEmergencyRoute && routeCount === 0 && role.startsWith('storage')) {
    defects.push({
      code: 'ZDSU-R05',
      title: 'Unverified Emergency Egress Route',
      message: 'High-density storage zone lacks dedicated pedestrian escape path demarcation.',
      severity: 'advisory',
      pillar: 'safety',
      standardRef: standardProfile?.citations.emergencyEgress ?? 'OSHA 1910.36 / IBC Ch. 10',
      floorName,
    })
  }

  // ZDSU-R06: Narrow Flue Space Hazard
  if (selectivePallets > 0 && !flueSpaceCompliant) {
    const minFlueMm = Math.round(minFlueReq * 1000)
    defects.push({
      code: 'ZDSU-R06',
      title: 'Narrow Flue Space Fire Hazard',
      message: `Longitudinal flue space (${(minMeasuredFlueSpace * 1000).toFixed(0)}mm) is below ${standardProfile ? standardProfile.name.split(' ')[0] : 'NFPA 13'} minimum (${minFlueMm}mm).`,
      severity: 'warning',
      pillar: 'safety',
      standardRef: standardProfile?.citations.flueSpace ?? 'NFPA 13 §20.6.3',
      targetNodeId: flueOffendingRackId,
      targetNodeName: flueOffendingRackName,
      targetLayer: 'Flue Space',
      floorName,
    })
  }

  // ZDSU-R07: Moderate Floor Over-Utilization (>65% storage, >45% staging)
  if (floorUtilizationPct > optimalRange[1] && floorUtilizationPct <= severeCongestionLimit) {
    defects.push({
      code: 'ZDSU-R07',
      title: 'Floor Over-Utilization Warning',
      message: `Floor utilization is ${floorUtilizationPct.toFixed(1)}% (optimal range: ${optimalRange[0]}% - ${optimalRange[1]}%).`,
      severity: 'warning',
      pillar: 'utilization',
      standardRef: standardProfile?.citations.floorUtilization ?? 'WERC Guidelines',
      floorName,
    })
  }

  // ZDSU-R08: Missing Floor Route Demarcation
  if (contentIds.length >= 6 && routeCount === 0 && (role.startsWith('staging') || role.startsWith('storage'))) {
    defects.push({
      code: 'ZDSU-R08',
      title: 'Missing Floor Traffic Markings',
      message: 'Active operating zone has no marked MHE traffic or pedestrian route lines.',
      severity: 'warning',
      pillar: 'clearance',
      standardRef: standardProfile?.citations.aisles ?? 'OSHA 1910.176(a)',
      floorName,
    })
  }

  // ZDSU-R09: Low Selectivity for Fast-Pick Zone (<80%)
  if (role === 'picking' && totalPalletPositions > 0 && selectivityIndex < 80) {
    defects.push({
      code: 'ZDSU-R09',
      title: 'Low Selectivity in Forward Pick Zone',
      message: `Selectivity is ${selectivityIndex}% in picking zone (target ≥ 80% direct access).`,
      severity: 'warning',
      pillar: 'storage',
      standardRef: 'Order Fulfillment Standards',
      floorName,
    })
  }

  // ZDSU-R10: Marginal Dock Buffer Space (25 - 35 m²/dock)
  if (
    dockCount > 0 &&
    stagingAreaPerDockM2 !== null &&
    stagingAreaPerDockM2 >= criticalBufferDeficit &&
    stagingAreaPerDockM2 < recommendedBuffer
  ) {
    defects.push({
      code: 'ZDSU-R10',
      title: 'Marginal Dock Staging Buffer',
      message: `Staging buffer (${stagingAreaPerDockM2.toFixed(1)} m²/dock) is operational but below best practice benchmark (≥ ${recommendedBuffer.toFixed(0)} m²/dock).`,
      severity: 'warning',
      pillar: 'staging',
      standardRef: standardProfile?.citations.staging ?? 'WERC Guidelines',
      floorName,
    })
  }

  // ZDSU-R11: Floor Space Underutilization
  if (contentIds.length > 0 && floorUtilizationPct < optimalRange[0] && areaM2 > 50) {
    defects.push({
      code: 'ZDSU-R11',
      title: 'Floor Space Underutilization',
      message: `Floor utilization (${floorUtilizationPct.toFixed(1)}%) is below optimal density (${optimalRange[0]}% - ${optimalRange[1]}%).`,
      severity: 'advisory',
      pillar: 'utilization',
      standardRef: 'Lean Warehouse Engineering',
      floorName,
    })
  }

  // ZDSU-R12: Unbalanced MHE Truck Assignment
  if (
    maxRackHeight >= 6.0 &&
    mheClassesPresent.length > 0 &&
    !mheClassesPresent.includes('reach') &&
    !mheClassesPresent.includes('vna-turret')
  ) {
    defects.push({
      code: 'ZDSU-R12',
      title: 'High-Bay MHE Equipment Mismatch',
      message: `High-bay storage (${maxRackHeight.toFixed(1)}m height) is configured without designated Reach or VNA Turret trucks.`,
      severity: 'advisory',
      pillar: 'clearance',
      standardRef: 'Operations Research',
      floorName,
    })
  }

  // 7. Pillar 6: Readiness Score Calculation
  const blockingCount = defects.filter((d) => d.severity === 'blocking').length
  const warningCount = defects.filter((d) => d.severity === 'warning').length
  const advisoryCount = defects.filter((d) => d.severity === 'advisory').length

  let subSpatial = 100
  if (!isValidPolygon) subSpatial = 0
  else if (floorUtilizationPct > severeCongestionLimit) subSpatial -= 35
  else if (floorUtilizationPct > optimalRange[1]) subSpatial -= 15

  let subFireSafety = 100
  if (!sprinklerCompliant) subFireSafety -= 50
  if (!flueSpaceCompliant && selectivePallets > 0) subFireSafety -= 25

  let subUtilization = 100
  if (health === 'severe-congestion') subUtilization = 30
  else if (health === 'congested') subUtilization = 65
  else if (health === 'sparse') subUtilization = 75

  let subMhe = 100
  if (defects.some((d) => d.code === 'ZDSU-R02')) subMhe -= 50
  if (defects.some((d) => d.code === 'ZDSU-R12')) subMhe -= 20

  let subTraffic = 100
  if (defects.some((d) => d.code === 'ZDSU-R03')) subTraffic -= 45
  if (defects.some((d) => d.code === 'ZDSU-R08')) subTraffic -= 20
  if (defects.some((d) => d.code === 'ZDSU-R10')) subTraffic -= 15

  subSpatial = Math.max(0, Math.min(100, subSpatial))
  subFireSafety = Math.max(0, Math.min(100, subFireSafety))
  subUtilization = Math.max(0, Math.min(100, subUtilization))
  subMhe = Math.max(0, Math.min(100, subMhe))
  subTraffic = Math.max(0, Math.min(100, subTraffic))

  let rawScore =
    0.3 * subSpatial +
    0.25 * subFireSafety +
    0.2 * subUtilization +
    0.15 * subMhe +
    0.1 * subTraffic

  // Defect penalty deductions
  rawScore -= blockingCount * 30 + warningCount * 10 + advisoryCount * 3
  let score = Math.max(0, Math.min(100, Math.round(rawScore)))

  let status: ZDSUStatus = 'ready'
  if (blockingCount > 0) {
    status = 'blocked'
    score = Math.min(score, 60)
  } else if (warningCount > 0 || score < 85) {
    if (score < 65) {
      status = 'blocked'
    } else {
      status = 'warning'
      score = Math.min(score, 84)
    }
  } else {
    status = 'ready'
  }

  return {
    zoneId: zone.id,
    zoneName: zone.name || 'Unnamed Zone',
    floorName,
    levelId,
    standardId,
    role,
    geometry: {
      areaM2: Math.round(areaM2 * 100) / 100,
      perimeterM: Math.round(perimeterM * 100) / 100,
      clearHeightM: Math.round(clearHeightM * 100) / 100,
      volumeM3,
      vertexCount,
      isValidPolygon,
    },
    storage: {
      totalPalletPositions,
      directAccessPositions,
      selectivityIndex,
      pickingSlots,
      shelfAreaM2: Math.round(shelfAreaM2 * 100) / 100,
      palletDensityPerM2,
      storageBreakdown: {
        selective: selectivePallets,
        driveIn: driveInPallets,
        live: livePallets,
        floor: floorPallets,
      },
    },
    utilization: {
      equipmentFootprintM2,
      floorUtilizationPct,
      optimalRange,
      health,
    },
    clearance: {
      estimatedAisleWidthM,
      requiredAisleWidthM,
      mheClassesPresent,
      flueSpaceCompliant,
      sprinklerClearanceM,
      sprinklerCompliant,
    },
    staging: {
      dockCount,
      stagingAreaPerDockM2,
      trailerBufferCapacityPallets,
      trailerRatio,
    },
    readiness: {
      score,
      subScores: {
        spatial: subSpatial,
        fireSafety: subFireSafety,
        utilization: subUtilization,
        mheCompatibility: subMhe,
        trafficFlow: subTraffic,
      },
      status,
      blockingDefectsCount: blockingCount,
      warningDefectsCount: warningCount,
      advisoryDefectsCount: advisoryCount,
    },
    defects,
  }
}

// ── Facility Aggregate Report Engine ────────────────────────────────────────

export function calculateFacilityZDSUReport(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  zones: ZoneNode[],
  options: CalculateZoneZDSUAuditOptions = {},
): FacilityZDSUReport {
  const standardId = options.standardId ?? null

  if (zones.length === 0) {
    return {
      zonesAudited: 0,
      overallReadinessScore: 100,
      overallStatus: 'ready',
      totalZoneAreaM2: 0,
      totalPalletCapacity: 0,
      averageFloorUtilizationPct: 0,
      totalDefects: { blocking: 0, warning: 0, advisory: 0 },
      zoneAudits: [],
      standardId,
    }
  }

  const zoneAudits = zones.map((zone) => {
    const takeoff = calculateWarehouseZoneTakeoff({
      zone,
      contentIds: collectZoneContentIds(nodes, zone),
      nodes,
    })
    return calculateZoneZDSUAudit(zone, takeoff, nodes, options)
  })

  let totalZoneAreaM2 = 0
  let totalPalletCapacity = 0
  let weightedUtilizationSum = 0
  let weightedScoreSum = 0
  let totalBlocking = 0
  let totalWarning = 0
  let totalAdvisory = 0

  for (const audit of zoneAudits) {
    totalZoneAreaM2 += audit.geometry.areaM2
    totalPalletCapacity += audit.storage.totalPalletPositions
    weightedUtilizationSum += audit.utilization.floorUtilizationPct * (audit.geometry.areaM2 || 1)
    weightedScoreSum += audit.readiness.score * (audit.geometry.areaM2 || 1)
    totalBlocking += audit.readiness.blockingDefectsCount
    totalWarning += audit.readiness.warningDefectsCount
    totalAdvisory += audit.readiness.advisoryDefectsCount
  }

  const averageFloorUtilizationPct =
    totalZoneAreaM2 > 0 ? Math.round((weightedUtilizationSum / totalZoneAreaM2) * 10) / 10 : 0

  let overallReadinessScore =
    totalZoneAreaM2 > 0
      ? Math.round(weightedScoreSum / totalZoneAreaM2)
      : Math.round(zoneAudits.reduce((acc, a) => acc + a.readiness.score, 0) / zoneAudits.length)

  let overallStatus: ZDSUStatus = 'ready'
  if (totalBlocking > 0) {
    overallStatus = 'blocked'
    overallReadinessScore = Math.min(overallReadinessScore, 60)
  } else if (totalWarning > 0 || overallReadinessScore < 85) {
    if (overallReadinessScore < 65) {
      overallStatus = 'blocked'
    } else {
      overallStatus = 'warning'
      overallReadinessScore = Math.min(overallReadinessScore, 84)
    }
  } else {
    overallStatus = 'ready'
  }

  return {
    zonesAudited: zoneAudits.length,
    overallReadinessScore,
    overallStatus,
    totalZoneAreaM2: Math.round(totalZoneAreaM2 * 100) / 100,
    totalPalletCapacity,
    averageFloorUtilizationPct,
    totalDefects: {
      blocking: totalBlocking,
      warning: totalWarning,
      advisory: totalAdvisory,
    },
    zoneAudits,
    standardId,
  }
}

// ── Export Utilities ────────────────────────────────────────────────────────

export function exportZoneAuditJson(report: FacilityZDSUReport): string {
  return JSON.stringify(
    {
      documentType: 'DigitalTwin-ZeroDefectStartup-AuditReport',
      version: '1.0.0',
      standardId: report.standardId ?? null,
      timestamp: new Date().toISOString(),
      facilitySummary: {
        readinessScore: report.overallReadinessScore,
        status: report.overallStatus.toUpperCase(),
        zonesAudited: report.zonesAudited,
        totalZoneAreaM2: report.totalZoneAreaM2,
        totalPalletCapacity: report.totalPalletCapacity,
        averageFloorUtilizationPct: report.averageFloorUtilizationPct,
        defectCounts: report.totalDefects,
      },
      zones: report.zoneAudits.map((z) => ({
        id: z.zoneId,
        name: z.zoneName,
        floorName: z.floorName,
        levelId: z.levelId,
        standardId: z.standardId ?? null,
        role: z.role,
        readinessScore: z.readiness.score,
        status: z.readiness.status.toUpperCase(),
        areaM2: z.geometry.areaM2,
        palletPositions: z.storage.totalPalletPositions,
        selectivityPct: z.storage.selectivityIndex,
        floorUtilizationPct: z.utilization.floorUtilizationPct,
        utilizationHealth: z.utilization.health,
        sprinklerClearanceM: z.clearance.sprinklerClearanceM,
        dockCount: z.staging.dockCount,
        stagingAreaPerDockM2: z.staging.stagingAreaPerDockM2,
        defects: z.defects.map((d) => ({
          code: d.code,
          title: d.title,
          severity: d.severity,
          message: d.message,
          standardRef: d.standardRef,
          targetNodeId: d.targetNodeId,
          targetNodeName: d.targetNodeName,
          targetLevel: d.targetLevel,
          targetLayer: d.targetLayer,
          floorName: d.floorName,
        })),
      })),
    },
    null,
    2,
  )
}

export function exportZoneAuditMarkdown(report: FacilityZDSUReport): string {
  const standardName = report.standardId ? getStandardProfile(report.standardId).name : 'International NFPA/EN/OSHA'
  const lines: string[] = [
    '# Zero Defect Start-up (ZDSU) Facility Audit Certificate',
    '',
    `**Regulatory Framework**: ${standardName}  `,
    `**Generated**: ${new Date().toISOString()}  `,
    `**Facility Readiness Score**: ${report.overallReadinessScore}% [${report.overallStatus.toUpperCase()}]  `,
    `**Zones Audited**: ${report.zonesAudited}  `,
    `**Total Pallet Capacity**: ${report.totalPalletCapacity.toLocaleString()} positions  `,
    `**Total Zone Footprint**: ${report.totalZoneAreaM2.toLocaleString()} m²  `,
    `**Average Floor Space Utilization**: ${report.averageFloorUtilizationPct}%  `,
    `**Total Defects**: ${report.totalDefects.blocking} Blocking, ${report.totalDefects.warning} Warning, ${report.totalDefects.advisory} Advisory  `,
    '',
    '---',
    '',
    '## Zone Audit Breakdown',
    '',
  ]

  for (const z of report.zoneAudits) {
    lines.push(
      `### ${z.zoneName} [${z.floorName}] (${z.role}) — ${z.readiness.score}% [${z.readiness.status.toUpperCase()}]`,
    )
    lines.push(`- **Geometry**: ${z.geometry.areaM2} m² | Perimeter: ${z.geometry.perimeterM} m | Clear Height: ${z.geometry.clearHeightM} m`)
    lines.push(
      `- **Storage**: ${z.storage.totalPalletPositions.toLocaleString()} pallets (${z.storage.selectivityIndex}% direct access) | Pick Slots: ${z.storage.pickingSlots}`,
    )
    lines.push(
      `- **Utilization**: ${z.utilization.floorUtilizationPct}% [${z.utilization.health}] (Optimal: ${z.utilization.optimalRange[0]}-${z.utilization.optimalRange[1]}%)`,
    )
    if (z.staging.dockCount > 0) {
      lines.push(
        `- **Docks & Staging**: ${z.staging.dockCount} docks | ${z.staging.stagingAreaPerDockM2 ?? '–'} m²/dock`,
      )
    }
    lines.push(
      `- **Fire & Safety**: Sprinkler Clearance ${z.clearance.sprinklerClearanceM}m (${z.clearance.sprinklerCompliant ? 'Compliant' : 'VIOLATION'}) | Flue Space: ${z.clearance.flueSpaceCompliant ? 'Compliant' : 'Hazard'}`,
    )

    if (z.defects.length > 0) {
      lines.push('- **Active Defects & Advisories**:')
      for (const d of z.defects) {
        const layerBadge = d.targetLayer ? ` [${d.targetLayer}]` : ''
        lines.push(
          `  - \`[${d.severity.toUpperCase()}]\` **${d.code}**${layerBadge}: ${d.title} — ${d.message} *(Ref: ${d.standardRef || 'Industry Standard'})*`,
        )
      }
    } else {
      lines.push('- **Active Defects**: None (100% Start-up Compliant)')
    }
    lines.push('')
  }

  return lines.join('\n')
}
