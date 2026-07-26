import * as THREE from 'three'
import { PALETTE } from './constants'
import {
  frameWidthM,
  hasCrossbar,
  legHeightM,
  moduleLengthM,
  rollerPitchM,
  supportOffsetsX,
} from './metrics'
import type { ConveyorDetail, ConveyorPart, ConveyorPartRole } from './parts'
import { conveyorParts } from './parts'
import type { ConveyorRollerNode } from './schema'

/**
 * One merged BufferGeometry per conveyor *shape*.
 *
 * The whole performance story of this kind is in that word, exactly as it is
 * for the rack. Real lines repeat one module hundreds of times, so a warehouse
 * of conveyor resolves to a handful of buffers that every module shares, and
 * memory stays flat as the line count grows. Keying on the node would give two
 * hundred identical meshes.
 *
 * The cache key is derived from what the builder actually consumes rather than
 * from raw schema fields — see `conveyorGeometryKey`. Part colours ride in the
 * vertex colour attribute, so the whole family draws from a single material.
 */

// ── Box emitter ─────────────────────────────────────────────────────────────

type Sink = {
  positions: number[]
  normals: number[]
  colors: number[]
  uvs: number[]
  indices: number[]
}

/**
 * The material's map is a two-column atlas: blank, and one pitch of roller bed.
 * Steering UVs into one column is what lets the bed show rollers while every
 * other part stays plain — without a second material, and so without a second
 * draw call per module.
 *
 * The patterned column is inset by 4% so a part can never sample across the
 * boundary under filtering; the blank column takes its centre, which is as far
 * from either edge as it gets.
 */
const ATLAS_COLUMN = 1 / 2
const ATLAS_INSET = ATLAS_COLUMN * 0.04
const ATLAS_BLANK_U = ATLAS_COLUMN / 2
const ATLAS_ROLLER_U0 = ATLAS_COLUMN + ATLAS_INSET
const ATLAS_ROLLER_U1 = 1 - ATLAS_INSET

/** Unit-cube faces as outward normal plus four CCW corners in half-extents. */
const FACES: Array<{ n: [number, number, number]; c: Array<[number, number, number]> }> = [
  {
    n: [0, 0, 1],
    c: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
  },
  {
    n: [0, 0, -1],
    c: [
      [1, -1, -1],
      [-1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
    ],
  },
  {
    n: [1, 0, 0],
    c: [
      [1, -1, 1],
      [1, -1, -1],
      [1, 1, -1],
      [1, 1, 1],
    ],
  },
  {
    n: [-1, 0, 0],
    c: [
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, 1],
      [-1, 1, -1],
    ],
  },
  {
    n: [0, 1, 0],
    c: [
      [-1, 1, 1],
      [1, 1, 1],
      [1, 1, -1],
      [-1, 1, -1],
    ],
  },
  {
    n: [0, -1, 0],
    c: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1],
    ],
  },
]

/**
 * Append one part.
 *
 * Written straight into flat arrays rather than built from `BoxGeometry` and
 * merged: a merge allocates one geometry per part and then discards all of
 * them. Flat normals need four vertices per face, which is why corners are not
 * shared.
 */
