import { describe, expect, test } from 'bun:test'
import type { GeometryContext } from '@pascal-app/core'
import {
  ConveyorSpiralNode,
  conveyorSpiralDefinition,
  PalletLiftNode,
  palletLiftDefinition,
  resolvePalletLiftLevels,
  resolveSpiralBuildingLevels,
  resolveSpiralHeight,
  resolveSpiralRise,
  spiralLevelFingerprint,
} from '../index'
import {
  beltWidthM,
  cageRadiusM,
  columnRadiusM,
  exitAngleRad,
  exitHeightM,
  exitStubCenter,
  footprintM as spiralFootprintM,
  handednessSign,
  handrailRadiusM,
  helixArcLengthM,
  helixPoint,
  helixRadiusM,
  inclineRad,
  legRadiusM,
  outerDiameterM,
  overallHeightM,
  pitchM,
  portSpanM,
  slatOuterRadiusM,
  slatsPerTurn,
  totalAngleRad,
  travelHeightM,
  turnCount,
} from '../conveyor/spiral-metrics'
import { spiralSlatParts, spiralStaticParts } from '../conveyor/spiral-parts'
import { buildSpiralFloorplan } from '../conveyor/spiral-floorplan'
import { conveyorPorts, localPorts } from '../conveyor/ports'
import {
  liftLevelFingerprint,
  liftOpeningSpan,
  mastHeightM,
  resolveLift,
  resolveLiftLevels,
  riseM,
} from '../palletlift/levels'
import {
  doorFaceZ,
  doorWidthM,
  enclosureXZ,
  footprintM as liftFootprintM,
  mastEnvelopeHalfXM,
  mastPositionsXZ,
  mastSectionM,
  platformDepthM,
  platformWidthM,
  speedMps,
} from '../palletlift/metrics'
import { buildLiftCycle, cycleLength, stepAt } from '../palletlift/cycle'
import { buildPalletLiftFloorplan } from '../palletlift/floorplan'
import {
  allLevels,
  buildingOfLevel,
  DEFAULT_LEVEL_HEIGHT,
  getLevelFloorToFloorHeight,
  levelElevationsOfBuilding,
  levelsOfBuilding,
  parentLevelIdOf,
} from '../host-adapter'

const mockContext = {
  detail: 'full',
  viewMode: '2d',
  resolve: () => undefined,
} as unknown as GeometryContext

/**
 * Robust test scene generator for complex multi-storey buildings.
 */
function createCustomBuildingScene(
  levelsConfig: Array<{
    id: string
    ordinal: number
    height?: number
    baseElevation?: number
    name?: string
  }>,
  spiralConfig?: Partial<ConveyorSpiralNode>,
  liftConfig?: Partial<PalletLiftNode>,
  buildingId = 'bldg_main',
): Record<string, unknown> {
  const levelNodes: Record<string, unknown> = {}
  const levelIds = levelsConfig.map((l) => l.id)

  for (const cfg of levelsConfig) {
    levelNodes[cfg.id] = {
      id: cfg.id,
      type: 'level',
      level: cfg.ordinal,
      ...(cfg.height !== undefined ? { height: cfg.height } : {}),
      ...(cfg.baseElevation !== undefined ? { baseElevation: cfg.baseElevation } : {}),
      name: cfg.name ?? `Level ${cfg.ordinal}`,
      children: [],
    }
  }

  const scene: Record<string, unknown> = {
    [buildingId]: {
      id: buildingId,
      type: 'building',
      children: levelIds,
    },
    ...levelNodes,
  }

  if (spiralConfig) {
    const spiral = ConveyorSpiralNode.parse({
      id: 'conveyor-spiral_stress1',
      parentId: levelIds[0],
      ...spiralConfig,
    })
    scene['conveyor-spiral_stress1'] = spiral
  }

  if (liftConfig) {
    const lift = PalletLiftNode.parse({
      id: 'pallet-lift_stress1',
      parentId: levelIds[0],
      ...liftConfig,
    })
    scene['pallet-lift_stress1'] = lift
  }

  return scene
}

// ============================================================================
// 1. DYNAMIC LIVE STOREY MUTATIONS (STRESS SEQUENCES)
// ============================================================================

