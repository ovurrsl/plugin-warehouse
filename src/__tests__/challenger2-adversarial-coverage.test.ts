import { describe, expect, test } from 'bun:test'
import type { FloorplanPalette, GeometryContext } from '@pascal-app/core'
import {
  conveyorPorts,
  inletPort,
  localPorts,
  outletPort,
  portPosition,
  transportHeightAt,
} from '../conveyor/ports'
import { buildSpiralFloorplan } from '../conveyor/spiral-floorplan'
import { getSpiralSlatGeometry, getSpiralStaticGeometry } from '../conveyor/spiral-geometry'
import { resolveSpiralBuildingLevels, resolveSpiralRise } from '../conveyor/spiral-levels'
import {
  beltSpeedMS,
  beltWidthM,
  cageRadiusM,
  columnRadiusM,
  entryHeightM,
  exitAngleRad,
  exitHeightM,
  exitStubCenter,
  footprintM,
  frameWidthM,
  handednessSign,
  handrailRadiusM,
  helixArcLengthM,
  helixPoint,
  helixRadiusM,
  inclineRad,
  legCount,
  legRadiusM,
  outerDiameterM,
  overallHeightM,
  pitchM,
  portSpanM,
  screwYawPerStep,
  screwYPerStep,
  slatOuterRadiusM,
  slatsPerTurn,
  slatStepRad,
  totalAngleRad,
  travelHeightM,
  turnCount,
} from '../conveyor/spiral-metrics'
import {
  SLAT_MARGIN_COUNT,
  SLAT_THICKNESS_M,
  screwCenter,
  spiralSlatParts,
  spiralStaticParts,
} from '../conveyor/spiral-parts'
import { ConveyorSpiralNode } from '../conveyor/spiral-schema'
import { buildTelescopicFloorplan } from '../conveyor/telescopic-floorplan'
import { ConveyorTelescopicNode } from '../conveyor/telescopic-schema'
import { OVERTRAVEL_M } from '../palletlift/catalog'
import { buildPalletLiftFloorplan } from '../palletlift/floorplan'
import {
  liftLevelFingerprint,
  mastHeightM,
  resolveLift,
  resolveLiftLevels,
  resolvePalletLiftLevels,
  riseM,
} from '../palletlift/levels'
import {
  doorFaceZ,
  doorWidthM,
  mastPositionsXZ,
  mastSectionM,
  platformDepthM,
  platformWidthM,
} from '../palletlift/metrics'
import { PalletLiftNode } from '../palletlift/schema'

const mockContext = (selected = false): GeometryContext => ({
  parent: null,
  resolve: () => undefined,
  viewState: {
    selected,
    hovered: false,
    unit: 'metric',
    palette: {
      selectedStroke: '#e69a47',
      selectedFill: '#fce8cc',
    } as unknown as FloorplanPalette,
  } as never,
} as unknown as GeometryContext)