function emitPart(
  sink: Sink,
  part: ConveyorPart,
  color: readonly [number, number, number],
  stripeSpan: number,
): void {
  const [cx, cy, cz] = part.center
  const [hx, hy, hz] = [part.size[0] / 2, part.size[1] / 2, part.size[2] / 2]

  for (const face of FACES) {
    const base = sink.positions.length / 3
    // A bed is read from above and below, so the faces that carry the rollers
    // are the horizontal ones. Its ends are hidden inside the frame anyway.
    const horizontal = Math.abs(face.n[1]) > 0.5

    for (const corner of face.c) {
      sink.positions.push(cx + corner[0] * hx, cy + corner[1] * hy, cz + corner[2] * hz)
      sink.normals.push(face.n[0], face.n[1], face.n[2])
      sink.colors.push(color[0], color[1], color[2])

      if (part.pattern === 'rollers' && horizontal) {
        // U maps the width once and V tiles along the run, not the other way
        // round, and the choice is forced: `wrapS` has to stay clamped or one
        // atlas column bleeds into the next, so only V can tile. So the run
        // gets the exact roller pitch and the width is mapped once.
        sink.uvs.push(
          ATLAS_ROLLER_U0 + (corner[2] > 0 ? 1 : 0) * (ATLAS_ROLLER_U1 - ATLAS_ROLLER_U0),
          (corner[0] > 0 ? 1 : 0) * stripeSpan,
        )
      } else {
        sink.uvs.push(ATLAS_BLANK_U, 0)
      }
    }
    sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
}

// ── Palette ─────────────────────────────────────────────────────────────────

const colorCache = new Map<string, [number, number, number]>()

/**
 * Hex to the renderer's working colour space.
 *
 * `THREE.Color` treats a hex literal as sRGB and converts on assignment when
 * colour management is on, which is what the material expects from a vertex
 * colour. Writing the raw hex bytes straight into the attribute renders every
 * part visibly too bright.
 */
function toLinear(hex: string): [number, number, number] {
  const cached = colorCache.get(hex)
  if (cached) return cached
  const color = new THREE.Color(hex)
  const linear: [number, number, number] = [color.r, color.g, color.b]
  colorCache.set(hex, linear)
  return linear
}

/** Roles whose colour is fixed hardware rather than a finish the user picks. */
const ROLE_COLORS: Record<Exclude<ConveyorPartRole, 'frame' | 'deck' | 'end-plate'>, string> = {
  guide: PALETTE.profileGrey,
  'guide-bracket': PALETTE.feetGrey,
  leg: PALETTE.frameBlue,
  footplate: PALETTE.feetGrey,
  crossbar: PALETTE.frameBlue,
  motor: PALETTE.boxWhite,
}

export type { ConveyorDetail } from './parts'

// ── Builder ─────────────────────────────────────────────────────────────────

function buildFrom(
  conveyor: ConveyorRollerNode,
  parts: readonly ConveyorPart[],
): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  const frameColor = toLinear(conveyor.frameColor)
  const rollerColor = toLinear(conveyor.rollerColor)
  const profileColor = toLinear(conveyor.profileColor)
  // One tile per roller pitch, so the painted rollers land where real ones
  // would however long the module is. This is the number that makes the stripe
  // a bed rather than a texture.
  const stripeSpan = moduleLengthM(conveyor) / rollerPitchM(conveyor)

  for (const part of parts) {
    const color =
      part.role === 'frame' || part.role === 'end-plate'
        ? frameColor
        : part.role === 'deck'
          ? rollerColor
          : part.role === 'guide'
            ? profileColor
            : toLinear(ROLE_COLORS[part.role])
    emitPart(sink, part, color, stripeSpan)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(sink.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(sink.normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(sink.colors, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(sink.uvs, 2))
  geometry.setIndex(sink.indices)
  geometry.computeBoundingBox()
  // Without this a six-metre module is culled against a default sphere and pops
  // in and out as the camera turns.
  geometry.computeBoundingSphere()
  return geometry
}

// ── Cache ───────────────────────────────────────────────────────────────────

/**
 * Identity of a conveyor's *shape*.
 *
 * Built from the values the builder actually consumes rather than from the raw
 * schema fields, which is what stops it over-reporting (splitting the cache
 * between byte-identical meshes) and under-reporting (two visibly different
 * modules sharing one mesh). The rack shipped both failures once each, and both
 * were invisible until someone noticed a setting doing nothing.
 *
 * Three entries are derived rather than raw:
 *
 * - **`moduleLength`, not `(rollers, rollerPitch)`.** 80 rollers at 75 mm and
 *   60 at 100 mm are both 6 m — but they are *not* the same mesh, because the
 *   stripe repeat differs, so the pitch is listed separately and the pair is
 *   not. Listing the raw count as well would split the cache on a number the
 *   builder never reads directly.
 * - **`supportOffsetsX`, not the length again.** Supports are placed by a
 *   ceiling division, so two lengths either side of a boundary get different
 *   station counts and two lengths inside one get the same layout scaled — the
 *   offsets are what the mesh has, so the offsets are what the key carries.
 * - **`legHeight` + `hasCrossbar`, not raw `transportHeight`.** The height
 *   reaches the mesh only through those two, and a module whose legs are zero
 *   is the same mesh at every transport height below the frame depth.
 *
 * Id, name, position, rotation, `supportSlabId`, `speed`, `flow`,
 * `shortestBox` and `inclination` are all absent on purpose: two conveyors that
 * look the same must share one geometry.
 */
export function conveyorGeometryKey(
  conveyor: ConveyorRollerNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): string {
  return [
    detail,
    // One support at the far end or none. A module with something standing
    // against it leaves that support to its neighbour, which is a different
    // mesh — two variants per shape, and the cheapest possible price for not
    // doubling the steel at every seam.
    hasDownstreamNeighbour ? 'U' : 'UD',
    conveyor.usefulWidth,
    frameWidthM(conveyor).toFixed(5),
    moduleLengthM(conveyor).toFixed(5),
    conveyor.rollerPitch,
    legHeightM(conveyor).toFixed(5),
    hasCrossbar(conveyor) ? 1 : 0,
    supportOffsetsX(conveyor)
      .map((offset) => offset.toFixed(5))
      .join(','),
    conveyor.sideGuide === 'none'
      ? '-'
      : `${conveyor.sideGuide}/${conveyor.sideGuideHeight.toFixed(4)}`,
    // The motor is real steel hanging off the frame, and which end it hangs
    // from follows the flow — so flow reaches the mesh here and nowhere else.
    conveyor.hasDrive ? `m${conveyor.flow === 'forward' ? '-' : '+'}` : '-',
    conveyor.frameColor,
    conveyor.rollerColor,
    conveyor.profileColor,
  ].join('|')
}

/**
 * Insertion-ordered, so the oldest entry is the first one `keys()` yields.
 * That is the eviction order and the only reason a plain `Map` is enough.
 */
const cache = new Map<string, THREE.BufferGeometry>()

/** Shapes a mounted module is currently drawing from, by cache key. Eviction
 *  must never free a buffer something is rendering. */
const retained = new Map<string, number>()

/**
 * Distinct shapes kept before the oldest unheld one is dropped.
 *
 * A real building orders from a short list — a transport spine, a filler
 * length, a wider pack-out lane — so a layout instantiates a handful of shapes
 * against a limit far above it. What the limit is actually for is the *drag*: a
 * slider walked across a range mints a shape per step, and nothing would ever
 * draw those again.
 */
const CACHE_LIMIT = 96

export function getConveyorGeometry(
  conveyor: ConveyorRollerNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour = false,
): THREE.BufferGeometry {
  const key = conveyorGeometryKey(conveyor, detail, hasDownstreamNeighbour)
  const cached = cache.get(key)
  if (cached) return cached

  const geometry = buildFrom(conveyor, conveyorParts(conveyor, detail, hasDownstreamNeighbour))
  cache.set(key, geometry)
  evict()
  return geometry
}

function evict(): void {
  if (cache.size <= CACHE_LIMIT) return
  for (const [key, geometry] of cache) {
    if (cache.size <= CACHE_LIMIT) return
    if ((retained.get(key) ?? 0) > 0) continue
    cache.delete(key)
    geometry.dispose()
  }
}

/** Claim a shape while a module is drawing it. Returns the key so the caller
 *  releases the exact entry it claimed. */
export function retainConveyorGeometry(
  conveyor: ConveyorRollerNode,
  detail: ConveyorDetail,
  hasDownstreamNeighbour: boolean,
): string {
  const key = conveyorGeometryKey(conveyor, detail, hasDownstreamNeighbour)
  retained.set(key, (retained.get(key) ?? 0) + 1)
  return key
}

export function releaseConveyorGeometry(key: string): void {
  const count = (retained.get(key) ?? 0) - 1
  if (count > 0) retained.set(key, count)
  else retained.delete(key)
}

/** Distinct shapes built so far. Test and diagnostic hook for the sharing the
 *  whole design depends on. */
export function conveyorGeometryCacheSize(): number {
  return cache.size
}

export function clearConveyorGeometryCache(): void {
  for (const geometry of new Set(cache.values())) geometry.dispose()
  cache.clear()
  retained.clear()
}
