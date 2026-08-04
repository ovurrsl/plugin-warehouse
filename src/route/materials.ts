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

function specFor(role: RouteRole, part: 'stripe' | 'contrast'): SurfaceSpec {
  return {
    family: `route:${role}:${part}`,
    color: part === 'stripe' ? STRIPE_COLOURS[role] : CONTRAST_COLOUR,
    roughness: 0.85,
    metalness: 0,
    // Her modda korunur — bkz. `../appearance`. Gölgeleme modunun eş düzlem
    // sorunuyla ilgisi yok; offset düşerse rota slab ile z-savaşına girer.
    polygonOffset: true,
    polygonOffsetFactor: DEPTH_BIAS.factor,
    polygonOffsetUnits:
      role === 'pedestrian' ? DEPTH_BIAS.pedestrianUnits : DEPTH_BIAS.vehicleUnits,
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
export function getRouteMaterials(role: RouteRole, appearance: Appearance): THREE.Material[] {
  const key = `${role}|${appearanceKey(appearance)}`
  const hit = cache.get(key)
  if (hit) return hit
  const built = [
    surfaceMaterial(specFor(role, 'stripe'), appearance),
    surfaceMaterial(specFor(role, 'contrast'), appearance),
  ]
  cache.set(key, built)
  return built
}
