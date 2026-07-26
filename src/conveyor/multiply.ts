import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { slabAt } from '../host-adapter'
import { collectSlabs } from '../placement'
import { moduleLengthM } from './metrics'
import { ConveyorRollerNode } from './schema'

/**
 * Laying a run down from one module.
 *
 * A module is a node, so a run is a line of them and "ten modules" is a command
 * that places nine more end to end. Every one is an ordinary node from that
 * moment — selectable, movable, deletable, copyable — which is the whole reason
 * the kind is shaped this way.
 *
 * The arithmetic is trivial next to the rack's, because a conveyor has one
 * axis: modules butt end to end along local +X at exactly the bed length, with
 * no shared-post half-width to reason about. What matters is the same as
 * there — the whole run goes down in **one** `applyNodeChanges`, which is one
 * store write and therefore one undo step. Nine creates applied one at a time
 * would need nine presses of Ctrl-Z, with the line half-built at every stop.
 */

/** Where the next module along starts, in world space. A +Y rotation carries
 *  local +X onto world (cos, −sin) — the convention every other file here
 *  derives independently, and the sign that is easy to get backwards. */
export function moduleOffsets(
  conveyor: ConveyorRollerNode,
  count: number,
): Array<[number, number, number]> {
  const [x, y, z] = conveyor.position
  const rotationY = conveyor.rotation?.[1] ?? 0
  const step = moduleLengthM(conveyor)
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)

  return Array.from({ length: Math.max(0, Math.floor(count) - 1) }, (_, index) => {
    const along = (index + 1) * step
    return [x + along * cos, y, z - along * sin] as [number, number, number]
  })
}

/**
 * Place `count - 1` more modules after this one, in one write.
 *
 * The source keeps its position, so laying a run never moves what the user
 * already placed and aligned. Ids are minted by re-parsing the source without
 * its own id — the same path the placement tool takes — and the rest of the
 * node comes across, so a sibling is a copy of the module that was configured
 * rather than a fresh default.
 */
export function extendConveyorRun(
  source: ConveyorRollerNode,
  count: number,
  levelId: string | null,
  options: { createSource?: boolean } = {},
): string[] {
  const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
  // Collected once rather than per sibling: electing a slab walks the level's
  // whole child list, and in a finished warehouse those children are the racks.
  const slabs = levelId ? collectSlabs(nodes, levelId) : []
  const { id: _drop, ...rest } = source

  const created = moduleOffsets(source, count).map((position) =>
    ConveyorRollerNode.parse({
      ...rest,
      position,
      // Re-elected per module: a sixty-metre run can easily start on one slab
      // and finish on another, and the slab is what the host lifts it onto.
      supportSlabId: slabAt(slabs, position[0], position[2])?.id ?? null,
    }),
  )

  const all = options.createSource ? [source, ...created] : created
  if (all.length > 0) {
    useScene.getState().applyNodeChanges({
      create: all.map((node) => ({
        node: node as unknown as AnyNode,
        parentId: (levelId ?? undefined) as AnyNodeId | undefined,
      })),
    })
  }

  const ids = all.map((node) => node.id)
  useViewer.getState().setSelection({ selectedIds: ids as unknown as AnyNodeId[] })
  return ids
}
