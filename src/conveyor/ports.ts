import type { NodePort } from '@pascal-app/core'
import { frameWidthM, moduleLengthM, usefulWidthM } from './metrics'
import type { ConveyorRollerNode } from './schema'

/**
 * Where a module can be joined, and to what.
 *
 * `def.ports` is the host's own connection contract, and declaring it buys two
 * things this package would otherwise have to build: a dragged module can mate
 * onto a free end, and — through `distributionRole: 'fitting'` — **the whole
 * connected line follows a dragged module rigidly, in one undo step.** Sixty
 * metres of conveyor moving as one object for about forty lines of this file.
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

/**
 * Ids are **geometric, never flow-named**.
 *
 * `'a'` is the local −X end and `'b'` the local +X end, whichever way goods
 * happen to travel. The host snapshots port ids when a drag begins, so a
 * `flow` flipped mid-drag would rename the ports underneath a live snapshot and
 * the connectivity solver would mate the wrong pair. Flow is read off the node
 * by anything that needs it, not off the port.
 */
export type ConveyorPortId = 'a' | 'b'

/** Which end goods enter and leave by, given the flow. Read by the magnet, so
 *  that two discharges are never mated nose to nose. */
export function inletPort(conveyor: ConveyorRollerNode): ConveyorPortId {
  return conveyor.flow === 'forward' ? 'a' : 'b'
}

export function outletPort(conveyor: ConveyorRollerNode): ConveyorPortId {
  return conveyor.flow === 'forward' ? 'b' : 'a'
}

/**
 * Height goods travel at, at a given end.
 *
 * A function rather than a read of `transportHeight`, because the next kind
 * along is an incline whose two ends differ — and a magnet written against the
 * field would silently mate a 0.75 m end onto a 1.2 m one the day that lands.
 */
export function transportHeightAt(conveyor: ConveyorRollerNode, _port: ConveyorPortId): number {
  return conveyor.transportHeight
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

export function conveyorPorts(conveyor: ConveyorRollerNode): NodePort[] {
  const cached = cache.get(conveyor as unknown as object)
  if (cached) return cached

  const half = moduleLengthM(conveyor) / 2
  const rotationY = conveyor.rotation?.[1] ?? 0
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  const [x, y, z] = conveyor.position

  const width = frameWidthM(conveyor)
  // Area-equivalent round size, which is what the field asks a rectangular port
  // to report. The lane, not the frame: what mates is what a box travels
  // through.
  const lane = usefulWidthM(conveyor)
  const equivalent = 2 * Math.sqrt((lane * lane) / Math.PI)

  const ports: NodePort[] = (['a', 'b'] as const).map((id) => {
    // Local ±X carried into world: +X goes to (cos, −sin).
    const sign = id === 'b' ? 1 : -1
    return {
      id,
      position: [x + sign * half * cos, y + transportHeightAt(conveyor, id), z - sign * half * sin],
      // Out of the body, so two mated ports face each other.
      direction: [sign * cos, 0, -sign * sin],
      diameter: equivalent * INCHES_PER_METRE,
      // Mandatory rather than decorative: without it a discharge sitting four
      // centimetres from a supply-duct collar mates for the host, and dragging
      // the conveyor would drag the duct across the building.
      system: 'conveyor',
      shape: 'rect',
      width: lane * INCHES_PER_METRE,
      height: width * INCHES_PER_METRE,
    }
  })

  cache.set(conveyor as unknown as object, ports)
  return ports
}

/** The world position of one end, without building both ports. */
export function portPosition(
  conveyor: ConveyorRollerNode,
  id: ConveyorPortId,
): [number, number, number] {
  const port = conveyorPorts(conveyor).find((candidate) => candidate.id === id)
  return port ? ([...port.position] as [number, number, number]) : [...conveyor.position]
}
