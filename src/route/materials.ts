import * as THREE from 'three'
import { type Appearance, appearanceKey, type SurfaceSpec, surfaceMaterial } from '../appearance'
import { DEPTH_BIAS } from './constants'
import type { RouteRole } from './schema'

/**
 * The paint, as two materials per role.
 *
 * **Colour lives here and never in the buffer.** A route is green because it is
 * a walkway; the user cannot pick a hue, so nothing about colour belongs in a
 * geometry key. The older editor put a free hex on the node, which defeated the
 * host theme and rebuilt a material per stop of a colour drag — a shader compile
 * per stop, on this backend.
 *
 * ## Why `polygonOffset` and not a lift
 *
 * A marking is coplanar with the floor by construction. The obvious fix is to
 * raise it a millimetre, and it is wrong here: on this renderer's
 * `near = 0.1 / far = 1000` buffer the resolvable depth step grows with the
 * square of distance, so 1.5 mm reads at a metre and vanishes at fifty — and a
 * 15,000 m² floor is a box a camera routinely views from a hundred. Worse, a
 * constant lift is *least* effective at the grazing angle down a long aisle,
 * which is exactly the view a warehouse is drawn for.
 *
 * `polygonOffset` biases in depth-buffer units and scales that bias by the
 * polygon's own depth slope, so the grazing case gets the largest correction
 * automatically. The mechanism is already proven on this backend by the host's
 * own measurement chrome (`measurement/renderer.tsx` uses −2/−2 and −3/−3).
 *
 * The ink pass cannot fire on any of this: it reads a depth Laplacian gated at
 * 2e-5 and a normal difference gated at 0.01, and a flat marking on a flat slab
 * gives a normal difference of exactly zero. Markings get no free outline and
 * must carry their contrast in colour alone.
 */

/**
 * **Vehicle aisles are yellow; that one is the rule.** Directive 92/58/EEC
 * Annex V ¶2.1, at RG 11.09.2013/28762 Ek-5: continuous stripes, *"sarı ya da
 * beyaz"*, chosen against the floor.
 *
 * **Walkways are green; that one is practice.** No instrument in the survey
 * specifies a pedestrian-way colour, and green is what warehouses paint. Said
 * plainly so nobody later cites a directive for it.
 */
const STRIPE_COLOURS: Record<RouteRole, number> = {
  vehicle: 0xf2c31d,
  pedestrian: 0x2f9e58,
}

/** Arrows and the lane divider, dark so they read against either stripe. */
const CONTRAST_COLOUR = 0x1e293b

const cache = new Map<string, THREE.Material[]>()

function specFor(
  role: RouteRole,
  part: 'stripe' | 'contrast',
  edgeColor?: string | null,
): SurfaceSpec {
  const isStripe = part === 'stripe'
  let color = isStripe ? STRIPE_COLOURS[role] : CONTRAST_COLOUR
  if (isStripe && edgeColor) {
    try {
      color = new THREE.Color(edgeColor).getHex()
    } catch {
      color = STRIPE_COLOURS[role]
    }
  }
  return {
    family: `route:${role}:${part}:${edgeColor ?? 'default'}`,
    color,
    roughness: 0.85,
    metalness: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: isStripe
      ? DEPTH_BIAS.STRIPES.polygonOffsetFactor
      : DEPTH_BIAS.ARROWS.polygonOffsetFactor,
    polygonOffsetUnits: isStripe
      ? DEPTH_BIAS.STRIPES.polygonOffsetUnits
      : DEPTH_BIAS.ARROWS.polygonOffsetUnits,
    side: THREE.FrontSide,
  }
}

/**
 * One pair per role, shared by every route wearing it.
 *
 * Two ranks rather than one: a pedestrian route paints *over* a vehicle aisle,
 * which is both the real-world reading order and the only coplanar case that
 * can arise — within a single route nothing overlaps anything, because the
 * stripes sit at the edges and the arrows and divider are mutually exclusive on
 * the axis.
 *
 * Dokular kapalıyken şeritler de tema rengine çöküyor — sarı/yeşil ayrımı o
 * modda kayboluyor. İstenmeyen ama tutarlı: monokrom mod host'un kendi zemin
 * ve duvar renklerini de aynı şekilde siliyor, ve rotayı ayrıcalıklı kılmak
 * "bazı nesneler ayarı dinliyor" hâline geri dönmek olurdu.
 */
