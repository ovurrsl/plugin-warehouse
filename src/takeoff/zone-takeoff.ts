import type {
  AnyNode,
  AnyNodeId,
  ZoneNode,
  ZoneTakeoffBreakdownItem,
  ZoneTakeoffExtension,
  ZoneTakeoffMetric,
  ZoneTakeoffReport,
} from '@pascal-app/core'
import { BenchNode } from '../bench/schema'
import { ConveyorBoosterNode } from '../conveyor/booster-schema'
import { moduleLengthM as boosterModuleLengthM } from '../conveyor/booster-metrics'
import { ConveyorCurveNode } from '../conveyor/curve-schema'
import { centrelineLengthM as curveCentrelineLengthM } from '../conveyor/curve-metrics'
import { ConveyorLauncherNode } from '../conveyor/launcher-schema'
import { moduleLengthM as launcherModuleLengthM } from '../conveyor/launcher-metrics'
import { ConveyorObliqueNode } from '../conveyor/oblique-schema'
import { moduleLengthM as obliqueModuleLengthM } from '../conveyor/oblique-metrics'
import { ConveyorRollerNode } from '../conveyor/schema'
import { moduleLengthM as rollerModuleLengthM } from '../conveyor/metrics'
import { ConveyorSpiralNode } from '../conveyor/spiral-schema'
import { helixArcLengthM as spiralHelixArcLengthM } from '../conveyor/spiral-metrics'
import { ConveyorTelescopicNode } from '../conveyor/telescopic-schema'
import { currentLengthM as telescopicCurrentLengthM } from '../conveyor/telescopic-metrics'
import { ConveyorTransferNode } from '../conveyor/transfer-schema'
import { moduleLengthM as transferModuleLengthM } from '../conveyor/transfer-metrics'
import { DockLevellerNode } from '../dockleveller/schema'
import { DriveInRackNode } from '../drivein/schema'
import {
  directAccessSlotCount as driveInDirectAccessSlotCount,
  palletSlotCount as driveInPalletSlotCount,
  storageLevels as driveInStorageLevels,
} from '../drivein/lanes'
import { LiveRackingNode } from '../live-racking/schema'
import { palletPositions as liveRackingPalletPositions } from '../live-racking/metrics'
import { LongspanNode } from '../longspan/schema'
import {
  fittedLevels as longspanFittedLevels,
  hangingLengthM as longspanHangingLengthM,
  shelfAreaM2 as longspanShelfAreaM2,
} from '../longspan/levels'
import { M3ShelvingNode } from '../m3/schema'
import {
  bayLoadKg as m3BayLoadKg,
  drawerCount as m3DrawerCount,
  fittedLevels as m3FittedLevels,
  shelfAreaM2 as m3ShelfAreaM2,
} from '../m3/bays'
import { MezzanineNode } from '../mezzanine/schema'
import { outlinePolygon as mezzanineOutlinePolygon } from '../mezzanine/metrics'
import { PalletNode } from '../pallet/schema'
import { PalletLiftNode } from '../palletlift/schema'
import { KIND_PREFIX, PLUGIN_ID } from '../plugin-id'
import { PalletRackNode } from '../rack/schema'
import {
  directAccessSlotCount as rackDirectAccessSlotCount,
  palletSlotCount as rackPalletSlotCount,
  pickingSlotsOf as rackPickingSlotsOf,
  storageLevelsPresent as rackStorageLevelsPresent,
} from '../rack/slots'
import { RouteNode } from '../route/schema'
import { ToteCartNode } from '../totecart/schema'
import { TruckNode } from '../truck/schema'

/**
 * Computes polygon area using the Shoelace formula on 2D polygon vertices.
 */
function polygonArea(points: readonly (readonly [number, number])[]): number {
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
 * Computes the total path length across consecutive polyline vertices.
 */
function polylineLength(points: readonly (readonly [number, number])[]): number {
  if (points.length < 2) return 0
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]
    if (p1 && p2) {
      total += Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    }
  }
  return total
}

function parseWarehouseNode<T>(
  schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } },
  rawNode: unknown,
  prefix: string,
): T | null {
  const parsed = schema.safeParse(rawNode)
  if (parsed.success) return parsed.data
  if (typeof rawNode === 'object' && rawNode !== null) {
    const retry = schema.safeParse({ ...(rawNode as object), id: `${prefix}_fallback` })
    if (retry.success) return retry.data
  }
  return null
}