describe('Tier 5 Adversarial: Dynamic Live Storey Mutation Stress', () => {
  test('stress-tests 100 consecutive live floor height mutations in sequence', () => {
    let previousSpiralFp = ''
    let previousLiftFp = ''

    // Run 100 pseudo-random live edits simulating rapid user slider/handle manipulation
    for (let step = 0; step < 100; step++) {
      const h0 = 1.0 + ((step * 7) % 65) / 10 // 1.0m to 7.4m
      const h1 = 2.0 + ((step * 13) % 50) / 10 // 2.0m to 6.9m
      const h2 = 0.5 + ((step * 19) % 80) / 10 // 0.5m to 8.4m
      const baseElev1 = (step % 5 === 0) ? ((step % 20) / 10) : 0 // intermittent slab offsets

      const currentLevels = [
        { id: 'l0', ordinal: 0, height: h0 },
        { id: 'l1', ordinal: 1, height: h1, baseElevation: baseElev1 },
        { id: 'l2', ordinal: 2, height: h2 },
        { id: 'l3', ordinal: 3, height: 3.8 },
      ]

      const scene = createCustomBuildingScene(
        currentLevels,
        { fromLevelId: 'l0', toLevelId: 'l2' },
        { fromLevelId: 'l0', toLevelId: 'l3' },
      )

      const spiral = scene['conveyor-spiral_stress1'] as ConveyorSpiralNode
      const lift = scene['pallet-lift_stress1'] as PalletLiftNode

      // 1. Invariant: Spiral rise must equal exact cumulative distance between l0 and l2
      const expectedSpiralRise = h0 + baseElev1 + h1
      const actualSpiralRise = resolveSpiralRise(scene, spiral)
      expect(actualSpiralRise).toBeCloseTo(expectedSpiralRise, 5)

      // 2. Invariant: Spiral metrics must update deterministically and stay finite & positive
      const turns = turnCount(spiral, scene)
      const totalAngle = totalAngleRad(spiral, scene)
      const exitHeight = exitHeightM(spiral, scene)
      const overall = overallHeightM(spiral, scene)
      const arcLen = helixArcLengthM(spiral, scene)

      expect(Number.isFinite(turns)).toBe(true)
      expect(turns).toBeGreaterThan(0)
      expect(totalAngle).toBeCloseTo(turns * Math.PI * 2, 5)
      expect(exitHeight).toBeCloseTo(spiral.entryHeight + expectedSpiralRise, 5)
      expect(overall).toBeCloseTo(exitHeight + 0.3, 5)
      expect(arcLen).toBeGreaterThan(expectedSpiralRise)

      // 3. Invariant: Pallet lift resolved stops must match elevations exactly
      const resolvedLift = resolveLift(scene, lift)
      expect(resolvedLift.stops).toHaveLength(4)
      expect(resolvedLift.stops[0]?.baseY).toBe(0)
      expect(resolvedLift.stops[1]?.baseY).toBeCloseTo(h0 + baseElev1, 5)
      expect(resolvedLift.stops[2]?.baseY).toBeCloseTo(h0 + baseElev1 + h1, 5)
      expect(resolvedLift.stops[3]?.baseY).toBeCloseTo(h0 + baseElev1 + h1 + h2, 5)

      const expectedTotalRise = h0 + baseElev1 + h1 + h2
      expect(resolvedLift.mastHeight).toBeCloseTo(expectedTotalRise + 1.2, 5)

      // 4. Invariant: Fingerprints must change with mutations and never be empty
      const spiralFp = spiralLevelFingerprint(scene, spiral)
      const liftFp = liftLevelFingerprint(scene, lift)
      expect(spiralFp.length).toBeGreaterThan(10)
      expect(liftFp.length).toBeGreaterThan(10)

      if (step > 0) {
        expect(spiralFp).not.toBe(previousSpiralFp)
        expect(liftFp).not.toBe(previousLiftFp)
      }
      previousSpiralFp = spiralFp
      previousLiftFp = liftFp
    }
  })

  test('handles live deletion and insertion of intermediate levels dynamically', () => {
    // 3-level building
    const scene3 = createCustomBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 3.0 },
        { id: 'lvl1', ordinal: 1, height: 3.0 },
        { id: 'lvl2', ordinal: 2, height: 3.0 },
      ],
      { fromLevelId: 'lvl0', toLevelId: 'lvl2' },
      { fromLevelId: 'lvl0', toLevelId: 'lvl2' },
    )
    const spiral3 = scene3['conveyor-spiral_stress1'] as ConveyorSpiralNode
    const lift3 = scene3['pallet-lift_stress1'] as PalletLiftNode
    expect(resolveSpiralRise(scene3, spiral3)).toBeCloseTo(6.0, 5)
    expect(resolveLiftLevels(scene3, lift3)).toHaveLength(3)

    // Insert intermediate mezzanine floor lvl_mezz between lvl0 and lvl1
    const scene4 = createCustomBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 2.0 },
        { id: 'lvl_mezz', ordinal: 1, height: 1.5 },
        { id: 'lvl1', ordinal: 2, height: 3.0 },
        { id: 'lvl2', ordinal: 3, height: 3.0 },
      ],
      { fromLevelId: 'lvl0', toLevelId: 'lvl2' },
      { fromLevelId: 'lvl0', toLevelId: 'lvl2' },
    )
    const spiral4 = scene4['conveyor-spiral_stress1'] as ConveyorSpiralNode
    const lift4 = scene4['pallet-lift_stress1'] as PalletLiftNode
    // Total rise from lvl0 to lvl2 is now 2.0 + 1.5 + 3.0 = 6.5m
    expect(resolveSpiralRise(scene4, spiral4)).toBeCloseTo(6.5, 5)
    const liftStops = resolveLiftLevels(scene4, lift4)
    expect(liftStops).toHaveLength(4)
    expect(liftStops.map((s) => s.id)).toEqual(['lvl0', 'lvl_mezz', 'lvl1', 'lvl2'])
  })
})

// ============================================================================
// 2. INVERTED BOUNDS & MULTI-STOREY HOPS
// ============================================================================

