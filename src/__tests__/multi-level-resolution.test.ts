import { describe, expect, test } from 'bun:test'
import {
  exitHeightM,
  helixArcLengthM,
  overallHeightM,
  totalAngleRad,
  turnCount,
} from '../conveyor/spiral-metrics'
import { getLevelFloorToFloorHeight, levelElevationsOfBuilding } from '../host-adapter'
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

/**
 * Test scene builder containing a building with configurable levels.
 */
function createBuildingScene(
  levelsConfig: Array<{
    id: string
    ordinal: number
    height: number
    baseElevation?: number
  }>,
  spiralOverrides: Record<string, unknown> = {},
  liftOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const levelNodes: Record<string, unknown> = {}
  const levelIds = levelsConfig.map((l) => l.id)

  for (const cfg of levelsConfig) {
    levelNodes[cfg.id] = {
      id: cfg.id,
      type: 'level',
      level: cfg.ordinal,
      height: cfg.height,
      baseElevation: cfg.baseElevation ?? 0,
      name: `Storey ${cfg.ordinal}`,
      children: [],
    }
  }

  const spiral = ConveyorSpiralNode.parse({
    id: 'conveyor-spiral_test1',
    parentId: levelIds[0],
    ...spiralOverrides,
  })

  const lift = PalletLiftNode.parse({
    id: 'pallet-lift_test1',
    parentId: levelIds[0],
    ...liftOverrides,
  })

  return {
    building_1: {
      id: 'building_1',
      type: 'building',
      children: levelIds,
    },
    ...levelNodes,
    'conveyor-spiral_test1': spiral,
    'pallet-lift_test1': lift,
  }
}

// ── 1. Schema Validation & Aliases ──────────────────────────────────────────

describe('Multi-Level Schema & Field Aliases', () => {
  test('ConveyorSpiralNode validates and supports fromLevelId and toLevelId', () => {
    const node = ConveyorSpiralNode.parse({
      fromLevelId: 'level_0',
      toLevelId: 'level_1',
    })
    expect(node.fromLevelId).toBe('level_0')
    expect(node.toLevelId).toBe('level_1')
    expect(node.baseLevelId).toBeNull()
    expect(node.topLevelId).toBeNull()
  })

  test('ConveyorSpiralNode supports baseLevelId and topLevelId aliases', () => {
    const node = ConveyorSpiralNode.parse({
      baseLevelId: 'level_0',
      topLevelId: 'level_2',
    })
    expect(node.baseLevelId).toBe('level_0')
    expect(node.topLevelId).toBe('level_2')
  })

  test('PalletLiftNode validates and supports fromLevelId, toLevelId and aliases', () => {
    const node = PalletLiftNode.parse({
      fromLevelId: 'level_0',
      toLevelId: 'level_3',
      baseLevelId: 'level_0',
      topLevelId: 'level_3',
      defaultLevelId: 'level_0',
      disabledLevelIds: ['level_2'],
      serviceOnlyLevelIds: ['level_1'],
    })
    expect(node.fromLevelId).toBe('level_0')
    expect(node.toLevelId).toBe('level_3')
    expect(node.baseLevelId).toBe('level_0')
    expect(node.topLevelId).toBe('level_3')
    expect(node.defaultLevelId).toBe('level_0')
    expect(node.disabledLevelIds).toEqual(['level_2'])
    expect(node.serviceOnlyLevelIds).toEqual(['level_1'])
  })

  test('ConveyorSpiralNode and PalletLiftNode default values on clean parse', () => {
    const spiral = ConveyorSpiralNode.parse({})
    expect(spiral.fromLevelId).toBeNull()
    expect(spiral.toLevelId).toBeNull()
    expect(spiral.baseLevelId).toBeNull()
    expect(spiral.topLevelId).toBeNull()
    expect(spiral.travelHeight).toBe(4)

    const lift = PalletLiftNode.parse({})
    expect(lift.fromLevelId).toBeNull()
    expect(lift.toLevelId).toBeNull()
    expect(lift.baseLevelId).toBeNull()
    expect(lift.topLevelId).toBeNull()
    expect(lift.fallbackTravelM).toBe(3)
    expect(lift.disabledLevelIds).toEqual([])
    expect(lift.serviceOnlyLevelIds).toEqual([])
  })
})

// ── 2. Dynamic Height Resolution for Spiral Conveyor ────────────────────────

