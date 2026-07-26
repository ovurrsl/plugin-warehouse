import { beforeEach, describe, expect, test } from 'bun:test'
import { LNC } from './catalog'
import {
  clearConveyorGeometryCache,
  conveyorGeometryCacheSize,
  getConveyorGeometry,
} from './geometry-builder'
import { getLauncherGeometry, launcherGeometryKey } from './launcher-geometry'
import {
  footprintCentreZM,
  footprintM,
  frameWidthM,
  lateralOuterZM,
  launchSign,
  localBoundsM,
  moduleLengthM,
  rollerCount,
  supportOffsetsX,
} from './launcher-metrics'
import { launcherParts } from './launcher-parts'
import { ConveyorLauncherNode } from './launcher-schema'
import { hasDownstreamNeighbour, lineOf, resetLineIndex } from './line-index'
import { jointProblems, resetPortMagnet, snapToLineEnd } from './port-magnet'
import { conveyorPorts, localPorts } from './ports'
import { ConveyorRollerNode } from './schema'

const launcher = (overrides: Record<string, unknown> = {}) =>
  ConveyorLauncherNode.parse({ id: 'conveyor_launcher_t', ...overrides })

describe('a launcher is a straight with an arm', () => {
  test('the body is the catalogue length and the frame the straight family’s', () => {
    // 600 → 747 is published for this type, and 747 − 600 is the same 147 mm the
    // straights take. That is why this kind brings no overhang of its own.
    const node = launcher()
    expect(moduleLengthM(node)).toBeCloseTo(0.9, 9)
    expect(frameWidthM(node)).toBeCloseTo(0.747, 9)
    expect(frameWidthM(launcher({ usefulWidth: '400' }))).toBeCloseTo(0.547, 9)
    expect(LNC.exteriorWidthMaxM).toBeCloseTo(0.747, 9)
  })

  test('the supports stand at the ends, which is what lets it share one at a seam', () => {
    // Legs set inboard would leave a gap instead: the neighbour that cedes has
    // already dropped its own, so nothing would stand at the joint at all.
    const node = launcher()
    expect(supportOffsetsX(node)).toEqual([expect.closeTo(-0.45, 9), expect.closeTo(0.45, 9)])
  })

  test('the ceded station follows the flow, exactly as on a straight', () => {
    const legXs = (node: ReturnType<typeof launcher>, abutted: boolean) =>
      [
        ...new Set(
          launcherParts(node, 'full', abutted)
            .filter((part) => part.role === 'leg')
            .map((part) => Number(part.center[0].toFixed(6))),
        ),
      ].sort((a, b) => a - b)

    const forward = launcher({ flow: 'forward' })
    const reverse = launcher({ flow: 'reverse' })
    // The arm's own legs never move; only the main line's discharge station goes.
    expect(legXs(forward, true)).not.toEqual(legXs(forward, false))
    expect(legXs(forward, true)).not.toEqual(legXs(reverse, true))
  })
})

describe('the launch opening is a hole in the frame, not a missing rail', () => {
  test('the launch side is two segments and the far side is one', () => {
    // A rail running past the opening is a rail the box has to pass through;
    // no rail at all leaves the bed unsupported along half its length.
    const node = launcher({ launchSide: 'left' })
    const frame = frameWidthM(node)
    const side = launchSign(node)
    // The main frame's two runs, at |z| = half the frame. The arm's own profiles
    // stand further out and are not what this is about.
    const profiles = launcherParts(node, 'simple').filter(
      (part) => part.role === 'frame' && Math.abs(part.center[2]) < frame / 2 + 1e-9,
    )
    const onLaunchSide = profiles.filter((part) => Math.sign(part.center[2]) === side)
    const onFarSide = profiles.filter((part) => Math.sign(part.center[2]) === -side)

    expect(onLaunchSide.length).toBe(2)
    expect(onFarSide.length).toBe(1)
    expect(onFarSide[0]?.size[0]).toBeCloseTo(moduleLengthM(node), 9)
    // The two segments plus the opening make up the whole body.
    const spanned = onLaunchSide.reduce((total, part) => total + part.size[0], 0)
    expect(spanned).toBeCloseTo(moduleLengthM(node) - LNC.boxLengthM * 1.05, 9)
    expect(Math.abs(onFarSide[0]?.center[2] ?? 0)).toBeCloseTo((frame - 0.003) / 2, 9)
  })

  test('the guide goes on the side the box does not leave by', () => {
    for (const launchSide of ['left', 'right'] as const) {
      const node = launcher({ launchSide, sideGuide: true })
      const guides = launcherParts(node, 'full').filter((part) => part.role === 'guide')
      expect(guides).toHaveLength(1)
      expect(Math.sign(guides[0]?.center[2] ?? 0)).toBe(-launchSign(node))
    }
    expect(
      launcherParts(launcher({ sideGuide: false }), 'full').filter((p) => p.role === 'guide'),
    ).toHaveLength(0)
  })
})

