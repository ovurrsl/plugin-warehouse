import type { AnyNode } from '@pascal-app/core'
import { BenchNode } from '../bench/schema'
import { moduleLengthM as boosterModuleLengthM } from '../conveyor/booster-metrics'
import { ConveyorBoosterNode } from '../conveyor/booster-schema'
import { centrelineLengthM as curveCentrelineLengthM } from '../conveyor/curve-metrics'
import { ConveyorCurveNode } from '../conveyor/curve-schema'
import { moduleLengthM as launcherModuleLengthM } from '../conveyor/launcher-metrics'
import { ConveyorLauncherNode } from '../conveyor/launcher-schema'
import {
  frameWidthM as rollerFrameWidthM,
  moduleLengthM as rollerModuleLengthM,
} from '../conveyor/metrics'
import { moduleLengthM as obliqueModuleLengthM } from '../conveyor/oblique-metrics'
import { ConveyorObliqueNode } from '../conveyor/oblique-schema'
import { ConveyorRollerNode } from '../conveyor/schema'
import { helixArcLengthM as spiralHelixArcLengthM } from '../conveyor/spiral-metrics'
import { ConveyorSpiralNode } from '../conveyor/spiral-schema'
import { currentLengthM as telescopicCurrentLengthM } from '../conveyor/telescopic-metrics'
import { ConveyorTelescopicNode } from '../conveyor/telescopic-schema'
import { moduleLengthM as transferModuleLengthM } from '../conveyor/transfer-metrics'
import { ConveyorTransferNode } from '../conveyor/transfer-schema'
import { DockLevellerNode } from '../dockleveller/schema'
import {
  fittedLevelCount as driveInFittedLevelCount,
  palletSlotCount as driveInPalletSlotCount,
  postCentersZ as driveInPostCentersZ,
  storageLevels as driveInStorageLevels,
  totalDepth as driveInTotalDepth,
} from '../drivein/lanes'
import { hasRightNeighbour as hasDriveInRightNeighbour } from '../drivein/neighbours'
import { DriveInRackNode } from '../drivein/schema'
import {
  bayWidthM as liveBayWidthM,
  channelDepthM as liveChannelDepthM,
  frameHeightM as liveFrameHeightM,
  hasBrakeRollers as liveHasBrakeRollers,
  palletPositions as liveRackingPalletPositions,
  rollerLengthM as liveRollerLengthM,
} from '../live-racking/metrics'
import { hasRightNeighbour as hasLiveRackRightNeighbour } from '../live-racking/neighbours'
import { brakeRollerIndices, rollerGridCount } from '../live-racking/parts'
import { LiveRackingNode } from '../live-racking/schema'
import {
  fittedLevels as longspanFittedLevels,
  levelNeedsZtam as longspanLevelNeedsZtam,
  uprightSection as longspanUprightSection,
} from '../longspan/levels'
import { hasRightNeighbour as hasLongspanRightNeighbour } from '../longspan/neighbours'
import { LongspanNode } from '../longspan/schema'
import {
  UPRIGHT_SECTION as M3_UPRIGHT_SECTION,
  crossTieCount as m3CrossTieCount,
  dividerDepth as m3DividerDepth,
  drawerCount as m3DrawerCount,
  fittedLevels as m3FittedLevels,
} from '../m3/bays'
import { hasRightNeighbour as hasM3RightNeighbour } from '../m3/neighbours'
import { M3ShelvingNode } from '../m3/schema'
import {
  outlinePolygon as mezzanineOutlinePolygon,
  footprintDepthM as mezzFootprintDepthM,
  footprintWidthM as mezzFootprintWidthM,
  gridColumnPositions as mezzGridColumnPositions,
  resolveColumnProfile as mezzResolveColumnProfile,
  resolveMainBeamProfile as mezzResolveMainBeamProfile,
  resolveSecondaryBeamProfile as mezzResolveSecondaryBeamProfile,
} from '../mezzanine/metrics'
import { outlineEdges as mezzOutlineEdges } from '../mezzanine/railing'
import { MezzanineNode } from '../mezzanine/schema'
import { PalletNode } from '../pallet/schema'
import { PalletLiftNode } from '../palletlift/schema'
import { KIND_PREFIX } from '../plugin-id'
import { hasRightNeighbour as hasPalletRackRightNeighbour } from '../rack/neighbours'
import { PalletRackNode } from '../rack/schema'
import {
  beamedLevels as rackBeamedLevels,
  deckFinishOf as rackDeckFinishOf,
  levelBeamHeight as rackLevelBeamHeight,
  palletSlotCount as rackPalletSlotCount,
  storageLevelsPresent as rackStorageLevelsPresent,
} from '../rack/slots'

import { RouteNode } from '../route/schema'
import { ToteCartNode } from '../totecart/schema'
import { TruckNode } from '../truck/schema'
import type {
  BomCalculateOptions,
  WarehouseBOM,
  WarehouseBomItem,
  WarehouseBomKpi,
  WarehouseBomSection,
} from './types'

/**
 * Shoelace formula for polygon area.
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
 * Total length of polyline points.
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

function parseWarehouseNode<T extends { id: string }>(
  schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } },
  rawNode: unknown,
  prefix: string,
): T | null {
  const parsed = schema.safeParse(rawNode)
  if (parsed.success) return parsed.data
  if (typeof rawNode === 'object' && rawNode !== null) {
    const rawObj = rawNode as Record<string, unknown>
    const normalized: Record<string, unknown> = { ...rawObj, id: `${prefix}_fallback` }

    if (prefix === 'm3' && typeof rawObj.levels === 'number') {
      const count = rawObj.levels
      normalized.levels = Array.from({ length: count }, (_, i) => ({
        elevation: 0.1 + i * 0.4,
        structure: 'shelf',
        model: 'HM',
        dividers: typeof rawObj.dividers === 'number' ? rawObj.dividers : 0,
      }))
    }

    if (prefix === 'conveyor-roller') {
      normalized.type = 'warehouse:conveyor-roller'
      if (!normalized.usefulWidth) normalized.usefulWidth = '600'
      if (!normalized.rollers) normalized.rollers = 80
      if (!normalized.rollerPitch) normalized.rollerPitch = '75'
    }

    if (prefix === 'live-racking' || prefix === 'live-rack') {
      normalized.type = 'warehouse:live-rack'
      if (!normalized.palletWidthM) normalized.palletWidthM = 0.8
      if (!normalized.palletLengthM) normalized.palletLengthM = 1.2
      if (!normalized.palletsDeep) normalized.palletsDeep = 5
      if (normalized.withRetainers === undefined) normalized.withRetainers = true
    }

    if (prefix === 'dockleveller' || prefix === 'dock-leveller') {
      normalized.type = 'warehouse:dock-leveller'
      if (!normalized.length) normalized.length = '2500'
      if (!normalized.width) normalized.width = '2000'
      if (!normalized.capacity) normalized.capacity = '60'
    }

    if (prefix === 'mezzanine') {
      if (typeof rawObj.width === 'number' && typeof rawObj.depth === 'number') {
        const w = rawObj.width
        const d = rawObj.depth
        normalized.grid = {
          baysX: Math.max(1, Math.round(w / 5)),
          baysY: Math.max(1, Math.round(d / 5)),
          bayWidthM: 5,
          bayDepthM: 5,
        }
      }
      if (!Array.isArray(normalized.tiers) || normalized.tiers.length === 0) {
        normalized.tiers = [
          {
            index: 0,
            elevationM: 'auto',
            clearHeightM: 3,
            loadClass: 500,
            floorType: 'WOOD_CHIPBOARD_30',
            accessories: { staircases: [], swingGates: [], upAndOverGates: [], safetyZones: [] },
          },
        ]
      }
    }

    const retry = schema.safeParse(normalized)
    if (retry.success) {
      return {
        ...retry.data,
        id: typeof rawObj.id === 'string' ? rawObj.id : retry.data.id,
      }
    }
  }
  return null
}

/**
 * Item aggregator helper that consolidates duplicate BOM items by unique role/item/spec/unit.
 */