describe('Tier 5 Adversarial: Inverted Bounds & Multi-Storey Hops', () => {
  test('handles 10-storey multi-floor vertical hops with intermediate stops', () => {
    // 10-storey high bay logistics tower (Storey 0 to 9, 3.5m each)
    const levels = Array.from({ length: 10 }, (_, i) => ({
      id: `floor_${i}`,
      ordinal: i,
      height: 3.5,
    }))

    // Equipment spanning from Floor 1 to Floor 7 (hopping 6 storeys, spanning 5 intermediate floors)
    const scene = createCustomBuildingScene(
      levels,
      { fromLevelId: 'floor_1', toLevelId: 'floor_7' },
      { fromLevelId: 'floor_1', toLevelId: 'floor_7', parentId: 'floor_1' },
    )

    const spiral = scene['conveyor-spiral_stress1'] as ConveyorSpiralNode
    const lift = scene['pallet-lift_stress1'] as PalletLiftNode

    // Total rise: 6 storeys * 3.5m = 21.0m
    const spiralRise = resolveSpiralRise(scene, spiral)
    expect(spiralRise).toBeCloseTo(21.0, 5)

    const liftData = resolvePalletLiftLevels(lift, scene)
    expect(liftData.servedLevels).toHaveLength(7) // floor_1 to floor_7
    expect(liftData.servedLevels[0]?.id).toBe('floor_1')
    expect(liftData.servedLevels[0]?.elevation).toBe(0) // re-based to parentId floor_1
    expect(liftData.servedLevels[6]?.id).toBe('floor_7')
    expect(liftData.servedLevels[6]?.elevation).toBeCloseTo(21.0, 5)
    expect(liftData.totalHeight).toBeCloseTo(21.0 + 1.2, 5)
  })

  test('strictly maintains correct stop ordering and positive rise under full inverted bounds', () => {
    const levels = [
      { id: 'floor_0', ordinal: 0, height: 4.0 },
      { id: 'floor_1', ordinal: 1, height: 3.5 },
      { id: 'floor_2', ordinal: 2, height: 3.0 },
      { id: 'floor_3', ordinal: 3, height: 5.0 },
    ]

    // Inverted bounds: from floor_3 down to floor_1
    const scene = createCustomBuildingScene(
      levels,
      { fromLevelId: 'floor_3', toLevelId: 'floor_1' },
      { fromLevelId: 'floor_3', toLevelId: 'floor_1', parentId: 'floor_0' },
    )

    const spiral = scene['conveyor-spiral_stress1'] as ConveyorSpiralNode
    const lift = scene['pallet-lift_stress1'] as PalletLiftNode

    // Distance between floor_1 (4.0m) and floor_3 (4.0 + 3.5 + 3.0 = 10.5m) is 6.5m
    expect(resolveSpiralRise(scene, spiral)).toBeCloseTo(6.5, 5)

    // Pallet lift must slice [floor_1, floor_2, floor_3] in ascending ordinal order
    const stops = resolveLiftLevels(scene, lift)
    expect(stops).toHaveLength(3)
    expect(stops[0]?.id).toBe('floor_1')
    expect(stops[1]?.id).toBe('floor_2')
    expect(stops[2]?.id).toBe('floor_3')
    expect(stops[0]!.baseY).toBeLessThan(stops[1]!.baseY)
    expect(stops[1]!.baseY).toBeLessThan(stops[2]!.baseY)

    // Opening span must strictly maintain bottom <= top
    const opening = liftOpeningSpan(scene, lift)
    expect(opening).not.toBeNull()
    expect(opening!.bottom).toBeLessThanOrEqual(opening!.top)
    expect(opening!.bottom).toBeCloseTo(4.0, 5)
    expect(opening!.top).toBeCloseTo(10.5, 5)
  })

  test('inverted bounds with topLevelId and baseLevelId aliases match from/to behaviour', () => {
    const levels = [
      { id: 'f0', ordinal: 0, height: 3.0 },
      { id: 'f1', ordinal: 1, height: 3.0 },
      { id: 'f2', ordinal: 2, height: 3.0 },
    ]
    const scene = createCustomBuildingScene(
      levels,
      { baseLevelId: 'f2', topLevelId: 'f0' },
      { baseLevelId: 'f2', topLevelId: 'f0', parentId: 'f0' },
    )
    const spiral = scene['conveyor-spiral_stress1'] as ConveyorSpiralNode
    const lift = scene['pallet-lift_stress1'] as PalletLiftNode

    expect(resolveSpiralRise(scene, spiral)).toBeCloseTo(6.0, 5)
    const stops = resolveLiftLevels(scene, lift)
    expect(stops).toHaveLength(3)
    expect(stops[0]?.id).toBe('f0')
    expect(stops[2]?.id).toBe('f2')
  })
})

// ============================================================================
// 3. UNANCHORED, CORRUPTED & DELETED LEVEL ID RESILIENCE
// ============================================================================