export type WarehouseZoneTakeoffInput = {
  zone: ZoneNode
  contentIds: AnyNodeId[]
  nodes: Readonly<Record<AnyNodeId, AnyNode>>
}

/**
 * Pure warehouse domain takeoff statistics calculator.
 *
 * Evaluates all warehouse objects standing in the specified zone, computing
 * comprehensive storage capacity, equipment metrics, and category breakdowns.
 */
export function calculateWarehouseZoneTakeoff({
  zone,
  contentIds,
  nodes,
}: WarehouseZoneTakeoffInput): ZoneTakeoffReport | null {
  if (!contentIds || contentIds.length === 0) return null

  // Selective Pallet Racks
  let palletRackBays = 0
  let palletRackLevels = 0
  let palletRackPalletSlots = 0
  let palletRackDirectAccess = 0
  let palletRackPickingSlots = 0

  // Drive-In Racks
  let driveInLanes = 0
  let driveInLevels = 0
  let driveInPalletSlots = 0
  let driveInDirectAccess = 0

  // Live Racking (Dynamic Flow)
  let liveRackChannels = 0
  let liveRackLevels = 0
  let liveRackPalletSlots = 0
  let liveRackDirectAccess = 0

  // Longspan Shelving (M7)
  let longspanBays = 0
  let longspanLevels = 0
  let longspanShelfArea = 0
  let longspanHangingLength = 0

  // M3 Shelving
  let m3Bays = 0
  let m3Levels = 0
  let m3ShelfArea = 0
  let m3Drawers = 0
  let m3LoadKg = 0

  // Floor Pallets
  let floorPalletsCount = 0
  let rackedPalletsCount = 0

  // Mezzanines
  let mezzanineCount = 0
  let mezzanineTiers = 0
  let mezzanineDeckArea = 0

  // Conveyors
  let conveyorCount = 0
  let conveyorLength = 0

  // Facilities & Handling
  let benchCount = 0
  let dockLevellerCount = 0
  let palletLiftCount = 0
  let truckCount = 0
  let toteCartCount = 0
  let toteCartCapacity = 0
  let routeCount = 0
  let routeLength = 0

  let warehouseObjectsFound = 0

  for (const id of contentIds) {
    const rawNode = nodes[id]
    const rawType = typeof (rawNode as { type?: unknown })?.type === 'string'
      ? (rawNode as { type: string }).type
      : undefined

    if (!rawNode || !rawType || !rawType.startsWith(KIND_PREFIX)) {
      continue
    }

    warehouseObjectsFound++

    switch (rawType) {
      case 'warehouse:pallet-rack': {
        const rack = parseWarehouseNode(PalletRackNode, rawNode, 'pallet-rack')
        if (rack) {
          palletRackBays += 1
          palletRackLevels += rackStorageLevelsPresent(rack).length
          palletRackPalletSlots += rackPalletSlotCount(rack)
          palletRackDirectAccess += rackDirectAccessSlotCount(rack)
          palletRackPickingSlots += rackPickingSlotsOf(rack).length
        }
        break
      }

      case 'warehouse:drive-in-rack': {
        const lane = parseWarehouseNode(DriveInRackNode, rawNode, 'drive-in-rack')
        if (lane) {
          driveInLanes += 1
          driveInLevels += driveInStorageLevels(lane).length
          driveInPalletSlots += driveInPalletSlotCount(lane)
          driveInDirectAccess += driveInDirectAccessSlotCount(lane)
        }
        break
      }

      case 'warehouse:live-rack': {
        const live = parseWarehouseNode(LiveRackingNode, rawNode, 'live-racking')
        if (live) {
          liveRackChannels += 1
          liveRackLevels += live.levels
          liveRackPalletSlots += liveRackingPalletPositions(live)
          liveRackDirectAccess += live.levels
        }
        break
      }

      case 'warehouse:longspan-rack': {
        const bay = parseWarehouseNode(LongspanNode, rawNode, 'longspan')
        if (bay) {
          longspanBays += 1
          longspanLevels += longspanFittedLevels(bay).length
          longspanShelfArea += longspanShelfAreaM2(bay)
          longspanHangingLength += longspanHangingLengthM(bay)
        }
        break
      }

      case 'warehouse:m3-rack': {
        const bay = parseWarehouseNode(M3ShelvingNode, rawNode, 'm3')
        if (bay) {
          const fitted = m3FittedLevels(bay)
          m3Bays += 1
          m3Levels += fitted.length
          m3ShelfArea += m3ShelfAreaM2(bay)
          m3LoadKg += m3BayLoadKg(bay)
          for (const level of fitted) {
            if (level.structure === 'drawers') {
              m3Drawers += m3DrawerCount(bay, level)
            }
          }
        }
        break
      }

      case 'warehouse:pallet': {
        const pallet = parseWarehouseNode(PalletNode, rawNode, 'pallet')
        if (pallet) {
          if (pallet.slotRackId && pallet.slotAddress) {
            rackedPalletsCount += 1
          } else {
            floorPalletsCount += 1
          }
        }
        break
      }

      case 'warehouse:mezzanine': {
        const mezz = parseWarehouseNode(MezzanineNode, rawNode, 'mezzanine')
        if (mezz) {
          mezzanineCount += 1
          const tiersCount = mezz.tiers.length
          mezzanineTiers += tiersCount
          const footprint = polygonArea(mezzanineOutlinePolygon(mezz))
          mezzanineDeckArea += footprint * tiersCount
        }
        break
      }

      case 'warehouse:conveyor-roller': {
        const conveyor = parseWarehouseNode(ConveyorRollerNode, rawNode, 'conveyor-roller')
        if (conveyor) {
          conveyorCount += 1
          conveyorLength += rollerModuleLengthM(conveyor)
        }
        break
      }

      case 'warehouse:conveyor-curve': {
        const conveyor = parseWarehouseNode(ConveyorCurveNode, rawNode, 'conveyor-curve')
        if (conveyor) {
          conveyorCount += 1
          conveyorLength += curveCentrelineLengthM(conveyor)
        }
        break
      }

      case 'warehouse:conveyor-booster': {
        const conveyor = parseWarehouseNode(ConveyorBoosterNode, rawNode, 'conveyor-booster')
        if (conveyor) {
          conveyorCount += 1
          conveyorLength += boosterModuleLengthM(conveyor)
        }
        break
      }

      case 'warehouse:conveyor-launcher': {
        const conveyor = parseWarehouseNode(ConveyorLauncherNode, rawNode, 'conveyor-launcher')
        if (conveyor) {
          conveyorCount += 1
          conveyorLength += launcherModuleLengthM(conveyor)
        }
        break
      }

      case 'warehouse:conveyor-oblique': {
        const conveyor = parseWarehouseNode(ConveyorObliqueNode, rawNode, 'conveyor-oblique')
        if (conveyor) {
          conveyorCount += 1
          conveyorLength += obliqueModuleLengthM(conveyor)
        }
        break
      }

      case 'warehouse:conveyor-spiral': {
        const conveyor = parseWarehouseNode(ConveyorSpiralNode, rawNode, 'conveyor-spiral')
        if (conveyor) {
          conveyorCount += 1
          conveyorLength += spiralHelixArcLengthM(conveyor)
        }
        break
      }

      case 'warehouse:conveyor-telescopic': {
        const conveyor = parseWarehouseNode(ConveyorTelescopicNode, rawNode, 'conveyor-telescopic')
        if (conveyor) {
          conveyorCount += 1
          conveyorLength += telescopicCurrentLengthM(conveyor)
        }
        break
      }

      case 'warehouse:conveyor-transfer': {
        const conveyor = parseWarehouseNode(ConveyorTransferNode, rawNode, 'conveyor-transfer')
        if (conveyor) {
          conveyorCount += 1
          conveyorLength += transferModuleLengthM(conveyor)
        }
        break
      }

      case 'warehouse:bench': {
        if (parseWarehouseNode(BenchNode, rawNode, 'bench')) {
          benchCount += 1
        }
        break
      }

      case 'warehouse:dock-leveller': {
        if (parseWarehouseNode(DockLevellerNode, rawNode, 'dockleveller')) {
          dockLevellerCount += 1
        }
        break
      }

      case 'warehouse:pallet-lift': {
        if (parseWarehouseNode(PalletLiftNode, rawNode, 'pallet-lift')) {
          palletLiftCount += 1
        }
        break
      }

      case 'warehouse:truck': {
        if (parseWarehouseNode(TruckNode, rawNode, 'truck')) {
          truckCount += 1
        }
        break
      }

      case 'warehouse:tote-cart': {
        const cart = parseWarehouseNode(ToteCartNode, rawNode, 'totecart')
        if (cart) {
          toteCartCount += 1
          toteCartCapacity += cart.tiers
        }
        break
      }

      case 'warehouse:route': {
        const route = parseWarehouseNode(RouteNode, rawNode, 'route')
        if (route) {
          routeCount += 1
          routeLength += polylineLength(route.points)
        }
        break
      }
    }
  }

  if (warehouseObjectsFound === 0) {
    return null
  }

  const totalStorageBays =
    palletRackBays + driveInLanes + liveRackChannels + longspanBays + m3Bays

  const totalStorageLevels =
    palletRackLevels + driveInLevels + liveRackLevels + longspanLevels + m3Levels

  const totalPalletCapacity =
    palletRackPalletSlots + driveInPalletSlots + liveRackPalletSlots + floorPalletsCount

  const totalDirectAccess =
    palletRackDirectAccess + driveInDirectAccess + liveRackDirectAccess + floorPalletsCount

  const totalPickingCapacity =
    palletRackPickingSlots + m3Drawers + toteCartCapacity

  const metrics: ZoneTakeoffMetric[] = [
    {
      key: 'total-bays',
      label: 'Storage Bays',
      value: totalStorageBays,
      abbreviation: 'Bays',
      sublabel: totalStorageBays === 1 ? '1 storage bay' : `${totalStorageBays} storage bays`,
    },
    {
      key: 'total-levels',
      label: 'Storage Levels',
      value: totalStorageLevels,
      abbreviation: 'Lvls',
      sublabel: 'Beams & shelves',
    },
    {
      key: 'pallet-capacity',
      label: 'Pallet Capacity',
      value: totalPalletCapacity,
      abbreviation: 'Pallets',
      sublabel:
        totalDirectAccess > 0
          ? `${totalDirectAccess.toLocaleString()} direct access`
          : 'Pallet positions',
    },
    {
      key: 'picking-capacity',
      label: 'Carton / Picking',
      value: totalPickingCapacity,
      abbreviation: 'Pick',
      sublabel: 'Carton & tote slots',
    },
  ]

  const breakdown: ZoneTakeoffBreakdownItem[] = []

  if (palletRackBays > 0) {
    breakdown.push({
      id: 'selective-pallet-rack',
      label: 'Selective Pallet Rack',
      count: palletRackBays,
      details: `${palletRackLevels} beam levels · ${palletRackPalletSlots.toLocaleString()} pallet positions`,
      submetrics: [
        { label: 'Direct Access', value: palletRackDirectAccess },
        { label: 'Picking Slots', value: palletRackPickingSlots },
      ],
    })
  }

  if (driveInLanes > 0) {
    breakdown.push({
      id: 'drive-in-rack',
      label: 'Drive-In Rack',
      count: driveInLanes,
      details: `${driveInLevels} levels · ${driveInPalletSlots.toLocaleString()} pallet positions`,
      submetrics: [{ label: 'Direct Access', value: driveInDirectAccess }],
    })
  }

  if (liveRackChannels > 0) {
    breakdown.push({
      id: 'live-rack',
      label: 'Live Dynamic Racking',
      count: liveRackChannels,
      details: `${liveRackLevels} levels · ${liveRackPalletSlots.toLocaleString()} pallet positions (gravity flow)`,
      submetrics: [{ label: 'Direct Access', value: liveRackDirectAccess }],
    })
  }

  if (longspanBays > 0) {
    const submetrics: Array<{ label: string; value: string | number }> = []
    if (longspanHangingLength > 0) {
      submetrics.push({ label: 'Hanging Rail', value: `${longspanHangingLength.toFixed(1)} m` })
    }
    breakdown.push({
      id: 'longspan-shelving',
      label: 'Longspan M7 Shelving',
      count: longspanBays,
      details: `${longspanLevels} shelf levels · ${longspanShelfArea.toFixed(1)} m² shelf area`,
      submetrics: submetrics.length > 0 ? submetrics : undefined,
    })
  }

  if (m3Bays > 0) {
    const submetrics: Array<{ label: string; value: string | number }> = [
      { label: 'Rated Load', value: `${m3LoadKg.toLocaleString()} kg` },
    ]
    if (m3Drawers > 0) {
      submetrics.unshift({ label: 'Drawers', value: m3Drawers })
    }
    breakdown.push({
      id: 'm3-shelving',
      label: 'M3 Picking Shelving',
      count: m3Bays,
      details: `${m3Levels} shelf levels · ${m3ShelfArea.toFixed(1)} m² shelf area`,
      submetrics,
    })
  }

  if (floorPalletsCount > 0 || rackedPalletsCount > 0) {
    breakdown.push({
      id: 'floor-pallets',
      label: 'Floor Pallet Staging',
      count: floorPalletsCount + rackedPalletsCount,
      details:
        floorPalletsCount > 0 && rackedPalletsCount > 0
          ? `${floorPalletsCount} floor-staged · ${rackedPalletsCount} stored in racks`
          : floorPalletsCount > 0
            ? `${floorPalletsCount} unit loads staged directly on floor`
            : `${rackedPalletsCount} unit loads stored in rack slots`,
    })
  }

  if (mezzanineCount > 0) {
    breakdown.push({
      id: 'mezzanine-platforms',
      label: 'Mezzanine Raised Platforms',
      count: mezzanineCount,
      details: `${mezzanineTiers} tiers · ${mezzanineDeckArea.toFixed(1)} m² total deck area`,
      submetrics: [
        { label: 'Deck Area', value: `${mezzanineDeckArea.toFixed(1)} m²` },
        { label: 'Tiers', value: mezzanineTiers },
      ],
    })
  }

  if (conveyorCount > 0) {
    breakdown.push({
      id: 'conveyor-network',
      label: 'Conveyor Network',
      count: conveyorCount,
      details: `${conveyorLength.toFixed(1)} m total conveyor line length`,
      submetrics: [{ label: 'Total Length', value: `${conveyorLength.toFixed(1)} m` }],
    })
  }

  if (benchCount > 0) {
    breakdown.push({
      id: 'work-benches',
      label: 'Packing & Work Benches',
      count: benchCount,
      details: 'Assembly, packing and shipping workstations',
    })
  }

  if (palletLiftCount > 0) {
    breakdown.push({
      id: 'pallet-lifts',
      label: 'Pallet Lifts (VRC)',
      count: palletLiftCount,
      details: 'Vertical reciprocating conveyors between levels',
    })
  }

  if (dockLevellerCount > 0) {
    breakdown.push({
      id: 'dock-levellers',
      label: 'Dock Levellers',
      count: dockLevellerCount,
      details: 'Loading bay vehicle bridge levellers',
    })
  }

  if (truckCount > 0 || toteCartCount > 0) {
    const parts: string[] = []
    if (truckCount > 0) {
      parts.push(`${truckCount} forklift/truck${truckCount === 1 ? '' : 's'}`)
    }
    if (toteCartCount > 0) {
      parts.push(`${toteCartCount} picking cart${toteCartCount === 1 ? '' : 's'}`)
    }
    const submetrics: Array<{ label: string; value: string | number }> = []
    if (toteCartCapacity > 0) {
      submetrics.push({ label: 'Cart Tote Capacity', value: toteCartCapacity })
    }
    breakdown.push({
      id: 'handling-equipment',
      label: 'Handling Equipment & Carts',
      count: truckCount + toteCartCount,
      details: parts.join(' · '),
      submetrics: submetrics.length > 0 ? submetrics : undefined,
    })
  }

  if (routeCount > 0) {
    breakdown.push({
      id: 'marked-routes',
      label: 'Aisle Markings & Routes',
      count: routeCount,
      details: `${routeLength.toFixed(1)} m total marked traffic lines`,
      submetrics: [{ label: 'Total Length', value: `${routeLength.toFixed(1)} m` }],
    })
  }

  return {
    id: `${zone.id}:warehouse-takeoff`,
    title: 'Warehouse storage takeoff',
    icon: { kind: 'iconify', name: 'lucide:warehouse' },
    metrics,
    breakdown: breakdown.length > 0 ? breakdown : undefined,
  }
}

/**
 * Domain takeoff extension for warehouse and logistics equipment.
 */
export const warehouseZoneTakeoffExtension: ZoneTakeoffExtension = {
  id: 'pascal:warehouse:zone-takeoff',
  pluginId: PLUGIN_ID,
  supportsZone({ contentIds, nodes }) {
    if (!contentIds || contentIds.length === 0) return false
    return contentIds.some((id) => {
      const node = nodes[id]
      const type = (node as { type?: unknown })?.type
      return typeof type === 'string' && type.startsWith(KIND_PREFIX)
    })
  },
  deriveTakeoff({ zone, contentIds, nodes }) {
    return calculateWarehouseZoneTakeoff({ zone, contentIds, nodes })
  },
}
