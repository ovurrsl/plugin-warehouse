'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { slabAt } from '../host-adapter'
import { collectSlabs } from '../placement'
import { type MultiplySpec, multiplyPlacements } from './multiply'
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

  return multiplyPlacements(rack, spec).map((placement) =>
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
 *
 * Selecting the whole run afterwards is the answer to "did that work", and it
 * leaves the user holding exactly the set they would want to move or delete
 * next.
 */
function commit(created: PalletRackNode[], parentId: string | null, keep: string[]): string[] {
  if (created.length > 0) {
    useScene.getState().applyNodeChanges({
      create: created.map((node) => ({
        node: node as unknown as AnyNode,
        parentId: (parentId ?? undefined) as AnyNodeId | undefined,
      })),
    })
  }
  const ids = [...keep, ...created.map((node) => node.id)]
  useViewer.getState().setSelection({ selectedIds: ids as unknown as AnyNodeId[] })
  return ids
}

/** Grow a run from a bay already in the scene. The source keeps its position, so
 *  multiplying never moves what the user placed and aligned. */
export function multiplyRack(rack: PalletRackNode, spec: MultiplySpec): string[] {
  const levelId = rack.parentId ?? null
  return commit(siblingsOf(rack, spec, levelId), levelId, [rack.id])
}

/** Place a run in one go: the bay under the cursor plus everything the spec asks
 *  for behind it, in a single write so the click is a single undo step. */
export function placeRun(source: PalletRackNode, spec: MultiplySpec, levelId: string): string[] {
  return commit([source, ...siblingsOf(source, spec, levelId)], levelId, [])
}