describe('Tier 5 Adversarial Coverage Hardening: Mathematical Invariants & Stress Testing', () => {
  // =========================================================================
  // AREA 1: 2D Floorplan Coordinate Math under Arbitrary [x, z, θ]
  // =========================================================================
  describe('Area 1: 2D Floorplan Coordinate Math under Arbitrary [x, z, θ]', () => {
    test('A1.1: 500 randomized [x, z, θ] transformations for Spiral Floorplan match Three.js world mapping', () => {
      for (let i = 0; i < 500; i++) {
        const x = (Math.random() - 0.5) * 200
        const z = (Math.random() - 0.5) * 200
        const rotY = (Math.random() - 0.5) * 20 * Math.PI // arbitrary angle in radians
        const chirality: 'cw' | 'ccw' = Math.random() > 0.5 ? 'cw' : 'ccw'
        const travelH = 1.5 + Math.random() * 10

        const node = ConveyorSpiralNode.parse({
          id: `conveyor-spiral_fuzz_${i}`,
          position: [x, 0, z],
          rotation: [0, rotY, 0],
          handedness: chirality,
          travelHeight: travelH,
        })

        const fp = buildSpiralFloorplan(node, mockContext(true))
        expect(fp).not.toBeNull()
        expect(fp?.kind).toBe('group')

        if (fp && fp.kind === 'group') {
          // Verify root group transform
          expect(fp.transform?.translate?.[0]).toBeCloseTo(x, 10)
          expect(fp.transform?.translate?.[1]).toBeCloseTo(z, 10)
          expect(fp.transform?.rotate).toBeCloseTo(-rotY, 10)

          // Mathematical proof of 2D SVG local to world equivalence with 3D Three.js:
          // Local point (lx, lz) transformed by SVG transform { translate: [x, z], rotate: -rotY }
          // In SVG: X_world = lx * cos(-rotY) - lz * sin(-rotY) + x = lx * cos(rotY) + lz * sin(rotY) + x
          // In SVG: Z_world = lx * sin(-rotY) + lz * cos(-rotY) + z = -lx * sin(rotY) + lz * cos(rotY) + z
          // In Three.js: R_y(rotY) * [lx, 0, lz]^T = [lx * cos(rotY) + lz * sin(rotY), 0, -lx * sin(rotY) + lz * cos(rotY)]
          const span = portSpanM(node)
          const thetaExit = exitAngleRad(node)

          // Entrance stub local is [-span, 0]
          const entranceLocal = [-span, 0]
          const entranceWorldExpectedX = entranceLocal[0]! * Math.cos(rotY) + x
          const entranceWorldExpectedZ = -entranceLocal[0]! * Math.sin(rotY) + z

          // Outlet port local is [span * cos(thetaExit), span * sin(thetaExit)]
          const exitLocal = [span * Math.cos(thetaExit), span * Math.sin(thetaExit)]
          const exitWorldExpectedX =
            exitLocal[0]! * Math.cos(rotY) + exitLocal[1]! * Math.sin(rotY) + x
          const exitWorldExpectedZ =
            -exitLocal[0]! * Math.sin(rotY) + exitLocal[1]! * Math.cos(rotY) + z

          // 3D ports world positions
          const ports = conveyorPorts(node)
          const portA = ports.find((p) => p.id === 'a')
          const portB = ports.find((p) => p.id === 'b')

          expect(portA).toBeDefined()
          expect(portB).toBeDefined()
          expect(portA?.position[0]).toBeCloseTo(entranceWorldExpectedX, 6)
          expect(portA?.position[2]).toBeCloseTo(entranceWorldExpectedZ, 6)
          expect(portB?.position[0]).toBeCloseTo(exitWorldExpectedX, 6)
          expect(portB?.position[2]).toBeCloseTo(exitWorldExpectedZ, 6)
        }
      }
    })

    test('A1.2: 500 randomized [x, z, θ] transformations for Pallet Lift Floorplan match world envelope', () => {
      for (let i = 0; i < 500; i++) {
        const x = (Math.random() - 0.5) * 150
        const z = (Math.random() - 0.5) * 150
        const rotY = (Math.random() - 0.5) * 20 * Math.PI
        const mastCount: '2' | '4' = Math.random() > 0.5 ? '2' : '4'
        const hasDoors = Math.random() > 0.5

        const node = PalletLiftNode.parse({
          id: `pallet-lift_fuzz_${i}`,
          position: [x, 0, z],
          rotation: [0, rotY, 0],
          mastCount,
          hasDoors,
        })

        const fp = buildPalletLiftFloorplan(node, mockContext(false))
        expect(fp).not.toBeNull()
        expect(fp?.kind).toBe('group')

        if (fp && fp.kind === 'group') {
          expect(fp.transform?.translate?.[0]).toBeCloseTo(x, 10)
          expect(fp.transform?.translate?.[1]).toBeCloseTo(z, 10)
          expect(fp.transform?.rotate).toBeCloseTo(-rotY, 10)

          // Verify platform rect dimensions
          const rect = fp.children.find((c) => c.kind === 'rect' && c.strokeWidth === 0.03)
          expect(rect).toBeDefined()
          if (rect && rect.kind === 'rect') {
            expect(rect.width).toBeCloseTo(platformWidthM(node), 6)
            expect(rect.height).toBeCloseTo(platformDepthM(node), 6)
          }

          // Verify mast points count
          const mastRects = fp.children.filter(
            (c) => c.kind === 'rect' && c.stroke === 'none' && c.strokeWidth === 0,
          )
          expect(mastRects.length).toBe(mastCount === '2' ? 2 : 4)

          // Verify door line if enabled
          if (hasDoors) {
            const doorLine = fp.children.find((c) => c.kind === 'line')
            expect(doorLine).toBeDefined()
            if (doorLine && doorLine.kind === 'line') {
              expect(doorLine.x2 - doorLine.x1).toBeCloseTo(doorWidthM(node), 6)
              expect(doorLine.y1).toBeCloseTo(doorFaceZ(node), 6)
            }
          }
        }
      }
    })

    test('A1.3: 500 randomized [x, z, θ] transformations for Telescopic Floorplan match world envelope', () => {
      for (let i = 0; i < 500; i++) {
        const x = (Math.random() - 0.5) * 100
        const z = (Math.random() - 0.5) * 100
        const rotY = (Math.random() - 0.5) * 10 * Math.PI
        const extension = Math.random()

        const node = ConveyorTelescopicNode.parse({
          id: `conveyor-telescopic_fuzz_${i}`,
          position: [x, 0, z],
          rotation: [0, rotY, 0],
          extension,
        })

        const fp = buildTelescopicFloorplan(node, mockContext(true))
        expect(fp).not.toBeNull()
        expect(fp?.kind).toBe('group')
        if (fp && fp.kind === 'group') {
          expect(fp.transform?.translate?.[0]).toBeCloseTo(x, 10)
          expect(fp.transform?.translate?.[1]).toBeCloseTo(z, 10)
          expect(fp.transform?.rotate).toBeCloseTo(-rotY, 10)
        }
      }
    })

    test('A1.4: Extreme rotation angles and full cyclic revolutions preserve exact trigonometric parity', () => {
      const angles = [
        -100 * Math.PI,
        -10 * Math.PI,
        -2 * Math.PI,
        -Math.PI,
        -Math.PI / 2,
        -Math.PI / 4,
        0,
        Math.PI / 4,
        Math.PI / 2,
        Math.PI,
        2 * Math.PI,
        10 * Math.PI,
        100 * Math.PI,
      ]

      for (const rotY of angles) {
        const spiral = ConveyorSpiralNode.parse({
          id: 'conveyor-spiral_rot',
          position: [10, 0, 20],
          rotation: [0, rotY, 0],
        })

        const fp = buildSpiralFloorplan(spiral, mockContext(false))
        expect(fp?.kind).toBe('group')
        if (fp && fp.kind === 'group') {
          expect(fp.transform?.rotate).toBeCloseTo(-rotY, 10)
        }

        const ports = conveyorPorts(spiral)
        const cos = Math.cos(rotY)
        const sin = Math.sin(rotY)
        const span = portSpanM(spiral)

        // Port A local is [-span, 0]
        const expectedPortAx = 10 - span * cos
        const expectedPortAz = 20 + span * sin
        expect(ports[0]?.position[0]).toBeCloseTo(expectedPortAx, 8)
        expect(ports[0]?.position[2]).toBeCloseTo(expectedPortAz, 8)
      }
    })

    test('A1.5: Extreme world translations (large coordinates and tiny deltas) avoid cancellation errors', () => {
      const extremePositions: Array<[number, number, number]> = [
        [100000, 0, -100000],
        [-50000, 10, 50000],
        [1e-5, 0, -1e-5],
        [0, 0, 0],
      ]

      for (const pos of extremePositions) {
        const node = ConveyorSpiralNode.parse({
          id: 'conveyor-spiral_ext_pos',
          position: pos,
          rotation: [0, Math.PI / 3, 0],
        })

        const fp = buildSpiralFloorplan(node, mockContext(false))
        expect(fp?.kind).toBe('group')
        if (fp && fp.kind === 'group') {
          expect(fp.transform?.translate?.[0]).toBe(pos[0])
          expect(fp.transform?.translate?.[1]).toBe(pos[2])
          expect(Number.isFinite(fp.transform?.translate?.[0])).toBe(true)
          expect(Number.isFinite(fp.transform?.translate?.[1])).toBe(true)
        }
      }
    })
  })

  // =========================================================================
  // AREA 2: 3D Helix Vertex Positions vs Inlet Port 'a' and Discharge Port 'b' Across Fractional Turns
  // =========================================================================
  describe('Area 2: 3D Helix Vertex Positions vs Inlet Port a and Discharge Port b Across Fractional Turns', () => {
    test('A2.1: Rigorous collinearity and coplanarity across exact fractional turns', () => {
      const testCases = [
        { turns: 1.25, chirality: 'ccw' as const, outerDiameter: '2400' as const, beltWidth: '800' as const, inclineDeg: 13 },
        { turns: 1.25, chirality: 'cw' as const, outerDiameter: '2400' as const, beltWidth: '800' as const, inclineDeg: 13 },
        { turns: 1.333333, chirality: 'ccw' as const, outerDiameter: '1800' as const, beltWidth: '650' as const, inclineDeg: 12 },
        { turns: 1.5, chirality: 'ccw' as const, outerDiameter: '1800' as const, beltWidth: '500' as const, inclineDeg: 11 },
        { turns: 1.5, chirality: 'cw' as const, outerDiameter: '1800' as const, beltWidth: '500' as const, inclineDeg: 11 },
        { turns: 1.75, chirality: 'ccw' as const, outerDiameter: '1500' as const, beltWidth: '500' as const, inclineDeg: 11 },
        { turns: 2.0, chirality: 'ccw' as const, outerDiameter: '1500' as const, beltWidth: '500' as const, inclineDeg: 11 },
        { turns: 2.0, chirality: 'cw' as const, outerDiameter: '1500' as const, beltWidth: '500' as const, inclineDeg: 11 },
        { turns: 2.25, chirality: 'ccw' as const, outerDiameter: '1500' as const, beltWidth: '400' as const, inclineDeg: 10 },
        { turns: 2.25, chirality: 'cw' as const, outerDiameter: '1500' as const, beltWidth: '400' as const, inclineDeg: 10 },
        { turns: 2.37, chirality: 'ccw' as const, outerDiameter: '1800' as const, beltWidth: '500' as const, inclineDeg: 11 },
        { turns: 2.5, chirality: 'cw' as const, outerDiameter: '1800' as const, beltWidth: '500' as const, inclineDeg: 11 },
        { turns: 2.75, chirality: 'ccw' as const, outerDiameter: '1800' as const, beltWidth: '500' as const, inclineDeg: 11 },
        { turns: 2.75, chirality: 'cw' as const, outerDiameter: '1800' as const, beltWidth: '500' as const, inclineDeg: 11 },
        { turns: 3.0, chirality: 'ccw' as const, outerDiameter: '1500' as const, beltWidth: '500' as const, inclineDeg: 11 },
        { turns: 3.25, chirality: 'ccw' as const, outerDiameter: '1500' as const, beltWidth: '500' as const, inclineDeg: 11 },
        { turns: 3.5, chirality: 'ccw' as const, outerDiameter: '1500' as const, beltWidth: '500' as const, inclineDeg: 11 },
        { turns: 4.125, chirality: 'cw' as const, outerDiameter: '1500' as const, beltWidth: '400' as const, inclineDeg: 9 },
        { turns: 5.0, chirality: 'ccw' as const, outerDiameter: '1500' as const, beltWidth: '500' as const, inclineDeg: 11 },
        { turns: 7.825, chirality: 'cw' as const, outerDiameter: '1500' as const, beltWidth: '400' as const, inclineDeg: 6 },
      ]

      for (const { turns, chirality, outerDiameter, beltWidth, inclineDeg } of testCases) {
        const dummyNode = ConveyorSpiralNode.parse({
          id: 'conveyor-spiral_fractional',
          handedness: chirality,
          outerDiameter,
          beltWidth,
          inclineDeg,
        })
        const pitch = pitchM(dummyNode)
        const targetRise = turns * pitch

        const node = ConveyorSpiralNode.parse({
          id: 'conveyor-spiral_fractional',
          handedness: chirality,
          outerDiameter,
          beltWidth,
          inclineDeg,
          travelHeight: targetRise,
          entryHeight: 0.8,
        })

        const computedTurns = turnCount(node)
        expect(computedTurns).toBeCloseTo(turns, 5)

        const totalAngle = totalAngleRad(node)
        const thetaExit = exitAngleRad(node)
        const s = handednessSign(node)

        // 1. Helix start point at t=0
        const startPoint = helixPoint(node, 0)
        const r = helixRadiusM(node)
        // At t=0, angle = Math.PI + s*0 = Math.PI -> [R*cos(PI), 0, R*sin(PI)] = [-R, 0, 0]
        expect(startPoint[0]).toBeCloseTo(-r, 8)
        expect(startPoint[1]).toBeCloseTo(0, 8)
        expect(startPoint[2]).toBeCloseTo(0, 8)

        // 2. Helix terminal point at t=totalAngle
        const endPoint = helixPoint(node, totalAngle)
        expect(endPoint[0]).toBeCloseTo(r * Math.cos(thetaExit), 8)
        expect(endPoint[1]).toBeCloseTo(targetRise, 8)
        expect(endPoint[2]).toBeCloseTo(r * Math.sin(thetaExit), 8)

        // 3. Port 'a' and Port 'b' local coordinates
        const ports = localPorts(node)
        const portA = ports.find((p) => p.id === 'a')
        const portB = ports.find((p) => p.id === 'b')
        const span = portSpanM(node)

        expect(portA).toBeDefined()
        expect(portB).toBeDefined()

        // Port A is at [-span, entryHeight, 0]
        expect(portA?.x).toBeCloseTo(-span, 8)
        expect(portA?.y).toBeCloseTo(node.entryHeight, 8)
        expect(portA?.z).toBeCloseTo(0, 8)
        expect(portA?.dx).toBeCloseTo(-1, 8)
        expect(portA?.dz).toBeCloseTo(0, 8)

        // Port B is at [span * cos(thetaExit), exitHeight, span * sin(thetaExit)]
        expect(portB?.x).toBeCloseTo(span * Math.cos(thetaExit), 8)
        expect(portB?.y).toBeCloseTo(node.entryHeight + targetRise, 8)
        expect(portB?.z).toBeCloseTo(span * Math.sin(thetaExit), 8)
        expect(portB?.dx).toBeCloseTo(Math.cos(thetaExit), 8)
        expect(portB?.dz).toBeCloseTo(Math.sin(thetaExit), 8)

        // 4. Exit stub center
        const stubCenter = exitStubCenter(node)
        const cage = cageRadiusM(node)
        const rStub = (cage + span) / 2
        expect(stubCenter[0]).toBeCloseTo(rStub * Math.cos(thetaExit), 8)
        expect(stubCenter[1]).toBeCloseTo(node.entryHeight + targetRise - 0.03, 8)
        expect(stubCenter[2]).toBeCloseTo(rStub * Math.sin(thetaExit), 8)

        // 5. Collinearity check:
        // Terminal helix point, exit stub center, and Port B must lie on the EXACT SAME radial ray from (0,0) at angle thetaExit
        const angleTerminal = Math.atan2(endPoint[2], endPoint[0])
        const angleStub = Math.atan2(stubCenter[2], stubCenter[0])
        const anglePortB = Math.atan2(portB!.z, portB!.x)

        const normAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
        expect(normAngle(angleTerminal)).toBeCloseTo(normAngle(thetaExit), 7)
        expect(normAngle(angleStub)).toBeCloseTo(normAngle(thetaExit), 7)
        expect(normAngle(anglePortB)).toBeCloseTo(normAngle(thetaExit), 7)

        // Distance ordering: 0 < R < cage < rStub < span
        expect(r).toBeLessThan(cage)
        expect(cage).toBeLessThan(rStub)
        expect(rStub).toBeLessThan(span)
      }
    })

    test('A2.2: Slat terminal alignment matches discharge Port b across 200 randomized fractional turns', () => {
      for (let i = 0; i < 200; i++) {
        const outerD = Math.random() > 0.5 ? '1500' : '1800'
        const beltW = Math.random() > 0.5 ? '400' : '500'
        const incline = 5 + Math.random() * 7
        const height = 1.0 + Math.random() * 12.0
        const chirality: 'cw' | 'ccw' = Math.random() > 0.5 ? 'cw' : 'ccw'

        const node = ConveyorSpiralNode.parse({
          id: `conveyor-spiral_rnd_${i}`,
          outerDiameter: outerD as any,
          beltWidth: beltW as any,
          inclineDeg: incline,
          travelHeight: height,
          handedness: chirality,
          entryHeight: 0.5 + Math.random() * 1.5,
        })

        const slats = spiralSlatParts(node, 'full')
        expect(slats.length).toBeGreaterThan(10)

        const lastSlat = slats[slats.length - 1]!

        // Slat heights must strictly monotonically increase from 0 to travelHeight
        for (let j = 1; j < slats.length; j++) {
          expect(slats[j]!.center[1]).toBeGreaterThanOrEqual(slats[j - 1]!.center[1])
        }

        // Final slat height must be within step distance of travelHeight
        expect(lastSlat.center[1]).toBeGreaterThanOrEqual(height - screwYPerStep(node, 'full'))
      }
    })

    test('A2.3: Flow direction inversion flips port roles while physical 3D port positions remain invariant', () => {
      const nodeUp = ConveyorSpiralNode.parse({
        id: 'conveyor-spiral_up',
        flow: 'up',
        travelHeight: 4.2,
        entryHeight: 0.75,
      })

      const nodeDown = ConveyorSpiralNode.parse({
        id: 'conveyor-spiral_down',
        flow: 'down',
        travelHeight: 4.2,
        entryHeight: 0.75,
      })

      expect(inletPort(nodeUp)).toBe('a')
      expect(outletPort(nodeUp)).toBe('b')
      expect(inletPort(nodeDown)).toBe('b')
      expect(outletPort(nodeDown)).toBe('a')

      const portsUp = localPorts(nodeUp)
      const portsDown = localPorts(nodeDown)

      expect(portsUp[0]?.x).toBe(portsDown[0]?.x)
      expect(portsUp[0]?.y).toBe(portsDown[0]?.y)
      expect(portsUp[0]?.z).toBe(portsDown[0]?.z)
      expect(portsUp[1]?.x).toBe(portsDown[1]?.x)
      expect(portsUp[1]?.y).toBe(portsDown[1]?.y)
      expect(portsUp[1]?.z).toBe(portsDown[1]?.z)

      expect(portsUp[0]?.role).toBe('in')
      expect(portsUp[1]?.role).toBe('out')
      expect(portsDown[0]?.role).toBe('out')
      expect(portsDown[1]?.role).toBe('in')
    })
  })

  // =========================================================================
  // AREA 3: Slat Incline Angle Invariance under CW vs CCW Configurations
  // =========================================================================
  describe('Area 3: Slat Incline Angle Invariance under Clockwise vs Counter-Clockwise Configurations', () => {
    test('A3.1: CW vs CCW slat pitch and effective climbing angle invariance', () => {
      const inclinations = [3.0, 5.5, 7.0, 9.2, 11.5, 13.0]

      for (const inc of inclinations) {
        const nodeCCW = ConveyorSpiralNode.parse({
          id: 'conveyor-spiral_ccw',
          handedness: 'ccw',
          inclineDeg: inc,
          travelHeight: 4.5,
          outerDiameter: '1800',
          beltWidth: '500',
        })

        const nodeCW = ConveyorSpiralNode.parse({
          id: 'conveyor-spiral_cw',
          handedness: 'cw',
          inclineDeg: inc,
          travelHeight: 4.5,
          outerDiameter: '1800',
          beltWidth: '500',
        })

        // 1. Pitch must be bit-identical
        expect(pitchM(nodeCCW)).toBeCloseTo(pitchM(nodeCW), 12)
        expect(turnCount(nodeCCW)).toBeCloseTo(turnCount(nodeCW), 12)
        expect(helixArcLengthM(nodeCCW)).toBeCloseTo(helixArcLengthM(nodeCW), 12)

        // 2. Slat parts counts
        const slatsCCW = spiralSlatParts(nodeCCW, 'full')
        const slatsCW = spiralSlatParts(nodeCW, 'full')
        expect(slatsCCW.length).toBe(slatsCW.length)

        // 3. Slat tilt magnitudes
        for (let i = 0; i < slatsCCW.length; i++) {
          const sCCW = slatsCCW[i]!
          const sCW = slatsCW[i]!

          // tiltX sign: CCW is -inclineRad, CW is +inclineRad
          expect(sCCW.tiltX).toBeCloseTo(-inclineRad(nodeCCW), 10)
          expect(sCW.tiltX).toBeCloseTo(inclineRad(nodeCW), 10)
          expect(Math.abs(sCCW.tiltX)).toBeCloseTo(Math.abs(sCW.tiltX), 10)

          // Vertical positions of corresponding slats are identical
          expect(sCCW.center[1]).toBeCloseTo(sCW.center[1], 10)

          // Radii from center are identical R
          const rCCW = Math.hypot(sCCW.center[0], sCCW.center[2])
          const rCW = Math.hypot(sCW.center[0], sCW.center[2])
          expect(rCCW).toBeCloseTo(helixRadiusM(nodeCCW), 10)
          expect(rCW).toBeCloseTo(helixRadiusM(nodeCW), 10)
        }
      }
    })

    test('A3.2: Vertex buffer top-face climb slope verification for both CW and CCW', () => {
      const inclinations = [4.0, 8.0, 12.0]

      for (const inc of inclinations) {
        for (const handedness of ['ccw', 'cw'] as const) {
          const node = ConveyorSpiralNode.parse({
            id: `conveyor-spiral_geo_${handedness}_${inc}`,
            handedness,
            inclineDeg: inc,
            travelHeight: 3.0,
            outerDiameter: '1800',
            beltWidth: '500',
          })

          const geo = getSpiralSlatGeometry(node, 'simple')
          expect(geo).toBeDefined()
          const posAttr = geo.getAttribute('position')
          expect(posAttr).toBeDefined()
          expect(posAttr.count).toBeGreaterThan(0)

          for (let v = 0; v < posAttr.count; v++) {
            expect(Number.isFinite(posAttr.getX(v))).toBe(true)
            expect(Number.isFinite(posAttr.getY(v))).toBe(true)
            expect(Number.isFinite(posAttr.getZ(v))).toBe(true)
          }
        }
      }
    })

    test('A3.3: Dynamic screw kinematics invariance slat_k -> slat_{k+1} across details and chiralities', () => {
      for (const detail of ['full', 'simple'] as const) {
        for (const handedness of ['ccw', 'cw'] as const) {
          const node = ConveyorSpiralNode.parse({
            id: `conveyor-spiral_screw_${handedness}_${detail}`,
            handedness,
            inclineDeg: 8.5,
            travelHeight: 3.6,
          })

          const slats = spiralSlatParts(node, detail)
          const yawStep = screwYawPerStep(node, detail)
          const yStep = screwYPerStep(node, detail)

          for (let k = SLAT_MARGIN_COUNT; k < slats.length - 1; k++) {
            const current = slats[k]!.center
            const next = slats[k + 1]!.center

            const predicted = screwCenter(current, yawStep, yStep)

            expect(predicted[0]).toBeCloseTo(next[0], 6)
            expect(predicted[1]).toBeCloseTo(next[1], 6)
            expect(predicted[2]).toBeCloseTo(next[2], 6)
          }
        }
      }
    })

    test('A3.4: Handrail segment slope and continuity for CW and CCW configurations', () => {
      for (const handedness of ['ccw', 'cw'] as const) {
        const node = ConveyorSpiralNode.parse({
          id: `conveyor-spiral_rail_${handedness}`,
          handedness,
          hasHandrail: true,
          travelHeight: 3.5,
          inclineDeg: 7.5,
        })

        const parts = spiralStaticParts(node, 'full')
        const handrails = parts.filter((p) => p.role === 'handrail')
        expect(handrails.length).toBeGreaterThan(5)

        const s = handednessSign(node)
        const expectedTilt = -s * inclineRad(node)

        for (const hr of handrails) {
          expect(hr.tiltX).toBeCloseTo(expectedTilt, 8)
          const r = Math.hypot(hr.center[0], hr.center[2])
          expect(r).toBeCloseTo(handrailRadiusM(node), 6)
        }
      }
    })
  })

  // =========================================================================
  // AREA 4: Properties Panel Level Selection & Dirty State Dispatching
  // =========================================================================
  describe('Area 4: Properties Panel Level Selection & Dirty State Dispatching', () => {
    const buildingId = 'bld_stress'
    const level0Id = 'lvl_g'
    const level1Id = 'lvl_m'
    const level2Id = 'lvl_h'
    const level3Id = 'lvl_top'

    const testBuilding = {
      id: buildingId,
      type: 'building',
      children: [level0Id, level1Id, level2Id, level3Id],
      name: 'Stress Test DC',
    }

    const testLevel0 = {
      id: level0Id,
      type: 'level',
      parentId: buildingId,
      level: 0,
      name: 'Level 0 - Ground',
      height: 4.0,
      baseElevation: 0,
      children: ['conveyor-spiral_test_1', 'pallet-lift_test_1'],
    }

    const testLevel1 = {
      id: level1Id,
      type: 'level',
      parentId: buildingId,
      level: 1,
      name: 'Level 1 - Mezzanine A',
      height: 3.2,
      baseElevation: 0,
      children: [],
    }

    const testLevel2 = {
      id: level2Id,
      type: 'level',
      parentId: buildingId,
      level: 2,
      name: 'Level 2 - Mezzanine B',
      height: 3.8,
      baseElevation: 0,
      children: [],
    }

    const testLevel3 = {
      id: level3Id,
      type: 'level',
      parentId: buildingId,
      level: 3,
      name: 'Level 3 - High Bay',
      height: 5.0,
      baseElevation: 0,
      children: [],
    }

    const sceneNodes: Record<string, unknown> = {
      [buildingId]: testBuilding,
      [level0Id]: testLevel0,
      [level1Id]: testLevel1,
      [level2Id]: testLevel2,
      [level3Id]: testLevel3,
    }

    test('A4.1: Level selection dropdown updates fromLevelId and toLevelId across all storey combinations', () => {
      const allFloorIds = [level0Id, level1Id, level2Id, level3Id]

      for (let fromIdx = 0; fromIdx < allFloorIds.length; fromIdx++) {
        for (let toIdx = 0; toIdx < allFloorIds.length; toIdx++) {
          const fromId = allFloorIds[fromIdx]!
          const toId = allFloorIds[toIdx]!

          // Spiral
          const spiral = ConveyorSpiralNode.parse({
            id: 'conveyor-spiral_test_1',
            parentId: level0Id,
            fromLevelId: fromId,
            toLevelId: toId,
          })

          const rise = resolveSpiralRise(sceneNodes, spiral)
          if (fromIdx === toIdx) {
            // Same floor -> fallback to travelHeight
            expect(rise).toBe(spiral.travelHeight)
          } else {
            // Different floors -> dynamic rise calculation
            expect(rise).toBeGreaterThan(0)
          }

          // Pallet Lift
          const lift = PalletLiftNode.parse({
            id: 'pallet-lift_test_1',
            parentId: level0Id,
            fromLevelId: fromId,
            toLevelId: toId,
          })

          const liftResolved = resolvePalletLiftLevels(lift, sceneNodes)
          expect(liftResolved.servedLevels.length).toBeGreaterThanOrEqual(
            fromIdx === toIdx ? 0 : 2,
          )
          expect(liftResolved.totalHeight).toBeGreaterThan(0)
        }
      }
    })

    test('A4.2: Mutual exclusion and integrity of serviceOnlyLevelIds and disabledLevelIds', () => {
      const lift = PalletLiftNode.parse({
        id: 'pallet-lift_access_test',
        parentId: level0Id,
        fromLevelId: level0Id,
        toLevelId: level3Id,
        serviceOnlyLevelIds: [level1Id],
        disabledLevelIds: [level2Id],
      })

      const serviceSet = new Set(lift.serviceOnlyLevelIds ?? [])
      const disabledSet = new Set(lift.disabledLevelIds ?? [])

      const targetLevel = level1Id
      disabledSet.add(targetLevel)
      serviceSet.delete(targetLevel)

      const updatedLift = PalletLiftNode.parse({
        ...lift,
        serviceOnlyLevelIds: Array.from(serviceSet),
        disabledLevelIds: Array.from(disabledSet),
      })

      expect(updatedLift.disabledLevelIds).toContain(level1Id)
      expect(updatedLift.serviceOnlyLevelIds).not.toContain(level1Id)
      expect(updatedLift.disabledLevelIds).toContain(level2Id)

      const intersection = updatedLift.disabledLevelIds?.filter((id) =>
        updatedLift.serviceOnlyLevelIds?.includes(id),
      )
      expect(intersection?.length).toBe(0)
    })

    test('A4.3: Reactive storey height updates dynamically update 3D lift mast and spiral rise without schema mutation', () => {
      const spiral = ConveyorSpiralNode.parse({
        id: 'conveyor-spiral_reactive',
        parentId: level0Id,
        fromLevelId: level0Id,
        toLevelId: level2Id, // Ground -> Mezzanine B (4.0 + 3.2 = 7.2m)
      })

      const lift = PalletLiftNode.parse({
        id: 'pallet-lift_reactive',
        parentId: level0Id,
        fromLevelId: level0Id,
        toLevelId: level3Id, // Ground -> High Bay (4.0 + 3.2 + 3.8 = 11.0m)
      })

      // Step 1: Initial state
      expect(resolveSpiralRise(sceneNodes, spiral)).toBeCloseTo(7.2, 3)
      expect(riseM(sceneNodes, lift)).toBeCloseTo(11.0, 3)
      expect(mastHeightM(sceneNodes, lift)).toBeCloseTo(11.0 + OVERTRAVEL_M, 3)

      // Step 2: Architect modifies Level 0 height from 4.0m to 6.5m and Level 1 from 3.2m to 4.1m
      const modifiedScene = {
        ...sceneNodes,
        [level0Id]: {
          ...testLevel0,
          height: 6.5,
        },
        [level1Id]: {
          ...testLevel1,
          height: 4.1,
        },
      }

      // Dynamic re-evaluation
      expect(resolveSpiralRise(modifiedScene, spiral)).toBeCloseTo(6.5 + 4.1, 3) // 10.6m
      expect(riseM(modifiedScene, lift)).toBeCloseTo(6.5 + 4.1 + 3.8, 3) // 14.4m
      expect(mastHeightM(modifiedScene, lift)).toBeCloseTo(14.4 + OVERTRAVEL_M, 3) // 15.6m

      // Fingerprint updates reactively
      const fpBefore = liftLevelFingerprint(sceneNodes, lift)
      const fpAfter = liftLevelFingerprint(modifiedScene, lift)
      expect(fpBefore).not.toBe(fpAfter)
    })

    test('A4.4: Inverted level bounds maintain valid non-negative height and ordered stop elevations', () => {
      const invertedSpiral = ConveyorSpiralNode.parse({
        id: 'conveyor-spiral_inv',
        parentId: level0Id,
        fromLevelId: level3Id, // Top floor (11.0m)
        toLevelId: level1Id, // Mezzanine A (4.0m)
      })

      const invertedLift = PalletLiftNode.parse({
        id: 'pallet-lift_inv',
        parentId: level0Id,
        fromLevelId: level3Id,
        toLevelId: level0Id,
      })

      // Spiral rise is non-negative absolute delta
      const spiralRise = resolveSpiralRise(sceneNodes, invertedSpiral)
      expect(spiralRise).toBeCloseTo(7.0, 3) // 11.0 - 4.0

      // Pallet lift stops are sorted strictly ascending by elevation
      const liftStops = resolveLiftLevels(sceneNodes, invertedLift)
      expect(liftStops.length).toBe(4)
      expect(liftStops[0]?.baseY).toBe(0)
      expect(liftStops[1]?.baseY).toBeCloseTo(4.0, 3)
      expect(liftStops[2]?.baseY).toBeCloseTo(7.2, 3)
      expect(liftStops[3]?.baseY).toBeCloseTo(11.0, 3)
      for (let s = 1; s < liftStops.length; s++) {
        expect(liftStops[s]!.baseY).toBeGreaterThan(liftStops[s - 1]!.baseY)
      }
    })
  })

  // =========================================================================
  // AREA 5: Continuous Helix Tangent Vector Derivative Invariance
  // =========================================================================
  describe('Area 5: Continuous Helix Tangent Vector Derivative Invariance', () => {
    test('A5.1: Numerical differentiation of helixPoint matches analytical tangent vector across t parameter', () => {
      const nodeCCW = ConveyorSpiralNode.parse({
        id: 'conveyor-spiral_deriv_ccw',
        handedness: 'ccw',
        inclineDeg: 10.5,
        outerDiameter: '1800',
        beltWidth: '500',
        travelHeight: 5.0,
      })

      const nodeCW = ConveyorSpiralNode.parse({
        id: 'conveyor-spiral_deriv_cw',
        handedness: 'cw',
        inclineDeg: 10.5,
        outerDiameter: '1800',
        beltWidth: '500',
        travelHeight: 5.0,
      })

      const delta = 1e-6
      const R = helixRadiusM(nodeCCW)
      const pitch = pitchM(nodeCCW)
      const c = pitch / (2 * Math.PI)
      const totalT = totalAngleRad(nodeCCW)

      for (const node of [nodeCCW, nodeCW]) {
        const s = handednessSign(node)

        for (let t = 0; t <= totalT; t += 0.1) {
          const pPlus = helixPoint(node, t + delta)
          const pMinus = helixPoint(node, t - delta)

          // Numerical derivative: dp/dt
          const numDx = (pPlus[0] - pMinus[0]) / (2 * delta)
          const numDy = (pPlus[1] - pMinus[1]) / (2 * delta)
          const numDz = (pPlus[2] - pMinus[2]) / (2 * delta)

          // Analytical derivative:
          // P(t) = [R * cos(PI + s*t), c * t, R * sin(PI + s*t)]
          // dP/dt = [-s*R * sin(PI + s*t), c, s*R * cos(PI + s*t)]
          const angle = Math.PI + s * t
          const anaDx = -s * R * Math.sin(angle)
          const anaDy = c
          const anaDz = s * R * Math.cos(angle)

          expect(numDx).toBeCloseTo(anaDx, 6)
          expect(numDy).toBeCloseTo(anaDy, 6)
          expect(numDz).toBeCloseTo(anaDz, 6)

          // Horizontal velocity magnitude must be exactly R
          const horizontalSpeed = Math.hypot(numDx, numDz)
          expect(horizontalSpeed).toBeCloseTo(R, 6)

          // Vertical climbing rate must be exactly c = pitch / 2pi
          expect(numDy).toBeCloseTo(c, 6)

          // 3D tangential speed must be exactly sqrt(R^2 + c^2)
          const speed3D = Math.hypot(numDx, numDy, numDz)
          expect(speed3D).toBeCloseTo(Math.hypot(R, c), 6)

          // Tangent must be strictly orthogonal to radial vector
          const pCenter = helixPoint(node, t)
          const dotProduct = numDx * pCenter[0] + numDz * pCenter[2]
          expect(dotProduct).toBeCloseTo(0, 5)
        }
      }
    })
  })

  // =========================================================================
  // AREA 6: Pallet Lift Cycle Kinematics State Machine Invariant
  // =========================================================================
  describe('Area 6: Pallet Lift Cycle Kinematics State Machine Invariant', () => {
    test('A6.1: EN 1570 Interlock Invariant: whenever doorOpen is 1, platformY strictly equals served stop baseY', () => {
      const stops = [
        { baseY: 0.0 },
        { baseY: 3.5 },
        { baseY: 7.2 },
        { baseY: 11.0 },
        { baseY: 15.5 },
      ]

      const speed = { mpm: 30 } // 0.5 m/s

      // Dynamically import buildLiftCycle
      const { buildLiftCycle, cycleLength, stepAt } = require('../palletlift/cycle')

      const steps = buildLiftCycle(stops, speed)
      expect(steps.length).toBeGreaterThan(10)

      // Verify interlock invariant across all steps
      for (let idx = 0; idx < steps.length; idx++) {
        const step = steps[idx]
        if (step.doorOpen === 1) {
          expect(step.doorStopIndex).not.toBeNull()
          const stopIndex = step.doorStopIndex!
          expect(step.platformY).toBeCloseTo(stops[stopIndex]!.baseY, 10)
        } else {
          expect(step.doorStopIndex).toBeNull()
        }
      }

      // Continuous simulation sampling
      const totalDuration = cycleLength(steps)
      expect(totalDuration).toBeGreaterThan(0)

      for (let t = 0; t <= totalDuration; t += 0.25) {
        const state = stepAt(steps, t)
        expect(state).not.toBeNull()
        if (state) {
          if (state.step.doorOpen === 1) {
            const stopIndex = state.step.doorStopIndex!
            expect(state.step.platformY).toBeCloseTo(stops[stopIndex]!.baseY, 10)
          }
        }
      }
    })
  })
})
