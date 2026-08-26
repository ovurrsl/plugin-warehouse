import { describe, expect, test } from 'bun:test'
import type { GeometryContext } from '@pascal-app/core'
import { buildSpiralFloorplan } from '../conveyor/spiral-floorplan'
import {
  exitAngleRad,
  exitStubCenter,
  helixPoint,
  helixRadiusM,
  inclineRad,
  portSpanM,
  totalAngleRad,
  turnCount,
} from '../conveyor/spiral-metrics'
import { spiralSlatParts, spiralStaticParts } from '../conveyor/spiral-parts'
import type { ConveyorSpiralNode } from '../conveyor/spiral-schema'
import { buildPalletLiftFloorplan } from '../palletlift/floorplan'
import { resolveLift, resolvePalletLiftLevels } from '../palletlift/levels'
import type { PalletLiftNode } from '../palletlift/schema'
import { buildTelescopicFloorplan } from '../conveyor/telescopic-floorplan'
import type { ConveyorTelescopicNode } from '../conveyor/telescopic-schema'
import { conveyorPorts } from '../conveyor/ports'

const mockContext = {
  detail: 'full',
  viewMode: '2d',
  resolve: () => undefined,
} as unknown as GeometryContext

function makeSpiralNode(overrides: Partial<ConveyorSpiralNode> = {}): ConveyorSpiralNode {
  return {
    id: 'spiral-1',
    name: 'Spiral Conveyor 1',
    type: 'warehouse:conveyor-spiral',
    position: [12.5, 0, -8.2],
    rotation: [0, Math.PI / 4, 0],
    outerDiameter: '1800',
    beltWidth: '500',
    inclineDeg: 11.5,
    travelHeight: 3.5,
    entryHeight: 0.75,
    flow: 'up',
    handedness: 'ccw',
    legColor: '#71717a',
    frameColor: '#e4e4e7',
    hasCage: true,
    hasHandrail: true,
    loadClass: 'light',
    ...overrides,
  } as ConveyorSpiralNode
}

function makeLiftNode(overrides: Partial<PalletLiftNode> = {}): PalletLiftNode {
  return {
    id: 'lift-1',
    name: 'Pallet Lift 1',
    type: 'warehouse:pallet-lift',
    position: [24.0, 0, 15.0],
    rotation: [0, Math.PI / 2, 0],
    capacityClass: '1000',
    mastCount: '2',
    palletPreset: 'epal-1',
    hasEnclosure: true,
    hasDoors: true,
    hasControlPanel: true,
    mastColor: '#3f3f46',
    platformColor: '#fbbf24',
    doorColor: '#71717a',
    ...overrides,
  } as PalletLiftNode
}

function makeTelescopicNode(overrides: Partial<ConveyorTelescopicNode> = {}): ConveyorTelescopicNode {
  return {
    id: 'telescopic-1',
    name: 'Telescopic 1',
    type: 'warehouse:conveyor-telescopic',
    position: [3.4, 0, -22.7],
    rotation: [0, 2.1, 0],
    model: 'a3-6+8',
    beltWidth: '800',
    extension: 0.5,
    flow: 'unload',
    bodyColor: '#3b82f6',
    beltColor: '#18181b',
    ...overrides,
  } as ConveyorTelescopicNode
}

describe('Milestone 2: 2D Floorplan Coordinate & Root Transform Remediation', () => {
  test('spiral-floorplan root group has translate [X, Z] and rotate -rotation', () => {
    const node = makeSpiralNode({ position: [14.2, 0, -9.8], rotation: [0, 1.25, 0] })
    const symbol = buildSpiralFloorplan(node, mockContext) as {
      transform?: { translate?: [number, number]; rotate?: number }
    }
    expect(symbol.transform).toBeDefined()
    expect(symbol.transform?.translate).toEqual([14.2, -9.8])
    expect(symbol.transform?.rotate).toBeCloseTo(-1.25, 6)
  })

  test('palletlift/floorplan root group has translate [X, Z] and rotate -rotation', () => {
    const node = makeLiftNode({ position: [-18.5, 0, 32.1], rotation: [0, -0.75, 0] })
    const symbol = buildPalletLiftFloorplan(node, mockContext) as {
      transform?: { translate?: [number, number]; rotate?: number }
    }
    expect(symbol.transform).toBeDefined()
    expect(symbol.transform?.translate).toEqual([-18.5, 32.1])
    expect(symbol.transform?.rotate).toBeCloseTo(0.75, 6)
  })

  test('telescopic-floorplan root group has translate [X, Z] and rotate -rotation', () => {
    const node = makeTelescopicNode({ position: [3.4, 0, -22.7], rotation: [0, 2.1, 0] })
    const symbol = buildTelescopicFloorplan(node, mockContext) as {
      transform?: { translate?: [number, number]; rotate?: number }
    }
    expect(symbol.transform).toBeDefined()
    expect(symbol.transform?.translate).toEqual([3.4, -22.7])
    expect(symbol.transform?.rotate).toBeCloseTo(-2.1, 6)
  })
})

