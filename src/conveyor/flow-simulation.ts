import { speedMPerSec as boosterSpeed } from './booster-metrics'
import { speedMPerSec as curveSpeed } from './curve-metrics'
import { type Route, routeLengthM, routesOf, sampleRoute, worldPoint } from './flow-routes'
import { speedMPerSec as launcherSpeed } from './launcher-metrics'
import { isPortMated } from './line-index'
import { speedMPerSec as straightSpeed } from './metrics'
import { speedMPerSec as obliqueSpeed } from './oblique-metrics'
import type { ConveyorModule, ConveyorPortId } from './ports'
import {
  asConveyorModule,
  conveyorPorts,
  isBoosterModule,
  isCurveModule,
  isLauncherModule,
  isObliqueModule,
  isTransferModule,
  localPorts,
} from './ports'
import { speedMPerSec as transferSpeed } from './transfer-metrics'

/**
 * Boxes travelling the network, simulated for the view and stored nowhere.
 *
 * **Nothing here is a node.** A box has no id in the scene graph, no place in
 * the undo history and no line in a saved file — it is what the drawing would
 * look like if the line were running, recomputed from the modules every frame.
 * Putting boxes in the store would make watching a line run an editing action:
 * every frame a store write, every write an undo step.
 *
 * The state below is module-scope and deliberately mutable. It is read by one
 * component — the flow system — and thrown away when the modules change.
 */

/** How far apart boxes are released, as a multiple of the box's own length.
 *  Contact accumulation is nose to tail; a working line runs with a gap. */
const RELEASE_GAP = 2.5

/** Boxes are a stand-in rather than a product: one size, the middle of the
 *  family's 150–800 mm range, so the eye reads flow rather than cargo. */
export const FLOW_BOX_M: readonly [number, number, number] = [0.4, 0.3, 0.3]

/** Anything beyond this and the simulation is drawing more than a person can
 *  follow — and paying for it every frame. */
const MAX_BOXES = 600

export type FlowBox = {
  /** Which module it is on, and which of that module's routes it is following. */
  nodeId: string
  routeIndex: number
  /** Metres travelled along that route. */
  distance: number
  /** Stable per-box value, so a box's branch choices do not change frame to
   *  frame. Seeded from a counter rather than from `Math.random`, so a scene
   *  replays identically. */
  seed: number
}

export type FlowPose = {
  position: [number, number, number]
  heading: number
}

/** Line speed in metres per second, whichever shape this is. */
export function moduleSpeedMPerSec(module: ConveyorModule): number {
  if (isCurveModule(module)) return curveSpeed(module)
  if (isLauncherModule(module)) return launcherSpeed(module)
  if (isBoosterModule(module)) return boosterSpeed(module)
  if (isTransferModule(module)) return transferSpeed(module)
  if (isObliqueModule(module)) return obliqueSpeed(module)
  return straightSpeed(module)
}

/**
 * A snapshot of the modules the simulation runs against.
 *
 * Rebuilt only when the store writes, for the reason the line index gives: the
 * host replaces `nodes` on every write, so an identity comparison is enough,
 * and a drag never touches the store at all.
 */
export type FlowNetwork = {
  modules: Map<string, ConveyorModule>
  routes: Map<string, Route[]>
  lengths: Map<string, number[]>
  /** `${nodeId}:${port}` → the module and port a box continues into. */
  mates: Map<string, { nodeId: string; port: ConveyorPortId }>
  /** Modules with a free inlet — where the simulation releases boxes. */
  heads: string[]
}

export function buildNetwork(nodes: Readonly<Record<string, unknown>>): FlowNetwork {
  const modules = new Map<string, ConveyorModule>()
  const routes = new Map<string, Route[]>()
  const lengths = new Map<string, number[]>()
  const mates = new Map<string, { nodeId: string; port: ConveyorPortId }>()
  const heads: string[] = []

  for (const value of Object.values(nodes)) {
    const module = asConveyorModule(value)
    if (!module) continue
    modules.set(module.id, module)
    const list = routesOf(module)
    routes.set(module.id, list)
    lengths.set(
      module.id,
      list.map((route) => routeLengthM(route)),
    )
  }

  // Which port a box arrives at, for every joint. Two ports coincide when the
  // line index says they are mated; this resolves *which* one, which the index
  // deliberately does not store.
  const worldPorts: Array<{ nodeId: string; port: ConveyorPortId; p: [number, number, number] }> =
    []
  for (const module of modules.values()) {
    for (const port of conveyorPorts(module)) {
      worldPorts.push({
        nodeId: module.id,
        port: port.id as ConveyorPortId,
        p: [port.position[0], port.position[1], port.position[2]],
      })
    }
  }
  for (const a of worldPorts) {
    for (const b of worldPorts) {
      if (a.nodeId === b.nodeId) continue
      const dx = a.p[0] - b.p[0]
      const dy = a.p[1] - b.p[1]
      const dz = a.p[2] - b.p[2]
      if (dx * dx + dy * dy + dz * dz > 0.05 * 0.05) continue
      mates.set(`${a.nodeId}:${a.port}`, { nodeId: b.nodeId, port: b.port })
    }
  }

  for (const module of modules.values()) {
    const inlet = localPorts(module).find((port) => port.role === 'in')
    if (!inlet) continue
    if (!isPortMated(nodes, module.id, inlet.id)) heads.push(module.id)
  }

  return { modules, routes, lengths, mates, heads }
}

