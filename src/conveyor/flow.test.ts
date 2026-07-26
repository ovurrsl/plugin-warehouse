import { beforeEach, describe, expect, test } from 'bun:test'
import { ConveyorCurveNode } from './curve-schema'
import { routeLengthM, routesOf, sampleRoute } from './flow-routes'
import { buildNetwork, type FlowBox, moduleSpeedMPerSec, poseOf, step } from './flow-simulation'
import { resetLineIndex } from './line-index'
import { ConveyorObliqueNode } from './oblique-schema'
import { conveyorPorts } from './ports'
import { ConveyorRollerNode } from './schema'

const straight = (overrides: Record<string, unknown> = {}) =>
  ConveyorRollerNode.parse({ id: 'conveyor_roller_f', ...overrides })

/** Two straights butted end to end, which is the smallest thing a box can
 *  travel that is not one module. */
function pair() {
  const first = straight({ id: 'conveyor_roller_1', position: [0, 0, 0] })
  const outlet = conveyorPorts(first).find((port) => port.id === 'b')
  const loose = straight({ id: 'conveyor_roller_2' })
  const inlet = conveyorPorts(loose).find((port) => port.id === 'a')
  if (!outlet || !inlet) throw new Error('missing port')
  const second = straight({
    id: 'conveyor_roller_2',
    position: [outlet.position[0] - inlet.position[0], 0, outlet.position[2] - inlet.position[2]],
  })
  return { first, second, nodes: { [first.id]: first, [second.id]: second } }
}

beforeEach(() => {
  resetLineIndex()
})

