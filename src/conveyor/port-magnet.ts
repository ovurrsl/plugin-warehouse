import { isPortMated } from './line-index'
import { frameWidthM, moduleLengthM, usefulWidthMm } from './metrics'
import type { ConveyorPortId } from './ports'
import { conveyorPorts, inletPort, outletPort, transportHeightAt } from './ports'
import type { ConveyorRollerNode } from './schema'

/**
 * Dragging a module onto the end of a line.
 *
 * The host's alignment guides pull footprint edge to footprint edge, which is
 * the right distance and only inside an 8 cm window; grid snap fights it,
 * because a 6 m bed is not a multiple of any grid step; and Duplicate offsets a
 * copy by a hardcoded metre on world X and Z, ignoring both the bed length and
 * the module's own rotation. So a duplicated module lands askew and there is
 * nothing to pull it home.
 *
 * This is `capabilities.movable.groupMoveSnap` — the host's kind-owned
 * attachment hook, the same one a cabinet uses to settle flush against a wall.
 * It runs in every snapping mode but Off, takes precedence over grid snap, and
 * the host clears the alignment guides when it fires.
 *
 * **Head to tail, never nose to nose.** A discharge mates an infeed; two
 * discharges facing each other is not a joint, it is two lines ending at the
 * same place, and snapping them together would draw a line that cannot run.
 * That rule lives here — in the thing that *creates* joints — rather than in
 * the line index, which only reads them back: a membership test that filtered
 * on direction would make the panel's "this line" a strict subset of what the
 * host actually drags.
 */

/**
 * How close before it clicks on.
 *
 * Half a metre, matching the rack's: it engages when the user is clearly aiming
 * at the end of a line and never when they are laying a second line alongside.
 * Wider than the 8 cm alignment window on purpose, because what it produces is
 * exact rather than approximate.
 */
const MAGNET_RADIUS = 0.5
const MAGNET_RADIUS_SQ = MAGNET_RADIUS * MAGNET_RADIUS

/** Bucket size for the free-end index. Wider than the radius, so a lookup reads
 *  nine cells rather than every module in the building. */
const CELL = 1

type FreeEnd = {
  nodeId: string
  port: ConveyorPortId
  /** True when goods leave here, so it wants an infeed against it. */
  isOutlet: boolean
  x: number
  y: number
  z: number
  /** Outward direction in plan, for the head-to-tail test. */
  dx: number
  dz: number
  /** What has to match: the lane a box travels through, and the height it
   *  travels at. Both are the catalogue's own joint rules — R1 and R2. */
  lane: number
  height: number
}

let indexedFrom: unknown = null
let index = new Map<string, FreeEnd[]>()

const cellKey = (x: number, z: number) => `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`

function asConveyor(node: unknown): ConveyorRollerNode | null {
  const record = node as { type?: unknown; id?: unknown } | null
  if (record?.type !== 'warehouse:conveyor-roller') return null
  if (typeof record.id !== 'string') return null
  return node as ConveyorRollerNode
}

/**
 * Every end a module could be joined to, built once per store write.
 *
 * Ends that already have something on them are left out: mating onto a filled
 * port would put two modules in the same place, which is worse than not
 * snapping at all.
 */
function build(nodes: Readonly<Record<string, unknown>>): Map<string, FreeEnd[]> {
  const cells = new Map<string, FreeEnd[]>()

  for (const value of Object.values(nodes)) {
    const conveyor = asConveyor(value)
    if (!conveyor) continue
    const outlet = outletPort(conveyor)

    for (const port of conveyorPorts(conveyor)) {
      const id = port.id as ConveyorPortId
      if (isPortMated(nodes, conveyor.id, id)) continue

      const end: FreeEnd = {
        nodeId: conveyor.id,
        port: id,
        isOutlet: id === outlet,
        x: port.position[0],
        y: port.position[1],
        z: port.position[2],
        dx: port.direction[0],
        dz: port.direction[2],
        lane: usefulWidthMm(conveyor),
        height: transportHeightAt(conveyor, id),
      }
      const key = cellKey(end.x, end.z)
      const bucket = cells.get(key)
      if (bucket) bucket.push(end)
      else cells.set(key, [end])
    }
  }
  return cells
}

function freeEnds(nodes: Readonly<Record<string, unknown>>): Map<string, FreeEnd[]> {
  if (nodes !== indexedFrom) {
    index = build(nodes)
    indexedFrom = nodes
  }
  return index
}

/** Drops the memo. Only needed so tests do not leak an index between cases. */
export function resetPortMagnet(): void {
  indexedFrom = null
  index = new Map()
}

/**
 * Where this module should click into, or null to leave the drag alone.
 *
 * Returns the module's own position, not the port's: the caller is moving a
 * node, and what it needs is where the node goes so that its end lands on the
 * other's.
 */