describe('three ends, and the third one only ever discharges', () => {
  test('the main pair is on ±X and the launch is on the launch side', () => {
    const node = launcher({ launchSide: 'left' })
    const ports = localPorts(node)
    expect(ports.map((p) => p.id)).toEqual(['a', 'b', 'c'])

    const half = moduleLengthM(node) / 2
    expect(ports[0]).toMatchObject({ x: -half, z: 0, dx: -1, dz: 0 })
    expect(ports[1]).toMatchObject({ x: half, z: 0, dx: 1, dz: 0 })
    expect(ports[2]?.x).toBeCloseTo(0, 9)
    expect(ports[2]?.z).toBeCloseTo(lateralOuterZM(node), 9)
    expect(ports[2]?.dz).toBe(1)
  })

  test('the launch is a discharge whichever way the main line runs', () => {
    // The difference between a launcher and the oblique branch: this machine
    // throws a box off the line, it never accepts one from the side.
    for (const flow of ['forward', 'reverse'] as const) {
      const roles = Object.fromEntries(localPorts(launcher({ flow })).map((p) => [p.id, p.role]))
      expect(roles.c).toBe('out')
      expect([roles.a, roles.b].filter((role) => role === 'out')).toHaveLength(1)
    }
  })

  test('mirroring the machine mirrors the launch, and the main pair stays put', () => {
    const left = localPorts(launcher({ launchSide: 'left' }))
    const right = localPorts(launcher({ launchSide: 'right' }))
    expect(right[2]?.z).toBeCloseTo(-(left[2]?.z ?? 0), 9)
    expect(right[0]).toMatchObject({ x: left[0]?.x, z: 0 })
  })

  test('all three ends report the same lane, because this machine has one', () => {
    // Unlike the oblique transfer, whose branch is genuinely narrower. Stated as
    // a test so the day that changes, it changes deliberately.
    const node = launcher({ usefulWidth: '400' })
    for (const port of localPorts(node)) expect(port.laneMm).toBe(400)
  })
})

