'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { slabAt } from '../host-adapter'
import { collectSlabs } from '../placement'
import { type MultiplySpec, multiplyPlacements } from './multiply'
import { occupiedPlaces, placeKey } from './neighbours'
import { PalletRackNode } from './schema'

/**
 * Applying a multiply.
 *
 * The arithmetic is in `./multiply` and is pure. This is the part that touches
 * the store, kept separate so the positions stay testable without one.
 *
 * Two entry points because there are two ways to get a run and only one way it
 * should end up: the panel multiplies a bay that already exists, the placement
 * tool commits the whole run on the click. Both go through `siblingsOf`, so a
 * twenty-bay run laid down with `]` is indistinguishable from one grown from the
 * panel afterwards.
 */

/**
 * The placements a spec calls for that are not already filled.
 *
 * Multiply is a command, and a command has to be idempotent about what already
 * exists. The spec lives in the store and outlives the selection, so laying a
 * 20-bay run down with `]` and then clicking any bay of it left the panel
 * offering "Place 19 more bays" — at the nineteen coordinates those bays already
 * occupy. Pressing it stacked a second run inside the first, invisibly, and the
 * only sign was the seams going dark where two meshes z-fought.
 *
 * Exported because the panel has to count them: the button's number and the
 * command's effect must be the same number.
 */
export function pendingPlacements(
  rack: PalletRackNode,
  spec: MultiplySpec,
  nodes: Readonly<Record<string, unknown>>,
): ReturnType<typeof multiplyPlacements> {
  const taken = occupiedPlaces(nodes)
  return multiplyPlacements(rack, spec).filter(
    (placement) => !taken.has(placeKey(placement.position[0], placement.position[2])),
  )
}

/**
 * The siblings a spec calls for, carrying every setting of the source.
 *
 * Ids are minted by re-parsing the source **without** its own id — the same path
 * the placement tool takes for the first bay — and `...rest` carries the rest of
 * the node across, so a sibling is a copy of the bay the user configured rather
 * than a fresh default.
 */
function siblingsOf(
  rack: PalletRackNode,
  spec: MultiplySpec,
  levelId: string | null,
): PalletRackNode[] {
  const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
  const { id: _drop, ...rest } = rack
  // Collected once. Electing per sibling walks the level's whole child list each
  // time, and in a finished warehouse those children are the racks — so a
  // 2,000-bay run into a level already holding 2,000 racks was four million
  // lookups and about 70 ms inside one click, growing with everything already
  // placed.
  const slabs = levelId ? collectSlabs(nodes, levelId) : []

  return pendingPlacements(rack, spec, nodes).map((placement) =>
    PalletRackNode.parse({
      ...rest,
      position: placement.position,
      rotation: placement.rotation,
      // Re-elected per sibling rather than inherited: a twenty-bay run is 57 m
      // long and can easily start on one slab and finish on another, and the
      // slab is what the host lifts the bay onto.
      supportSlabId: slabAt(slabs, placement.position[0], placement.position[2])?.id ?? null,
    }),
  )
}

/**
 * One store write for the whole run, and therefore **one undo step**.
 *
 * Nineteen creates applied one at a time would need nineteen presses of Ctrl-Z
 * to get back, with the run half-built at every stop along the way.
 * `pauseSceneHistory` is not the tool for this: it stops recording rather than
 * grouping, so the multiply would become un-undoable altogether.
 */
function commit(
  created: PalletRackNode[],
  parentId: string | null,
  select: (createdIds: string[]) => string[],
): string[] {
  if (created.length > 0) {
    useScene.getState().applyNodeChanges({
      create: created.map((node) => ({
        node: node as unknown as AnyNode,
        parentId: (parentId ?? undefined) as AnyNodeId | undefined,
      })),
    })
  }
  const createdIds = created.map((node) => node.id)
  const selected = select(createdIds)
  useViewer.getState().setSelection({ selectedIds: selected as unknown as AnyNodeId[] })
  return [...createdIds]
}

/**
 * Grow a run from a bay already in the scene. The source keeps its position, so
 * multiplying never moves what the user placed and aligned.
 *
 * **The source stays selected, and only the source.** Selecting the whole run
 * would be the better answer to "did that work" — except the host swaps to its
 * multi-selection panel above one node, which has no parametrics and no trailing
 * section. Selecting the run therefore replaced the panel the user had just
 * pressed a button in with a bare "20 selected", and the way back was to click a
 * single bay again. The viewport already shows the run appear.
 */
export function multiplyRack(rack: PalletRackNode, spec: MultiplySpec): string[] {
  const levelId = rack.parentId ?? null
  return commit(siblingsOf(rack, spec, levelId), levelId, () => [rack.id])
}

/**
 * Place a run in one go: the bay under the cursor plus everything the spec asks
 * for behind it, in a single write so the click is a single undo step.
 *
 * Here the whole run *is* selected, and the difference from `multiplyRack` is
 * deliberate: the placement tool stays armed afterwards, so no inspector panel
 * is on screen to lose, and seeing the run highlighted is the confirmation.
 */
export function placeRun(source: PalletRackNode, spec: MultiplySpec, levelId: string): string[] {
  return commit([source, ...siblingsOf(source, spec, levelId)], levelId, (ids) => ids)
}
