import { beforeEach, describe, expect, test } from 'bun:test'
import {
  hasDownstreamNeighbour,
  hasUpstreamNeighbour,
  isPortMated,
  lineOf,
  resetLineIndex,
} from './line-index'
import { moduleLengthM } from './metrics'
import { jointProblems, resetPortMagnet, snapToLineEnd } from './port-magnet'
import { conveyorPorts, inletPort, outletPort } from './ports'
import { ConveyorRollerNode } from './schema'

const conveyor = (id: string, overrides: Record<string, unknown> = {}) =>
  ConveyorRollerNode.parse({ id: `conveyor_roller_${id}`, rollers: 40, ...overrides })

const scene = (...nodes: Array<{ id: string }>) =>
  Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<string, unknown>

/** The default bed: 40 rollers at 75 mm. */
const LENGTH = moduleLengthM(conveyor('probe'))

describe('ports are geometric, and they point out of the body', () => {
  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  test('the ids are ends, not roles — flow never renames them', () => {
    // The host snapshots port ids when a drag begins, so a `flow` flipped
    // mid-drag would rename the ports underneath a live snapshot and the
    // connectivity solver would mate the wrong pair.
    const forward = conveyor('f')
    const reverse = conveyor('r', { flow: 'reverse' })
    expect(conveyorPorts(forward).map((port) => port.id)).toEqual(['a', 'b'])
    expect(conveyorPorts(reverse).map((port) => port.id)).toEqual(['a', 'b'])
    // What flow decides is which end is the discharge, read off the node.
    expect(outletPort(forward)).toBe('b')
    expect(outletPort(reverse)).toBe('a')
    expect(inletPort(forward)).toBe('a')
  })

  test('they sit at the bed ends, at the transport height, facing outward', () => {
    const node = conveyor('a', { position: [4, 0, -2], transportHeight: 0.75 })
    const [a, b] = conveyorPorts(node)
    expect(a?.position[0]).toBeCloseTo(4 - LENGTH / 2, 9)
    expect(b?.position[0]).toBeCloseTo(4 + LENGTH / 2, 9)
    for (const port of [a, b]) {
      expect(port?.position[1]).toBeCloseTo(0.75, 9)
      expect(port?.position[2]).toBeCloseTo(-2, 9)
      expect(port?.system).toBe('conveyor')
    }
    // Opposed, so two mated ports face each other.
    expect((a?.direction[0] ?? 0) + (b?.direction[0] ?? 0)).toBeCloseTo(0, 9)
  })

  test('a turned module carries its ports round with it', () => {
    const node = conveyor('a', { position: [0, 0, 0], rotation: [0, Math.PI / 2, 0] })
    const [, b] = conveyorPorts(node)
    expect(b?.position[0]).toBeCloseTo(0, 9)
    expect(b?.position[2]).toBeCloseTo(-LENGTH / 2, 9)
  })
})

