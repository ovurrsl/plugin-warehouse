'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useWarehouseStore } from '../store'
import { planBayDeletion } from './bay-delete'
import { PalletRackNode } from './schema'

/**
 * Applying a bay deletion, and routing Delete to it.
 *
 * The maths is in `./bay-delete` and is pure. This is the part that touches the
 * store, kept separate so the arithmetic stays testable without one.
 */

/**
 * Delete one bay of one rack.
 *
 * The whole change goes through a single `applyNodeChanges`, which is one store
 * write and therefore **one undo step**. It matters most for the split: a
 * create plus an update applied separately would leave Ctrl-Z restoring half a
 * run and needing a second press to find the rest, with the scene in a state
 * that never existed. `pauseSceneHistory` is not the tool for this — it stops
 * recording rather than grouping, so wrapping the operation in it would make
 * the deletion un-undoable altogether.
 */
export function deleteBay(rack: PalletRackNode, bay: number): boolean {
  const plan = planBayDeletion(rack, bay)
  if (!plan) return false

  const scene = useScene.getState()
  const id = rack.id as AnyNodeId

  if (plan.kind === 'delete-node') {
    scene.deleteNodes([id])
    useViewer.getState().setSelection({ selectedIds: [] })
    useWarehouseStore.getState().setFocusedBay(null)
    return true
  }

  if (plan.kind === 'shrink') {
    scene.applyNodeChanges({ update: [{ id, data: plan.patch as Partial<AnyNode> }] })
    // The bays renumber around the cut, so the index that was focused now names
    // a different bay — or none. Clearing is the honest answer; guessing which
    // neighbour the user meant would silently edit the wrong one next.
    useWarehouseStore.getState().setFocusedBay(null)
    return true
  }

  // A fresh id for the half that becomes a new node. Parsing without one lets
  // the schema mint it, which is the same path the placement tool takes — and
  // `slots`/`bayOverrides` come along because they are plain data on the node.
  const { id: _drop, ...rest } = rack
  const right = PalletRackNode.parse({ ...rest, ...plan.right })

  scene.applyNodeChanges({
    update: [{ id, data: plan.left as Partial<AnyNode> }],
    create: [
      {
        node: right as unknown as AnyNode,
        parentId: (rack.parentId ?? undefined) as AnyNodeId | undefined,
      },
    ],
  })

  useWarehouseStore.getState().setFocusedBay(null)
  return true
}

/**
 * Send Delete to the focused bay instead of the whole run.
 *
 * Capture phase, because the host's own handler calls `preventDefault` and
 * deletes the selection — by the time a bubbling listener ran, the run would
 * already be gone. The guards are deliberately narrow, because a global key
 * listener that swallows Delete is the kind of thing that breaks something
 * unrelated and takes an hour to trace back:
 *
 *   - a bay is focused at all,
 *   - the rack that bay belongs to is the *sole* selection, so a multi-select
 *     delete still means what it says,
 *   - focus is not in a text field.
 *
 * Anything else falls through untouched and the host deletes the node, which is
 * still the right answer when the user selected the run from the outliner or
 * clicked the aisle between rows.
 */
let routing = false

export function ensureBayDeleteRouting(): void {
  if (routing || typeof window === 'undefined') return
  routing = true

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return

      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }

      const focused = useWarehouseStore.getState().focusedBay
      if (!focused) return

      const selected = useViewer.getState().selection.selectedIds
      if (selected.length !== 1 || selected[0] !== focused.rackId) return

      const node = useScene.getState().nodes[focused.rackId as AnyNodeId]
      if (!node || (node as { type?: string }).type !== 'warehouse:pallet-rack') return

      if (!deleteBay(node as unknown as PalletRackNode, focused.bay)) return

      event.preventDefault()
      event.stopPropagation()
      // Stops the host's own listener on the same target, which capture-phase
      // `stopPropagation` alone would not reach if it is bound at the same node.
      event.stopImmediatePropagation()
    },
    { capture: true },
  )
}
