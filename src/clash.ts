import { nodeRegistry } from '@pascal-app/core'
import { localBoundsM as boosterBoundsM } from './conveyor/booster-metrics'
import type { ConveyorBoosterNode } from './conveyor/booster-schema'
import { LNC } from './conveyor/catalog'
import { colliderSegments, localBoundsM as curveBoundsM } from './conveyor/curve-metrics'
import type { ConveyorCurveNode } from './conveyor/curve-schema'
import {
  lateralOuterZM,
  localBoundsM as launcherBoundsM,
  frameWidthM as launcherFrameWidthM,
  moduleLengthM as launcherLengthM,
  launchSign,
} from './conveyor/launcher-metrics'
import type { ConveyorLauncherNode } from './conveyor/launcher-schema'
import { localBoundsM } from './conveyor/metrics'
import {
  branchCentreLocal,
  branchHeadingRad,
  branchLengthM,
  branchWidthM,
  mainWidthM,
  localBoundsM as obliqueBoundsM,
  moduleLengthM as obliqueLengthM,
} from './conveyor/oblique-metrics'
import type { ConveyorObliqueNode } from './conveyor/oblique-schema'
import type { ConveyorRollerNode } from './conveyor/schema'
import { localBoundsM as transferBoundsM } from './conveyor/transfer-metrics'
import type { ConveyorTransferNode } from './conveyor/transfer-schema'
import { liveRackingParts } from './live-racking/parts'
import type { LiveRackingNode } from './live-racking/schema'
import { mezzanineParts } from './mezzanine/parts'
import type { MezzanineNode } from './mezzanine/schema'
import { unitLoadHeightOf } from './pallet/cargo-types'
import { specOf } from './pallet/presets'
import type { PalletNode } from './pallet/schema'
import { rackParts } from './rack/parts'
import type { PalletRackNode } from './rack/schema'
import { totalDepth, totalWidth } from './rack/slots'

/**
 * Does this go here, or is something already in the way?
 *
 * **The host cannot answer that, and every kind in this package needs it
 * answered.** `floorPlaced.collides` compares plan rectangles — XZ only, no
 * height at all — so to the host a conveyor threading the walkway under a
 * racking run is indistinguishable from one driven through its uprights, and a
 * pallet resting on a conveyor bed is indistinguishable from one buried in it.
 * Declaring `collides: true` refuses the first of each pair; declaring it false
 * says nothing about the second. Neither is the answer, so the test is here, in
 * three dimensions, against what each object actually occupies.
 *
 * One module rather than one per kind, because the question is symmetric: a
 * conveyor must not be placed into a rack *and* a rack must not be placed into
 * a conveyor, and two files would answer that differently within a week.
 *
 * ## The two descriptions, and when each is used
 *
 * Every object has a **footprint** — the box it tiles at — and a **volume** —
 * the steel it actually occupies. They are not the same, and which one applies
 * depends on what is being asked:
 *
 * - **Different kinds** are compared by volume. That is the only way "under the
 *   rack's tunnel is fine, through its legs is not" can be expressed at all: a
 *   tunnelled level emits no beams in `rackParts`, so the clearance is real
 *   rather than assumed.
 * - **The same kind** is compared by footprint, because a kind's footprint is
 *   by definition its tiling unit. Two bays at the sharing pitch overlap *by
 *   design* — each builds both frames until it learns it has a neighbour — so a
 *   volume test would reject the one gesture the rack kind exists for. Their
 *   footprints touch exactly, which is what they are for.
 *
 * Stated as a rule rather than a special case, so a fourth kind inherits it.
 */

/** Half a centimetre. Two things touching is not two things clashing — a pallet
 *  set down against an upright face, or two modules butted end to end, are both
 *  legitimate and both land exactly on zero. */
const CLASH_EPSILON = 0.005

export type ClashBox = {
  cx: number
  cz: number
  hx: number
  hz: number
  minY: number
  maxY: number
  rotationY: number
}

