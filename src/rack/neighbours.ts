import type { PalletRackNode } from './schema'
import { bayPitch } from './slots'

/**
 * Which bays abut which.
 *
 * Bays share their upright frames in real racking — twenty bays stand on
 * twenty-one frames, not forty. Now that a bay is its own node, each one would
 * build both of its frames and every seam would carry two posts in the same
 * place: doubled steel, doubled perforation texture, and z-fighting on every
 * coincident face.
 *
 * So a bay builds its **left** frame always and its **right** frame only when
 * nothing abuts it on the right. Two bays at one pitch then produce three
 * frames — the shared-frame count, and one post at the seam. Drag one clear and
 * it grows its own closing frame, because its right neighbour is gone.
 *
 * This is the only place a rack looks at another node, and it is read-only.
 */

/** Half a millimetre. Positions come from grid snapping and alignment pulls, so
 *  they agree to far better than this; the tolerance is for float drift, not
 *  for "close enough to look joined". */
const POSITION_EPSILON = 5e-4
/** ~0.03°. Two bays must face the same way for their frames to coincide. */
const ANGLE_EPSILON = 5e-4

type RackLike = {
  id: string
  type?: unknown
  position?: unknown
  rotation?: unknown
  bayClearWidth?: unknown
  uprightWidth?: unknown
  depth?: unknown
  depthPositions?: unknown
  depthGap?: unknown
}

function asRack(node: unknown): RackLike | null {
  const record = node as RackLike | null
  if (record?.type !== 'warehouse:pallet-rack') return null
  if (typeof record.id !== 'string') return null
  if (!Array.isArray(record.position) || !Array.isArray(record.rotation)) return null
  return record
}

/**
 * The key two bays must agree on before they can share a frame.
 *
 * Frames only coincide if the posts are the same section at the same depth and
 * the bays face the same way — a shallower neighbour, or one turned a few
 * degrees, leaves a post that genuinely is not shared, and omitting it would
 * open a gap in the steel rather than tidy one up.
 *
 * Exported through `shapeKeyOf` so the drag magnet in `./magnet` asks the same
 * question the frame builder does. Two definitions of "these two bays match"
 * would drift, and the drift is invisible: the magnet would pull a bay into a
 * seam whose post the builder then refuses to share.
 */
const TWO_PI = Math.PI * 2

/**
 * Memoised on the rack object, because the store replaces only the nodes that
 * actually changed. During a slider scrub 1,999 of 2,000 racks are the same
 * object they were on the previous write, so their key becomes a lookup rather
 * than an array allocation and a join — and this index rebuilds on *every* store
 * write, which during a drag is every pointermove.
 */
const shapeKeys = new WeakMap<object, string>()

export function shapeKeyOf(rack: unknown): string | null {
  const record = asRack(rack)
  return record ? shapeKey(record) : null
}

function shapeKey(rack: RackLike): string {
  const cached = shapeKeys.get(rack as object)
  if (cached !== undefined) return cached
  const rotation = (rack.rotation as number[])[1] ?? 0
  // Normalised into [0, 2π) before quantising. Two bays at 0 and at 2π face the
  // same way, and the host's rotate affordance accumulates rather than wrapping,
  // so a bay turned all the way round really does reach it — quantising the raw
  // value made the two disagree about their shape and refuse to share a post.
  const turn = ((rotation % TWO_PI) + TWO_PI) % TWO_PI
  const key = [
    Math.round(turn / ANGLE_EPSILON),
    rack.bayClearWidth,
    rack.uprightWidth,
    rack.depth,
    rack.depthPositions,
    rack.depthGap,
  ].join('|')
  shapeKeys.set(rack as object, key)
  return key
}

/** Quantised world position, so two bays that agree to within the epsilon
 *  produce the same string. Half-open rounding, so a value exactly on a
 *  boundary lands consistently. */
function positionKey(x: number, z: number): string {
  return `${Math.round(x / POSITION_EPSILON)}:${Math.round(z / POSITION_EPSILON)}`
}

