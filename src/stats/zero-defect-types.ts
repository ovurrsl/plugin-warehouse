/**
 * Type definitions for the Zero Defect Start-up (ZDSU) Zone Report & Audit Engine.
 *
 * Implements the 6-Pillar Metric Suite based on international warehouse engineering
 * standards (NFPA 13/230, EN 15635, FEM 10.2.02, OSHA 1910.176/178, ANSI B56.1, WERC).
 */

export type ZDSUZoneRole =
  | 'storage-selective'
  | 'storage-drivein'
  | 'storage-live'
  | 'staging-inbound'
  | 'staging-outbound'
  | 'picking'
  | 'vas-packing'
  | 'conveyor-corridor'
  | 'traffic-aisle'
  | 'quarantine'
  | 'generic'

export type ZDSUDefectSeverity = 'blocking' | 'warning' | 'advisory'

export type ZDSUDefectCode =
  | 'ZDSU-R01' // Insufficient Sprinkler Clearance (<0.5m)
  | 'ZDSU-R02' // Severe Aisle Width Restriction (<Wmin)
  | 'ZDSU-R03' // Critical Staging Buffer Deficit (<25m²/dock)
  | 'ZDSU-R04' // Severe Floor Over-Congestion (>70% storage, >55% staging)
  | 'ZDSU-R05' // Blocked Emergency Egress Corridor (<1.0m)
  | 'ZDSU-R06' // Narrow Flue Space Hazard (<75mm)
  | 'ZDSU-R07' // Moderate Floor Over-Utilization (>65% storage, >45% staging)
  | 'ZDSU-R08' // Missing Floor Route Demarcation
  | 'ZDSU-R09' // Low Selectivity for Fast-Pick Zone (<80%)
  | 'ZDSU-R10' // Marginal Dock Buffer Space (25-35m²/dock)
  | 'ZDSU-R11' // Floor Space Underutilization (<35% storage, <20% staging)
  | 'ZDSU-R12' // Unbalanced MHE Truck Assignment

export type ZDSUPillarCategory =
  | 'geometry'
  | 'storage'
  | 'utilization'
  | 'clearance'
  | 'staging'
  | 'safety'

export interface ZDSUDefect {
  code: ZDSUDefectCode
  title: string
  message: string
  severity: ZDSUDefectSeverity
  pillar: ZDSUPillarCategory
  standardRef?: string
}

export type ZDSUStatus = 'ready' | 'warning' | 'blocked'

export type ZDSUUtilizationHealth = 'optimal' | 'congested' | 'severe-congestion' | 'sparse'

/**
 * Pillar 1: Zone Geometry & Spatial Envelope
 */
export interface ZDSUGeometryPillar {
  areaM2: number
  perimeterM: number
  clearHeightM: number
  volumeM3: number
  vertexCount: number
  isValidPolygon: boolean
}

/**
 * Pillar 2: Storage Capacity & Selectivity
 */
export interface ZDSUStoragePillar {
  totalPalletPositions: number
  directAccessPositions: number
  selectivityIndex: number // 0 - 100%
  pickingSlots: number
  shelfAreaM2: number
  palletDensityPerM2: number
  storageBreakdown: {
    selective: number
    driveIn: number
    live: number
    floor: number
  }
}

/**
 * Pillar 3: Floor Space Utilization & Congestion
 */
export interface ZDSUUtilizationPillar {
  equipmentFootprintM2: number
  floorUtilizationPct: number // 0 - 100%
  optimalRange: [number, number] // [min, max] %
  health: ZDSUUtilizationHealth
}

/**
 * Pillar 4: Aisle & MHE Clearance Compliance
 */
export interface ZDSUClearancePillar {
  estimatedAisleWidthM?: number
  requiredAisleWidthM?: number
  mheClassesPresent: string[]
  flueSpaceCompliant: boolean
  sprinklerClearanceM: number
  sprinklerCompliant: boolean
}

/**
 * Pillar 5: Inbound/Outbound Staging Ratios & Dock Buffers
 */
export interface ZDSUStagingPillar {
  dockCount: number
  stagingAreaPerDockM2: number | null
  trailerBufferCapacityPallets: number
  trailerRatio: number | null
}

/**
 * Pillar 6: Zero Defect Readiness Score
 */
export interface ZDSUReadinessPillar {
  score: number // 0 - 100%
  subScores: {
    spatial: number // 30% weight
    fireSafety: number // 25% weight
    utilization: number // 20% weight
    mheCompatibility: number // 15% weight
    trafficFlow: number // 10% weight
  }
  status: ZDSUStatus
  blockingDefectsCount: number
  warningDefectsCount: number
  advisoryDefectsCount: number
}

/**
 * Complete Audit Result for a Single Warehouse Zone
 */
export interface ZoneZDSUAudit {
  zoneId: string
  zoneName: string
  role: ZDSUZoneRole
  geometry: ZDSUGeometryPillar
  storage: ZDSUStoragePillar
  utilization: ZDSUUtilizationPillar
  clearance: ZDSUClearancePillar
  staging: ZDSUStagingPillar
  readiness: ZDSUReadinessPillar
  defects: ZDSUDefect[]
}

/**
 * Facility-wide Aggregate Zero Defect Start-up Audit Report
 */
export interface FacilityZDSUReport {
  zonesAudited: number
  overallReadinessScore: number // 0 - 100%
  overallStatus: ZDSUStatus
  totalZoneAreaM2: number
  totalPalletCapacity: number
  averageFloorUtilizationPct: number
  totalDefects: {
    blocking: number
    warning: number
    advisory: number
  }
  zoneAudits: ZoneZDSUAudit[]
}
