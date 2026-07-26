import type { NodePort } from '@pascal-app/core'
import {
  angleRad,
  arcPointLocal,
  centrelineRadiusM,
  centrelineLengthM as curveCentrelineLengthM,
  frameWidthM as curveFrameWidthM,
  usefulWidthMm as curveUsefulWidthMm,
} from './curve-metrics'
import type { ConveyorCurveNode } from './curve-schema'
import {
  lateralOuterZM,
  frameWidthM as launcherFrameWidthM,
  moduleLengthM as launcherLengthM,
  usefulWidthMm as launcherUsefulWidthMm,
  launchSign,
} from './launcher-metrics'
import type { ConveyorLauncherNode } from './launcher-schema'
import { frameWidthM, moduleLengthM, usefulWidthMm } from './metrics'
import type { ConveyorRollerNode } from './schema'

/**
 * Where a module can be joined, and to what — for **every** shape in the kind.
 *
 * `def.ports` is the host's own connection contract, and declaring it buys two
 * things this package would otherwise have to build: a dragged module can mate
 * onto a free end, and — through `distributionRole: 'fitting'` — **the whole
 * connected line follows a dragged module rigidly, in one undo step.** Sixty
 * metres of conveyor moving as one object for about forty lines of this file.
 *
 * A straight and a curve are two shapes of one kind, so they share this file
 * rather than each owning a copy. What differs between them is exactly one
 * function — where the two ends sit in the node's own frame — and every other
 * consumer (the line index, the magnet, the panel) reads only the result. Two
 * copies would have drifted the first time a joint rule changed.
 *
 * The contract is written for ducts and it shows: `diameter` is in *inches*, and
 * a conveyor has no diameter. It is filled in honestly rather than left out —
 * the field's own documentation says a rectangular port reports its
 * area-equivalent round size — and the conversion happens here, at the one
 * boundary, exactly as `host-adapter.ts` narrows every other host shape in one
 * place.
 */

/** The one place metres become inches, because one host field is in inches. */
const INCHES_PER_METRE = 39.3701

export type ConveyorModule = ConveyorRollerNode | ConveyorCurveNode | ConveyorLauncherNode

/**
 * Ids are **geometric, never flow-named**.
 *
 * `'a'` is the end the shape starts at, `'b'` the end it finishes at, and `'c'`
 * the lateral one where a shape has three — whichever way goods happen to
 * travel through any of them.
 *
 * The reason is not that flow-named ids would race a drag: the host captures
 * every *other* node's port list by value when a move begins
 * (`port-connectivity.ts:176`) and re-reads only the moved node's, so renaming
 * a port through the inspector cannot desync a live snapshot. The reason is
 * that a junction has two discharges, and `out1` / `out2` would need a
 * tie-break that means nothing — while `'b'` and `'c'` are already the two
 * different places they physically are. Flow decides what a port *does*; it
 * never decides what it is called.
 */
export type ConveyorPortId = 'a' | 'b' | 'c'

/**
 * What a port does, which is what decides whether two of them may mate.
 *
 * `'both'` is not a convenience: an oblique branch is ordered as a divert or a
 * merge and installed either way round, so the port genuinely accepts goods in
 * both directions and a design that forced it to pick would describe half the
 * catalogue's own configurations as errors.
 */
export type PortRole = 'in' | 'out' | 'both'

/** Every kind this package registers as one conveyor family. Narrowing reads
 *  this rather than a list per file — a kind missing from it is a kind whose
 *  ends the line index cannot see, which shows up as doubled steel at a seam
 *  rather than as an error. */
const CONVEYOR_KINDS = new Set([
  'warehouse:conveyor-roller',
  'warehouse:conveyor-curve',
  'warehouse:conveyor-launcher',
])

export function isCurveModule(module: ConveyorModule): module is ConveyorCurveNode {
  return module.type === 'warehouse:conveyor-curve'
}

export function isLauncherModule(module: ConveyorModule): module is ConveyorLauncherNode {
  return module.type === 'warehouse:conveyor-launcher'
}

/** Narrow an unknown scene node to a module of this kind, any shape. */
export function asConveyorModule(node: unknown): ConveyorModule | null {
  const record = node as { type?: unknown; id?: unknown } | null
  if (typeof record?.type !== 'string' || !CONVEYOR_KINDS.has(record.type)) return null
  if (typeof record.id !== 'string') return null
  return node as ConveyorModule
}