/** A local-frame box carried into world space by its node's transform. */
export function toWorldBox(
  center: readonly [number, number, number],
  size: readonly [number, number, number],
  origin: readonly [number, number, number],
  rotationY: number,
): ClashBox {
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  // Local +X carries onto world (cos, −sin); local +Z onto (sin, cos). The same
  // convention the rack's multiply, neighbour test and magnet all use, and the
  // sign on X is the one that is easy to get backwards.
  return {
    cx: origin[0] + center[0] * cos + center[2] * sin,
    cz: origin[2] - center[0] * sin + center[2] * cos,
    hx: size[0] / 2,
    hz: size[2] / 2,
    minY: origin[1] + center[1] - size[1] / 2,
    maxY: origin[1] + center[1] + size[1] / 2,
    rotationY,
  }
}

function extentAlong(box: ClashBox, axisX: number, axisZ: number): number {
  const cos = Math.cos(box.rotationY)
  const sin = Math.sin(box.rotationY)
  return box.hx * Math.abs(axisX * cos - axisZ * sin) + box.hz * Math.abs(axisX * sin + axisZ * cos)
}

/**
 * Separating-axis test in plan, plus a height interval.
 *
 * Four candidate axes — two per box — because two rectangles that do not
 * overlap always have a separating line parallel to an edge of one of them.
 * Height needs no rotation: nothing here tips.
 */
export function boxesOverlap(a: ClashBox, b: ClashBox): boolean {
  if (a.maxY <= b.minY + CLASH_EPSILON) return false
  if (b.maxY <= a.minY + CLASH_EPSILON) return false

  const dx = b.cx - a.cx
  const dz = b.cz - a.cz

  for (const box of [a, b]) {
    const cos = Math.cos(box.rotationY)
    const sin = Math.sin(box.rotationY)
    for (const [axisX, axisZ] of [
      [cos, -sin],
      [sin, cos],
    ] as const) {
      const distance = Math.abs(dx * axisX + dz * axisZ)
      const reach = extentAlong(a, axisX, axisZ) + extentAlong(b, axisX, axisZ)
      if (distance >= reach - CLASH_EPSILON) return false
    }
  }
  return true
}

// ── What a node occupies ────────────────────────────────────────────────────

type Placed = { type?: unknown; id?: unknown; position?: unknown; rotation?: unknown }

function placementOf(node: unknown): {
  id: string
  type: string
  position: [number, number, number]
  rotationY: number
} | null {
  const record = node as Placed | null
  if (typeof record?.id !== 'string' || typeof record.type !== 'string') return null
  if (!Array.isArray(record.position)) return null
  const rotation = Array.isArray(record.rotation) ? record.rotation : [0, 0, 0]
  return {
    id: record.id,
    type: record.type,
    position: record.position as [number, number, number],
    rotationY: (rotation[1] as number) ?? 0,
  }
}

/**
 * The single box a node tiles at — its declared floor footprint.
 *
 * Read through the registry rather than from a table here, so a host kind this
 * package has never heard of still obstructs: a column, a wall-mounted cabinet,
 * an item. That is the half of the requirement a hand-listed table would keep
 * failing at, silently, one new kind at a time.
 */
export function footprintBox(node: unknown): ClashBox | null {
  const placement = placementOf(node)
  if (!placement) return null
  const capabilities = nodeRegistry.get(placement.type)?.capabilities
  const floorPlaced = capabilities?.floorPlaced
  if (!floorPlaced?.footprint) return null
  if (floorPlaced.applies && !floorPlaced.applies(node as never)) return null

  const { dimensions } = floorPlaced.footprint(node as never)
  return toWorldBox([0, dimensions[1] / 2, 0], dimensions, placement.position, placement.rotationY)
}