describe('Tier 5 Adversarial: Unanchored & Corrupted Level References', () => {
  test('gracefully handles non-existent or deleted level IDs without throwing', () => {
    const validLevels = [
      { id: 'valid_0', ordinal: 0, height: 3.0 },
      { id: 'valid_1', ordinal: 1, height: 3.0 },
    ]

    // Both IDs point to deleted/garbage UUIDs
    const sceneGarbage = createCustomBuildingScene(
      validLevels,
      { fromLevelId: 'deleted_uuid_1', toLevelId: 'deleted_uuid_2', travelHeight: 4.8 },
      { fromLevelId: 'deleted_uuid_1', toLevelId: 'deleted_uuid_2', fallbackTravelM: 5.2 },
    )

    const spiral = sceneGarbage['conveyor-spiral_stress1'] as ConveyorSpiralNode
    const lift = sceneGarbage['pallet-lift_stress1'] as PalletLiftNode

    // Spiral falls back to node.travelHeight
    expect(resolveSpiralRise(sceneGarbage, spiral)).toBe(4.8)
    expect(resolveSpiralHeight(spiral, sceneGarbage)).toBe(4.8)

    // Pallet lift falls back to synthetic 2-stop shaft
    const stops = resolveLiftLevels(sceneGarbage, lift)
    expect(stops).toHaveLength(2)
    expect(stops[0]?.id).toBe('valid_0') // parentId resolved to valid_0, but toLevelId is missing -> full building
    expect(stops[1]?.id).toBe('valid_1')
  })

  test('detached equipment with parentId=null produces safe isolated defaults', () => {
    const unanchoredSpiral = ConveyorSpiralNode.parse({
      id: 'conveyor-spiral_detached',
      parentId: null,
      fromLevelId: null,
      toLevelId: null,
      travelHeight: 4.5,
    })

    const unanchoredLift = PalletLiftNode.parse({
      id: 'pallet-lift_detached',
      parentId: null,
      fromLevelId: null,
      toLevelId: null,
      fallbackTravelM: 3.8,
    })

    const emptyScene = {}

    // Spiral
    expect(resolveSpiralRise(emptyScene, unanchoredSpiral)).toBe(4.5)
    expect(resolveSpiralBuildingLevels(emptyScene, unanchoredSpiral)).toEqual([])

    // Pallet Lift
    const liftStops = resolveLiftLevels(emptyScene, unanchoredLift)
    expect(liftStops).toHaveLength(2)
    expect(liftStops[0]?.id).toBe('__base')
    expect(liftStops[0]?.baseY).toBe(0)
    expect(liftStops[1]?.id).toBe('__top')
    expect(liftStops[1]?.baseY).toBe(3.8)

    // Crucial safety invariant: Detached equipment MUST NOT open holes in slabs
    expect(liftOpeningSpan(emptyScene, unanchoredLift)).toBeNull()
  })

  test('resilient to corrupted scene graphs with malformed or missing building properties', () => {
    const corruptedScene: Record<string, unknown> = {
      corrupted_building: {
        id: 'corrupted_building',
        type: 'building',
        // missing children array, corrupted types
        children: 'not_an_array',
      },
      corrupted_level: {
        id: 'corrupted_level',
        type: 'level',
        level: 'not_a_number',
        height: 'invalid_height',
      },
    }

    expect(levelsOfBuilding(corruptedScene, 'corrupted_building')).toEqual([])
    expect(levelElevationsOfBuilding(corruptedScene, 'corrupted_building')).toEqual([])
    expect(buildingOfLevel(corruptedScene, 'corrupted_level')).toBeNull()
    expect(getLevelFloorToFloorHeight(corruptedScene, 'corrupted_level')).toBe(DEFAULT_LEVEL_HEIGHT)
  })

  test('building with single level safely produces fallback shaft without crashing', () => {
    const sceneSingle = createCustomBuildingScene(
      [{ id: 'only_ground', ordinal: 0, height: 4.0 }],
      { travelHeight: 3.5 },
      { fallbackTravelM: 3.5, parentId: 'only_ground' },
    )

    const lift = sceneSingle['pallet-lift_stress1'] as PalletLiftNode
    const stops = resolveLiftLevels(sceneSingle, lift)
    expect(stops).toHaveLength(2)
    expect(stops[0]?.id).toBe('__base')
    expect(stops[1]?.id).toBe('__top')
    expect(stops[1]?.baseY).toBe(3.5)
    expect(mastHeightM(sceneSingle, lift)).toBeCloseTo(3.5 + 1.2, 5)
    expect(liftOpeningSpan(sceneSingle, lift)).toBeNull()
  })
})

// ============================================================================
// 4. NON-STANDARD STOREY ELEVATIONS (BASEMENTS & SUB-MILLIMETER OFFSETS)
// ============================================================================

describe('Tier 5 Adversarial: Non-Standard Elevations & Basements', () => {
  test('accurately calculates deep multi-level underground basements (negative elevations)', () => {
    // 5-level facility: Sub-basement 2 (-8m), Sub-basement 1 (-4m), Ground (0m), Floor 1 (+4m), Floor 2 (+8m)
    const levels = [
      { id: 'b2', ordinal: -2, height: 4.0, baseElevation: -8.0, name: 'Basement -2' },
      { id: 'b1', ordinal: -1, height: 4.0, name: 'Basement -1' },
      { id: 'g0', ordinal: 0, height: 4.0, name: 'Ground Floor' },
      { id: 'l1', ordinal: 1, height: 4.0, name: 'Level 1' },
      { id: 'l2', ordinal: 2, height: 4.0, name: 'Level 2' },
    ]

    const scene = createCustomBuildingScene(
      levels,
      { fromLevelId: 'b2', toLevelId: 'l2' },
      { fromLevelId: 'b2', toLevelId: 'l2', parentId: 'b2' },
    )

    const spiral = scene['conveyor-spiral_stress1'] as ConveyorSpiralNode
    const lift = scene['pallet-lift_stress1'] as PalletLiftNode

    // Total rise from B2 (-8.0m) to L2 (+8.0m) is 16.0m
    const elevations = levelElevationsOfBuilding(scene, 'bldg_main')
    expect(elevations[0]?.baseY).toBeCloseTo(-8.0, 5)
    expect(elevations[1]?.baseY).toBeCloseTo(-4.0, 5)
    expect(elevations[2]?.baseY).toBeCloseTo(0.0, 5)
    expect(elevations[3]?.baseY).toBeCloseTo(4.0, 5)
    expect(elevations[4]?.baseY).toBeCloseTo(8.0, 5)

    expect(resolveSpiralRise(scene, spiral)).toBeCloseTo(16.0, 5)

    const liftData = resolvePalletLiftLevels(lift, scene)
    expect(liftData.servedLevels).toHaveLength(5)
    expect(liftData.servedLevels[0]?.elevation).toBe(0) // relative to B2
    expect(liftData.servedLevels[1]?.elevation).toBeCloseTo(4.0, 5)
    expect(liftData.servedLevels[2]?.elevation).toBeCloseTo(8.0, 5)
    expect(liftData.servedLevels[3]?.elevation).toBeCloseTo(12.0, 5)
    expect(liftData.servedLevels[4]?.elevation).toBeCloseTo(16.0, 5)
    expect(liftData.totalHeight).toBeCloseTo(16.0 + 1.2, 5)
  })

  test('handles fractional sub-millimeter offsets and zero-height storeys without numeric drift', () => {
    const levels = [
      { id: 'lvl0', ordinal: 0, height: 3.12345 },
      { id: 'lvl_zero', ordinal: 1, height: 0.0 },
      { id: 'lvl_micro', ordinal: 2, height: 0.0005, baseElevation: 0.0002 },
      { id: 'lvl3', ordinal: 3, height: 4.87655 },
    ]

    const scene = createCustomBuildingScene(
      levels,
      { fromLevelId: 'lvl0', toLevelId: 'lvl3' },
      { fromLevelId: 'lvl0', toLevelId: 'lvl3', parentId: 'lvl0' },
    )

    const spiral = scene['conveyor-spiral_stress1'] as ConveyorSpiralNode
    const lift = scene['pallet-lift_stress1'] as PalletLiftNode

    // Total distance from lvl0 (0) to lvl3 (3.12345 + 0 + 0.0002 + 0.0005 = 3.12415)
    const rise = resolveSpiralRise(scene, spiral)
    expect(rise).toBeCloseTo(3.12415, 5)

    const stops = resolveLiftLevels(scene, lift)
    expect(stops).toHaveLength(4)
    expect(stops[0]?.baseY).toBe(0)
    expect(stops[1]?.baseY).toBeCloseTo(3.12345, 5)
    expect(stops[2]?.baseY).toBeCloseTo(3.12365, 5)
    expect(stops[3]?.baseY).toBeCloseTo(3.12415, 5)
  })
})

