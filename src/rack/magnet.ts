import { placeKey, shapeKeyOf } from './neighbours'
import type { PalletRackNode } from './schema'
import { bayPitch } from './slots'

/**
 * Dragging a bay onto the end of a run.
 *
 * Bays share their upright frames, and they only share them when they stand at
 * **exactly** one bay pitch — `neighbours.ts` works to half a millimetre,
 * because anything looser would merge posts that are visibly apart. Nothing a
 * user does by hand hits that.
 *
 * Alignment guides get close and no closer. They pull footprint edge to
 * footprint edge, which is the right distance, but only inside an 8 cm window
 * and only once the user has already got within 8 cm. The host's Duplicate does
 * not help either: it offsets a copy by a hardcoded **one metre on world X and
 * one on world Z**, ignoring both the bay pitch and the rack's own rotation. So
 * a duplicated bay lands askew and diagonally overlapping its original, and
 * dragging it back into the run ends with two posts a few centimetres apart
 * instead of one shared post.
 *
 * This is the magnet. It is `capabilities.movable.groupMoveSnap` — the host's
 * kind-owned attachment snap, the same hook a cabinet uses to settle flush
 * against a wall — so it takes precedence over grid snap, runs in every
 * snapping mode except Off, and the host clears the alignment guides when it
 * fires.
 */

/**
 * How close a dragged bay comes before it clicks into a seam.
 *
 * Half a metre: about a sixth of a bay pitch, so it engages when the user is
 * clearly aiming at the end of a run and never when they are placing a bay in
 * the next aisle. Wider than the 8 cm alignment window on purpose — this is an
 * attachment rather than a guide, and what it produces is exact rather than
 * approximate.
 */
const MAGNET_RADIUS = 0.5
const MAGNET_RADIUS_SQ = MAGNET_RADIUS * MAGNET_RADIUS

/** Bucket size for the seam index. One metre — wider than the magnet radius, so
 *  a lookup only ever reads the nine cells around the cursor. */
const CELL = 1

type Seam = { x: number; z: number; shape: string; owner: string }

type SeamIndex = {
  /** Seams by cell, so a drag tick reads nine buckets instead of every rack. */
  cells: Map<string, Seam[]>
  /** Who stands where, so a seam already filled can be told from a free one —
   *  and so a bay being dragged out of a run does not count as filling the hole
   *  it is leaving. */
  byPlace: Map<string, string>
}

function cellKey(x: number, z: number): string {
  return `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`
}

/**
 * Every place a bay could join a run, built once per store write.
 *
 * A bay's two seams are one pitch along its own local ±X. Memoised on the
 * identity of the `nodes` object, like the neighbour index: the host replaces it
 * on every store write and does not touch it at all during an imperative drag,
 * so the index is built once per drag rather than once per pointer move.
 */
let indexedFrom: unknown = null
let index: SeamIndex = { cells: new Map(), byPlace: new Map() }

function build(nodes: Readonly<Record<string, unknown>>): SeamIndex {
  const cells = new Map<string, Seam[]>()
  const byPlace = new Map<string, string>()

  for (const value of Object.values(nodes)) {
    const shape = shapeKeyOf(value)
    if (shape === null) continue
    const rack = value as PalletRackNode
    const [x, , z] = rack.position
    const rotationY = rack.rotation?.[1] ?? 0
    const pitch = bayPitch(rack)
    byPlace.set(placeKey(x, z), rack.id)

    // Local +X carries onto world (cos, −sin) — the convention the neighbour
    // test and the multiply both use. Backwards here would magnet a bay onto
    // the wrong side of its neighbour and look almost right.
    const dx = pitch * Math.cos(rotationY)
    const dz = -pitch * Math.sin(rotationY)

    for (const side of [1, -1]) {
      const seam: Seam = { x: x + side * dx, z: z + side * dz, shape, owner: rack.id }
      const key = cellKey(seam.x, seam.z)
      const bucket = cells.get(key)
      if (bucket) bucket.push(seam)
      else cells.set(key, [seam])
    }
  }

  return { cells, byPlace }
}

function seamIndex(nodes: Readonly<Record<string, unknown>>): SeamIndex {
  if (nodes !== indexedFrom) {
    index = build(nodes)
    indexedFrom = nodes
  }
  return index
}

/** Drops the memo. Only needed so tests do not leak an index between cases. */
export function resetSeamIndex(): void {
  indexedFrom = null
  index = { cells: new Map(), byPlace: new Map() }
}

/**
 * The seam this bay should click into, or null to leave the drag alone.
 *
 * The shape has to match — same section, same depth, same facing — because that
 * is what decides whether the two posts genuinely coincide. It is the *same*
 * predicate the frame builder uses, asked through `shapeKeyOf`, so the magnet
 * cannot pull a bay into a seam the builder then refuses to merge.
 */
export function snapToNeighbourSeam(
  rack: PalletRackNode,
  candidate: readonly [number, number, number],
  movingIds: readonly string[],
  nodes: Readonly<Record<string, unknown>>,
): [number, number, number] | null {
  const shape = shapeKeyOf(rack)
  if (shape === null) return null

  const moving = new Set<string>(movingIds)
  moving.add(rack.id)

  const [x, y, z] = candidate
  const { cells, byPlace } = seamIndex(nodes)

  let best: Seam | null = null
  let bestDistance = MAGNET_RADIUS_SQ

  const cx = Math.floor(x / CELL)
  const cz = Math.floor(z / CELL)
  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const bucket = cells.get(`${ix}:${iz}`)
      if (!bucket) continue
      for (const seam of bucket) {
        if (seam.shape !== shape) continue
        // A bay does not magnet to a seam of its own, or of anything else
        // travelling with it — otherwise dragging a run would have every bay in
        // it pulling on every other and nothing would move.
        if (moving.has(seam.owner)) continue
        // Nor onto a place another bay already stands in. A bay being dragged
        // out of the middle of a run is not "standing there" for this purpose,
        // so the hole it is leaving stays available to drop back into.
        const occupant = byPlace.get(placeKey(seam.x, seam.z))
        if (occupant !== undefined && !moving.has(occupant)) continue

        const distance = (seam.x - x) ** 2 + (seam.z - z) ** 2
        if (distance >= bestDistance) continue
        bestDistance = distance
        best = seam
      }
    }
  }

  return best ? [best.x, y, best.z] : null
}