/**
 * Everything a node actually occupies, in world space.
 *
 * One box for most things. A rack is the exception and the reason this function
 * exists at all: it is mostly air, and *which* air is the whole question — a
 * tunnel is a walkway a conveyor is meant to run through. `rackParts` at the
 * far tier is posts and beams, which is exactly the structure something can
 * hit, and a tunnelled level contributes nothing to it because the builder
 * emits nothing there.
 *
 * Read at the **near** tier, deliberately. The far tier is posts and beams, and
 * what it drops is the bracing — the diagonals that fill a frame's depth plane
 * from the floor to the top of the post. Reading it left the narrow side of a
 * pair of uprights looking like open air, so a conveyor could be run straight
 * through a braced frame. Footplates come along with it, which is right too:
 * two base plates in the same place are two base plates in the same place.
 */
export function occupiedVolumes(node: unknown): ClashBox[] {
  const placement = placementOf(node)
  if (!placement) return []

  if (placement.type === 'warehouse:pallet-rack') {
    const rack = node as PalletRackNode
    // `full`, not `simple`. The far tier is posts and beams only, and the
    // bracing is exactly what it drops — so a frame's depth plane, which
    // diagonals fill from the floor to the top of the post, read as open air
    // and a conveyor could be pushed straight through the narrow side of a
    // pair of uprights. Decking and support bars go the same way: a deck is a
    // surface, and nothing passes through a surface.
    return rackParts(rack, 'full').map((part) =>
      toWorldBox(part.center, part.size, rack.position, placement.rotationY),
    )
  }

  if (placement.type === 'warehouse:live-rack') {
    // The rack's reasoning: a gravity channel is mostly air, and the air
    // under its lowest level is a walkway. The `full` tier is used so the
    // rollers are present — a pallet resting on a channel is resting on
    // something, and the `simple` tier's single strip would swallow the
    // whole lane depth as solid.
    const live = node as LiveRackingNode
    return liveRackingParts(live, 'full').map((part) =>
      toWorldBox(part.center, part.size, live.position, placement.rotationY),
    )
  }

  if (placement.type === 'warehouse:mezzanine') {
    // The rack's reasoning, only sharper: a mezzanine is almost entirely
    // AIR, and that air is precisely the usable volume — the space *under*
    // one is open to racking, conveyor and trucks, which is why it gets
    // built at all. A single box would refuse every placement beneath it.
    //
    // The part list gives columns, beams, deck panels and railing; because
    // no panel is emitted inside a stair void, that hole stays a hole here
    // too — one definition of the void, not two.
    const mezzanine = node as MezzanineNode
    return mezzanineParts(mezzanine).map((part) =>
      toWorldBox(part.center, part.size, mezzanine.position, placement.rotationY),
    )
  }

  if (placement.type === 'warehouse:conveyor-oblique') {
    // Two beds, the second turned. The rectangle round a Y is mostly the wedge
    // between its arms, and in a real layout that wedge is where the line the
    // branch feeds runs — so a single box would refuse the very placement the
    // machine exists to make.
    const oblique = node as ConveyorObliqueNode
    const bounds = obliqueBoundsM(oblique)
    const height = bounds.max[1] - bounds.min[1]
    const centreY = bounds.min[1] + height / 2
    const [branchX, branchZ] = branchCentreLocal(oblique)

    return [
      toWorldBox(
        [0, centreY, 0],
        [obliqueLengthM(oblique), height, mainWidthM(oblique)],
        placement.position,
        placement.rotationY,
      ),
      toWorldBox(
        [branchX, centreY, branchZ],
        [branchLengthM(oblique), height, branchWidthM(oblique)],
        placement.position,
        placement.rotationY + branchHeadingRad(oblique),
      ),
    ]
  }

  if (placement.type === 'warehouse:conveyor-transfer') {
    const transfer = node as ConveyorTransferNode
    const local = transferBoundsM(transfer)
    return [
      toWorldBox(
        [
          (local.min[0] + local.max[0]) / 2,
          (local.min[1] + local.max[1]) / 2,
          (local.min[2] + local.max[2]) / 2,
        ],
        [local.max[0] - local.min[0], local.max[1] - local.min[1], local.max[2] - local.min[2]],
        placement.position,
        placement.rotationY,
      ),
    ]
  }

  if (placement.type === 'warehouse:conveyor-booster') {
    const booster = node as ConveyorBoosterNode
    const local = boosterBoundsM(booster)
    return [
      toWorldBox(
        [
          (local.min[0] + local.max[0]) / 2,
          (local.min[1] + local.max[1]) / 2,
          (local.min[2] + local.max[2]) / 2,
        ],
        [local.max[0] - local.min[0], local.max[1] - local.min[1], local.max[2] - local.min[2]],
        placement.position,
        placement.rotationY,
      ),
    ]
  }

  if (placement.type === 'warehouse:conveyor-launcher') {
    // Two boxes: the main body and the arm. The rectangle round an L is a third
    // empty, and on a launcher that empty corner is where the branch's own line
    // runs — so a single box would refuse the very placement the machine exists
    // to make. Floor to guide top on both, legs included.
    const launcher = node as ConveyorLauncherNode
    const bounds = launcherBoundsM(launcher)
    const height = bounds.max[1] - bounds.min[1]
    const frame = launcherFrameWidthM(launcher)
    const side = launchSign(launcher)
    const armDepth = lateralOuterZM(launcher) - frame / 2

    return (
      [
        { cz: 0, sx: launcherLengthM(launcher), sz: frame },
        { cz: side * (frame / 2 + armDepth / 2), sx: LNC.boxLengthM, sz: armDepth },
      ] as const
    ).map((part) =>
      toWorldBox(
        [0, bounds.min[1] + height / 2, part.cz],
        [part.sx, height, part.sz],
        placement.position,
        placement.rotationY,
      ),
    )
  }

  if (placement.type === 'warehouse:conveyor-curve') {
    // The arc, not the box around it. A quarter annulus fills under a third of
    // its own bounding square, so a single box would refuse a rack standing in
    // the corner the bend curls around — a corner that is, in a real layout,
    // exactly where the racking goes. The segments are the same ones the picker
    // uses, and both are floor-to-guide-top: a bend that fits under a tunnel
    // has to fit with its legs.
    const curve = node as ConveyorCurveNode
    const bounds = curveBoundsM(curve)
    const height = bounds.max[1] - bounds.min[1]
    return colliderSegments(curve).map((segment) =>
      toWorldBox(
        [segment.center[0], bounds.min[1] + height / 2, segment.center[1]],
        [segment.size[0], height, segment.size[1]],
        placement.position,
        placement.rotationY + segment.rotationY,
      ),
    )
  }

  if (placement.type === 'warehouse:conveyor-roller') {
    const conveyor = node as ConveyorRollerNode
    const local = localBoundsM(conveyor)
    return [
      toWorldBox(
        [
          (local.min[0] + local.max[0]) / 2,
          (local.min[1] + local.max[1]) / 2,
          (local.min[2] + local.max[2]) / 2,
        ],
        [local.max[0] - local.min[0], local.max[1] - local.min[1], local.max[2] - local.min[2]],
        placement.position,
        placement.rotationY,
      ),
    ]
  }

  if (placement.type === 'warehouse:pallet') {
    // Pallet plus whatever is stacked on it: a bare pallet is 144 mm and a
    // loaded one is over a metre, and something set down on top of a load is as
    // wrong as something set down inside the pallet.
    const pallet = node as PalletNode
    const spec = specOf(pallet.preset)
    // Derived, never typed: a pallet carrying cargo takes its height from the
    // variant its seed resolved to. There is no typed height to test instead —
    // testing one would have cleared a load that actually fouls the beam above.
    const height = unitLoadHeightOf(pallet)
    return [
      toWorldBox(
        [0, height / 2, 0],
        [spec.length, height, spec.width],
        placement.position,
        placement.rotationY,
      ),
    ]
  }

  const box = footprintBox(node)
  return box ? [box] : []
}