/**
 * Which end goods enter and leave by on a **two-ended** shape.
 *
 * Deliberately not generalised to three ports. Their only readers are the
 * shared-support rule — which asks a module whether the end it would cede is
 * mated — and the panel; and every three-port shape in the catalogue has a
 * fixed leg layout that cedes nothing. A junction answers `portRole` per port
 * instead, which is the question that actually has an answer there.
 */
export function inletPort(module: ConveyorModule): ConveyorPortId {
  return module.flow === 'forward' ? 'a' : 'b'
}

export function outletPort(module: ConveyorModule): ConveyorPortId {
  return module.flow === 'forward' ? 'b' : 'a'
}

/**
 * Height goods travel at, at a given end.
 *
 * A function rather than a read of `transportHeight`, because the next shape
 * along is an incline whose two ends differ — and a magnet written against the
 * field would silently mate a 0.75 m end onto a 1.2 m one the day that lands.
 */
export function transportHeightAt(module: ConveyorModule, _port: ConveyorPortId): number {
  return module.transportHeight
}

/** The lane a box travels through, in the catalogue's millimetres. What two
 *  modules must agree on to be joined — circuit rule R1. */
export function moduleLaneMm(module: ConveyorModule): number {
  if (isCurveModule(module)) return curveUsefulWidthMm(module)
  if (isLauncherModule(module)) return launcherUsefulWidthMm(module)
  return usefulWidthMm(module)
}

/**
 * How far a box travels through this module.
 *
 * The bed length on a straight and the **centreline arc** on a bend — not the
 * bend's footprint, which is the box it occupies rather than the distance goods
 * cover in it. A line's length is the sum of these, so getting a bend's wrong
 * would make every panel that reports a line's length wrong by the difference.
 */
export function moduleRunLengthM(module: ConveyorModule): number {
  if (isCurveModule(module)) return curveCentrelineLengthM(module)
  if (isLauncherModule(module)) return launcherLengthM(module)
  return moduleLengthM(module)
}

/** Outside of one side member to the outside of the other. Two families, two
 *  overhangs — 111 mm on a bend, 147 on a straight. */
export function moduleFrameWidthM(module: ConveyorModule): number {
  if (isCurveModule(module)) return curveFrameWidthM(module)
  if (isLauncherModule(module)) return launcherFrameWidthM(module)
  return frameWidthM(module)
}

export type LocalPort = {
  id: ConveyorPortId
  /** Position in the node's own frame. */
  x: number
  y: number
  z: number
  /** Outward heading in plan, so two mated ports face each other. */
  dx: number
  dz: number
  /**
   * What this end does. Derived from `flow` on a two-ended shape, because flow
   * is a per-instance field there and the same hardware runs either way round;
   * declared by the shape on a junction, where the lateral port's function is
   * what the machine is.
   */
  role: PortRole
  /**
   * The lane and the frame **at this port**, not at the node.
   *
   * Forced by the oblique transfer, whose branch is a 400 mm lane leaving a
   * 600 mm main line — the catalogue's own geometry. A per-node lane would
   * report that branch as a 600 mm opening to the host's collar sizing and to
   * rule R1, and would then read every oblique ever placed as a width mismatch
   * against itself.
   */
  laneMm: number
  frameWidthM: number
}

/**
 * The two ends in the node's own frame — the only thing a curve does differently.
 *
 * A straight's ends are on local ±X at half the bed length. A bend's are at the
 * two ends of its arc, on the centreline radius, facing along the tangent: the
 * entry against the sweep and the exit with it. Everything downstream — the
 * world ports below, the line index, and the magnet applying a *candidate*
 * transform mid-drag — works off this list, so none of them has to know which
 * shape it is holding.
 */
