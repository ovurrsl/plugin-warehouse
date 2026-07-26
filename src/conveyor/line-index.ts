import type { ConveyorModule, ConveyorPortId } from './ports'
import { asConveyorModule, conveyorPorts, inletPort, outletPort } from './ports'

/**
 * Which modules make up a line, computed rather than stored.
 *
 * A line is not a node and has no id. It is the set of modules whose ends meet,
 * derived on demand from an index memoised on the identity of the store's
 * `nodes` object — the same technique the rack's neighbour test uses, and for
 * the same three reasons: the host replaces `nodes` on every write so a stale
 * answer cannot be handed back, an unchanged store costs one reference
 * comparison, and an imperative drag never touches the store at all, so the
 * index is built once per drag rather than once per pointer move.
 *
 * Storing a `lineId` on the node instead would need healing on every delete,
 * split, copy and paste, and would be able to disagree with the geometry. This
 * cannot: it *is* the geometry.
 *
 * One build answers three questions — which line is this, is this end free, and
 * does this module abut another — because they are all the same question about
 * which ports coincide.
 */

/**
 * **Fifty millimetres, and it is not mine to choose.**
 *
 * It is the host's own `COINCIDENT_EPS_M`, the tolerance its port-connectivity
 * solver uses — and the host, not this package, owns the drag that actually
 * moves a connected line. A tighter predicate here would make the set the panel
 * calls "this line" disagree with the set the host will translate, so after any
 * eyeballed move the panel would report an open joint on a joint that is about
 * to be dragged rigidly. That drift is exactly what the rack's neighbour module
 * documents as the thing to avoid.
 */
const JOINT_EPSILON = 0.05

/** Bucket size. Wider than the tolerance, so a lookup reads nine cells. */
const CELL = 1

type PortRef = { nodeId: string; port: ConveyorPortId; x: number; y: number; z: number }

type LineIndex = {
  /** Ports by cell, for coincidence lookups. */
  cells: Map<string, PortRef[]>
  /** Node id → the ids of every module in its connected line, including itself. */
  lines: Map<string, string[]>
  /** `${nodeId}:${port}` for every port that has another port on it. */
  mated: Set<string>
}

const cellKey = (x: number, z: number) => `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`
const portKey = (nodeId: string, port: ConveyorPortId) => `${nodeId}:${port}`

let indexedFrom: unknown = null
let index: LineIndex = { cells: new Map(), lines: new Map(), mated: new Set() }

function build(nodes: Readonly<Record<string, unknown>>): LineIndex {
  const cells = new Map<string, PortRef[]>()
  const all: PortRef[] = []

  for (const value of Object.values(nodes)) {
    const module = asConveyorModule(value)
    if (!module) continue
    for (const port of conveyorPorts(module)) {
      const ref: PortRef = {
        nodeId: module.id,
        port: port.id as ConveyorPortId,
        x: port.position[0],
        y: port.position[1],
        z: port.position[2],
      }
      all.push(ref)
      const key = cellKey(ref.x, ref.z)
      const bucket = cells.get(key)
      if (bucket) bucket.push(ref)
      else cells.set(key, [ref])
    }
  }

  // Union-find over coincident ports. Bucketed rather than the O(P²) double
  // loop the host's own component builder uses: four hundred ports would be
  // eighty thousand pair tests on every store write.
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== undefined && parent.get(root) !== root) {
      root = parent.get(root) as string
    }
    return root
  }
  const union = (a: string, b: string) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootA, rootB)
  }
  for (const ref of all) parent.set(ref.nodeId, parent.get(ref.nodeId) ?? ref.nodeId)

  const mated = new Set<string>()
  for (const ref of all) {
    const cx = Math.floor(ref.x / CELL)
    const cz = Math.floor(ref.z / CELL)
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        for (const other of cells.get(`${ix}:${iz}`) ?? []) {
          if (other.nodeId === ref.nodeId) continue
          const dx = other.x - ref.x
          const dy = other.y - ref.y
          const dz = other.z - ref.z
          if (dx * dx + dy * dy + dz * dz > JOINT_EPSILON * JOINT_EPSILON) continue
          mated.add(portKey(ref.nodeId, ref.port))
          union(ref.nodeId, other.nodeId)
        }
      }
    }
  }

  const byRoot = new Map<string, string[]>()
  for (const nodeId of parent.keys()) {
    const root = find(nodeId)
    const group = byRoot.get(root)
    if (group) group.push(nodeId)
    else byRoot.set(root, [nodeId])
  }
  const lines = new Map<string, string[]>()
  for (const group of byRoot.values()) {
    for (const nodeId of group) lines.set(nodeId, group)
  }

  return { cells, lines, mated }
}

function lineIndex(nodes: Readonly<Record<string, unknown>>): LineIndex {
  if (nodes !== indexedFrom) {
    index = build(nodes)
    indexedFrom = nodes
  }
  return index
}

/** Drops the memo. Only needed so tests do not leak an index between cases. */
export function resetLineIndex(): void {
  indexedFrom = null
  index = { cells: new Map(), lines: new Map(), mated: new Set() }
}

/** Every module in this one's line, including itself. A lone module is a line
 *  of one. */
export function lineOf(nodes: Readonly<Record<string, unknown>>, nodeId: string): string[] {
  return lineIndex(nodes).lines.get(nodeId) ?? [nodeId]
}

/** Whether an end already has something on it. */
export function isPortMated(
  nodes: Readonly<Record<string, unknown>>,
  nodeId: string,
  port: ConveyorPortId,
): boolean {
  return lineIndex(nodes).mated.has(portKey(nodeId, port))
}

/**
 * Whether the module downstream of this one abuts it, so the shared support at
 * that joint belongs to the neighbour.
 *
 * Downstream rather than "the +X end", because which end that is follows the
 * flow — and a support has to be built once per joint whichever way goods
 * travel through it.
 */
export function hasDownstreamNeighbour(
  nodes: Readonly<Record<string, unknown>>,
  module: ConveyorModule,
): boolean {
  return isPortMated(nodes, module.id, outletPort(module))
}

/** Whether the module upstream abuts. Used by the panel to describe a joint,
 *  not by the geometry — the upstream support is always built. */
export function hasUpstreamNeighbour(
  nodes: Readonly<Record<string, unknown>>,
  module: ConveyorModule,
): boolean {
  return isPortMated(nodes, module.id, inletPort(module))
}