describe('the launcher joins a line, and the line index can see it', () => {
  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  const straight = (overrides: Record<string, unknown> = {}) =>
    ConveyorRollerNode.parse({ id: 'conveyor_roller_s', ...overrides })

  const portOf = (node: Parameters<typeof conveyorPorts>[0], id: 'a' | 'b' | 'c') => {
    const port = conveyorPorts(node).find((candidate) => candidate.id === id)
    if (!port) throw new Error(`no port ${id}`)
    return port
  }

  test('a straight magnets onto the launcher’s infeed and reads back as one line', () => {
    const bed = straight()
    const inlet = portOf(launcher(), 'a')
    const rough = launcher({ position: [0, 0, 0] })
    const exact: [number, number, number] = [
      rough.position[0] + (portOf(bed, 'b').position[0] - inlet.position[0]),
      0,
      rough.position[2] + (portOf(bed, 'b').position[2] - inlet.position[2]),
    ]

    const snapped = snapToLineEnd(rough, [exact[0] + 0.2, 0, exact[2] + 0.15], 0, [], {
      [bed.id]: bed,
    })
    expect(snapped?.[0]).toBeCloseTo(exact[0], 9)
    expect(snapped?.[2]).toBeCloseTo(exact[2], 9)

    const joined = launcher({ position: exact })
    const scene = { [bed.id]: bed, [joined.id]: joined }
    resetLineIndex()
    expect(lineOf(scene, bed.id).sort()).toEqual([joined.id, bed.id].sort())
    expect(jointProblems(joined, scene)).toEqual([])
  })

  test('the straight cedes its support at that seam — the whole reason the kind set matters', () => {
    // A kind missing from `asConveyorModule` never enters the line index, so the
    // straight would believe its own end free and build the leg the launcher
    // also builds. Doubled steel, traceable to nothing.
    const bed = straight()
    const inlet = portOf(launcher(), 'a')
    const exact: [number, number, number] = [
      portOf(bed, 'b').position[0] - inlet.position[0],
      0,
      portOf(bed, 'b').position[2] - inlet.position[2],
    ]
    const joined = launcher({ position: exact })
    resetLineIndex()
    expect(hasDownstreamNeighbour({ [bed.id]: bed, [joined.id]: joined }, bed)).toBe(true)
  })

  test('two discharges will not mate, and a discharge and an infeed will', () => {
    // Modules butt end to end, so what reaches a +X discharge is another
    // module's −X end. Which of the two it is depends on that module's flow:
    // forward makes 'a' an infeed and the joint legal, reverse makes 'a' a
    // second discharge and there is nothing to feed either line.
    const first = launcher({ id: 'conveyor_launcher_1', position: [0, 0, 0] })
    const outlet = portOf(first, 'b')
    const align = (node: ReturnType<typeof launcher>): [number, number, number] => [
      outlet.position[0] - portOf(node, 'a').position[0],
      0,
      outlet.position[2] - portOf(node, 'a').position[2],
    ]

    const receiving = launcher({ id: 'conveyor_launcher_2', flow: 'forward' })
    resetPortMagnet()
    expect(snapToLineEnd(receiving, align(receiving), 0, [], { [first.id]: first })).not.toBeNull()

    const discharging = launcher({ id: 'conveyor_launcher_3', flow: 'reverse' })
    resetPortMagnet()
    expect(snapToLineEnd(discharging, align(discharging), 0, [], { [first.id]: first })).toBeNull()
  })
})

describe('the footprint is asymmetric, because the arm sticks out one side', () => {
  test('it spans the body and the arm, centred where the two of them are', () => {
    // The host's `floorPlaced.footprint` is a box *centred on the node*, and a
    // launcher's steel is not — the same problem the bend has with its arc
    // centre, and the same answer: the offset is carried separately.
    for (const launchSide of ['left', 'right'] as const) {
      const node = launcher({ launchSide })
      const [width, depth] = footprintM(node)
      const centre = footprintCentreZM(node)
      const frame = frameWidthM(node)
      const outer = launchSign(node) * lateralOuterZM(node)
      const near = -launchSign(node) * (frame / 2)

      expect(width).toBeCloseTo(moduleLengthM(node), 9)
      expect(centre).toBeCloseTo((near + outer) / 2, 9)
      expect(depth).toBeCloseTo(Math.abs(outer - near), 9)
      // Every part lies inside it.
      for (const part of launcherParts(node, 'full')) {
        const half = part.rotationY === 0 ? part.size[2] / 2 : part.size[0] / 2
        expect(Math.abs(part.center[2] - centre) - half).toBeLessThanOrEqual(depth / 2 + 0.15)
      }
    }
  })

  test('the volume runs from the floor to the guide top, legs included', () => {
    const node = launcher()
    const bounds = localBoundsM(node)
    expect(bounds.min[1]).toBe(0)
    expect(bounds.max[1]).toBeCloseTo(node.transportHeight + node.sideGuideHeight, 9)
    expect(localBoundsM(launcher({ sideGuide: false })).max[1]).toBeCloseTo(node.transportHeight, 9)
  })
})