export function localPorts(module: ConveyorModule): LocalPort[] {
  if (isCurveModule(module)) {
    const sweep = angleRad(module)
    const radius = centrelineRadiusM(module)
    // A right-hand bend is the left one mirrored about local X, which flips the
    // tangent's Z with it.
    const hand = module.handed === 'left' ? 1 : -1

    const lane = curveUsefulWidthMm(module)
    const frame = curveFrameWidthM(module)

    return (['a', 'b'] as const).map((id) => {
      const theta = id === 'a' ? 0 : sweep
      const [x, z] = arcPointLocal(module, radius, theta)
      // The unit tangent of increasing θ is `(−sin θ, −hand·cos θ)`. Outward is
      // against it at the start of the arc and along it at the end.
      const outward = id === 'a' ? -1 : 1
      return {
        id,
        x,
        y: module.transportHeight,
        z,
        dx: outward * -Math.sin(theta),
        dz: outward * -hand * Math.cos(theta),
        role: (id === outletPort(module) ? 'out' : 'in') as PortRole,
        laneMm: lane,
        frameWidthM: frame,
      }
    })
  }

  if (isLauncherModule(module)) {
    const half = launcherLengthM(module) / 2
    const lane = launcherUsefulWidthMm(module)
    const frame = launcherFrameWidthM(module)
    const side = launchSign(module)
    const outlet = outletPort(module)

    const main = (['a', 'b'] as const).map((id) => {
      const sign = id === 'b' ? 1 : -1
      return {
        id,
        x: sign * half,
        y: module.transportHeight,
        z: 0,
        dx: sign,
        dz: 0,
        role: (id === outlet ? 'out' : 'in') as PortRole,
        laneMm: lane,
        frameWidthM: frame,
      }
    })

    // The launch. Always a discharge: the machine throws a box off the main
    // line, it does not accept one from the side — which is the difference
    // between a launcher and the oblique transfer's bidirectional branch.
    return [
      ...main,
      {
        id: 'c' as ConveyorPortId,
        x: 0,
        y: module.transportHeight,
        z: side * lateralOuterZM(module),
        dx: 0,
        dz: side,
        role: 'out' as PortRole,
        laneMm: lane,
        frameWidthM: frame,
      },
    ]
  }

  const half = moduleLengthM(module) / 2
  const lane = usefulWidthMm(module)
  const frame = frameWidthM(module)
  return (['a', 'b'] as const).map((id) => {
    const sign = id === 'b' ? 1 : -1
    return {
      id,
      x: sign * half,
      y: module.transportHeight,
      z: 0,
      dx: sign,
      dz: 0,
      role: (id === outletPort(module) ? 'out' : 'in') as PortRole,
      laneMm: lane,
      frameWidthM: frame,
    }
  })
}

/**
 * A local plan point carried into the world by a node transform.
 *
 * Shared with the magnet, which needs the same map applied to a *candidate*
 * position the store has never seen. Local +X goes to `(cos, −sin)` and local +Z
 * to `(sin, cos)`, which is what a +Y rotation does — every other file here
 * derives the same convention independently, so it is stated once.
 */
export function toWorldPlan(
  local: readonly [number, number],
  origin: readonly [number, number, number],
  cos: number,
  sin: number,
): [number, number] {
  return [origin[0] + local[0] * cos + local[1] * sin, origin[2] - local[0] * sin + local[1] * cos]
}

/**
 * Level-local ports, transform applied.
 *
 * The host is explicit that a kind storing its own transform applies it itself,
 * so this rotates and translates rather than returning local coordinates.
 *
 * Memoised on the node object. Any *other* kind's port snap re-scans the whole
 * scene calling `def.ports(node)` on every pointer tick, so during a duct drag
 * two hundred modules would otherwise allocate four hundred port objects per
 * pointer move. The store replaces only the nodes that changed, so the map hits
 * almost always.
 */
const cache = new WeakMap<object, NodePort[]>()

export function conveyorPorts(module: ConveyorModule): NodePort[] {
  const cached = cache.get(module as unknown as object)
  if (cached) return cached

  const rotationY = module.rotation?.[1] ?? 0
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  const origin = module.position

  const ports: NodePort[] = localPorts(module).map((local) => {
    const [x, z] = toWorldPlan([local.x, local.z], origin, cos, sin)
    const [dx, dz] = toWorldPlan([local.dx, local.dz], [0, 0, 0], cos, sin)
    // Per port, not per node: an oblique branch is a narrower opening than the
    // main line it leaves, and the host sizes a joining run's collar from these.
    const lane = local.laneMm / 1000
    // Area-equivalent round size, which is what the field asks a rectangular
    // port to report. The lane, not the frame: what mates is what a box travels
    // through.
    const equivalent = 2 * Math.sqrt((lane * lane) / Math.PI)
    return {
      id: local.id,
      position: [x, origin[1] + local.y, z],
      direction: [dx, 0, dz],
      diameter: equivalent * INCHES_PER_METRE,
      // Mandatory rather than decorative: without it a discharge sitting four
      // centimetres from a supply-duct collar mates for the host, and dragging
      // the conveyor would drag the duct across the building.
      system: 'conveyor',
      shape: 'rect',
      width: lane * INCHES_PER_METRE,
      height: local.frameWidthM * INCHES_PER_METRE,
    }
  })

  cache.set(module as unknown as object, ports)
  return ports
}

/** The world position of one end, without building both ports. */
export function portPosition(module: ConveyorModule, id: ConveyorPortId): [number, number, number] {
  const port = conveyorPorts(module).find((candidate) => candidate.id === id)
  return port ? ([...port.position] as [number, number, number]) : [...module.position]
}