// ============================================================================
// 5. DUTY CYCLE & SAFETY INVARIANTS
// ============================================================================

describe('Tier 5 Adversarial: State Machine Duty Cycle & Safety Invariants', () => {
  test('verifies strict door interlocking invariant across 8-stop non-uniform building', () => {
    const stops = [
      { baseY: 0 },
      { baseY: 3.2 },
      { baseY: 7.5 },
      { baseY: 11.0 },
      { baseY: 14.8 },
      { baseY: 19.2 },
      { baseY: 23.5 },
      { baseY: 28.0 },
    ]
    const speed = { mpm: 36 } // 0.6 m/s

    const steps = buildLiftCycle(stops, speed)
    expect(steps.length).toBeGreaterThan(20)

    // Verify critical safety invariants:
    // 1. Whenever doorOpen === 1, platform MUST be exactly at stops[doorStopIndex].baseY
    // 2. Whenever phase === 'travel', doorOpen MUST be 0 and durationS > 0
    for (const step of steps) {
      if (step.doorOpen === 1) {
        expect(step.doorStopIndex).not.toBeNull()
        const targetStop = stops[step.doorStopIndex!]
        expect(targetStop).toBeDefined()
        expect(step.platformY).toBeCloseTo(targetStop!.baseY, 6)
      } else {
        expect(step.phase).toBe('travel')
        expect(step.doorStopIndex).toBeNull()
        expect(step.durationS).toBeGreaterThan(0)
      }
    }

    // Verify cycle timeline continuity
    const totalDuration = cycleLength(steps)
    expect(totalDuration).toBeGreaterThan(0)

    // Sample stepAt at 50 points throughout the cycle
    for (let i = 0; i <= 50; i++) {
      const t = (i / 50) * totalDuration
      const lookup = stepAt(steps, t)
      expect(lookup).not.toBeNull()
      expect(lookup!.localT).toBeGreaterThanOrEqual(0)
      expect(lookup!.localT).toBeLessThanOrEqual(1)
    }
  })
})

// ============================================================================
// 6. 2D & 3D GEOMETRIC CLEARANCE & BOUNDING INVARIANTS
// ============================================================================

describe('Tier 5 Adversarial: 2D & 3D Geometric Invariants & Clearances', () => {
  test('spiral slat chain maintains strictly positive radial clearance from central column', () => {
    // Test across various diameters and belt widths
    const testConfigs: Array<Partial<ConveyorSpiralNode>> = [
      { outerDiameter: '1200', beltWidth: '400', travelHeight: 3.0 },
      { outerDiameter: '1800', beltWidth: '500', travelHeight: 6.0 },
      { outerDiameter: '2400', beltWidth: '650', travelHeight: 12.0 },
    ]

    for (const cfg of testConfigs) {
      const node = ConveyorSpiralNode.parse({
        id: 'conveyor-spiral_clearance_test',
        ...cfg,
      })

      const colR = columnRadiusM(node)
      const helixR = helixRadiusM(node)
      const beltW = beltWidthM(node)
      const slatInnerR = helixR - beltW / 2
      const slatOuterR = slatOuterRadiusM(node)
      const handrailR = handrailRadiusM(node)
      const legR = legRadiusM(node)
      const cageR = cageRadiusM(node)

      // Invariant: Column < Slat Inner < Helix < Slat Outer < Handrail < Leg < Cage
      expect(colR).toBeLessThan(slatInnerR - 0.04) // at least 4cm gap
      expect(slatInnerR).toBeLessThan(helixR)
      expect(helixR).toBeLessThan(slatOuterR)
      expect(slatOuterR).toBeLessThan(handrailR)
      expect(handrailR).toBeLessThan(legR)
      expect(legR).toBeLessThan(cageR)

      // Test generated 3D slat parts
      const slats = spiralSlatParts(node, 'full', node.travelHeight)
      expect(slats.length).toBeGreaterThan(10)
      for (const slat of slats) {
        expect(Number.isFinite(slat.center[0])).toBe(true)
        expect(Number.isFinite(slat.center[1])).toBe(true)
        expect(Number.isFinite(slat.center[2])).toBe(true)
      }
    }
  })

  test('pallet lift mast columns stay strictly outside platform bounding envelope', () => {
    const capacities: Array<PalletLiftNode['capacityClass']> = ['1000', '1500', '4500']
    const mastConfigs: Array<PalletLiftNode['mastCount']> = ['2', '4']

    for (const cap of capacities) {
      for (const masts of mastConfigs) {
        const node = PalletLiftNode.parse({
          id: 'pallet-lift_clearance_test',
          capacityClass: cap,
          mastCount: masts,
        })

        const platW = platformWidthM(node)
        const platD = platformDepthM(node)
        const halfPlatX = platW / 2
        const halfPlatZ = platD / 2
        const section = mastSectionM(node)
        const positions = mastPositionsXZ(node)

        expect(positions.length).toBe(Number(masts))

        for (const [mx, mz] of positions) {
          // Mast inner edge in X: |mx| - section / 2
          const mastInnerX = Math.abs(mx) - section / 2
          // Invariant: Mast inner edge must be strictly greater than platform half width
          expect(mastInnerX).toBeGreaterThanOrEqual(halfPlatX)
        }
      }
    }
  })

  test('2D floorplan root transforms preserve exact world placement under extreme coordinates', () => {
    const extremeSpiral = ConveyorSpiralNode.parse({
      id: 'conveyor-spiral_geo_extreme',
      position: [99999.5, 0, -88888.75],
      rotation: [0, Math.PI / 3, 0],
    })

    const spiralFloorplan = buildSpiralFloorplan(extremeSpiral, mockContext) as {
      transform?: { translate?: [number, number]; rotate?: number }
    }
    expect(spiralFloorplan.transform?.translate).toEqual([99999.5, -88888.75])
    expect(spiralFloorplan.transform?.rotate).toBeCloseTo(-Math.PI / 3, 6)

    const extremeLift = PalletLiftNode.parse({
      id: 'pallet-lift_geo_extreme',
      position: [-54321.12, 0, 12345.67],
      rotation: [0, -1.85, 0],
    })

    const liftFloorplan = buildPalletLiftFloorplan(extremeLift, mockContext) as {
      transform?: { translate?: [number, number]; rotate?: number }
    }
    expect(liftFloorplan.transform?.translate).toEqual([-54321.12, 12345.67])
    expect(liftFloorplan.transform?.rotate).toBeCloseTo(1.85, 6)
  })
})

