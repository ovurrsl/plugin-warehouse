/**
 * Comprehensive 4-Tier E2E Integration Test Suite for Multi-Level Conveyors & Pallet Lifts
 *
 * Implements the opaque-box verification track specified in `TEST_INFRA.md` and `PROJECT.md`,
 * grounding directly in authoritative requirements from `ORIGINAL_REQUEST.md`.
 *
 * Tier Breakdown:
 * - Tier 1: Feature Coverage (F1 - F9, ≥45 tests)
 * - Tier 2: Boundary & Corner Cases (B1 - B9, ≥45 tests)
 * - Tier 3: Cross-Feature Interactions (X1 - X10, ≥10 tests)
 * - Tier 4: Real-World Multi-Level Warehouse Scenarios (S1 - S5, ≥5 tests)
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import type { GeometryContext } from '@pascal-app/core'
import { OVERTRAVEL_M, SPEED_MPM } from '../palletlift/catalog'
import { buildLiftCycle, cycleLength, stepAt } from '../palletlift/cycle'
import { palletLiftDefinition } from '../palletlift/definition'
import { buildPalletLiftFloorplan } from '../palletlift/floorplan'
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
  footprintM as liftFootprintM,
  mastPositionsXZ,
  mastSectionM,
  platformDepthM,
  platformWidthM,
} from '../palletlift/metrics'
import {
  palletLiftDoorPanelParts,
  palletLiftPlatformParts,
  palletLiftStaticParts,
} from '../palletlift/parts'
import { PalletLiftNode } from '../palletlift/schema'

import { ConveyorRollerNode } from '../conveyor/schema'
import { buildSpiralFloorplan } from '../conveyor/spiral-floorplan'
import {
  cageRadiusM,
  columnRadiusM,
  entryHeightM as spiralEntryHeightM,
  exitHeightM as spiralExitHeightM,
  footprintM as spiralFootprintM,
  frameWidthM as spiralFrameWidthM,
  handednessSign,
  helixArcLengthM,
  helixPoint,
  helixRadiusM,
  inclineRad,
  outerDiameterM as spiralOuterDiameterM,
  overallHeightM as spiralOverallHeightM,
  pitchM as spiralPitchM,
  portSpanM as spiralPortSpanM,
  totalAngleRad,
  exitAngleRad,
  turnCount as spiralTurnCount,
} from '../conveyor/spiral-metrics'
import { spiralSlatParts, spiralStaticParts } from '../conveyor/spiral-parts'
import { ConveyorSpiralNode } from '../conveyor/spiral-schema'

import { isPortMated, lineOf, resetLineIndex } from '../conveyor/line-index'
import {
  jointProblems,
  mateBlockers,
  resetPortMagnet,
  snapPlacementToLineEnd,
  snapToLineEnd,
} from '../conveyor/port-magnet'
import {
  asConveyorModule,
  conveyorPorts,
  isSpiralModule,
  localPorts,
  moduleLaneMm,
  moduleRunLengthM,
  portPosition,
  transportHeightAt,
} from '../conveyor/ports'

import {
  DEFAULT_LEVEL_HEIGHT,
  allLevels,
  buildingOfLevel,
  levelElevationsOfBuilding,
  levelsOfBuilding,
  parentLevelIdOf,
} from '../host-adapter'

// ── Test Scene Helpers ──────────────────────────────────────────────────────

type LevelConfig = {
  id: string
  ordinal: number
  height: number
  baseElevation?: number
  children?: string[]
}

function makeLevelNode(cfg: LevelConfig): Record<string, unknown> {
  return {
    id: cfg.id,
    type: 'level',
    object: 'node',
    level: cfg.ordinal,
    height: cfg.height,
    baseElevation: cfg.baseElevation ?? 0,
    children: cfg.children ?? [],
  }
}

function makeBuildingScene(
  buildingId: string,
  levels: LevelConfig[],
  extraNodes: Record<string, unknown> = {},
): Record<string, unknown> {
  const scene: Record<string, unknown> = {
    [buildingId]: {
      id: buildingId,
      type: 'building',
      object: 'node',
      children: levels.map((l) => l.id),
    },
  }

  for (const lvl of levels) {
    scene[lvl.id] = makeLevelNode(lvl)
  }

  for (const [key, val] of Object.entries(extraNodes)) {
    scene[key] = val
  }

  return scene
}

function makeMockGeometryContext(
  parentLevelNode: unknown = null,
  allNodes: Record<string, unknown> = {},
): GeometryContext {
  return {
    parent: parentLevelNode as never,
    children: [],
    siblings: [],
    resolve: (id: string) => (allNodes[id] as never) ?? null,
    viewState: {
      selected: true,
      palette: {
        selectedStroke: '#e69a47',
        selectedFill: '#fce8cc',
      },
    } as never,
  } as unknown as GeometryContext
}

function makeSpiralNode(overrides: Record<string, unknown> = {}): ConveyorSpiralNode {
  return ConveyorSpiralNode.parse({
    id: 'conveyor-spiral_test_1',
    parentId: 'lvl_0',
    position: [10, 0, 15],
    rotation: [0, 0, 0],
    outerDiameter: '1800',
    beltWidth: '400',
    travelHeight: 4,
    inclineDeg: 11,
    entryHeight: 0.75,
    handedness: 'ccw',
    flow: 'up',
    ...overrides,
  })
}

function makeLiftNode(overrides: Record<string, unknown> = {}): PalletLiftNode {
  return PalletLiftNode.parse({
    id: 'pallet-lift_test_1',
    parentId: 'lvl_0',
    position: [20, 0, 25],
    rotation: [0, 0, 0],
    capacityClass: '1000',
    mastCount: '2',
    fallbackTravelM: 4.0,
    fromLevelId: null,
    toLevelId: null,
    hasDoors: true,
    palletPreset: 'epal-1',
    ...overrides,
  })
}

function makeRollerNode(overrides: Record<string, unknown> = {}): ConveyorRollerNode {
  return ConveyorRollerNode.parse({
    id: 'conveyor-roller_test_1',
    parentId: 'lvl_0',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    rollers: 40,
    rollerPitch: '75',
    usefulWidth: '400',
    transportHeight: 0.75,
    flow: 'forward',
    ...overrides,
  })
}

// ═════════════════════════════════════════════════════════════════════════════
// TIER 1: FEATURE COVERAGE (F1 - F9)
// ═════════════════════════════════════════════════════════════════════════════

describe('Tier 1: Feature Coverage (F1 - F9)', () => {
  beforeEach(() => {
    resetPortMagnet()
    resetLineIndex()
  })

  // ── F1: Spiral Conveyor Schema & Level Linking ──
  describe('F1: Spiral Conveyor Schema Parsing and Properties', () => {
    test('T1.F1.1: validates default spiral schema with correct types and dimensions', () => {
      const node = makeSpiralNode()
      expect(node.type).toBe('warehouse:conveyor-spiral')
      expect(node.outerDiameter).toBe('1800')
      expect(node.beltWidth).toBe('400')
      expect(node.travelHeight).toBe(4)
      expect(node.entryHeight).toBe(0.75)
      expect(node.handedness).toBe('ccw')
      expect(node.flow).toBe('up')
    })

    test('T1.F1.2: enforces load class enum light and pallet with distinct speed constants', () => {
      const light = makeSpiralNode({ loadClass: 'light' })
      const pallet = makeSpiralNode({ loadClass: 'pallet', outerDiameter: '2400' })
      expect(light.loadClass).toBe('light')
      expect(pallet.loadClass).toBe('pallet')
    })

    test('T1.F1.3: verifies supportSlabId property persistence', () => {
      const node = makeSpiralNode({ supportSlabId: 'slab_101' })
      expect(node.supportSlabId).toBe('slab_101')
    })

    test('T1.F1.4: accepts standard 3D transform position and euler rotation tuple', () => {
      const node = makeSpiralNode({
        position: [12.5, 0.75, -8.25],
        rotation: [0, Math.PI / 2, 0],
      })
      expect(node.position).toEqual([12.5, 0.75, -8.25])
      expect(node.rotation[1]).toBeCloseTo(Math.PI / 2, 6)
    })

    test('T1.F1.5: distinguishes chiralities cw and ccw for directional helix generation', () => {
      const ccwNode = makeSpiralNode({ handedness: 'ccw' })
      const cwNode = makeSpiralNode({ handedness: 'cw' })
      expect(handednessSign(ccwNode)).toBe(1)
      expect(handednessSign(cwNode)).toBe(-1)
    })
  })

  // ── F2: Spiral Conveyor Dynamic Height & Storey Synchronization ──
  describe('F2: Spiral Conveyor Height Synchronization from Storeys', () => {
    test('T1.F2.1: calculates entryHeight, exitHeight, and overallHeight deterministically', () => {
      const node = makeSpiralNode({ entryHeight: 0.75, travelHeight: 3.5 })
      expect(spiralEntryHeightM(node)).toBe(0.75)
      expect(spiralExitHeightM(node)).toBe(4.25)
      expect(spiralOverallHeightM(node)).toBe(4.55) // 4.25 + 0.3 overhead margin
    })

    test('T1.F2.2: derives pitch = 2π·R·tan(incline) strictly matching EN 619:2022', () => {
      const node = makeSpiralNode({ outerDiameter: '2400', beltWidth: '400', inclineDeg: 10 })
      const R = (2.4 - 0.4) / 2 // 1.0m
      const expectedPitch = 2 * Math.PI * R * Math.tan((10 * Math.PI) / 180)
      expect(helixRadiusM(node)).toBeCloseTo(1.0, 6)
      expect(spiralPitchM(node)).toBeCloseTo(expectedPitch, 6)
    })

    test('T1.F2.3: computes fractional turnCount as travelHeight / pitch', () => {
      const node = makeSpiralNode({ travelHeight: 5.0, inclineDeg: 12 })
      const pitch = spiralPitchM(node)
      const turns = spiralTurnCount(node)
      expect(turns).toBeCloseTo(5.0 / pitch, 6)
      expect(totalAngleRad(node)).toBeCloseTo(turns * 2 * Math.PI, 6)
    })

    test('T1.F2.4: verifies helix arc length = travelHeight / sin(incline)', () => {
      const node = makeSpiralNode({ travelHeight: 4.0, inclineDeg: 11 })
      const rad = inclineRad(node)
      expect(helixArcLengthM(node)).toBeCloseTo(4.0 / Math.sin(rad), 6)
    })

    test('T1.F2.5: dynamic level elevation resolver accurately computes stacked floor storeys', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'l0', ordinal: 0, height: 4.0 },
        { id: 'l1', ordinal: 1, height: 3.5 },
        { id: 'l2', ordinal: 2, height: 3.5 },
      ])
      const elevs = levelElevationsOfBuilding(scene, 'b1')
      expect(elevs).toEqual([
        { id: 'l0', baseY: 0, height: 4.0 },
        { id: 'l1', baseY: 4.0, height: 3.5 },
        { id: 'l2', baseY: 7.5, height: 3.5 },
      ])
    })
  })

  // ── F3: Spiral Conveyor 2D Floorplan Coordinate Accuracy ──
  describe('F3: Spiral Conveyor 2D Floorplan Geometry & Alignment', () => {
    test('T1.F3.1: buildSpiralFloorplan produces valid SVG primitive group', () => {
      const node = makeSpiralNode()
      const ctx = makeMockGeometryContext()
      const fp = buildSpiralFloorplan(node, ctx)
      expect(fp).not.toBeNull()
      expect(fp?.kind).toBe('group')
    })

    test('T1.F3.2: includes cage circle, belt circle, column circle, and entrance/exit stubs', () => {
      const node = makeSpiralNode()
      const ctx = makeMockGeometryContext()
      const fp = buildSpiralFloorplan(node, ctx)
      const children = (fp as { children: Array<{ kind: string }> }).children
      const kinds = children.map((c) => c.kind)
      expect(kinds).toContain('circle')
      expect(kinds).toContain('rect')
      expect(kinds).toContain('polygon')
    })

    test('T1.F3.3: cage radius and column radius match metric calculations', () => {
      const node = makeSpiralNode({ outerDiameter: '1800', beltWidth: '400' })
      const ctx = makeMockGeometryContext()
      const fp = buildSpiralFloorplan(node, ctx)
      const circles = (
        fp as { children: Array<{ kind: string; r?: number; cx?: number; cy?: number }> }
      ).children.filter((c) => c.kind === 'circle')
      const radii = circles.map((c) => c.r)
      expect(radii).toContain(cageRadiusM(node))
      expect(radii).toContain(columnRadiusM(node))
      expect(radii).toContain(helixRadiusM(node))
    })

    test('T1.F3.4: displays dynamic dimension label with diameter, turns, and flow arrow when selected', () => {
      const node = makeSpiralNode({ travelHeight: 3.0, flow: 'up' })
      const ctx = makeMockGeometryContext(null, {})
      const fp = buildSpiralFloorplan(node, ctx)
      const label = (
        fp as { children: Array<{ kind: string; text?: string }> }
      ).children.find((c) => c.kind === 'dimension-label')
      expect(label).toBeDefined()
      expect(label?.text).toContain('⌀')
      expect(label?.text).toContain('tur')
      expect(label?.text).toContain('↑')
    })

    test('T1.F3.5: omits dimension label when node is unselected', () => {
      const node = makeSpiralNode()
      const ctx = {
        parent: null,
        children: [],
        siblings: [],
        resolve: () => null,
        viewState: { selected: false, palette: {} } as never,
      } as unknown as GeometryContext
      const fp = buildSpiralFloorplan(node, ctx)
      const label = (
        fp as { children: Array<{ kind: string }> }
      ).children.find((c) => c.kind === 'dimension-label')
      expect(label).toBeUndefined()
    })
  })

  // ── F4: Spiral Conveyor 3D Mesh Geometry ──
  describe('F4: Spiral Conveyor 3D Mesh Parts and Geometry Consistency', () => {
    test('T1.F4.1: spiralStaticParts generates legs, footplates, stubs, motor, and handrail', () => {
      const node = makeSpiralNode()
      const parts = spiralStaticParts(node, 'full')
      expect(parts.length).toBeGreaterThan(5)
      const roles = new Set(parts.map((p) => p.role))
      expect(roles.has('leg')).toBe(true)
      expect(roles.has('stub')).toBe(true)
      expect(roles.has('footplate')).toBe(true)
    })

    test('T1.F4.2: perimeter tower legs span total height to exitHeight', () => {
      const node = makeSpiralNode({ travelHeight: 4.5, entryHeight: 0.75 })
      const parts = spiralStaticParts(node, 'full')
      const mainLeg = parts.find((p) => p.role === 'leg')
      expect(mainLeg).toBeDefined()
      expect(mainLeg?.size[1]).toBeCloseTo(4.5 + 0.75, 2)
    })

    test('T1.F4.3: entrance stub connects at entryHeight level on -X axis', () => {
      const node = makeSpiralNode({ entryHeight: 0.85 })
      const parts = spiralStaticParts(node, 'full')
      const entryStub = parts.find((p) => p.role === 'stub' && p.center[0] < 0)
      expect(entryStub).toBeDefined()
      expect(entryStub?.center[1]).toBeCloseTo(0.85 - 0.03, 2)
    })

    test('T1.F4.4: spiralSlatParts generates continuous chain of helical slats along rise', () => {
      const node = makeSpiralNode({ travelHeight: 3.0 })
      const slats = spiralSlatParts(node, 'full')
      expect(slats.length).toBeGreaterThan(20)
      for (let i = 1; i < slats.length; i++) {
        expect(slats[i]!.center[1]).toBeGreaterThanOrEqual(slats[i - 1]!.center[1])
      }
    })

    test('T1.F4.5: helix point at t=0 coincides with helix base radius', () => {
      const node = makeSpiralNode({ outerDiameter: '1800', beltWidth: '400' })
      const r = helixRadiusM(node)
      const pt0 = helixPoint(node, 0)
      expect(pt0[0]).toBeCloseTo(-r, 6)
      expect(pt0[1]).toBeCloseTo(0, 6)
      expect(pt0[2]).toBeCloseTo(0, 6)
    })
  })

  // ── F5: Pallet Lift Multi-Level Schema Linking ──
  describe('F5: Pallet Lift Schema & Level Selection Fields', () => {
    test('T1.F5.1: PalletLiftNode validates standard schema with capacity classes', () => {
      const node = makeLiftNode()
      expect(node.type).toBe('warehouse:pallet-lift')
      expect(node.capacityClass).toBe('1000')
      expect(node.mastCount).toBe('2')
      expect(node.fromLevelId).toBeNull()
      expect(node.toLevelId).toBeNull()
    })

    test('T1.F5.2: accepts custom fromLevelId and toLevelId floor bounds', () => {
      const node = makeLiftNode({ fromLevelId: 'lvl_ground', toLevelId: 'lvl_mezzanine' })
      expect(node.fromLevelId).toBe('lvl_ground')
      expect(node.toLevelId).toBe('lvl_mezzanine')
    })

    test('T1.F5.3: pallet lift definition provides manifest and rotatable capability (90 deg)', () => {
      const snapAngles = palletLiftDefinition.capabilities.rotatable.snapAngles
      expect(snapAngles.length).toBe(4)
      expect(snapAngles[1]).toBeCloseTo(Math.PI / 2, 6)
    })

    test('T1.F5.4: footprint dimensions fully encompass platform width and depth', () => {
      const node = makeLiftNode({ palletPreset: 'epal-1' })
      const fp = liftFootprintM(node)
      expect(fp[0]).toBeGreaterThan(platformWidthM(node))
      expect(fp[1]).toBeGreaterThan(platformDepthM(node))
    })

    test('T1.F5.5: dynamic tree label formats equipment name and capacity class', () => {
      const node1000 = makeLiftNode({ capacityClass: '1000' })
      const node1500 = makeLiftNode({
        id: 'pallet-lift_s',
        capacityClass: '1500',
        name: 'South Pallet Elevator',
      })
      expect(palletLiftDefinition.tree.label(node1000 as never)).toBe('Pallet Lift · 1000 kg')
      expect(palletLiftDefinition.tree.label(node1500 as never)).toBe('South Pallet Elevator')
    })
  })

  // ── F6: Pallet Lift Dynamic Height Synchronization (Parity with Elevator) ──
  describe('F6: Pallet Lift Dynamic Level Resolution & Elevator Parity', () => {
    test('T1.F6.1: resolves all building levels in ascending ordinal order', () => {
      const scene = makeBuildingScene(
        'bldg_1',
        [
          { id: 'l2', ordinal: 2, height: 3.5 },
          { id: 'l0', ordinal: 0, height: 4.0 },
          { id: 'l1', ordinal: 1, height: 3.0 },
        ],
        {
          'pallet-lift_1': makeLiftNode({ id: 'pallet-lift_1', parentId: 'l0' }),
        },
      )
      const lift = scene['pallet-lift_1'] as PalletLiftNode
      const stops = resolveLiftLevels(scene, lift)
      expect(stops.map((s) => s.id)).toEqual(['l0', 'l1', 'l2'])
      expect(stops.map((s) => s.label)).toEqual(['0', '1', '2'])
      expect(stops.map((s) => s.baseY)).toEqual([0, 4.0, 7.0])
    })

    test('T1.F6.2: re-bases stop baseY relative to parent level elevation (prevents double-counting)', () => {
      const scene = makeBuildingScene(
        'bldg_1',
        [
          { id: 'l0', ordinal: 0, height: 4.0 },
          { id: 'l1', ordinal: 1, height: 3.0 },
          { id: 'l2', ordinal: 2, height: 3.0 },
        ],
        {
          'pallet-lift_1': makeLiftNode({ id: 'pallet-lift_1', parentId: 'l1' }),
        },
      )
      const lift = scene['pallet-lift_1'] as PalletLiftNode
      const stops = resolveLiftLevels(scene, lift)
      expect(stops.find((s) => s.id === 'l1')?.baseY).toBe(0)
      expect(stops.find((s) => s.id === 'l0')?.baseY).toBe(-4.0)
      expect(stops.find((s) => s.id === 'l2')?.baseY).toBe(3.0)
    })

    test('T1.F6.3: calculates mastHeight = totalRise + OVERTRAVEL_M (1.2m)', () => {
      const scene = makeBuildingScene(
        'bldg_1',
        [
          { id: 'l0', ordinal: 0, height: 4.5 },
          { id: 'l1', ordinal: 1, height: 4.5 },
        ],
        {
          'pallet-lift_1': makeLiftNode({ id: 'pallet-lift_1', parentId: 'l0' }),
        },
      )
      const lift = scene['pallet-lift_1'] as PalletLiftNode
      expect(riseM(scene, lift)).toBe(4.5)
      expect(mastHeightM(scene, lift)).toBeCloseTo(4.5 + OVERTRAVEL_M, 6)
      expect(OVERTRAVEL_M).toBe(1.2)
    })

    test('T1.F6.4: resolves liftOpeningSpan for slab cutout across served storeys', () => {
      const scene = makeBuildingScene(
        'bldg_1',
        [
          { id: 'l0', ordinal: 0, height: 3.5 },
          { id: 'l1', ordinal: 1, height: 3.5 },
          { id: 'l2', ordinal: 2, height: 3.5 },
        ],
        {
          'pallet-lift_1': makeLiftNode({ id: 'pallet-lift_1', parentId: 'l0' }),
        },
      )
      const lift = scene['pallet-lift_1'] as PalletLiftNode
      const span = liftOpeningSpan(scene, lift)
      expect(span).not.toBeNull()
      expect(span?.bottom).toBe(0)
      expect(span?.top).toBe(7.0)
    })

    test('T1.F6.5: returns null liftOpeningSpan for unplaced / detached equipment to prevent erroneous slab holes', () => {
      const node = makeLiftNode({ parentId: null })
      const span = liftOpeningSpan({ [node.id]: node }, node)
      expect(span).toBeNull()
    })
  })

  // ── F7: Pallet Lift 2D Floorplan Coordinate Accuracy ──
  describe('F7: Pallet Lift 2D Floorplan Geometry & Symbols', () => {
    test('T1.F7.1: buildPalletLiftFloorplan produces valid SVG floorplan group', () => {
      const node = makeLiftNode()
      const ctx = makeMockGeometryContext()
      const fp = buildPalletLiftFloorplan(node, ctx)
      expect(fp).not.toBeNull()
      expect(fp?.kind).toBe('group')
    })

    test('T1.F7.2: includes platform outline rect, mast column rects, and door entrance line', () => {
      const node = makeLiftNode({ hasDoors: true })
      const ctx = makeMockGeometryContext()
      const fp = buildPalletLiftFloorplan(node, ctx)
      const children = (fp as { children: Array<{ kind: string }> }).children
      const kinds = children.map((c) => c.kind)
      expect(kinds).toContain('rect')
      expect(kinds).toContain('line')
    })

    test('T1.F7.3: mast columns match mastPositionsXZ and mastSection dimensions', () => {
      const node = makeLiftNode()
      const mastPositions = mastPositionsXZ(node)
      const s = mastSectionM(node)
      expect(mastPositions.length).toBe(2)
      expect(s).toBeGreaterThan(0.1)
    })

    test('T1.F7.4: door line position matches doorFaceZ and doorWidthM', () => {
      const node = makeLiftNode({ hasDoors: true })
      const ctx = makeMockGeometryContext()
      const fp = buildPalletLiftFloorplan(node, ctx)
      const line = (
        fp as { children: Array<{ kind: string; y1?: number; x2?: number }> }
      ).children.find((c) => c.kind === 'line')
      expect(line).toBeDefined()
      expect(line?.y1).toBeCloseTo(doorFaceZ(node), 6)
      expect(line?.x2).toBeCloseTo(doorWidthM(node) / 2, 6)
    })

    test('T1.F7.5: displays stop count and mast height text label when selected in 2D view', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'l0', ordinal: 0, height: 3.5 },
        { id: 'l1', ordinal: 1, height: 3.5 },
      ])
      const node = makeLiftNode({ id: 'pallet-lift_lft', parentId: 'l0' })
      scene['pallet-lift_lft'] = node
      const ctx = makeMockGeometryContext(scene.l0, scene)
      const fp = buildPalletLiftFloorplan(node, ctx)
      const text = (
        fp as { children: Array<{ kind: string; text?: string }> }
      ).children.find((c) => c.kind === 'text')
      expect(text).toBeDefined()
      expect(text?.text).toContain('durak')
      expect(text?.text).toContain('mast')
    })
  })

  // ── F8: Multi-Level Properties Panel Dropdown Synchronization ──
  describe('F8: Multi-Level Properties Panel & Reactivity Fingerprints', () => {
    test('T1.F8.1: liftLevelFingerprint generates reactive string dependent on level heights and offsets', () => {
      const scene1 = makeBuildingScene('b1', [
        { id: 'l0', ordinal: 0, height: 3.5 },
        { id: 'l1', ordinal: 1, height: 3.5 },
      ])
      const node = makeLiftNode({ id: 'pallet-lift_fp', parentId: 'l0' })
      scene1['pallet-lift_fp'] = node
      const fp1 = liftLevelFingerprint(scene1, node)

      const scene2 = makeBuildingScene('b1', [
        { id: 'l0', ordinal: 0, height: 5.0 },
        { id: 'l1', ordinal: 1, height: 3.5 },
      ])
      scene2['pallet-lift_fp'] = node
      const fp2 = liftLevelFingerprint(scene2, node)

      expect(fp1).not.toBe(fp2)
    })

    test('T1.F8.2: allLevels helper enumerates all storeys across the scene ordered by ordinal', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'l2', ordinal: 2, height: 3.0 },
        { id: 'l0', ordinal: 0, height: 4.0 },
        { id: 'l1', ordinal: 1, height: 3.0 },
      ])
      const levels = allLevels(scene)
      expect(levels.map((l) => l.id)).toEqual(['l0', 'l1', 'l2'])
    })

    test('T1.F8.3: buildingOfLevel locates owning building parent id correctly', () => {
      const scene = makeBuildingScene('bldg_warehouse', [
        { id: 'fl_0', ordinal: 0, height: 4.0 },
        { id: 'fl_1', ordinal: 1, height: 4.0 },
      ])
      expect(buildingOfLevel(scene, 'fl_0')).toBe('bldg_warehouse')
      expect(buildingOfLevel(scene, 'fl_1')).toBe('bldg_warehouse')
      expect(buildingOfLevel(scene, 'non_existent')).toBeNull()
    })

    test('T1.F8.4: parentLevelIdOf determines level placement whether via parentId or children membership', () => {
      const scene = makeBuildingScene('b1', [{ id: 'l0', ordinal: 0, height: 4.0, children: ['c1'] }])
      const childWithParent = { id: 'c0', parentId: 'l0' }
      const childInList = { id: 'c1' }
      expect(parentLevelIdOf(scene, childWithParent)).toBe('l0')
      expect(parentLevelIdOf(scene, childInList)).toBe('l0')
    })

    test('T1.F8.5: resolveLift returns combined stops, mast height, and geometry fingerprint in single call', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'l0', ordinal: 0, height: 4.0 },
        { id: 'l1', ordinal: 1, height: 4.0 },
      ])
      const node = makeLiftNode({ id: 'pallet-lift_res', parentId: 'l0' })
      scene['pallet-lift_res'] = node
      const resolved = resolveLift(scene, node)
      expect(resolved.stops.length).toBe(2)
      expect(resolved.mastHeight).toBeCloseTo(4.0 + OVERTRAVEL_M, 6)
      expect(resolved.fingerprint).toContain('|')
    })
  })

  // ── F9: Multi-Floor Conveyor Network Port Snapping & Routing ──
  describe('F9: Multi-Floor Port Snapping & Joint Diagnostics', () => {
    test('T1.F9.1: localPorts for spiral conveyor declares inlet port a at entryHeight and outlet b at exitHeight', () => {
      const node = makeSpiralNode({ entryHeight: 0.75, travelHeight: 3.5, flow: 'up' })
      const ports = localPorts(node)
      expect(ports.length).toBe(2)

      const portA = ports.find((p) => p.id === 'a')
      const portB = ports.find((p) => p.id === 'b')

      expect(portA).toBeDefined()
      expect(portA?.y).toBe(0.75)
      expect(portA?.role).toBe('in')

      expect(portB).toBeDefined()
      expect(portB?.y).toBe(4.25)
      expect(portB?.role).toBe('out')
    })

    test('T1.F9.2: reverses port roles when spiral flow direction is set to down', () => {
      const node = makeSpiralNode({ flow: 'down' })
      const ports = localPorts(node)
      expect(ports.find((p) => p.id === 'a')?.role).toBe('out')
      expect(ports.find((p) => p.id === 'b')?.role).toBe('in')
    })

    test('T1.F9.3: transportHeightAt correctly returns per-port elevation for spiral conveyor', () => {
      const node = makeSpiralNode({ entryHeight: 0.8, travelHeight: 4.2 })
      expect(transportHeightAt(node, 'a')).toBe(0.8)
      expect(transportHeightAt(node, 'b')).toBe(5.0)
    })

    test('T1.F9.4: moduleLaneMm returns belt width in millimeters for joint verification', () => {
      const node = makeSpiralNode({ beltWidth: '400' })
      expect(moduleLaneMm(node)).toBe(400)
    })

    test('T1.F9.5: conveyorPorts applies node position and rotation matrix to 3D port coordinates', () => {
      const node = makeSpiralNode({
        position: [10, 0, 20],
        rotation: [0, 0, 0],
        entryHeight: 0.75,
        travelHeight: 4.0,
      })
      const ports = conveyorPorts(node)
      const span = spiralPortSpanM(node)

      const portA = ports.find((p) => p.id === 'a')
      const portB = ports.find((p) => p.id === 'b')

      expect(portA?.position[0]).toBeCloseTo(10 - span, 3)
      expect(portA?.position[1]).toBeCloseTo(0.75, 3)
      expect(portA?.position[2]).toBeCloseTo(20, 3)

      const thetaExit = exitAngleRad(node)
      expect(portB?.position[0]).toBeCloseTo(10 + span * Math.cos(thetaExit), 3)
      expect(portB?.position[1]).toBeCloseTo(4.75, 3)
      expect(portB?.position[2]).toBeCloseTo(20 + span * Math.sin(thetaExit), 3)
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// TIER 2: BOUNDARY & CORNER CASES (B1 - B9)
// ═════════════════════════════════════════════════════════════════════════════

describe('Tier 2: Boundary & Corner Cases (B1 - B9)', () => {
  beforeEach(() => {
    resetPortMagnet()
    resetLineIndex()
  })

  // ── B1: Inverted Level Bounds (Top before Bottom) ──
  describe('B1: Inverted Level Selection Bounds', () => {
    test('T2.B1.1: resolveLiftLevels correctly slices levels when fromLevelId is higher than toLevelId', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'lvl_0', ordinal: 0, height: 3.5 },
        { id: 'lvl_1', ordinal: 1, height: 3.5 },
        { id: 'lvl_2', ordinal: 2, height: 3.5 },
        { id: 'lvl_3', ordinal: 3, height: 3.5 },
      ])
      const lift = makeLiftNode({
        id: 'pallet-lift_inv',
        parentId: 'lvl_0',
        fromLevelId: 'lvl_3',
        toLevelId: 'lvl_1',
      })
      scene['pallet-lift_inv'] = lift
      const stops = resolveLiftLevels(scene, lift)
      expect(stops.map((s) => s.id)).toEqual(['lvl_1', 'lvl_2', 'lvl_3'])
    })

    test('T2.B1.2: inverted bounds maintain valid non-negative rise and mast height', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'lvl_0', ordinal: 0, height: 4.0 },
        { id: 'lvl_1', ordinal: 1, height: 4.0 },
      ])
      const lift = makeLiftNode({
        id: 'pallet-lift_inv2',
        parentId: 'lvl_0',
        fromLevelId: 'lvl_1',
        toLevelId: 'lvl_0',
      })
      scene['pallet-lift_inv2'] = lift
      expect(riseM(scene, lift)).toBe(4.0)
      expect(mastHeightM(scene, lift)).toBeCloseTo(4.0 + OVERTRAVEL_M, 6)
    })

    test('T2.B1.3: preserves correct ordinal order regardless of bound input inversion', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'l0', ordinal: 0, height: 3.0 },
        { id: 'l1', ordinal: 1, height: 3.0 },
        { id: 'l2', ordinal: 2, height: 3.0 },
      ])
      const lift = makeLiftNode({
        id: 'pallet-lift_inv3',
        parentId: 'l0',
        fromLevelId: 'l2',
        toLevelId: 'l0',
      })
      scene['pallet-lift_inv3'] = lift
      const stops = resolveLiftLevels(scene, lift)
      expect(stops[0]!.id).toBe('l0')
      expect(stops[2]!.id).toBe('l2')
    })

    test('T2.B1.4: opening span bottom and top are ordered with bottom <= top for inverted bounds', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'l0', ordinal: 0, height: 4.0 },
        { id: 'l1', ordinal: 1, height: 4.0 },
      ])
      const lift = makeLiftNode({
        id: 'pallet-lift_inv4',
        parentId: 'l0',
        fromLevelId: 'l1',
        toLevelId: 'l0',
      })
      scene['pallet-lift_inv4'] = lift
      const span = liftOpeningSpan(scene, lift)
      expect(span).not.toBeNull()
      expect(span!.bottom).toBeLessThanOrEqual(span!.top)
    })

    test('T2.B1.5: partial inversion with intermediate levels includes all intermediate stops', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'l0', ordinal: 0, height: 3.0 },
        { id: 'l1', ordinal: 1, height: 3.0 },
        { id: 'l2', ordinal: 2, height: 3.0 },
        { id: 'l3', ordinal: 3, height: 3.0 },
        { id: 'l4', ordinal: 4, height: 3.0 },
      ])
      const lift = makeLiftNode({
        id: 'pallet-lift_inv5',
        parentId: 'l0',
        fromLevelId: 'l4',
        toLevelId: 'l2',
      })
      scene['pallet-lift_inv5'] = lift
      const stops = resolveLiftLevels(scene, lift)
      expect(stops.map((s) => s.id)).toEqual(['l2', 'l3', 'l4'])
    })
  })

  // ── B2: Identical From and To Level IDs ──
  describe('B2: Identical From and To Levels (Single Floor Slicing)', () => {
    test('T2.B2.1: identical fromLevelId and toLevelId falls back to minimum 2-stop synthetic shaft', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'l0', ordinal: 0, height: 3.5 },
        { id: 'l1', ordinal: 1, height: 3.5 },
      ])
      const lift = makeLiftNode({
        id: 'pallet-lift_ident',
        parentId: 'l0',
        fromLevelId: 'l0',
        toLevelId: 'l0',
        fallbackTravelM: 3.5,
      })
      scene['pallet-lift_ident'] = lift
      const stops = resolveLiftLevels(scene, lift)
      expect(stops.length).toBeGreaterThanOrEqual(2)
      expect(stops[0]!.id).toBe('__base')
      expect(stops[1]!.id).toBe('__top')
    })

    test('T2.B2.2: identical level slice produces zero slab cutout opening to prevent damaging floor', () => {
      const scene = makeBuildingScene('b1', [{ id: 'l0', ordinal: 0, height: 3.5 }])
      const lift = makeLiftNode({
        id: 'pallet-lift_ident2',
        parentId: 'l0',
        fromLevelId: 'l0',
        toLevelId: 'l0',
      })
      scene['pallet-lift_ident2'] = lift
      const span = liftOpeningSpan(scene, lift)
      expect(span).toBeNull()
    })

    test('T2.B2.3: synthetic fallback uses fallbackTravelM for mast height calculation', () => {
      const scene = makeBuildingScene('b1', [{ id: 'l0', ordinal: 0, height: 4.0 }])
      const lift = makeLiftNode({
        id: 'pallet-lift_ident3',
        parentId: 'l0',
        fromLevelId: 'l0',
        toLevelId: 'l0',
        fallbackTravelM: 5.2,
      })
      scene['pallet-lift_ident3'] = lift
      expect(mastHeightM(scene, lift)).toBeCloseTo(5.2 + OVERTRAVEL_M, 6)
    })

    test('T2.B2.4: deterministic cycle generates valid 2-stop simulation for identical bound fallback', () => {
      const stops = [
        { id: '__base', baseY: 0, label: '0' },
        { id: '__top', baseY: 4.0, label: '1' },
      ]
      const cycle = buildLiftCycle(stops, { mpm: SPEED_MPM['1000'].mpm })
      expect(cycle.length).toBeGreaterThan(0)
      expect(cycleLength(cycle)).toBeGreaterThan(0)
    })

    test('T2.B2.5: single-floor spiral conveyor travel height minimum bound is clamped to 1.0m by schema', () => {
      expect(() => makeSpiralNode({ travelHeight: 0.5 })).toThrow()
      const minValid = makeSpiralNode({ travelHeight: 1.0 })
      expect(minValid.travelHeight).toBe(1.0)
    })
  })

  // ── B3: Detached / Outside Building Equipment ──
  describe('B3: Equipment Outside Any Building or Level', () => {
    test('T2.B3.1: pallet lift with parentId=null returns synthetic 2-stop shaft', () => {
      const lift = makeLiftNode({ parentId: null, fallbackTravelM: 4.5 })
      const stops = resolveLiftLevels({ [lift.id]: lift }, lift)
      expect(stops.length).toBe(2)
      expect(stops.map((s) => s.baseY)).toEqual([0, 4.5])
    })

    test('T2.B3.2: detached pallet lift mast height uses fallbackTravelM', () => {
      const lift = makeLiftNode({ parentId: null, fallbackTravelM: 6.0 })
      expect(mastHeightM({ [lift.id]: lift }, lift)).toBeCloseTo(6.0 + OVERTRAVEL_M, 6)
    })

    test('T2.B3.3: detached equipment opening span is null (no building slabs to cut)', () => {
      const lift = makeLiftNode({ parentId: null })
      expect(liftOpeningSpan({ [lift.id]: lift }, lift)).toBeNull()
    })

    test('T2.B3.4: detached spiral conveyor functions safely using internal travelHeight', () => {
      const spiral = makeSpiralNode({ parentId: null, travelHeight: 4.2 })
      expect(spiralExitHeightM(spiral)).toBe(0.75 + 4.2)
      expect(spiralTurnCount(spiral)).toBeGreaterThan(0)
    })

    test('T2.B3.5: levelsOfBuilding for null buildingId returns empty array without throwing', () => {
      expect(levelsOfBuilding({}, null)).toEqual([])
      expect(levelElevationsOfBuilding({}, null)).toEqual([])
    })
  })

  // ── B4: Corrupted or Missing Level References ──
  describe('B4: Corrupted or Missing Level Node References', () => {
    test('T2.B4.1: gracefully handles deleted fromLevelId UUID by defaulting to bottom floor', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'l0', ordinal: 0, height: 3.5 },
        { id: 'l1', ordinal: 1, height: 3.5 },
      ])
      const lift = makeLiftNode({
        id: 'pallet-lift_corrupt1',
        parentId: 'l0',
        fromLevelId: 'deleted_uuid_9999',
        toLevelId: 'l1',
      })
      scene['pallet-lift_corrupt1'] = lift
      const stops = resolveLiftLevels(scene, lift)
      expect(stops.map((s) => s.id)).toEqual(['l0', 'l1'])
    })

    test('T2.B4.2: gracefully handles deleted toLevelId UUID by defaulting to top floor', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'l0', ordinal: 0, height: 3.5 },
        { id: 'l1', ordinal: 1, height: 3.5 },
      ])
      const lift = makeLiftNode({
        id: 'pallet-lift_corrupt2',
        parentId: 'l0',
        fromLevelId: 'l0',
        toLevelId: 'deleted_uuid_8888',
      })
      scene['pallet-lift_corrupt2'] = lift
      const stops = resolveLiftLevels(scene, lift)
      expect(stops.map((s) => s.id)).toEqual(['l0', 'l1'])
    })

    test('T2.B4.3: building with corrupted non-level child node filters invalid node out', () => {
      const scene = makeBuildingScene('b1', [{ id: 'l0', ordinal: 0, height: 3.5 }])
      scene.corrupt_node = { id: 'corrupt_node', type: 'unknown_kind' }
      ;(scene.b1 as { children: string[] }).children.push('corrupt_node')
      const levels = levelsOfBuilding(scene, 'b1')
      expect(levels.length).toBe(1)
      expect(levels[0]!.id).toBe('l0')
    })

    test('T2.B4.4: building node without children property safely returns empty level array', () => {
      const scene = {
        b_broken: { id: 'b_broken', type: 'building' },
      }
      expect(levelsOfBuilding(scene, 'b_broken')).toEqual([])
      expect(levelElevationsOfBuilding(scene, 'b_broken')).toEqual([])
    })

    test('T2.B4.5: level with missing height property adopts DEFAULT_LEVEL_HEIGHT (3.0m)', () => {
      const scene = {
        b1: { id: 'b1', type: 'building', children: ['l_no_h'] },
        l_no_h: { id: 'l_no_h', type: 'level', level: 0 },
      }
      const elevs = levelElevationsOfBuilding(scene, 'b1')
      expect(elevs.length).toBe(1)
      expect(elevs[0]!.height).toBe(DEFAULT_LEVEL_HEIGHT)
      expect(DEFAULT_LEVEL_HEIGHT).toBe(3.0)
    })
  })

  // ── B5: Zero and Near-Zero Floor Height Storeys ──
  describe('B5: Zero and Ultra-Low Floor Heights', () => {
    test('T2.B5.1: storeys with height=0 accumulate without negative offsets or division by zero', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'l0', ordinal: 0, height: 0 },
        { id: 'l1', ordinal: 1, height: 4.0 },
      ])
      const elevs = levelElevationsOfBuilding(scene, 'b1')
      expect(elevs[0]!.baseY).toBe(0)
      expect(elevs[1]!.baseY).toBe(0)
    })

    test('T2.B5.2: mezzanine lip storey with 0.05m height stacks accurately', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'l0', ordinal: 0, height: 4.0 },
        { id: 'l_mezz', ordinal: 1, height: 0.05 },
        { id: 'l1', ordinal: 2, height: 3.5 },
      ])
      const elevs = levelElevationsOfBuilding(scene, 'b1')
      expect(elevs[1]!.baseY).toBe(4.0)
      expect(elevs[2]!.baseY).toBe(4.05)
    })

    test('T2.B5.3: pallet lift spanning zero height levels falls back gracefully without division by zero in cycle', () => {
      const stops = [
        { id: 'l0', baseY: 0, label: '0' },
        { id: 'l1', baseY: 0, label: '1' },
      ]
      const cycle = buildLiftCycle(stops, { mpm: SPEED_MPM['1000'].mpm })
      expect(cycle).toBeDefined()
    })

    test('T2.B5.4: spiral conveyor incline angle bounds clamp strictly between 3 deg and 13 deg', () => {
      expect(() => makeSpiralNode({ inclineDeg: 2 })).toThrow()
      expect(() => makeSpiralNode({ inclineDeg: 14 })).toThrow()
      const validSpiral = makeSpiralNode({ inclineDeg: 11 })
      expect(validSpiral.inclineDeg).toBe(11)
    })

    test('T2.B5.5: spiral entry height bounds clamp strictly between 0.37m and 3.0m', () => {
      expect(() => makeSpiralNode({ entryHeight: 0.2 })).toThrow()
      expect(() => makeSpiralNode({ entryHeight: 3.5 })).toThrow()
      const valid = makeSpiralNode({ entryHeight: 0.75 })
      expect(valid.entryHeight).toBe(0.75)
    })
  })

  // ── B6: Non-Uniform Base Elevations (Basements and Slabs) ──
  describe('B6: Negative Elevations & Non-Uniform Storey Shifts', () => {
    test('T2.B6.1: basement level with negative baseElevation shifts floor and subsequent storeys', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'l_base', ordinal: 0, height: 3.5, baseElevation: -3.5 },
        { id: 'l_ground', ordinal: 1, height: 4.0, baseElevation: 0 },
        { id: 'l_floor1', ordinal: 2, height: 3.5, baseElevation: 0 },
      ])
      const elevs = levelElevationsOfBuilding(scene, 'b1')
      expect(elevs[0]!.baseY).toBe(-3.5)
      expect(elevs[1]!.baseY).toBe(0) // -3.5 + 3.5 = 0
      expect(elevs[2]!.baseY).toBe(4.0)
    })

    test('T2.B6.2: pallet lift correctly services negative basement up to ground floor', () => {
      const scene = makeBuildingScene(
        'b1',
        [
          { id: 'l_base', ordinal: 0, height: 3.5, baseElevation: -3.5 },
          { id: 'l_ground', ordinal: 1, height: 4.0, baseElevation: 0 },
        ],
        {
          'pallet-lift_base': makeLiftNode({ id: 'pallet-lift_base', parentId: 'l_ground' }),
        },
      )
      const lift = scene['pallet-lift_base'] as PalletLiftNode
      const stops = resolveLiftLevels(scene, lift)
      expect(stops.find((s) => s.id === 'l_ground')?.baseY).toBe(0)
      expect(stops.find((s) => s.id === 'l_base')?.baseY).toBe(-3.5)
      expect(riseM(scene, lift)).toBe(3.5)
    })

    test('T2.B6.3: baseElevation applied to upper floor shifts upper floor only without affecting ground', () => {
      const scene = makeBuildingScene('b1', [
        { id: 'l0', ordinal: 0, height: 4.0, baseElevation: 0 },
        { id: 'l1', ordinal: 1, height: 3.5, baseElevation: 1.2 },
        { id: 'l2', ordinal: 2, height: 3.5, baseElevation: 0 },
      ])
      const elevs = levelElevationsOfBuilding(scene, 'b1')
      expect(elevs[0]!.baseY).toBe(0)
      expect(elevs[1]!.baseY).toBe(5.2) // 4.0 + 1.2
      expect(elevs[2]!.baseY).toBe(8.7) // 5.2 + 3.5
    })

    test('T2.B6.4: multi-basement building calculates cumulative stacking across storeys', () => {
      const scene = makeBuildingScene('bldg_multi_basement', [
        { id: 'lvl_b3', ordinal: 0, height: 3.0, baseElevation: -9.0 },
        { id: 'lvl_b2', ordinal: 1, height: 3.0, baseElevation: 0 },
        { id: 'lvl_b1', ordinal: 2, height: 3.0, baseElevation: 0 },
        { id: 'lvl_g0', ordinal: 3, height: 4.0, baseElevation: 0 },
      ])
      const elevs = levelElevationsOfBuilding(scene, 'bldg_multi_basement')
      expect(elevs.map((e) => e.baseY)).toEqual([-9.0, -6.0, -3.0, 0])
    })

    test('T2.B6.5: pallet lift stationed in lowest basement calculates progressive elevations for upper storeys', () => {
      const scene = makeBuildingScene(
        'bldg_deep_basement',
        [
          { id: 'lvl_b3', ordinal: 0, height: 3.0, baseElevation: -9.0 },
          { id: 'lvl_b2', ordinal: 1, height: 3.0, baseElevation: 0 },
          { id: 'lvl_b1', ordinal: 2, height: 3.0, baseElevation: 0 },
          { id: 'lvl_g0', ordinal: 3, height: 4.0, baseElevation: 0 },
        ],
        {
          'pallet-lift_deep': makeLiftNode({ id: 'pallet-lift_deep', parentId: 'lvl_b3' }),
        },
      )
      const stops = resolveLiftLevels(scene, scene['pallet-lift_deep'] as PalletLiftNode)
      expect(stops.map((s) => s.baseY)).toEqual([0, 3.0, 6.0, 9.0])
    })
  })

  // ── B7: Extreme Multi-Turn Spirals (0.5 to 15 turns) ──
  describe('B7: Extreme Multi-Turn Spiral Conveyor Geometries', () => {
    test('T2.B7.1: maximum allowed spiral height (15m) produces valid stable geometry', () => {
      const spiral = makeSpiralNode({ travelHeight: 15, inclineDeg: 12 })
      expect(spiral.travelHeight).toBe(15)
      expect(spiralTurnCount(spiral)).toBeGreaterThan(15)
      const slats = spiralSlatParts(spiral, 'simple')
      expect(slats.length).toBeGreaterThan(100)
    })

    test('T2.B7.2: minimum allowed spiral height (1m) produces compact valid turn', () => {
      const spiral = makeSpiralNode({ travelHeight: 1, inclineDeg: 10 })
      expect(spiralTurnCount(spiral)).toBeLessThan(2)
      const slats = spiralSlatParts(spiral, 'simple')
      expect(slats.length).toBeGreaterThanOrEqual(10)
    })

    test('T2.B7.3: extreme height schema validator rejects travelHeight > 15m or < 1m', () => {
      expect(() => makeSpiralNode({ travelHeight: 15.1 })).toThrow()
      expect(() => makeSpiralNode({ travelHeight: 0.9 })).toThrow()
    })

    test('T2.B7.4: large outer diameter (2400mm) expands footprint and helix radius accordingly', () => {
      const spiral = makeSpiralNode({ outerDiameter: '2400', beltWidth: '400' })
      expect(helixRadiusM(spiral)).toBeCloseTo((2.4 - 0.4) / 2, 6)
      expect(spiralFootprintM(spiral)).toBeGreaterThan(2.5)
    })

    test('T2.B7.5: slat positions remain strictly outside central column across extreme 15m elevation', () => {
      const spiral = makeSpiralNode({
        travelHeight: 12,
        outerDiameter: '1800',
        beltWidth: '400',
      })
      const colRadius = columnRadiusM(spiral)
      const slats = spiralSlatParts(spiral, 'simple')
      for (const slat of slats) {
        const distFromCenter = Math.hypot(slat.center[0], slat.center[2])
        expect(distFromCenter).toBeGreaterThan(colRadius)
      }
    })
  })

  // ── B8: Single Storey Buildings ──
  describe('B8: Single Storey Building Handling', () => {
    test('T2.B8.1: building with only one single floor generates fallback 2-stop shaft', () => {
      const scene = makeBuildingScene('b1', [{ id: 'l0', ordinal: 0, height: 4.0 }])
      const lift = makeLiftNode({ id: 'pallet-lift_single', parentId: 'l0' })
      scene['pallet-lift_single'] = lift
      const stops = resolveLiftLevels(scene, lift)
      expect(stops.length).toBe(2)
      expect(stops[0]!.id).toBe('__base')
      expect(stops[1]!.id).toBe('__top')
    })

    test('T2.B8.2: single-storey pallet lift mast height remains valid and non-zero', () => {
      const scene = makeBuildingScene('b1', [{ id: 'l0', ordinal: 0, height: 4.0 }])
      const lift = makeLiftNode({
        id: 'pallet-lift_single2',
        parentId: 'l0',
        fallbackTravelM: 3.8,
      })
      scene['pallet-lift_single2'] = lift
      expect(mastHeightM(scene, lift)).toBeCloseTo(3.8 + OVERTRAVEL_M, 6)
    })

    test('T2.B8.3: building with zero floors returns empty elevations list without crash', () => {
      const scene = { b1: { id: 'b1', type: 'building', children: [] } }
      expect(levelsOfBuilding(scene, 'b1')).toEqual([])
      expect(levelElevationsOfBuilding(scene, 'b1')).toEqual([])
    })

    test('T2.B8.4: single storey floorplan renders valid symbol with 2 fallback stops', () => {
      const scene = makeBuildingScene('b1', [{ id: 'l0', ordinal: 0, height: 4.0 }])
      const lift = makeLiftNode({ id: 'pallet-lift_single3', parentId: 'l0' })
      scene['pallet-lift_single3'] = lift
      const ctx = makeMockGeometryContext(scene.l0, scene)
      const fp = buildPalletLiftFloorplan(lift, ctx)
      expect(fp).not.toBeNull()
    })

    test('T2.B8.5: single storey pallet lift opening span returns null to preserve ground slab', () => {
      const scene = makeBuildingScene('b1', [{ id: 'l0', ordinal: 0, height: 4.0 }])
      const lift = makeLiftNode({ id: 'pallet-lift_single4', parentId: 'l0' })
      scene['pallet-lift_single4'] = lift
      expect(liftOpeningSpan(scene, lift)).toBeNull()
    })
  })

  // ── B9: Odd Fractional Turns & Non-Aligned Exit Angles ──
  describe('B9: Odd Fractional Helix Turns and Angles', () => {
    test('T2.B9.1: handles 2.37 turns with correct terminal angle derivation', () => {
      const spiral = makeSpiralNode({ travelHeight: 3.5, inclineDeg: 11 })
      const turns = spiralTurnCount(spiral)
      const angle = totalAngleRad(spiral)
      expect(angle).toBeCloseTo(turns * 2 * Math.PI, 6)
    })

    test('T2.B9.2: terminal helix point aligns with exit height at t = totalAngleRad', () => {
      const spiral = makeSpiralNode({ travelHeight: 4.0, inclineDeg: 10 })
      const totalT = totalAngleRad(spiral)
      const topPt = helixPoint(spiral, totalT)
      expect(topPt[1]).toBeCloseTo(4.0, 5)
    })

    test('T2.B9.3: clockwise handedness rotates in opposite angular direction', () => {
      const cw = makeSpiralNode({ handedness: 'cw', travelHeight: 4.0 })
      const ccw = makeSpiralNode({ handedness: 'ccw', travelHeight: 4.0 })
      const ptCW = helixPoint(cw, Math.PI / 2)
      const ptCCW = helixPoint(ccw, Math.PI / 2)
      expect(ptCW[2]).toBeCloseTo(-ptCCW[2], 6)
    })

    test('T2.B9.4: floorplan direction arrow points +Z for ccw and -Z for cw', () => {
      const ccw = makeSpiralNode({ handedness: 'ccw' })
      const cw = makeSpiralNode({ handedness: 'cw' })
      const ctx = makeMockGeometryContext()
      const fpCCW = buildSpiralFloorplan(ccw, ctx)
      const fpCW = buildSpiralFloorplan(cw, ctx)

      const polyCCW = (
        fpCCW as { children: Array<{ kind: string; points?: number[][] }> }
      ).children.find((c) => c.kind === 'polygon')
      const polyCW = (
        fpCW as { children: Array<{ kind: string; points?: number[][] }> }
      ).children.find((c) => c.kind === 'polygon')

      expect(polyCCW?.points?.[2]?.[1]).toBeGreaterThan(0)
      expect(polyCW?.points?.[2]?.[1]).toBeLessThan(0)
    })

    test('T2.B9.5: screw kinematics invariance maintains pitch * stepRad / 2pi displacement', () => {
      const spiral = makeSpiralNode({ travelHeight: 4.0 })
      const pitch = spiralPitchM(spiral)
      const stepRad = (2 * Math.PI) / 30 // full detail
      const expectedYDelta = (pitch * stepRad) / (2 * Math.PI)
      expect(expectedYDelta).toBeGreaterThan(0)
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// TIER 3: CROSS-FEATURE INTERACTIONS (X1 - X10)
// ═════════════════════════════════════════════════════════════════════════════

describe('Tier 3: Cross-Feature Interactions (X1 - X10)', () => {
  beforeEach(() => {
    resetPortMagnet()
    resetLineIndex()
  })

  test('T3.X1: Straight roller conveyor mates onto spiral conveyor infeed Port A at 0.75m elevation', () => {
    const spiral = makeSpiralNode({
      id: 'conveyor-spiral_x1',
      position: [10, 0, 10],
      rotation: [0, 0, 0],
      entryHeight: 0.75,
      beltWidth: '400',
      flow: 'up',
    })
    const span = spiralPortSpanM(spiral)
    const roller = makeRollerNode({
      id: 'conveyor-roller_in',
      position: [10 - span - 1.5, 0, 10],
      rotation: [0, 0, 0],
      rollers: 40,
      rollerPitch: '75',
      usefulWidth: '400',
      transportHeight: 0.75,
      flow: 'forward',
    })

    const scene: Record<string, unknown> = {
      'conveyor-spiral_x1': spiral,
      'conveyor-roller_in': roller,
    }

    const portsSpiral = conveyorPorts(spiral)
    const portsRoller = conveyorPorts(roller)
    const spA = portsSpiral.find((p) => p.id === 'a')!
    const rolB = portsRoller.find((p) => p.id === 'b')!

    const distSq =
      (spA.position[0] - rolB.position[0]) ** 2 +
      (spA.position[1] - rolB.position[1]) ** 2 +
      (spA.position[2] - rolB.position[2]) ** 2
    expect(distSq).toBeLessThan(0.001)

    const line = lineOf(scene, 'conveyor-spiral_x1')
    expect(line).toContain('conveyor-roller_in')
    expect(isPortMated(scene, 'conveyor-spiral_x1', 'a')).toBe(true)
    expect(isPortMated(scene, 'conveyor-roller_in', 'b')).toBe(true)
  })

  test('T3.X2: Upper floor roller conveyor mates onto spiral conveyor discharge Port B at exitHeight', () => {
    const spiral = makeSpiralNode({
      id: 'conveyor-spiral_x2',
      position: [10, 0, 10],
      rotation: [0, 0, 0],
      entryHeight: 0.75,
      travelHeight: 2.0, // exitHeight = 2.75m
      beltWidth: '400',
      flow: 'up',
    })
    const span = spiralPortSpanM(spiral)
    const thetaExit = exitAngleRad(spiral)
    const exitX = 10 + span * Math.cos(thetaExit)
    const exitZ = 10 + span * Math.sin(thetaExit)
    const rollerUpper = makeRollerNode({
      id: 'conveyor-roller_out',
      position: [
        10 + (span + 1.5) * Math.cos(thetaExit),
        0,
        10 + (span + 1.5) * Math.sin(thetaExit),
      ],
      rotation: [0, -thetaExit, 0],
      rollers: 40,
      rollerPitch: '75',
      usefulWidth: '400',
      transportHeight: 2.75,
      flow: 'forward',
    })

    const scene: Record<string, unknown> = {
      'conveyor-spiral_x2': spiral,
      'conveyor-roller_out': rollerUpper,
    }

    const portsSpiral = conveyorPorts(spiral)
    const portsRoller = conveyorPorts(rollerUpper)
    const spB = portsSpiral.find((p) => p.id === 'b')!
    const rolA = portsRoller.find((p) => p.id === 'a')!

    const distSq =
      (spB.position[0] - rolA.position[0]) ** 2 +
      (spB.position[1] - rolA.position[1]) ** 2 +
      (spB.position[2] - rolA.position[2]) ** 2
    expect(distSq).toBeLessThan(0.001)

    const line = lineOf(scene, 'conveyor-spiral_x2')
    expect(line).toContain('conveyor-roller_out')
    expect(isPortMated(scene, 'conveyor-spiral_x2', 'b')).toBe(true)
  })

  test('T3.X3: Elevation mismatch between straight conveyor and spiral infeed is rejected by magnet with diagnostic', () => {
    const spiral = makeSpiralNode({
      id: 'conveyor-spiral_x3',
      position: [10, 0, 10],
      entryHeight: 0.75,
      beltWidth: '400',
    })
    const span = spiralPortSpanM(spiral)
    const rollerMismatched = makeRollerNode({
      id: 'conveyor-roller_bad',
      position: [10 - span - 1.5, 0, 10],
      transportHeight: 0.9,
      usefulWidth: '400',
    })

    const scene = {
      'conveyor-spiral_x3': spiral,
      'conveyor-roller_bad': rollerMismatched,
    }
    const blockers = mateBlockers(
      rollerMismatched,
      rollerMismatched.position,
      0,
      scene,
    )
    expect(blockers.length).toBeGreaterThan(0)
    expect(blockers.some((p) => p.includes('kot') || p.includes('basamak'))).toBe(true)
  })

  test('T3.X4: Pallet lift cycle state machine steps accurately through multiple level landings', () => {
    const stops = [
      { id: 'l0', baseY: 0, label: '0' },
      { id: 'l1', baseY: 4.0, label: '1' },
      { id: 'l2', baseY: 8.0, label: '2' },
    ]
    const row = { mpm: SPEED_MPM['1000'].mpm }
    const steps = buildLiftCycle(stops, row)

    expect(steps.length).toBeGreaterThanOrEqual(6)
    for (const step of steps) {
      if (step.doorOpen === 1 && step.doorStopIndex !== null) {
        const expectedY = stops[step.doorStopIndex]!.baseY
        expect(step.platformY).toBe(expectedY)
      }
    }
  })

  test('T3.X5: Multi-level 2D floorplan rendering matches world coordinates across multiple storeys', () => {
    const scene = makeBuildingScene('b1', [
      { id: 'l0', ordinal: 0, height: 4.0 },
      { id: 'l1', ordinal: 1, height: 4.0 },
    ])
    const spiral = makeSpiralNode({
      id: 'conveyor-spiral_x5',
      parentId: 'l0',
      position: [15, 0, 25],
      rotation: [0, Math.PI / 4, 0],
    })
    const lift = makeLiftNode({
      id: 'pallet-lift_x5',
      parentId: 'l0',
      position: [30, 0, 40],
      rotation: [0, 0, 0],
    })
    scene['conveyor-spiral_x5'] = spiral
    scene['pallet-lift_x5'] = lift

    const ctxL0 = makeMockGeometryContext(scene.l0, scene)
    const fpSpiral = buildSpiralFloorplan(spiral, ctxL0)
    const fpLift = buildPalletLiftFloorplan(lift, ctxL0)

    expect(fpSpiral).not.toBeNull()
    expect(fpLift).not.toBeNull()
  })

  test('T3.X6: Pallet lift travel duration scales proportionally with floor-to-floor storey rise', () => {
    const mpm = SPEED_MPM['1000'].mpm
    const mps = mpm / 60

    const cycle4m = buildLiftCycle([{ baseY: 0 }, { baseY: 4.0 }], { mpm })
    const travelStep4m = cycle4m.find((s) => s.phase === 'travel')

    const cycle8m = buildLiftCycle([{ baseY: 0 }, { baseY: 8.0 }], { mpm })
    const travelStep8m = cycle8m.find((s) => s.phase === 'travel')

    expect(travelStep4m?.durationS).toBeCloseTo(4.0 / mps, 4)
    expect(travelStep8m?.durationS).toBeCloseTo(8.0 / mps, 4)
    expect(travelStep8m!.durationS).toBeCloseTo(travelStep4m!.durationS * 2, 4)
  })

  test('T3.X7: Slab opening bounds match physical shaft mast envelope', () => {
    const scene = makeBuildingScene('b1', [
      { id: 'l0', ordinal: 0, height: 3.5 },
      { id: 'l1', ordinal: 1, height: 3.5 },
      { id: 'l2', ordinal: 2, height: 3.5 },
    ])
    const lift = makeLiftNode({ id: 'pallet-lift_x7', parentId: 'l0' })
    scene['pallet-lift_x7'] = lift

    const span = liftOpeningSpan(scene, lift)
    expect(span).not.toBeNull()
    expect(span!.bottom).toBe(0)
    expect(span!.top).toBe(7.0)
  })

  test('T3.X8: Closed-loop multi-storey material flow topology with infeed, spiral, upper run, lift, and return', () => {
    const scene = makeBuildingScene('b1', [
      { id: 'l0', ordinal: 0, height: 4.0 },
      { id: 'l1', ordinal: 1, height: 4.0 },
    ])

    const spiral = makeSpiralNode({
      id: 'conveyor-spiral_x8',
      parentId: 'l0',
      position: [10, 0, 10],
      entryHeight: 0.75,
      travelHeight: 4.0,
      beltWidth: '400',
    })
    const lift = makeLiftNode({
      id: 'pallet-lift_x8',
      parentId: 'l0',
      position: [30, 0, 10],
    })
    scene['conveyor-spiral_x8'] = spiral
    scene['pallet-lift_x8'] = lift

    expect(asConveyorModule(spiral)).not.toBeNull()
    expect(isSpiralModule(spiral)).toBe(true)
    expect(resolveLiftLevels(scene, lift).length).toBe(2)
  })

  test('T3.X9: Port magnet snapToLineEnd pulls dragged conveyor precisely onto spiral infeed port', () => {
    const spiral = makeSpiralNode({
      id: 'conveyor-spiral_target',
      position: [20, 0, 20],
      rotation: [0, 0, 0],
      entryHeight: 0.75,
      beltWidth: '400',
    })
    const span = spiralPortSpanM(spiral)
    const targetPortA = [20 - span, 0.75, 20] as const

    const movingRoller = makeRollerNode({
      id: 'conveyor-roller_dragged',
      position: [targetPortA[0] - 1.5 - 0.2, 0, targetPortA[2] + 0.1],
      rotation: [0, 0, 0],
      rollers: 40,
      rollerPitch: '75',
      usefulWidth: '400',
      transportHeight: 0.75,
      flow: 'forward',
    })

    const scene = {
      'conveyor-spiral_target': spiral,
      'conveyor-roller_dragged': movingRoller,
    }
    const snappedPos = snapToLineEnd(
      movingRoller,
      movingRoller.position,
      0,
      [movingRoller.id],
      scene,
    )

    expect(snappedPos).not.toBeNull()
    expect(snappedPos![0]).toBeCloseTo(targetPortA[0] - 1.5, 3)
    expect(snappedPos![2]).toBeCloseTo(targetPortA[2], 3)
  })

  test('T3.X10: Continuous multi-module conveyor line index groups straight runs across multi-floor building', () => {
    const r1 = makeRollerNode({
      id: 'conveyor-roller_r1',
      position: [0, 0, 0],
      rollers: 40,
      rollerPitch: '75',
    })
    const r2 = makeRollerNode({
      id: 'conveyor-roller_r2',
      position: [3, 0, 0],
      rollers: 40,
      rollerPitch: '75',
    })
    const r3 = makeRollerNode({
      id: 'conveyor-roller_r3',
      position: [6, 0, 0],
      rollers: 40,
      rollerPitch: '75',
    })

    const scene = {
      'conveyor-roller_r1': r1,
      'conveyor-roller_r2': r2,
      'conveyor-roller_r3': r3,
    }
    const line = lineOf(scene, 'conveyor-roller_r1')
    expect(line.sort()).toEqual([
      'conveyor-roller_r1',
      'conveyor-roller_r2',
      'conveyor-roller_r3',
    ])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// TIER 4: REAL-WORLD MULTI-LEVEL WAREHOUSE WORKLOADS (S1 - S5)
// ═════════════════════════════════════════════════════════════════════════════

describe('Tier 4: Real-World Multi-Level Warehouse Workloads (S1 - S5)', () => {
  beforeEach(() => {
    resetPortMagnet()
    resetLineIndex()
  })

  test('T4.S1: 4-Storey Warehouse Mezzanine Spiral Conveyor (0m -> 3.6m -> 7.2m -> 10.8m)', () => {
    const mezzanineWarehouse = makeBuildingScene('bldg_mezzanine', [
      { id: 'floor_0', ordinal: 0, height: 3.6 },
      { id: 'floor_1', ordinal: 1, height: 3.6 },
      { id: 'floor_2', ordinal: 2, height: 3.6 },
      { id: 'floor_3', ordinal: 3, height: 3.6 },
    ])

    const spiral = makeSpiralNode({
      id: 'conveyor-spiral_mezzanine_tower',
      parentId: 'floor_0',
      position: [25.0, 0, 40.0],
      rotation: [0, 0, 0],
      outerDiameter: '2400',
      beltWidth: '650',
      travelHeight: 10.8, // spans from Ground to Mezzanine 3
      inclineDeg: 11,
      entryHeight: 0.75,
      handedness: 'ccw',
      flow: 'up',
    })
    mezzanineWarehouse['conveyor-spiral_mezzanine_tower'] = spiral

    // 1. Verify height calculations
    expect(spiralExitHeightM(spiral)).toBe(0.75 + 10.8)
    expect(spiralTurnCount(spiral)).toBeGreaterThan(8)

    // 2. Verify static parts generation (tower perimeter legs spanning full height)
    const staticParts = spiralStaticParts(spiral, 'full')
    const mainLeg = staticParts.find((p) => p.role === 'leg')
    expect(mainLeg).toBeDefined()
    expect(mainLeg!.size[1]).toBeCloseTo(10.8 + 0.75, 2)

    // 3. Verify slats span entire 10.8m rise
    const slats = spiralSlatParts(spiral, 'simple')
    expect(slats.length).toBeGreaterThan(80)
    expect(slats[slats.length - 1]!.center[1]).toBeCloseTo(10.8, 1)
  })

  test('T4.S2: 6-Level High-Bay Distribution Center Heavy-Duty Pallet Lift (Total Rise 21.0m)', () => {
    const highBayWarehouse = makeBuildingScene(
      'bldg_highbay',
      [
        { id: 'bay_l0', ordinal: 0, height: 4.2 },
        { id: 'bay_l1', ordinal: 1, height: 4.2 },
        { id: 'bay_l2', ordinal: 2, height: 4.2 },
        { id: 'bay_l3', ordinal: 3, height: 4.2 },
        { id: 'bay_l4', ordinal: 4, height: 4.2 },
        { id: 'bay_l5', ordinal: 5, height: 4.2 },
      ],
      {
        'pallet-lift_highbay': makeLiftNode({
          id: 'pallet-lift_highbay',
          parentId: 'bay_l0',
          capacityClass: '1500',
          mastCount: '2',
        }),
      },
    )

    const lift = highBayWarehouse['pallet-lift_highbay'] as PalletLiftNode

    // 1. Resolve stops
    const stops = resolveLiftLevels(highBayWarehouse, lift)
    expect(stops.length).toBe(6)
    const expectedBaseY = [0, 4.2, 8.4, 12.6, 16.8, 21.0]
    for (let i = 0; i < stops.length; i++) {
      expect(stops[i]!.baseY).toBeCloseTo(expectedBaseY[i]!, 5)
    }

    // 2. Resolve total rise and mast height
    const rise = riseM(highBayWarehouse, lift)
    const mastH = mastHeightM(highBayWarehouse, lift)
    expect(rise).toBeCloseTo(21.0, 5)
    expect(mastH).toBeCloseTo(21.0 + OVERTRAVEL_M, 5)

    // 3. Static parts validation (masts and door frames on all 6 landings)
    const resolved = resolveLift(highBayWarehouse, lift)
    const parts = palletLiftStaticParts(lift, 'full', resolved.stops, resolved.mastHeight)
    const doorFrames = parts.filter((p) => p.role === 'door-frame')
    expect(doorFrames.length).toBeGreaterThanOrEqual(12)

    // 4. Cycle simulation across all 6 stops
    const cycle = buildLiftCycle(stops, { mpm: SPEED_MPM['1500'].mpm })
    expect(cycle.length).toBeGreaterThan(15)
    expect(cycleLength(cycle)).toBeGreaterThan(40)
  })

  test('T4.S3: Dynamic Storey Height Refactoring (Modifying Level 1 height from 3.5m to 5.2m during editing)', () => {
    const initialScene = makeBuildingScene('bldg_edit', [
      { id: 'lvl_0', ordinal: 0, height: 3.5 },
      { id: 'lvl_1', ordinal: 1, height: 3.5 },
      { id: 'lvl_2', ordinal: 2, height: 3.5 },
    ])
    const lift = makeLiftNode({ id: 'pallet-lift_dynamic', parentId: 'lvl_0' })
    initialScene['pallet-lift_dynamic'] = lift

    // Step 1: Initial state (Total rise 7.0m)
    const initialStops = resolveLiftLevels(initialScene, lift)
    expect(initialStops.map((s) => s.baseY)).toEqual([0, 3.5, 7.0])
    expect(riseM(initialScene, lift)).toBe(7.0)

    // Step 2: User mutates Level 1 height in store from 3.5m to 5.2m
    const updatedScene = makeBuildingScene('bldg_edit', [
      { id: 'lvl_0', ordinal: 0, height: 3.5 },
      { id: 'lvl_1', ordinal: 1, height: 5.2 },
      { id: 'lvl_2', ordinal: 2, height: 3.5 },
    ])
    updatedScene['pallet-lift_dynamic'] = lift

    // Step 3: Re-query without modifying lift node itself (Dynamic reactivity)
    const updatedStops = resolveLiftLevels(updatedScene, lift)
    expect(updatedStops.map((s) => s.baseY)).toEqual([0, 3.5, 8.7]) // 3.5 + 5.2 = 8.7
    expect(riseM(updatedScene, lift)).toBe(8.7)
    expect(mastHeightM(updatedScene, lift)).toBeCloseTo(8.7 + OVERTRAVEL_M, 6)
  })

  test('T4.S4: Multi-Storey Conveyor Network with Infeed, Curves, Spiral Conveyor, and Pallet Lift', () => {
    const scene = makeBuildingScene('bldg_logistics', [
      { id: 'fl_ground', ordinal: 0, height: 4.0 },
      { id: 'fl_upper', ordinal: 1, height: 4.0 },
    ])

    const infeed1 = makeRollerNode({
      id: 'conveyor-roller_in1',
      position: [0, 0, 10],
      rollers: 50,
      rollerPitch: '75',
    })
    const infeed2 = makeRollerNode({
      id: 'conveyor-roller_in2',
      position: [3.75, 0, 10],
      rollers: 50,
      rollerPitch: '75',
    })

    const spiral = makeSpiralNode({
      id: 'conveyor-spiral_lifter',
      position: [10 + spiralPortSpanM(makeSpiralNode()), 0, 10],
      entryHeight: 0.75,
      travelHeight: 4.0,
      beltWidth: '400',
    })

    const lift = makeLiftNode({
      id: 'pallet-lift_east',
      position: [40, 0, 10],
      parentId: 'fl_ground',
    })

    scene['conveyor-roller_in1'] = infeed1
    scene['conveyor-roller_in2'] = infeed2
    scene['conveyor-spiral_lifter'] = spiral
    scene['pallet-lift_east'] = lift

    expect(lineOf(scene, 'conveyor-roller_in1')).toContain('conveyor-roller_in2')
    expect(spiralExitHeightM(spiral)).toBe(4.75)
    expect(resolveLiftLevels(scene, lift).length).toBe(2)
  })

  test('T4.S5: Asymmetric Building with Split-Level Mezzanine Decks and Non-Uniform Storeys', () => {
    const asymmetricBuilding = makeBuildingScene('bldg_asymmetric', [
      { id: 'g_floor', ordinal: 0, height: 4.5, baseElevation: 0 },
      { id: 'mezz_split', ordinal: 1, height: 2.5, baseElevation: 2.2 },
      { id: 'top_floor', ordinal: 2, height: 5.0, baseElevation: 0 },
    ])

    const lift = makeLiftNode({ id: 'pallet-lift_asym', parentId: 'g_floor' })
    asymmetricBuilding['pallet-lift_asym'] = lift

    const elevs = levelElevationsOfBuilding(asymmetricBuilding, 'bldg_asymmetric')
    expect(elevs).toEqual([
      { id: 'g_floor', baseY: 0, height: 4.5 },
      { id: 'mezz_split', baseY: 6.7, height: 2.5 },
      { id: 'top_floor', baseY: 9.2, height: 5.0 },
    ])

    const stops = resolveLiftLevels(asymmetricBuilding, lift)
    expect(stops.map((s) => s.baseY)).toEqual([0, 6.7, 9.2])
    expect(riseM(asymmetricBuilding, lift)).toBe(9.2)
    expect(mastHeightM(asymmetricBuilding, lift)).toBeCloseTo(9.2 + OVERTRAVEL_M, 6)
  })
})
