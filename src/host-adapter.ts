/**
 * Every read of a *host-owned* node shape goes through this module.
 *
 * The plugin contract — `Plugin`, `NodeDefinition`, `EditorHostPanel` — is
 * guarded by `apiVersion`, and `loadPlugin` throws on a mismatch, so a breaking
 * change there is loud. Host *node schemas* carry no such guarantee: `slab.polygon`
 * or `level.children` can change shape in any release without a version bump.
 *
 * So nothing outside this file may assume a host node's shape. Callers get
 * narrow structural types behind runtime guards; when the host changes, the
 * guards start returning `false` and the dependent readout degrades to "no data"
 * instead of throwing. Fixing a host change means editing this file, not twenty.
 *
 * Rules for anything added here:
 *   - Guard first, read second. Never index into a host node without narrowing.
 *   - Prefer a local implementation over importing a non-contract host helper.
 *   - Keep it pure. No React, no store subscriptions — callers pass `nodes` in.
 */

export type Vec2 = readonly [number, number]

/** The subset of a host `slab` this plugin reads. */
export type SlabLike = {
  id: string
  polygon: Vec2[]
  holes: Vec2[][]
  name: string | undefined
  /**
   * Walking surface above the level plane, metres, or `undefined` when the host
   * does not offer one.
   *
   * Read for one purpose: telling a mezzanine deck from the floor underneath it.
   * Areas on a level are summed, and a deck stacked over a floor is two real
   * slabs whose areas are both real and whose sum is not the floor a forklift
   * drives on. Nothing here computes a union — that needs a polygon clipper this
   * package does not have — but knowing the sum spans two datums is the
   * difference between a gross figure the user can interpret and one they
   * cannot.
   */
  elevation: number | undefined
}

/** The subset of a host `level` this plugin reads. */
export type LevelLike = {
  id: string
  children: string[]
  level: number
  name: string | undefined
  height: number | undefined
}

/** The subset of a host `building` this plugin reads. */
export type BuildingLike = {
  id: string
  children: string[]
  name: string | undefined
}

type Unknown = Record<string, unknown>

function asRecord(value: unknown): Unknown | null {
  return value && typeof value === 'object' ? (value as Unknown) : null
}

function isVec2(value: unknown): value is Vec2 {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  )
}

function toRing(value: unknown): Vec2[] | null {
  if (!Array.isArray(value)) return null
  const ring: Vec2[] = []
  for (const point of value) {
    if (!isVec2(point)) return null
    ring.push([point[0], point[1]])
  }
  return ring
}

/** Drops entries that are not rings and rings too short to bound an area — a
 * two-point "hole" contributes nothing but would still be walked by every
 * containment test. */
function toRings(value: unknown): Vec2[][] {
  if (!Array.isArray(value)) return []
  const rings: Vec2[][] = []
  for (const entry of value) {
    const ring = toRing(entry)
    if (ring && ring.length >= 3) rings.push(ring)
  }
  return rings
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function idListOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

// ─── Host node narrowing ─────────────────────────────────────────────────

/**
 * Narrow an unknown scene node to the slab fields this plugin reads.
 *
 * A slab whose `polygon` is missing or malformed returns `null` rather than a
 * partially-populated object — a slab with no usable outline contributes
 * nothing to an area figure, and silently treating it as zero-area would be
 * indistinguishable from "the host renamed the field".
 */
export function asSlab(node: unknown): SlabLike | null {
  const record = asRecord(node)
  if (record?.type !== 'slab') return null
  if (typeof record.id !== 'string') return null
  const polygon = toRing(record.polygon)
  if (!polygon || polygon.length < 3) return null
  return {
    id: record.id,
    polygon,
    holes: toRings(record.holes),
    name: stringOrUndefined(record.name),
    // Deliberately not part of the guard: a host that renames this field should
    // cost the mezzanine note, not the area. The outline is what makes a slab
    // readable; the datum is a refinement of what its area means.
    elevation:
      typeof record.elevation === 'number' && Number.isFinite(record.elevation)
        ? record.elevation
        : undefined,
  }
}

export function asLevel(node: unknown): LevelLike | null {
  const record = asRecord(node)
  if (record?.type !== 'level') return null
  if (typeof record.id !== 'string') return null
  return {
    id: record.id,
    children: idListOf(record.children),
    level: typeof record.level === 'number' ? record.level : 0,
    name: stringOrUndefined(record.name),
    height: typeof record.height === 'number' ? record.height : undefined,
  }
}

export function asBuilding(node: unknown): BuildingLike | null {
  const record = asRecord(node)
  if (record?.type !== 'building') return null
  if (typeof record.id !== 'string') return null
  return {
    id: record.id,
    children: idListOf(record.children),
    name: stringOrUndefined(record.name),
  }
}

// ─── Scene traversal ─────────────────────────────────────────────────────

/**
 * Depth-first walk from `rootId` over `children`, visiting every descendant.
 *
 * The fork this replaces scanned only direct `level.children`, so a rack nested
 * under a group contributed nothing to its own capacity figure. `seen` guards
 * against a malformed graph looping forever — a scene loaded from an older or
 * newer host is not assumed to be acyclic.
 */
export function walkSubtree(
  nodes: Readonly<Record<string, unknown>>,
  rootId: string,
  visit: (node: unknown, id: string) => void,
): void {
  const seen = new Set<string>()
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    const node = nodes[id]
    if (node === undefined) continue
    visit(node, id)
    const record = asRecord(node)
    if (!record) continue
    for (const childId of idListOf(record.children)) {
      if (!seen.has(childId)) stack.push(childId)
    }
  }
}