// ============================================================================
// 7. CROSS-BUILDING & UNSORTED HIERARCHY RESILIENCE
// ============================================================================

describe('Tier 5 Adversarial: Cross-Building & Unsorted Hierarchy Resilience', () => {
  test('scene graph with scrambled children order is strictly sorted by level ordinal', () => {
    // Scene with children listed in reverse/random order in building node
    const scrambledScene = {
      bldg_scrambled: {
        id: 'bldg_scrambled',
        type: 'building',
        children: ['lvl_top', 'lvl_bottom', 'lvl_mid2', 'lvl_mid1'],
      },
      lvl_top: { id: 'lvl_top', type: 'level', level: 3, height: 3.0 },
      lvl_bottom: { id: 'lvl_bottom', type: 'level', level: 0, height: 4.0 },
      lvl_mid2: { id: 'lvl_mid2', type: 'level', level: 2, height: 3.5 },
      lvl_mid1: { id: 'lvl_mid1', type: 'level', level: 1, height: 3.2 },
    }

    const sortedLevels = levelsOfBuilding(scrambledScene, 'bldg_scrambled')
    expect(sortedLevels.map((l) => l.id)).toEqual(['lvl_bottom', 'lvl_mid1', 'lvl_mid2', 'lvl_top'])
    expect(sortedLevels.map((l) => l.level)).toEqual([0, 1, 2, 3])

    const elevations = levelElevationsOfBuilding(scrambledScene, 'bldg_scrambled')
    expect(elevations[0]?.id).toBe('lvl_bottom')
    expect(elevations[0]?.baseY).toBe(0)
    expect(elevations[1]?.id).toBe('lvl_mid1')
    expect(elevations[1]?.baseY).toBeCloseTo(4.0, 5)
    expect(elevations[2]?.id).toBe('lvl_mid2')
    expect(elevations[2]?.baseY).toBeCloseTo(7.2, 5)
    expect(elevations[3]?.id).toBe('lvl_top')
    expect(elevations[3]?.baseY).toBeCloseTo(10.7, 5)
  })

  test('multi-building isolation: equipment only reads storeys from its container building', () => {
    const multiBuildingScene = {
      building_A: {
        id: 'building_A',
        type: 'building',
        children: ['bA_l0', 'bA_l1'],
      },
      building_B: {
        id: 'building_B',
        type: 'building',
        children: ['bB_l0', 'bB_l1', 'bB_l2'],
      },
      bA_l0: { id: 'bA_l0', type: 'level', level: 0, height: 5.0 },
      bA_l1: { id: 'bA_l1', type: 'level', level: 1, height: 5.0 },
      bB_l0: { id: 'bB_l0', type: 'level', level: 0, height: 3.0 },
      bB_l1: { id: 'bB_l1', type: 'level', level: 1, height: 3.0 },
      bB_l2: { id: 'bB_l2', type: 'level', level: 2, height: 3.0 },
      'conveyor-spiral_bldgB': ConveyorSpiralNode.parse({
        id: 'conveyor-spiral_bldgB',
        parentId: 'bB_l0',
        fromLevelId: 'bB_l0',
        toLevelId: 'bB_l2',
      }),
      'pallet-lift_bldgA': PalletLiftNode.parse({
        id: 'pallet-lift_bldgA',
        parentId: 'bA_l0',
        fromLevelId: 'bA_l0',
        toLevelId: 'bA_l1',
      }),
    }

    const spiralB = multiBuildingScene['conveyor-spiral_bldgB'] as ConveyorSpiralNode
    const liftA = multiBuildingScene['pallet-lift_bldgA'] as PalletLiftNode

    // Spiral in Building B spans 3.0 + 3.0 = 6.0m
    expect(resolveSpiralRise(multiBuildingScene, spiralB)).toBeCloseTo(6.0, 5)
    expect(resolveSpiralBuildingLevels(multiBuildingScene, spiralB).map((l) => l.id)).toEqual([
      'bB_l0',
      'bB_l1',
      'bB_l2',
    ])

    // Pallet Lift in Building A spans 5.0m
    const liftStops = resolveLiftLevels(multiBuildingScene, liftA)
    expect(liftStops).toHaveLength(2)
    expect(liftStops.map((s) => s.id)).toEqual(['bA_l0', 'bA_l1'])
    expect(liftStops[1]?.baseY).toBeCloseTo(5.0, 5)
  })
})