describe('Spiral Conveyor Dynamic Height & Rise Resolution', () => {
  test('modifying floor heights dynamically recalculates spiral rise across single storey', () => {
    // Initial scene: Floor 0 is 3.0 m tall
    const scene1 = createBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 3.0 },
        { id: 'lvl1', ordinal: 1, height: 3.0 },
      ],
      { fromLevelId: 'lvl0', toLevelId: 'lvl1' },
    )
    const spiralNode1 = scene1['conveyor-spiral_test1'] as ConveyorSpiralNode

    expect(resolveSpiralRise(scene1, spiralNode1)).toBeCloseTo(3.0, 5)
    expect(resolveSpiralHeight(spiralNode1, scene1)).toBeCloseTo(3.0, 5)

    // User edits Floor 0 height in building to 4.5 m
    const scene2 = createBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 4.5 },
        { id: 'lvl1', ordinal: 1, height: 3.0 },
      ],
      { fromLevelId: 'lvl0', toLevelId: 'lvl1' },
    )
    const spiralNode2 = scene2['conveyor-spiral_test1'] as ConveyorSpiralNode

    expect(resolveSpiralRise(scene2, spiralNode2)).toBeCloseTo(4.5, 5)
    expect(resolveSpiralHeight(spiralNode2, scene2)).toBeCloseTo(4.5, 5)

    // User edits Floor 0 height to 6.2 m
    const scene3 = createBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 6.2 },
        { id: 'lvl1', ordinal: 1, height: 3.0 },
      ],
      { fromLevelId: 'lvl0', toLevelId: 'lvl1' },
    )
    const spiralNode3 = scene3['conveyor-spiral_test1'] as ConveyorSpiralNode

    expect(resolveSpiralRise(scene3, spiralNode3)).toBeCloseTo(6.2, 5)
  })

  test('dynamically recalculates spiral rise across multiple storeys', () => {
    // 3 storeys: lvl0 (3.5m), lvl1 (4.0m), lvl2 (3.0m)
    const scene = createBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 3.5 },
        { id: 'lvl1', ordinal: 1, height: 4.0 },
        { id: 'lvl2', ordinal: 2, height: 3.0 },
      ],
      { fromLevelId: 'lvl0', toLevelId: 'lvl2' },
    )
    const spiral = scene['conveyor-spiral_test1'] as ConveyorSpiralNode

    // Total rise should be 3.5 + 4.0 = 7.5 m
    expect(resolveSpiralRise(scene, spiral)).toBeCloseTo(7.5, 5)

    // Modify lvl1 height to 5.2 m -> new rise should be 3.5 + 5.2 = 8.7 m
    const modifiedScene = createBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 3.5 },
        { id: 'lvl1', ordinal: 1, height: 5.2 },
        { id: 'lvl2', ordinal: 2, height: 3.0 },
      ],
      { fromLevelId: 'lvl0', toLevelId: 'lvl2' },
    )
    const modifiedSpiral = modifiedScene['conveyor-spiral_test1'] as ConveyorSpiralNode

    expect(resolveSpiralRise(modifiedScene, modifiedSpiral)).toBeCloseTo(8.7, 5)
  })

  test('resolves rise with baseLevelId and topLevelId aliases', () => {
    const scene = createBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 3.8 },
        { id: 'lvl1', ordinal: 1, height: 3.2 },
      ],
      { baseLevelId: 'lvl0', topLevelId: 'lvl1' },
    )
    const spiral = scene['conveyor-spiral_test1'] as ConveyorSpiralNode

    expect(resolveSpiralRise(scene, spiral)).toBeCloseTo(3.8, 5)
  })

  test('resolves rise using parentId when fromLevelId is omitted', () => {
    const scene = createBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 4.2 },
        { id: 'lvl1', ordinal: 1, height: 3.0 },
      ],
      { parentId: 'lvl0', toLevelId: 'lvl1' },
    )
    const spiral = scene['conveyor-spiral_test1'] as ConveyorSpiralNode

    expect(resolveSpiralRise(scene, spiral)).toBeCloseTo(4.2, 5)
  })

  test('handles inverted level bounds safely via absolute delta', () => {
    const scene = createBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 3.0 },
        { id: 'lvl1', ordinal: 1, height: 4.0 },
      ],
      { fromLevelId: 'lvl1', toLevelId: 'lvl0' },
    )
    const spiral = scene['conveyor-spiral_test1'] as ConveyorSpiralNode

    expect(resolveSpiralRise(scene, spiral)).toBeCloseTo(3.0, 5)
  })

  test('correctly accounts for additive baseElevation offsets in building storeys', () => {
    // lvl0 height = 4.0, lvl1 baseElevation = 0.8, height = 3.0
    // lvl0 baseY = 0, lvl1 baseY = 4.0 + 0.8 = 4.8, lvl2 baseY = 4.8 + 3.0 = 7.8
    const scene1 = createBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 4.0 },
        { id: 'lvl1', ordinal: 1, height: 3.0, baseElevation: 0.8 },
        { id: 'lvl2', ordinal: 2, height: 3.0 },
      ],
      { fromLevelId: 'lvl0', toLevelId: 'lvl1' },
    )
    const spiral1 = scene1['conveyor-spiral_test1'] as ConveyorSpiralNode
    expect(resolveSpiralRise(scene1, spiral1)).toBeCloseTo(4.8, 5)

    // Changing baseElevation of lvl1 to 1.5 -> rise becomes 4.0 + 1.5 = 5.5
    const scene2 = createBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 4.0 },
        { id: 'lvl1', ordinal: 1, height: 3.0, baseElevation: 1.5 },
        { id: 'lvl2', ordinal: 2, height: 3.0 },
      ],
      { fromLevelId: 'lvl0', toLevelId: 'lvl1' },
    )
    const spiral2 = scene2['conveyor-spiral_test1'] as ConveyorSpiralNode
    expect(resolveSpiralRise(scene2, spiral2)).toBeCloseTo(5.5, 5)
  })

  test('gracefully falls back to travelHeight when level IDs are not specified or unresolvable', () => {
    // No level IDs set
    const scene = createBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 3.0 },
        { id: 'lvl1', ordinal: 1, height: 3.0 },
      ],
      { travelHeight: 5.5 },
    )
    const spiral = scene['conveyor-spiral_test1'] as ConveyorSpiralNode
    expect(resolveSpiralRise(scene, spiral)).toBe(5.5)

    // Non-existent level IDs
    const unlinkedSpiral = ConveyorSpiralNode.parse({
      id: 'conveyor-spiral_unlinked',
      fromLevelId: 'non_existent_1',
      toLevelId: 'non_existent_2',
      travelHeight: 6.0,
    })
    expect(resolveSpiralRise(scene, unlinkedSpiral)).toBe(6.0)

    // Detached / no nodes scene
    expect(resolveSpiralHeight(spiral)).toBe(5.5)
  })
})

