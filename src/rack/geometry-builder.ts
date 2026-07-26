import * as THREE from 'three'
import type { RackDetail, RackPart, RackPartRole } from './parts'
import { PART_BUDGET, rackParts } from './parts'
import type { PalletRackNode } from './schema'
import {
  bayShapeDepartures,
  beamedLevels,
  levelSurfaceY,
  levelTypeOf,
  palletSupportBarCount,
  palletSupportBarsDrawn,
  rowFacing,
  rowGapBefore,
  slotOffsetsX,
} from './slots'

/**
 * One merged BufferGeometry per rack *shape*.
 *
 * The whole performance story of this node is in that word. A 10-bay 4-level
 * run is roughly 250 separate steel parts; drawing them as 250 meshes — which
 * is what the version being replaced did, each with its own inline material —
 * costs 250 draw calls per rack, so a thousand racks is a quarter of a million
 * and the frame never lands. Merging them costs one.
 *
 * The cache key is derived from the fields that change the shape and
 * deliberately *not* from the node's id, name, position or rotation. That is
 * what makes a warehouse cheap rather than merely survivable: real layouts
 * repeat the same rack hundreds of times, so a thousand racks resolve to a
 * handful of geometries that they share, and memory stays flat as the rack
 * count grows. Keying on the node would give a thousand identical meshes.
 *
 * Part colours ride in the vertex colour attribute, so every rack in the scene
 * — blue uprights, orange beams, galvanised shelves — draws from a single
 * shared material.
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
 * The material's map is a two-column atlas: the left column is blank and the
 * right carries the punched slot pattern. Steering UVs into one column or the
 * other is what lets an upright show its perforations while every other part
 * stays plain — without a second material, and so without a second draw call
 * per rack.
 */
const ATLAS_BLANK_U = 0.25
const ATLAS_SLOT_U0 = 0.52
const ATLAS_SLOT_U1 = 0.98
/** Upright slots are punched every 50 mm, so the pattern repeats at that rate. */
const SLOT_PITCH = 0.05

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
 * merged: a merge allocates one geometry per part and then discards all 250.
 * Flat normals need four vertices per face, which is why corners are not
 * shared. `tiltX` is folded in here so bracing needs no separate path.
 */
