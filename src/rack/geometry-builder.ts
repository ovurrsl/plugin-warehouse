import * as THREE from 'three'
import type { RackDetail, RackPart, RackPartRole } from './parts'
import { rackParts } from './parts'
import type { PalletRackNode } from './schema'
import {
  type DeckFinish,
  deckFinishOf,
  drawnLevels,
  drawnPickingLevels,
  levelSurfaceY,
  levelTypeOf,
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

/**
 * Exported so the other **racking** kinds build into the same buffers.
 *
 * Drive-in racking is the first: it is steel of the same family, drawn with the
 * same material and reading the same atlas, so giving it its own emitter would
 * mean two copies of the box-to-triangles maths and two copies of the atlas
 * constants — agreeing exactly until one of them is edited.
 *
 * The conveyor package exports a sibling emitter that eleven kinds already
 * share; this one is separate because the *atlas* differs (punched slots and
 * wire mesh here, rollers there), not because the maths does.
 */
export type Sink = {
  positions: number[]
  normals: number[]
  colors: number[]
  uvs: number[]
  indices: number[]
}

/** A part shaped enough for the emitter. Structural rather than `RackPart`, so
 *  a kind with its own role union can emit through it without this file having
 *  to hear about that union. */
export type EmittablePart = {
  center: readonly [number, number, number]
  size: readonly [number, number, number]
  /** Lean in the Y–Z plane — a frame's own diagonal, across its depth. */
  tiltX?: number
  /**
   * Lean in the X–Y plane — a **down-aisle** diagonal, across the bay.
   *
   * A separate axis rather than a generic quaternion because these are the only
   * two leans any racking part in this package has, and a quaternion per part
   * would cost three more numbers on a list that runs to hundreds of entries per
   * bay. Applied after `tiltX`; no part uses both.
   */
  tiltZ?: number
  pattern?: 'slots' | 'mesh'
}

/**
 * The material's map is a three-column atlas: blank, the punched slot pattern,
 * and a wire-deck grid. Steering UVs into one column is what lets an upright
 * show its perforations and a wire deck show its mesh while every other part
 * stays plain — without a second material, and so without a second draw call
 * per rack.
 *
 * The patterned columns are inset by 4% of a column so a part can never sample
 * across a boundary under filtering; the blank column takes its centre, which
 * is as far from either edge as it gets.
 */
const ATLAS_COLUMN = 1 / 3
const ATLAS_INSET = ATLAS_COLUMN * 0.04
const ATLAS_BLANK_U = ATLAS_COLUMN / 2
const ATLAS_SLOT_U0 = ATLAS_COLUMN + ATLAS_INSET
const ATLAS_SLOT_U1 = 2 * ATLAS_COLUMN - ATLAS_INSET
const ATLAS_MESH_U0 = 2 * ATLAS_COLUMN + ATLAS_INSET
const ATLAS_MESH_U1 = 1 - ATLAS_INSET
/** Upright slots are punched every 50 mm, so the pattern repeats at that rate. */
const SLOT_PITCH = 0.05
/** Wire decks are welded on a 100 mm grid, and the mesh tile is one grid square,
 *  so V repeats once per 100 mm of deck. */
const MESH_PITCH = 0.1

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
export function emitRackPart(
  sink: Sink,
  part: EmittablePart,
  color: readonly [number, number, number],
): void {
  const [cx, cy, cz] = part.center
  const [hx, hy, hz] = [part.size[0] / 2, part.size[1] / 2, part.size[2] / 2]
  const cosX = Math.cos(part.tiltX ?? 0)
  const sinX = Math.sin(part.tiltX ?? 0)
  const cosZ = Math.cos(part.tiltZ ?? 0)
  const sinZ = Math.sin(part.tiltZ ?? 0)

  /** X first, then Z. Positions and normals go through the same rotation, so a
   *  leaned part is lit as the solid it is rather than as the box it started
   *  from. */
  const lean = (x: number, y: number, z: number): [number, number, number] => {
    const y1 = y * cosX - z * sinX
    const z1 = y * sinX + z * cosX
    return [x * cosZ - y1 * sinZ, x * sinZ + y1 * cosZ, z1]
  }

  // Repeat each pattern along the axis that carries it, so the pitch stays the
  // real 50 mm / 100 mm whatever the part's size — a 0..1 map would stretch the
  // holes further apart on a taller frame and the mesh coarser on a wider bay.
  const slotSpan = part.size[1] / SLOT_PITCH
  const meshSpan = part.size[0] / MESH_PITCH

  for (const face of FACES) {
    const base = sink.positions.length / 3
    const [nx, ny, nz] = lean(face.n[0], face.n[1], face.n[2])
    // An upright is read from the side and a deck from above, so "the face that
    // carries the pattern" is the opposite one in each case. Decided from the
    // part's OWN axes, not the leaned ones: which face of the box carries holes
    // is a property of the part, not of how it is tipped.
    const upright = Math.abs(face.n[1]) < 0.5
    for (const corner of face.c) {
      const [px, py, pz] = lean(corner[0] * hx, corner[1] * hy, corner[2] * hz)
      sink.positions.push(cx + px, cy + py, cz + pz)
      sink.normals.push(nx, ny, nz)
      sink.colors.push(color[0], color[1], color[2])

      if (part.pattern === 'slots' && upright) {
        // Only the broad faces carry holes; the paper-thin edges of a folded
        // section would smear one pixel of the pattern across them.
        sink.uvs.push(
          ATLAS_SLOT_U0 + (corner[0] > 0 ? 1 : 0) * (ATLAS_SLOT_U1 - ATLAS_SLOT_U0),
          (corner[1] > 0 ? 1 : 0) * slotSpan,
        )
      } else if (part.pattern === 'mesh' && !upright) {
        // U maps the depth once and V repeats along the run, not the other way
        // round, and the choice is forced: `wrapS` has to stay clamped or one
        // atlas column bleeds into the next, so only V can tile. So the run gets
        // the exact 100 mm pitch and the into-depth cell count is whatever the
        // tile's own grid gives — 100 mm on a 1.1 m frame, which is the frame
        // almost every rack uses.
        sink.uvs.push(
          ATLAS_MESH_U0 + (corner[2] > 0 ? 1 : 0) * (ATLAS_MESH_U1 - ATLAS_MESH_U0),
          (corner[0] > 0 ? 1 : 0) * meshSpan,
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
 * colour. Writing the raw hex bytes straight into the attribute — the obvious
 * shortcut — renders every part visibly too bright.
 */
export function toLinear(hex: string): [number, number, number] {
  const cached = colorCache.get(hex)
  if (cached) return cached
  const color = new THREE.Color(hex)
  const linear: [number, number, number] = [color.r, color.g, color.b]
  colorCache.set(hex, linear)
  return linear
}

const ROLE_COLORS: Record<Exclude<RackPartRole, 'upright' | 'beam' | 'shelf'>, string> = {
  footplate: '#334155',
  brace: '#94a3b8',
}

/**
 * A shelf's colour comes from its finish, not from its role.
 *
 * This is the fix for the defect that started the whole audit: colour was keyed
 * on role alone, so all four decking values painted the same `#9aa5b1` slab —
 * and since thickness is the only other thing decking reached, `wire-mesh` and
 * `steel` built byte-identical meshes. Three of the four options were inert.
 *
 * Colour is per-vertex and already in the buffer, so this costs nothing: no
 * second material, no second draw call, not one extra triangle.
 *
 * The wire deck is bright because the atlas darkens it: the mesh column leaves
 * the wires white and paints the openings dark, and the map multiplies into this
 * colour. So this is the colour of the **wire**, and what you see between the
 * wires is this colour times the opening — which is also physically what a mesh
 * deck is, the mat plus the shadow under it.
 */
const DECK_COLORS: Record<DeckFinish, string> = {
  /** Galvanised wire, bright. The grid pattern does the rest. */
  'wire-mesh': '#ced7e2',
  /** A flat roll-formed panel — no pattern, so a mid grey that cannot be
   *  mistaken for the mesh beside it. */
  steel: '#8a94a0',
  /** Chipboard. Unmistakable, which is the point. */
  timber: '#b08a55',
  /** Never emitted; `deckFinishOf` returns null for an open level. */
  open: '#9aa5b1',
  /** The picking shelf keeps the old shelf grey. It is a specified part, not a
   *  deck finish, and it must not change colour when the pallet levels above it
   *  are re-decked. */
  picking: '#9aa5b1',
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
          : part.role === 'shelf'
            ? toLinear(DECK_COLORS[part.finish ?? 'picking'])
            : toLinear(ROLE_COLORS[part.role])
    emitRackPart(sink, part, color)
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
 * It cannot over-report: `depthGap` moves no vertex while the bay is
 * single-deep, so listing it raw split the cache between racks whose meshes
 * were byte-identical. Passing it through the same condition the builder uses
 * collapses those back together.
 *
 * And it cannot under-report as easily: the level structure is encoded as the
 * type and elevation of each level *that is actually drawn*, so a new field that
 * changes level layout — `hasGroundBeam` was one, and it shipped missing from
 * the hand-listed version — reaches the key through `levelSurfaceY` without
 * anyone remembering to add it. `tunnelLevels` arrives the same way, through the
 * intersection below.
 *
 * Id, name, position, rotation, `supportSlabId` and `ghostFill` are all absent
 * on purpose: two racks that look the same must share one geometry.
 *
 * ## Memoised on the rack object
 *
 * Same invariant, and the same reason, as `./neighbours`' `shapeKeys`: the store
 * replaces the nodes that changed rather than mutating them, so a node object's
 * identity already means "these fields have not moved".
 *
 * The saving is not incremental. This key is built four times per mount (twice
 * through `useCollective`'s registration, twice through `retainRackGeometry`)
 * and twice more on **every** re-render, and each build re-derives the level
 * structure from zero — `drawnLevels`, `drawnPickingLevels` and
 * each walk `storageLevels`, which is itself O(levels²)
 * through `levelSurfaceY` (the bar walker is gone with the bars). In a warehouse the answer is the same string for
 * thousands of bays: two thousand racks spend sixteen thousand builds, a couple
 * of million inner iterations and a few hundred thousand throwaway arrays to
 * produce **four** distinct strings.
 *
 * Keyed by the two things that legitimately vary for one node — the detail tier
 * and whether the right frame is left to a neighbour — so at most four entries
 * per node. Appearance is deliberately NOT part of it: this function never reads
 * `Appearance`, and the colours it does read (`uprightColor`, `beamColor`) are
 * node fields. The pool composes appearance in separately via `materialKeyFor`.
 *
 * The hazard is the one `CLAUDE.md` names: a node mutated in place would hand
 * back a stale key and let two visibly different racks share one geometry. That
 * is why the guard tests assert the key still varies with tier and neighbour,
 * and why the existing coverage test — which has caught five real defects — has
 * to keep passing over the memoised path.
 */
const geometryKeys = new WeakMap<object, Map<string, string>>()

export function rackGeometryKey(
  rack: PalletRackNode,
  detail: RackDetail,
  hasRightNeighbour = false,
): string {
  const variant = hasRightNeighbour ? `${detail}:L` : `${detail}:LR`
  let byVariant = geometryKeys.get(rack as object)
  if (byVariant) {
    const hit = byVariant.get(variant)
    if (hit !== undefined) return hit
  } else {
    byVariant = new Map()
    geometryKeys.set(rack as object, byVariant)
  }
  const key = buildGeometryKey(rack, detail, hasRightNeighbour)
  byVariant.set(variant, key)
  return key
}

function buildGeometryKey(
  rack: PalletRackNode,
  detail: RackDetail,
  hasRightNeighbour: boolean,
): string {
  // Exactly the levels `rackParts` emits: beamed, minus anything the tunnel
  // opens up. Deriving it rather than listing `tunnelLevels` keeps a tunnel that
  // reaches no level — one set under a rack whose ground level carries no beam —
  // from splitting the cache off an identical rack without one.
  const drawn = drawnLevels(rack)
  const hasPicking = drawnPickingLevels(rack).length > 0
  const levels = drawn
    .map((level) => `${levelTypeOf(rack, level)}@${levelSurfaceY(rack, level).toFixed(5)}`)
    .join(',')
  // The panels actually built, per level, through the same helper the builder
  // uses. `rack.decking` was listed raw here, which is how the cache ended up
  // holding two copies of one mesh: back when every finish painted the same grey
  // slab, `wire-mesh` and `steel` produced byte-identical geometry under two
  // different keys. Deriving it means the key follows the panels wherever the
  // rules move next — a bay with no beamed level has no deck and does not
  // mention one.
  const finishes = drawn.map((level) => deckFinishOf(rack, level) ?? '-').join(',')

  return [
    detail,
    // One frame or two. A bay with something standing against its right leaves
    // that frame to its neighbour, which is a different mesh — two variants per
    // shape, and the cheapest possible price for sharing posts at a seam.
    hasRightNeighbour ? 'L' : 'LR',
    rack.bayClearWidth,
    rack.depth,
    rack.uprightHeight,
    rack.uprightWidth,
    rack.uprightDepth,
    rack.beamHeight,
    rack.beamThickness,
    rack.bracing,
    finishes,
    rack.hasGroundBeam ? 1 : 0,
    rack.depthPositions,
    rack.depthPositions > 1 ? rack.depthGap : 0,
    levels,
    // Picking sections and shelf panels are only emitted where a picking level
    // exists; on an all-pallet rack these move nothing.
    hasPicking ? `${rack.pickingBeamHeight}/${rack.pickingShelfThickness}` : '',
    // Palet destek çubukları artık üretilmiyor (sadelik kararı) — bar sayısı
    // ve yuva ofsetleri anahtardan da düştü: hiç vertex kımıldatmayan bir alan
    // anahtarda durursa önbelleği boşuna böler (CLAUDE.md'nin ikinci yönü).
    rack.uprightColor,
    rack.beamColor,
  ].join('|')
}

/**
 * Insertion-ordered, so the oldest entry is the first one `keys()` yields.
 * That is the eviction order and the only reason a plain `Map` is enough.
 */
const cache = new Map<string, THREE.BufferGeometry>()

/**
 * Geometries a mounted rack is currently drawing from, by cache key.
 *
 * Eviction must never free a buffer something is rendering — that would blank
 * the rack, and it would blank every other rack sharing the shape. So the
 * renderer says what it is holding, and held entries are simply skipped.
 */
const retained = new Map<string, number>()

/**
 * Distinct shapes kept before the oldest unheld one is dropped.
 *
 * A realistic layout mints a handful — one shape per rack type, times two detail
 * tiers, times the two frame variants. 96 is far above anything a scene reaches
 * and far below what a drag produces, which is the gap this exploits.
 */
const CACHE_LIMIT = 96

/**
 * Shared geometry for a rack shape.
 *
 * A placed rack's geometry is never disposed, and that is deliberate rather than
 * a leak: the geometry belongs to the shape, not to any node, so freeing it when
 * one rack is deleted would blank every other rack that shares it — the same
 * trap the pallet renderer documents around `<GeometrySystem>`.
 *
 * This is what makes one node per bay affordable at all. Two thousand bays in a
 * 15 000 m² building are two thousand *nodes*, but a run is one shape repeated,
 * so they resolve to a handful of buffers — 4 per shape counting the two detail
 * tiers against the two frame variants. The draw calls are the price; the memory
 * is not.
 *
 * **The transient shapes are the problem, and they are a different problem.**
 * The host's slider fires an update per step of a drag, so scrubbing
 * `uprightHeight` from 1 to 20 mints a geometry at every value it passes
 * through — hundreds of buffers and tens of megabytes that nothing will ever
 * draw again, in exactly the session where the warehouse is about to be filled.
 * So the cache is bounded: past the limit, the oldest entry **no mounted rack is
 * holding** is disposed. Held entries are skipped, so no rack can be blanked,
 * and a scrub's leftovers are the first things to go because nothing retains
 * them.
 */
export function getRackGeometry(
  rack: PalletRackNode,
  detail: RackDetail,
  hasRightNeighbour = false,
): THREE.BufferGeometry {
  const key = rackGeometryKey(rack, detail, hasRightNeighbour)
  const cached = cache.get(key)
  if (cached) return cached

  const geometry = buildFrom(rack, rackParts(rack, detail, hasRightNeighbour))
  cache.set(key, geometry)
  evict(key)
  return geometry
}

/**
 * Drops the oldest unheld shapes.
 *
 * **The entry just built is never a candidate.** A renderer claims its keys in
 * an effect, which runs *after* the render that asked for the geometry, so a
 * freshly built shape is unretained for exactly as long as React takes to
 * commit. A `Map` iterates in insertion order and the new entry is last, so at a
 * full cache it was the only one the retain guard did not skip: disposed, and
 * then returned to be mounted. The mesh survived, but the entry was gone, so
 * every other node resolving to that shape rebuilt and re-disposed it and the
 * sharing this design rests on was permanently off for that key.
 */
function evict(justBuilt: string): void {
  if (cache.size <= CACHE_LIMIT) return
  for (const [key, geometry] of cache) {
    if (cache.size <= CACHE_LIMIT) return
    if (key === justBuilt) continue
    if ((retained.get(key) ?? 0) > 0) continue
    cache.delete(key)
    geometry.dispose()
  }
}

/**
 * Claim a shape while a rack is drawing it, and release it when that rack stops.
 *
 * Called from the renderer's layout effect, which is the only place that knows
 * a buffer is actually on screen. Returns the key so the caller can release the
 * exact entry it claimed rather than re-deriving one that may have changed.
 */
export function retainRackGeometry(
  rack: PalletRackNode,
  detail: RackDetail,
  hasRightNeighbour: boolean,
): string {
  const key = rackGeometryKey(rack, detail, hasRightNeighbour)
  retained.set(key, (retained.get(key) ?? 0) + 1)
  return key
}

export function releaseRackGeometry(key: string): void {
  const count = (retained.get(key) ?? 0) - 1
  if (count > 0) retained.set(key, count)
  else retained.delete(key)
}

/** Distinct shapes built so far. Test and diagnostic hook for the sharing that
 *  the whole design depends on. */
export function rackGeometryCacheSize(): number {
  return cache.size
}

export function clearRackGeometryCache(): void {
  for (const geometry of new Set(cache.values())) geometry.dispose()
  cache.clear()
  retained.clear()
}