describe('Milestone 2: 3D Spiral Conveyor Mesh & Geometry Defects Remediation', () => {
  test('3D helix start point at t=0 aligns with infeed stub and inlet Port a at -X (angle PI)', () => {
    const node = makeSpiralNode({ outerDiameter: '1800', beltWidth: '400' })
    const r = helixRadiusM(node)
    const pt0 = helixPoint(node, 0)
    expect(pt0[0]).toBeCloseTo(-r, 6)
    expect(pt0[1]).toBeCloseTo(0, 6)
    expect(pt0[2]).toBeCloseTo(0, 6)

    // Inlet Port 'a' in local coordinates
    const ports = conveyorPorts({ ...node, position: [0, 0, 0], rotation: [0, 0, 0] })
    const portA = ports.find((p) => p.id === 'a')!
    expect(portA.position[0]).toBeLessThan(0) // -X
    expect(portA.position[2]).toBeCloseTo(0, 6) // z = 0
    expect(portA.direction).toEqual([-1, 0, 0])
  })

  test('slat tiltX angle is negative along climbing direction to pitch slat upward', () => {
    const node = makeSpiralNode({ inclineDeg: 12.0, handedness: 'ccw' })
    const slats = spiralSlatParts(node, 'full')
    expect(slats.length).toBeGreaterThan(0)
    const expectedTilt = -inclineRad(node)
    expect(slats[0]!.tiltX).toBeCloseTo(expectedTilt, 6)
    expect(slats[0]!.tiltX).toBeLessThan(0) // negative tilt lifts front edge along climb

    // Slat center elevation strictly ascends as parameter t advances
    for (let i = 1; i < slats.length; i++) {
      expect(slats[i]!.center[1]).toBeGreaterThanOrEqual(slats[i - 1]!.center[1])
    }
  })

  test('handrail tiltX angle is negative along climbing direction', () => {
    const node = makeSpiralNode({ inclineDeg: 10.5, handedness: 'ccw', hasHandrail: true })
    const parts = spiralStaticParts(node, 'full')
    const handrails = parts.filter((p) => p.role === 'handrail')
    expect(handrails.length).toBeGreaterThan(0)
    const expectedTilt = -inclineRad(node)
    for (const rail of handrails) {
      expect(rail.tiltX).toBeCloseTo(expectedTilt, 6)
    }
  })

  test('exit stub and Port b dynamically orient to thetaExit for fractional turn counts', () => {
    // Test 1.25 turns, 2.5 turns, 3.75 turns, 4.0 turns
    for (const travel of [1.5, 2.8, 3.9, 5.2]) {
      const node = makeSpiralNode({ travelHeight: travel })
      const theta = exitAngleRad(node)
      const stub = exitStubCenter(node)
      const span = portSpanM(node)
      const rStub = (span + (span - 0.6)) / 2

      expect(stub[0]).toBeCloseTo(rStub * Math.cos(theta), 3)
      expect(stub[2]).toBeCloseTo(rStub * Math.sin(theta), 3)

      const ports = conveyorPorts({ ...node, position: [0, 0, 0], rotation: [0, 0, 0] })
      const portB = ports.find((p) => p.id === 'b')!
      expect(portB.position[0]).toBeCloseTo(span * Math.cos(theta), 3)
      expect(portB.position[2]).toBeCloseTo(span * Math.sin(theta), 3)
      expect(portB.direction[0]).toBeCloseTo(Math.cos(theta), 3)
      expect(portB.direction[2]).toBeCloseTo(Math.sin(theta), 3)
    }
  })

  test('center column height and static geometry dynamically resolve with building storey rise', () => {
    const node = makeSpiralNode({ fromLevelId: 'lvl-0', toLevelId: 'lvl-2', travelHeight: 3.0 })
    const staticParts = spiralStaticParts(node, 'full', 8.4)
    const exitStub = staticParts.find((p) => p.role === 'stub' && p.center[1] > 1.0)
    expect(exitStub).toBeDefined()
    expect(exitStub?.center[1]).toBeCloseTo(0.75 + 8.4 - 0.03, 3) // entryHeight + resolvedRise - 0.03
  })
})

describe('Milestone 2: Pallet Lift 3D Parity & Dynamic Mast Sizing', () => {
  test('pallet lift dynamically resolves served stops and spans full storey elevation from fromLevelId to toLevelId', () => {
    const lift = makeLiftNode({ parentId: 'fl-1', fromLevelId: 'fl-1', toLevelId: 'fl-3' })
    const building: Record<string, unknown> = {
      'bld-wh': { id: 'bld-wh', type: 'building', children: ['fl-0', 'fl-1', 'fl-2', 'fl-3', lift.id] },
      'fl-0': { id: 'fl-0', type: 'level', parentId: 'bld-wh', ordinal: 0, height: 3.6 },
      'fl-1': { id: 'fl-1', type: 'level', parentId: 'bld-wh', ordinal: 1, height: 3.6 },
      'fl-2': { id: 'fl-2', type: 'level', parentId: 'bld-wh', ordinal: 2, height: 4.0 },
      'fl-3': { id: 'fl-3', type: 'level', parentId: 'bld-wh', ordinal: 3, height: 3.8 },
      [lift.id]: lift,
    }

    const res = resolvePalletLiftLevels(lift, building)
    expect(res.servedLevels.length).toBe(3) // fl-1, fl-2, fl-3
    expect(res.servedLevels[0]!.elevation).toBeCloseTo(0.0, 3) // relative to base served level
    expect(res.servedLevels[1]!.elevation).toBeCloseTo(3.6, 3)
    expect(res.servedLevels[2]!.elevation).toBeCloseTo(7.6, 3) // 3.6 + 4.0
    expect(res.topY).toBeCloseTo(7.6, 3)
    expect(res.totalHeight).toBeCloseTo(7.6 + 1.2, 3) // mast includes 1.2m overhead clearance

    const resolved = resolveLift(building, lift)
    expect(resolved.stops.length).toBe(3)
    expect(resolved.mastHeight).toBeCloseTo(7.6 + 1.2, 3)
  })
})