/**
 * Where a bay's right neighbour would stand: one pitch along its own local +X,
 * rotated into world space.
 *
 * A +Y rotation carries local +X onto world (cos, −sin), which is the same sign
 * convention the placement tool and the multiply use.
 */
export function rightNeighbourPosition(rack: PalletRackNode): [number, number] {
  const [x, , z] = rack.position
  const rotationY = rack.rotation?.[1] ?? 0
  const pitch = bayPitch(rack)
  return [x + pitch * Math.cos(rotationY), z - pitch * Math.sin(rotationY)]
}

/**
 * Bays that have a bay abutting them on the right, by node id.
 *
 * Built once per scene change and shared by every rack, keyed on the identity
 * of the `nodes` object — the host replaces it on every store write, so a stale
 * index cannot be handed back and an unchanged store costs one reference
 * comparison. The alternative, each rack scanning for its own neighbour, is
 * O(nodes) per rack: a thousand bays in a ten-thousand-node scene would be ten
 * million comparisons on every write.
 */
let indexedFrom: unknown = null
let index: ReadonlySet<string> = new Set()

function build(nodes: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  // Bays grouped by shape and position, so a lookup is one map hit.
  const byPlace = new Map<string, string>()
  // The shape key carried alongside the rack rather than recomputed in the
  // second pass. It cannot differ between the two, and computing it twice
  // doubled the string work of the one thing here that runs per store write.
  const racks: Array<{ rack: RackLike; shape: string }> = []

  for (const value of Object.values(nodes)) {
    const rack = asRack(value)
    if (!rack) continue
    const shape = shapeKey(rack)
    racks.push({ rack, shape })
    const [x, , z] = rack.position as number[]
    byPlace.set(`${shape}@${positionKey(x ?? 0, z ?? 0)}`, rack.id)
  }

  const withRight = new Set<string>()
  for (const { rack, shape } of racks) {
    const [x, z] = rightNeighbourPosition(rack as unknown as PalletRackNode)
    const found = byPlace.get(`${shape}@${positionKey(x, z)}`)
    // `found !== rack.id` guards a zero pitch, which cannot happen while
    // `bayClearWidth` has a minimum — but a bay reporting itself as its own
    // neighbour would silently delete its right frame and nothing would say why.
    if (found !== undefined && found !== rack.id) withRight.add(rack.id)
  }
  return withRight
}

/** Whether this bay has one abutting it on the right, and so should leave its
 *  right frame to that neighbour. */
export function hasRightNeighbour(
  nodes: Readonly<Record<string, unknown>>,
  rackId: string,
): boolean {
  if (nodes !== indexedFrom) {
    index = build(nodes)
    indexedFrom = nodes
  }
  return index.has(rackId)
}

/** Drops the memo. Only needed so tests do not leak an index between cases. */
export function resetNeighbourIndex(): void {
  indexedFrom = null
  index = new Set()
  occupiedFrom = null
  occupied = new Set()
}

/**
 * Every place a bay already stands, quantised to the same tolerance.
 *
 * Multiply is a *command*, not a description: pressing it twice must not stack a
 * second run on top of the first. The spec lives in the store and survives
 * selection changes, so laying a 20-bay run down and then clicking any bay of it
 * left the panel offering to place the same nineteen bays again — at the same
 * nineteen coordinates.
 *
 * Deliberately position-only, ignoring shape: a bay of any size standing where
 * one would go is a bay in the way, and putting a second node inside it is never
 * what was meant.
 */
let occupiedFrom: unknown = null
let occupied: ReadonlySet<string> = new Set()

export function occupiedPlaces(nodes: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  if (nodes !== occupiedFrom) {
    const places = new Set<string>()
    for (const value of Object.values(nodes)) {
      const rack = asRack(value)
      if (!rack) continue
      const [x, , z] = rack.position as number[]
      places.add(positionKey(x ?? 0, z ?? 0))
    }
    occupied = places
    occupiedFrom = nodes
  }
  return occupied
}

/** The key `occupiedPlaces` files a position under, so a caller can ask about a
 *  place it has computed rather than one it has found. */
export function placeKey(x: number, z: number): string {
  return positionKey(x, z)
}
