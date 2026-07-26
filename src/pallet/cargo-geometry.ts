import * as THREE from 'three'
import { type CargoRegionId, type UVRect, uvOf } from './cargo-atlas-regions'
import { CORNER_BOARD_MIN_FILL } from './cargo-constants'
import { type CargoInput, type CargoPart, cargoParts, loadExtent } from './cargo-parts'
import { unitCount, unitsPerLayer } from './cargo-types'

/**
 * The part list, merged into one buffer per distinct load.
 *
 * Built face by face rather than by merging box geometries, because every
 * saving in this kind is expressed as *a face that is not emitted* — the
 * interior of a carton stack, the underside of a drum, the bottom of a load
 * standing on a deck. `BoxGeometry` has no way to say that, so building the
 * faces directly is not an optimisation of the obvious approach; it is the only
 * way to write the rule down at all.
 *
 * Nothing here decides what a load is made of. That is `./cargo-parts`, which is
 * plain arithmetic and testable without a browser.
 */

/** Around a drum. Twenty is where the silhouette stops being a polygon at the
 *  distance a drum is actually looked at; ten is enough once it is a metre tall
 *  on screen. */
const RADIAL_SEGMENTS = { full: 20, simple: 10 } as const

type FaceKey = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz'

/**
 * Each face as an origin corner and two edge vectors, in units of half-size.
 *
 * `origin` is the bottom-left corner **seen from outside**, `u` runs right and
 * `v` runs up, which makes `(0,1,2)(0,2,3)` wind counter-clockwise on every one
 * of the six without a special case — and makes every texture land upright
 * without a per-face flip, which is the mistake the empty pallet's markings
 * shipped with on two faces.
 */
const FACE_BASIS: Record<
  FaceKey,
  {
    normal: readonly [number, number, number]
    origin: readonly [number, number, number]
    u: readonly [number, number, number]
    v: readonly [number, number, number]
  }
> = {
  px: { normal: [1, 0, 0], origin: [1, -1, 1], u: [0, 0, -2], v: [0, 2, 0] },
  nx: { normal: [-1, 0, 0], origin: [-1, -1, -1], u: [0, 0, 2], v: [0, 2, 0] },
  pz: { normal: [0, 0, 1], origin: [-1, -1, 1], u: [2, 0, 0], v: [0, 2, 0] },
  nz: { normal: [0, 0, -1], origin: [1, -1, -1], u: [-2, 0, 0], v: [0, 2, 0] },
  py: { normal: [0, 1, 0], origin: [-1, 1, 1], u: [2, 0, 0], v: [0, 0, -2] },
  ny: { normal: [0, -1, 0], origin: [-1, -1, -1], u: [2, 0, 0], v: [0, 0, 2] },
}

const SIDE_FACES: readonly FaceKey[] = ['px', 'nx', 'pz', 'nz']

type Sink = {
  position: number[]
  normal: number[]
  uv: number[]
  color: number[]
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

/**
 * Approximate ambient occlusion, written into the same `color` attribute that
 * carries hue.
 *
 * The two multiply, which is why hue can live there at all: a kraft carton near
 * the deck is kraft times a shade, and the material needs to know nothing about
 * either. The terms are the two a viewer actually notices on a palletised load —
 * that the bottom of a stack is darker than the top, and that anything facing
 * down is darker still. A raytraced bake would be better and would need an
 * offline step, which is the property this package does not have.
 */
function shadeAt(y: number, loadY: number, normalY: number): number {
  const fromTop = 1 - Math.min(1, Math.max(0, y / Math.max(loadY, 1e-6)))
  let occlusion = fromTop * 0.24
  if (normalY < -0.5) occlusion += 0.26
  return 1 - Math.min(0.46, occlusion)
}

function pushVertex(
  sink: Sink,
  x: number,
  y: number,
  z: number,
  normal: readonly [number, number, number],
  u: number,
  v: number,
  rgb: readonly [number, number, number],
  loadY: number,
) {
  sink.position.push(x, y, z)
  sink.normal.push(normal[0], normal[1], normal[2])
  sink.uv.push(u, v)
  const shade = shadeAt(y, loadY, normal[1])
  sink.color.push(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade)
}

function emitQuad(
  sink: Sink,
  corners: readonly [number, number, number][],
  normal: readonly [number, number, number],
  rect: UVRect,
  vLow: number,
  vHigh: number,
  rgb: readonly [number, number, number],
  loadY: number,
) {
  const u0 = rect.uMin
  const u1 = rect.uMax
  const v0 = rect.vMin + (rect.vMax - rect.vMin) * vLow
  const v1 = rect.vMin + (rect.vMax - rect.vMin) * vHigh
  const uvs: [number, number][] = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ]
  for (const index of [0, 1, 2, 0, 2, 3] as const) {
    const corner = corners[index] as [number, number, number]
    const uv = uvs[index] as [number, number]
    pushVertex(sink, corner[0], corner[1], corner[2], normal, uv[0], uv[1], rgb, loadY)
  }
}

