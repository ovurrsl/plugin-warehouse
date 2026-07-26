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
import { specOf, unitLoadHeight } from './pallet/presets'
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
    const height = unitLoadHeight(pallet.preset, pallet.loadHeight)
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

/**
 * Ids of everything in the way.
 *
 * Two passes on purpose. The envelope comparison is one oriented-box test per
 * candidate and rejects everything not within a few metres; only what survives
 * pays for a volume list. At two thousand racks with a pointer moving, that
 * difference is the whole cost of the feature.
 */
export function clashesWith(query: ClashQuery): string[] {
  const moving = movedTo(query.node, query.position, query.rotationY)
  const movingType = (moving as { type?: string }).type
  const movingVolumes = occupiedVolumes(moving)
  const movingEnvelope = envelopeOf(moving)
  if (!movingEnvelope || movingVolumes.length === 0) return []

  const ignore = new Set(query.ignore ?? [])
  const movingId = (moving as { id?: string }).id
  if (typeof movingId === 'string') ignore.add(movingId)

  const hits: string[] = []
  for (const candidate of Object.values(query.nodes)) {
    const placement = placementOf(candidate)
    if (!placement || ignore.has(placement.id)) continue

    const envelope = envelopeOf(candidate)
    if (!envelope || !boxesOverlap(movingEnvelope, envelope)) continue

    // Same kind: compare footprints, because a kind's footprint *is* its tiling
    // unit. Two rack bays at the sharing pitch overlap by design — each builds
    // both frames until it learns it has a neighbour — so comparing their steel
    // would reject the one gesture that kind exists for. Their footprints touch
    // exactly, which is what they are for.
    if (placement.type === movingType) {
      const a = footprintBox(moving)
      const b = footprintBox(candidate)
      if (a && b && boxesOverlap(a, b)) hits.push(placement.id)
      continue
    }

    // Different kinds: compare what each actually occupies.
    const volumes = occupiedVolumes(candidate)
    const clashed = movingVolumes.some((mine) =>
      volumes.some((theirs) => boxesOverlap(mine, theirs)),
    )
    if (clashed) hits.push(placement.id)
  }
  return hits
}

/** Whether a candidate transform is clear of everything else in the scene. */
export function isClearAt(query: ClashQuery): boolean {
  return clashesWith(query).length === 0
}