describe('a route is derived from the same figures as the steel', () => {
  test('a straight’s route is its bed, end to end', () => {
    const node = straight()
    const routes = routesOf(node)
    expect(routes).toHaveLength(1)
    expect(routeLengthM(routes[0] as never)).toBeCloseTo(6, 9)
    expect(routes[0]?.from).toBe('a')
    expect(routes[0]?.to).toBe('b')
  })

  test('reverse flow traces the same bed the other way', () => {
    const forward = routesOf(straight({ flow: 'forward' }))[0]
    const reverse = routesOf(straight({ flow: 'reverse' }))[0]
    if (!forward || !reverse) throw new Error('no route')
    expect(reverse.from).toBe('b')
    expect(reverse.to).toBe('a')
    expect(routeLengthM(reverse)).toBeCloseTo(routeLengthM(forward), 9)
    expect(reverse.points[0]).toEqual(forward.points[forward.points.length - 1] as never)
  })

  test('a bend’s route is its centreline arc, longer than the chord across it', () => {
    // Which is also why a box takes longer to cross a bend than its footprint
    // suggests — the arc is the distance, not the diagonal.
    const node = ConveyorCurveNode.parse({ id: 'conveyor_curve_f' })
    const route = routesOf(node)[0]
    if (!route) throw new Error('no route')
    const [ax, az] = route.points[0] ?? [0, 0]
    const [bx, bz] = route.points[route.points.length - 1] ?? [0, 0]
    expect(routeLengthM(route)).toBeGreaterThan(Math.hypot(bx - ax, bz - az))
  })

  test('a box really turns on a bend, by the arc less one chord', () => {
    // The catalogue's R8 falls out of following the route rather than being
    // carried as a flag: a curve's path bends and the box bends with it.
    //
    // The figure is the sweep minus **one** angular step, and that is arithmetic
    // rather than error: a heading here is a chord's, and the first and last
    // chords each sit half a step inside the arc. Asserting a clean 90° would
    // be asserting a tangent this simulation never computes — a box visibly
    // follows the chords, which at sixteen steps is under a centimetre out.
    for (const angle of ['45', '90', '180'] as const) {
      const bend = ConveyorCurveNode.parse({ id: 'conveyor_curve_g', angle })
      const route = routesOf(bend)[0]
      if (!route) throw new Error('no route')
      const entry = sampleRoute(route, 0).heading
      const exit = sampleRoute(route, routeLengthM(route)).heading
      const turned = Math.abs(((exit - entry + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
      const sweep = (Number(angle) * Math.PI) / 180
      expect({ angle, turned }).toEqual({ angle, turned: expect.closeTo(sweep - sweep / 16, 6) })
    }
  })

  test('a junction offers two routes and a two-ended shape offers one', () => {
    expect(routesOf(straight())).toHaveLength(1)
    expect(routesOf(ConveyorObliqueNode.parse({ id: 'conveyor_oblique_f' }))).toHaveLength(2)
    // A merge-only branch takes nothing out — goods arrive by it instead.
    expect(
      routesOf(ConveyorObliqueNode.parse({ id: 'conveyor_oblique_m', branchMode: 'merge' })),
    ).toHaveLength(1)
  })
})

describe('boxes travel the network and hand off at joints', () => {
  test('a free inlet is a head, and a mated one is not', () => {
    const { first, second, nodes } = pair()
    const network = buildNetwork(nodes)
    expect(network.heads).toEqual([first.id])
    expect(network.mates.get(`${first.id}:b`)).toEqual({ nodeId: second.id, port: 'a' })
  })

  test('a box crosses the seam and carries its overrun with it', () => {
    // Without the overrun a box stalls for one frame at every joint, which on a
    // twenty-module line is a visible stutter every few metres.
    const { first, second, nodes } = pair()
    const network = buildNetwork(nodes)
    const speed = moduleSpeedMPerSec(first)
    const boxes: FlowBox[] = [{ nodeId: first.id, routeIndex: 0, distance: 5.9, seed: 1 }]

    const after = step(network, boxes, 0.5, () => 99)
    const crossed = after.find((box) => box.nodeId === second.id)
    expect(crossed).toBeDefined()
    expect(crossed?.distance).toBeCloseTo(5.9 + speed * 0.5 - 6, 6)
  })

  test('a box off the end of an unjoined line leaves the simulation', () => {
    const node = straight()
    const network = buildNetwork({ [node.id]: node })
    const boxes: FlowBox[] = [{ nodeId: node.id, routeIndex: 0, distance: 5.99, seed: 1 }]
    const after = step(network, boxes, 0.5, () => 99)
    expect(after.filter((box) => box.seed === 1)).toHaveLength(0)
  })

  test('the head releases, and not faster than the boxes clear it', () => {
    const node = straight()
    const network = buildNetwork({ [node.id]: node })
    let seed = 0
    let boxes: FlowBox[] = []

    // One release on the first step, then nothing until the first has moved a
    // gap clear — a line that released every frame would be a solid bar.
    boxes = step(network, boxes, 0.016, () => ++seed)
    expect(boxes).toHaveLength(1)
    boxes = step(network, boxes, 0.016, () => ++seed)
    expect(boxes).toHaveLength(1)
  })

  test('a module deleted under a box takes the box with it', () => {
    const { first } = pair()
    const network = buildNetwork({ [first.id]: first })
    const boxes: FlowBox[] = [{ nodeId: 'conveyor_roller_2', routeIndex: 0, distance: 1, seed: 1 }]
    expect(step(network, boxes, 0.016, () => 99).filter((box) => box.seed === 1)).toHaveLength(0)
  })

  test('speed is the module’s own, so a slow section slows the box on it', () => {
    const slow = straight({ id: 'conveyor_roller_s', speed: '25' })
    const fast = straight({ id: 'conveyor_roller_x', speed: '60' })
    expect(moduleSpeedMPerSec(fast)).toBeGreaterThan(moduleSpeedMPerSec(slow))
    expect(moduleSpeedMPerSec(slow)).toBeCloseTo(25 / 60, 9)
  })
})

describe('a box sits on the rollers, in world space', () => {
  test('its height is the transport height, not the floor', () => {
    const node = straight({ position: [4, 0, -2], transportHeight: 0.57 })
    const network = buildNetwork({ [node.id]: node })
    const pose = poseOf(network, { nodeId: node.id, routeIndex: 0, distance: 3, seed: 1 })
    if (!pose) throw new Error('no pose')
    expect(pose.position[1]).toBeGreaterThan(0.57)
    // Halfway along a 6 m bed placed at x = 4 is x = 4.
    expect(pose.position[0]).toBeCloseTo(4, 9)
    expect(pose.position[2]).toBeCloseTo(-2, 9)
  })

  test('the node’s own rotation carries the box with it', () => {
    const turned = straight({ position: [0, 0, 0], rotation: [0, Math.PI / 2, 0] })
    const network = buildNetwork({ [turned.id]: turned })
    // A quarter along the bed, on a module turned a quarter: the box has moved
    // along world −Z rather than +X.
    const pose = poseOf(network, { nodeId: turned.id, routeIndex: 0, distance: 4.5, seed: 1 })
    if (!pose) throw new Error('no pose')
    expect(pose.position[0]).toBeCloseTo(0, 6)
    expect(pose.position[2]).toBeCloseTo(-1.5, 6)
  })
})