function emitBox(
  sink: Sink,
  part: CargoPart,
  loadY: number,
  rectOf: (id: CargoRegionId) => UVRect,
) {
  const [cx, cy, cz] = part.center
  const hx = part.size[0] / 2
  const hy = part.size[1] / 2
  const hz = part.size[2] / 2
  const rgb = hexToRgb(part.color)

  for (const key of ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const) {
    if (!part.faces[key]) continue
    const basis = FACE_BASIS[key]
    const rect = rectOf(key === 'py' || key === 'ny' ? part.topRegion : part.sideRegion)
    const bands = SIDE_FACES.includes(key) ? Math.max(1, Math.round(part.vRepeat ?? 1)) : 1

    const at = (uFrac: number, vFrac: number): [number, number, number] => [
      cx + (basis.origin[0] + basis.u[0] * uFrac + basis.v[0] * vFrac) * hx,
      cy + (basis.origin[1] + basis.u[1] * uFrac + basis.v[1] * vFrac) * hy,
      cz + (basis.origin[2] + basis.u[2] * uFrac + basis.v[2] * vFrac) * hz,
    ]

    for (let band = 0; band < bands; band++) {
      const low = band / bands
      const high = (band + 1) / bands
      emitQuad(
        sink,
        [at(0, low), at(1, low), at(1, high), at(0, high)],
        basis.normal,
        rect,
        0,
        1,
        rgb,
        loadY,
      )
    }
  }
}

function emitCylinder(
  sink: Sink,
  part: CargoPart,
  loadY: number,
  segments: number,
  rectOf: (id: CargoRegionId) => UVRect,
) {
  const [cx, cy, cz] = part.center
  const radius = part.size[0] / 2
  const half = part.size[1] / 2
  const rgb = hexToRgb(part.color)
  const side = rectOf(part.sideRegion)
  const cap = rectOf(part.topRegion)

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const cos0 = Math.cos(a0)
    const sin0 = Math.sin(a0)
    const cos1 = Math.cos(a1)
    const sin1 = Math.sin(a1)
    const u0 = side.uMin + (side.uMax - side.uMin) * (i / segments)
    const u1 = side.uMin + (side.uMax - side.uMin) * ((i + 1) / segments)

    // The shell, with normals along the radius so it shades as a cylinder and
    // not as a drum-shaped prism.
    const ring: [number, number, number, number, number][] = [
      [cx + cos0 * radius, cy - half, cz + sin0 * radius, u0, side.vMin],
      [cx + cos1 * radius, cy - half, cz + sin1 * radius, u1, side.vMin],
      [cx + cos1 * radius, cy + half, cz + sin1 * radius, u1, side.vMax],
      [cx + cos0 * radius, cy + half, cz + sin0 * radius, u0, side.vMax],
    ]
    const normals: [number, number, number][] = [
      [cos0, 0, sin0],
      [cos1, 0, sin1],
      [cos1, 0, sin1],
      [cos0, 0, sin0],
    ]
    // Reversed against the box's order: the ring is walked anticlockwise in the
    // X-Z plane, so taking its corners in the same order as a flat quad's winds
    // the shell inward and the drum renders inside out — invisible from without
    // and fully visible from within, which is how it reads as "the drum is
    // missing" rather than as a winding mistake.
    for (const index of [0, 2, 1, 0, 3, 2] as const) {
      const vertex = ring[index] as [number, number, number, number, number]
      const normal = normals[index] as [number, number, number]
      pushVertex(sink, vertex[0], vertex[1], vertex[2], normal, vertex[3], vertex[4], rgb, loadY)
    }

    const capUV = (cosine: number, sine: number): [number, number] => [
      cap.uMin + (cap.uMax - cap.uMin) * (0.5 + cosine / 2),
      cap.vMin + (cap.vMax - cap.vMin) * (0.5 + sine / 2),
    ]
    if (part.faces.py) {
      const up: [number, number, number] = [0, 1, 0]
      const centreUV = capUV(0, 0)
      pushVertex(sink, cx, cy + half, cz, up, centreUV[0], centreUV[1], rgb, loadY)
      // The far edge first, for the same reason the shell is reversed: fanning
      // an anticlockwise ring in order faces the cap down into the drum.
      const second = capUV(cos1, sin1)
      pushVertex(
        sink,
        cx + cos1 * radius,
        cy + half,
        cz + sin1 * radius,
        up,
        second[0],
        second[1],
        rgb,
        loadY,
      )
      const first = capUV(cos0, sin0)
      pushVertex(
        sink,
        cx + cos0 * radius,
        cy + half,
        cz + sin0 * radius,
        up,
        first[0],
        first[1],
        rgb,
        loadY,
      )
    }
  }
}