/**
 * Which route a box takes out of a junction.
 *
 * Deterministic from the box's own seed, so a box that is going to divert has
 * always been going to divert — a frame-by-frame coin toss would make a box
 * hesitate visibly at the split. One in three takes the branch: enough that a
 * branch reads as used, few enough that the main line still reads as the main
 * line.
 */
const BRANCH_SHARE = 3

function chooseRoute(routes: Route[], seed: number): number {
  if (routes.length <= 1) return 0
  return seed % BRANCH_SHARE === 0 ? 1 : 0
}

/**
 * Advance every box by one frame, releasing and retiring as they run.
 *
 * Returns a fresh array rather than mutating in place: the caller writes the
 * result straight into an instance buffer, and a box that left the network this
 * frame simply is not in it.
 */
export function step(
  network: FlowNetwork,
  boxes: FlowBox[],
  dt: number,
  nextSeed: () => number,
): FlowBox[] {
  const alive: FlowBox[] = []

  for (const box of boxes) {
    const module = network.modules.get(box.nodeId)
    const routes = network.routes.get(box.nodeId)
    if (!module || !routes) continue
    const route = routes[box.routeIndex]
    const length = network.lengths.get(box.nodeId)?.[box.routeIndex]
    if (!route || length === undefined) continue

    let distance = box.distance + moduleSpeedMPerSec(module) * dt
    if (distance < length) {
      alive.push({ ...box, distance })
      continue
    }

    // Off the end: continue into whatever is mated there, carrying the overrun
    // so a box does not stall for a frame at every joint.
    const mate = network.mates.get(`${box.nodeId}:${route.to}`)
    if (!mate) continue
    const nextRoutes = network.routes.get(mate.nodeId)
    if (!nextRoutes || nextRoutes.length === 0) continue
    // Only routes that start where the box arrived. A box entering a junction
    // by its branch cannot leave by the route that starts at the main inlet.
    const usable = nextRoutes
      .map((candidate, index) => ({ candidate, index }))
      .filter((entry) => entry.candidate.from === mate.port)
    if (usable.length === 0) continue

    distance -= length
    const pick =
      usable[
        chooseRoute(
          usable.map((entry) => entry.candidate),
          box.seed,
        )
      ]
    if (!pick) continue
    alive.push({ nodeId: mate.nodeId, routeIndex: pick.index, distance, seed: box.seed })
  }

  // Release at every free inlet, spaced by the line's own speed so a fast
  // section is not fed at the rate of a slow one.
  for (const head of network.heads) {
    if (alive.length >= MAX_BOXES) break
    const module = network.modules.get(head)
    const routes = network.routes.get(head)
    if (!module || !routes || routes.length === 0) continue

    const spacing = FLOW_BOX_M[0] * RELEASE_GAP
    const closest = alive
      .filter((box) => box.nodeId === head)
      .reduce((min, box) => Math.min(min, box.distance), Number.POSITIVE_INFINITY)
    if (closest < spacing) continue

    const seed = nextSeed()
    alive.push({ nodeId: head, routeIndex: chooseRoute(routes, seed), distance: 0, seed })
  }

  return alive
}

/**
 * Transfers with a box on their cross route, republished every frame.
 *
 * A module-scope set rather than a store field, for the reason the boxes
 * themselves are not nodes: this is a fact about the current frame, read by the
 * transfer renderers and true for about a second at a time. The same memoised-
 * index shape the line index and the magnet already use.
 *
 * A renderer reading it one frame late is invisible — the whole travel is eight
 * millimetres — so nothing here needs to force a render.
 */
let lifting: ReadonlySet<string> = new Set()

export function publishLifting(network: FlowNetwork, boxes: readonly FlowBox[]): void {
  const next = new Set<string>()
  for (const box of boxes) {
    const module = network.modules.get(box.nodeId)
    if (!module || !isTransferModule(module)) continue
    // Route 1 is the cross discharge — see `./flow-routes`. A box on the
    // through route passes over strips that stay down.
    if (box.routeIndex === 1) next.add(box.nodeId)
  }
  lifting = next
}

export function isLifting(nodeId: string): boolean {
  return lifting.has(nodeId)
}

/** Drops the published set. Only needed so tests do not leak between cases. */
export function resetLifting(): void {
  lifting = new Set()
}

/** Where a box is, in world space, and which way it faces. */
export function poseOf(network: FlowNetwork, box: FlowBox): FlowPose | null {
  const module = network.modules.get(box.nodeId)
  const route = network.routes.get(box.nodeId)?.[box.routeIndex]
  if (!module || !route) return null

  const local = sampleRoute(route, box.distance)
  const [x, z] = worldPoint(module, local)
  const rotationY = module.rotation?.[1] ?? 0
  return {
    // Sitting on the rollers, not through them.
    position: [x, module.position[1] + module.transportHeight + FLOW_BOX_M[1] / 2, z],
    heading: rotationY + local.heading,
  }
}
