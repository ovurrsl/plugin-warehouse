import * as THREE from 'three'
import { uvOf } from './cargo-atlas-regions'
import {
  CARGO_PALETTE,
  FILM_CHAMFER_M,
  FILM_CLEARANCE_M,
  FILM_SKIRT_RATIO,
  FILM_WAIST,
  STRAP_OFFSET_M,
} from './cargo-constants'
import { type CargoInput, loadExtent } from './cargo-parts'
import { type PalletPreset, specOf } from './presets'

/**
 * The stretch film: an eight-sided sleeve standing off the load, lapping down
 * over the pallet's top boards, and drawn as its own mesh.
 *
 * **Its own mesh is not a preference.** Transparency is a material flag, so a
 * film merged into the cargo buffer would make the cartons translucent too, and
 * the cargo sink writes colour at three components where the film needs four to
 * carry alpha. The plan calls it out as the one detail element that is not
 * merged, and this is why.
 *
 * ## Why the skirt is short
 *
 * The plan's 120 mm reaches the blocks on a 144 mm pallet and covers the EPAL,
 * EUR and IPPC stamps branded on their outward faces — the first line of the
 * acceptance list. The film stops where the boards do.
 *
 * ## Why the corners are cut
 *
 * A rectangle offset 15 mm outward has square corners, and a wrapped pallet does
 * not: the film bridges the corner under tension. Eight flat facets also give
 * the host's ink pass eight clean vertical lines instead of a field of
 * near-threshold gradients, which is the one place that pass is an asset.
 */

/** One horizontal section of the sleeve. */
export type FilmRing = {
  /** Height above the top of the pallet deck, metres. Negative on the skirt. */
  y: number
  halfX: number
  halfZ: number
  /** Multiplier on the material's own opacity, 0–1. */
  alpha: number
}

/**
 * How far the film laps down the pallet — **quantised, and quantised here**.
 *
 * The cache key names this value, and a key that rounds what the builder does
 * not hands two different buffers one entry. So the rounding happens once, at
 * the source, and the builder consumes the same number the key states.
 */
export function filmSkirtDropM(preset: PalletPreset): number {
  return Math.round(specOf(preset).height * FILM_SKIRT_RATIO * 1000) / 1000
}

/**
 * The sections the sleeve is lofted through.
 *
 * Four, and each earns its place: the hem where the film ends on the pallet, the
 * deck line where it leaves it, the waist where the wrap pulls in, and the top
 * where it goes over. Anything between them is a straight run of plastic.
 */
export function filmRings(input: CargoInput): FilmRing[] {
  const [loadX, loadY, loadZ] = loadExtent(input)
  const halfX = loadX / 2 + FILM_CLEARANCE_M
  const halfZ = loadZ / 2 + FILM_CLEARANCE_M

  // The pull-in is capped so the film can never reach the goods: at its
  // tightest it still stands off by the same 1.5 mm the strapping does, which
  // is this package's declared z-fight margin.
  const maxPull = FILM_CLEARANCE_M - STRAP_OFFSET_M
  const pullX = Math.min(FILM_WAIST * (loadX / 2), maxPull)
  const pullZ = Math.min(FILM_WAIST * (loadZ / 2), maxPull)

  return [
    // Thinner at the hem, where a wrap is one or two turns rather than the
    // dozen it carries up the sides. Safe to grade because this is a blended
    // veil — under a dither, a part-alpha band is a field of scattered holes.
    { y: -filmSkirtDropM(input.preset), halfX, halfZ, alpha: 0.65 },
    { y: 0, halfX, halfZ, alpha: 1 },
    { y: loadY / 2, halfX: halfX - pullX, halfZ: halfZ - pullZ, alpha: 1 },
    { y: loadY, halfX, halfZ, alpha: 1 },
  ]
}

/** The eight corners of a ring, in order, as `[x, z]`. */
function facetLoop(halfX: number, halfZ: number): [number, number][] {
  const chamfer = Math.min(FILM_CHAMFER_M, halfX * 0.9, halfZ * 0.9)
  return [
    [halfX - chamfer, halfZ],
    [halfX, halfZ - chamfer],
    [halfX, -halfZ + chamfer],
    [halfX - chamfer, -halfZ],
    [-halfX + chamfer, -halfZ],
    [-halfX, -halfZ + chamfer],
    [-halfX, halfZ - chamfer],
    [-halfX + chamfer, halfZ],
  ]
}

const FILM_RGB: [number, number, number] = [
  Number.parseInt(CARGO_PALETTE.film.slice(1, 3), 16) / 255,
  Number.parseInt(CARGO_PALETTE.film.slice(3, 5), 16) / 255,
  Number.parseInt(CARGO_PALETTE.film.slice(5, 7), 16) / 255,
]

/**
 * The sleeve, as a buffer.
 *
 * Colour is written at **four components**, not three: three is padded to
 * `vec4(rgb, 1)` and the alpha silently vanishes with no error anywhere. The
 * cargo sink writes three on purpose; this one writes four on purpose, and a
 * test asserts both.
 */
