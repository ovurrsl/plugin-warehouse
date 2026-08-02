import { lanePitch } from './lanes'
import { placeKey, shapeKeyOf } from './neighbours'
import type { DriveInRackNode } from './schema'

/**
 * Dragging a lane onto the side of a block.
 *
 * Lanes share their upright frame lines, and they only share them when they
 * stand at **exactly** one lane pitch — `neighbours.ts` works to half a
 * millimetre, because anything looser would merge posts that are visibly apart.
 * Nothing a user does by hand hits that.
 *
 * Alignment guides get close and no closer: they pull footprint edge to
 * footprint edge, which is the right distance, but only inside an 8 cm window
 * and only once the user is already within 8 cm. Duplicate does not help — the
 * host offsets a copy by a hardcoded metre on world X and Z, ignoring both the
 * lane pitch and the node's rotation.
 *
 * This is the magnet, wired as `capabilities.movable.groupMoveSnap` — the same
 * hook the selective rack and the conveyor family use, so it takes precedence
 * over grid snap and the host clears the alignment guides when it fires.
 *
 * ## Why it is not the rack's magnet with a different pitch
 *
 * Because the shape key must not match across kinds. A drive-in lane and a
 * selective bay standing at the same pitch have posts at different depths;
 * letting them magnet to each other would produce a seam neither builder will
 * merge, and the user would see two rows of posts a few centimetres apart with
 * nothing saying why.
 */

/**
 * How close a dragged lane comes before it clicks into a seam.
 *
 * Half a metre — the same figure the selective rack uses, and for the same
 * reason: about a third of a lane pitch, so it engages when the user is clearly
 * aiming at the side of a block and never when they are placing a lane in the
 * next aisle.
 */
const MAGNET_RADIUS = 0.5
const MAGNET_RADIUS_SQ = MAGNET_RADIUS * MAGNET_RADIUS

/** Bucket size for the seam index. One metre — wider than the magnet radius, so
 *  a lookup only ever reads the nine cells around the cursor. */
const CELL = 1

type Seam = { x: number; z: number; shape: string; owner: string }

type SeamIndex = {
  cells: Map<string, Seam[]>
  byPlace: Map<string, string>
}

function cellKey(x: number, z: number): string {
  return `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`
}

let indexedFrom: unknown = null
let index: SeamIndex = { cells: new Map(), byPlace: new Map() }

function build(nodes: Readonly<Record<string, unknown>>): SeamIndex {
  const cells = new Map<string, Seam[]>()
  const byPlace = new Map<string, string>()

  for (const value of Object.values(nodes)) {
    const shape = shapeKeyOf(value)
    if (shape === null) continue
    const lane = value as DriveInRackNode
    const [x, , z] = lane.position
    const rotationY = lane.rotation?.[1] ?? 0
    const pitch = lanePitch(lane)
    byPlace.set(placeKey(x, z), lane.id)

    // Local +X carries onto world (cos, −sin) — the convention the neighbour
    // test and the multiply both use. Backwards here would magnet a lane onto
    // the wrong side of its neighbour and look almost right.
    const dx = pitch * Math.cos(rotationY)
    const dz = -pitch * Math.sin(rotationY)

    for (const side of [1, -1]) {
      const seam: Seam = { x: x + side * dx, z: z + side * dz, shape, owner: lane.id }
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
 * The seam this lane should click into, or null to leave the drag alone.
 *
 * The shape has to match — same entry width, same section, same depth, same
 * facing — because that is what decides whether the two frame lines genuinely
 * coincide. It is the *same* predicate the frame builder uses, asked through
 * `shapeKeyOf`, so the magnet cannot pull a lane into a seam the builder then
 * refuses to merge.
 */
export function snapToNeighbourSeam(
  lane: DriveInRackNode,
  candidate: readonly [number, number, number],
  movingIds: readonly string[],
  nodes: Readonly<Record<string, unknown>>,
): [number, number, number] | null {
  const shape = shapeKeyOf(lane)
  if (shape === null) return null

  const moving = new Set<string>(movingIds)
  moving.add(lane.id)

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
        // A lane does not magnet to a seam of its own, or of anything else
        // travelling with it — otherwise dragging a block would have every lane
        // pulling on every other and nothing would move.
        if (moving.has(seam.owner)) continue
        // Nor onto a place another lane already stands in. A lane being dragged
        // out of the middle of a block is not "standing there" for this
        // purpose, so the hole it is leaving stays available to drop back into.
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