describe('the mesh', () => {
  beforeEach(() => {
    clearConveyorGeometryCache()
  })

  const sameMesh = (a: Float32Array, b: Float32Array) =>
    a.length === b.length && a.every((value, index) => value === b[index])

  const buildFresh = (node: ReturnType<typeof launcher>, abutted = false): Float32Array => {
    clearConveyorGeometryCache()
    const geometry = getLauncherGeometry(node, 'full', abutted)
    const parts = (['position', 'color', 'uv'] as const).map(
      (name) => geometry.getAttribute(name).array as ArrayLike<number>,
    )
    const combined = new Float32Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
      combined.set(Float32Array.from(part), offset)
      offset += part.length
    }
    return combined
  }

  const VARIANTS: Array<[string, unknown]> = [
    ['usefulWidth', '400'],
    ['rollerPitch', '100'],
    ['transportHeight', 0.57],
    ['launchSide', 'right'],
    ['sideGuide', false],
    ['sideGuideHeight', 0.09],
    ['frameColor', '#00ff00'],
    ['rollerColor', '#ff00ff'],
    ['profileColor', '#123456'],
    // Must NOT move a vertex.
    ['flow', 'reverse'],
    ['name', 'Branch 1'],
    ['position', [12, 0, 4]],
    ['rotation', [0, Math.PI / 2, 0]],
    ['supportSlabId', 'slab_abcdefgh'],
  ]

  test('every field that changes the mesh changes the key, and none that do not', () => {
    // Both abutment states: unabutted the flow moves nothing, abutted it decides
    // which station is ceded. Half the sweep would not see half the key.
    for (const abutted of [false, true]) {
      const base = launcher()
      const baseMesh = buildFresh(base, abutted)
      const baseKey = launcherGeometryKey(base, 'full', abutted)

      for (const [field, value] of VARIANTS) {
        const variant = launcher({ [field]: value })
        const changesMesh = !sameMesh(buildFresh(variant, abutted), baseMesh)
        const changesKey = launcherGeometryKey(variant, 'full', abutted) !== baseKey
        expect({ abutted, field, changesKey }).toEqual({ abutted, field, changesKey: changesMesh })
      }
    }
  })

  test('a mirrored machine is a different buffer, not the same one turned round', () => {
    // Turning a launcher 180° puts the arm on the other side and also swaps
    // which end is the infeed, so the two are genuinely different machines. A
    // key without `launchSide` hands one the other's mesh, and the arm simply
    // appears on the wrong side — the invisible failure the key law names.
    const left = launcher({ launchSide: 'left' })
    const right = launcher({ launchSide: 'right' })
    expect(sameMesh(buildFresh(left), buildFresh(right))).toBe(false)
    expect(launcherGeometryKey(left, 'full')).not.toBe(launcherGeometryKey(right, 'full'))
  })

  test('the launcher shares the straight’s pool, because it is one kind', () => {
    expect(conveyorGeometryCacheSize()).toBe(0)
    getConveyorGeometry(ConveyorRollerNode.parse({ id: 'conveyor_roller_p' }), 'full')
    getLauncherGeometry(launcher(), 'full')
    expect(conveyorGeometryCacheSize()).toBe(2)
  })

  test('both beds paint their own rollers, so neither wears the other’s spacing', () => {
    // The lateral bed is a second patterned deck at a different length and a
    // right angle. One node-level stripe span would paint its rollers at the
    // main bed's pitch.
    const node = launcher()
    const decks = launcherParts(node, 'full').filter((part) => part.pattern === 'rollers')
    expect(decks).toHaveLength(2)
    expect(decks[0]?.rotationY).toBe(0)
    expect(decks[1]?.rotationY).toBeCloseTo(Math.PI / 2, 9)
    expect(decks[0]?.size[0]).not.toBeCloseTo(decks[1]?.size[0] ?? 0, 3)
    expect(rollerCount(node)).toBe(12)
  })
})