/** The single box that bounds everything a node occupies, for the cheap first
 *  pass. Anything that fails this cannot possibly clash. */
function envelopeOf(node: unknown): ClashBox | null {
  const placement = placementOf(node)
  if (!placement) return null

  if (placement.type === 'warehouse:pallet-rack') {
    const rack = node as PalletRackNode
    return toWorldBox(
      [0, rack.uprightHeight / 2, 0],
      [totalWidth(rack), rack.uprightHeight, totalDepth(rack)],
      rack.position,
      placement.rotationY,
    )
  }
  return footprintBox(node) ?? occupiedVolumes(node)[0] ?? null
}

// ── The scene, indexed ──────────────────────────────────────────────────────

/**
 * Every candidate, bucketed in plan — built once per store write.
 *
 * ## The cost this replaces
 *
 * `clashesWith` scanned `Object.values(nodes)` and rebuilt each candidate's
 * envelope from scratch, **per call**. The rack tool calls it once per bay of
 * the run being placed, and the host emits `grid:move` from a raw
 * `pointermove` listener — so a twenty-bay run in a five-thousand-node
 * warehouse cost about a hundred thousand envelope constructions *per mouse
 * move*, and a two-hundred-bay run a million. None of that work changes while
 * the mouse moves: the scene is identical between two pointer events.
 *
 * ## Why keying on the `nodes` object is sound
 *
 * The host replaces `nodes` on every write — the same property `occupancy.ts`
 * and `line-index.ts` already index against, and the reason a drag (which does
 * not touch the store) never invalidates any of them.
 *
 * ## Why a uniform grid rather than a tree
 *
 * A warehouse is a flat plane of similarly-sized boxes, which is the one
 * distribution a uniform grid is exactly right for; a BVH would pay for
 * rebalancing it cannot use. Anything too large to bucket usefully — a route
 * painted down a whole hall — goes in `oversized` and is simply always tested,
 * because there are a handful of those and pretending otherwise is how a
 * spatial index quietly starts missing collisions.
 */