/** Levels under a building, ordered bottom to top. */
export function levelsOfBuilding(
  nodes: Readonly<Record<string, unknown>>,
  buildingId: string | null,
): LevelLike[] {
  if (!buildingId) return []
  const building = asBuilding(nodes[buildingId])
  if (!building) return []
  const levels: LevelLike[] = []
  for (const childId of building.children) {
    const level = asLevel(nodes[childId])
    if (level) levels.push(level)
  }
  return levels.sort((a, b) => a.level - b.level)
}

/** Every level in the scene, ordered bottom to top. Used when no building is selected. */
export function allLevels(nodes: Readonly<Record<string, unknown>>): LevelLike[] {
  const levels: LevelLike[] = []
  for (const node of Object.values(nodes)) {
    const level = asLevel(node)
    if (level) levels.push(level)
  }
  return levels.sort((a, b) => a.level - b.level)
}

/** Slabs that are direct children of a level. */
export function slabsOfLevel(
  nodes: Readonly<Record<string, unknown>>,
  level: LevelLike,
): SlabLike[] {
  const slabs: SlabLike[] = []
  for (const childId of level.children) {
    const slab = asSlab(nodes[childId])
    if (slab) slabs.push(slab)
  }
  return slabs
}

// ─── Geometry ────────────────────────────────────────────────────────────
//
// Implemented locally rather than imported from `@pascal-app/core`. Both
// `pointInPolygon` and the shoelace maths are a few lines each, and owning them
// removes two non-contract host exports from the dependency surface — the whole
// point of this module.

/** Shoelace area of a closed ring, in square metres. Winding-order agnostic. */
export function ringArea(ring: readonly Vec2[]): number {
  const n = ring.length
  if (n < 3) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    if (!a || !b) continue
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(sum) / 2
}

/** Net area of a slab: outer ring minus holes, clamped at zero. */
export function slabArea(slab: SlabLike): number {
  let area = ringArea(slab.polygon)
  for (const hole of slab.holes) area -= ringArea(hole)
  return Math.max(0, area)
}

/**
 * Ray-casting point-in-polygon. Points exactly on an edge are unspecified —
 * acceptable here because callers test object centroids, never boundary points.
 */
/**
 * Whether a ring crosses itself.
 *
 * **The shoelace formula is meaningless on one.** A symmetric bow-tie reports
 * exactly zero area, and an asymmetric one reports the difference of its lobes —
 * a number that looks like an area, sums like an area, and is not one. The
 * host's own auto-generated slabs are simple by construction, but a hand-drawn
 * outline is not, and nothing upstream refuses it.
 *
 * O(v^2) with a bounding-box reject per pair, which is nothing at the tens of
 * vertices a slab has and is why this runs per slab rather than being skipped.
 */
export function ringSelfIntersects(ring: readonly Vec2[]): boolean {
  const count = ring.length
  if (count < 4) return false

  for (let i = 0; i < count; i++) {
    const a1 = ring[i]
    const a2 = ring[(i + 1) % count]
    if (!a1 || !a2) continue
    for (let j = i + 1; j < count; j++) {
      // Adjacent segments share an endpoint by construction, and the first and
      // last share one too — neither is a crossing.
      if (j === i || (j + 1) % count === i || (i + 1) % count === j) continue
      const b1 = ring[j]
      const b2 = ring[(j + 1) % count]
      if (!b1 || !b2) continue
      if (Math.min(a1[0], a2[0]) > Math.max(b1[0], b2[0])) continue
      if (Math.max(a1[0], a2[0]) < Math.min(b1[0], b2[0])) continue
      if (Math.min(a1[1], a2[1]) > Math.max(b1[1], b2[1])) continue
      if (Math.max(a1[1], a2[1]) < Math.min(b1[1], b2[1])) continue
      if (segmentsCross(a1, a2, b1, b2)) return true
    }
  }
  return false
}

function side(a: Vec2, b: Vec2, p: Vec2): number {
  const value = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
  return Math.abs(value) < 1e-12 ? 0 : Math.sign(value)
}

/** Proper crossing only: touching at an endpoint is how a legal polygon is
 *  built, and treating it as a crossing would reject every slab. */
function segmentsCross(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const d1 = side(a1, a2, b1)
  const d2 = side(a1, a2, b2)
  const d3 = side(b1, b2, a1)
  const d4 = side(b1, b2, a2)
  return d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0 && d1 !== d2 && d3 !== d4
}

export function pointInRing(ring: readonly Vec2[], x: number, z: number): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (!a || !b) continue
    const intersects =
      a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    if (intersects) inside = !inside
  }
  return inside
}

/** Inside the slab outline and outside every hole. */
export function pointInSlab(slab: SlabLike, x: number, z: number): boolean {
  if (!pointInRing(slab.polygon, x, z)) return false
  for (const hole of slab.holes) {
    if (pointInRing(hole, x, z)) return false
  }
  return true
}

/** The slab under a point, or null. Smallest-area match wins so a slab nested
 * inside a larger one is elected over its container. */
export function slabAt(slabs: readonly SlabLike[], x: number, z: number): SlabLike | null {
  let best: SlabLike | null = null
  let bestArea = Number.POSITIVE_INFINITY
  for (const slab of slabs) {
    if (!pointInSlab(slab, x, z)) continue
    const area = slabArea(slab)
    if (area < bestArea) {
      best = slab
      bestArea = area
    }
  }
  return best
}

/**
 * The kind of an unknown scene node, or `null` when it does not carry one.
 *
 * The narrowest possible read, and deliberately not a full node guard: the one
 * caller (`instancing/collective-system`) only needs to know whether a node id
 * pulled out of the host's dirty set belongs to this plugin, and a node that
 * has drifted far enough to lose its `type` is already unreachable by every
 * other path here.
 */
export function kindOf(node: unknown): string | null {
  const record = asRecord(node)
  return typeof record?.type === 'string' ? record.type : null
}