// ── 3. Spiral Metric Calculations Reactivity ────────────────────────────────

describe('Spiral Conveyor Metrics Dynamic Calculations', () => {
  test('turnCount, totalAngleRad and exitHeight dynamically update with storey height', () => {
    const scene1 = createBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 3.0 },
        { id: 'lvl1', ordinal: 1, height: 3.0 },
      ],
      { fromLevelId: 'lvl0', toLevelId: 'lvl1', entryHeight: 0.75 },
    )
    const spiral1 = scene1['conveyor-spiral_test1'] as ConveyorSpiralNode

    const turns1 = turnCount(spiral1, scene1)
    const angle1 = totalAngleRad(spiral1, scene1)
    const exit1 = exitHeightM(spiral1, scene1)
    const overall1 = overallHeightM(spiral1, scene1)
    const arc1 = helixArcLengthM(spiral1, scene1)

    expect(exit1).toBeCloseTo(0.75 + 3.0, 5)
    expect(overall1).toBeCloseTo(0.75 + 3.0 + 0.3, 5)

    // Update storey height to 6.0 m (doubling height doubles turns, angle, and arc length)
    const scene2 = createBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 6.0 },
        { id: 'lvl1', ordinal: 1, height: 3.0 },
      ],
      { fromLevelId: 'lvl0', toLevelId: 'lvl1', entryHeight: 0.75 },
    )
    const spiral2 = scene2['conveyor-spiral_test1'] as ConveyorSpiralNode

    const turns2 = turnCount(spiral2, scene2)
    const angle2 = totalAngleRad(spiral2, scene2)
    const exit2 = exitHeightM(spiral2, scene2)
    const overall2 = overallHeightM(spiral2, scene2)
    const arc2 = helixArcLengthM(spiral2, scene2)

    expect(turns2).toBeCloseTo(turns1 * 2, 5)
    expect(angle2).toBeCloseTo(angle1 * 2, 5)
    expect(arc2).toBeCloseTo(arc1 * 2, 5)
    expect(exit2).toBeCloseTo(0.75 + 6.0, 5)
    expect(overall2).toBeCloseTo(0.75 + 6.0 + 0.3, 5)
  })

  test('spiralLevelFingerprint changes when storey heights or elevations change', () => {
    const scene1 = createBuildingScene([
      { id: 'lvl0', ordinal: 0, height: 3.0 },
      { id: 'lvl1', ordinal: 1, height: 3.0 },
    ])
    const spiral1 = scene1['conveyor-spiral_test1'] as ConveyorSpiralNode
    const fp1 = spiralLevelFingerprint(scene1, spiral1)

    const scene2 = createBuildingScene([
      { id: 'lvl0', ordinal: 0, height: 4.5 },
      { id: 'lvl1', ordinal: 1, height: 3.0 },
    ])
    const spiral2 = scene2['conveyor-spiral_test1'] as ConveyorSpiralNode
    const fp2 = spiralLevelFingerprint(scene2, spiral2)

    expect(fp1).not.toBe(fp2)
  })
})