class SectionCollector {
  private itemsMap = new Map<string, WarehouseBomItem>()

  constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly icon?: string,
  ) {}

  addItem(item: Omit<WarehouseBomItem, 'id'> & { id?: string }): void {
    if (item.quantity <= 0) return
    const key = `${item.role}|${item.item}|${item.specification}|${item.unit}`
    const existing = this.itemsMap.get(key)
    if (existing) {
      existing.quantity += item.quantity
    } else {
      const id = item.id ?? `${this.id}-${this.itemsMap.size + 1}`
      this.itemsMap.set(key, { ...item, id })
    }
  }

  toSection(): WarehouseBomSection | null {
    const items = Array.from(this.itemsMap.values())
    if (items.length === 0) return null
    return {
      id: this.id,
      title: this.title,
      icon: this.icon,
      itemCount: items.length,
      items,
    }
  }
}

/**
 * Pure calculation engine for the Warehouse Bill of Materials (BOM).
 *
 * Evaluates all warehouse equipment nodes (or a filtered subset), tallying exact
 * physical mechanical components, frame sharing, posts, beams, shelves, fasteners,
 * accessories, and facilities.
 */
export function calculateWarehouseBOM(
  nodes: Readonly<Record<string, AnyNode>>,
  options: BomCalculateOptions = {},
): WarehouseBOM {
  const targetIds =
    options.filterNodeIds && options.filterNodeIds.length > 0
      ? options.filterNodeIds
      : Object.keys(nodes)

  // Section Collectors
  const palletRackSec = new SectionCollector(
    'selective-pallet-racks',
    'Selective Pallet Racks',
    'lucide:grid',
  )
  const driveInSec = new SectionCollector(
    'drive-in-racks',
    'Drive-In Racks',
    'lucide:align-justify',
  )
  const liveRackSec = new SectionCollector(
    'live-racking',
    'Live Dynamic Racking (Pallet Flow)',
    'lucide:fast-forward',
  )
  const longspanSec = new SectionCollector(
    'longspan-shelving',
    'Longspan M7 Shelving',
    'lucide:layers',
  )
  const m3Sec = new SectionCollector('m3-shelving', 'M3 Picking Shelving', 'lucide:box')
  const mezzanineSec = new SectionCollector(
    'mezzanine-structures',
    'Mezzanines & Raised Platforms',
    'lucide:building',
  )
  const conveyorSec = new SectionCollector(
    'conveyors',
    'Conveyor Systems & Material Flow',
    'lucide:repeat',
  )
  const facilitiesSec = new SectionCollector(
    'facilities',
    'Workstations, Lifts & Dock Equipment',
    'lucide:wrench',
  )
  const handlingSec = new SectionCollector(
    'handling-fleet',
    'Handling Equipment, Carts & Floor Markings',
    'lucide:truck',
  )
  const fastenersSec = new SectionCollector(
    'fasteners-accessories',
    'Fasteners, Anchors & Safety Accessories',
    'lucide:shield-check',
  )

  // Global KPI Counters
  let totalBays = 0
  let totalLevels = 0
  let totalPalletPositions = 0
  let totalBeams = 0
  let totalUprightPosts = 0
  let totalShelfPanels = 0
  let totalFloorArea = 0

  for (const id of targetIds) {
    const rawNode = nodes[id]
    const rawType =
      typeof (rawNode as { type?: unknown })?.type === 'string'
        ? (rawNode as { type: string }).type
        : undefined

    if (!rawNode || !rawType?.startsWith(KIND_PREFIX)) {
      continue
    }

    switch (rawType) {
      case 'warehouse:pallet-rack': {
        const rack = parseWarehouseNode(PalletRackNode, rawNode, 'pallet-rack')
        if (!rack) break

        totalBays += 1
        const presentLevels = rackStorageLevelsPresent(rack)
        totalLevels += presentLevels.length
        totalPalletPositions += rackPalletSlotCount(rack)

        // Continuous run frame sharing:
        // If abutting another bay on the right, leave right frame line to neighbor -> 1 frame line.
        // If standalone or run end -> 2 frame lines.
        const rawRack = rawNode as Record<string, unknown>
        const hasRight =
          rawRack.hasRightNeighbour === true || hasPalletRackRightNeighbour(nodes, rack.id)
        const frameLines = hasRight ? 1 : 2
        const depthPositions = rack.depthPositions
        const postsCount = frameLines * 2 * depthPositions
        totalUprightPosts += postsCount

        // Upright Posts
        palletRackSec.addItem({
          role: 'upright-post',
          system: 'Selective Pallet Rack',
          item: 'Upright Post (Perforated)',
          specification: `${Math.round(rack.uprightWidth * 1000)}×${Math.round(rack.uprightDepth * 1000)} mm (H=${rack.uprightHeight.toFixed(2)} m)`,
          quantity: postsCount,
          unit: 'pcs',
          notes: hasRight ? 'Shared intermediate frame line' : 'Independent / terminal frame line',
        })

        // Footplates & Anchor Bolts
        palletRackSec.addItem({
          role: 'footplate',
          system: 'Selective Pallet Rack',
          item: 'Base Footplate (Heavy Gauge)',
          specification: `${Math.round(rack.uprightWidth * 1400)}×${Math.round(rack.uprightDepth * 1500)} mm (t=20 mm)`,
          quantity: postsCount,
          unit: 'pcs',
        })

        fastenersSec.addItem({
          role: 'anchor-bolt',
          system: 'Selective Pallet Rack',
          item: 'Floor Anchor Bolt (M12 Expansion)',
          specification: 'M12×100 mm heavy-duty concrete anchor',
          quantity: postsCount * 2,
          unit: 'pcs',
        })

        // Frame Bracing
        if (rack.bracing !== 'open') {
          const horizTies = 2 * frameLines * depthPositions
          const diagonalPanels = Math.max(3, Math.round((rack.uprightHeight - 0.25) / 0.9))
          const diagBraces =
            diagonalPanels * (rack.bracing === 'x-bracing' ? 2 : 1) * frameLines * depthPositions
          palletRackSec.addItem({
            role: 'frame-brace',
            system: 'Selective Pallet Rack',
            item: 'Frame Horizontal Tie Brace',
            specification: `30×30 mm C-profile (Span=${(rack.depth - rack.uprightDepth).toFixed(2)} m)`,
            quantity: horizTies,
            unit: 'pcs',
          })
          palletRackSec.addItem({
            role: 'frame-brace',
            system: 'Selective Pallet Rack',
            item:
              rack.bracing === 'x-bracing'
                ? 'Frame Diagonal X-Brace Lattice'
                : 'Frame Diagonal K-Brace Lattice',
            specification: '30×30 mm diagonal tubular brace',
            quantity: diagBraces,
            unit: 'pcs',
          })
        }

        // Load Beams & Safety Pins
        const allBeamed = rackBeamedLevels(rack)
        const presentSet = new Set(presentLevels)
        let bayBeams = 0
        let bayShelves = 0

        for (const level of allBeamed) {
          if (!presentSet.has(level)) continue
          const bHeight = rackLevelBeamHeight(rack, level)
          const beamQty = 2 * depthPositions
          bayBeams += beamQty

          palletRackSec.addItem({
            role: 'load-beam',
            system: 'Selective Pallet Rack',
            item: level === 0 ? 'Ground Load Beam' : 'Box Load Beam',
            specification: `Span=${rack.bayClearWidth.toFixed(2)} m (H=${Math.round(bHeight * 1000)} mm, W=${Math.round(rack.beamThickness * 1000)} mm)`,
            quantity: beamQty,
            unit: 'pcs',
            notes: `Level ${level}`,
          })

          palletRackSec.addItem({
            role: 'safety-pin',
            system: 'Selective Pallet Rack',
            item: 'Beam Safety Locking Pin',
            specification: 'Spring steel safety pin (2 per beam connection)',
            quantity: beamQty * 2,
            unit: 'pcs',
          })

          fastenersSec.addItem({
            role: 'safety-pin',
            system: 'Selective Pallet Rack',
            item: 'Beam Safety Locking Pin',
            specification: 'Spring steel safety pin (2 per beam connection)',
            quantity: beamQty * 2,
            unit: 'pcs',
          })

          const finish = rackDeckFinishOf(rack, level)
          if (finish) {
            const shelfQty = 1 * depthPositions
            bayShelves += shelfQty
            const finishName =
              finish === 'wire-mesh'
                ? 'Wire Mesh Deck Panel'
                : finish === 'steel'
                  ? 'Steel Deck Panel'
                  : finish === 'timber'
                    ? 'Timber Deck Panel (18mm P5)'
                    : 'Picking Shelf Panel'
            palletRackSec.addItem({
              role: 'shelf-panel',
              system: 'Selective Pallet Rack',
              item: finishName,
              specification: `Span=${rack.bayClearWidth.toFixed(2)} m × ${(rack.depth - 2 * rack.beamThickness).toFixed(2)} m`,
              quantity: shelfQty,
              unit: 'pcs',
              notes: `Level ${level} (${finish})`,
            })
          }
        }

        totalBeams += bayBeams
        totalShelfPanels += bayShelves

        // Row Spacers for double-deep racks
        if (depthPositions === 2) {
          const spacerQty = 2 * frameLines
          fastenersSec.addItem({
            role: 'row-spacer',
            system: 'Selective Pallet Rack',
            item: 'Double-Deep Frame Row Spacer Tie',
            specification: `L=${Math.round((rack.depthGap ?? 0.2) * 1000)} mm back-to-back connector`,
            quantity: spacerQty,
            unit: 'pcs',
          })
        }

        // Post Protectors (Outer aisle ends)
        if (!hasRight) {
          fastenersSec.addItem({
            role: 'post-protector',
            system: 'Selective Pallet Rack',
            item: 'Heavy-Duty Column Post Protector',
            specification: 'Steel wrap-around corner impact guard (H=400 mm)',
            quantity: 2 * depthPositions,
            unit: 'pcs',
          })
        }

        totalFloorArea += rack.bayClearWidth * rack.depth * depthPositions
        break
      }

      case 'warehouse:drive-in-rack': {
        const lane = parseWarehouseNode(DriveInRackNode, rawNode, 'drive-in-rack')
        if (!lane) break

        totalBays += 1
        const levels = driveInStorageLevels(lane)
        totalLevels += levels.length
        totalPalletPositions += driveInPalletSlotCount(lane)

        const rawRack = rawNode as Record<string, unknown>
        const hasRight =
          rawRack.hasRightNeighbour === true || hasDriveInRightNeighbour(nodes, lane.id)
        const frameLines = hasRight ? 1 : 2
        const postCountPerLine = driveInPostCentersZ(lane).length
        const totalPosts = frameLines * postCountPerLine
        totalUprightPosts += totalPosts

        // Uprights & Footplates
        driveInSec.addItem({
          role: 'upright-post',
          system: 'Drive-In Rack',
          item: 'Drive-In Upright Column',
          specification: `${Math.round(lane.uprightWidth * 1000)}×${Math.round(lane.uprightDepth * 1000)} mm (H=${lane.uprightHeight.toFixed(2)} m)`,
          quantity: totalPosts,
          unit: 'pcs',
        })

        driveInSec.addItem({
          role: 'footplate',
          system: 'Drive-In Rack',
          item: 'Drive-In Heavy Baseplate',
          specification: `${Math.round(lane.uprightWidth * 1400)}×${Math.round(lane.uprightDepth * 1500)} mm (t=12 mm)`,
          quantity: totalPosts,
          unit: 'pcs',
        })

        fastenersSec.addItem({
          role: 'anchor-bolt',
          system: 'Drive-In Rack',
          item: 'Floor Anchor Bolt (M12 Expansion)',
          specification: 'M12×100 mm concrete anchor',
          quantity: totalPosts * 2,
          unit: 'pcs',
        })

        // Continuous Pallet Support Rails
        const fitted = driveInFittedLevelCount(lane)
        const totalDepth = driveInTotalDepth(lane)
        const railCount = 2 * fitted
        driveInSec.addItem({
          role: 'pallet-rail',
          system: 'Drive-In Rack',
          item: `Continuous Pallet Support Rail (${lane.railType.toUpperCase()})`,
          specification: `Profile ${lane.railType.toUpperCase()} (Length=${totalDepth.toFixed(2)} m)`,
          quantity: railCount,
          unit: 'pcs',
          notes: `${fitted} storage levels`,
        })

        // Rail Cantilever Brackets
        const bracketCount = 2 * postCountPerLine * fitted
        driveInSec.addItem({
          role: 'rail-bracket',
          system: 'Drive-In Rack',
          item: 'Rail Support Cantilever Bracket',
          specification: 'Reinforced wrap-around bracket clamp',
          quantity: bracketCount,
          unit: 'pcs',
        })

        // Top Portal Tie Beams
        const portalBeamsCount = postCountPerLine
        totalBeams += portalBeamsCount
        driveInSec.addItem({
          role: 'load-beam',
          system: 'Drive-In Rack',
          item: 'Top Portal Tie Beam',
          specification: `Span=${lane.laneClearWidth.toFixed(2)} m (H=${Math.round(lane.topBeamHeight * 1000)} mm)`,
          quantity: portalBeamsCount,
          unit: 'pcs',
        })

        // Floor Guide Channels
        if (lane.guideRails) {
          driveInSec.addItem({
            role: 'guide-rail',
            system: 'Drive-In Rack',
            item: 'Floor Guidance Angle Channel (LPN50)',
            specification: `50×40 mm floor guide angle (Length=${totalDepth.toFixed(2)} m)`,
            quantity: 2,
            unit: 'pcs',
          })
        }

        // Lead-in Centralisers
        if (lane.centralisers && lane.railType === 'gp') {
          const mouthCount = lane.entryMode === 'drive-through' ? 4 : 2
          driveInSec.addItem({
            role: 'equipment',
            system: 'Drive-In Rack',
            item: 'Entry Flare Centraliser Horn',
            specification: 'GP flared guide mouth (L=400 mm)',
            quantity: mouthCount * fitted,
            unit: 'pcs',
          })
        }

        // Column Reinforcers
        if (lane.uprightReinforcer) {
          const faces = lane.entryMode === 'drive-through' ? 2 : 1
          fastenersSec.addItem({
            role: 'post-protector',
            system: 'Drive-In Rack',
            item: 'Upright Heavy Impact Sleeve Reinforcer',
            specification: 'Steel column boot (H=400 mm)',
            quantity: frameLines * faces,
            unit: 'pcs',
          })
        }

        // Frame Bracing
        driveInSec.addItem({
          role: 'frame-brace',
          system: 'Drive-In Rack',
          item: 'Longitudinal Base Tie Beam',
          specification: `40×40 mm section (L=${(totalDepth / Math.max(1, postCountPerLine - 1)).toFixed(2)} m)`,
          quantity: frameLines * Math.max(1, postCountPerLine - 1),
          unit: 'pcs',
        })

        totalFloorArea += lane.laneClearWidth * totalDepth
        break
      }

      case 'warehouse:live-rack': {
        const live = parseWarehouseNode(LiveRackingNode, rawNode, 'live-racking')
        if (!live) break

        totalBays += 1
        totalLevels += live.levels
        totalPalletPositions += liveRackingPalletPositions(live)

        const rawRack = rawNode as Record<string, unknown>
        const hasRight =
          rawRack.hasRightNeighbour === true || hasLiveRackRightNeighbour(nodes, live.id)
        const frameLines = hasRight ? 1 : 2
        const height = liveFrameHeightM(live)
        const depth = liveChannelDepthM(live)
        const width = liveBayWidthM(live)
        const rollerLen = liveRollerLengthM(live)

        // Uprights
        const postsPerLine = 2 + Math.max(0, Math.round((depth - 0.1) / 2.5) - 1)
        const totalPosts = frameLines * postsPerLine
        totalUprightPosts += totalPosts

        liveRackSec.addItem({
          role: 'upright-post',
          system: 'Live Dynamic Racking',
          item: 'Gravity Flow Upright Column',
          specification: `80×60 mm section (H=${height.toFixed(2)} m)`,
          quantity: totalPosts,
          unit: 'pcs',
        })

        liveRackSec.addItem({
          role: 'footplate',
          system: 'Live Dynamic Racking',
          item: 'Leveling Footplate',
          specification: '128×96 mm steel plate (t=12 mm)',
          quantity: totalPosts,
          unit: 'pcs',
        })

        fastenersSec.addItem({
          role: 'anchor-bolt',
          system: 'Live Dynamic Racking',
          item: 'Floor Anchor Bolt (M12 Expansion)',
          specification: 'M12×100 mm anchor bolt',
          quantity: totalPosts * 2,
          unit: 'pcs',
        })

        // Dynamic Entry & Exit Beams
        const dynamicBeams = 2 * live.levels
        totalBeams += dynamicBeams
        liveRackSec.addItem({
          role: 'load-beam',
          system: 'Live Dynamic Racking',
          item: 'Dynamic Flow Cross Beam',
          specification: `Span=${width.toFixed(2)} m (H=100 mm, W=50 mm)`,
          quantity: dynamicBeams,
          unit: 'pcs',
        })

        // Gravity Channel Tracks
        liveRackSec.addItem({
          role: 'roller-track',
          system: 'Live Dynamic Racking',
          item: 'Gravity Flow Roller Track Channel',
          specification: `Galvanized C-track (Length=${depth.toFixed(2)} m)`,
          quantity: live.levels,
          unit: 'pcs',
        })

        // Gravity Rollers
        const gridCount = rollerGridCount(live)
        const totalRollers = (gridCount + 1) * live.levels
        liveRackSec.addItem({
          role: 'flow-roller',
          system: 'Live Dynamic Racking',
          item: live.splitRollers ? 'Split Gravity Flow Roller' : 'Steel Gravity Flow Roller',
          specification: `Ø50 mm steel roller (Length=${rollerLen.toFixed(2)} m, Pitch=${Math.round(live.rollerPitch * 1000)} mm)`,
          quantity: totalRollers,
          unit: 'pcs',
        })

        // Brake Rollers & Drums
        if (liveHasBrakeRollers(live)) {
          const brakeIndicesCount = brakeRollerIndices(live).size
          const totalBrakes = brakeIndicesCount * live.levels
          liveRackSec.addItem({
            role: 'brake-roller',
            system: 'Live Dynamic Racking',
            item: 'Centrifugal Speed Controller Brake Roller & Drum',
            specification: 'Direct-drive centrifugal speed governor (Ø50 mm roller + brake drum)',
            quantity: totalBrakes,
            unit: 'sets',
          })
        }

        // Automatic Separators & Retainers
        if (live.withRetainers !== false) {
          liveRackSec.addItem({
            role: 'pallet-separator',
            system: 'Live Dynamic Racking',
            item: 'Automatic Pallet Load Separator / Retainer',
            specification: 'Mechanical pedal & latch separator mechanism',
            quantity: live.levels,
            unit: 'sets',
          })
        }

        // End stops / Exit beams
        liveRackSec.addItem({
          role: 'equipment',
          system: 'Live Dynamic Racking',
          item:
            live.variant === 'FIFO'
              ? 'FIFO Heavy Impact Exit Beam & Buffer'
              : 'LIFO Push-Back End Stop',
          specification: `Width=${rollerLen.toFixed(2)} m (Heavy-duty steel stop)`,
          quantity: live.levels,
          unit: 'pcs',
        })

        totalFloorArea += width * depth
        break
      }

      case 'warehouse:longspan-rack': {
        const bay = parseWarehouseNode(LongspanNode, rawNode, 'longspan')
        if (!bay) break

        totalBays += 1
        const fitted = longspanFittedLevels(bay)
        totalLevels += fitted.length
        totalFloorArea += bay.bayLength * bay.frameDepth

        const rawRack = rawNode as Record<string, unknown>
        const hasRight =
          rawRack.hasRightNeighbour === true || hasLongspanRightNeighbour(nodes, bay.id)
        const frameLines = hasRight ? 1 : 2
        const upright = longspanUprightSection(bay)
        const totalPosts = frameLines * 2
        totalUprightPosts += totalPosts

        // Uprights & Footplates
        longspanSec.addItem({
          role: 'upright-post',
          system: 'Longspan M7 Shelving',
          item: 'Longspan Upright Post (Punched)',
          specification: `${Math.round(upright.width * 1000)}×${Math.round(upright.depth * 1000)} mm (H=${bay.frameHeight.toFixed(2)} m)`,
          quantity: totalPosts,
          unit: 'pcs',
        })

        longspanSec.addItem({
          role: 'footplate',
          system: 'Longspan M7 Shelving',
          item: 'Base Footplate',
          specification: `${Math.round(upright.width * 1500)}×${Math.round(upright.depth * 1400)} mm (t=10 mm)`,
          quantity: totalPosts,
          unit: 'pcs',
        })

        fastenersSec.addItem({
          role: 'anchor-bolt',
          system: 'Longspan M7 Shelving',
          item: 'Floor Anchor Bolt (M10 Expansion)',
          specification: 'M10×80 mm expansion anchor',
          quantity: totalPosts * 2,
          unit: 'pcs',
        })

        // Step Beams & Shelf Panels
        for (const level of fitted) {
          if (level.structure === 'reinforced-hm') {
            longspanSec.addItem({
              role: 'shelf-panel',
              system: 'Longspan M7 Shelving',
              item: 'Reinforced HM Shelf Panel (No Beams)',
              specification: `Folded steel sheet (Span=${bay.bayLength.toFixed(2)} m × ${(bay.frameDepth - upright.depth).toFixed(2)} m)`,
              quantity: 1,
              unit: 'pcs',
            })
            totalShelfPanels += 1
            longspanSec.addItem({
              role: 'equipment',
              system: 'Longspan M7 Shelving',
              item: 'PK Side Corner Hook Support',
              specification: 'Side slot hook bracket (4 per HM level)',
              quantity: 4,
              unit: 'pcs',
            })
            continue
          }

          // Step beams
          const beamQty = 2
          totalBeams += beamQty
          longspanSec.addItem({
            role: 'load-beam',
            system: 'Longspan M7 Shelving',
            item: 'Step Load Beam (ZE/ZS Profile)',
            specification: `Span=${bay.bayLength.toFixed(2)} m (${bay.beamProfile})`,
            quantity: beamQty,
            unit: 'pcs',
          })

          fastenersSec.addItem({
            role: 'safety-pin',
            system: 'Longspan M7 Shelving',
            item: 'Beam Safety Locking Pin',
            specification: 'Snap-lock spring pin',
            quantity: beamQty * 2,
            unit: 'pcs',
          })

          if (level.structure === 'hanging') {
            longspanSec.addItem({
              role: 'equipment',
              system: 'Longspan M7 Shelving',
              item: 'Garment Hanging Rail',
              specification: `Ø30 mm tubular rail (Span=${bay.bayLength.toFixed(2)} m)`,
              quantity: 1,
              unit: 'pcs',
            })
            continue
          }

          if (level.structure === 'beam-shelf' || (level.structure as string) === 'shelf') {
            const shelfName =
              level.shelfKind === 'chipboard'
                ? 'Chipboard Shelf Panel (22mm)'
                : level.shelfKind === 'mesh'
                  ? 'Wire Mesh Drop-in Panel'
                  : 'Galvanized Steel Shelf Tray'
            longspanSec.addItem({
              role: 'shelf-panel',
              system: 'Longspan M7 Shelving',
              item: shelfName,
              specification: `Span=${bay.bayLength.toFixed(2)} m × ${(bay.frameDepth - 0.08).toFixed(2)} m`,
              quantity: 1,
              unit: 'pcs',
            })
            totalShelfPanels += 1

            if (longspanLevelNeedsZtam(bay, level)) {
              fastenersSec.addItem({
                role: 'equipment',
                system: 'Longspan M7 Shelving',
                item: 'Z-TAM Board Retaining Clamp',
                specification: 'Steel beam-to-chipboard clamp block',
                quantity: 4,
                unit: 'pcs',
              })
            }
          }
        }
        break
      }

      case 'warehouse:m3-rack': {
        const bay = parseWarehouseNode(M3ShelvingNode, rawNode, 'm3')
        if (!bay) break

        totalBays += 1
        const fitted = m3FittedLevels(bay)
        totalLevels += fitted.length
        totalFloorArea += bay.shelfLength * bay.shelfDepth

        const rawRack = rawNode as Record<string, unknown>
        const hasRight =
          rawRack.hasRightNeighbour === true || hasM3RightNeighbour(nodes, bay.id)
        const frameLines = hasRight ? 1 : 2
        const totalPosts = frameLines * 2
        totalUprightPosts += totalPosts

        // Uprights & Footplates
        m3Sec.addItem({
          role: 'upright-post',
          system: 'M3 Shelving',
          item: 'M3 Upright Post (25mm Pitch)',
          specification: `${Math.round(M3_UPRIGHT_SECTION.width * 1000)}×${Math.round(M3_UPRIGHT_SECTION.depth * 1000)} mm (H=${bay.frameHeight.toFixed(2)} m)`,
          quantity: totalPosts,
          unit: 'pcs',
        })

        m3Sec.addItem({
          role: 'footplate',
          system: 'M3 Shelving',
          item: 'Base Footplate',
          specification: 'Baseplate (t=8 mm)',
          quantity: totalPosts,
          unit: 'pcs',
        })

        fastenersSec.addItem({
          role: 'anchor-bolt',
          system: 'M3 Shelving',
          item: 'Floor Anchor Bolt (M8 Expansion)',
          specification: 'M8×65 mm expansion anchor',
          quantity: totalPosts * 2,
          unit: 'pcs',
        })

        // Frame Cross-ties
        const tieCount = m3CrossTieCount(bay) * frameLines
        m3Sec.addItem({
          role: 'frame-brace',
          system: 'M3 Shelving',
          item: 'Frame Cross Tie',
          specification: `Tubular tie (Depth=${(bay.shelfDepth - M3_UPRIGHT_SECTION.depth).toFixed(2)} m)`,
          quantity: tieCount,
          unit: 'pcs',
        })

        // Shelves, Clips, Drawers
        for (const level of fitted) {
          if (level.structure === 'shelf') {
            m3Sec.addItem({
              role: 'shelf-panel',
              system: 'M3 Shelving',
              item: `M3 Galvanized Steel Shelf (${level.model.toUpperCase()})`,
              specification: `Span=${(bay.shelfLength - M3_UPRIGHT_SECTION.width).toFixed(2)} m × ${bay.shelfDepth.toFixed(2)} m (t=35 mm)`,
              quantity: 1,
              unit: 'pcs',
            })
            totalShelfPanels += 1

            m3Sec.addItem({
              role: 'shelf-clip',
              system: 'M3 Shelving',
              item: 'M3 Shelf Support Clip',
              specification: 'Hook clip (4 per shelf level)',
              quantity: 4,
              unit: 'pcs',
            })

            fastenersSec.addItem({
              role: 'equipment',
              system: 'M3 Shelving',
              item: 'M3 Shelf Support Clip',
              specification: 'Hook clip (4 per shelf level)',
              quantity: 4,
              unit: 'pcs',
            })

            if (level.dividers > 0) {
              m3Sec.addItem({
                role: 'equipment',
                system: 'M3 Shelving',
                item: 'Modular Vertical Shelf Divider',
                specification: `Depth=${m3DividerDepth(bay).toFixed(2)} m steel divider`,
                quantity: level.dividers,
                unit: 'pcs',
              })
            }
          } else if (level.structure === 'drawers') {
            const dCount = m3DrawerCount(bay, level)
            m3Sec.addItem({
              role: 'equipment',
              system: 'M3 Shelving',
              item: 'Modular Drawer Cassette',
              specification: `Telescopic slide drawer unit (${dCount} compartments)`,
              quantity: dCount,
              unit: 'units',
            })
          }
        }
        break
      }

      case 'warehouse:mezzanine': {
        const mezz = parseWarehouseNode(MezzanineNode, rawNode, 'mezzanine')
        if (!mezz) break

        const rawMezz = rawNode as Record<string, unknown>
        const tiersCount = mezz.tiers.length
        const footprint =
          typeof rawMezz.width === 'number' && typeof rawMezz.depth === 'number'
            ? (rawMezz.width as number) * (rawMezz.depth as number)
            : polygonArea(mezzanineOutlinePolygon(mezz))
        const totalDeckArea = footprint * tiersCount
        totalFloorArea += footprint

        const columnPositions = mezzGridColumnPositions(mezz)
        const colProfile = mezzResolveColumnProfile(mezz)
        const colCount =
          typeof rawMezz.columnGridX === 'number' && typeof rawMezz.columnGridZ === 'number'
            ? (rawMezz.columnGridX as number) * (rawMezz.columnGridZ as number)
            : columnPositions.length

        // Structural Columns
        mezzanineSec.addItem({
          role: 'column',
          system: 'Mezzanine Raised Platform',
          item: 'Structural Support Column',
          specification: `${Math.round(colProfile.b * 1000)}×${Math.round(colProfile.h * 1000)} mm hollow structural section`,
          quantity: colCount,
          unit: 'pcs',
          notes: `${tiersCount} platform tiers`,
        })

        // Heavy Baseplates & 4 Anchors per column
        mezzanineSec.addItem({
          role: 'footplate',
          system: 'Mezzanine Raised Platform',
          item: 'Heavy Baseplate Anchor Stool',
          specification: `${Math.round(colProfile.b * 1700)}×${Math.round(colProfile.h * 1700)} mm (t=20 mm)`,
          quantity: colCount,
          unit: 'pcs',
        })

        fastenersSec.addItem({
          role: 'anchor-bolt',
          system: 'Mezzanine Raised Platform',
          item: 'Structural Anchor Bolt (M16 Heavy Duty)',
          specification: 'M16×150 mm chemical/expansion anchor (4 per column)',
          quantity: colCount * 4,
          unit: 'pcs',
        })

        // Main Beams & Secondary Joists
        const mainBeam = mezzResolveMainBeamProfile(mezz)
        const secBeam = mezzResolveSecondaryBeamProfile(mezz)
        const spanW =
          typeof rawMezz.width === 'number' ? (rawMezz.width as number) : mezzFootprintWidthM(mezz)
        const spanD =
          typeof rawMezz.depth === 'number' ? (rawMezz.depth as number) : mezzFootprintDepthM(mezz)

        const estMainBeamLinearM = spanW * (Math.ceil(spanD / 4) + 1) * tiersCount
        const estSecBeamLinearM = spanD * Math.ceil(spanW / 0.6) * tiersCount

        mezzanineSec.addItem({
          role: 'main-beam',
          system: 'Mezzanine Raised Platform',
          item: 'Primary Main Girder Beam',
          specification: `IPE/HEA Profile (H=${Math.round(mainBeam.h * 1000)} mm, W=${Math.round(mainBeam.b * 1000)} mm)`,
          quantity: Math.round(estMainBeamLinearM),
          unit: 'm',
        })

        mezzanineSec.addItem({
          role: 'secondary-beam',
          system: 'Mezzanine Raised Platform',
          item: 'Secondary Joist / Purlin',
          specification: `Sigma / Cold-rolled C-section (H=${Math.round(secBeam.h * 1000)} mm)`,
          quantity: Math.round(estSecBeamLinearM),
          unit: 'm',
        })

        // Flooring Deck Area
        const floorType =
          (mezz as unknown as { floorType?: string }).floorType ??
          mezz.tiers[0]?.floorType ??
          'WOOD_CHIPBOARD_30'
        const floorTypeName = String(floorType).toLowerCase().includes('chipboard')
          ? 'P6 Heavy-Duty Particleboard (38mm)'
          : String(floorType).toLowerCase().includes('steel') ||
              String(floorType).toLowerCase().includes('metal')
            ? 'Steel Deck Plate'
            : String(floorType).toLowerCase().includes('grating') ||
                String(floorType).toLowerCase().includes('grid')
              ? 'Open Steel Bar Grating'
              : 'Composite Floor Deck'

        mezzanineSec.addItem({
          role: 'deck-floor',
          system: 'Mezzanine Raised Platform',
          item: floorTypeName,
          specification: `Flooring Deck Panels (Total Area=${totalDeckArea.toFixed(1)} m²)`,
          quantity: Math.round(totalDeckArea * 10) / 10,
          unit: 'm²',
        })

        // Perimeter Safety Handrails & Kickboards
        const edges = mezzOutlineEdges(mezz)
        let perimeterM =
          typeof rawMezz.handrailPerimeter === 'number' ? (rawMezz.handrailPerimeter as number) : 0
        if (perimeterM === 0) {
          for (const edge of edges) {
            perimeterM += edge.lengthM
          }
        }
        const totalHandrailM = perimeterM * tiersCount

        mezzanineSec.addItem({
          role: 'handrail',
          system: 'Mezzanine Raised Platform',
          item: 'Perimeter Safety Handrail & Midrail System',
          specification: '1100 mm high industrial handrail with posts at 1.5m o.c.',
          quantity: Math.round(totalHandrailM * 10) / 10,
          unit: 'm',
        })

        mezzanineSec.addItem({
          role: 'handrail',
          system: 'Mezzanine Raised Platform',
          item: 'Steel Safety Kickboard / Toe Guard',
          specification: '150 mm high solid steel toe plate',
          quantity: Math.round(totalHandrailM * 10) / 10,
          unit: 'm',
        })

        // Staircase
        let stairCount =
          typeof rawMezz.staircases === 'number'
            ? (rawMezz.staircases as number)
            : (rawMezz.staircase as { enabled?: boolean } | undefined)?.enabled
              ? tiersCount
              : 0
        for (const tier of mezz.tiers) {
          stairCount += tier.accessories?.staircases?.length ?? 0
        }
        if (stairCount > 0) {
          mezzanineSec.addItem({
            role: 'staircase',
            system: 'Mezzanine Raised Platform',
            item: 'Access Staircase Flight & Handrails',
            specification: 'Width=1.00 m with anti-slip perforated treads',
            quantity: stairCount,
            unit: 'sets',
          })
        }

        // Safety Loading Gate
        let gateCount = (rawMezz.palletGate as { enabled?: boolean } | undefined)?.enabled
          ? tiersCount
          : 0
        for (const tier of mezz.tiers) {
          gateCount +=
            (tier.accessories?.swingGates?.length ?? 0) +
            (tier.accessories?.upAndOverGates?.length ?? 0)
        }
        if (gateCount > 0) {
          mezzanineSec.addItem({
            role: 'equipment',
            system: 'Mezzanine Raised Platform',
            item: 'Safety Pallet Loading Gate',
            specification: 'Interlocked pivot/tilt safety gate',
            quantity: gateCount,
            unit: 'units',
          })
        }
        break
      }

      case 'warehouse:conveyor-straight':
      case 'warehouse:conveyor-roller': {
        const conveyor = parseWarehouseNode(ConveyorRollerNode, rawNode, 'conveyor-roller')
        if (!conveyor) break

        const rawConv = rawNode as Record<string, unknown>
        const len =
          typeof rawConv.lengthM === 'number'
            ? rawConv.lengthM
            : typeof rawConv.length === 'number'
              ? (rawConv.length as number)
              : rollerModuleLengthM(conveyor)
        const width =
          typeof rawConv.frameWidth === 'number'
            ? rawConv.frameWidth
            : typeof rawConv.width === 'number'
              ? (rawConv.width as number)
              : rollerFrameWidthM(conveyor)
        const isDriven =
          typeof rawConv.driven === 'boolean'
            ? rawConv.driven
            : (conveyor as unknown as { speed?: number }).speed !== undefined

        totalFloorArea += len * width
        conveyorSec.addItem({
          role: 'conveyor-module',
          system: 'Conveyor Network',
          item: isDriven ? 'Driven Roller Conveyor Section' : 'Gravity Roller Conveyor Section',
          specification: `Straight module (Length=${len.toFixed(2)} m, Width=${width.toFixed(2)} m)`,
          quantity: 1,
          unit: 'units',
        })

        const legs =
          typeof rawConv.supportCount === 'number'
            ? rawConv.supportCount
            : (Math.ceil(len / 3.0) + 1) * 2
        conveyorSec.addItem({
          role: 'equipment',
          system: 'Conveyor Network',
          item: 'Adjustable Floor Support Leg',
          specification: `H=${(conveyor.transportHeight ?? 0.8).toFixed(2)} m telescopic foot`,
          quantity: legs,
          unit: 'pcs',
        })
        break
      }

      case 'warehouse:conveyor-curve': {
        const conveyor = parseWarehouseNode(ConveyorCurveNode, rawNode, 'conveyor-curve')
        if (!conveyor) break
        const len = curveCentrelineLengthM(conveyor)
        const cWidth =
          typeof (conveyor as unknown as { frameWidth?: number }).frameWidth === 'number'
            ? (conveyor as unknown as { frameWidth: number }).frameWidth
            : 0.8
        const cAngle =
          typeof (conveyor as unknown as { angleDeg?: number }).angleDeg === 'number'
            ? (conveyor as unknown as { angleDeg: number }).angleDeg
            : 90

        totalFloorArea += len * cWidth
        conveyorSec.addItem({
          role: 'conveyor-module',
          system: 'Conveyor Network',
          item: 'Curved Roller Conveyor Section',
          specification: `Radius=${conveyor.innerRadius.toFixed(2)} m, Arc=${Math.round(cAngle)}°`,
          quantity: 1,
          unit: 'units',
        })
        break
      }

      case 'warehouse:conveyor-booster': {
        const conveyor = parseWarehouseNode(ConveyorBoosterNode, rawNode, 'conveyor-booster')
        if (!conveyor) break
        const len = boosterModuleLengthM(conveyor)
        const bLift =
          typeof (conveyor as unknown as { targetLiftM?: number }).targetLiftM === 'number'
            ? (conveyor as unknown as { targetLiftM: number }).targetLiftM
            : 1.0

        conveyorSec.addItem({
          role: 'conveyor-module',
          system: 'Conveyor Network',
          item: 'Incline Belt Booster Conveyor',
          specification: `Belt drive module (Length=${len.toFixed(2)} m, Rise=${bLift.toFixed(2)} m)`,
          quantity: 1,
          unit: 'units',
        })
        break
      }

      case 'warehouse:conveyor-launcher': {
        const conveyor = parseWarehouseNode(ConveyorLauncherNode, rawNode, 'conveyor-launcher')
        if (!conveyor) break
        const len = launcherModuleLengthM(conveyor)
        conveyorSec.addItem({
          role: 'conveyor-module',
          system: 'Conveyor Network',
          item: 'Conveyor Feed Launcher Unit',
          specification: `Motorized entry feed unit (Length=${len.toFixed(2)} m)`,
          quantity: 1,
          unit: 'units',
        })
        break
      }

      case 'warehouse:conveyor-oblique': {
        const conveyor = parseWarehouseNode(ConveyorObliqueNode, rawNode, 'conveyor-oblique')
        if (!conveyor) break
        const len = obliqueModuleLengthM(conveyor)
        conveyorSec.addItem({
          role: 'conveyor-module',
          system: 'Conveyor Network',
          item: 'Oblique Incline Conveyor',
          specification: `Inclined transfer unit (Length=${len.toFixed(2)} m)`,
          quantity: 1,
          unit: 'units',
        })
        break
      }

      case 'warehouse:conveyor-spiral': {
        const conveyor = parseWarehouseNode(ConveyorSpiralNode, rawNode, 'conveyor-spiral')
        if (!conveyor) break
        const len = spiralHelixArcLengthM(conveyor)
        const sLift =
          typeof (conveyor as unknown as { totalHeightM?: number }).totalHeightM === 'number'
            ? (conveyor as unknown as { totalHeightM: number }).totalHeightM
            : 3.0

        conveyorSec.addItem({
          role: 'conveyor-module',
          system: 'Conveyor Network',
          item: 'Spiral Gravity Chute / Lowerator',
          specification: `Continuous spiral helix (Lift=${sLift.toFixed(2)} m, Arc=${len.toFixed(2)} m)`,
          quantity: 1,
          unit: 'units',
        })
        break
      }

      case 'warehouse:conveyor-telescopic': {
        const conveyor = parseWarehouseNode(ConveyorTelescopicNode, rawNode, 'conveyor-telescopic')
        if (!conveyor) break
        const len = telescopicCurrentLengthM(conveyor)
        conveyorSec.addItem({
          role: 'conveyor-module',
          system: 'Conveyor Network',
          item: 'Telescopic Boom Truck Loader',
          specification: `Extendable cantilever boom (Reach=${len.toFixed(2)} m)`,
          quantity: 1,
          unit: 'units',
        })
        break
      }

      case 'warehouse:conveyor-transfer': {
        const conveyor = parseWarehouseNode(ConveyorTransferNode, rawNode, 'conveyor-transfer')
        if (!conveyor) break
        const len = transferModuleLengthM(conveyor)
        conveyorSec.addItem({
          role: 'conveyor-module',
          system: 'Conveyor Network',
          item: '90° Pop-up Diverter Transfer Table',
          specification: `Right-angle transfer cassette (Length=${len.toFixed(2)} m)`,
          quantity: 1,
          unit: 'units',
        })
        break
      }

      case 'warehouse:bench': {
        const bench = parseWarehouseNode(BenchNode, rawNode, 'bench')
        if (!bench) break
        const bWidth =
          typeof (bench as unknown as { widthM?: number }).widthM === 'number'
            ? (bench as unknown as { widthM: number }).widthM
            : typeof bench.width === 'number'
              ? bench.width
              : 1.5
        const bDepth =
          typeof (bench as unknown as { depthM?: number }).depthM === 'number'
            ? (bench as unknown as { depthM: number }).depthM
            : typeof bench.depth === 'number'
              ? bench.depth
              : 0.8

        facilitiesSec.addItem({
          role: 'equipment',
          system: 'Packing & Workstations',
          item: 'Industrial Packing / Assembly Workbench',
          specification: `${bWidth.toFixed(2)}×${bDepth.toFixed(2)} m ergonomic steel workstation`,
          quantity: 1,
          unit: 'units',
        })
        totalFloorArea += bWidth * bDepth
        break
      }

      case 'warehouse:dock-leveller': {
        const dock = parseWarehouseNode(DockLevellerNode, rawNode, 'dockleveller')
        if (!dock) break

        const rawDock = rawNode as Record<string, unknown>
        const pLen =
          typeof rawDock.platformLength === 'number'
            ? (rawDock.platformLength as number)
            : typeof rawDock.length === 'number'
              ? (rawDock.length as number)
              : Number(dock.length) / 1000 || 2.5
        const pWid =
          typeof rawDock.platformWidth === 'number'
            ? (rawDock.platformWidth as number)
            : typeof rawDock.width === 'number'
              ? (rawDock.width as number)
              : Number(dock.width) / 1000 || 2.0

        facilitiesSec.addItem({
          role: 'equipment',
          system: 'Loading Dock Systems',
          item: 'Electro-Hydraulic Dock Leveller',
          specification: `${pLen.toFixed(2)}×${pWid.toFixed(2)} m with telescopic lip & dock bumpers`,
          quantity: 1,
          unit: 'units',
        })
        totalFloorArea += pLen * pWid
        break
      }

      case 'warehouse:pallet-lift': {
        const lift = parseWarehouseNode(PalletLiftNode, rawNode, 'pallet-lift')
        if (!lift) break
        facilitiesSec.addItem({
          role: 'equipment',
          system: 'Vertical Material Handling',
          item: 'Vertical Reciprocating Conveyor (Pallet Lift VRC)',
          specification: 'Dual-mast interlocked freight hoist with safety gates',
          quantity: 1,
          unit: 'units',
        })
        totalFloorArea += 4.0
        break
      }

      case 'warehouse:truck':
      case 'warehouse:truck-reach':
      case 'warehouse:truck-forklift':
      case 'warehouse:truck-ept':
      case 'warehouse:truck-mpt':
      case 'warehouse:truck-turret':
      case 'warehouse:truck-vna': {
        const truck = parseWarehouseNode(TruckNode, rawNode, 'truck')
        const rawTruck = rawNode as Record<string, unknown>
        const modelName =
          truck?.model ?? (typeof rawTruck.model === 'string' ? rawTruck.model : 'Forklift')
        const truckType = `${String(modelName).toUpperCase()}`
        handlingSec.addItem({
          role: 'equipment',
          system: 'Material Handling Equipment',
          item: `Fleet Industrial Truck (${truckType})`,
          specification: 'Heavy material handling vehicle',
          quantity: 1,
          unit: 'units',
        })
        break
      }

      case 'warehouse:tote-cart': {
        const cart = parseWarehouseNode(ToteCartNode, rawNode, 'totecart')
        if (!cart) break
        handlingSec.addItem({
          role: 'equipment',
          system: 'Picking & Handling Carts',
          item: 'Multi-Tier Picking & Order Tote Cart',
          specification: `Mobile cart with ${cart.tiers ?? 3} tiers & swivel castors`,
          quantity: 1,
          unit: 'units',
        })
        break
      }

      case 'warehouse:route': {
        const route = parseWarehouseNode(RouteNode, rawNode, 'route')
        if (!route) break
        const len = polylineLength(route.points)
        handlingSec.addItem({
          role: 'equipment',
          system: 'Floor Markings & Traffic Safety',
          item: 'Demarcation Epoxy Floor Striping',
          specification: 'Safety yellow 100mm industrial aisle line marking',
          quantity: Math.round(len * 10) / 10,
          unit: 'm',
        })
        break
      }

      case 'warehouse:pallet': {
        const pallet = parseWarehouseNode(PalletNode, rawNode, 'pallet')
        if (!pallet) break
        if (!pallet.slotRackId) {
          totalPalletPositions += 1
          handlingSec.addItem({
            role: 'equipment',
            system: 'Pallet Unit Loads',
            item: 'EPAL Euro Pallet (Floor Staged)',
            specification: '1200×800 mm certified wooden euro pallet',
            quantity: 1,
            unit: 'pcs',
          })
          totalFloorArea += 0.96
        }
        break
      }
    }
  }

  // Compile all non-empty sections
  const allSectionCollectors = [
    palletRackSec,
    driveInSec,
    liveRackSec,
    longspanSec,
    m3Sec,
    mezzanineSec,
    conveyorSec,
    facilitiesSec,
    handlingSec,
    fastenersSec,
  ]

  const sections: WarehouseBomSection[] = []
  let totalPartsCount = 0

  for (const collector of allSectionCollectors) {
    const section = collector.toSection()
    if (section) {
      sections.push(section)
      for (const item of section.items) {
        if (item.unit === 'pcs' || item.unit === 'sets' || item.unit === 'units') {
          totalPartsCount += Math.round(item.quantity)
        }
      }
    }
  }

  const kpis: WarehouseBomKpi[] = [
    {
      key: 'total-bays',
      label: 'Storage Bays',
      value: totalBays,
      unit: 'bays',
    },
    {
      key: 'storage-levels',
      label: 'Storage Levels',
      value: totalLevels,
      unit: 'levels',
    },
    {
      key: 'pallet-positions',
      label: 'Pallet Positions',
      value: totalPalletPositions.toLocaleString(),
      unit: 'pallets',
    },
    {
      key: 'total-beams',
      label: 'Load Beams',
      value: totalBeams.toLocaleString(),
      unit: 'beams',
    },
    {
      key: 'upright-posts',
      label: 'Upright Posts',
      value: totalUprightPosts.toLocaleString(),
      unit: 'posts',
    },
    {
      key: 'shelf-panels',
      label: 'Shelf Panels',
      value: totalShelfPanels.toLocaleString(),
      unit: 'panels',
    },
    {
      key: 'total-hardware-parts',
      label: 'Total Fasteners & Parts',
      value: totalPartsCount.toLocaleString(),
      unit: 'items',
    },
    {
      key: 'floor-area',
      label: 'Equipment Footprint',
      value: (Math.round(totalFloorArea * 10) / 10).toLocaleString(),
      unit: 'm²',
    },
  ]

  const engineeringNotes: string[] = [
    '1. CONCRETE SLAB CAPACITY: Floor slab must meet minimum compressive strength of 25 MPa (C20/25) with minimum thickness of 150 mm.',
    '2. FLOOR ANCHORING: Every base footplate must be anchored with specified M12/M10 anchor bolts tightened to nominal torque of 80 Nm.',
    '3. FRAME PLUMBNESS: Upright frame vertical plumbness tolerance must remain within ±1.5 mm per meter of height (EN 15620 Class 400).',
    '4. SAFETY LOCKING PINS: Every beam-to-column connector must be secured with two genuine spring-steel safety locking pins before applying pallet loads.',
    '5. DEFLECTION CRITERIA: Maximum permissible beam deflection under full uniformly distributed safe working load is limited to L/200.',
    '6. AISLE CLEARANCE & PROTECTION: Heavy-duty post wrap-around impact protectors are mandatory on all exposed aisle entry frames.',
  ]

  const dateStr = options.date ?? new Date().toISOString().split('T')[0]!
  const scopeLabel =
    options.scopeLabel ??
    (options.zoneName ? `Zone: ${options.zoneName}` : 'Entire Warehouse (Global Summary)')
  const projectName = options.projectName ?? 'Warehouse Digital Twin'

  return {
    projectName,
    scopeLabel,
    zoneName: options.zoneName,
    date: dateStr,
    kpis,
    sections,
    totalPartsCount,
    engineeringNotes,
  }
}