/**
 * What the buffer actually depends on — **and nothing else.**
 *
 * The law this package runs on: a key that names a field the builder cannot act
 * on splits the cache between byte-identical buffers, and a key that omits one
 * it does act on hands two visibly different loads the same vertices. Both are
 * silent. So the two detail flags are named **only at `full`**, because the far
 * tier drops them entirely and dragging one there would otherwise mint a second
 * buffer identical to the first.
 *
 * Corner boards are deliberately absent: they appear when the type calls for
 * them and the fill clears {@link CORNER_BOARD_MIN_FILL}, and both of those are
 * already decided by `type` and `variant`. Naming them again would be the
 * over-reporting half of the same mistake.
 */
export function cargoCacheKey(input: CargoInput): string {
  const full = input.detail === 'full'
  return [
    input.type.id,
    layoutKey(input),
    input.detail,
    input.color,
    full && input.strapped ? 's' : '-',
    full && input.labelled ? 'l' : '-',
  ].join('|')
}

/**
 * The layout the builder actually lays out — never the preset or the variant it
 * came from.
 *
 * Those are the inputs; this is what survives them. An EPAL 1 deck is 1200 × 800
 * and an EPAL 2 is 1200 × 1000, and a 300 × 400 carton tiles **both** four by
 * two: same layout, same vertices, and naming the preset would have handed two
 * byte-identical buffers two different keys. Variant is the same story one step
 * on — it exists to be turned into a layer count, and once it has been, it has
 * no further say.
 */
function layoutKey(input: CargoInput): string {
  if (input.type.fill === 'layers') {
    const perLayer = unitsPerLayer(input.type, input.preset)
    const layers = Math.max(1, Math.round(input.variant * input.type.variants.length))
    return `${perLayer.alongX}x${perLayer.alongZ}x${layers}`
  }
  return `n${unitCount(input.type, input.preset, input.variant)}`
}

const cache = new Map<string, THREE.BufferGeometry>()

/** Loads a mounted pallet is currently drawing, by key. Eviction must never free
 *  a buffer something is rendering. */
const retained = new Map<string, number>()

/**
 * Distinct loads kept before the oldest unheld one is dropped.
 *
 * A warehouse orders from a short list — a couple of cargo types across a
 * handful of fills — so a real scene sits far under this. What the limit is
 * actually for is a *panel*: walking the fill range or the colour select mints a
 * load per stop, and nothing will ever draw those again. The same pool and the
 * same rule as the rack's and the conveyor's, per family.
 */
const CACHE_LIMIT = 64

/**
 * One shared buffer per distinct load.
 *
 * Never dispose the result: it is shared by every pallet that resolved to the
 * same load, exactly like `getPalletGeometry`. The renderer mounts it with
 * `dispose={null}` and claims it with {@link retainCargoGeometry} for as long as
 * it is on screen.
 */
export function getCargoGeometry(input: CargoInput): THREE.BufferGeometry {
  const key = cargoCacheKey(input)
  const hit = cache.get(key)
  if (hit) return hit

  const built = buildCargoGeometry(input)
  cache.set(key, built)
  evict()
  return built
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

/**
 * Claim a load while a pallet is drawing it, and release it when that pallet
 * stops.
 *
 * Returns the key so the caller releases the exact entry it claimed rather than
 * re-deriving one that may have changed under it.
 */
export function retainCargoGeometry(input: CargoInput): string {
  const key = cargoCacheKey(input)
  retained.set(key, (retained.get(key) ?? 0) + 1)
  return key
}

export function releaseCargoGeometry(key: string): void {
  const count = (retained.get(key) ?? 0) - 1
  if (count > 0) retained.set(key, count)
  else retained.delete(key)
}

/** Distinct loads built so far. Test and diagnostic hook for the sharing the
 *  whole design depends on. */
export function cargoGeometryCacheSize(): number {
  return cache.size
}

export function buildCargoGeometry(input: CargoInput): THREE.BufferGeometry {
  const parts = cargoParts(input)
  const loadY = loadExtent(input)[1]
  const segments = RADIAL_SEGMENTS[input.detail]
  const sink: Sink = { position: [], normal: [], uv: [], color: [] }

  // Region rectangles resolved once per build rather than per face: `uvOf` is
  // pure and cheap, but a full pallet asks for one per face of forty cartons.
  const rects = new Map<CargoRegionId, UVRect>()
  const rectOf = (id: CargoRegionId): UVRect => {
    const known = rects.get(id)
    if (known) return known
    const made = uvOf(id)
    rects.set(id, made)
    return made
  }

  for (const part of parts) {
    if (part.shape === 'cylinder') emitCylinder(sink, part, loadY, segments, rectOf)
    else emitBox(sink, part, loadY, rectOf)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(sink.position, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(sink.normal, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(sink.uv, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(sink.color, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