function emitPart(sink: Sink, part: RackPart, color: readonly [number, number, number]): void {
  const [cx, cy, cz] = part.center
  const [hx, hy, hz] = [part.size[0] / 2, part.size[1] / 2, part.size[2] / 2]
  const tilt = part.tiltX ?? 0
  const cos = Math.cos(tilt)
  const sin = Math.sin(tilt)
  // Repeat the pattern along the part's own height, so the slot pitch is the
  // real 50 mm whatever the post length — a 0..1 map would stretch the holes
  // further apart on a taller frame.
  const vSpan = part.size[1] / SLOT_PITCH

  for (const face of FACES) {
    const base = sink.positions.length / 3
    const ny = face.n[1] * cos - face.n[2] * sin
    const nz = face.n[1] * sin + face.n[2] * cos
    for (const corner of face.c) {
      const y = corner[1] * hy
      const z = corner[2] * hz
      sink.positions.push(cx + corner[0] * hx, cy + y * cos - z * sin, cz + y * sin + z * cos)
      sink.normals.push(face.n[0], ny, nz)
      sink.colors.push(color[0], color[1], color[2])
      if (part.perforated) {
        // Only the broad faces carry holes; the paper-thin edges of a folded
        // section would smear one pixel of the pattern across them.
        const broad = Math.abs(face.n[1]) < 0.5
        const u = broad
          ? ATLAS_SLOT_U0 + (corner[0] > 0 ? 1 : 0) * (ATLAS_SLOT_U1 - ATLAS_SLOT_U0)
          : ATLAS_BLANK_U
        sink.uvs.push(u, broad ? (corner[1] > 0 ? 1 : 0) * vSpan : 0)
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
 * colour. Writing the raw hex bytes straight into the attribute — the obvious
 * shortcut — renders every part visibly too bright.
 */
function toLinear(hex: string): [number, number, number] {
  const cached = colorCache.get(hex)
  if (cached) return cached
  const color = new THREE.Color(hex)
  const linear: [number, number, number] = [color.r, color.g, color.b]
  colorCache.set(hex, linear)
  return linear
}

const ROLE_COLORS: Record<Exclude<RackPartRole, 'upright' | 'beam'>, string> = {
  footplate: '#334155',
  brace: '#94a3b8',
  connector: '#475569',
  shelf: '#9aa5b1',
  'support-bar': '#cbd5e1',
  'row-spacer': '#94a3b8',
}

export type { RackDetail } from './parts'

// ── Builder ─────────────────────────────────────────────────────────────────

function buildFrom(rack: PalletRackNode, parts: readonly RackPart[]): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  const uprightColor = toLinear(rack.uprightColor)
  const beamColor = toLinear(rack.beamColor)

  for (const part of parts) {
    const color =
      part.role === 'upright'
        ? uprightColor
        : part.role === 'beam'
          ? beamColor
          : toLinear(ROLE_COLORS[part.role])
    emitPart(sink, part, color)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(sink.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(sink.normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(sink.colors, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(sink.uvs, 2))
  geometry.setIndex(sink.indices)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

// ── Cache ───────────────────────────────────────────────────────────────────

/**
 * Identity of a rack's *shape*.
 *
 * Built from the values the builder actually consumes rather than from the raw
 * schema fields, which buys two things a hand-listed key cannot.
 *
 * It cannot over-report: the row gaps move no vertex while the block is a
 * single run, and `depthGap` moves none while it is single-deep, so listing
 * them raw split the cache between racks whose meshes were byte-identical.
 * Passing them through the same helpers the builder uses collapses those back
 * together.
 *
 * And it cannot under-report as easily: the level structure is encoded as the
 * type and elevation of each level, so a new field that changes level layout —
 * `hasGroundBeam` was one, and it shipped missing from the hand-listed version —
 * reaches the key through `levelSurfaceY` without anyone remembering to add it.
 *
 * Id, name, position, rotation, `supportSlabId` and `ghostFill` are all absent
 * on purpose: two racks that look the same must share one geometry.
 */
export function rackGeometryKey(rack: PalletRackNode, detail: RackDetail): string {
  // Zero unless a bar is actually built: a decked level carries the pallet, so
  // the bar count on a decked rack moves nothing.
  const bars = palletSupportBarsDrawn(rack) ? palletSupportBarCount(rack) : 0
  const beamed = beamedLevels(rack)
  const hasPicking = beamed.some((level) => levelTypeOf(rack, level) === 'picking')
  const levels = beamed
    .map((level) => `${levelTypeOf(rack, level)}@${levelSurfaceY(rack, level).toFixed(5)}`)
    .join(',')

  return [
    detail,
    rack.bayCount,
    rack.bayClearWidth,
    rack.depth,
    rack.uprightHeight,
    rack.uprightWidth,
    rack.uprightDepth,
    rack.beamHeight,
    rack.beamThickness,
    rack.bracing,
    rack.decking,
    rack.hasGroundBeam ? 1 : 0,
    // Skips, tunnels and per-bay levels each cut real steel out of the mesh, so
    // a rack carrying one cannot share a geometry with a uniform one. Serialised
    // in key order so two racks with the same overrides written in a different
    // order still collapse onto one mesh.
    bayShapeDepartures(rack).join(';'),
    rack.rowCount,
    // The gap sequence the block actually uses, rather than the two gap fields
    // and the group size raw. A single run consumes neither gap, a pair never
    // opens an aisle, and one-row groups never touch the spine gap — listing the
    // fields would split the cache between blocks whose meshes are identical.
    // `backToBack` reaches the key through this.
    Array.from({ length: Math.max(0, rack.rowCount - 1) }, (_, index) =>
      rowGapBefore(rack, index + 2),
    ).join(','),
    // Facing reaches the geometry only through `depthPositionZ`, and only once
    // there is a second position for it to order: single-deep, every row's one
    // position sits on its centreline whichever way it faces. Listing the
    // facings unconditionally split a two-row block from an identical one whose
    // group size merely happened to be larger than the block.
    rack.depthPositions > 1
      ? Array.from({ length: rack.rowCount }, (_, index) => rowFacing(rack, index + 1)).join('')
      : '',
    rack.depthPositions,
    rack.depthPositions > 1 ? rack.depthGap : 0,
    levels,
    // Picking sections and shelf panels are only emitted where a picking level
    // exists; on an all-pallet rack these move nothing.
    hasPicking ? `${rack.pickingBeamHeight}/${rack.pickingShelfThickness}` : '',
    bars,
    // Bar positions follow the pallet layout, so those fields matter only when
    // bars are actually drawn.
    bars > 0
      ? slotOffsetsX(rack)
          .map((offset) => offset.toFixed(5))
          .join(',')
      : '',
    rack.uprightColor,
    rack.beamColor,
  ].join('|')
}

const cache = new Map<string, THREE.BufferGeometry>()

/**
 * Shared geometry for a rack shape.
 *
 * Never disposed while the app lives. That is deliberate rather than a leak:
 * the geometry belongs to the shape, not to any node, so disposing it when one
 * rack is deleted would blank every other rack that shares it — the same trap
 * the pallet renderer documents around `<GeometrySystem>`. A warehouse's worth
 * of distinct shapes is a few dozen meshes.
 */
export function getRackGeometry(rack: PalletRackNode, detail: RackDetail): THREE.BufferGeometry {
  const key = rackGeometryKey(rack, detail)
  const cached = cache.get(key)
  if (cached) return cached

  // The budget test is exact rather than estimated, which means building the
  // part list — so it runs only here, past the cache, where the list is about to
  // be built anyway. An estimate would be cheaper and would drift from what the
  // builder actually emits the first time either side gained a part.
  const parts = rackParts(rack, detail)
  const geometry =
    detail === 'full' && parts.length > PART_BUDGET
      ? // Both tiers resolve to the same silhouette; the two keys share one
        // geometry object rather than building it twice.
        getRackGeometry(rack, 'simple')
      : buildFrom(rack, parts)
  cache.set(key, geometry)
  return geometry
}

/** Distinct shapes built so far. Test and diagnostic hook for the sharing that
 *  the whole design depends on. */
export function rackGeometryCacheSize(): number {
  return cache.size
}

export function clearRackGeometryCache(): void {
  // Deduped: an over-budget block files the same geometry under both tiers.
  for (const geometry of new Set(cache.values())) geometry.dispose()
  cache.clear()
}
