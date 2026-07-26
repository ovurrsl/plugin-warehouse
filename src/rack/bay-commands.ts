'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useWarehouseStore } from '../store'
import { planBaysDeletion } from './bay-delete'
import { PalletRackNode } from './schema'

/**
 * Applying a bay deletion, and routing Delete to it.
 *
 * The maths is in `./bay-delete` and is pure. This is the part that touches the
 * store, kept separate so the arithmetic stays testable without one.
 */

/**
 * Delete a set of bays from one rack.
 *
 * The whole change goes through a single `applyNodeChanges`, which is one store
 * write and therefore **one undo step**. It matters most when the run splits: a
 * create plus an update applied separately would leave Ctrl-Z restoring half a
 * run and needing a second press to find the rest, with the scene in a state
 * that never existed. `pauseSceneHistory` is not the tool for this — it stops
 * recording rather than grouping, so wrapping the operation in it would make
 * the deletion un-undoable altogether.
 */
export function deleteBays(rack: PalletRackNode, bays: Iterable<number>): boolean {
  const plan = planBaysDeletion(rack, bays)
  if (!plan) return false

  const scene = useScene.getState()
  const id = rack.id as AnyNodeId

  if (plan.kind === 'delete-node') {
    scene.deleteNodes([id])
    useViewer.getState().setSelection({ selectedIds: [] })
    useWarehouseStore.getState().setFocusedBays([])
    return true
  }

  // Fresh ids for the stretches that become new nodes. Parsing without an id
  // lets the schema mint one — the same path the placement tool takes — and
  // `slots`/`bayOverrides` come along because they are plain data on the node.
  const { id: _drop, ...rest } = rack
  const created = plan.rest.map(
    (patch) => PalletRackNode.parse({ ...rest, ...patch }) as unknown as AnyNode,
  )

  scene.applyNodeChanges({
    update: [{ id, data: plan.first as Partial<AnyNode> }],
    create: created.map((node) => ({
      node,
      parentId: (rack.parentId ?? undefined) as AnyNodeId | undefined,
    })),
  })

  // The bays renumber around the cuts, so the indices that were focused now
  // name different bays — or none. Clearing is the honest answer; guessing
  // which neighbour the user meant would silently edit the wrong one next.
  useWarehouseStore.getState().setFocusedBays([])
  return true
}

/**
 * Send Delete to the focused bays instead of the whole run.
 *
 * Capture phase, because the host's own handler calls `preventDefault` and
 * deletes the selection — by the time a bubbling listener ran, the run would
 * already be gone. The guards are deliberately narrow, because a global key
 * listener that swallows Delete is the kind of thing that breaks something
 * unrelated and takes an hour to trace back:
 *
 *   - at least one bay is focused,
 *   - the rack those bays belong to is the *sole* selection, so a multi-select
 *     delete still means what it says,
 *   - focus is not in a text field.
 *
 * Anything else falls through untouched and the host deletes the node, which is
 * still the right answer when the user selected the run from the outliner or
 * clicked the aisle between rows.
 *
 * Escape clears the bay focus — and deliberately does not consume the event,
 * because Esc also cancels tools and closes panels, and those should keep
 * working with bays focused.
 */
let routing = false

export function ensureBayDeleteRouting(): void {
  if (routing || typeof window === 'undefined') return
  routing = true

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        if (useWarehouseStore.getState().focusedBays.length > 0) {
          useWarehouseStore.getState().setFocusedBays([])
        }
        return
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') return

      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }

      const focused = useWarehouseStore.getState().focusedBays
      if (focused.length === 0) return
      const rackId = focused[0]?.rackId
      if (!rackId) return

      const selected = useViewer.getState().selection.selectedIds
      if (selected.length !== 1 || selected[0] !== rackId) return

      const node = useScene.getState().nodes[rackId as AnyNodeId]
      if (!node || (node as { type?: string }).type !== 'warehouse:pallet-rack') return

      const bays = focused.map((bay) => bay.bay)
      if (!deleteBays(node as unknown as PalletRackNode, bays)) return

      event.preventDefault()
      event.stopPropagation()
      // Stops the host's own listener on the same target, which capture-phase
      // `stopPropagation` alone would not reach if it is bound at the same node.
      event.stopImmediatePropagation()
    },
    { capture: true },
  )
}