const CELL_M = 8

/** How many cells one node may occupy before it is treated as oversized. */
const MAX_CELLS_PER_NODE = 64

/** Cell coordinates are folded into one integer key: a string key per queried
 *  cell would allocate inside the hot loop this exists to make cheap. */
const GRID_ORIGIN = 32768
const GRID_SPAN = 65536

function cellKey(gx: number, gz: number): number {
  return (gx + GRID_ORIGIN) * GRID_SPAN + (gz + GRID_ORIGIN)
}

type IndexedNode = {
  /** Position in `Object.values(nodes)`, so reported hits keep scene order
   *  however the grid happens to visit them. */
  order: number
  id: string
  type: string
  node: unknown
  envelope: ClashBox
  /** Derived on demand — only what survives the envelope test pays for it, and
   *  then only once for the whole life of this `nodes` object. */
  volumes?: ClashBox[]
  footprint?: ClashBox | null
  /** Dedupe stamp: one node reached through four cells is tested once. */
  seen: number
}

type SceneIndex = {
  cells: Map<number, IndexedNode[]>
  oversized: IndexedNode[]
}

/** Plan-space bounds of an oriented box. */
function planBounds(box: ClashBox): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const cos = Math.abs(Math.cos(box.rotationY))
  const sin = Math.abs(Math.sin(box.rotationY))
  const ax = box.hx * cos + box.hz * sin
  const az = box.hx * sin + box.hz * cos
  return { minX: box.cx - ax, maxX: box.cx + ax, minZ: box.cz - az, maxZ: box.cz + az }
}

