import { rackParts } from '../rack/parts'
import type { PalletRackNode } from '../rack/schema'
import { totalDepth, totalWidth } from '../rack/slots'
import { localBoundsM } from './metrics'
import type { ConveyorRollerNode } from './schema'

/**
 * Whether a conveyor runs into a rack.
 *
 * **The host cannot answer this, and that is why the file exists.**
 * `floorPlaced.collides` compares plan rectangles — XZ only, no height — so to
 * the host a conveyor threading the walkway under a racking run is
 * indistinguishable from one driven through its uprights. Declaring
 * `collides: true` would refuse the pass-through, which is a thing warehouses
 * do constantly; declaring `collides: false` alone would let a line run through
 * a metre of steel with nothing said. Neither is the answer, so the test is
 * here, in three dimensions, against the steel itself.
 *
 * **Against the steel itself** is the load-bearing part. `rack/parts.ts` already
 * describes every upright, beam, footplate and deck as a box, and a tunnelled
 * level emits *no beams at all* — the frames stay because they carry what is
 * above, and everything that would have sat below is simply not in the list. So
 * "fits under the tunnel" needs no special case and no height arithmetic: the
 * space is empty in the parts list because it is empty in the rack. What is
 * left to hit is the legs, which is exactly the rule.
 *
 * Boxes are axis-aligned in their own node's frame and rotated only about Y, so
 * the test is a 2D oriented-box overlap in plan and an interval overlap in
 * height. No general SAT, no quaternions.
 */

/** Half a centimetre. Two things touching is not two things clashing — a
 *  conveyor laid exactly against an upright face is a legitimate layout. */
const CLASH_EPSILON = 0.005

type Box = {
  /** Centre in world XZ, and the Y interval, which needs no rotation. */
  cx: number
  cz: number
  hx: number
  hz: number
  minY: number
  maxY: number
  /** Rotation of the box's own frame about Y. */
  rotationY: number
}

/** A local-frame box carried into world space by its node's transform. */
function toWorld(
  center: readonly [number, number, number],
  size: readonly [number, number, number],
  origin: readonly [number, number, number],
  rotationY: number,
): Box {
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

/** Projection of a box's half-extents onto a world axis. */
function extentAlong(box: Box, axisX: number, axisZ: number): number {
  const cos = Math.cos(box.rotationY)
  const sin = Math.sin(box.rotationY)
  // The box's own axes in world: +X is (cos, −sin), +Z is (sin, cos).
  return (
    box.hx * Math.abs(axisX * cos + axisZ * -sin) + box.hz * Math.abs(axisX * sin + axisZ * cos)
  )
}

/**
 * Separating-axis test in plan, plus a height interval.
 *
 * Four candidate axes — two per box — because two rectangles that do not
 * overlap always have a separating line parallel to an edge of one of them.
 */
function overlaps(a: Box, b: Box): boolean {
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

/** The whole rack as one box, for the cheap first pass. */
function rackEnvelope(rack: PalletRackNode): Box {
  return toWorld(
    [0, rack.uprightHeight / 2, 0],
    [totalWidth(rack), rack.uprightHeight, totalDepth(rack)],
    rack.position,
    rack.rotation?.[1] ?? 0,
  )
}

function asRack(node: unknown): PalletRackNode | null {
  const record = node as { type?: unknown } | null
  if (record?.type !== 'warehouse:pallet-rack') return null
  return node as PalletRackNode
}

/**
 * Racks whose steel the conveyor would run into, at a candidate placement.
 *
 * Two passes on purpose. The envelope test is one oriented-box comparison per
 * rack and rejects everything not in the same few metres; only what survives it
 * pays for a parts list. At two thousand racks and a pointer moving, that
 * difference is the whole cost of the feature.
 */
export function clashingRacks(
  conveyor: ConveyorRollerNode,
  position: readonly [number, number, number],
  rotationY: number,
  nodes: Readonly<Record<string, unknown>>,
): string[] {
  const local = localBoundsM(conveyor)
  const bed = toWorld(
    [
      (local.min[0] + local.max[0]) / 2,
      (local.min[1] + local.max[1]) / 2,
      (local.min[2] + local.max[2]) / 2,
    ],
    [local.max[0] - local.min[0], local.max[1] - local.min[1], local.max[2] - local.min[2]],
    position,
    rotationY,
  )

  const hits: string[] = []
  for (const value of Object.values(nodes)) {
    const rack = asRack(value)
    if (!rack) continue
    if (!overlaps(bed, rackEnvelope(rack))) continue

    // Past the envelope, ask the steel. `simple` rather than `full`: the far
    // tier is posts and beams, which is exactly the structure a conveyor can
    // hit, and it skips the footplates — a conveyor leg standing beside a rack
    // leg on the same slab is a normal thing to draw and must not read as a
    // clash.
    const rackRotation = rack.rotation?.[1] ?? 0
    const clashed = rackParts(rack, 'simple').some((part) =>
      overlaps(bed, toWorld(part.center, part.size, rack.position, rackRotation)),
    )
    if (clashed) hits.push(rack.id)
  }
  return hits
}

/** Whether a candidate placement is clear of every rack's steel. */
export function clearOfRacks(
  conveyor: ConveyorRollerNode,
  position: readonly [number, number, number],
  rotationY: number,
  nodes: Readonly<Record<string, unknown>>,
): boolean {
  return clashingRacks(conveyor, position, rotationY, nodes).length === 0
}
