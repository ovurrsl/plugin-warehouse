'use client'

import { type AnyNodeId, emitter } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type FocusedBay, useWarehouseStore } from '../store'
import { ensureBayDeleteRouting } from './bay-commands'
import type { PalletRackNode } from './schema'
import { bayAt, totalDepth, totalWidth } from './slots'

/**
 * Which bay a click landed on, and the Shift gesture that grows the set.
 *
 * The host has no sub-node selection, and the alternative — one child node per
 * bay, the way cabinet modules work — is one more draw call per bay, so a
 * twenty-bay block in a thousand-rack warehouse would add twenty thousand. A
 * click already carries its hit point, so the bay is arithmetic and costs
 * nothing.
 *
 * Why Shift, specifically: the host reserves a plain second click on a selected
 * node for **picking it up to move**, so a plain click cannot reach a second
 * bay of an already-selected rack — it starts a drag. Shift is the click that
 * gets through, which makes it the multi-select gesture by necessity as much as
 * by convention.
 */

/**
 * Rack-local metres from a click's reported local point.
 *
 * `useNodeEvents` computes `localPosition` against **the object that was hit**,
 * not against the node — and the only hittable child a rack has is its picking
 * collider, a shared unit cube scaled to the block (every other mesh sets
 * `raycast` to a no-op). So the numbers arrive normalised to ±0.5 and have to be
 * scaled back by the block's own extent.
 *
 * That coupling is deliberate and local: this module and the renderer are the
 * two places that know the collider is a unit cube, and a test pins the round
 * trip. Reading the point as though it were already metres — the obvious
 * mistake — puts every click in bay 1 of a block wider than one metre, and
 * silently, because bay 1 is a plausible answer.
 */
export function bayFromLocalHit(
  rack: PalletRackNode,
  localPosition: readonly [number, number, number],
): { row: number; bay: number } | null {
  return bayAt(rack, localPosition[0] * totalWidth(rack), localPosition[2] * totalDepth(rack))
}

/**
 * The next focus set for a click. Pure, so the toggle rule is testable.
 *
 * A plain click replaces the set with the clicked bay. A Shift click toggles
 * the clicked bay — out if present, in if not — but only within one rack:
 * shifting onto a different rack starts a fresh set there, because a selection
 * spanning racks would make "the panel edits the focused bays" ambiguous about
 * which node it writes to.
 */
export function nextFocusedBays(
  current: readonly FocusedBay[],
  clicked: FocusedBay,
  shift: boolean,
): FocusedBay[] {
  if (!shift) return [clicked]
  const sameRack = current.filter((bay) => bay.rackId === clicked.rackId)
  if (sameRack.length !== current.length) return [clicked]
  const without = sameRack.filter((bay) => !(bay.row === clicked.row && bay.bay === clicked.bay))
  if (without.length !== sameRack.length) return without
  return [...sameRack, clicked]
}

/**
 * Route rack clicks to the focused bays, once for the whole plugin.
 *
 * One listener rather than one per mounted rack: the payload names its own node,
 * so a single handler serves every rack in the scene and a warehouse does not
 * pay a thousand listeners per click. Never torn down — it is one closure for
 * the life of the tab, and the module only loads in the browser because the
 * renderer that imports it is behind a lazy thunk.
 */
let subscribed = false

export function ensureBayFocusSubscription(): void {
  if (subscribed) return
  subscribed = true

  // Delete routing rides along: both are one-time browser-side setup, and the
  // routing is meaningless without a focused bay to route to.
  ensureBayDeleteRouting()

  // The host types its event map over the built-in kinds, which by construction
  // cannot include a plugin's. Same cast the placement subscriptions use.
  emitter.on(
    'warehouse:pallet-rack:click' as never,
    ((payload: {
      node: PalletRackNode
      localPosition: [number, number, number]
      nativeEvent?: { shiftKey?: boolean }
    }) => {
      const store = useWarehouseStore.getState()
      const hit = bayFromLocalHit(payload.node, payload.localPosition)
      if (!hit) {
        store.setFocusedBays([])
        return
      }

      const shift = payload.nativeEvent?.shiftKey === true
      const clicked: FocusedBay = { rackId: payload.node.id, row: hit.row, bay: hit.bay }
      store.setFocusedBays(nextFocusedBays(store.focusedBays, clicked, shift))

      // The host treats Shift+click as "toggle this node's membership in the
      // selection", so shifting onto an already-selected rack would deselect it
      // and take the inspector with it — while the user is mid-way through
      // picking bays. All emitter listeners run regardless of order, so the
      // host's toggle cannot be consumed here; it can only be undone. The
      // microtask runs after every click listener and before paint, so the
      // rack never renders deselected.
      if (shift) {
        const rackId = payload.node.id
        const selectedNow = useViewer.getState().selection.selectedIds
        if (selectedNow.includes(rackId as AnyNodeId)) {
          queueMicrotask(() => {
            const viewer = useViewer.getState()
            if (!viewer.selection.selectedIds.includes(rackId as AnyNodeId)) {
              viewer.setSelection({ selectedIds: [rackId as AnyNodeId] })
            }
          })
        }
      }
    }) as never,
  )
}

/** The focused bays, but only those naming this rack and inside its current
 *  shape — so a panel mounted for one rack can never edit another's, and an
 *  index left stale by a shrink drops out instead of pointing at nothing. */
export function focusedBaysOf(rack: PalletRackNode): Array<{ row: number; bay: number }> {
  return useWarehouseStore
    .getState()
    .focusedBays.filter(
      (bay) =>
        bay.rackId === rack.id &&
        bay.row >= 1 &&
        bay.row <= rack.rowCount &&
        bay.bay >= 1 &&
        bay.bay <= rack.bayCount,
    )
    .map(({ row, bay }) => ({ row, bay }))
}
