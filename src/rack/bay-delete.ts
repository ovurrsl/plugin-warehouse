import type { PalletRackNode } from './schema'
import { bayPitch, parseBayAddress, totalWidth } from './slots'

/**
 * Deleting one bay of a run.
 *
 * The host deletes *nodes*, and a block is one node, so pressing Delete with a
 * rack selected removes the whole run — which is right when you meant the run
 * and wrong every time you meant the bay you were looking at. `capabilities`
 * has no "ask me first" hook, so the behaviour is built here and routed to
 * before the host's own delete runs.
 *
 * Three outcomes, and which one applies is geometry rather than preference:
 *
 * - **The only bay** — there is no run left, so the node goes.
 * - **An end bay** — the run shortens by one. The remaining bays must not move
 *   in the world, and because a block is always centred on its node, keeping
 *   them still means moving the node by half a bay pitch toward the deleted
 *   end.
 * - **An interior bay** — the run cannot shorten without dragging one half
 *   across the other, so it splits into two nodes with the deleted bay's clear
 *   width standing open between them. Both halves keep the frame they shared
 *   with the deleted bay, which is what unbolting its beams would actually
 *   leave you with, and the frame count is unchanged.
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
 * Move every override left of / right of a removed bay onto its new index.
 *
 * Overrides outlive their bays otherwise, and a stale one is not inert: it is
 * keyed by index, so an entry that used to skip bay 5 starts skipping whatever
 * bay 5 has become.
 */
function renumber(
  overrides: PalletRackNode['bayOverrides'],
  keep: (bay: number) => boolean,
  shift: (bay: number) => number,
): PalletRackNode['bayOverrides'] {
  const next: PalletRackNode['bayOverrides'] = {}
  for (const [key, value] of Object.entries(overrides)) {
    const address = parseBayAddress(key)
    if (!address || !keep(address.bay)) continue
    next[`R${address.row}-B${shift(address.bay)}`] = value
  }
  return next
}

export type BayDeletion =
  /** Nothing is left of the run. */
  | { kind: 'delete-node' }
  /** The run shortens by one bay and the node slides to keep the rest still. */
  | { kind: 'shrink'; patch: Partial<PalletRackNode> }
  /** The run becomes two, with a bay-wide opening between them. */
  | { kind: 'split'; left: Partial<PalletRackNode>; right: Partial<PalletRackNode> }

/**
 * What deleting `bay` does to `rack`. `bay` is 1-based and block-wide: a bay is
 * a column of the block, so removing it removes it from every row. Leaving one
 * row's bay out while keeping the others is what `bayOverrides.skipped` is for,
 * and that stays.
 */
export function planBayDeletion(rack: PalletRackNode, bay: number): BayDeletion | null {
  if (bay < 1 || bay > rack.bayCount) return null
  if (rack.bayCount <= 1) return { kind: 'delete-node' }

  const pitch = bayPitch(rack)
  const width = totalWidth(rack)

  if (bay === 1 || bay === rack.bayCount) {
    // Toward the deleted end: dropping the first bay pulls the centre right,
    // dropping the last pulls it left, and by half a pitch either way because
    // the block loses one whole pitch of width and stays centred.
    const localShift = bay === 1 ? pitch / 2 : -pitch / 2
    return {
      kind: 'shrink',
      patch: {
        bayCount: rack.bayCount - 1,
        position: shifted(rack, localShift),
        bayOverrides:
          bay === 1
            ? renumber(
                rack.bayOverrides,
                (b) => b > 1,
                (b) => b - 1,
              )
            : renumber(
                rack.bayOverrides,
                (b) => b < rack.bayCount,
                (b) => b,
              ),
      },
    }
  }

  const leftCount = bay - 1
  const rightCount = rack.bayCount - bay
  const leftWidth = leftCount * pitch + rack.uprightWidth
  const rightWidth = rightCount * pitch + rack.uprightWidth

  // Both measured from the block's own left edge, so the pair occupies exactly
  // the envelope the single run did — the split moves no steel that survives.
  const leftCentre = -width / 2 + leftWidth / 2
  const rightCentre = -width / 2 + bay * pitch + rightWidth / 2

  return {
    kind: 'split',
    left: {
      bayCount: leftCount,
      position: shifted(rack, leftCentre),
      bayOverrides: renumber(
        rack.bayOverrides,
        (b) => b < bay,
        (b) => b,
      ),
    },
    right: {
      bayCount: rightCount,
      position: shifted(rack, rightCentre),
      bayOverrides: renumber(
        rack.bayOverrides,
        (b) => b > bay,
        (b) => b - bay,
      ),
    },
  }
}

/** The opening a split leaves between the two halves — the deleted bay's clear
 *  width, since both halves keep the frames they shared with it. */
export function splitGap(rack: PalletRackNode): number {
  return rack.bayClearWidth
}
