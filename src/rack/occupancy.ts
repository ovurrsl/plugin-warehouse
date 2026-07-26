/**
 * Which rack slots hold a real `warehouse:pallet` node.
 *
 * Built once per scene change and shared by every rack, rather than each rack
 * scanning the node map for itself. That distinction is the whole reason this
 * file exists: a per-rack scan is O(nodes) per rack, so a warehouse with a
 * thousand racks and ten thousand nodes would do ten million comparisons every
 * time anything in the scene moved. Indexing once is O(nodes) total.
 *
 * The index is keyed on the identity of the `nodes` object. The host replaces
 * that object on every store write, so a stale index can never be handed back,
 * and an unchanged store costs a single reference comparison.
 */

type NodeLike = {
  type?: unknown
  slotRackId?: unknown
  slotAddress?: unknown
}

const EMPTY: ReadonlySet<string> = new Set()

let indexedFrom: unknown = null
let index = new Map<string, Set<string>>()

function build(nodes: Readonly<Record<string, unknown>>): Map<string, Set<string>> {
  const next = new Map<string, Set<string>>()
  for (const value of Object.values(nodes)) {
    const node = value as NodeLike | null
    if (node?.type !== 'warehouse:pallet') continue
    const rackId = node.slotRackId
    const address = node.slotAddress
    // A pallet standing on the floor has neither, and a pallet that kept its
    // rack id but lost its address cannot be attributed to a slot — both are
    // skipped rather than guessed at, so a ghost never renders through a real
    // pallet whose address we merely failed to read.
    if (typeof rackId !== 'string' || typeof address !== 'string') continue
    const existing = next.get(rackId)
    if (existing) existing.add(address)
    else next.set(rackId, new Set([address]))
  }
  return next
}

/** Slot addresses occupied by real pallets in the given rack. */
export function occupiedSlots(
  nodes: Readonly<Record<string, unknown>>,
  rackId: string,
): ReadonlySet<string> {
  if (nodes !== indexedFrom) {
    index = build(nodes)
    indexedFrom = nodes
  }
  return index.get(rackId) ?? EMPTY
}

/** Drops the memo. Only needed so tests do not leak an index between cases. */
export function resetOccupancyIndex(): void {
  indexedFrom = null
  index = new Map()
}

/**
 * Stable 0..1 draw for a slot, in a particular rack.
 *
 * `ghostFill` needs to pick a subset of slots, and the pick has to be identical
 * on every render — `Math.random()` would reshuffle the whole rack each frame.
 * Hashing also makes the fill *progressive*: raising the fraction adds ghosts to
 * slots that were already empty instead of redealing, so the rack visibly fills
 * rather than flickering into a new arrangement.
 *
 * **The rack id is part of the draw, and has to be.** Every bay is its own node
 * now, and every bay therefore emits the same slot addresses — `R1-B1-L0-P1-D1`
 * and so on. Hashing the address alone gave every bay in a run the identical
 * draw, so a twenty-bay run at 30% fill showed the same three slots stocked
 * twenty times over: a perfectly repeating pattern no warehouse has ever had.
 * Under the block model the addresses ran `B1`..`B20` and the bug could not
 * arise.
 */
export function slotDraw(rackId: string, address: string): number {
  let hash = 0x811c9dc5
  // Fed as one stream with a separator, so `ab|c` and `a|bc` cannot collide.
  for (const text of [rackId, '|', address]) {
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
  }
  return ((hash >>> 0) % 10_000) / 10_000
}