function buildSceneIndex(nodes: Readonly<Record<string, unknown>>): SceneIndex {
  const cells = new Map<number, IndexedNode[]>()
  const oversized: IndexedNode[] = []
  let order = 0

  for (const node of Object.values(nodes)) {
    const placement = placementOf(node)
    if (!placement) {
      order++
      continue
    }
    const envelope = envelopeOf(node)
    if (!envelope) {
      order++
      continue
    }
    const indexed: IndexedNode = {
      order: order++,
      id: placement.id,
      type: placement.type,
      node,
      envelope,
      seen: 0,
    }

    const bounds = planBounds(envelope)
    const minGx = Math.floor(bounds.minX / CELL_M)
    const maxGx = Math.floor(bounds.maxX / CELL_M)
    const minGz = Math.floor(bounds.minZ / CELL_M)
    const maxGz = Math.floor(bounds.maxZ / CELL_M)
    const spread = (maxGx - minGx + 1) * (maxGz - minGz + 1)
    if (
      !Number.isFinite(spread) ||
      spread > MAX_CELLS_PER_NODE ||
      Math.abs(minGx) >= GRID_ORIGIN ||
      Math.abs(minGz) >= GRID_ORIGIN ||
      Math.abs(maxGx) >= GRID_ORIGIN ||
      Math.abs(maxGz) >= GRID_ORIGIN
    ) {
      oversized.push(indexed)
      continue
    }
    for (let gx = minGx; gx <= maxGx; gx++) {
      for (let gz = minGz; gz <= maxGz; gz++) {
        const key = cellKey(gx, gz)
        const bucket = cells.get(key)
        if (bucket) bucket.push(indexed)
        else cells.set(key, [indexed])
      }
    }
  }

  return { cells, oversized }
}

let indexedFrom: Readonly<Record<string, unknown>> | null = null
let sceneIndexCache: SceneIndex | null = null

function sceneIndexFor(nodes: Readonly<Record<string, unknown>>): SceneIndex {
  if (indexedFrom === nodes && sceneIndexCache) return sceneIndexCache
  sceneIndexCache = buildSceneIndex(nodes)
  indexedFrom = nodes
  return sceneIndexCache
}

/** Test hook and escape hatch: forget the index. */
export function resetClashIndex(): void {
  indexedFrom = null
  sceneIndexCache = null
}

function volumesOf(indexed: IndexedNode): ClashBox[] {
  indexed.volumes ??= occupiedVolumes(indexed.node)
  return indexed.volumes
}

function footprintOf(indexed: IndexedNode): ClashBox | null {
  if (indexed.footprint === undefined) indexed.footprint = footprintBox(indexed.node)
  return indexed.footprint
}

/** Monotonic stamp for the dedupe pass — never reset, so a stale mark from an
 *  earlier scan can never be mistaken for this one's. */
let scanStamp = 0

function candidatesNear(index: SceneIndex, envelope: ClashBox, into: IndexedNode[]): void {
  into.length = 0
  const stamp = ++scanStamp
  const bounds = planBounds(envelope)
  const minGx = Math.floor(bounds.minX / CELL_M)
  const maxGx = Math.floor(bounds.maxX / CELL_M)
  const minGz = Math.floor(bounds.minZ / CELL_M)
  const maxGz = Math.floor(bounds.maxZ / CELL_M)
  for (let gx = minGx; gx <= maxGx; gx++) {
    for (let gz = minGz; gz <= maxGz; gz++) {
      const bucket = index.cells.get(cellKey(gx, gz))
      if (!bucket) continue
      for (const candidate of bucket) {
        if (candidate.seen === stamp) continue
        candidate.seen = stamp
        into.push(candidate)
      }
    }
  }
  for (const candidate of index.oversized) {
    if (candidate.seen === stamp) continue
    candidate.seen = stamp
    into.push(candidate)
  }
}

// ── The question ────────────────────────────────────────────────────────────

export type ClashQuery = {
  /** The node being placed or moved, at its candidate transform. */
  node: unknown
  position: readonly [number, number, number]
  rotationY: number
  nodes: Readonly<Record<string, unknown>>
  /** Nodes to skip: the node itself, and anything travelling with it. */
  ignore?: readonly string[]
}

/** A node moved to a candidate transform, so its own volumes can be derived. */
function movedTo(node: unknown, position: readonly [number, number, number], rotationY: number) {
  const record = node as Record<string, unknown>
  const rotation = Array.isArray(record.rotation) ? [...(record.rotation as number[])] : [0, 0, 0]
  rotation[1] = rotationY
  return { ...record, position: [...position], rotation }
}

/** What the moving object looks like, so a run of them is described once. */
type Moving = {
  type: string | undefined
  envelope: ClashBox
  volumes: ClashBox[]
  footprint: ClashBox | null
  ignore: Set<string>
}

