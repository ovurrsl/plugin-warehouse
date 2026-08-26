import { describe, expect, test } from 'bun:test'
import { resolveSpiralBuildingLevels, resolveSpiralRise } from '../conveyor/spiral-levels'
import { exitHeightM, helixArcLengthM, overallHeightM, turnCount } from '../conveyor/spiral-metrics'
import SpiralPanel from '../conveyor/spiral-panel'
import { conveyorSpiralParametrics } from '../conveyor/spiral-parametrics'
import { ConveyorSpiralNode } from '../conveyor/spiral-schema'
import { OVERTRAVEL_M } from '../palletlift/catalog'
import {
  liftLevelFingerprint,
  mastHeightM,
  resolveLiftLevels,
  resolvePalletLiftLevels,
  riseM,
} from '../palletlift/levels'
import PalletLiftPanel from '../palletlift/panel'
import { palletLiftParametrics } from '../palletlift/parametrics'
import { PalletLiftNode } from '../palletlift/schema'

describe('Milestone 3: Inspector Panels & Level Selection UI', () => {
  const buildingId = 'bld_1'
  const level0Id = 'lvl_0'
  const level1Id = 'lvl_1'
  const level2Id = 'lvl_2'

  const mockBuilding = {
    id: buildingId,
    type: 'building',
    children: [level0Id, level1Id, level2Id],
    name: 'Main Warehouse',
  }

  const mockLevel0 = {
    id: level0Id,
    type: 'level',
    parentId: buildingId,
    level: 0,
    name: 'Ground Floor (0.0m)',
    height: 3.5,
    baseElevation: 0,
    children: ['conveyor-spiral_1', 'pallet-lift_1'],
  }

  const mockLevel1 = {
    id: level1Id,
    type: 'level',
    parentId: buildingId,
    level: 1,
    name: 'Mezzanine (3.5m)',
    height: 4.0,
    baseElevation: 0,
    children: [],
  }

  const mockLevel2 = {
    id: level2Id,
    type: 'level',
    parentId: buildingId,
    level: 2,
    name: 'High Bay (7.5m)',
    height: 4.5,
    baseElevation: 0,
    children: [],
  }

  const baseNodes: Record<string, unknown> = {
    [buildingId]: mockBuilding,
    [level0Id]: mockLevel0,
    [level1Id]: mockLevel1,
    [level2Id]: mockLevel2,
  }

  describe('Custom Panel Definition & Parametrics Registration', () => {
    test('conveyorSpiralParametrics registers customPanel', async () => {
      expect(conveyorSpiralParametrics.customPanel).toBeDefined()
      if (conveyorSpiralParametrics.customPanel) {
        const mod = await conveyorSpiralParametrics.customPanel()
        expect(mod.default).toBeDefined()
        expect(typeof mod.default).toBe('function')
      }
    })

    test('palletLiftParametrics registers customPanel', async () => {
      expect(palletLiftParametrics.customPanel).toBeDefined()
      if (palletLiftParametrics.customPanel) {
        const mod = await palletLiftParametrics.customPanel()
        expect(mod.default).toBeDefined()
        expect(typeof mod.default).toBe('function')
      }
    })

    test('re-exported panel files exist and resolve correctly', () => {
      expect(SpiralPanel).toBeDefined()
      expect(PalletLiftPanel).toBeDefined()
    })
  })

  describe('Spiral Conveyor Inspector Level Resolution & UI Logic', () => {
    test('queries building levels correctly in bottom-to-top ordinal order', () => {
      const spiral = ConveyorSpiralNode.parse({
        id: 'conveyor-spiral_1',
        parentId: level0Id,
        fromLevelId: level0Id,
        toLevelId: level1Id,
      })

      const levels = resolveSpiralBuildingLevels(baseNodes, spiral)
      expect(levels.length).toBe(3)
      expect(levels[0]?.id).toBe(level0Id)
      expect(levels[1]?.id).toBe(level1Id)
      expect(levels[2]?.id).toBe(level2Id)
      expect(levels[0]?.name).toBe('Ground Floor (0.0m)')
      expect(levels[1]?.name).toBe('Mezzanine (3.5m)')
    })

    test('dynamically calculates rise when connecting Ground (0.0m) to Mezzanine (3.5m)', () => {
      const spiral = ConveyorSpiralNode.parse({
        id: 'conveyor-spiral_1',
        parentId: level0Id,
        fromLevelId: level0Id,
        toLevelId: level1Id,
      })

      const rise = resolveSpiralRise(baseNodes, spiral)
      expect(rise).toBeCloseTo(3.5, 3)

      const turns = turnCount(spiral, rise)
      const exitH = exitHeightM(spiral, rise)
      const overallH = overallHeightM(spiral, rise)
      const arcLen = helixArcLengthM(spiral, rise)

      expect(turns).toBeGreaterThan(0)
      expect(exitH).toBeCloseTo(spiral.entryHeight + 3.5, 3)
      expect(overallH).toBeGreaterThan(exitH)
      expect(arcLen).toBeGreaterThan(3.5)
    })

    test('dynamically calculates rise when connecting Ground (0.0m) to High Bay (7.5m)', () => {
      const spiral = ConveyorSpiralNode.parse({
        id: 'conveyor-spiral_1',
        parentId: level0Id,
        fromLevelId: level0Id,
        toLevelId: level2Id,
      })

      const rise = resolveSpiralRise(baseNodes, spiral)
      expect(rise).toBeCloseTo(7.5, 3) // 3.5 + 4.0

      const turns = turnCount(spiral, rise)
      expect(turns).toBeGreaterThan(turnCount(spiral, 3.5))
    })

    test('supports baseLevelId and topLevelId aliases for level selection', () => {
      const spiral = ConveyorSpiralNode.parse({
        id: 'conveyor-spiral_1',
        parentId: level0Id,
        baseLevelId: level0Id,
        topLevelId: level2Id,
      })

      const rise = resolveSpiralRise(baseNodes, spiral)
      expect(rise).toBeCloseTo(7.5, 3)
    })

    test('falls back to travelHeight cleanly when unparented or outside building', () => {
      const spiral = ConveyorSpiralNode.parse({
        id: 'conveyor-spiral_standalone',
        travelHeight: 4.8,
      })

      const emptyNodes: Record<string, unknown> = {}
      const rise = resolveSpiralRise(emptyNodes, spiral)
      expect(rise).toBe(4.8)
    })

    test('reacts to dynamic storey height updates without manual travelHeight override', () => {
      const spiral = ConveyorSpiralNode.parse({
        id: 'conveyor-spiral_1',
        parentId: level0Id,
        fromLevelId: level0Id,
        toLevelId: level1Id,
      })

      // Initially 3.5m
      expect(resolveSpiralRise(baseNodes, spiral)).toBeCloseTo(3.5, 3)

      // Storey height edited by architect/user: Ground floor becomes 5.2m
      const updatedNodes = {
        ...baseNodes,
        [level0Id]: {
          ...mockLevel0,
          height: 5.2,
        },
      }

      expect(resolveSpiralRise(updatedNodes, spiral)).toBeCloseTo(5.2, 3)
    })
  })

  describe('Pallet Lift Inspector Floor Selection & Access Control Logic', () => {
    test('resolves served stops across level span Ground (0.0m) to High Bay (7.5m)', () => {
      const lift = PalletLiftNode.parse({
        id: 'pallet-lift_1',
        parentId: level0Id,
        fromLevelId: level0Id,
        toLevelId: level2Id,
      })

      const resolved = resolvePalletLiftLevels(lift, baseNodes)
      expect(resolved.servedLevels.length).toBe(3)
      expect(resolved.servedLevels[0]?.id).toBe(level0Id)
      expect(resolved.servedLevels[1]?.id).toBe(level1Id)
      expect(resolved.servedLevels[2]?.id).toBe(level2Id)
      expect(resolved.servedLevels[0]?.elevation).toBeCloseTo(0.0, 3)
      expect(resolved.servedLevels[1]?.elevation).toBeCloseTo(3.5, 3)
      expect(resolved.servedLevels[2]?.elevation).toBeCloseTo(7.5, 3)
      expect(resolved.totalHeight).toBeCloseTo(7.5 + OVERTRAVEL_M, 3) // rise + OVERTRAVEL_M (1.2m)
    })

    test('clamps served stops when fromLevelId and toLevelId restrict range', () => {
      const lift = PalletLiftNode.parse({
        id: 'pallet-lift_1',
        parentId: level0Id,
        fromLevelId: level1Id,
        toLevelId: level2Id,
      })

      const resolved = resolvePalletLiftLevels(lift, baseNodes)
      expect(resolved.servedLevels.length).toBe(2)
      expect(resolved.servedLevels[0]?.id).toBe(level1Id)
      expect(resolved.servedLevels[1]?.id).toBe(level2Id)
    })

    test('supports baseLevelId and topLevelId aliases for pallet lift', () => {
      const lift = PalletLiftNode.parse({
        id: 'pallet-lift_1',
        parentId: level0Id,
        baseLevelId: level0Id,
        topLevelId: level1Id,
      })

      const resolved = resolvePalletLiftLevels(lift, baseNodes)
      expect(resolved.servedLevels.length).toBe(2)
      expect(resolved.servedLevels[0]?.id).toBe(level0Id)
      expect(resolved.servedLevels[1]?.id).toBe(level1Id)
      expect(riseM(baseNodes, lift)).toBeCloseTo(3.5, 3)
    })

    test('handles defaultLevelId within served floors range', () => {
      const lift = PalletLiftNode.parse({
        id: 'pallet-lift_1',
        parentId: level0Id,
        fromLevelId: level0Id,
        toLevelId: level2Id,
        defaultLevelId: level1Id,
      })

      expect(lift.defaultLevelId).toBe(level1Id)
    })

    test('manages serviceOnlyLevelIds and disabledLevelIds access lists', () => {
      const lift = PalletLiftNode.parse({
        id: 'pallet-lift_1',
        parentId: level0Id,
        fromLevelId: level0Id,
        toLevelId: level2Id,
        serviceOnlyLevelIds: [level1Id],
        disabledLevelIds: [level2Id],
      })

      expect(lift.serviceOnlyLevelIds).toContain(level1Id)
      expect(lift.disabledLevelIds).toContain(level2Id)
      expect(lift.serviceOnlyLevelIds).not.toContain(level2Id)
    })

    test('single-storey building falls back cleanly to 2-stop synthetic shaft without throwing', () => {
      const singleLevelBuildingId = 'bld_single'
      const singleLevelId = 'lvl_only'
      const singleNodes: Record<string, unknown> = {
        [singleLevelBuildingId]: {
          id: singleLevelBuildingId,
          type: 'building',
          children: [singleLevelId],
        },
        [singleLevelId]: {
          id: singleLevelId,
          type: 'level',
          parentId: singleLevelBuildingId,
          level: 0,
          name: 'Solo Floor',
          height: 3.0,
        },
      }

      const lift = PalletLiftNode.parse({
        id: 'pallet-lift_solo',
        parentId: singleLevelId,
        fallbackTravelM: 5.5,
      })

      const stops = resolveLiftLevels(singleNodes, lift)
      expect(stops.length).toBe(2)
      expect(stops[0]?.baseY).toBe(0)
      expect(stops[1]?.baseY).toBe(5.5)
      expect(mastHeightM(singleNodes, lift)).toBeCloseTo(5.5 + OVERTRAVEL_M, 3)
    })

    test('liftLevelFingerprint updates when level heights change', () => {
      const lift = PalletLiftNode.parse({
        id: 'pallet-lift_1',
        parentId: level0Id,
        fromLevelId: level0Id,
        toLevelId: level2Id,
      })

      const fp1 = liftLevelFingerprint(baseNodes, lift)

      const alteredNodes = {
        ...baseNodes,
        [level1Id]: {
          ...mockLevel1,
          height: 6.0,
        },
      }

      const fp2 = liftLevelFingerprint(alteredNodes, lift)
      expect(fp1).not.toBe(fp2)
    })
  })
})
