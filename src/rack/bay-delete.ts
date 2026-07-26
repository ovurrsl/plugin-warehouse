import type { PalletRackNode } from './schema'
import { bayPitch, parseBayAddress, totalWidth } from './slots'

/**
 * Deleting bays from a run.
 *
 * The host deletes *nodes*, and a block is one node, so pressing Delete with a
 * rack selected removes the whole run — which is right when you meant the run
 * and wrong every time you meant the bays you were looking at. `capabilities`
 * has no "ask me first" hook, so the behaviour is built here and routed to
 * before the host's own delete runs.
 *
 * The general operation takes a **set** of bays (Shift+click grows the focus
 * set). Removing them partitions the run into the contiguous stretches that
 * survive, and each stretch becomes a node:
 *
 * - **No stretches** — nothing is left, the node goes.
 * - **One stretch** — the run shortens. The surviving bays must not move in the
 *   world, and because a block is always centred on its node, holding them
 *   still means moving the node.
 * - **Several stretches** — the run splits, each opening exactly as wide as the
 *   bays cut from it. Every stretch keeps the frames it shared with its
 *   removed neighbours — which is what unbolting those bays' beams would
 *   actually leave standing — so the frame count never changes.
 *
 * Everything here is pure — it returns the change, it does not apply it — so
 * the arithmetic is testable without a store.
 */

/** Where a block's centre sits after a local-frame shift, in world space. */
function shifted(rack: PalletRackNode, localX: number): [number, number, number] {
  const [x, y, z] = rack.position
  const rotationY = rack.rotation?.[1] ?? 0
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  return [x + localX * cos, y, z - localX * sin]
}

/**
 * Keep the overrides whose bay survives into `[first..last]`, renumbered to the
 * stretch's own 1-based indices.
 *
 * Overrides outlive their bays otherwise, and a stale one is not inert: it is
 * keyed by index, so an entry that used to skip bay 5 starts skipping whatever
 * bay 5 has become.
 */
function overridesFor(
  overrides: PalletRackNode['bayOverrides'],
  first: number,
  last: number,
): PalletRackNode['bayOverrides'] {
  const next: PalletRackNode['bayOverrides'] = {}
  for (const [key, value] of Object.entries(overrides)) {
    const address = parseBayAddress(key)
    if (!address || address.bay < first || address.bay > last) continue
    next[`R${address.row}-B${address.bay - first + 1}`] = value
  }
  return next
}

export type BayDeletion =
  /** Nothing is left of the run. */
  | { kind: 'delete-node' }
  /** One surviving stretch: the original node updates in place. */
  | { kind: 'shrink'; patch: Partial<PalletRackNode> }
  /** Several stretches: the original becomes the first, the rest are new. */
  | { kind: 'split'; left: Partial<PalletRackNode>; right: Partial<PalletRackNode> }

export type BaysDeletion =
  | { kind: 'delete-node' }
  | {
      kind: 'segments'
      /** Update for the original node — the first surviving stretch. */
      first: Partial<PalletRackNode>
      /** New nodes for every further stretch, left to right. */
      rest: Partial<PalletRackNode>[]
    }

/**
 * What deleting `bays` does to `rack`. Bays are 1-based and block-wide: a bay
 * is a column of the block, so removing it removes it from every row. Leaving
 * one row's bay out while keeping the others is what `bayOverrides.skipped` is
 * for, and that stays.
 */
export function planBaysDeletion(
  rack: PalletRackNode,
  bays: Iterable<number>,
): BaysDeletion | null {
  const removed = new Set<number>()
  for (const bay of bays) {
    if (bay >= 1 && bay <= rack.bayCount) removed.add(bay)
  }
  if (removed.size === 0) return null
  if (removed.size >= rack.bayCount) return { kind: 'delete-node' }

  // The contiguous stretches that survive, as [first, last] bay indices.
  const stretches: Array<[number, number]> = []
  let start: number | null = null
  for (let bay = 1; bay <= rack.bayCount + 1; bay++) {
    const kept = bay <= rack.bayCount && !removed.has(bay)
    if (kept && start === null) start = bay
    if (!kept && start !== null) {
      stretches.push([start, bay - 1])
      start = null
    }
  }

  const pitch = bayPitch(rack)
  const width = totalWidth(rack)

  const patches = stretches.map(([first, last]) => {
    const count = last - first + 1
    // Measured from the block's own left edge, so every stretch stays exactly
    // where its bays already stand — the deletion moves no steel that survives.
    const stretchWidth = count * pitch + rack.uprightWidth
    const centreLocalX = -width / 2 + (first - 1) * pitch + stretchWidth / 2
    return {
      bayCount: count,
      position: shifted(rack, centreLocalX),
      bayOverrides: overridesFor(rack.bayOverrides, first, last),
    } satisfies Partial<PalletRackNode>
  })

  const [first, ...rest] = patches
  return { kind: 'segments', first: first as Partial<PalletRackNode>, rest }
}

/**
 * The single-bay case, kept as its own shape because the outcomes are worth
 * naming — the panel's button says "splits the run in two" before it happens.
 */
export function planBayDeletion(rack: PalletRackNode, bay: number): BayDeletion | null {
  const plan = planBaysDeletion(rack, [bay])
  if (!plan) return null
  if (plan.kind === 'delete-node') return plan
  if (plan.rest.length === 0) return { kind: 'shrink', patch: plan.first }
  return { kind: 'split', left: plan.first, right: plan.rest[0] as Partial<PalletRackNode> }
}

/** The opening a removed bay leaves behind — its clear width, since the
 *  stretches either side keep the frames they shared with it. */
export function splitGap(rack: PalletRackNode): number {
  return rack.bayClearWidth
}