// ── 4. Dynamic Height & Level Resolution for Pallet Lift ────────────────────

describe('Pallet Lift Multi-Level & Dynamic Height Resolution', () => {
  test('resolvePalletLiftLevels dynamically updates served stop elevations and total height', () => {
    // 3 floors: 3.0m, 3.5m, 4.0m
    const scene1 = createBuildingScene([
      { id: 'lvl0', ordinal: 0, height: 3.0 },
      { id: 'lvl1', ordinal: 1, height: 3.5 },
      { id: 'lvl2', ordinal: 2, height: 4.0 },
    ])
    const lift1 = scene1['pallet-lift_test1'] as PalletLiftNode
    const resolved1 = resolvePalletLiftLevels(lift1, scene1)

    expect(resolved1.baseY).toBe(0)
    expect(resolved1.topY).toBeCloseTo(6.5, 5) // 3.0 + 3.5
    expect(resolved1.totalHeight).toBeCloseTo(6.5 + 1.2, 5) // rise + overtravel (1.2)
    expect(resolved1.servedLevels).toHaveLength(3)
    expect(resolved1.servedLevels[0]?.elevation).toBe(0)
    expect(resolved1.servedLevels[1]?.elevation).toBeCloseTo(3.0, 5)
    expect(resolved1.servedLevels[2]?.elevation).toBeCloseTo(6.5, 5)

    // User changes floor heights: lvl0 -> 4.2m, lvl1 -> 3.8m
    const scene2 = createBuildingScene([
      { id: 'lvl0', ordinal: 0, height: 4.2 },
      { id: 'lvl1', ordinal: 1, height: 3.8 },
      { id: 'lvl2', ordinal: 2, height: 4.0 },
    ])
    const lift2 = scene2['pallet-lift_test1'] as PalletLiftNode
    const resolved2 = resolvePalletLiftLevels(lift2, scene2)

    expect(resolved2.baseY).toBe(0)
    expect(resolved2.topY).toBeCloseTo(8.0, 5) // 4.2 + 3.8
    expect(resolved2.totalHeight).toBeCloseTo(8.0 + 1.2, 5)
    expect(resolved2.servedLevels).toHaveLength(3)
    expect(resolved2.servedLevels[0]?.elevation).toBe(0)
    expect(resolved2.servedLevels[1]?.elevation).toBeCloseTo(4.2, 5)
    expect(resolved2.servedLevels[2]?.elevation).toBeCloseTo(8.0, 5)
  })

  test('resolvePalletLiftLevels restricts served levels via fromLevelId / toLevelId', () => {
    const scene = createBuildingScene(
      [
        { id: 'lvl0', ordinal: 0, height: 3.0 },
        { id: 'lvl1', ordinal: 1, height: 4.0 },
        { id: 'lvl2', ordinal: 2, height: 3.5 },
      ],
      {},
      { parentId: 'lvl0', fromLevelId: 'lvl1', toLevelId: 'lvl2' },
    )
    const lift = scene['pallet-lift_test1'] as PalletLiftNode
    const resolved = resolvePalletLiftLevels(lift, scene)

    // Relative to parentId lvl0: lvl1 is at 3.0, lvl2 is at 7.0
    expect(resolved.servedLevels).toHaveLength(2)
    expect(resolved.servedLevels[0]?.id).toBe('lvl1')
    expect(resolved.servedLevels[0]?.elevation).toBeCloseTo(3.0, 5)
    expect(resolved.servedLevels[1]?.id).toBe('lvl2')
    expect(resolved.servedLevels[1]?.elevation).toBeCloseTo(7.0, 5)
    expect(resolved.totalHeight).toBeCloseTo(4.0 + 1.2, 5) // (7.0 - 3.0) + 1.2
  })

  test('resolvePalletLiftLevels falls back cleanly when outside building', () => {
    const standaloneLift = PalletLiftNode.parse({
      id: 'pallet-lift_standalone',
      fallbackTravelM: 4.0,
    })
    const resolved = resolvePalletLiftLevels(standaloneLift, {})

    expect(resolved.servedLevels).toHaveLength(2)
    expect(resolved.baseY).toBe(0)
    expect(resolved.topY).toBe(4.0)
    expect(resolved.totalHeight).toBe(4.0 + 1.2)
  })
})

