import { lanePitch } from './lanes'
import type { DriveInRackNode } from './schema'

/**
 * Which lanes abut which.
 *
 * Lanes share their upright frame lines in real drive-in racking — ten lanes
 * stand on eleven frame lines, not twenty. Now that a lane is its own node,
 * each one would build both of its lines and every seam would carry two rows of
 * posts in the same place: doubled steel, doubled perforation texture, and
 * z-fighting on every coincident face.
 *
 * So a lane builds its **left** line always and its **right** line only when
 * nothing abuts it. Two lanes at one pitch then produce three lines — the
 * shared-frame count. Drag one clear and it grows its own closing line, because
 * its right neighbour is gone.
 *
 * The whole file is the selective rack's `neighbours.ts` with `bayPitch`
 * replaced by `lanePitch` and the shape key naming the fields a *lane* must
 * agree on. It is not shared with that file because the two kinds must not
 * share frames with each other: a drive-in lane and a selective bay standing at
 * the same pitch have posts at different depths, and omitting one would open a
 * gap in the steel rather than tidy one up.
 *
 * This is the only place a lane looks at another node, and it is read-only.
 */

/** Half a millimetre. Positions come from grid snapping and alignment pulls, so
 *  they agree to far better than this; the tolerance is for float drift, not
 *  for "close enough to look joined". */
const POSITION_EPSILON = 5e-4
/** ~0.03°. Two lanes must face the same way for their frames to coincide. */
const ANGLE_EPSILON = 5e-4
const TWO_PI = Math.PI * 2

type LaneLike = {
  id: string
  type?: unknown
  position?: unknown
  rotation?: unknown
  laneClearWidth?: unknown
  uprightWidth?: unknown
  uprightDepth?: unknown
  palletsDeep?: unknown
  depthClearance?: unknown
  palletPreset?: unknown
  palletOrientation?: unknown
}

function asLane(node: unknown): LaneLike | null {
  const record = node as LaneLike | null
  if (record?.type !== 'warehouse:drive-in-rack') return null
  if (typeof record.id !== 'string') return null
  if (!Array.isArray(record.position) || !Array.isArray(record.rotation)) return null
  return record
}

/**
 * Memoised on the lane object, because the store replaces only the nodes that
 * actually changed. During a slider scrub almost every lane is the same object
 * it was on the previous write, so its key becomes a lookup rather than an
 * array allocation and a join — and this index rebuilds on *every* store write,
 * which during a drag is every pointermove.
 */
const shapeKeys = new WeakMap<object, string>()

export function shapeKeyOf(lane: unknown): string | null {
  const record = asLane(lane)
  return record ? shapeKey(record) : null
}

/**
 * The key two lanes must agree on before they can share a frame line.
 *
 * The depth fields are in it because a lane's posts march down its depth: two
 * lanes of different depth, or holding a differently turned pallet, put their
 * posts at different Z and share nothing however well their entry widths match.
 * That is the difference from the selective rack, where a bay has two posts and
 * only the frame depth matters.
 */
function shapeKey(lane: LaneLike): string {
  const cached = shapeKeys.get(lane as object)
  if (cached !== undefined) return cached
  const rotation = (lane.rotation as number[])[1] ?? 0
  // Normalised into [0, 2π) before quantising: two lanes at 0 and at 2π face
  // the same way, and the host's rotate affordance accumulates rather than
  // wrapping, so a lane turned all the way round really does reach it.
  const turn = ((rotation % TWO_PI) + TWO_PI) % TWO_PI
  const key = [
    Math.round(turn / ANGLE_EPSILON),
    lane.laneClearWidth,
    lane.uprightWidth,
    lane.uprightDepth,
    lane.palletsDeep,
    lane.depthClearance,
    lane.palletPreset,
    lane.palletOrientation,
  ].join('|')
  shapeKeys.set(lane as object, key)
  return key
}

function positionKey(x: number, z: number): string {
  return `${Math.round(x / POSITION_EPSILON)}:${Math.round(z / POSITION_EPSILON)}`
}

/**
 * Where a lane's right neighbour would stand: one pitch along its own local +X,
 * rotated into world space.
 *
 * A +Y rotation carries local +X onto world (cos, −sin) — the same sign
 * convention the placement tool and the multiply use.
 */
export function rightNeighbourPosition(lane: DriveInRackNode): [number, number] {
  const [x, , z] = lane.position
  const rotationY = lane.rotation?.[1] ?? 0
  const pitch = lanePitch(lane)
  return [x + pitch * Math.cos(rotationY), z - pitch * Math.sin(rotationY)]
}

let indexedFrom: unknown = null
let index: ReadonlySet<string> = new Set()

function build(nodes: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  const byPlace = new Map<string, string>()
  const lanes: Array<{ lane: LaneLike; shape: string }> = []

  for (const value of Object.values(nodes)) {
    const lane = asLane(value)
    if (!lane) continue
    const shape = shapeKey(lane)
    lanes.push({ lane, shape })
    const [x, , z] = lane.position as number[]
    byPlace.set(`${shape}@${positionKey(x ?? 0, z ?? 0)}`, lane.id)
  }

  const withRight = new Set<string>()
  for (const { lane, shape } of lanes) {
    const [x, z] = rightNeighbourPosition(lane as unknown as DriveInRackNode)
    const found = byPlace.get(`${shape}@${positionKey(x, z)}`)
    // `found !== lane.id` guards a zero pitch, which cannot happen while
    // `laneClearWidth` has a minimum — but a lane reporting itself as its own
    // neighbour would silently delete its right frame and nothing would say why.
    if (found !== undefined && found !== lane.id) withRight.add(lane.id)
  }
  return withRight
}

/** Whether this lane has one abutting it on the right, and so should leave its
 *  right frame line to that neighbour. */
export function hasRightNeighbour(
  nodes: Readonly<Record<string, unknown>>,
  laneId: string,
): boolean {
  if (nodes !== indexedFrom) {
    index = build(nodes)
    indexedFrom = nodes
  }
  return index.has(laneId)
}

/** Drops the memo. Only needed so tests do not leak an index between cases. */
export function resetNeighbourIndex(): void {
  indexedFrom = null
  index = new Set()
  occupiedFrom = null
  occupied = new Set()
}

/**
 * Every place a lane already stands, quantised to the same tolerance.
 *
 * Multiply is a *command*, not a description: pressing it twice must not stack
 * a second block on top of the first. Deliberately position-only, ignoring
 * shape — a lane of any size standing where one would go is a lane in the way.
 */
let occupiedFrom: unknown = null
let occupied: ReadonlySet<string> = new Set()

export function occupiedPlaces(nodes: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  if (nodes !== occupiedFrom) {
    const places = new Set<string>()
    for (const value of Object.values(nodes)) {
      const lane = asLane(value)
      if (!lane) continue
      const [x, , z] = lane.position as number[]
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