export function snapToLineEnd(
  conveyor: ConveyorRollerNode,
  candidate: readonly [number, number, number],
  rotationY: number,
  movingIds: readonly string[],
  nodes: Readonly<Record<string, unknown>>,
): [number, number, number] | null {
  const moving = new Set<string>(movingIds)
  moving.add(conveyor.id)

  const cells = freeEnds(nodes)
  const half = moduleLengthM(conveyor) / 2
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  const [cx, cy, cz] = candidate

  // This module's own two ends, at the candidate transform.
  const mine = (['a', 'b'] as const).map((id) => {
    const sign = id === 'b' ? 1 : -1
    return {
      id,
      isOutlet: id === outletPort(conveyor),
      x: cx + sign * half * cos,
      y: cy + transportHeightAt(conveyor, id),
      z: cz - sign * half * sin,
      dx: sign * cos,
      dz: -sign * sin,
    }
  })

  let bestDistance = MAGNET_RADIUS_SQ
  let best: { position: [number, number, number] } | null = null

  for (const end of mine) {
    const bx = Math.floor(end.x / CELL)
    const bz = Math.floor(end.z / CELL)
    for (let ix = bx - 1; ix <= bx + 1; ix++) {
      for (let iz = bz - 1; iz <= bz + 1; iz++) {
        for (const other of cells.get(`${ix}:${iz}`) ?? []) {
          if (moving.has(other.nodeId)) continue
          // Head to tail: one end has to be a discharge and the other an infeed.
          if (end.isOutlet === other.isOutlet) continue
          // R1 — the lane a box travels through has to be the same lane.
          if (other.lane !== usefulWidthMm(conveyor)) continue
          // R2 — and it has to be at the same height, with no tolerance. A step
          // between two beds is a step a box falls down.
          if (Math.abs(other.height - transportHeightAt(conveyor, end.id)) > 1e-6) continue
          // Facing each other, not side by side: the two outward directions must
          // be opposed. `-0.99` rather than `-1` leaves room for the float drift
          // in a rotation the user reached through eight 45° steps.
          if (end.dx * other.dx + end.dz * other.dz > -0.99) continue

          const distance = (other.x - end.x) ** 2 + (other.z - end.z) ** 2
          if (distance >= bestDistance) continue
          bestDistance = distance
          // Move the node by whatever moves this end onto that one.
          best = { position: [cx + (other.x - end.x), cy, cz + (other.z - end.z)] }
        }
      }
    }
  }

  return best?.position ?? null
}

/**
 * Whether two modules that are joined actually agree.
 *
 * The magnet only ever produces a correct joint, but a line can also be built
 * by hand, by paste, or by MCP — and the host's own 50 mm coincidence tolerance
 * will happily call two mismatched ends one line. So the panel checks what the
 * magnet would have enforced, rather than assuming it did.
 */
export function jointProblems(
  conveyor: ConveyorRollerNode,
  nodes: Readonly<Record<string, unknown>>,
): string[] {
  const problems: string[] = []
  const ports = conveyorPorts(conveyor)
  const outlet = outletPort(conveyor)
  const inlet = inletPort(conveyor)

  for (const port of ports) {
    const id = port.id as ConveyorPortId
    if (!isPortMated(nodes, conveyor.id, id)) continue

    for (const value of Object.values(nodes)) {
      const other = asConveyor(value)
      if (!other || other.id === conveyor.id) continue
      for (const theirs of conveyorPorts(other)) {
        const dx = theirs.position[0] - port.position[0]
        const dy = theirs.position[1] - port.position[1]
        const dz = theirs.position[2] - port.position[2]
        if (dx * dx + dy * dy + dz * dz > 0.05 * 0.05) continue

        const theirId = theirs.id as ConveyorPortId
        const theirOutlet = theirId === outletPort(other)
        const mineOutlet = id === outlet
        if (mineOutlet === theirOutlet) {
          problems.push(
            mineOutlet
              ? `Two discharges meet at the ${id === outlet ? 'downstream' : 'upstream'} end — nothing feeds either line.`
              : 'Two infeeds meet — no line delivers into this joint.',
          )
        }
        if (usefulWidthMm(other) !== usefulWidthMm(conveyor)) {
          problems.push(
            `Joined to a ${usefulWidthMm(other)} mm lane; a box wider than ${Math.min(usefulWidthMm(other), usefulWidthMm(conveyor))} mm cannot cross.`,
          )
        }
        if (Math.abs(transportHeightAt(other, theirId) - transportHeightAt(conveyor, id)) > 1e-6) {
          const step = Math.abs(transportHeightAt(other, theirId) - transportHeightAt(conveyor, id))
          problems.push(
            `A ${(step * 1000).toFixed(0)} mm step at the joint — boxes need an inclined belt or a lift, not a butt joint.`,
          )
        }
        if (Math.abs(frameWidthM(other) - frameWidthM(conveyor)) > 1e-6) {
          problems.push('Joined to a frame of a different width; the side guides will not line up.')
        }
      }
    }
    void inlet
  }
  return [...new Set(problems)]
}