function describeMoving(
  node: unknown,
  position: readonly [number, number, number],
  rotationY: number,
  ignore: readonly string[] | undefined,
): Moving | null {
  const moved = movedTo(node, position, rotationY)
  const volumes = occupiedVolumes(moved)
  const envelope = envelopeOf(moved)
  if (!envelope || volumes.length === 0) return null
  const skip = new Set(ignore ?? [])
  const movingId = (moved as { id?: string }).id
  if (typeof movingId === 'string') skip.add(movingId)
  return {
    type: (moved as { type?: string }).type,
    envelope,
    volumes,
    // Same-kind comparison needs it; hoisted out of the candidate loop, where
    // it was rebuilt once per candidate for an answer that never varied.
    footprint: footprintBox(moved),
    ignore: skip,
  }
}

/**
 * Everything in the way of one placement.
 *
 * Two passes on purpose. The envelope comparison is one oriented-box test per
 * candidate and rejects everything not within a few metres; only what survives
 * pays for a volume list. The candidates themselves now come from the plan
 * index rather than from the whole scene, so "not within a few metres" costs
 * a grid lookup instead of a full scan.
 *
 * @param collect when given, every hit is appended in scene order; otherwise
 * the scan stops at the first hit, which is all a validity check needs.
 */
function scan(
  nodes: Readonly<Record<string, unknown>>,
  moving: Moving,
  collect: string[] | null,
): boolean {
  const index = sceneIndexFor(nodes)
  candidatesNear(index, moving.envelope, candidateScratch)
  if (collect) candidateScratch.sort((a, b) => a.order - b.order)

  let hit = false
  for (const candidate of candidateScratch) {
    if (moving.ignore.has(candidate.id)) continue
    if (!boxesOverlap(moving.envelope, candidate.envelope)) continue

    // Same kind: compare footprints, because a kind's footprint *is* its tiling
    // unit. Two rack bays at the sharing pitch overlap by design — each builds
    // both frames until it learns it has a neighbour — so comparing their steel
    // would reject the one gesture that kind exists for. Their footprints touch
    // exactly, which is what they are for.
    let clashed: boolean
    if (candidate.type === moving.type) {
      const theirs = footprintOf(candidate)
      clashed =
        moving.footprint !== null && theirs !== null && boxesOverlap(moving.footprint, theirs)
    } else {
      // Different kinds: compare what each actually occupies.
      const theirs = volumesOf(candidate)
      clashed = moving.volumes.some((mine) => theirs.some((other) => boxesOverlap(mine, other)))
    }
    if (!clashed) continue
    hit = true
    if (!collect) break
    collect.push(candidate.id)
  }
  return hit
}

/** Reused across positions of a run — the scan never outlives one call. */
const candidateScratch: IndexedNode[] = []

/**
 * Ids of everything in the way.
 */
export function clashesWith(query: ClashQuery): string[] {
  const moving = describeMoving(query.node, query.position, query.rotationY, query.ignore)
  if (!moving) return []
  const hits: string[] = []
  scan(query.nodes, moving, hits)
  return hits
}

/** Whether a candidate transform is clear of everything else in the scene. */
export function isClearAt(query: ClashQuery): boolean {
  const moving = describeMoving(query.node, query.position, query.rotationY, query.ignore)
  if (!moving) return true
  return !scan(query.nodes, moving, null)
}

function translateInto(
  source: ClashBox,
  position: readonly [number, number, number],
  into: ClashBox,
): ClashBox {
  into.cx = source.cx + position[0]
  into.cz = source.cz + position[2]
  into.hx = source.hx
  into.hz = source.hz
  into.minY = source.minY + position[1]
  into.maxY = source.maxY + position[1]
  into.rotationY = source.rotationY
  return into
}

function blankBox(): ClashBox {
  return { cx: 0, cz: 0, hx: 0, hz: 0, minY: 0, maxY: 0, rotationY: 0 }
}