// ── 5. Host Adapter Floor-to-Floor Height Helper ────────────────────────────

describe('Host Adapter getLevelFloorToFloorHeight and Level Helpers', () => {
  test('accurately derives floor-to-floor height between stacked building storeys', () => {
    const scene = createBuildingScene([
      { id: 'lvl0', ordinal: 0, height: 3.2 },
      { id: 'lvl1', ordinal: 1, height: 4.1, baseElevation: 0.5 },
      { id: 'lvl2', ordinal: 2, height: 2.8 },
    ])

    // lvl0 -> lvl1: lvl1 baseY is 3.2 + 0.5 = 3.7. Distance = 3.7 - 0 = 3.7
    expect(getLevelFloorToFloorHeight(scene, 'lvl0')).toBeCloseTo(3.7, 5)
    // lvl1 -> lvl2: lvl2 baseY is 3.7 + 4.1 = 7.8. Distance = 7.8 - 3.7 = 4.1
    expect(getLevelFloorToFloorHeight(scene, 'lvl1')).toBeCloseTo(4.1, 5)
    // lvl2 (topmost): returns its own height 2.8
    expect(getLevelFloorToFloorHeight(scene, 'lvl2')).toBeCloseTo(2.8, 5)

    const elevations = levelElevationsOfBuilding(scene, 'building_1')
    expect(elevations).toHaveLength(3)
    expect(elevations[0]?.baseY).toBe(0)
    expect(elevations[1]?.baseY).toBeCloseTo(3.7, 5)
    expect(elevations[2]?.baseY).toBeCloseTo(7.8, 5)
  })

  test('resolveSpiralBuildingLevels returns all levels of the spiral container building in order', () => {
    const scene = createBuildingScene(
      [
        { id: 'lvl2', ordinal: 2, height: 3.0 },
        { id: 'lvl0', ordinal: 0, height: 3.0 },
        { id: 'lvl1', ordinal: 1, height: 3.0 },
      ],
      { fromLevelId: 'lvl0', toLevelId: 'lvl2' },
    )
    const spiral = scene['conveyor-spiral_test1'] as ConveyorSpiralNode
    const levels = resolveSpiralBuildingLevels(scene, spiral)
    expect(levels.map((l) => l.id)).toEqual(['lvl0', 'lvl1', 'lvl2'])
  })
})

// ── 6. Floorplan & Multi-Level Extensions ───────────────────────────────────

describe('Floorplan Multi-Level Linking Extensions', () => {
  test('conveyorSpiralDefinition registers linkedLevelIds extension for destination floor', () => {
    const spiral = ConveyorSpiralNode.parse({
      id: 'conveyor-spiral_linked1',
      parentId: 'lvl0',
      toLevelId: 'lvl1',
    })
    const linkedExt =
      conveyorSpiralDefinition.extensions?.['pascal:editor/floorplan']?.linkedLevelIds
    expect(linkedExt).toBeDefined()
    expect(linkedExt!(spiral)).toEqual(['lvl1'])

    // Same level returns empty array
    const sameLevelSpiral = ConveyorSpiralNode.parse({
      id: 'conveyor-spiral_linked2',
      parentId: 'lvl0',
      toLevelId: 'lvl0',
    })
    expect(linkedExt!(sameLevelSpiral)).toEqual([])
  })

  test('palletLiftDefinition registers building scope floorplan extension', () => {
    const floorplanScope =
      palletLiftDefinition.extensions?.['pascal:editor/floorplan']?.floorplanScope
    expect(floorplanScope).toBe('building')

    const linkedExt = palletLiftDefinition.extensions?.['pascal:editor/floorplan']?.linkedLevelIds
    const lift = PalletLiftNode.parse({
      id: 'pallet-lift_linked1',
      parentId: 'lvl0',
      fromLevelId: 'lvl0',
      toLevelId: 'lvl2',
    })
    expect(linkedExt!(lift)).toEqual(['lvl2'])
  })
})
