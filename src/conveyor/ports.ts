import type { NodePort } from '@pascal-app/core'
import {
  angleRad,
  arcPointLocal,
  centrelineRadiusM,
  frameWidthM as curveFrameWidthM,
  usefulWidthMm as curveUsefulWidthMm,
} from './curve-metrics'
import type { ConveyorCurveNode } from './curve-schema'
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

export type ConveyorModule = ConveyorRollerNode | ConveyorCurveNode

/**
 * Ids are **geometric, never flow-named**.
 *
 * `'a'` is the end the shape starts at and `'b'` the end it finishes at,
 * whichever way goods happen to travel. The host snapshots port ids when a drag
 * begins, so a `flow` flipped mid-drag would rename the ports underneath a live
 * snapshot and the connectivity solver would mate the wrong pair. Flow is read
 * off the node by anything that needs it, not off the port.
 */
export type ConveyorPortId = 'a' | 'b'

export function isCurveModule(module: ConveyorModule): module is ConveyorCurveNode {
  return module.type === 'warehouse:conveyor-curve'
}

/** Narrow an unknown scene node to a module of this kind, either shape. */
export function asConveyorModule(node: unknown): ConveyorModule | null {
  const record = node as { type?: unknown; id?: unknown } | null
  if (record?.type !== 'warehouse:conveyor-roller' && record?.type !== 'warehouse:conveyor-curve') {
    return null
  }
  if (typeof record.id !== 'string') return null
  return node as ConveyorModule
}

/** Which end goods enter and leave by, given the flow. Read by the magnet, so
 *  that two discharges are never mated nose to nose. */
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
  return isCurveModule(module) ? curveUsefulWidthMm(module) : usefulWidthMm(module)
}

/** Outside of one side member to the outside of the other. Two families, two
 *  overhangs — 111 mm on a bend, 147 on a straight. */
export function moduleFrameWidthM(module: ConveyorModule): number {
  return isCurveModule(module) ? curveFrameWidthM(module) : frameWidthM(module)
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
      }
    })
  }

  const half = moduleLengthM(module) / 2
  return (['a', 'b'] as const).map((id) => {
    const sign = id === 'b' ? 1 : -1
    return { id, x: sign * half, y: module.transportHeight, z: 0, dx: sign, dz: 0 }
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

  const frame = moduleFrameWidthM(module)
  // Area-equivalent round size, which is what the field asks a rectangular port
  // to report. The lane, not the frame: what mates is what a box travels
  // through.
  const lane = moduleLaneMm(module) / 1000
  const equivalent = 2 * Math.sqrt((lane * lane) / Math.PI)

  const ports: NodePort[] = localPorts(module).map((local) => {
    const [x, z] = toWorldPlan([local.x, local.z], origin, cos, sin)
    const [dx, dz] = toWorldPlan([local.dx, local.dz], [0, 0, 0], cos, sin)
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
      height: frame * INCHES_PER_METRE,
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