export type RunClashQuery = {
  /** The node being placed. Every position carries this same shape. */
  node: unknown
  positions: readonly (readonly [number, number, number])[]
  rotationY: number
  nodes: Readonly<Record<string, unknown>>
  ignore?: readonly string[]
}

/**
 * Is every position of a run clear?
 *
 * ## Why this is not just a loop over `isClearAt`
 *
 * That is what the rack and conveyor tools did, and it re-derived the moving
 * object's whole description — a full `rackParts` build, every part turned into
 * a world box — once per bay, once per mouse move. For a two-hundred-bay run
 * that is two hundred identical part lists per pointer event.
 *
 * **The description is identical apart from where it sits.** `toWorldBox` takes
 * the node's position only as `origin`, and adds it to the box centre and
 * height interval without touching extents or rotation — so the run's bays are
 * one description translated, exactly. The bays of a run also share a rotation,
 * which is the other half of what would have varied. `clash.test.ts` pins that
 * equivalence rather than leaving it to be believed.
 *
 * Stops at the first blocked position: a run is placeable or it is not, and
 * which bay refused it is not a question any caller asks.
 */
export function areClearAt(query: RunClashQuery): boolean {
  const moving = describeMoving(query.node, ORIGIN, query.rotationY, query.ignore)
  if (!moving) return true

  const envelope = blankBox()
  const volumes = moving.volumes.map(blankBox)
  const footprint = moving.footprint ? blankBox() : null
  const placed: Moving = {
    type: moving.type,
    envelope,
    volumes,
    footprint,
    ignore: moving.ignore,
  }

  for (const position of query.positions) {
    translateInto(moving.envelope, position, envelope)
    for (let index = 0; index < volumes.length; index++) {
      const source = moving.volumes[index]
      const target = volumes[index]
      if (source && target) translateInto(source, position, target)
    }
    if (moving.footprint && footprint) translateInto(moving.footprint, position, footprint)
    if (scan(query.nodes, placed, null)) return false
  }
  return true
}

const ORIGIN: readonly [number, number, number] = [0, 0, 0]

// ── The same question, asked during a drag ──────────────────────────────────

/**
 * `movable.canMoveTo` — host sözleşmesinde var, YAYINLANMIŞ `@pascal-app/core`
 * tiplerinde henüz yok (`vertical-opening.ts`'teki aynı durum, aynı çözüm:
 * yayılım fazla-özellik denetimini atlar, host yeteneği çalışma zamanında
 * dinamik okur, eski host'ta hiçbir şey olmaz).
 */
export type HostCanMoveTo = (args: {
  node: unknown
  position: [number, number, number]
  rotationY: number
  nodes: Readonly<Record<string, unknown>>
}) => boolean

/**
 * Sürükleme için bu modülün cevabı — yerleştirme kapısının aynısı.
 *
 * **Kapatılan boşluk:** bu paketin araçları yerleştirmeyi üç boyutta
 * denetliyordu, ama yerleşen nesne sonradan SÜRÜKLENEBİLİYORDU ve orada hiçbir
 * denetim yoktu. Host'un kendi sürükleme kapısı `floorPlaced.collides`'a bakar;
 * bu paketin her kind'ı onu KAPALI tutmak zorunda (host'un testi plan
 * dikdörtgenidir ve Y görmez — tünelli bir gözün altındaki yürüme yolunu
 * dikmelerinin içinden geçmekten ayıramaz), yani sürükleme kapısı da kapalıydı.
 * Doğru yerleştirilen bir konveyör, ertesi saniye rafın içine çekilebiliyordu.
 *
 * Rota HARİÇ her kind bunu bildirir, ve kural şu: **yerleştirme neyi
 * denetliyorsa sürükleme de onu denetler.** Rota zemine çizilen boyadır,
 * `occupiedVolumes` ona hacim vermez, dolayısıyla soru ona sorulmaz.
 */
export function clashGuardedMove(): { readonly canMoveTo: HostCanMoveTo } {
  return {
    canMoveTo: ({ node, position, rotationY, nodes }) =>
      isClearAt({ node, position, rotationY, nodes }),
  }
}