describe('a line is read back from the ports, never stored', () => {
  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  /** N modules butted end to end from the origin. */
  const run = (count: number, overrides: Record<string, unknown> = {}) =>
    Array.from({ length: count }, (_, index) =>
      conveyor(`m${index}`, { position: [index * LENGTH, 0, 0], ...overrides }),
    )

  test('modules that meet are one line, and a lone module is a line of one', () => {
    const line = run(4)
    const nodes = scene(...line)
    for (const module of line) {
      expect(lineOf(nodes, module.id).sort()).toEqual(line.map((m) => m.id).sort())
    }

    resetLineIndex()
    const lone = conveyor('lone', { position: [40, 0, 40] })
    expect(lineOf(scene(lone), lone.id)).toEqual([lone.id])
  })

  test('a gap splits it, with nothing to heal', () => {
    // The whole reason the line is derived rather than stored: a module deleted
    // or dragged out of the middle splits the line the instant the store
    // writes, and no field can be left pointing at a run that no longer exists.
    const line = run(4)
    const broken = [
      line[0],
      line[1],
      conveyor('m2', { position: [3 * LENGTH + 2, 0, 0] }),
    ] as Array<{
      id: string
    }>
    const nodes = scene(...(broken as never[]))
    expect(lineOf(nodes, 'conveyor_roller_m0').sort()).toEqual([
      'conveyor_roller_m0',
      'conveyor_roller_m1',
    ])
    expect(lineOf(nodes, 'conveyor_roller_m2')).toEqual(['conveyor_roller_m2'])
  })

  test('the ends of a run are free and the middles are not', () => {
    const line = run(3)
    const nodes = scene(...line)
    const [head, middle, tail] = line as [
      ReturnType<typeof conveyor>,
      ReturnType<typeof conveyor>,
      ReturnType<typeof conveyor>,
    ]
    expect(hasUpstreamNeighbour(nodes, head)).toBe(false)
    expect(hasDownstreamNeighbour(nodes, head)).toBe(true)
    expect(hasUpstreamNeighbour(nodes, middle)).toBe(true)
    expect(hasDownstreamNeighbour(nodes, middle)).toBe(true)
    expect(hasDownstreamNeighbour(nodes, tail)).toBe(false)
  })

  test('abutment is what drops the doubled support at a seam', () => {
    // The catalogue puts one support at every joint, not two. This is the bit
    // the geometry key reads, so a seam carries one leg pair rather than two in
    // the same place, z-fighting.
    const line = run(2)
    const nodes = scene(...line)
    const [head, tail] = line as [ReturnType<typeof conveyor>, ReturnType<typeof conveyor>]
    expect(hasDownstreamNeighbour(nodes, head)).toBe(true)
    expect(hasDownstreamNeighbour(nodes, tail)).toBe(false)
  })

  test('a module never mates with itself', () => {
    const lone = conveyor('lone')
    expect(isPortMated(scene(lone), lone.id, 'a')).toBe(false)
    expect(isPortMated(scene(lone), lone.id, 'b')).toBe(false)
  })
})