// ============================================================================
// 8. 3D GEOMETRY TANGENT & PORT KINEMATICS SYNCHRONIZATION
// ============================================================================

describe('Tier 5 Adversarial: 3D Port Kinematics Synchronization', () => {
  test('dynamic level height updates synchronously adjust 3D port positions and exit angles', () => {
    // 2-storey scene at 3.5m height
    const scene1 = createCustomBuildingScene(
      [
        { id: 'f0', ordinal: 0, height: 3.5 },
        { id: 'f1', ordinal: 1, height: 3.5 },
      ],
      {
        fromLevelId: 'f0',
        toLevelId: 'f1',
        position: [10, 0, 20],
        rotation: [0, 0, 0],
        entryHeight: 0.75,
        travelHeight: 3.5,
      },
    )

    const spiral1 = scene1['conveyor-spiral_stress1'] as ConveyorSpiralNode
    const ports1 = conveyorPorts(spiral1)
    const portA1 = ports1.find((p) => p.id === 'a')!
    const portB1 = ports1.find((p) => p.id === 'b')!

    expect(portA1).toBeDefined()
    expect(portB1).toBeDefined()
    expect(portA1.position[1]).toBeCloseTo(0.75, 5)
    expect(portB1.position[1]).toBeCloseTo(0.75 + 3.5, 5)

    // Verify dynamic resolution via exitHeightM(spiral, scene)
    expect(exitHeightM(spiral1, scene1)).toBeCloseTo(0.75 + 3.5, 5)

    // Verify exit port alignment at outer tangent tip in world coordinates
    const thetaExit = exitAngleRad(spiral1, scene1)
    const span = portSpanM(spiral1)
    const expectedWorldPortBX = 10 + span * Math.cos(thetaExit)
    const expectedWorldPortBZ = 20 + span * Math.sin(thetaExit)
    expect(portB1.position[0]).toBeCloseTo(expectedWorldPortBX, 5)
    expect(portB1.position[2]).toBeCloseTo(expectedWorldPortBZ, 5)

    // User updates Floor 0 height to 6.8m
    const scene2 = createCustomBuildingScene(
      [
        { id: 'f0', ordinal: 0, height: 6.8 },
        { id: 'f1', ordinal: 1, height: 3.5 },
      ],
      {
        fromLevelId: 'f0',
        toLevelId: 'f1',
        position: [10, 0, 20],
        rotation: [0, 0, 0],
        entryHeight: 0.75,
        travelHeight: 6.8,
      },
    )

    const spiral2 = scene2['conveyor-spiral_stress1'] as ConveyorSpiralNode
    expect(exitHeightM(spiral2, scene2)).toBeCloseTo(0.75 + 6.8, 5)

    const ports2 = conveyorPorts(spiral2)
    const portB2 = ports2.find((p) => p.id === 'b')!

    expect(portB2.position[1]).toBeCloseTo(0.75 + 6.8, 5)
  })
})

// ============================================================================
// 9. EXTREME SCALE 25-STOREY HIGH-RISE STRESS
// ============================================================================

describe('Tier 5 Adversarial: Extreme Scale 25-Storey High-Rise Stress', () => {
  test('stress-tests 25-storey high-rise with non-uniform storeys and sub-spans', () => {
    // 25 storeys with alternating floor heights from 2.8m to 6.2m
    const levels = Array.from({ length: 25 }, (_, i) => ({
      id: `storey_${i}`,
      ordinal: i,
      height: 2.8 + ((i * 3) % 35) / 10, // 2.8m to 6.2m
      name: `Storey ${i}`,
    }))

    const scene = createCustomBuildingScene(
      levels,
      { fromLevelId: 'storey_3', toLevelId: 'storey_21' },
      { fromLevelId: 'storey_3', toLevelId: 'storey_21', parentId: 'storey_3' },
    )

    const spiral = scene['conveyor-spiral_stress1'] as ConveyorSpiralNode
    const lift = scene['pallet-lift_stress1'] as PalletLiftNode

    // Cumulative height between storey_3 and storey_21
    let expectedRise = 0
    for (let i = 3; i < 21; i++) {
      expectedRise += levels[i]!.height
    }

    const actualSpiralRise = resolveSpiralRise(scene, spiral)
    expect(actualSpiralRise).toBeCloseTo(expectedRise, 5)

    const liftData = resolvePalletLiftLevels(lift, scene)
    expect(liftData.servedLevels).toHaveLength(19) // storey_3 through storey_21 inclusive
    expect(liftData.servedLevels[0]?.id).toBe('storey_3')
    expect(liftData.servedLevels[0]?.elevation).toBe(0)
    expect(liftData.servedLevels[18]?.id).toBe('storey_21')
    expect(liftData.servedLevels[18]?.elevation).toBeCloseTo(expectedRise, 5)
    expect(liftData.totalHeight).toBeCloseTo(expectedRise + 1.2, 5)
  })
})

// ============================================================================
// 10. INVERTED BOUNDS LIVE DYNAMIC MUTATION FUZZING
// ============================================================================

