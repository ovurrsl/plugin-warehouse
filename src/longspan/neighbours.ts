import { bayPitch } from './levels'
import type { LongspanNode } from './schema'

/**
 * Which M7 bays abut which.
 *
 * Bays share frames — N bays stand on N+1 frames (CATALOG, and confirmed by
 * resellers). Each bay builds its **left** frame always and its **right** frame
 * only when nothing abuts it, so two bays at one pitch produce three frames and
 * one row of posts at the seam.
 *
 * A third copy of this file after the selective rack and the drive-in lane, and
 * deliberately not shared with either: the shape key names the fields *this*
 * kind must agree on before two frames genuinely coincide, and letting the
 * three kinds match each other would merge posts that stand at different depths
 * with different punch patterns.
 *
 * This is the only place a bay looks at another node, and it is read-only.
 */

/** Half a millimetre — for float drift, not for "close enough to look joined". */
const POSITION_EPSILON = 5e-4
/** ~0.03°. Two bays must face the same way for their frames to coincide. */
const ANGLE_EPSILON = 5e-4
const TWO_PI = Math.PI * 2

type BayLike = {
  id: string
  type?: unknown
  position?: unknown
  rotation?: unknown
  bayLength?: unknown
  frameDepth?: unknown
  frameHeight?: unknown
  uprightProfile?: unknown
}

function asBay(node: unknown): BayLike | null {
  const record = node as BayLike | null
  if (record?.type !== 'warehouse:longspan') return null
  if (typeof record.id !== 'string') return null
  if (!Array.isArray(record.position) || !Array.isArray(record.rotation)) return null
  return record
}

/**
 * Memoised on the node object: the store replaces only what actually changed,
 * so during a slider scrub almost every bay is the same object it was and its
 * key becomes a lookup rather than an allocation. This index rebuilds on every
 * store write, which during a drag is every pointermove.
 */
const shapeKeys = new WeakMap<object, string>()

export function shapeKeyOf(bay: unknown): string | null {
  const record = asBay(bay)
  return record ? shapeKey(record) : null
}

/**
 * What two bays must agree on before they share a frame.
 *
 * Height and depth are in it as well as length, because an M7 frame is a
 * two-post ladder of a particular depth: a shallower or shorter neighbour
 * leaves a frame that genuinely is not shared, and omitting it would open a gap
 * in the steel rather than tidy one up.
 *
 * The **levels are not** in it, and that is the difference from the geometry
 * key. Two bays on the same frame can carry completely different shelves and
 * still stand on one shared ladder — which is the point of a longspan run,
 * where a picking bay sits next to a bulk bay.
 */
function shapeKey(bay: BayLike): string {
  const cached = shapeKeys.get(bay as object)
  if (cached !== undefined) return cached
  const rotation = (bay.rotation as number[])[1] ?? 0
  const turn = ((rotation % TWO_PI) + TWO_PI) % TWO_PI
  const key = [
    Math.round(turn / ANGLE_EPSILON),
    bay.bayLength,
    bay.frameDepth,
    bay.frameHeight,
    bay.uprightProfile,
  ].join('|')
  shapeKeys.set(bay as object, key)
  return key
}

function positionKey(x: number, z: number): string {
  return `${Math.round(x / POSITION_EPSILON)}:${Math.round(z / POSITION_EPSILON)}`
}

/** Where a bay's right neighbour would stand: one pitch along its own local +X.
 *  A +Y rotation carries local +X onto world (cos, −sin). */
export function rightNeighbourPosition(bay: LongspanNode): [number, number] {
  const [x, , z] = bay.position
  const rotationY = bay.rotation?.[1] ?? 0
  const pitch = bayPitch(bay)
  return [x + pitch * Math.cos(rotationY), z - pitch * Math.sin(rotationY)]
}

let indexedFrom: unknown = null
let index: ReadonlySet<string> = new Set()

function build(nodes: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  const byPlace = new Map<string, string>()
  const bays: Array<{ bay: BayLike; shape: string }> = []

  for (const value of Object.values(nodes)) {
    const bay = asBay(value)
    if (!bay) continue
    const shape = shapeKey(bay)
    bays.push({ bay, shape })
    const [x, , z] = bay.position as number[]
    byPlace.set(`${shape}@${positionKey(x ?? 0, z ?? 0)}`, bay.id)
  }

  const withRight = new Set<string>()
  for (const { bay, shape } of bays) {
    const [x, z] = rightNeighbourPosition(bay as unknown as LongspanNode)
    const found = byPlace.get(`${shape}@${positionKey(x, z)}`)
    // A bay reporting itself as its own neighbour would silently delete its
    // right frame with nothing saying why.
    if (found !== undefined && found !== bay.id) withRight.add(bay.id)
  }
  return withRight
}

export function hasRightNeighbour(
  nodes: Readonly<Record<string, unknown>>,
  bayId: string,
): boolean {
  if (nodes !== indexedFrom) {
    index = build(nodes)
    indexedFrom = nodes
  }
  return index.has(bayId)
}

/** Drops the memo. Only needed so tests do not leak an index between cases. */
export function resetNeighbourIndex(): void {
  indexedFrom = null
  index = new Set()
  occupiedFrom = null
  occupied = new Set()
}

let occupiedFrom: unknown = null
let occupied: ReadonlySet<string> = new Set()

export function occupiedPlaces(nodes: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  if (nodes !== occupiedFrom) {
    const places = new Set<string>()
    for (const value of Object.values(nodes)) {
      const bay = asBay(value)
      if (!bay) continue
      const [x, , z] = bay.position as number[]
      places.add(positionKey(x ?? 0, z ?? 0))
    }
    occupied = places
    occupiedFrom = nodes
  }
  return occupied
}

export function placeKey(x: number, z: number): string {
  return positionKey(x, z)
}
