'use client'

import { emitter } from '@pascal-app/core'
import { type FocusedBay, useWarehouseStore } from '../store'
import type { PalletRackNode } from './schema'
import { bayAt, totalDepth, totalWidth } from './slots'

/**
 * Which bay a click landed on.
 *
 * The host has no sub-node selection, and the alternative — one child node per
 * bay, the way cabinet modules work — is one more draw call per bay, so a
 * twenty-bay block in a thousand-rack warehouse would add twenty thousand. A
 * click already carries its hit point, so the bay is arithmetic and costs
 * nothing.
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
 * Route rack clicks to the focused bay, once for the whole plugin.
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

  // The host types its event map over the built-in kinds, which by construction
  // cannot include a plugin's. Same cast the placement subscriptions use.
  emitter.on(
    'warehouse:pallet-rack:click' as never,
    ((payload: { node: PalletRackNode; localPosition: [number, number, number] }) => {
      const hit = bayFromLocalHit(payload.node, payload.localPosition)
      const next: FocusedBay | null = hit
        ? { rackId: payload.node.id, row: hit.row, bay: hit.bay }
        : null
      useWarehouseStore.getState().setFocusedBay(next)
    }) as never,
  )
}

/** The focused bay, but only while it names this rack — so a panel mounted for
 *  one rack can never edit another's. */
export function focusedBayOf(rack: PalletRackNode): { row: number; bay: number } | null {
  const focused = useWarehouseStore.getState().focusedBay
  if (!focused || focused.rackId !== rack.id) return null
  if (focused.row < 1 || focused.row > rack.rowCount) return null
  if (focused.bay < 1 || focused.bay > rack.bayCount) return null
  return { row: focused.row, bay: focused.bay }
}