describe('Tier 5 Adversarial: Inverted Bounds Live Dynamic Mutation Fuzzing', () => {
  test('fuzzes 50 sequential live floor mutations on inverted bounds (top to bottom)', () => {
    for (let iter = 0; iter < 50; iter++) {
      const h0 = 2.0 + (iter % 7) * 0.5
      const h1 = 3.0 + (iter % 5) * 0.4
      const h2 = 4.0 + (iter % 9) * 0.3
      const h3 = 2.5 + (iter % 4) * 0.6
      const h4 = 3.5 + (iter % 6) * 0.5

      const currentLevels = [
        { id: 'f0', ordinal: 0, height: h0 },
        { id: 'f1', ordinal: 1, height: h1 },
        { id: 'f2', ordinal: 2, height: h2 },
        { id: 'f3', ordinal: 3, height: h3 },
        { id: 'f4', ordinal: 4, height: h4 },
      ]

      // Inverted bounds: from f4 down to f1
      const scene = createCustomBuildingScene(
        currentLevels,
        { fromLevelId: 'f4', toLevelId: 'f1' },
        { fromLevelId: 'f4', toLevelId: 'f1', parentId: 'f0' },
      )

      const spiral = scene['conveyor-spiral_stress1'] as ConveyorSpiralNode
      const lift = scene['pallet-lift_stress1'] as PalletLiftNode

      // Expected distance between f1 and f4: h1 + h2 + h3
      const expectedSpan = h1 + h2 + h3
      expect(resolveSpiralRise(scene, spiral)).toBeCloseTo(expectedSpan, 5)

      const stops = resolveLiftLevels(scene, lift)
      expect(stops).toHaveLength(4) // f1, f2, f3, f4
      expect(stops[0]?.id).toBe('f1')
      expect(stops[3]?.id).toBe('f4')
      expect(stops[3]!.baseY - stops[0]!.baseY).toBeCloseTo(expectedSpan, 5)

      // Invariant: stops must remain strictly strictly increasing
      for (let s = 1; s < stops.length; s++) {
        expect(stops[s]!.baseY).toBeGreaterThan(stops[s - 1]!.baseY)
      }
    }
  })
})

// ============================================================================
// 11. CROSS-BUILDING MISMATCHED LEVEL IDS FALLBACK
// ============================================================================

describe('Tier 5 Adversarial: Cross-Building Mismatched Level IDs Fallback', () => {
  test('gracefully falls back when fromLevelId and toLevelId belong to different buildings', () => {
    const multiBuildingScene: Record<string, unknown> = {
      bldg_alpha: {
        id: 'bldg_alpha',
        type: 'building',
        children: ['alpha_0', 'alpha_1'],
      },
      bldg_beta: {
        id: 'bldg_beta',
        type: 'building',
        children: ['beta_0', 'beta_1'],
      },
      alpha_0: { id: 'alpha_0', type: 'level', level: 0, height: 4.0 },
      alpha_1: { id: 'alpha_1', type: 'level', level: 1, height: 4.0 },
      beta_0: { id: 'beta_0', type: 'level', level: 0, height: 3.5 },
      beta_1: { id: 'beta_1', type: 'level', level: 1, height: 3.5 },
      'conveyor-spiral_cross': ConveyorSpiralNode.parse({
        id: 'conveyor-spiral_cross',
        parentId: 'alpha_0',
        fromLevelId: 'alpha_0', // Building Alpha
        toLevelId: 'beta_1',   // Building Beta (mismatched!)
        travelHeight: 4.25,
      }),
      'pallet-lift_cross': PalletLiftNode.parse({
        id: 'pallet-lift_cross',
        parentId: 'alpha_0',
        fromLevelId: 'alpha_0',
        toLevelId: 'beta_1',
        fallbackTravelM: 5.5,
      }),
    }

    const spiral = multiBuildingScene['conveyor-spiral_cross'] as ConveyorSpiralNode
    const lift = multiBuildingScene['pallet-lift_cross'] as PalletLiftNode

    // Spiral should safely fall back to its internal travelHeight
    expect(resolveSpiralRise(multiBuildingScene, spiral)).toBe(4.25)
    expect(resolveSpiralHeight(spiral, multiBuildingScene)).toBe(4.25)

    // Pallet lift should fall back to valid stops within its own building alpha
    const liftStops = resolveLiftLevels(multiBuildingScene, lift)
    expect(liftStops).toHaveLength(2)
    expect(liftStops[0]?.id).toBe('alpha_0')
    expect(liftStops[1]?.id).toBe('alpha_1')
    expect(liftStops[1]?.baseY).toBeCloseTo(4.0, 5)
  })
})

// ============================================================================
// 12. ZERO & SUB-MILLIMETER EXTREME FLOATING POINT INVARIANCE
// ============================================================================

describe('Tier 5 Adversarial: Zero & Sub-Millimeter Extreme Invariance', () => {
  test('handles stack with multiple zero-height storeys without NaN or infinite recursion', () => {
    const zeroLevels = [
      { id: 'z0', ordinal: 0, height: 3.0 },
      { id: 'z1', ordinal: 1, height: 0.0 },
      { id: 'z2', ordinal: 2, height: 0.0 },
      { id: 'z3', ordinal: 3, height: 3.0 },
    ]

    const scene = createCustomBuildingScene(
      zeroLevels,
      { fromLevelId: 'z0', toLevelId: 'z3' },
      { fromLevelId: 'z0', toLevelId: 'z3', parentId: 'z0' },
    )

    const spiral = scene['conveyor-spiral_stress1'] as ConveyorSpiralNode
    const lift = scene['pallet-lift_stress1'] as PalletLiftNode

    // Floor of z0 is at 0m. Floor of z3 is at 3.0 + 0 + 0 = 3.0m.
    expect(resolveSpiralRise(scene, spiral)).toBeCloseTo(3.0, 5)

    const liftData = resolvePalletLiftLevels(lift, scene)
    expect(liftData.servedLevels).toHaveLength(4)
    expect(liftData.servedLevels[0]?.elevation).toBe(0)
    expect(liftData.servedLevels[1]?.elevation).toBeCloseTo(3.0, 5)
    expect(liftData.servedLevels[2]?.elevation).toBeCloseTo(3.0, 5)
    expect(liftData.servedLevels[3]?.elevation).toBeCloseTo(3.0, 5)
    expect(liftData.totalHeight).toBeCloseTo(3.0 + 1.2, 5)
  })
})