export function getRouteMaterials(
  role: RouteRole,
  appearance: Appearance,
  laneColor?: string | null,
  edgeColor?: string | null,
): THREE.Material[] {
  const color = laneColor ?? '#ffffff'
  const edge = edgeColor ?? 'default'
  const key = `${role}|${appearanceKey(appearance)}|${color}|${edge}`
  const hit = cache.get(key)
  if (hit) return hit
  const stripeMat = surfaceMaterial(specFor(role, 'stripe', edgeColor), appearance)
  const contrastMat = surfaceMaterial(specFor(role, 'contrast'), appearance)
  const paintMat = getCorridorPaintMaterial(color, appearance)

  ;(stripeMat as unknown as { renderOrder: number }).renderOrder = DEPTH_BIAS.STRIPES.renderOrder
  ;(contrastMat as unknown as { renderOrder: number }).renderOrder = DEPTH_BIAS.ARROWS.renderOrder
  ;(paintMat as unknown as { renderOrder: number }).renderOrder = DEPTH_BIAS.PAINT_FILL.renderOrder

  const built = [stripeMat, contrastMat, paintMat]
  cache.set(key, built)
  return built
}

const corridorPaintCache = new Map<string, THREE.Material>()

/**
 * Returns a cached surface paint material for filled corridor ribbons.
 *
 * Configured with depthWrite: false, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
 * and renderOrder: 1 (DEPTH_BIAS.PAINT_FILL).
 */
export function getCorridorPaintMaterial(color: string, appearance?: Appearance): THREE.Material {
  const resolvedAppearance: Appearance = appearance ?? {
    shading: 'rendered',
    textures: true,
    colorPreset: 'light' as never,
  }
  const key = `corridor:${color}|${appearanceKey(resolvedAppearance)}`
  const hit = corridorPaintCache.get(key)
  if (hit) return hit

  const spec: SurfaceSpec = {
    family: `route:corridor:${color}`,
    color: color,
    roughness: 0.85,
    metalness: 0.05,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: DEPTH_BIAS.PAINT_FILL.polygonOffsetFactor,
    polygonOffsetUnits: DEPTH_BIAS.PAINT_FILL.polygonOffsetUnits,
    side: THREE.FrontSide,
  }

  const mat = surfaceMaterial(spec, resolvedAppearance)
  ;(mat as unknown as { renderOrder: number }).renderOrder = DEPTH_BIAS.PAINT_FILL.renderOrder
  corridorPaintCache.set(key, mat)
  return mat
}

let cachedZebraMat: THREE.MeshStandardMaterial | null = null

/**
 * Returns the cached shared material for dynamic zebra crossings.
 *
 * Configured with DoubleSide, depthWrite: false, renderOrder: 10, and
 * polygonOffset to prevent z-fighting with painted corridors and floor slabs.
 */
export function getZebraMaterial(_appearance?: Appearance): THREE.MeshStandardMaterial {
  if (!cachedZebraMat) {
    cachedZebraMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0.1,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: DEPTH_BIAS.ZEBRA.polygonOffsetFactor,
      polygonOffsetUnits: DEPTH_BIAS.ZEBRA.polygonOffsetUnits,
      side: THREE.DoubleSide,
    })
    ;(cachedZebraMat as unknown as { renderOrder: number }).renderOrder =
      DEPTH_BIAS.ZEBRA.renderOrder
  }
  return cachedZebraMat
}

/**
 * Cached singleton zebra crosswalk material.
 */
export const cachedZebraMaterial: THREE.MeshStandardMaterial = getZebraMaterial()

/**
 * Standard shadow policy for all floor route markings:
 * castShadow is strictly false to eliminate diagonal self-shadow artifacts on curves and coplanar slabs,
 * receiveShadow is true so scene lighting and environment shadows cast cleanly across floor markings.
 */
export const ROUTE_SHADOW_POLICY = {
  castShadow: false,
  receiveShadow: true,
} as const