export function buildFilmGeometry(input: CargoInput): THREE.BufferGeometry {
  const rings = filmRings(input)
  const loops = rings.map((ring) => facetLoop(ring.halfX, ring.halfZ))
  const region = uvOf('film')

  const position: number[] = []
  const normal: number[] = []
  const uv: number[] = []
  const color: number[] = []

  const totalHeight = rings[rings.length - 1]!.y - rings[0]!.y

  const push = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
    alpha: number,
  ) => {
    position.push(x, y, z)
    normal.push(nx, ny, nz)
    uv.push(u, v)
    color.push(FILM_RGB[0], FILM_RGB[1], FILM_RGB[2], alpha)
  }

  const vOf = (y: number) =>
    region.vMin + ((y - rings[0]!.y) / Math.max(totalHeight, 1e-6)) * (region.vMax - region.vMin)

  for (let band = 0; band < rings.length - 1; band++) {
    const lower = rings[band]!
    const upper = rings[band + 1]!
    const lowerLoop = loops[band]!
    const upperLoop = loops[band + 1]!

    for (let i = 0; i < lowerLoop.length; i++) {
      const next = (i + 1) % lowerLoop.length
      const a = lowerLoop[i]!
      const b = lowerLoop[next]!
      const c = upperLoop[next]!
      const d = upperLoop[i]!

      // One flat normal for the whole facet, from its two edges: the horizontal
      // run along the ring, and the lean from the lower ring to the upper one.
      // Piecewise-constant on purpose — eight faces give the host's ink pass
      // eight clean lines where a smoothed sweep gives it a gradient field.
      const rise = upper.y - lower.y
      const runX = b[0] - a[0]
      const runZ = b[1] - a[1]
      const leanX = d[0] - a[0]
      const leanZ = d[1] - a[1]
      let nx = -runZ * rise
      let ny = runZ * leanX - runX * leanZ
      let nz = runX * rise
      const length = Math.hypot(nx, ny, nz) || 1
      nx /= length
      ny /= length
      nz /= length

      const uLow = region.uMin + (i / lowerLoop.length) * (region.uMax - region.uMin)
      const uHigh = region.uMin + ((i + 1) / lowerLoop.length) * (region.uMax - region.uMin)
      const vLow = vOf(lower.y)
      const vHigh = vOf(upper.y)

      push(a[0], lower.y, a[1], nx, ny, nz, uLow, vLow, lower.alpha)
      push(b[0], lower.y, b[1], nx, ny, nz, uHigh, vLow, lower.alpha)
      push(c[0], upper.y, c[1], nx, ny, nz, uHigh, vHigh, upper.alpha)

      push(a[0], lower.y, a[1], nx, ny, nz, uLow, vLow, lower.alpha)
      push(c[0], upper.y, c[1], nx, ny, nz, uHigh, vHigh, upper.alpha)
      push(d[0], upper.y, d[1], nx, ny, nz, uLow, vHigh, upper.alpha)
    }
  }

  // The cap. Two triangles' worth of thinking: without it the sleeve's top edge
  // is an open rim seen at a grazing angle from any warehouse camera, which is
  // exactly the geometry a depth-Laplacian ink pass fires on.
  const top = rings[rings.length - 1]!
  const topLoop = loops[loops.length - 1]!
  const capU = region.uMin + (region.uMax - region.uMin) / 2
  const capV = region.vMax
  for (let i = 0; i < topLoop.length; i++) {
    const next = (i + 1) % topLoop.length
    const a = topLoop[i]!
    const b = topLoop[next]!
    push(0, top.y, 0, 0, 1, 0, capU, capV, top.alpha)
    push(a[0], top.y, a[1], 0, 1, 0, capU, capV, top.alpha)
    push(b[0], top.y, b[1], 0, 1, 0, capU, capV, top.alpha)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 4))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * What a sleeve depends on: the block it wraps and how far it laps.
 *
 * Not the preset — two decks that tile the same way give the same load, and only
 * their height reaches the film, through the already-quantised skirt drop. Not
 * the detail tier either: `loadExtent` reads type, preset and variant and never
 * the tier, so the far tier's single box has exactly the near tier's extent and
 * one sleeve fits both.
 */
export function filmCacheKey(input: CargoInput): string {
  const [x, y, z] = loadExtent(input)
  return [
    'film',
    x.toFixed(4),
    y.toFixed(4),
    z.toFixed(4),
    filmSkirtDropM(input.preset).toFixed(3),
  ].join('|')
}

const cache = new Map<string, THREE.BufferGeometry>()
const retained = new Map<string, number>()
const CACHE_LIMIT = 32

export function getFilmGeometry(input: CargoInput): THREE.BufferGeometry {
  const key = filmCacheKey(input)
  const hit = cache.get(key)
  if (hit) return hit
  const built = buildFilmGeometry(input)
  cache.set(key, built)
  evict(key)
  return built
}

/** The entry just built is never a candidate — the renderer claims its key in an
 *  effect, which runs after the render that asked for it. */
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

export function retainFilmGeometry(input: CargoInput): string {
  const key = filmCacheKey(input)
  retained.set(key, (retained.get(key) ?? 0) + 1)
  return key
}

export function releaseFilmGeometry(key: string): void {
  const count = (retained.get(key) ?? 0) - 1
  if (count > 0) retained.set(key, count)
  else retained.delete(key)
}

export function filmGeometryCacheSize(): number {
  return cache.size
}
