import { bayPitch } from './bays'
import { placeKey, shapeKeyOf } from './neighbours'
import type { M3ShelvingNode } from './schema'

/**
 * Dragging an M3 bay onto the end of a run.
 *
 * Bays share a frame only at **exactly** one bay pitch — half a millimetre —
 * and nothing the host offers reaches that: alignment guides pull edge to edge
 * inside an 8 cm window, grid snap fights a 1.03 m pitch that is a multiple of
 * no grid step, and Duplicate drops its copy a hardcoded metre along world X
 * and Z regardless of the node's rotation.
 *
 * Wired as `capabilities.movable.groupMoveSnap`, the host's kind-owned
 * attachment hook: it takes precedence over grid snap, runs in every snapping
 * mode but Off, and the host clears the alignment guides when it fires.
 */

/** Half a metre — the same figure the other three racking kinds use, so a user
 *  who has learned the gesture on one gets it on all four. */
const MAGNET_RADIUS = 0.5
const MAGNET_RADIUS_SQ = MAGNET_RADIUS * MAGNET_RADIUS

/** Bucket size for the seam index. One metre — wider than the magnet radius, so
 *  a lookup only ever reads the nine cells around the cursor. */
const CELL = 1

type Seam = { x: number; z: number; shape: string; owner: string }
type SeamIndex = { cells: Map<string, Seam[]>; byPlace: Map<string, string> }

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
    const bay = value as M3ShelvingNode
    const [x, , z] = bay.position
    const rotationY = bay.rotation?.[1] ?? 0
    const pitch = bayPitch(bay)
    byPlace.set(placeKey(x, z), bay.id)

    // Local +X carries onto world (cos, −sin) — the convention the neighbour
    // test uses. Backwards here would magnet a bay onto the wrong side and
    // look almost right.
    const dx = pitch * Math.cos(rotationY)
    const dz = -pitch * Math.sin(rotationY)

    for (const side of [1, -1]) {
      const seam: Seam = { x: x + side * dx, z: z + side * dz, shape, owner: bay.id }
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
 * The shape has to match, and it is the *same* predicate the frame builder asks
 * through `shapeKeyOf` — so the magnet cannot pull a bay into a seam the
 * builder then refuses to merge.
 */
export function snapToNeighbourSeam(
  bay: M3ShelvingNode,
  candidate: readonly [number, number, number],
  movingIds: readonly string[],
  nodes: Readonly<Record<string, unknown>>,
): [number, number, number] | null {
  const shape = shapeKeyOf(bay)
  if (shape === null) return null

  const moving = new Set<string>(movingIds)
  moving.add(bay.id)

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
        // Not its own seam, nor one belonging to anything travelling with it —
        // otherwise dragging a run would have every bay pulling on every other.
        if (moving.has(seam.owner)) continue
        // Nor onto a place another bay already stands in. A bay dragged out of
        // the middle of a run is not "standing there" for this purpose, so the
        // hole it is leaving stays available to drop back into.
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