describe('the magnet joins head to tail and nothing else', () => {
  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  test('a module dropped near a free discharge clicks onto it exactly', () => {
    const standing = conveyor('standing', { position: [0, 0, 0] })
    const dragged = conveyor('dragged', { position: [40, 0, 40] })
    const nodes = scene(standing, dragged)

    // 12 cm short and 7 cm off line — the sort of miss a hand drag makes.
    const snapped = snapToLineEnd(dragged, [LENGTH - 0.12, 0, 0.07], 0, [dragged.id], nodes)
    expect(snapped).not.toBeNull()
    expect(snapped?.[0]).toBeCloseTo(LENGTH, 9)
    expect(snapped?.[2]).toBeCloseTo(0, 9)

    // And what it produced is a joint the line index agrees with, to its own
    // tolerance. A magnet that lands a module *near* the seam is worse than
    // none: the line would look joined and the geometry would still draw two
    // supports.
    resetLineIndex()
    const landed = conveyor('dragged', { position: snapped as [number, number, number] })
    expect(lineOf(scene(standing, landed), standing.id)).toHaveLength(2)
  })

  test('two discharges are never mated nose to nose', () => {
    // Not a joint: two lines ending at the same place. Snapping them together
    // would draw a line that cannot run.
    const standing = conveyor('standing', { position: [0, 0, 0], flow: 'forward' })
    const dragged = conveyor('dragged', { position: [40, 0, 40], flow: 'reverse' })
    // `standing` discharges at +X and `dragged`, reversed, also discharges at
    // its −X end, so approaching from +X puts discharge against discharge.
    expect(
      snapToLineEnd(dragged, [LENGTH - 0.1, 0, 0], 0, [dragged.id], scene(standing, dragged)),
    ).toBeNull()
  })

  test('a different lane is refused — R1', () => {
    const standing = conveyor('standing', { position: [0, 0, 0], usefulWidth: 600 })
    const dragged = conveyor('dragged', { position: [40, 0, 40], usefulWidth: 400 })
    expect(
      snapToLineEnd(dragged, [LENGTH - 0.1, 0, 0], 0, [dragged.id], scene(standing, dragged)),
    ).toBeNull()
  })

  test('a different transport height is refused — R2, and with no tolerance', () => {
    // A step between two beds is a step a box falls down.
    const standing = conveyor('standing', { position: [0, 0, 0], transportHeight: 0.75 })
    const dragged = conveyor('dragged', { position: [40, 0, 40], transportHeight: 0.57 })
    expect(
      snapToLineEnd(dragged, [LENGTH - 0.1, 0, 0], 0, [dragged.id], scene(standing, dragged)),
    ).toBeNull()
  })

  test('a module at right angles is refused — the ends have to face each other', () => {
    const standing = conveyor('standing', { position: [0, 0, 0] })
    const dragged = conveyor('dragged', { position: [40, 0, 40] })
    expect(
      snapToLineEnd(
        dragged,
        [LENGTH - 0.1, 0, 0],
        Math.PI / 2,
        [dragged.id],
        scene(standing, dragged),
      ),
    ).toBeNull()
  })

  test('an end that already has something on it is not offered', () => {
    // Mating onto a filled port would put two modules in the same place.
    const first = conveyor('first', { position: [0, 0, 0] })
    const second = conveyor('second', { position: [LENGTH, 0, 0] })
    const dragged = conveyor('dragged', { position: [40, 0, 40] })
    const nodes = scene(first, second, dragged)
    // Aiming at the filled seam gets nothing...
    expect(snapToLineEnd(dragged, [LENGTH + 0.05, 0, 0], 0, [dragged.id], nodes)).toBeNull()
    // ...but the free end of the run still takes it.
    resetPortMagnet()
    const end = snapToLineEnd(dragged, [2 * LENGTH - 0.1, 0, 0], 0, [dragged.id], nodes)
    expect(end?.[0]).toBeCloseTo(2 * LENGTH, 9)
  })

  test('it lets go outside half a metre', () => {
    const standing = conveyor('standing', { position: [0, 0, 0] })
    const dragged = conveyor('dragged', { position: [40, 0, 40] })
    expect(
      snapToLineEnd(dragged, [LENGTH - 0.8, 0, 0], 0, [dragged.id], scene(standing, dragged)),
    ).toBeNull()
  })

  test('a whole line dragged together does not fight itself', () => {
    const line = [0, 1, 2].map((index) =>
      conveyor(`m${index}`, { position: [index * LENGTH, 0, 0] }),
    )
    const nodes = scene(...line)
    const movingIds = line.map((module) => module.id)
    const head = line[0] as ReturnType<typeof conveyor>
    expect(snapToLineEnd(head, [LENGTH - 0.05, 0, 0], 0, movingIds, nodes)).toBeNull()
  })
})

describe('a joint built by hand is checked, because the magnet is not the only way to make one', () => {
  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  test('a mismatched lane is reported once the two are joined', () => {
    // The host calls two ends within 50 mm one line whatever they are, so a
    // line built by paste or by MCP can be joined and wrong at the same time.
    const wide = conveyor('wide', { position: [0, 0, 0], usefulWidth: 600 })
    const narrow = conveyor('narrow', { position: [LENGTH, 0, 0], usefulWidth: 400 })
    const problems = jointProblems(wide, scene(wide, narrow))
    expect(problems.some((problem) => problem.includes('400 mm'))).toBe(true)
  })

  test('a step at the joint is reported in millimetres', () => {
    const low = conveyor('low', { position: [0, 0, 0], transportHeight: 0.75 })
    // Within the 50 mm the host calls one joint, and still a step.
    const high = conveyor('high', { position: [LENGTH, 0, 0], transportHeight: 0.78 })
    const problems = jointProblems(low, scene(low, high))
    expect(problems.some((problem) => problem.includes('30 mm step'))).toBe(true)
  })

  test('a clean joint reports nothing', () => {
    const first = conveyor('first', { position: [0, 0, 0] })
    const second = conveyor('second', { position: [LENGTH, 0, 0] })
    expect(jointProblems(first, scene(first, second))).toEqual([])
  })

  test('a lone module reports nothing', () => {
    const lone = conveyor('lone')
    expect(jointProblems(lone, scene(lone))).toEqual([])
  })
})
