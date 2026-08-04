import * as THREE from 'three'
import { type Appearance, previewMaterial, type SurfaceSpec, surfaceMaterial } from '../appearance'
import { getOrCreateCargoAtlas } from './cargo-atlas'
import { FILM_OPACITY } from './cargo-constants'
import { getOrCreateEPALTextureAtlas } from './epal-textures'

/**
 * Module-level singletons, shared by every pallet in the scene.
 *
 * The earlier version built the material inside a `useMemo` in the renderer, so
 * two hundred pallets meant two hundred `MeshStandardMaterial` instances — and
 * because nothing disposed them, each deleted pallet leaked one. They all
 * shared the same three textures, so three.js compiled one program and the cost
 * was uniform uploads rather than shader churn, but it directly contradicted
 * the file's own "single material" comment.
 *
 * Tekillik artık AYAR başına — bkz. `../appearance`. Host'un Display menüsü
 * (Render, Textures, Theme) materyali değiştirerek çalışıyor ve bu dosya onu
 * okumadığı için paletler, bütün bina düzleşirken ya da kile dönerken, EPAL
 * damgalarını göstermeye devam ediyordu.
 */

function deckSpec(): SurfaceSpec {
  const atlas = getOrCreateEPALTextureAtlas()
  return {
    family: 'pallet-deck',
    map: atlas.map,
    // three multiplies these scalars into the map channels. The earlier version
    // set 0.75 / 0.2, which meant the control nail — authored as pure white in
    // the metalness map, i.e. steel — rendered at 0.2 metalness and read as
    // shiny grey plastic, and the wood came out around 0.5 roughness, glossier
    // than raw pine. Leave them at 1.0 and let the maps carry the values.
    roughnessMap: atlas.roughnessMap,
    metalnessMap: atlas.metalnessMap,
    roughness: 1,
    metalness: 1,
    // Multiplies in the baked occlusion the geometry builder writes.
    vertexColors: true,
  }
}

export function getPalletMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(deckSpec(), appearance)
}

/**
 * The ghost shown while placing. A separate cached instance rather than a
 * mutated clone of the real one: builders cache materials at module scope, so
 * setting `transparent`/`opacity` on the shared instance would leak the
 * translucency into every committed pallet in the scene.
 */
export function getPalletPreviewMaterial(appearance: Appearance): THREE.Material {
  return previewMaterial(deckSpec(), appearance)
}

/**
 * One material for everything a pallet carries — cartons, drums, straps, corner
 * boards and the label alike.
 *
 * **The same texture is handed to `roughnessMap` and `metalnessMap`**, which is
 * not a mistake: three reads roughness from a texture's green channel and
 * metalness from its blue, expressly so one packed sheet can serve both. Two
 * separate sheets would double the VRAM to say the same thing.
 *
 * `vertexColors` carries two multiplied together — each part's own hue and the
 * approximate occlusion baked over it. That is what lets a green strap and a
 * kraft carton share one mesh, and it is why a per-instance tint is left to do
 * only the small per-pallet variation it is good at.
 */
function cargoSpec(): SurfaceSpec {
  const atlas = getOrCreateCargoAtlas()
  return {
    family: 'cargo',
    map: atlas.map,
    roughnessMap: atlas.orm,
    metalnessMap: atlas.orm,
    // Left at 1 so the packed sheet carries the values rather than being scaled
    // by a second opinion — the mistake the pallet's own material shipped with,
    // which rendered its steel control nail as grey plastic.
    roughness: 1,
    metalness: 1,
    vertexColors: true,
  }
}

export function getCargoMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(cargoSpec(), appearance)
}

export function getCargoPreviewMaterial(appearance: Appearance): THREE.Material {
  return previewMaterial(cargoSpec(), appearance)
}

/**
 * Stretch film: **blended, and writing no depth.**
 *
 * The plan asks for `alphaHash`, on the strength of order-independence and of
 * MSAA dissolving its grain. Neither survives contact with this host. The viewer
 * builds a `WebGPURenderer` and a TSL pipeline whose `pass()` writes a
 * depth+normal MRT consumed by `ssgi()`, an edge-aware `denoise()` and a
 * depth-Laplacian `inkedEdges()`, and nothing in that chain sets `samples` — so
 * there is no MSAA for a dither to resolve against, and a dither that kept
 * `depthWrite` would fill that shared buffer with a per-pixel mixture of two
 * surfaces 15 mm apart. The ink pass reads the Laplacian of that as an edge and
 * stipples every wrapped pallet below its own line threshold, which reads as
 * dirt rather than as anything anyone would trace back to the film.
 *
 * `depthWrite: false` writes nothing into that buffer, so all three passes see
 * exactly what they see today. The cost is a per-object sort, and the errors it
 * admits are between two near-white veils on different pallets — a wrong grey,
 * not a wrong picture.
 *
 * `FrontSide`, because three sorts objects and never triangles within a mesh:
 * a double-sided sleeve would have to order its own far wall against its near
 * one, which nothing can do.
 *
 * Üç harmanlama alanı da HER görünüm modunda korunuyor (`../appearance`
 * bunları gölgelemeden bağımsız tutuyor). Dokular kapalıyken film düz bir
 * saydam veile dönüyor ama saydam KALIYOR — opaklaşsaydı sarılı paletin yükü
 * kilin altında tamamen kaybolurdu. Kaybolan tek şey eteğin incelen alfası:
 * o da vertex renk attribute'unun dördüncü bileşeninde ve düz renk modu o
 * attribute'u zaten bırakıyor.
 */
function filmSpec(): SurfaceSpec {
  const atlas = getOrCreateCargoAtlas()
  return {
    family: 'film',
    map: atlas.map,
    roughnessMap: atlas.orm,
    metalnessMap: atlas.orm,
    roughness: 1,
    metalness: 1,
    // Four-component vertex colour: the sleeve grades its own alpha down the
    // skirt, and three components are silently padded to opaque.
    vertexColors: true,
    transparent: true,
    opacity: FILM_OPACITY,
    depthWrite: false,
    side: THREE.FrontSide,
  }
}

export function getFilmMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(filmSpec(), appearance)
}

/**
 * The deck at distance: flat wood, no maps, no vertex colours.
 *
 * Its own material rather than the atlas one, because the far geometry is a
 * bare box with no meaningful UVs — sampling the branded atlas through it would
 * smear the EPAL stamps across a twelve-triangle slab. At the range this tier
 * exists for, a flat colour and the atlas are indistinguishable.
 */
export function getPalletFarMaterial(appearance: Appearance): THREE.Material {
  return surfaceMaterial(
    { family: 'pallet-far', color: 0xb99a6b, metalness: 0, roughness: 0.9 },
    appearance,
  )
}
